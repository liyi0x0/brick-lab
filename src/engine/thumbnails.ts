import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getColor } from '../core/colors';
import { PARTS } from '../core/parts';
import type { BrickData } from '../core/types';
import { brickMatrix } from './bricks';
import { getPartGeometry } from './geometry';

export interface PartAtlas {
  url: string;
  cols: number;
  /** 每格像素（图集内） */
  cell: number;
  index: Record<string, number>;
}

/** 离屏渲染零件图标与作品预览图（独立 WebGL 上下文，不影响主画面） */
class Thumbnailer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(22, 1, 0.1, 500);
  private mesh = new THREE.Mesh();
  private mats = new Map<number, THREE.MeshPhysicalMaterial>();
  private lastUrl = '';

  constructor() {
    const canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environmentIntensity = 0.75;
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-3, 6, 4);
    this.scene.add(key, new THREE.HemisphereLight(0xffffff, 0xb0a890, 0.5));
    this.scene.add(this.mesh);
  }

  private material(colorId: number) {
    let m = this.mats.get(colorId);
    if (!m) {
      const c = getColor(colorId);
      m = new THREE.MeshPhysicalMaterial({
        color: c.hex,
        roughness: c.kind === 'trans' ? 0.05 : 0.3,
        metalness: c.kind === 'metal' ? 0.55 : 0,
        clearcoat: 0.35,
        transparent: c.kind === 'trans',
        opacity: c.kind === 'trans' ? 0.62 : 1,
        envMapIntensity: c.kind === 'metal' ? 1.6 : 1,
      });
      this.mats.set(colorId, m);
    }
    return m;
  }

  /**
   * 让包围盒在画面中尽量撑满：把 8 个角投影到屏幕，迭代调整距离并重新居中。
   * 比包围球更紧凑，扁平或细长的模型也能占满画面。
   */
  private fitBox(box: THREE.Box3, aspect: number, fill = 0.86) {
    const dir = new THREE.Vector3(0.62, 0.62, 1).normalize();
    const cam = this.camera;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    const target = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
    let dist = radius / Math.sin(THREE.MathUtils.degToRad(cam.fov) / 2);
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
      (i) =>
        new THREE.Vector3(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ),
    );
    const v = new THREE.Vector3();
    for (let iter = 0; iter < 4; iter++) {
      cam.position.copy(target).addScaledVector(dir, dist);
      cam.near = dist / 50;
      cam.far = dist * 6;
      cam.lookAt(target);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      let x0 = Infinity,
        x1 = -Infinity,
        y0 = Infinity,
        y1 = -Infinity;
      for (const c of corners) {
        v.copy(c).project(cam);
        x0 = Math.min(x0, v.x);
        x1 = Math.max(x1, v.x);
        y0 = Math.min(y0, v.y);
        y1 = Math.max(y1, v.y);
      }
      // 平移目标点，使投影中心回到画面中央
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * dist;
      target.addScaledVector(right, ((x0 + x1) / 2) * halfH * aspect);
      target.addScaledVector(up, ((y0 + y1) / 2) * halfH);
      const extent = Math.max((x1 - x0) / 2, (y1 - y0) / 2);
      dist *= extent / fill;
    }
    cam.position.copy(target).addScaledVector(dir, dist);
    cam.lookAt(target);
    cam.updateProjectionMatrix();
  }

  /** 以指定颜色渲染所有零件到一张图集 */
  async partAtlas(colorId: number, cell: number): Promise<PartAtlas> {
    const cols = 8;
    const rows = Math.ceil(PARTS.length / cols);
    const r = this.renderer;
    r.setPixelRatio(1);
    r.setSize(cols * cell, rows * cell, false);
    r.setScissorTest(true);
    r.clear();
    const index: Record<string, number> = {};
    this.mesh.visible = true;
    this.mesh.material = this.material(colorId);
    PARTS.forEach((p, i) => {
      index[p.id] = i;
      const g = getPartGeometry(p.id);
      this.mesh.geometry = g;
      this.mesh.position.set(0, 0, 0);
      this.fitBox(g.boundingBox!, 1, 0.84);
      const col = i % cols;
      const row = Math.floor(i / cols);
      const y = (rows - 1 - row) * cell;
      r.setViewport(col * cell, y, cell, cell);
      r.setScissor(col * cell, y, cell, cell);
      r.render(this.scene, this.camera);
    });
    r.setScissorTest(false);
    const blob = await new Promise<Blob | null>((res) => r.domElement.toBlob(res, 'image/png'));
    if (this.lastUrl) URL.revokeObjectURL(this.lastUrl);
    this.lastUrl = blob ? URL.createObjectURL(blob) : r.domElement.toDataURL();
    return { url: this.lastUrl, cols, cell, index };
  }

  /** 渲染一组积木的预览图（用于示例作品卡片）；按「零件×颜色」实例化，上千块也很快 */
  modelImage(bricks: BrickData[], width: number, height: number): string {
    const group = new THREE.Group();
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    const m = new THREE.Matrix4();
    const byKey = new Map<string, BrickData[]>();
    for (const b of bricks) {
      const k = `${b.part}|${b.color}`;
      const list = byKey.get(k);
      if (list) list.push(b);
      else byKey.set(k, [b]);
    }
    for (const list of byKey.values()) {
      const geo = getPartGeometry(list[0].part);
      const mesh = new THREE.InstancedMesh(geo, this.material(list[0].color), list.length);
      list.forEach((b, i) => {
        brickMatrix({ ...b, id: 0 }, m);
        mesh.setMatrixAt(i, m);
        box.union(tmp.copy(geo.boundingBox!).applyMatrix4(m));
      });
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    this.mesh.visible = false;
    this.scene.add(group);
    const r = this.renderer;
    r.setPixelRatio(1);
    r.setSize(width, height, false);
    r.setViewport(0, 0, width, height);
    r.clear();
    this.fitBox(box, width / height, 0.9);
    r.render(this.scene, this.camera);
    const url = r.domElement.toDataURL('image/png');
    this.scene.remove(group);
    for (const c of group.children) (c as THREE.InstancedMesh).dispose();
    this.mesh.visible = true;
    return url;
  }
}

let instance: Thumbnailer | null = null;

export function thumbnailer(): Thumbnailer {
  if (!instance) instance = new Thumbnailer();
  return instance;
}

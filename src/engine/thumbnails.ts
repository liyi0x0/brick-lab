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

  /** 把一个包围球放进视野：从右前上方 3/4 视角观察 */
  private frame(sphere: THREE.Sphere, aspect: number, margin = 1.12) {
    const dir = new THREE.Vector3(0.62, 0.62, 1).normalize();
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const f = aspect < 1 ? 2 * Math.atan(Math.tan(fov / 2) * aspect) : fov;
    const dist = (sphere.radius * margin) / Math.sin(f / 2);
    this.camera.aspect = aspect;
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.camera.near = dist / 50;
    this.camera.far = dist * 4;
    this.camera.lookAt(sphere.center);
    this.camera.updateProjectionMatrix();
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
      const sphere = g.boundingSphere!.clone();
      this.frame(sphere, 1, 1.02);
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

  /** 渲染一组积木的预览图（用于示例作品卡片） */
  modelImage(bricks: BrickData[], width: number, height: number): string {
    const group = new THREE.Group();
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    for (const b of bricks) {
      const mesh = new THREE.Mesh(getPartGeometry(b.part), this.material(b.color));
      brickMatrix({ ...b, id: 0 }, mesh.matrix);
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      box.union(tmp.copy(getPartGeometry(b.part).boundingBox!).applyMatrix4(mesh.matrix));
    }
    this.mesh.visible = false;
    this.scene.add(group);
    const r = this.renderer;
    r.setPixelRatio(1);
    r.setSize(width, height, false);
    r.setViewport(0, 0, width, height);
    r.clear();
    this.frame(box.getBoundingSphere(new THREE.Sphere()), width / height, 1.0);
    r.render(this.scene, this.camera);
    const url = r.domElement.toDataURL('image/png');
    this.scene.remove(group);
    this.mesh.visible = true;
    return url;
  }
}

let instance: Thumbnailer | null = null;

export function thumbnailer(): Thumbnailer {
  if (!instance) instance = new Thumbnailer();
  return instance;
}

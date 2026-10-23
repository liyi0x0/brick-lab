import * as THREE from 'three';
import type { Brick } from '../core/types';
import { brickMatrix } from './bricks';
import { getPartGeometry } from './geometry';

const vertexShader = /* glsl */ `
uniform vec3 uCenter;
uniform vec3 uSize;
uniform float uPixels;
uniform float uPxToWorld;
void main() {
  vec4 c = modelMatrix * instanceMatrix * vec4(uCenter, 1.0);
  // 按到相机的距离换算，使描边在屏幕上保持固定像素宽度
  float e = uPixels * uPxToWorld * length(cameraPosition - c.xyz);
  vec3 s = (uSize + 2.0 * e) / uSize;
  vec3 p = uCenter + (position - uCenter) * s;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  gl_FragColor = vec4(uColor, uOpacity);
}
`;

interface Entry {
  mesh: THREE.InstancedMesh;
  material: THREE.ShaderMaterial;
  capacity: number;
}

/**
 * 选中积木的轮廓描边：反向外壳法（只画背面），沿各轴等量外扩，
 * 外扩量随距离缩放以保持恒定像素宽度。每种零件一个实例化网格。
 */
export class SelectionOutline {
  readonly group = new THREE.Group();
  private entries = new Map<string, Entry>();
  private color = new THREE.Color(0x2f6bff);
  private pxToWorld = 0.001;
  private m = new THREE.Matrix4();

  constructor(private pixels = 2.6) {
    this.group.name = 'outline';
  }

  setColor(hex: string) {
    this.color.set(hex);
    for (const e of this.entries.values()) e.material.uniforms.uColor.value.copy(this.color);
  }

  /** 根据相机视角与画布高度计算「每像素对应的世界长度 / 距离」 */
  setProjection(fovDeg: number, heightPx: number) {
    this.pxToWorld = (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2)) / Math.max(1, heightPx);
    for (const e of this.entries.values()) e.material.uniforms.uPxToWorld.value = this.pxToWorld;
  }

  private entry(partId: string, count: number): Entry {
    let e = this.entries.get(partId);
    if (e && e.capacity >= count) return e;
    if (e) {
      this.group.remove(e.mesh);
      e.mesh.dispose();
    }
    const geo = getPartGeometry(partId);
    const box = geo.boundingBox!;
    const material =
      e?.material ??
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uCenter: { value: box.getCenter(new THREE.Vector3()) },
          uSize: { value: box.getSize(new THREE.Vector3()) },
          uPixels: { value: this.pixels },
          uPxToWorld: { value: this.pxToWorld },
          uColor: { value: this.color.clone() },
          uOpacity: { value: 1 },
        },
      });
    material.toneMapped = false;
    const capacity = Math.max(8, count * 2);
    const mesh = new THREE.InstancedMesh(geo, material, capacity);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    mesh.count = 0;
    this.group.add(mesh);
    e = { mesh, material, capacity };
    this.entries.set(partId, e);
    return e;
  }

  update(bricks: Brick[]) {
    const byPart = new Map<string, Brick[]>();
    for (const b of bricks) {
      const list = byPart.get(b.part);
      if (list) list.push(b);
      else byPart.set(b.part, [b]);
    }
    for (const [partId, e] of this.entries) if (!byPart.has(partId)) e.mesh.count = 0;
    for (const [partId, list] of byPart) {
      const e = this.entry(partId, list.length);
      list.forEach((b, i) => e.mesh.setMatrixAt(i, brickMatrix(b, this.m)));
      e.mesh.count = list.length;
      e.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

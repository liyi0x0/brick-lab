import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

/** 选区包围盒：八个角上的折角线（像设计软件那样），始终绘制在最上层 */
export class SelectionBox {
  readonly object: LineSegments2;
  private material: LineMaterial;

  constructor() {
    this.material = new LineMaterial({
      color: 0x2f6bff,
      linewidth: 2.5,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });
    this.material.toneMapped = false;
    this.object = new LineSegments2(new LineSegmentsGeometry(), this.material);
    this.object.renderOrder = 30;
    this.object.visible = false;
    this.object.frustumCulled = false;
  }

  setResolution(w: number, h: number) {
    this.material.resolution.set(w, h);
  }

  setColor(hex: string) {
    this.material.color.set(hex);
  }

  update(box: THREE.Box3 | null) {
    if (!box || box.isEmpty()) {
      this.object.visible = false;
      return;
    }
    const { min, max } = box;
    const size = box.getSize(new THREE.Vector3());
    const L = (len: number) => Math.min(len * 0.28, 0.9);
    const lx = L(size.x),
      ly = L(size.y),
      lz = L(size.z);
    const pos: number[] = [];
    for (const x of [min.x, max.x])
      for (const y of [min.y, max.y])
        for (const z of [min.z, max.z]) {
          const sx = x === min.x ? 1 : -1;
          const sy = y === min.y ? 1 : -1;
          const sz = z === min.z ? 1 : -1;
          pos.push(x, y, z, x + sx * lx, y, z);
          pos.push(x, y, z, x, y + sy * ly, z);
          pos.push(x, y, z, x, y, z + sz * lz);
        }
    this.object.geometry.setPositions(pos);
    this.object.visible = true;
  }
}

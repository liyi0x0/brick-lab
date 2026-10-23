import * as THREE from 'three';
import { getColor } from '../core/colors';
import { BASEPLATE_THICKNESS, GAP } from '../core/constants';
import { createSlabGeometry, createStudGeometry } from './geometry';

/** 底板：圆角薄板 + 实例化凸点 + 接收阴影的地面 */
export class Baseplate {
  readonly group = new THREE.Group();
  private material = new THREE.MeshPhysicalMaterial({
    roughness: 0.46,
    clearcoat: 0.12,
    clearcoatRoughness: 0.35,
    specularIntensity: 0.45,
  });
  private studGeometry = createStudGeometry(14);
  private slab: THREE.Mesh | null = null;
  private studs: THREE.InstancedMesh | null = null;
  readonly ground: THREE.Mesh;
  size = 0;

  constructor(size: number, colorId: number) {
    this.group.name = 'baseplate';
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.16, depthWrite: false });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -BASEPLATE_THICKNESS - 0.002;
    this.ground.receiveShadow = true;
    this.group.add(this.ground);
    this.setSize(size);
    this.setColor(colorId);
  }

  setSize(size: number) {
    if (size === this.size) return;
    this.size = size;
    if (this.slab) {
      this.group.remove(this.slab);
      this.slab.geometry.dispose();
    }
    if (this.studs) {
      this.group.remove(this.studs);
      this.studs.dispose();
    }
    const slab = new THREE.Mesh(
      createSlabGeometry(size - GAP * 2, BASEPLATE_THICKNESS, size - GAP * 2, 0.05),
      this.material,
    );
    slab.position.y = -BASEPLATE_THICKNESS;
    slab.receiveShadow = true;
    slab.castShadow = true;
    this.slab = slab;
    this.group.add(slab);

    const studs = new THREE.InstancedMesh(this.studGeometry, this.material, size * size);
    const m = new THREE.Matrix4();
    let i = 0;
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        m.makeTranslation(x + 0.5 - size / 2, 0, z + 0.5 - size / 2);
        studs.setMatrixAt(i++, m);
      }
    }
    studs.receiveShadow = true;
    studs.castShadow = true;
    studs.computeBoundingSphere();
    this.studs = studs;
    this.group.add(studs);

    const g = Math.max(400, size * 8);
    this.ground.scale.set(g, g, 1);
  }

  setColor(colorId: number) {
    this.material.color.set(getColor(colorId).hex);
  }

  get half() {
    return this.size / 2;
  }
}

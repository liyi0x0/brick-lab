import * as THREE from 'three';
import { getColor } from '../core/colors';
import { PLATE_H } from '../core/constants';
import type { Brick, BrickData } from '../core/types';
import { brickMatrix } from './bricks';
import { getPartGeometry } from './geometry';

const INVALID = '#ff3b30';

/** 放置预览：半透明的「幽灵」积木，单块或成组 */
export class Ghost {
  readonly group = new THREE.Group();
  private single: THREE.Mesh;
  private multi = new THREE.Group();
  private mats = new Map<string, THREE.MeshStandardMaterial>();
  private multiKey = '';
  private multiValid = true;
  private pulse = 0;

  constructor() {
    this.group.name = 'ghost';
    this.single = new THREE.Mesh(undefined, this.material(15, true));
    this.single.visible = false;
    this.single.renderOrder = 10;
    this.multi.visible = false;
    this.group.add(this.single, this.multi);
  }

  private material(colorId: number, valid: boolean): THREE.MeshStandardMaterial {
    const key = valid ? `${colorId}` : 'invalid';
    let m = this.mats.get(key);
    if (!m) {
      const c = getColor(colorId);
      const hex = valid ? c.hex : INVALID;
      m = new THREE.MeshStandardMaterial({
        color: hex,
        emissive: hex,
        emissiveIntensity: valid ? 0.22 : 0.5,
        roughness: 0.35,
        transparent: true,
        opacity: valid ? (c.kind === 'trans' ? 0.38 : 0.62) : 0.5,
        depthWrite: false,
      });
      m.userData.baseOpacity = m.opacity;
      this.mats.set(key, m);
    }
    return m;
  }

  get visible() {
    return this.single.visible || this.multi.visible;
  }

  showSingle(b: BrickData, valid: boolean) {
    this.multi.visible = false;
    const m = this.single;
    m.geometry = getPartGeometry(b.part);
    m.material = this.material(b.color, valid);
    brickMatrix(b as Brick, m.matrix);
    m.matrixAutoUpdate = false;
    m.matrixWorldNeedsUpdate = true;
    m.visible = true;
  }

  /** 设置成组预览的内容（坐标为原始位置），随后用 moveGroup 偏移 */
  setGroup(bricks: BrickData[], key: string) {
    if (key === this.multiKey) return;
    this.multiKey = key;
    this.multi.clear();
    for (const b of bricks) {
      const mesh = new THREE.Mesh(getPartGeometry(b.part), this.material(b.color, true));
      mesh.userData.color = b.color;
      brickMatrix(b as Brick, mesh.matrix);
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 10;
      this.multi.add(mesh);
    }
    this.multiValid = true;
  }

  showGroup(dx: number, dy: number, dz: number, valid: boolean) {
    this.single.visible = false;
    this.multi.position.set(dx, dy * PLATE_H, dz);
    if (valid !== this.multiValid) {
      this.multiValid = valid;
      for (const c of this.multi.children as THREE.Mesh[]) c.material = this.material(c.userData.color, valid);
    }
    this.multi.visible = true;
  }

  hide() {
    this.single.visible = false;
    this.multi.visible = false;
  }

  clearGroup() {
    this.multi.clear();
    this.multiKey = '';
    this.multi.visible = false;
  }

  /** 呼吸效果 */
  update(dt: number) {
    if (!this.visible) return;
    this.pulse += dt;
    const k = 0.82 + 0.18 * Math.sin(this.pulse * 4.2);
    for (const m of this.mats.values()) m.opacity = m.userData.baseOpacity * k;
  }
}

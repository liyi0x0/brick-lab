import * as THREE from 'three';
import type { Brick } from '../core/types';
import { brickMatrix, type BrickRenderer } from './bricks';
import { getPartGeometry } from './geometry';
import { plainMaterial } from './materials';

interface DropAnim {
  start: number;
  dur: number;
  height: number;
}

interface VanishAnim {
  mesh: THREE.Mesh;
  start: number;
  dur: number;
  base: THREE.Matrix4;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** 积木的落下 / 消失动画 */
export class Animator {
  readonly group = new THREE.Group();
  private drops = new Map<number, DropAnim>();
  private vanishes: VanishAnim[] = [];
  private m = new THREE.Matrix4();

  constructor(private bricks: BrickRenderer) {
    this.group.name = 'fx';
  }

  get active() {
    return this.drops.size > 0 || this.vanishes.length > 0;
  }

  /** 从上方落下并轻微压扁回弹 */
  drop(id: number, now: number, delay = 0, height = 0.9, dur = 240) {
    this.drops.set(id, { start: now + delay, dur, height });
    const b = this.bricks.getBrick(id);
    if (b) this.bricks.setMatrix(id, brickMatrix(b, this.m, height, 0.001));
  }

  /** 被删除的积木：缩小、上浮、淡出 */
  vanish(b: Brick, now: number) {
    const src = plainMaterial(b.color);
    const mat = src.clone();
    mat.transparent = true;
    mat.depthWrite = false;
    const mesh = new THREE.Mesh(getPartGeometry(b.part), mat);
    const base = brickMatrix(b, new THREE.Matrix4());
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(base);
    this.group.add(mesh);
    this.vanishes.push({ mesh, start: now, dur: 200, base });
  }

  cancel(id: number) {
    if (this.drops.delete(id)) this.bricks.resetMatrix(id);
  }

  update(now: number) {
    for (const [id, a] of this.drops) {
      const b = this.bricks.getBrick(id);
      if (!b) {
        this.drops.delete(id);
        continue;
      }
      const t = (now - a.start) / a.dur;
      if (t < 0) continue;
      if (t >= 1) {
        this.drops.delete(id);
        this.bricks.resetMatrix(id);
        continue;
      }
      const fall = 1 - easeOutCubic(Math.min(1, t / 0.72));
      const land = t > 0.72 ? Math.sin(((t - 0.72) / 0.28) * Math.PI) : 0;
      const scale = 1 + land * 0.02;
      this.bricks.setMatrix(id, brickMatrix(b, this.m, fall * a.height, scale, 1 - land * 0.07));
    }
    for (let i = this.vanishes.length - 1; i >= 0; i--) {
      const v = this.vanishes[i];
      const t = Math.min(1, (now - v.start) / v.dur);
      const s = 1 - 0.35 * easeOutCubic(t);
      const mat = v.mesh.material as THREE.MeshPhysicalMaterial;
      mat.opacity = (1 - t) * (mat.userData.base ?? (mat.userData.base = mat.opacity));
      const center = new THREE.Vector3().setFromMatrixPosition(v.base);
      v.mesh.matrix
        .copy(v.base)
        .premultiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z))
        .premultiply(new THREE.Matrix4().makeScale(s, s, s))
        .premultiply(new THREE.Matrix4().makeTranslation(center.x, center.y + t * 0.3, center.z));
      if (t >= 1) {
        this.group.remove(v.mesh);
        mat.dispose();
        this.vanishes.splice(i, 1);
      }
    }
  }
}

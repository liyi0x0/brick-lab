import * as THREE from 'three';
import { getColor, type ColorKind } from '../core/colors';
import { PLATE_H } from '../core/constants';
import { getPart, rotatedSize } from '../core/parts';
import type { Brick } from '../core/types';
import { getPartGeometry } from './geometry';
import type { BrickMaterials } from './materials';

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const tmpColor = new THREE.Color();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3(1, 1, 1);
const Y = new THREE.Vector3(0, 1, 0);

/** 积木的世界变换矩阵（可附加偏移与缩放，用于动画） */
export function brickMatrix(b: Brick, out = new THREE.Matrix4(), dy = 0, scale = 1, sy = 1): THREE.Matrix4 {
  const part = getPart(b.part);
  const [fw, fd] = rotatedSize(part, b.rot);
  tmpP.set(b.x + fw / 2, b.y * PLATE_H + dy, b.z + fd / 2);
  tmpQ.setFromAxisAngle(Y, (b.rot * Math.PI) / 2);
  tmpS.set(scale, scale * sy, scale);
  return out.compose(tmpP, tmpQ, tmpS);
}

/** 同一零件 + 同一材质类型的所有积木，合并为一个 InstancedMesh */
class Batch {
  mesh: THREE.InstancedMesh;
  readonly geometry: THREE.BufferGeometry;
  ids: number[] = [];
  private tint: THREE.InstancedBufferAttribute;
  private capacity: number;

  constructor(
    base: THREE.BufferGeometry,
    private material: THREE.Material,
    private kind: ColorKind,
    private parent: THREE.Object3D,
    capacity = 32,
  ) {
    this.capacity = capacity;
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setIndex(base.index);
    for (const [name, attr] of Object.entries(base.attributes)) this.geometry.setAttribute(name, attr);
    this.geometry.boundingBox = base.boundingBox;
    this.geometry.boundingSphere = base.boundingSphere;
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.tint.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aTint', this.tint);
    this.mesh = this.createMesh(capacity);
    parent.add(this.mesh);
  }

  private createMesh(capacity: number) {
    const m = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = this.kind !== 'trans';
    m.receiveShadow = true;
    m.setColorAt(0, tmpColor.set(0xffffff));
    m.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    return m;
  }

  get count() {
    return this.ids.length;
  }

  private grow() {
    const cap = this.capacity * 2;
    const old = this.mesh;
    const next = this.createMesh(cap);
    next.instanceMatrix.array.set(old.instanceMatrix.array);
    next.instanceColor!.array.set(old.instanceColor!.array);
    next.count = old.count;
    const tint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    tint.setUsage(THREE.DynamicDrawUsage);
    tint.array.set(this.tint.array);
    this.tint = tint;
    this.geometry.setAttribute('aTint', tint);
    this.parent.remove(old);
    old.dispose();
    this.parent.add(next);
    this.mesh = next;
    this.capacity = cap;
  }

  add(id: number, matrix: THREE.Matrix4, color: THREE.Color, tint?: readonly number[]): number {
    if (this.ids.length >= this.capacity) this.grow();
    const i = this.ids.length;
    this.ids.push(id);
    this.mesh.count = this.ids.length;
    this.mesh.setMatrixAt(i, matrix);
    this.mesh.setColorAt(i, color);
    this.setTint(i, tint);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    return i;
  }

  /** 交换删除，返回被移动到 index 位置的积木 id（若有） */
  removeAt(index: number): number | null {
    const last = this.ids.length - 1;
    let moved: number | null = null;
    if (index !== last) {
      const m = new THREE.Matrix4();
      this.mesh.getMatrixAt(last, m);
      this.mesh.setMatrixAt(index, m);
      this.mesh.getColorAt(last, tmpColor);
      this.mesh.setColorAt(index, tmpColor);
      const t = this.tint.array as Float32Array;
      t.copyWithin(index * 4, last * 4, last * 4 + 4);
      moved = this.ids[last];
      this.ids[index] = moved;
    }
    this.ids.pop();
    this.mesh.count = this.ids.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    this.tint.needsUpdate = true;
    return moved;
  }

  setMatrix(i: number, m: THREE.Matrix4) {
    this.mesh.setMatrixAt(i, m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setColor(i: number, c: THREE.Color) {
    this.mesh.setColorAt(i, c);
    this.mesh.instanceColor!.needsUpdate = true;
  }

  setTint(i: number, tint?: readonly number[] | null) {
    const t = this.tint.array as Float32Array;
    if (tint) {
      t[i * 4] = tint[0];
      t[i * 4 + 1] = tint[1];
      t[i * 4 + 2] = tint[2];
      t[i * 4 + 3] = tint[3];
    } else {
      t.fill(0, i * 4, i * 4 + 4);
    }
    this.tint.needsUpdate = true;
  }

  dispose() {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
  }
}

interface Slot {
  batch: Batch;
  index: number;
  brick: Brick;
  hidden: boolean;
}

/**
 * 积木渲染管理：按「零件 × 材质类型」分批实例化，几千块积木也只需几十次绘制调用。
 */
export class BrickRenderer {
  readonly group = new THREE.Group();
  private batches = new Map<string, Batch>();
  private slots = new Map<number, Slot>();
  private tints = new Map<number, readonly number[]>();
  private tmpM = new THREE.Matrix4();

  constructor(private materials: BrickMaterials) {
    this.group.name = 'bricks';
  }

  has(id: number) {
    return this.slots.has(id);
  }

  getBrick(id: number) {
    return this.slots.get(id)?.brick;
  }

  private batchFor(partId: string, kind: ColorKind): Batch {
    const key = `${partId}|${kind}`;
    let b = this.batches.get(key);
    if (!b) {
      b = new Batch(getPartGeometry(partId), this.materials.get(kind), kind, this.group);
      this.batches.set(key, b);
    }
    return b;
  }

  add(brick: Brick) {
    if (this.slots.has(brick.id)) this.remove(brick.id);
    const c = getColor(brick.color);
    const batch = this.batchFor(brick.part, c.kind);
    tmpColor.set(c.hex);
    const index = batch.add(brick.id, brickMatrix(brick, this.tmpM), tmpColor, this.tints.get(brick.id));
    this.slots.set(brick.id, { batch, index, brick: { ...brick }, hidden: false });
  }

  remove(id: number) {
    const s = this.slots.get(id);
    if (!s) return;
    const moved = s.batch.removeAt(s.index);
    if (moved !== null) this.slots.get(moved)!.index = s.index;
    this.slots.delete(id);
  }

  clear() {
    for (const b of this.batches.values()) b.dispose();
    this.batches.clear();
    this.slots.clear();
    this.tints.clear();
  }

  /** 覆盖实例矩阵（动画用） */
  setMatrix(id: number, m: THREE.Matrix4) {
    const s = this.slots.get(id);
    if (!s || s.hidden) return;
    s.batch.setMatrix(s.index, m);
  }

  /** 恢复为积木本身的矩阵 */
  resetMatrix(id: number) {
    const s = this.slots.get(id);
    if (!s) return;
    s.batch.setMatrix(s.index, s.hidden ? ZERO : brickMatrix(s.brick, this.tmpM));
  }

  setHidden(id: number, hidden: boolean) {
    const s = this.slots.get(id);
    if (!s || s.hidden === hidden) return;
    s.hidden = hidden;
    s.batch.setMatrix(s.index, hidden ? ZERO : brickMatrix(s.brick, this.tmpM));
  }

  /** 临时显示另一种颜色（上色预览），传 null 恢复 */
  previewColor(id: number, colorId: number | null) {
    const s = this.slots.get(id);
    if (!s) return;
    const c = getColor(colorId ?? s.brick.color);
    // 跨材质类型（如实色→透明）时只预览色相
    s.batch.setColor(s.index, tmpColor.set(c.hex));
  }

  setTint(id: number, tint: readonly number[] | null) {
    if (tint) this.tints.set(id, tint);
    else this.tints.delete(id);
    const s = this.slots.get(id);
    if (s) s.batch.setTint(s.index, tint);
  }

  clearTints() {
    for (const id of [...this.tints.keys()]) this.setTint(id, null);
  }

  /** 以差量方式应用整套高亮 */
  applyTints(next: Map<number, readonly number[]>) {
    for (const id of [...this.tints.keys()]) if (!next.has(id)) this.setTint(id, null);
    for (const [id, t] of next) if (this.tints.get(id) !== t) this.setTint(id, t);
  }

  /** 暂时移除所有高亮（截图用），返回之后用于恢复的快照 */
  suspendTints(): Map<number, readonly number[]> {
    const snap = new Map(this.tints);
    this.clearTints();
    return snap;
  }

  restoreTints(snap: Map<number, readonly number[]>) {
    this.applyTints(snap);
  }

  geometryBox(partId: string): THREE.Box3 | null {
    return getPartGeometry(partId).boundingBox;
  }

  get drawCalls() {
    let n = 0;
    for (const b of this.batches.values()) if (b.count > 0) n++;
    return n;
  }
}

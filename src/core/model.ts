import { OccupancyGrid } from './grid';
import { brickVoxels, findPart } from './parts';
import type { Brick, BrickData } from './types';

/** 一次变更：先移除 remove 中的积木，再加入 add 中的积木（同 id 即为更新） */
export interface Patch {
  add: Brick[];
  remove: Brick[];
}

export type ChangeReason =
  | 'place'
  | 'erase'
  | 'paint'
  | 'move'
  | 'rotate'
  | 'paste'
  | 'undo'
  | 'redo'
  | 'load'
  | 'clear';

export type ModelEvent =
  | { type: 'patch'; patch: Patch; reason: ChangeReason }
  | { type: 'reset'; reason: ChangeReason };

interface HistoryEntry {
  patch: Patch;
  reason: ChangeReason;
}

const HISTORY_LIMIT = 500;

export function invertPatch(p: Patch): Patch {
  return { add: p.remove, remove: p.add };
}

/**
 * 作品模型：积木集合 + 体素占位 + 撤销/重做历史。
 * 纯 TypeScript，不依赖渲染层，方便测试。
 */
export class Model {
  readonly bricks = new Map<number, Brick>();
  readonly grid = new OccupancyGrid();
  version = 0;
  private nextId = 1;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<(e: ModelEvent) => void>();

  subscribe(fn: (e: ModelEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: ModelEvent) {
    this.version++;
    for (const fn of this.listeners) fn(e);
  }

  get count() {
    return this.bricks.size;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  newId(): number {
    return this.nextId++;
  }

  get(id: number): Brick | undefined {
    return this.bricks.get(id);
  }

  /** 按搭建顺序（id 递增）返回所有积木 */
  list(): Brick[] {
    return [...this.bricks.values()].sort((a, b) => a.id - b.id);
  }

  /** 检查积木能否放在当前位置（ignore 中的积木视为不存在） */
  canPlace(b: Pick<Brick, 'part' | 'x' | 'y' | 'z' | 'rot'>, ignore?: ReadonlySet<number>): boolean {
    if (!findPart(b.part)) return false;
    return !this.grid.collides(brickVoxels(b), ignore);
  }

  /** 检查一个补丁能否无冲突地应用 */
  validate(patch: Patch): boolean {
    const ignore = new Set(patch.remove.map((b) => b.id));
    const claimed = new Map<string, number>();
    for (const b of patch.add) {
      if (!findPart(b.part)) return false;
      for (const [x, y, z] of brickVoxels(b)) {
        if (this.grid.collides([[x, y, z]], ignore)) return false;
        const k = `${x},${y},${z}`;
        if (claimed.has(k)) return false;
        claimed.set(k, b.id);
      }
    }
    return true;
  }

  private apply(patch: Patch) {
    for (const r of patch.remove) {
      const cur = this.bricks.get(r.id);
      if (!cur) continue;
      this.grid.remove(cur);
      this.bricks.delete(r.id);
    }
    for (const a of patch.add) {
      const b = { ...a };
      this.bricks.set(b.id, b);
      this.grid.add(b);
      if (b.id >= this.nextId) this.nextId = b.id + 1;
    }
  }

  /** 应用并记录到历史；若冲突则拒绝并返回 false */
  commit(patch: Patch, reason: ChangeReason): boolean {
    if (patch.add.length === 0 && patch.remove.length === 0) return false;
    if (!this.validate(patch)) return false;
    // 记录被移除积木的真实状态，保证撤销准确
    const recorded: Patch = {
      add: patch.add.map((b) => ({ ...b })),
      remove: patch.remove.map((b) => ({ ...(this.bricks.get(b.id) ?? b) })),
    };
    this.apply(recorded);
    this.undoStack.push({ patch: recorded, reason });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit({ type: 'patch', patch: recorded, reason });
    return true;
  }

  /** 新增积木（自动分配 id） */
  addBricks(data: BrickData[], reason: ChangeReason = 'place'): Brick[] | null {
    const add = data.map((d) => ({ ...d, id: this.newId() }));
    return this.commit({ add, remove: [] }, reason) ? add : null;
  }

  removeBricks(ids: Iterable<number>, reason: ChangeReason = 'erase'): boolean {
    const remove: Brick[] = [];
    for (const id of ids) {
      const b = this.bricks.get(id);
      if (b) remove.push(b);
    }
    return this.commit({ add: [], remove }, reason);
  }

  /** 原地更新若干积木（颜色、位置、朝向） */
  updateBricks(next: Brick[], reason: ChangeReason): boolean {
    const remove: Brick[] = [];
    const add: Brick[] = [];
    for (const n of next) {
      const cur = this.bricks.get(n.id);
      if (!cur) continue;
      if (
        cur.part === n.part &&
        cur.color === n.color &&
        cur.x === n.x &&
        cur.y === n.y &&
        cur.z === n.z &&
        cur.rot === n.rot
      )
        continue;
      remove.push(cur);
      add.push({ ...n });
    }
    return this.commit({ add, remove }, reason);
  }

  undo(): boolean {
    const e = this.undoStack.pop();
    if (!e) return false;
    const inv = invertPatch(e.patch);
    this.apply(inv);
    this.redoStack.push(e);
    this.emit({ type: 'patch', patch: inv, reason: 'undo' });
    return true;
  }

  redo(): boolean {
    const e = this.redoStack.pop();
    if (!e) return false;
    this.apply(e.patch);
    this.undoStack.push(e);
    this.emit({ type: 'patch', patch: e.patch, reason: 'redo' });
    return true;
  }

  /** 整体替换（打开文件、新建作品）。会清空历史。冲突的积木会被丢弃。 */
  load(data: (BrickData | Brick)[], reason: ChangeReason = 'load'): { loaded: number; skipped: number } {
    this.bricks.clear();
    this.grid.clear();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.nextId = 1;
    let skipped = 0;
    for (const d of data) {
      if (!findPart(d.part)) {
        skipped++;
        continue;
      }
      const b: Brick = { ...d, id: this.nextId++ };
      if (!this.canPlace(b)) {
        skipped++;
        continue;
      }
      this.bricks.set(b.id, b);
      this.grid.add(b);
    }
    this.emit({ type: 'reset', reason });
    return { loaded: this.bricks.size, skipped };
  }

  /** 清空作品（可撤销） */
  clearAll(): boolean {
    return this.commit({ add: [], remove: [...this.bricks.values()] }, 'clear');
  }
}

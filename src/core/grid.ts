import { GRID_LIMIT, MAX_LEVEL } from './constants';
import { brickVoxels } from './parts';
import type { Brick } from './types';

const SPAN = GRID_LIMIT * 2 + 1;
const YSPAN = MAX_LEVEL + 64;

/** 把体素坐标打包成一个整数键（在 2^53 内精确） */
export function voxelKey(x: number, y: number, z: number): number {
  return ((x + GRID_LIMIT) * SPAN + (z + GRID_LIMIT)) * YSPAN + y;
}

export interface Bounds {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

/**
 * 体素占位表：记录每个体素被哪块积木占据，用于碰撞检测与射线拾取。
 */
export class OccupancyGrid {
  private cells = new Map<number, number>();
  /** 只增不减的包围盒（用于加速拾取），reset 时重算 */
  bounds: Bounds | null = null;

  clear() {
    this.cells.clear();
    this.bounds = null;
  }

  get size() {
    return this.cells.size;
  }

  add(b: Brick) {
    for (const [x, y, z] of brickVoxels(b)) {
      this.cells.set(voxelKey(x, y, z), b.id);
      this.expand(x, y, z);
    }
  }

  remove(b: Brick) {
    for (const [x, y, z] of brickVoxels(b)) {
      const k = voxelKey(x, y, z);
      if (this.cells.get(k) === b.id) this.cells.delete(k);
    }
  }

  get(x: number, y: number, z: number): number | undefined {
    return this.cells.get(voxelKey(x, y, z));
  }

  /** 检查体素集合是否与已有积木冲突（ignore 中的积木视为不存在） */
  collides(voxels: Iterable<[number, number, number]>, ignore?: ReadonlySet<number>): boolean {
    for (const [x, y, z] of voxels) {
      if (y < 0) return true;
      if (Math.abs(x) >= GRID_LIMIT || Math.abs(z) >= GRID_LIMIT || y >= MAX_LEVEL) return true;
      const id = this.cells.get(voxelKey(x, y, z));
      if (id !== undefined && !(ignore && ignore.has(id))) return true;
    }
    return false;
  }

  /** 与某块积木冲突的所有积木 id */
  collisionsOf(b: Pick<Brick, 'part' | 'x' | 'y' | 'z' | 'rot'>, ignore?: ReadonlySet<number>): Set<number> {
    const out = new Set<number>();
    for (const [x, y, z] of brickVoxels(b)) {
      const id = this.cells.get(voxelKey(x, y, z));
      if (id !== undefined && !(ignore && ignore.has(id))) out.add(id);
    }
    return out;
  }

  private expand(x: number, y: number, z: number) {
    const b = this.bounds;
    if (!b) {
      this.bounds = { x0: x, y0: y, z0: z, x1: x + 1, y1: y + 1, z1: z + 1 };
      return;
    }
    if (x < b.x0) b.x0 = x;
    if (y < b.y0) b.y0 = y;
    if (z < b.z0) b.z0 = z;
    if (x + 1 > b.x1) b.x1 = x + 1;
    if (y + 1 > b.y1) b.y1 = y + 1;
    if (z + 1 > b.z1) b.z1 = z + 1;
  }
}

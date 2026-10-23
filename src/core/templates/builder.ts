import { brickVoxels, getPart, rotateCell, topStudCells } from '../parts';
import type { BrickData, Rot } from '../types';

/** 难度：1 入门 · 2 进阶 · 3 挑战（大型作品） */
export type TemplateLevel = 1 | 2 | 3;

/** 示例作品：欢迎页与「示例作品」菜单中使用 */
export interface Template {
  id: string;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  level: TemplateLevel;
  /** 底板尺寸，取 16 / 24 / 32 / 48 / 64 */
  baseplateSize: number;
  /** 底板颜色（LDraw 颜色代码） */
  baseplateColor: number;
  build: () => BrickData[];
}

// 常用颜色（LDraw 颜色代码）
export const C = {
  white: 15,
  lightGray: 71,
  darkGray: 72,
  black: 0,
  red: 4,
  darkRed: 320,
  coral: 353,
  orange: 25,
  brightLightOrange: 191,
  yellow: 14,
  lime: 27,
  brightGreen: 10,
  green: 2,
  darkGreen: 288,
  azure: 322,
  brightLightBlue: 212,
  blue: 1,
  mediumLavender: 30,
  brightPink: 29,
  tan: 19,
  darkTan: 28,
  reddishBrown: 70,
  pearlGold: 297,
  transClear: 47,
  transRed: 36,
  transOrange: 57,
  transYellow: 46,
  transLightBlue: 43,
} as const;

/** 可复现的伪随机数（mulberry32），保证示例每次生成都一样 */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

/**
 * 按搭建顺序逐块添加积木，并即时校验：
 * 不得重叠、不得低于地面或超出底板，且每块都必须扣在底板或已有积木的凸点上。
 * allowHanging：允许暂时没有下方支撑的积木（真实积木可以挂在上方积木的底管上），
 * 此时最后用 assertConnected() 统一检查是否所有积木都经由凸点连到了地面。
 */
export class Builder {
  readonly bricks: BrickData[] = [];
  private occupied = new Set<string>();
  /** 凸点位置：key(x, 顶面所在层, z) → 提供该凸点的积木序号 */
  private studs = new Map<string, number>();
  /** 每块积木底面所在的格子：key(x, y, z) → 积木序号 */
  private bottoms = new Map<string, number>();

  constructor(
    private half: number,
    private opts: { allowHanging?: boolean } = {},
  ) {}

  /** (x, z) 列从 y 开始的 h 层是否都空着 */
  isFree(x: number, y: number, z: number, h = 1): boolean {
    for (let i = 0; i < h; i++) if (this.occupied.has(key(x, y + i, z))) return false;
    return true;
  }

  /** 某个格子是否已被占用 */
  has(x: number, y: number, z: number): boolean {
    return this.occupied.has(key(x, y, z));
  }

  add(part: string, color: number, x: number, y: number, z: number, rot: Rot = 0): this {
    const brick: BrickData = { part, color, x, y, z, rot };
    const voxels = brickVoxels(brick);
    const where = `${part} @ (${x}, ${y}, ${z}) rot ${rot}`;
    for (const [vx, vy, vz] of voxels) {
      if (vy < 0) throw new Error(`低于地面：${where}`);
      if (vx < -this.half || vx >= this.half || vz < -this.half || vz >= this.half) {
        throw new Error(`超出底板：${where}`);
      }
      if (this.occupied.has(key(vx, vy, vz))) throw new Error(`与已有积木重叠：${where}`);
    }
    const supported = y === 0 || voxels.some(([vx, vy, vz]) => vy === y && this.studs.has(key(vx, y, vz)));
    if (!supported && !this.opts.allowHanging) throw new Error(`悬空（没有扣在任何凸点上）：${where}`);
    const index = this.bricks.length;
    for (const [vx, vy, vz] of voxels) {
      this.occupied.add(key(vx, vy, vz));
      if (vy === y) this.bottoms.set(key(vx, vy, vz), index);
    }
    const p = getPart(part);
    for (const [lx, lz] of topStudCells(p)) {
      const [rx, rz] = rotateCell(lx, lz, p.w, p.d, rot);
      this.studs.set(key(x + rx, y + p.h, z + rz), index);
    }
    this.bricks.push(brick);
    return this;
  }

  /**
   * 检查所有积木都经由凸点（向上或向下的咬合）连到地面，否则抛出异常。
   * 不扣凸点的接触（例如压在平滑板上、侧面贴靠）不算连接。
   */
  assertConnected(): this {
    const n = this.bricks.length;
    const adj: number[][] = Array.from({ length: n }, () => []);
    for (const [k, owner] of this.studs) {
      const above = this.bottoms.get(k);
      if (above !== undefined && above !== owner) {
        adj[owner].push(above);
        adj[above].push(owner);
      }
    }
    const seen = new Uint8Array(n);
    const queue: number[] = [];
    this.bricks.forEach((b, i) => {
      if (b.y === 0) {
        seen[i] = 1;
        queue.push(i);
      }
    });
    while (queue.length) {
      const i = queue.pop()!;
      for (const j of adj[i]) {
        if (!seen[j]) {
          seen[j] = 1;
          queue.push(j);
        }
      }
    }
    const loose = this.bricks.filter((_, i) => !seen[i]);
    if (loose.length) {
      const b = loose[0];
      throw new Error(`有 ${loose.length} 块积木没有连到地面，例如 ${b.part} @ (${b.x}, ${b.y}, ${b.z})`);
    }
    return this;
  }
}

/** 把长度 n 拆成不超过 4 的几段；offset 时先放一段 2，让上下层接缝错开 */
export function splitRun(n: number, offset: boolean): number[] {
  const out: number[] = [];
  let rem = n;
  if (offset && rem > 2) {
    out.push(2);
    rem -= 2;
  }
  while (rem > 0) {
    const piece = rem >= 6 ? 4 : rem === 5 ? 3 : rem;
    out.push(piece);
    rem -= piece;
  }
  return out;
}

/** 把一串（可不连续的）格子位置分成连续段 */
export function runs(positions: number[]): [number, number][] {
  const out: [number, number][] = [];
  const sorted = [...positions].sort((a, b) => a - b);
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && last[1] === p) last[1] = p + 1;
    else out.push([p, p + 1]);
  }
  return out;
}

/** 沿 x 或 z 方向，用 1×N 砖填满给定格子（同一行 / 列） */
export function placeLine(
  b: Builder,
  positions: number[],
  fixed: number,
  y: number,
  dir: 'x' | 'z',
  offset: boolean,
  color: () => number,
) {
  for (const [s, e] of runs(positions)) {
    let p = s;
    for (const len of splitRun(e - s, offset)) {
      const part = `brick-1x${len}`;
      if (dir === 'x') b.add(part, color(), p, y, fixed, 0);
      else b.add(part, color(), fixed, y, p, 1);
      p += len;
    }
  }
}

/**
 * 一圈 1 格厚的墙（一层砖高）。偶数层由前后墙占用四角、奇数层由左右墙占用，
 * 使转角相互咬合；open 返回 true 的格子留空，已被占用的格子自动跳过。
 */
export function wallRing(
  b: Builder,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  layer: number,
  color: () => number,
  open: (x: number, z: number) => boolean = () => false,
) {
  const rowsOwnCorners = layer % 2 === 0;
  const offset = layer % 2 === 1;
  const free = (x: number, z: number) => !open(x, z) && b.isFree(x, y, z, 3);
  for (const z of [z0, z1 - 1]) {
    const xs: number[] = [];
    for (let x = rowsOwnCorners ? x0 : x0 + 1; x < (rowsOwnCorners ? x1 : x1 - 1); x++) if (free(x, z)) xs.push(x);
    placeLine(b, xs, z, y, 'x', offset, color);
  }
  for (const x of [x0, x1 - 1]) {
    const zs: number[] = [];
    for (let z = rowsOwnCorners ? z0 + 1 : z0; z < (rowsOwnCorners ? z1 - 1 : z1); z++) if (free(x, z)) zs.push(z);
    placeLine(b, zs, x, y, 'z', offset, color);
  }
}

/** 用 2×N 砖填满一条 2 格宽的带：along='x' 时占 x∈[s,e)、z∈[c,c+2) */
export function band2(b: Builder, along: 'x' | 'z', s: number, e: number, c: number, y: number, color: number, offset: boolean) {
  let p = s;
  for (const len of splitRun(e - s, offset)) {
    const part = len === 1 ? 'brick-1x2' : `brick-2x${len}`;
    if (along === 'x') b.add(part, color, p, y, c, len === 1 ? 1 : 0);
    else b.add(part, color, c, y, p, len === 1 ? 0 : 1);
    p += len;
  }
}

/** 一层由 4 块转角砖拼成的 4×4「八角」圆盘，中心在格点 (cx, cz) */
export function octagon(b: Builder, cx: number, cz: number, y: number, color: number) {
  b.add('corner-brick-2x2', color, cx, y, cz, 0);
  b.add('corner-brick-2x2', color, cx, y, cz - 2, 1);
  b.add('corner-brick-2x2', color, cx - 2, y, cz - 2, 2);
  b.add('corner-brick-2x2', color, cx - 2, y, cz, 3);
}

/** 一棵圆润的小树，树干中心在格点 (cx, cz) */
export function tree(b: Builder, cx: number, cz: number) {
  b.add('round-brick-2x2', C.reddishBrown, cx - 1, 0, cz - 1);
  b.add('round-brick-2x2', C.reddishBrown, cx - 1, 3, cz - 1);
  octagon(b, cx, cz, 6, C.darkGreen);
  octagon(b, cx, cz, 9, C.green);
  b.add('round-brick-2x2', C.brightGreen, cx - 1, 12, cz - 1);
  b.add('round-plate-2x2', C.lime, cx - 1, 15, cz - 1);
}

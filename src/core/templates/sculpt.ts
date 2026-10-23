import { PLATE_H } from '../constants';
import { findPart } from '../parts';
import type { Builder } from './builder';

/** 形状函数：在体素中心 (x, y, z)（凸点单位）取样，返回颜色，或 null/undefined/false 表示空 */
export type ShapeFn = (x: number, y: number, z: number) => number | null | undefined | false;

// 可用尺寸 [短边, 长边]，按面积从大到小，同面积优先 2 格宽（更稳）
const PLATE_SIZES: [number, number][] = [
  [8, 8], [6, 8], [6, 6], [4, 8], [4, 6], [4, 4], [2, 8], [2, 6], [2, 4], [1, 8], [2, 3], [1, 6], [2, 2], [1, 4], [1, 3], [1, 2], [1, 1],
];
const BRICK_SIZES: [number, number][] = [
  [2, 10], [2, 8], [2, 6], [2, 4], [1, 8], [2, 3], [1, 6], [2, 2], [1, 4], [1, 3], [1, 2], [1, 1],
];

/**
 * 体素雕刻：用数学形状描述造型，再自动拆成真实的板（layerH=1）或砖（layerH=3）。
 *
 * 坐标约定：x、z 以凸点为单位，格子 x 覆盖 [x, x+1)；竖直方向按「层」，每层高 layerH 板。
 * 形状函数在各向同性的凸点空间中、以体素中心取样（竖直 1 板 = 0.4 凸点），
 * 所以球就是真正的球，不会被压扁。
 */
export class Voxels {
  readonly cells = new Map<string, number>();

  constructor(readonly layerH: 1 | 3 = 1) {}

  private static k(x: number, l: number, z: number) {
    return `${x},${l},${z}`;
  }

  get(x: number, l: number, z: number) {
    return this.cells.get(Voxels.k(x, l, z));
  }

  has(x: number, l: number, z: number) {
    return this.cells.has(Voxels.k(x, l, z));
  }

  set(x: number, l: number, z: number, color: number) {
    this.cells.set(Voxels.k(x, l, z), color);
    return this;
  }

  delete(x: number, l: number, z: number) {
    this.cells.delete(Voxels.k(x, l, z));
    return this;
  }

  get size() {
    return this.cells.size;
  }

  /** 每层的高度（凸点单位） */
  get layerStuds() {
    return this.layerH * PLATE_H;
  }

  /** 第 l 层体素中心的高度（凸点单位） */
  cy(l: number) {
    return (l + 0.5) * this.layerStuds;
  }

  /** 高度 y（凸点单位）所在的层 */
  layerAt(y: number) {
    return Math.floor(y / this.layerStuds + 1e-9);
  }

  /** 遍历所有体素 */
  forEach(fn: (x: number, l: number, z: number, color: number) => void) {
    for (const [k, c] of this.cells) {
      const [x, l, z] = k.split(',').map(Number);
      fn(x, l, z, c);
    }
  }

  /**
   * 在包围盒内逐格取样并填入（覆盖已有颜色）。
   * x、z 为格子范围 [x0, x1)；y0、y1 为高度范围（凸点单位）。
   */
  fill(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, fn: ShapeFn) {
    const l0 = Math.max(0, this.layerAt(y0));
    const l1 = this.layerAt(y1) + 1;
    for (let l = l0; l < l1; l++) {
      const y = this.cy(l);
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        for (let z = Math.floor(z0); z < Math.ceil(z1); z++) {
          const c = fn(x + 0.5, y, z + 0.5);
          if (c !== null && c !== undefined && c !== false) this.set(x, l, z, c);
        }
      }
    }
    return this;
  }

  /** 只给已有体素改色：返回颜色则改，返回 null 等则保持原样 */
  paint(fn: (x: number, y: number, z: number, color: number) => number | null | undefined | false) {
    for (const [k, c] of this.cells) {
      const [x, l, z] = k.split(',').map(Number);
      const n = fn(x + 0.5, this.cy(l), z + 0.5, c);
      if (n !== null && n !== undefined && n !== false) this.cells.set(k, n);
    }
    return this;
  }

  /** 删除满足条件的体素（参数为体素中心坐标，凸点单位） */
  carve(fn: (x: number, y: number, z: number, color: number) => boolean) {
    for (const [k, c] of [...this.cells]) {
      const [x, l, z] = k.split(',').map(Number);
      if (fn(x + 0.5, this.cy(l), z + 0.5, c)) this.cells.delete(k);
    }
    return this;
  }

  // —— 常用形状（全部以凸点为单位） ——

  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, color: number) {
    return this.fill(cx - rx, cx + rx, cy - ry, cy + ry, cz - rz, cz + rz, (x, y, z) =>
      ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2 <= 1 ? color : null,
    );
  }

  sphere(cx: number, cy: number, cz: number, r: number, color: number) {
    return this.ellipsoid(cx, cy, cz, r, r, r, color);
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number) {
    return this.fill(x0, x1, y0, y1, z0, z1, (x, y, z) => (x >= x0 && x < x1 && y >= y0 && y < y1 && z >= z0 && z < z1 ? color : null));
  }

  /** 竖直圆柱（可做成圆台：r1 为顶部半径） */
  cylinder(cx: number, cz: number, r: number, y0: number, y1: number, color: number, r1 = r) {
    const R = Math.max(r, r1);
    return this.fill(cx - R, cx + R, y0, y1, cz - R, cz + R, (x, y, z) => {
      if (y < y0 || y >= y1) return null;
      const rr = r + ((r1 - r) * (y - y0)) / Math.max(1e-6, y1 - y0);
      return (x - cx) ** 2 + (z - cz) ** 2 <= rr * rr ? color : null;
    });
  }

  /** 沿 x 轴的圆柱（例如车轮、躺着的桶） */
  cylinderX(cy: number, cz: number, r: number, x0: number, x1: number, color: number) {
    return this.fill(x0, x1, cy - r, cy + r, cz - r, cz + r, (x, y, z) => (x >= x0 && x < x1 && (y - cy) ** 2 + (z - cz) ** 2 <= r * r ? color : null));
  }

  /** 沿 z 轴的圆柱 */
  cylinderZ(cx: number, cy: number, r: number, z0: number, z1: number, color: number) {
    return this.fill(cx - r, cx + r, cy - r, cy + r, z0, z1, (x, y, z) => (z >= z0 && z < z1 && (y - cy) ** 2 + (x - cx) ** 2 <= r * r ? color : null));
  }

  /**
   * 挖空内部，只保留离外表面 thickness 凸点以内的体素，大幅减少零件数。
   * keepBottom：保留最底层（作品落地处）实心，便于稳固地扣在底板上。
   */
  hollow(thickness = 1, keepBottom = true) {
    const t = Math.max(1, Math.round(thickness));
    const tl = Math.max(1, Math.ceil(thickness / this.layerStuds - 1e-9));
    let minL = Infinity;
    if (keepBottom) for (const k of this.cells.keys()) minL = Math.min(minL, Number(k.split(',')[1]));
    const remove: string[] = [];
    for (const k of this.cells.keys()) {
      const [x, l, z] = k.split(',').map(Number);
      if (keepBottom && l === minL) continue;
      let interior = true;
      for (let dl = -tl; dl <= tl && interior; dl++)
        for (let dx = -t; dx <= t && interior; dx++)
          for (let dz = -t; dz <= t; dz++)
            if (!this.cells.has(Voxels.k(x + dx, l + dl, z + dz))) {
              interior = false;
              break;
            }
      if (interior) remove.push(k);
    }
    for (const k of remove) this.cells.delete(k);
    return this;
  }

  /**
   * 拆成积木加入 builder（自下而上逐层）：
   * - 同色相邻格子合并成尽量大的板 / 砖，奇偶层交替长边方向，形成错缝咬合；
   * - 下方悬空的格子优先处理：在所有包含它的矩形里，找一块同时压到有支撑格子的，
   *   这样外挑的边缘会和内侧一起拼成整块，而不是孤零零地挂着；
   * - 实在没有支撑时才「挂」在上层（需要 Builder 允许悬挂，最后用 assertConnected 校验）；
   * - tileTop：顶面外露处改用平滑板，表面更光洁。
   * y0 为第 0 层所在的板层。
   */
  build(b: Builder, opts: { y0?: number; tileTop?: boolean } = {}) {
    const y0 = opts.y0 ?? 0;
    const family = this.layerH === 3 ? 'brick' : 'plate';
    const sizes = this.layerH === 3 ? BRICK_SIZES : PLATE_SIZES;
    const layers = new Map<number, [number, number, number][]>();
    this.forEach((x, l, z, c) => {
      let arr = layers.get(l);
      if (!arr) layers.set(l, (arr = []));
      arr.push([x, z, c]);
    });
    for (const l of [...layers.keys()].sort((a, b) => a - b)) {
      const cells = layers.get(l)!.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      const color = new Map(cells.map(([x, z, c]) => [`${x},${z}`, c]));
      const covered = new Set<string>();
      const baseY = y0 + l * this.layerH;
      // 下方有东西可扣：地面、下一层体素，或 builder 里此前已放的积木
      const supported = (x: number, z: number) => baseY === 0 || this.has(x, l - 1, z) || b.has(x, baseY - 1, z);
      // 奇偶层交替优先方向：[沿 x 长度, 沿 z 长度]
      const cands: [number, number][] = [];
      for (const [s, L] of sizes) {
        if (s === L) cands.push([s, s]);
        else if (l % 2 === 0) cands.push([L, s], [s, L]);
        else cands.push([s, L], [L, s]);
      }
      const fits = (x: number, z: number, w: number, d: number, c: number) => {
        for (let i = 0; i < w; i++)
          for (let j = 0; j < d; j++) {
            const k = `${x + i},${z + j}`;
            if (covered.has(k) || color.get(k) !== c) return false;
          }
        return true;
      };
      const anySupport = (x: number, z: number, w: number, d: number) => {
        for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) if (supported(x + i, z + j)) return true;
        return false;
      };
      const exposed = (x: number, z: number, w: number, d: number) => {
        for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) if (this.has(x + i, l + 1, z + j)) return false;
        return true;
      };
      const partFor = (x: number, z: number, w: number, d: number) => {
        const s = Math.min(w, d);
        const L = Math.max(w, d);
        if (opts.tileTop && family === 'plate' && exposed(x, z, w, d)) {
          const tile = `tile-${s}x${L}`;
          return findPart(tile) ? tile : null; // 外露却没有同尺寸的平滑板：换更小的尺寸
        }
        return `${family}-${s}x${L}`;
      };
      const place = (x: number, z: number, w: number, d: number, c: number, part: string) => {
        b.add(part, c, x, baseY, z, w >= d ? 0 : 1);
        for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) covered.add(`${x + i},${z + j}`);
      };

      // 第一轮：悬空格子优先，在所有包含它的矩形中找一块能压到支撑的
      for (const [x, z, c] of cells) {
        if (covered.has(`${x},${z}`) || supported(x, z)) continue;
        search: for (const [w, d] of cands) {
          for (let ox = 0; ox < w; ox++)
            for (let oz = 0; oz < d; oz++) {
              const ax = x - ox;
              const az = z - oz;
              if (!fits(ax, az, w, d, c) || !anySupport(ax, az, w, d)) continue;
              const part = partFor(ax, az, w, d);
              if (!part) continue;
              place(ax, az, w, d, c, part);
              break search;
            }
        }
      }
      // 第二轮：其余格子按行扫描，以左上角为锚点贪心合并（仍优先有支撑的组合）
      for (const [x, z, c] of cells) {
        if (covered.has(`${x},${z}`)) continue;
        let done = false;
        for (const needSupport of [true, false]) {
          for (const [w, d] of cands) {
            if (!fits(x, z, w, d, c)) continue;
            if (needSupport && !anySupport(x, z, w, d)) continue;
            const part = partFor(x, z, w, d);
            if (!part) continue;
            place(x, z, w, d, c, part);
            done = true;
            break;
          }
          if (done) break;
        }
      }
    }
    return b;
  }
}

/**
 * 像素画：把字符位图铺成一层（或多层）板。
 * rows[0] 在 z 最小的一侧；palette 把字符映射为颜色，不在表里的字符留空。
 */
export function pixelArt(
  rows: string[],
  palette: Record<string, number>,
  x0: number,
  z0: number,
  layers = 1,
  layerH: 1 | 3 = 1,
): Voxels {
  const v = new Voxels(layerH);
  rows.forEach((row, j) => {
    [...row].forEach((ch, i) => {
      const c = palette[ch];
      if (c === undefined) return;
      for (let l = 0; l < layers; l++) v.set(x0 + i, l, z0 + j, c);
    });
  });
  return v;
}

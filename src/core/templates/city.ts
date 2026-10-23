import { getPart } from '../parts';
import type { BrickData, Rot } from '../types';
import { Builder, C, rng, type Template } from './builder';
import { Voxels } from './sculpt';

// ---------------------------------------------------------------------------
// 公共工具
// ---------------------------------------------------------------------------

/** 本主题用到的额外颜色（LDraw 代码） */
const K = {
  ...C,
  veryLightGray: 151,
  darkBlue: 272,
  mediumBlue: 73,
  darkAzure: 321,
  brightLightYellow: 226,
  darkOrange: 484,
  flatSilver: 315,
  transDarkBlue: 33,
  transGreen: 34,
} as const;

/** 在局部坐标中放一块积木 */
type Put = (part: string, color: number, x: number, y: number, z: number, rot?: Rot) => void;

/** 局部积木组：在独立的 Builder 中搭好，再整体旋转、平移到场景里 */
function group(fn: (put: Put, b: Builder) => void): BrickData[] {
  const b = new Builder(200, { allowHanging: true });
  fn((part, color, x, y, z, rot = 0) => void b.add(part, color, x, y, z, rot), b);
  return b.bricks;
}

/** 绕原点旋转 +90°（与零件旋转同向：局部 +X → 世界 −Z） */
function turn90(br: BrickData): BrickData {
  const p = getPart(br.part);
  const fw = br.rot % 2 === 0 ? p.w : p.d;
  return { ...br, x: br.z, z: -br.x - fw, rot: ((br.rot + 1) % 4) as Rot };
}

/**
 * 把局部积木组（占地 [0,w)×[0,d)）转 turn 次 90° 后移到世界坐标：
 * 旋转后的占地矩形最小角落在 (wx, wz)，整体抬高 wy 层。
 */
function moved(bricks: BrickData[], turn: number, wx: number, wy: number, wz: number, w: number, d: number): BrickData[] {
  const t = ((turn % 4) + 4) % 4;
  const [ox, oz] = [
    [0, 0],
    [0, w],
    [w, d],
    [d, 0],
  ][t];
  return bricks.map((br) => {
    let r = br;
    for (let i = 0; i < t; i++) r = turn90(r);
    return { ...r, x: r.x + ox + wx, y: r.y + wy, z: r.z + oz + wz };
  });
}

/** 同 moved，并逐块加入 builder（照常校验） */
function place(b: Builder, bricks: BrickData[], turn: number, wx: number, wy: number, wz: number, w: number, d: number) {
  for (const r of moved(bricks, turn, wx, wy, wz, w, d)) b.add(r.part, r.color, r.x, r.y, r.z, r.rot);
}

/** 把长度 n 拆成可用的长度（零件数最少，尽量避免 1） */
function split(n: number, sizes: readonly number[]): number[] {
  const best: (number[] | null)[] = [[]];
  const score = (l: number[]) => l.length + 0.3 * l.filter((v) => v === 1).length;
  for (let i = 1; i <= n; i++) {
    let pick: number[] | null = null;
    for (const s of sizes) {
      const rest = s <= i ? best[i - s] : null;
      if (!rest) continue;
      const cand = [s, ...rest];
      if (!pick || score(cand) < score(pick)) pick = cand;
    }
    best[i] = pick;
  }
  return [...best[n]!].sort((a, b) => b - a);
}

const LINE_SIZES: Record<string, number[]> = {
  brick: [8, 6, 4, 3, 2, 1],
  plate: [8, 6, 4, 3, 2, 1],
  tile: [6, 4, 3, 2, 1],
};

/** 零件编号与旋转：占地 fx×fz（fx 沿 X） */
function sized(family: string, fx: number, fz: number): [string, Rot] {
  return [`${family}-${Math.min(fx, fz)}x${Math.max(fx, fz)}`, fx >= fz ? 0 : 1];
}

/** 一条 1 格宽的线：按颜色分段，用 1×N 的砖 / 板 / 平滑板铺满；奇数层反向排列以错缝 */
function line(
  put: Put,
  s: number,
  e: number,
  y: number,
  fixed: number,
  dir: 'x' | 'z',
  colorAt: (x: number, z: number) => number | null,
  family = 'brick',
  flip = false,
) {
  const col = (i: number) => (dir === 'x' ? colorAt(i, fixed) : colorAt(fixed, i));
  let i = s;
  while (i < e) {
    const c = col(i);
    let j = i + 1;
    while (j < e && col(j) === c) j++;
    if (c !== null) {
      const pieces = split(j - i, LINE_SIZES[family]);
      if (flip) pieces.reverse();
      let p = i;
      for (const len of pieces) {
        if (dir === 'x') put(`${family}-1x${len}`, c, p, y, fixed, 0);
        else put(`${family}-1x${len}`, c, fixed, y, p, 1);
        p += len;
      }
    }
    i = j;
  }
}

/** 一层 1 格厚的围墙：偶数层前后墙占四角、奇数层左右墙占四角，转角咬合；colorAt 返回 null 为开口 */
function ring(
  put: Put,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  layer: number,
  colorAt: (x: number, z: number) => number | null,
  family = 'brick',
) {
  const own = layer % 2 === 0;
  const flip = layer % 2 === 1;
  for (const z of [z0, z1 - 1]) line(put, own ? x0 : x0 + 1, own ? x1 : x1 - 1, y, z, 'x', colorAt, family, flip);
  for (const x of [x0, x1 - 1]) line(put, own ? z0 + 1 : z0, own ? z1 - 1 : z1, y, x, 'z', colorAt, family, flip);
}

/** 用尽量大的板 / 平滑板 / 砖铺满矩形 [x0,x1)×[z0,z1) */
function rect(put: Put, x0: number, z0: number, x1: number, z1: number, y: number, color: number, family = 'plate') {
  const big = family === 'plate' ? [8, 6, 4, 2, 1] : family === 'tile' ? [4, 2, 1] : [8, 6, 4, 2, 1];
  const small = family === 'plate' ? [8, 6, 4, 2, 1] : [2, 1];
  const longX = x1 - x0 >= z1 - z0;
  const xs = split(x1 - x0, longX ? big : small);
  const zs = split(z1 - z0, longX ? small : big);
  let x = x0;
  for (const fx of xs) {
    let z = z0;
    for (const fz of zs) {
      const [part, rot] = sized(family, fx, fz);
      put(part, color, x, y, z, rot);
      z += fz;
    }
    x += fx;
  }
}

/** 由 1×1 格子组成的一层（同色合并成大块），alongZ 时长边优先沿 Z */
function cells(b: Builder, list: [number, number, number][], y: number, tile: boolean, alongZ = false) {
  if (!list.length) return;
  const v = new Voxels(1);
  const l = alongZ ? 1 : 0;
  for (const [x, z, c] of list) v.set(x, l, z, c);
  v.build(b, { y0: y - l, tileTop: tile });
}

/**
 * 体素拆成积木后，再给所有外露的顶面盖一层同色平滑板：
 * 表面更光洁，而且平滑板总是扣在下面的凸点上，不会影响连接。
 */
function buildSmooth(b: Builder, v: Voxels, y0 = 0) {
  v.build(b, { y0 });
  const skin = new Voxels(1);
  v.forEach((x, l, z, c) => {
    if (!v.has(x, l + 1, z) && b.isFree(x, y0 + l + 1, z)) skin.set(x, l + 1, z, c);
  });
  skin.build(b, { y0, tileTop: true });
}

/** 一棵圆润的树（与基础示例同款），树干中心在格点 (cx, cz)，立在 y 层 */
function roundTree(put: Put, cx: number, cz: number, y: number, leaf: number = C.green) {
  put('round-brick-2x2', C.reddishBrown, cx - 1, y, cz - 1);
  put('round-brick-2x2', C.reddishBrown, cx - 1, y + 3, cz - 1);
  put('corner-brick-2x2', C.darkGreen, cx, y + 6, cz, 0);
  put('corner-brick-2x2', C.darkGreen, cx, y + 6, cz - 2, 1);
  put('corner-brick-2x2', C.darkGreen, cx - 2, y + 6, cz - 2, 2);
  put('corner-brick-2x2', C.darkGreen, cx - 2, y + 6, cz, 3);
  put('corner-brick-2x2', leaf, cx, y + 9, cz, 0);
  put('corner-brick-2x2', leaf, cx, y + 9, cz - 2, 1);
  put('corner-brick-2x2', leaf, cx - 2, y + 9, cz - 2, 2);
  put('corner-brick-2x2', leaf, cx - 2, y + 9, cz, 3);
  put('round-brick-2x2', C.brightGreen, cx - 1, y + 12, cz - 1);
  put('round-plate-2x2', C.lime, cx - 1, y + 15, cz - 1);
}

/** 0~1 的格点哈希（可复现） */
function hash2(x: number, z: number, seed = 0) {
  let h = Math.imul(x + 374761393 + seed * 668265263, 1274126177) ^ Math.imul(z + 1442695041, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 平滑的值噪声（格距 cell 个凸点） */
function noise2(x: number, z: number, cell: number, seed = 0) {
  const fx = x / cell;
  const fz = z / cell;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hash2(ix, iz, seed);
  const b2 = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b2 - a) * sx + (c - a) * sz + (a - b2 - c + d) * sx * sz;
}

/** 把若干阶段的积木按给定顺序重新排列（用于搭建回放：先地面、后建筑） */
function reorder(b: Builder, marks: number[], order: number[]): BrickData[] {
  const bounds = [...marks, b.bricks.length];
  const out: BrickData[] = [];
  for (const i of order) out.push(...b.bricks.slice(i === 0 ? 0 : bounds[i - 1], bounds[i]));
  return out;
}

// ---------------------------------------------------------------------------
// 1. 城市街区
// ---------------------------------------------------------------------------

/** 玻璃写字楼（局部坐标，正面朝 +z，占地 12×12，门廊伸出到 z=14） */
function officeTower(): BrickData[] {
  return group((put) => {
    const W = 12;
    const D = 12;
    const corner = (x: number, z: number) => (x === 0 || x === W - 1) && (z === 0 || z === D - 1);
    const onPier = (x: number, z: number) => {
      const p = z === 0 || z === D - 1 ? x : z;
      return p === 0 || p === 4 || p === 7 || p === W - 1;
    };
    // 门廊两根白色圆柱
    for (const x of [4, 7]) for (let k = 0; k < 3; k++) put('round-brick-1x1', K.white, x, k * 3, 13);
    // 大堂：深灰立柱 + 透明玻璃，正门 x∈[5,7)
    let y = 0;
    for (let layer = 0; layer < 3; layer++) {
      ring(put, 0, 0, W, D, y, layer, (x, z) => {
        if (z === D - 1 && x >= 5 && x < 7) return layer < 2 ? null : K.transClear;
        return onPier(x, z) ? K.darkGray : K.transClear;
      });
      y += 3;
    }
    // 大堂顶板 + 门廊雨棚
    put('plate-8x8', K.white, 0, y, 0);
    put('plate-4x8', K.white, 8, y, 0, 1);
    put('plate-4x4', K.white, 0, y, 8);
    put('plate-4x4', K.white, 8, y, 8);
    put('plate-4x6', K.white, 4, y, 8, 1);
    put('tile-2x4', K.white, 4, y + 1, 12);
    y += 1;
    // 标准层：浅蓝玻璃幕墙 + 白色楼板
    const FLOORS = 10;
    for (let f = 0; f < FLOORS; f++) {
      for (let layer = 0; layer < 2; layer++) {
        ring(put, 0, 0, W, D, y, f * 2 + layer, (x, z) => (corner(x, z) ? K.white : K.transLightBlue));
        y += 3;
      }
      rect(put, 0, 0, W, D, y, K.white);
      y += 1;
    }
    // 退台顶层：透明玻璃；外圈露台铺平滑板
    line(put, 0, W, y, 0, 'x', () => K.lightGray, 'tile');
    line(put, 0, W, y, D - 1, 'x', () => K.lightGray, 'tile');
    line(put, 1, D - 1, y, 0, 'z', () => K.lightGray, 'tile');
    line(put, 1, D - 1, y, W - 1, 'z', () => K.lightGray, 'tile');
    for (let layer = 0; layer < 2; layer++) {
      ring(put, 1, 1, W - 1, D - 1, y, layer, (x, z) =>
        (x === 1 || x === W - 2) && (z === 1 || z === D - 2) ? K.white : K.transClear,
      );
      y += 3;
    }
    rect(put, 1, 1, W - 1, D - 1, y, K.lightGray);
    y += 1;
    line(put, 1, W - 1, y, 1, 'x', () => K.white, 'tile');
    line(put, 1, W - 1, y, D - 2, 'x', () => K.white, 'tile');
    line(put, 2, D - 2, y, 1, 'z', () => K.white, 'tile');
    line(put, 2, D - 2, y, W - 2, 'z', () => K.white, 'tile');
    // 屋顶设备间与天线
    for (let layer = 0; layer < 2; layer++) ring(put, 3, 3, 9, 9, y + layer * 3, layer, () => K.darkGray);
    put('plate-6x6', K.darkGray, 3, y + 6, 3);
    for (const [x, z] of [
      [3, 3],
      [5, 3],
      [7, 3],
      [3, 5],
      [7, 5],
      [3, 7],
      [5, 7],
      [7, 7],
    ])
      put('tile-2x2', K.lightGray, x, y + 7, z);
    put('round-brick-2x2', K.flatSilver, 5, y + 7, 5);
    for (let k = 0; k < 4; k++) put('round-brick-1x1', K.flatSilver, 5, y + 10 + k * 3, 5);
    put('round-plate-1x1', K.transRed, 5, y + 22, 5);
  });
}

/** 红砖公寓（局部坐标，正面朝 +z，占地 18×10，阳台与台阶伸出到 z=12） */
function apartments(): BrickData[] {
  const r = rng(808);
  return group((put) => {
    const W = 18;
    const D = 10;
    const GLASS = K.transLightBlue;
    const win = (p: number) => p === 1 || p === 2 || p === 4 || p === 5 || p === 12 || p === 13 || p === 15 || p === 16;
    // 门前台阶
    put('plate-2x4', K.lightGray, 7, 0, 10);
    put('tile-2x4', K.lightGray, 7, 1, 10);
    let y = 0;
    const FLOORS = 5;
    // 窗后的「室内」：深色窗帘，偶尔亮着暖灯
    const room = () => (r() < 0.25 ? K.brightLightYellow : K.darkBlue);
    for (let f = 0; f < FLOORS; f++) {
      for (const x of [1, 4, 12, 15]) {
        put('brick-1x2x3', room(), x, y, D - 2);
        put('brick-1x2x3', room(), x, y, 1);
      }
      if (f > 0) put('brick-1x2x3', room(), 8, y, D - 2);
      for (const z of [3, 6]) {
        put('brick-1x2x3', room(), 1, y, z, 1);
        put('brick-1x2x3', room(), W - 2, y, z, 1);
      }
      for (let layer = 0; layer < 3; layer++) {
        const lay = f * 3 + layer;
        ring(
          put,
          0,
          0,
          W,
          D,
          y,
          lay,
          (x, z) => {
            if (z === D - 1) {
              if (f === 0 && layer === 2 && x >= 7 && x < 11) return null;
              if (x >= 8 && x < 10) return f === 0 ? K.reddishBrown : GLASS;
              if (win(x) && layer < 2) return GLASS;
              return -1;
            }
            if (x === 0 || x === W - 1) return (z === 3 || z === 4 || z === 6 || z === 7) && layer < 2 ? GLASS : -1;
            if (z === 0) return win(x) && layer < 2 ? GLASS : -1;
            return -1;
          },
        );
        y += 3;
      }
      if (f === 0) {
        put('plate-1x2', K.transClear, 8, y - 3, D - 1);
        put('plate-1x2', K.transClear, 8, y - 2, D - 1);
        put('arch-1x4', K.white, 7, y - 3, D - 1);
      }
      // 楼板：正面伸出 1 格做檐线，中间阳台伸出 2 格
      rect(put, 0, 0, W, D - 2, y, K.white);
      put('plate-1x6', K.white, 0, y, D - 2);
      put('plate-1x6', K.white, 12, y, D - 2);
      put('plate-2x6', K.white, 0, y, D - 1);
      put('plate-2x6', K.white, 12, y, D - 1);
      put('plate-4x6', K.white, 6, y, D - 2);
      y += 1;
      if (f < FLOORS - 1) {
        // 阳台栏杆与花箱
        put('brick-1x6', K.white, 6, y, D + 1);
        put('brick-1x1', K.white, 6, y, D);
        put('brick-1x1', K.white, 11, y, D);
        put('plate-1x4', K.darkGreen, 7, y + 3, D + 1);
        const flowers = [K.red, K.yellow, K.brightPink, K.white];
        for (let i = 0; i < 4; i++) put('round-plate-1x1', flowers[(i + f) % 4], 7 + i, y + 4, D + 1);
      }
    }
    // 女儿墙与屋顶水塔
    ring(put, 0, 0, W, D, y, 1, () => -1);
    line(put, 0, W, y + 3, 0, 'x', () => K.white, 'tile');
    line(put, 0, W, y + 3, D - 1, 'x', () => K.white, 'tile');
    line(put, 1, D - 1, y + 3, 0, 'z', () => K.white, 'tile');
    line(put, 1, D - 1, y + 3, W - 1, 'z', () => K.white, 'tile');
    for (const [x, z] of [
      [12, 2],
      [15, 2],
      [12, 5],
      [15, 5],
    ])
      for (let k = 0; k < 2; k++) put('brick-1x1', K.darkGray, x, y + k * 3, z);
    put('plate-4x4', K.reddishBrown, 12, y + 6, 2);
    put('corner-brick-2x2', K.reddishBrown, 14, y + 7, 4, 0);
    put('corner-brick-2x2', K.reddishBrown, 14, y + 7, 2, 1);
    put('corner-brick-2x2', K.reddishBrown, 12, y + 7, 2, 2);
    put('corner-brick-2x2', K.reddishBrown, 12, y + 7, 4, 3);
    put('round-brick-2x2', K.reddishBrown, 13, y + 10, 3);
    put('round-plate-2x2', K.darkGray, 13, y + 13, 3);
    // 空调外机
    put('brick-2x2', K.lightGray, 3, y, 3);
    put('tile-2x2', K.darkGray, 3, y + 3, 3);
    put('brick-2x2', K.lightGray, 6, y, 3);
    put('tile-2x2', K.darkGray, 6, y + 3, 3);
  }).map((b) => (b.color === -1 ? { ...b, color: r() < 0.22 ? K.darkRed : K.red } : b));
}

/** 街角小店（局部坐标，正面朝 +z，占地 14×9，条纹遮阳棚伸出到 z=11） */
function cornerShop(): BrickData[] {
  return group((put) => {
    const W = 14;
    const D = 9;
    const wall = K.brightLightYellow;
    const trim = K.white;
    let y = 0;
    // 一层：大橱窗 + 玻璃门
    for (let layer = 0; layer < 3; layer++) {
      ring(put, 0, 0, W, D, y, layer, (x, z) => {
        if (z === D - 1) {
          if (x === 0 || x === W - 1) return trim;
          if (x >= 6 && x < 8) return layer < 2 ? null : K.transLightBlue;
          return layer === 0 ? wall : K.transLightBlue;
        }
        if (x === 0 && (z === 3 || z === 4 || z === 5) && layer > 0) return K.transLightBlue;
        return wall;
      });
      y += 3;
    }
    // 条纹遮阳棚（33° 斜坡，红白相间）+ 两端
    ring(put, 0, 0, W, D, y, 3, (x, z) => (z === D - 1 && x > 0 && x < W - 1 ? null : wall));
    for (let x = 1; x < W - 1; x++) put('slope33-3x1', x % 2 ? K.red : K.white, x, y, D - 1, 0);
    y += 3;
    // 招牌层
    ring(put, 0, 0, W, D, y, 4, (x, z) => (z === D - 1 ? (x === 0 || x === W - 1 ? trim : K.darkGreen) : wall));
    y += 3;
    rect(put, 0, 0, W, D, y, trim);
    y += 1;
    // 二层：两扇窗
    for (let layer = 0; layer < 3; layer++) {
      ring(put, 0, 0, W, D, y, layer + 1, (x, z) => {
        if (layer < 2 && z === D - 1 && ((x >= 2 && x < 5) || (x >= 9 && x < 12))) return K.transLightBlue;
        if (layer < 2 && x === 0 && (z === 3 || z === 4 || z === 5)) return K.transLightBlue;
        return wall;
      });
      y += 3;
    }
    rect(put, 0, 0, W, D, y, trim);
    y += 1;
    ring(put, 0, 0, W, D, y, 0, () => wall);
    // 屋顶空调
    for (const x of [2, 5]) {
      put('brick-2x2', K.lightGray, x, y, 2);
      put('tile-2x2', K.darkGray, x, y + 3, 2);
    }
    line(put, 0, W, y + 3, 0, 'x', () => trim, 'tile');
    line(put, 0, W, y + 3, D - 1, 'x', () => trim, 'tile');
    line(put, 1, D - 1, y + 3, 0, 'z', () => trim, 'tile');
    line(put, 1, D - 1, y + 3, W - 1, 'z', () => trim, 'tile');
  });
}

/** 方盒子小汽车（局部坐标，车头朝 +x，占地 8×4） */
function boxCar(body: number, roof: number, extra?: 'taxi' | 'police'): BrickData[] {
  return group((put) => {
    for (const x of [1, 6])
      for (const z of [0, 3]) {
        put('round-plate-1x1', K.black, x, 0, z);
        put('round-plate-1x1', K.black, x, 1, z);
      }
    put('plate-1x4', K.flatSilver, 0, 1, 0, 1);
    put('plate-1x4', K.flatSilver, 7, 1, 0, 1);
    put('plate-4x4', body, 2, 1, 0);
    put('plate-4x8', body, 0, 2, 0);
    // 车灯
    for (const z of [0, 3]) {
      put('plate-1x1', K.transClear, 7, 3, z);
      put('plate-1x1', K.transRed, 0, 3, z);
    }
    put('plate-1x2', body, 7, 3, 1, 1);
    put('plate-1x2', body, 0, 3, 1, 1);
    put('plate-1x4', body, 6, 3, 0, 1);
    put('plate-1x4', body, 1, 3, 0, 1);
    put('tile-2x4', body, 6, 4, 0, 1);
    put('tile-2x4', body, 0, 4, 0, 1);
    // 车厢：前后风挡斜坡 + 车顶
    put('slope45-2x4', K.transClear, 2, 3, 0, 3);
    put('slope45-2x4', K.transClear, 4, 3, 0, 1);
    if (extra) {
      put('plate-2x4', roof, 3, 6, 0, 1);
      if (extra === 'taxi') put('tile-1x2', K.black, 3, 7, 1, 1);
      else {
        put('tile-1x1', K.transRed, 4, 7, 1);
        put('tile-1x1', K.transDarkBlue, 4, 7, 2);
      }
    } else put('tile-2x4', roof, 3, 6, 0, 1);
  });
}

/** 城市公交车（局部坐标，车头朝 +x，占地 14×4） */
function cityBus(body: number): BrickData[] {
  return group((put) => {
    for (const x of [2, 11])
      for (const z of [0, 3]) {
        put('round-plate-1x1', K.black, x, 0, z);
        put('round-plate-1x1', K.black, x, 1, z);
      }
    put('plate-4x8', body, 0, 2, 0);
    put('plate-4x6', body, 8, 2, 0);
    // 车身下半截与车灯
    put('brick-2x8', body, 0, 3, 0);
    put('brick-2x8', body, 0, 3, 2);
    put('brick-2x4', body, 8, 3, 0);
    put('brick-2x4', body, 8, 3, 2);
    put('brick-1x2', body, 12, 3, 1, 1);
    for (const z of [0, 3]) put('brick-1x1', K.transClear, 13, 3, z);
    put('brick-1x2', K.darkGray, 13, 3, 1, 1);
    put('brick-1x1', body, 12, 3, 0);
    put('brick-1x1', body, 12, 3, 3);
    // 车窗带：两侧玻璃、白色窗柱，前挡风
    for (const z of [0, 3]) {
      put('brick-1x1', K.white, 0, 6, z);
      put('brick-1x4', K.transLightBlue, 1, 6, z);
      put('brick-1x1', K.white, 5, 6, z);
      put('brick-1x4', K.transLightBlue, 6, 6, z);
      put('brick-1x1', K.white, 10, 6, z);
      put('brick-1x2', K.transLightBlue, 11, 6, z);
      put('brick-1x1', K.white, 13, 6, z);
    }
    put('brick-1x2', K.white, 0, 6, 1, 1);
    put('brick-1x2', K.transLightBlue, 13, 6, 1, 1);
    // 车顶
    put('plate-4x8', K.white, 0, 9, 0);
    put('plate-4x6', K.white, 8, 9, 0);
    put('tile-2x4', K.white, 0, 10, 0);
    put('tile-2x4', K.white, 0, 10, 2);
    put('tile-2x4', K.white, 4, 10, 0);
    put('tile-2x4', K.white, 4, 10, 2);
    put('tile-2x4', K.white, 8, 10, 0);
    put('tile-2x4', K.white, 8, 10, 2);
    put('tile-2x2', K.white, 12, 10, 0);
    put('tile-2x2', K.white, 12, 10, 2);
  });
}

/** 路灯：灯杆立在 (x, z)，灯臂伸向 dir 方向（0:+x 1:-z 2:-x 3:+z） */
function streetLamp(put: Put, x: number, z: number, y: number, dir: number) {
  for (let k = 0; k < 5; k++) put('round-brick-1x1', K.darkGray, x, y + k * 3, z);
  const top = y + 15;
  const [dx, dz] = [
    [1, 0],
    [0, -1],
    [-1, 0],
    [0, 1],
  ][dir];
  const ax = Math.min(x, x + 2 * dx);
  const az = Math.min(z, z + 2 * dz);
  put('plate-1x3', K.darkGray, ax, top, az, dx ? 0 : 1);
  put('tile-1x3', K.darkGray, ax, top + 1, az, dx ? 0 : 1);
  put('round-plate-1x1', K.transYellow, x + 2 * dx, top - 1, z + 2 * dz);
}

/** 红绿灯 */
function trafficLight(put: Put, x: number, z: number, y: number) {
  for (let k = 0; k < 4; k++) put('round-brick-1x1', K.darkGray, x, y + k * 3, z);
  let t = y + 12;
  for (const c of [K.transGreen, K.transYellow, K.transRed]) {
    put('plate-1x1', K.black, x, t, z);
    put('round-plate-1x1', c, x, t + 1, z);
    t += 2;
  }
  put('round-tile-1x1', K.black, x, t, z);
}

/** 公交站（局部坐标：背板在 z=0，朝 +z，占地 6×4） */
function busStop(): BrickData[] {
  return group((put) => {
    for (const x of [0, 5]) for (let k = 0; k < 3; k++) put('brick-1x1', K.darkGray, x, k * 3, 0);
    put('brick-1x4', K.transClear, 1, 0, 0);
    put('brick-1x4', K.transClear, 1, 3, 0);
    put('brick-1x4', K.darkAzure, 1, 6, 0);
    put('plate-4x6', K.darkGray, 0, 9, 0);
    for (const x of [0, 2, 4]) put('tile-2x4', K.darkAzure, x, 10, 0, 1);
    // 长椅
    put('brick-1x1', K.darkGray, 1, 0, 1);
    put('brick-1x1', K.darkGray, 4, 0, 1);
    put('tile-1x4', K.reddishBrown, 1, 3, 1);
  });
}

/** 公园长椅（局部：沿 x 长 4，靠背在 z=0） */
function bench(): BrickData[] {
  return group((put) => {
    put('brick-1x1', K.darkGray, 0, 0, 1);
    put('brick-1x1', K.darkGray, 3, 0, 1);
    put('brick-1x4', K.darkGray, 0, 0, 0);
    put('brick-1x4', K.reddishBrown, 0, 3, 0);
    put('tile-1x4', K.reddishBrown, 0, 3, 1);
  });
}

function cityBlock(): BrickData[] {
  const b = new Builder(32, { allowHanging: true });
  const put: Put = (part, color, x, y, z, rot = 0) => void b.add(part, color, x, y, z, rot);

  // —— 规划 ——
  // 东西向主路 A：z∈[-5,6)，中线 z=0；南北向主路 B：x∈[-5,6)，中线 x=0；两侧人行道宽 4。
  const inA = (z: number) => z >= -5 && z < 6;
  const inB = (x: number) => x >= -5 && x < 6;
  const isRoad = (x: number, z: number) => inA(z) || inB(x);
  const isWalk = (x: number, z: number) => !isRoad(x, z) && ((x >= -9 && x < 10) || (z >= -9 && z < 10));
  // 写字楼 (NW)、公寓 (NE)、小店 (SW)、公园 (SE)
  const TOWER = { x: -23, z: -23 };
  const APT = { x: 12, z: -21 };
  const SHOP = { x: -19, z: 12 }; // 旋转后占 x∈[-19,-10)、z∈[12,26)，正面朝 +x
  const parkCx = 21;
  const parkCz = 21;

  // 车辆：先算好世界坐标（车轮下需要带凸点的路面板）；turn 1 车头朝 -z，3 朝 +z
  const cars = [
    moved(boxCar(K.red, K.red), 0, -28, 1, 1, 8, 4),
    moved(boxCar(K.blue, K.white), 2, -18, 1, -4, 8, 4),
    moved(boxCar(K.yellow, K.yellow, 'taxi'), 1, 1, 1, -27, 8, 4),
    moved(cityBus(K.red), 3, -4, 1, -30, 14, 4),
    moved(boxCar(K.white, K.white, 'police'), 1, 1, 1, 12, 8, 4),
    moved(boxCar(K.mediumBlue, K.white), 0, 20, 1, 1, 8, 4),
    // 停车场
    moved(boxCar(K.lime, K.white), 2, -30, 1, 11, 8, 4),
    moved(boxCar(K.orange, K.orange), 0, -30, 1, 17, 8, 4),
  ];
  const wheelCells = new Set(cars.flat().filter((br) => br.y === 1).map((br) => `${br.x},${br.z}`));

  // 地表规划（y=1 层）：返回 [颜色, 是否平滑板]
  const lawn = K.green;
  const surface = (x: number, z: number): [number, boolean] | null => {
    if (isRoad(x, z)) return null;
    if (isWalk(x, z)) return [K.lightGray, true];
    // SE 公园
    if (x >= 10 && z >= 10) {
      const dx = x + 0.5 - parkCx;
      const dz = z + 0.5 - parkCz;
      const d = Math.hypot(dx, dz);
      if (d < 6.2) return [K.tan, true];
      if ((Math.abs(dx) < 1 && x < parkCx) || (Math.abs(dz) < 1 && z < parkCz)) return [K.tan, true];
      if (x >= 30 || z >= 30) return [K.darkGreen, false];
      return [lawn, false];
    }
    // NW 写字楼广场
    if (x < -9 && z < -9) {
      if (x >= TOWER.x - 2 && z >= TOWER.z - 2) return [K.veryLightGray, true];
      return [lawn, false];
    }
    // NE 公寓：前院铺砖，其余草地
    if (x >= 10 && z < -9) {
      if (z >= APT.z + 10 && x >= APT.x - 1 && x < APT.x + 19) return [K.veryLightGray, true];
      return [lawn, false];
    }
    // SW 小店：门前铺砖，左侧停车场，其余草地
    if (x < -9 && z >= 10) {
      if (x >= -10) return [K.veryLightGray, true];
      if (x < -20 && z < 28) {
        const stripe = (z - 10) % 6 === 0 && x >= -29;
        return [stripe ? K.white : K.darkGray, true];
      }
      if (z < 27 && x >= -20) return [K.veryLightGray, true];
      return [lawn, false];
    }
    return [K.lightGray, true];
  };

  // —— 阶段 0：地基板（y=0）——
  const base: [number, number, number][] = [];
  for (let x = -32; x < 32; x++)
    for (let z = -32; z < 32; z++) {
      const s = surface(x, z);
      if (!s) continue;
      base.push([x, z, s[0] === lawn || s[0] === K.darkGreen ? K.green : K.lightGray]);
    }
  cells(b, base, 0, false);

  // —— 阶段 0：路面（y=0）——
  const roadColor = (x: number, z: number): number => {
    // 斑马线
    if (inA(z) && ((x >= -9 && x < -5) || (x >= 6 && x < 10))) return (z + 5) % 2 === 0 ? K.white : K.darkGray;
    if (inB(x) && ((z >= -9 && z < -5) || (z >= 6 && z < 10))) return (x + 5) % 2 === 0 ? K.white : K.darkGray;
    if (inA(z) && inB(x)) return K.darkGray;
    // 停止线
    if (x === -10 && z >= 1 && z < 6) return K.white;
    if (x === 10 && z >= -5 && z < 0) return K.white;
    if (z === -10 && x >= -5 && x < 0) return K.white;
    if (z === 10 && x >= 1 && x < 6) return K.white;
    // 中线（虚线）
    if (inA(z) && z === 0) return Math.abs(x) < 16 || (Math.abs(x) + 1) % 6 < 3 ? K.white : K.darkGray;
    if (inB(x) && x === 0) return Math.abs(z) < 16 || (Math.abs(z) + 1) % 6 < 3 ? K.white : K.darkGray;
    return K.darkGray;
  };
  const roadA: [number, number, number][] = [];
  const roadB: [number, number, number][] = [];
  for (let x = -32; x < 32; x++)
    for (let z = -32; z < 32; z++) {
      if (!isRoad(x, z)) continue;
      if (wheelCells.has(`${x},${z}`)) {
        put('plate-1x1', K.darkGray, x, 0, z);
        continue;
      }
      (inA(z) ? roadA : roadB).push([x, z, roadColor(x, z)]);
    }
  cells(b, roadA, 0, true);
  cells(b, roadB, 0, true, true);
  const mGround = b.bricks.length;

  // —— 阶段 2：建筑 ——
  place(b, officeTower(), 0, TOWER.x, 1, TOWER.z, 12, 14);
  place(b, apartments(), 0, APT.x, 1, APT.z, 18, 12);
  place(b, cornerShop(), 1, SHOP.x, 1, SHOP.z, 14, 11);

  // 公园：喷泉、树、长椅
  const fx = parkCx - 4;
  const fz = parkCz - 4;
  put('corner-brick-2x2', K.lightGray, fx, 1, fz, 2);
  put('corner-brick-2x2', K.lightGray, fx + 6, 1, fz, 1);
  put('corner-brick-2x2', K.lightGray, fx, 1, fz + 6, 3);
  put('corner-brick-2x2', K.lightGray, fx + 6, 1, fz + 6, 0);
  put('brick-1x4', K.lightGray, fx + 2, 1, fz);
  put('brick-1x4', K.lightGray, fx + 2, 1, fz + 7);
  put('brick-1x4', K.lightGray, fx, 1, fz + 2, 1);
  put('brick-1x4', K.lightGray, fx + 7, 1, fz + 2, 1);
  put('tile-1x4', K.white, fx + 2, 4, fz);
  put('tile-1x4', K.white, fx + 2, 4, fz + 7);
  put('tile-1x4', K.white, fx, 4, fz + 2, 1);
  put('tile-1x4', K.white, fx + 7, 4, fz + 2, 1);
  put('round-brick-2x2', K.lightGray, parkCx - 1, 1, parkCz - 1);
  put('round-plate-2x2', K.white, parkCx - 1, 4, parkCz - 1);
  put('round-brick-2x2', K.transLightBlue, parkCx - 1, 5, parkCz - 1);
  put('round-plate-2x2', K.transClear, parkCx - 1, 8, parkCz - 1);
  const water: [number, number, number][] = [];
  for (let x = fx + 1; x < fx + 7; x++)
    for (let z = fz + 1; z < fz + 7; z++) if (b.isFree(x, 1, z)) water.push([x, z, K.transLightBlue]);
  cells(b, water, 1, true);
  for (const [x, z] of [
    [14, 14],
    [28, 14],
    [14, 28],
    [28, 28],
  ])
    roundTree(put, x, z, 1, K.green);
  place(b, bench(), 0, 11, 1, 18, 4, 2);
  place(b, bench(), 2, 11, 1, 22, 4, 2);
  place(b, bench(), 1, 18, 1, 11, 4, 2);
  place(b, bench(), 3, 22, 1, 11, 4, 2);

  // 人行道上的路灯、红绿灯、行道树
  for (const [x, z, dir] of [
    [-6, -16, 0],
    [6, -16, 2],
    [-16, -6, 3],
    [16, -6, 3],
    [-16, 6, 1],
    [16, 6, 1],
    [-6, 16, 0],
    [6, 16, 2],
  ] as const)
    streetLamp(put, x, z, 1, dir);
  for (const [x, z] of [
    [-7, -7],
    [7, -7],
    [-7, 7],
    [7, 7],
  ])
    trafficLight(put, x, z, 1);
  place(b, busStop(), 0, 21, 1, -9, 6, 4);
  for (const [x, z] of [
    [-7, -26],
    [-26, -7],
    [8, -26],
    [30, -7],
    [-26, 8],
    [-7, 29],
    [8, 26],
    [26, 8],
    // 草地上的树
    [-29, -14],
    [-29, -29],
    [-14, -29],
    [15, -28],
    [27, -28],
    [-26, 30],
    [-14, 30],
  ])
    roundTree(put, x, z, 1, (x + z) % 3 === 0 ? K.brightGreen : K.green);
  // 公园外围绿篱
  rect(put, 10, 30, 32, 32, 1, K.darkGreen, 'brick');
  rect(put, 30, 10, 32, 30, 1, K.darkGreen, 'brick');
  // 草地上的小花
  const fr = rng(77);
  const flowers = [K.red, K.yellow, K.brightPink, K.white, K.orange];
  for (let i = 0; i < 60; i++) {
    const x = 10 + Math.floor(fr() * 20);
    const z = 10 + Math.floor(fr() * 20);
    const s = surface(x, z);
    if (!s || s[0] !== lawn || !b.isFree(x, 1, z, 2)) continue;
    put('round-plate-1x1', flowers[i % flowers.length], x, 2, z);
  }

  // —— 阶段 3：车辆 ——
  for (const br of cars.flat()) b.add(br.part, br.color, br.x, br.y, br.z, br.rot);
  const mObjects = b.bricks.length;

  // —— 阶段 1：地表平滑板 / 草地（y=1，空着的格子）——
  const tiles: [number, number, number][] = [];
  const grass: [number, number, number][] = [];
  for (let x = -32; x < 32; x++)
    for (let z = -32; z < 32; z++) {
      const s = surface(x, z);
      if (!s || !b.isFree(x, 1, z)) continue;
      (s[1] ? tiles : grass).push([x, z, s[0]]);
    }
  cells(b, tiles, 1, true);
  cells(b, grass, 1, false);

  b.assertConnected();
  return reorder(b, [mGround, mObjects], [0, 2, 1]);
}

// ---------------------------------------------------------------------------
// 2. 中世纪城堡
// ---------------------------------------------------------------------------

/** 旗杆与旗帜：杆立在 (x, z)，旗面向 +x 飘；rows 为旗面从上到下每层板的颜色 */
function flag(put: Put, x: number, y: number, z: number, poles: number, rows: number[], w = 2) {
  for (let k = 0; k < poles; k++) put('round-brick-1x1', K.darkGray, x, y + k * 3, z);
  const top = y + poles * 3;
  put(`plate-1x${w + 1}`, rows[0], x, top, z);
  rows.slice(1).forEach((c, i) => put(`plate-1x${w}`, c, x + 1, top - 1 - i, z));
  put(`tile-1x${w}`, rows[0], x + 1, top + 1, z);
  put('round-plate-1x1', K.pearlGold, x, top + 1, z);
}

/** 一圈垛口：沿给定格子（按顺序排好的一行）交替放 1×2 垛与 1×2 平滑板缺口 */
function merlons(put: Put, run: [number, number][], y: number, color: number) {
  for (let i = 0; i < run.length; i += 2) {
    const [x, z] = run[i];
    const pair = i + 1 < run.length;
    const merlon = (i / 2) % 2 === 0 || !pair;
    if (!pair) {
      put('brick-1x1', color, x, y, z);
      continue;
    }
    const [x2, z2] = run[i + 1];
    const rot: Rot = x2 !== x ? 0 : 1;
    const ax = Math.min(x, x2);
    const az = Math.min(z, z2);
    put(merlon ? 'brick-1x2' : 'tile-1x2', color, ax, y, az, rot);
  }
}

/** 用一块砖盖住给定的 1~4 个格子（1×1、1×2、L 形转角砖或 2×2） */
function putCells(put: Put, pts: [number, number][], y: number, color: number) {
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const z0 = Math.min(...zs);
  const w = Math.max(...xs) - x0 + 1;
  if (pts.length === 1) put('brick-1x1', color, x0, y, z0);
  else if (pts.length === 2) put('brick-1x2', color, x0, y, z0, w === 2 ? 0 : 1);
  else if (pts.length === 4) put('brick-2x2', color, x0, y, z0);
  else {
    const has = (a: number, c: number) => pts.some(([px, pz]) => px === x0 + a && pz === z0 + c);
    const rot: Rot = !has(1, 1) ? 0 : !has(1, 0) ? 1 : !has(0, 0) ? 2 : 3;
    put('corner-brick-2x2', color, x0, y, z0, rot);
  }
}

function castleFortress(): BrickData[] {
  const b = new Builder(32, { allowHanging: true });
  const put: Put = (part, color, x, y, z, rot = 0) => void b.add(part, color, x, y, z, rot);
  const r = rng(1215);
  const STONE = -1;
  const ROOF = K.darkRed;

  // —— 护城河、吊桥与小路 ——
  const water: [number, number, number][] = [];
  for (let x = -32; x < 32; x++)
    for (let z = -32; z < 32; z++) {
      const m = Math.max(Math.abs(x + 0.5), Math.abs(z + 0.5));
      if (m < 21.5 || m >= 26.5) continue;
      if (z > 0 && x >= -2 && x < 2) continue;
      water.push([x, z, K.transDarkBlue]);
    }
  cells(b, water, 0, true);
  rect(put, -2, 18, 2, 26, 0, K.reddishBrown);
  rect(put, -2, 18, 2, 26, 1, K.reddishBrown, 'tile');
  rect(put, -2, 26, 2, 32, 0, K.tan, 'tile');
  rect(put, -2, 1, 2, 18, 0, K.darkTan, 'tile');

  // —— 石砌城墙、圆塔、城门楼与主堡（砖层体素）——
  const TOWERS: [number, number][] = [
    [-15, -15],
    [14, -15],
    [-15, 14],
    [14, 14],
  ];
  const towerD2 = (x: number, z: number) => Math.min(...TOWERS.map(([cx, cz]) => (x - cx) ** 2 + (z - cz) ** 2));
  const WL = 5;
  const TL = 9;
  const GL = 7;
  const KL = 12;
  const isWall = (x: number, z: number) =>
    (((x >= -16 && x <= -14) || (x >= 13 && x <= 15)) && z >= -15 && z < 15) ||
    (((z >= -16 && z <= -14) || (z >= 13 && z <= 15)) && x >= -15 && x < 15);
  const inGate = (x: number, z: number) => x >= -5 && x < 5 && z >= 11 && z < 18;
  const inKeep = (x: number, z: number) => x >= -5 && x < 5 && z >= -9 && z < 1;
  const wallCell = (x: number, z: number) => isWall(x, z) && towerD2(x, z) > 20.25 && !inGate(x, z);
  const v = new Voxels(3);
  for (let x = -20; x < 20; x++)
    for (let z = -20; z < 20; z++) {
      const d2 = towerD2(x, z);
      let h = 0;
      if (d2 <= 20.25) h = d2 > 11.56 ? TL - 1 : 0;
      else if (inGate(x, z)) h = GL;
      else if (isWall(x, z)) h = WL;
      else if (inKeep(x, z)) h = x === -5 || x === 4 || z === -9 || z === 0 ? KL : 0;
      // 登城台阶（西墙内侧）
      else if ((x === -13 || x === -12) && z >= 0 && z < 5) h = WL - z;
      for (let l = 0; l < h; l++) {
        if (inGate(x, z)) {
          const edge = x === -5 || x === 4 || z === 11 || z === 17;
          const passage = x >= -2 && x < 2;
          if (l < 3 && passage) continue;
          if (l < 3 && !edge && x !== -3 && x !== 2) continue;
          if (l === 3 && (z === 11 || z === 17) && x >= -3 && x < 3) continue;
          if (l > 3 && !edge) continue;
          if ((l === 4 || l === 5) && z === 17 && (x === -4 || x === 3)) continue;
        }
        if (inKeep(x, z)) {
          if (z === 0 && x >= -1 && x < 1 && l < 2) continue;
          if (z === 0 && x >= -2 && x < 2 && l === 2) continue;
          const win = l === 5 || l === 6 || l === 9 || l === 10;
          if (win && (z === 0 || z === -9) && (x === -3 || x === 2)) continue;
          if (win && (x === -5 || x === 4) && (z === -6 || z === -3)) continue;
        }
        if (d2 <= 20.25) {
          const t = TOWERS.find(([cx, cz]) => (x - cx) ** 2 + (z - cz) ** 2 === d2)!;
          const sx = Math.sign(t[0] + 0.5);
          const sz = Math.sign(t[1] + 0.5);
          const slit =
            ((l === 3 || l === 4 || l === 6 || l === 7) &&
              ((x === t[0] + 4 * sx && z === t[1]) || (x === t[0] && z === t[1] + 4 * sz))) ||
            ((l === 4 || l === 5) && x === t[0] + 3 * sx && z === t[1] + 3 * sz);
          if (slit) continue;
        }
        v.set(x, l, z, STONE);
      }
    }
  v.build(b);
  // 塔顶外挑一圈檐口：每块外挑的砖都压住下面的塔壁（四个象限旋转对称）
  const CORBEL: [number, number][][] = [
    [
      [4, 0],
      [5, 0],
      [4, 1],
      [5, 1],
    ],
    [
      [5, 2],
      [4, 2],
      [4, 3],
    ],
    [
      [3, 3],
      [3, 4],
    ],
    [
      [2, 4],
      [2, 5],
    ],
    [
      [1, 4],
      [1, 5],
    ],
    [[3, 2]],
    [[2, 3]],
  ];
  for (const [cx, cz] of TOWERS)
    for (let q = 0; q < 4; q++)
      for (const piece of CORBEL) {
        let pts = piece;
        for (let i = 0; i < q; i++) pts = pts.map(([a, c]) => [-c, a] as [number, number]);
        putCells(put, pts.map(([a, c]) => [cx + a, cz + c] as [number, number]), (TL - 1) * 3, STONE);
      }

  // 城门拱、主堡拱门与木门
  put('arch-1x6', STONE, -3, 9, 11);
  put('arch-1x6', STONE, -3, 9, 17);
  put('brick-1x2', K.reddishBrown, -1, 0, 0);
  put('brick-1x2', K.reddishBrown, -1, 3, 0);
  put('plate-1x2', K.reddishBrown, -1, 6, 0);
  put('plate-1x2', K.reddishBrown, -1, 7, 0);
  put('arch-1x4', STONE, -2, 6, 0);
  // 半升起的铁闸门与门前火把
  for (let x = -2; x < 2; x++) put('round-brick-1x1', K.darkGray, x, 6, 16);
  put('plate-1x4', K.black, -2, 5, 16);
  for (const x of [-4, 3]) {
    put('round-brick-1x1', K.reddishBrown, x, 0, 18);
    put('round-brick-1x1', K.reddishBrown, x, 3, 18);
    put('cone-1x1', K.transOrange, x, 6, 18);
  }

  // —— 城墙顶：外侧垛口 + 内侧走道 ——
  const walk: [number, number, number][] = [];
  const outer = { W: [] as [number, number][], E: [] as [number, number][], N: [] as [number, number][], S: [] as [number, number][] };
  for (let x = -16; x <= 15; x++)
    for (let z = -16; z <= 15; z++) {
      if (!wallCell(x, z)) continue;
      if (x === -16) outer.W.push([x, z]);
      else if (x === 15) outer.E.push([x, z]);
      else if (z === -16) outer.N.push([x, z]);
      else if (z === 15) outer.S.push([x, z]);
      else walk.push([x, z, K.darkGray]);
    }
  cells(b, walk, WL * 3, true);
  for (const side of Object.values(outer)) {
    side.sort((a, c) => a[0] - c[0] || a[1] - c[1]);
    // 断开的段分别处理
    let seg: [number, number][] = [];
    for (const c of side) {
      const last = seg[seg.length - 1];
      if (last && Math.abs(last[0] - c[0]) + Math.abs(last[1] - c[1]) !== 1) {
        merlons(put, seg, WL * 3, STONE);
        seg = [];
      }
      seg.push(c);
    }
    merlons(put, seg, WL * 3, STONE);
  }

  // —— 城门楼顶 ——
  rect(put, -5, 11, 5, 18, GL * 3, K.darkGray);
  const gy = GL * 3 + 1;
  merlons(put, [-4, -3, -2, -1, 0, 1, 2, 3].map((x) => [x, 17] as [number, number]), gy, STONE);
  merlons(put, [-4, -3, -2, -1, 0, 1, 2, 3].map((x) => [x, 11] as [number, number]), gy, STONE);
  merlons(put, [12, 13, 14, 15, 16].map((z) => [-5, z] as [number, number]), gy, STONE);
  merlons(put, [12, 13, 14, 15, 16].map((z) => [4, z] as [number, number]), gy, STONE);
  flag(put, -5, gy, 17, 3, [K.red, K.red, K.yellow, K.red]);
  flag(put, 4, gy, 17, 3, [K.red, K.red, K.yellow, K.red]);
  put('brick-1x1', STONE, -5, gy, 11);
  put('brick-1x1', STONE, 4, gy, 11);

  // —— 主堡顶：垛口、角楼与大旗 ——
  const ky = KL * 3;
  rect(put, -5, -9, 5, 1, ky, K.darkGray);
  const kTop = ky + 1;
  merlons(put, [-3, -2, -1, 0, 1, 2].map((x) => [x, 0] as [number, number]), kTop, STONE);
  merlons(put, [-3, -2, -1, 0, 1, 2].map((x) => [x, -9] as [number, number]), kTop, STONE);
  merlons(put, [-7, -6, -5, -4, -3, -2].map((z) => [-5, z] as [number, number]), kTop, STONE);
  merlons(put, [-7, -6, -5, -4, -3, -2].map((z) => [4, z] as [number, number]), kTop, STONE);
  for (const [x, z] of [
    [-5, -9],
    [3, -9],
    [-5, -1],
    [3, -1],
  ]) {
    put('round-brick-2x2', STONE, x, kTop, z);
    put('round-brick-2x2', STONE, x, kTop + 3, z);
    put('round-plate-2x2', ROOF, x, kTop + 6, z);
  }
  flag(put, -1, kTop, -5, 4, [K.red, K.red, K.yellow, K.yellow, K.red, K.red], 3);

  // —— 圆塔尖顶（板层体素圆锥）——
  for (const [cx, cz] of TOWERS) {
    const cone = new Voxels(1).cylinder(cx + 0.5, cz + 0.5, 5.6, 0, 12, ROOF, 0).hollow(1);
    cone.build(b, { y0: TL * 3 });
    let top = TL * 3;
    cone.forEach((x, l, z) => {
      if (x === cx && z === cz) top = Math.max(top, TL * 3 + l + 1);
    });
    flag(put, cx, top, cz, 1, [K.red, K.yellow, K.red]);
  }

  // —— 庭院：水井、木桶、货箱、草堆 ——
  put('round-brick-2x2', K.darkGray, -9, 0, 5);
  put('round-plate-2x2', K.transDarkBlue, -9, 3, 5);
  put('round-brick-1x1', K.reddishBrown, -9, 4, 5);
  put('round-brick-1x1', K.reddishBrown, -8, 4, 6);
  put('slope45-2x2', K.reddishBrown, -9, 7, 5);
  for (const [x, z, y] of [
    [9, 6, 0],
    [10, 6, 0],
    [9, 7, 0],
    [9, 6, 3],
  ])
    put('round-brick-1x1', K.reddishBrown, x, y, z);
  put('brick-2x2', K.reddishBrown, 10, 0, 8);
  put('tile-2x2', K.tan, 10, 3, 8);
  // 草垛
  put('round-brick-2x2', K.yellow, 6, 0, -4);
  put('round-brick-2x2', K.yellow, 6, 0, -2);
  put('round-brick-2x2', K.brightLightYellow, 6, 3, -3);
  // 靠东墙的木棚
  for (const z of [-9, -5]) {
    put('brick-1x1', K.reddishBrown, 9, 0, z);
    put('brick-1x1', K.reddishBrown, 9, 3, z);
  }
  for (let k = 0; k < 2; k++) put('brick-1x4', K.reddishBrown, 12, k * 3, -8, 1);
  put('plate-4x6', K.reddishBrown, 9, 6, -10, 1);
  for (const z of [-10, -8, -6]) put('slope45-2x2', K.darkOrange, 9, 7, z, 3);
  for (const z of [-10, -8, -6]) put('brick-2x2', K.darkOrange, 11, 7, z);
  put('brick-2x2', K.tan, 10, 0, -8);
  roundTree(put, 8, 3, 0, K.brightGreen);

  // —— 城外的树 ——
  for (const [x, z] of [
    [-29, -29],
    [29, -29],
    [-29, 29],
    [29, 29],
    [-29, 0],
    [29, 1],
    [0, -29],
    [-14, 29],
    [14, 29],
    [-29, -15],
    [29, -14],
  ])
    roundTree(put, x, z, 0, (x + z) % 2 === 0 ? K.green : K.brightGreen);

  b.assertConnected();
  for (const br of b.bricks) if (br.color === STONE) br.color = r() < 0.68 ? K.lightGray : K.darkGray;
  return b.bricks;
}

// ---------------------------------------------------------------------------
// 3. 海边灯塔
// ---------------------------------------------------------------------------

/** 守塔人小屋（局部：正面朝 +z，占地 5×4） */
function keeperCottage(): BrickData[] {
  return group((put) => {
    for (let layer = 0; layer < 2; layer++)
      ring(put, 0, 0, 5, 4, layer * 3, layer, (x, z) => {
        if (z === 3 && x === 2) return K.reddishBrown;
        if (layer === 1 && ((z === 3 && (x === 1 || x === 3)) || (x === 4 && z === 1) || (z === 0 && x === 2))) return K.transLightBlue;
        return K.white;
      });
    put('slope45-2x4', K.red, 0, 6, 2, 0);
    put('slope45-2x1', K.red, 4, 6, 2, 0);
    put('slope45-2x4', K.red, 0, 6, 0, 2);
    put('slope45-2x1', K.red, 4, 6, 0, 2);
    put('tile-2x4', K.darkRed, 0, 9, 1);
    put('plate-1x2', K.darkRed, 4, 9, 1, 1);
    put('brick-1x1', K.darkGray, 4, 10, 1);
    put('round-plate-1x1', K.darkGray, 4, 13, 1);
    put('tile-1x1', K.darkRed, 4, 10, 2);
  });
}

/** 小渔船（局部：船头朝 +x，占地 8×4） */
function fishingBoat(hull: number, stripe: number): BrickData[] {
  return group((put) => {
    put('brick-2x6', hull, 0, 0, 0);
    put('brick-2x6', hull, 0, 0, 2);
    put('brick-2x2', hull, 6, 0, 1);
    put('plate-2x6', stripe, 0, 3, 0);
    put('plate-2x6', stripe, 0, 3, 2);
    put('plate-2x2', stripe, 6, 3, 1);
    put('tile-1x4', K.tan, 0, 4, 0, 1);
    put('tile-1x2', K.tan, 1, 4, 0);
    put('tile-1x2', K.tan, 1, 4, 3);
    put('tile-2x4', K.tan, 3, 4, 0, 1);
    put('tile-1x4', K.tan, 5, 4, 0, 1);
    put('tile-2x2', K.tan, 6, 4, 1);
    put('brick-2x2', K.white, 1, 4, 1);
    put('brick-2x2', K.transLightBlue, 1, 7, 1);
    put('plate-2x2', stripe, 1, 10, 1);
    put('tile-1x2', stripe, 1, 11, 1, 1);
    put('round-plate-1x1', K.transRed, 2, 11, 2);
    put('tile-1x1', stripe, 2, 11, 1);
  });
}

function lighthouse(): BrickData[] {
  const b = new Builder(16, { allowHanging: true });
  const put: Put = (part, color, x, y, z, rot = 0) => void b.add(part, color, x, y, z, rot);
  // 岛顶平台：从灯塔 A 到小屋 B 的胶囊形
  const A: [number, number] = [-5, -5];
  const B: [number, number] = [1, -2];
  const segDist = (px: number, pz: number) => {
    const vx = B[0] - A[0];
    const vz = B[1] - A[1];
    const u = Math.max(0, Math.min(1, ((px - A[0]) * vx + (pz - A[1]) * vz) / (vx * vx + vz * vz)));
    return Math.hypot(px - A[0] - u * vx, pz - A[1] - u * vz);
  };
  const PLATEAU = 4.2;
  const H0 = 8;
  const mid: [number, number] = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const slopeLen = (px: number, pz: number) => {
    const t = Math.atan2(pz - mid[1], px - mid[0]);
    return 4.2 + 1.4 * Math.sin(3 * t + 0.5) + 0.9 * Math.sin(5 * t + 1.3);
  };
  const height = (x: number, z: number) => {
    const px = x + 0.5;
    const pz = z + 0.5;
    const d = segDist(px, pz);
    if (d <= PLATEAU) return H0;
    const t = (d - PLATEAU) / slopeLen(px, pz);
    if (t >= 1) return 0;
    const n = (noise2(px, pz, 2.5, 3) - 0.5) * 3;
    return Math.max(1, Math.min(H0, Math.round(H0 * (1 - t) ** 1.25 + n)));
  };
  // 水中的礁石
  const boulders: [number, number, number][] = [
    [9.5, -9.5, 1.8],
    [-12, 7, 1.6],
    [-13.5, 9.5, 1.1],
    [11, -6, 1.1],
  ];
  const rockColor = (x: number, z: number) => {
    const n = noise2(x + 0.5, z + 0.5, 2.2, 9);
    return n < 0.42 ? K.darkGray : n < 0.85 ? K.lightGray : K.veryLightGray;
  };
  const H = new Map<string, number>();
  const v = new Voxels(1);
  for (let x = -16; x < 16; x++)
    for (let z = -16; z < 16; z++) {
      let h = height(x, z);
      for (const [bx, bz, br] of boulders) {
        const dd = Math.hypot(x + 0.5 - bx, z + 0.5 - bz);
        if (dd < br) h = Math.max(h, Math.round((br - dd) * 2.4 + hash2(x, z, 5)));
      }
      if (h <= 0) continue;
      H.set(`${x},${z}`, h);
      const onTop = segDist(x + 0.5, z + 0.5) <= PLATEAU;
      for (let l = 0; l < h; l++) {
        let c: number = rockColor(x, z);
        if (h <= 2 && segDist(x + 0.5, z + 0.5) > PLATEAU + 1 && noise2(x, z, 3, 4) > 0.55) c = K.tan;
        if (onTop && l === h - 1) c = hash2(x, z, 2) < 0.2 ? K.brightGreen : K.green;
        v.set(x, l, z, c);
      }
    }
  v.build(b);
  const mIsland = b.bricks.length;

  // —— 东侧木码头与小船 ——
  const water = (x: number, z: number) => !H.has(`${x},${z}`);
  let jx0 = 15;
  while (jx0 > 0 && water(jx0 - 1, 1) && water(jx0 - 1, 2)) jx0--;
  rect(put, jx0, 1, 16, 3, 0, K.reddishBrown);
  rect(put, jx0, 1, 16, 3, 1, K.darkTan, 'tile');
  for (const x of [jx0 + 2, 14]) {
    put('round-brick-1x1', K.reddishBrown, x, 0, 3);
    put('round-plate-1x1', K.reddishBrown, x, 3, 3);
  }
  const boatFree = (x0: number) => {
    for (let x = x0; x < x0 + 8; x++) for (let z = 4; z < 8; z++) if (!water(x, z)) return false;
    return true;
  };
  let bx = 8;
  while (bx > 0 && !boatFree(bx)) bx--;
  place(b, fishingBoat(K.white, K.red), 0, bx, 0, 4, 8, 4);

  // —— 灯塔：红白条纹的圆塔（砖层体素，略有收分）——
  const [cx, cz] = A;
  const TL = 14;
  const tower = new Voxels(3);
  for (let l = 0; l < TL; l++) {
    const rr = 3.2 - (0.65 * l) / (TL - 1);
    const color = Math.floor(l / 2) % 2 === 0 ? K.white : K.red;
    for (let x = cx - 4; x < cx + 4; x++)
      for (let z = cz - 4; z < cz + 4; z++) {
        const inside = (px: number, pz: number) => (px + 0.5 - cx) ** 2 + (pz + 0.5 - cz) ** 2 <= rr * rr;
        if (!inside(x, z)) continue;
        if (inside(x + 1, z) && inside(x - 1, z) && inside(x, z + 1) && inside(x, z - 1)) continue;
        let c: number = color;
        // 门与小窗（朝 +x/+z）
        if (l < 2 && z === cz + 2 && (x === cx - 1 || x === cx)) c = K.reddishBrown;
        if ((l === 5 || l === 9) && x === cx + 2 && z === cz - 1) c = K.transLightBlue;
        if ((l === 7 || l === 11) && z === cz + 2 && x === cx) c = K.transLightBlue;
        tower.set(x, l, z, c);
      }
  }
  tower.build(b, { y0: H0 });

  // —— 观景平台（两层交叉的板，外挑部分全部压在下层上）——
  let y = H0 + TL * 3;
  const deck = K.darkGray;
  put('plate-4x8', deck, cx - 4, y, cz - 2);
  put('plate-1x6', deck, cx - 3, y, cz + 2);
  put('plate-1x4', deck, cx - 2, y, cz + 3);
  put('plate-1x6', deck, cx - 3, y, cz - 3);
  put('plate-1x4', deck, cx - 2, y, cz - 4);
  y += 1;
  put('plate-4x8', deck, cx - 2, y, cz - 4, 1);
  put('plate-2x4', deck, cx + 2, y, cz - 2, 1);
  put('plate-2x4', deck, cx - 4, y, cz - 2, 1);
  for (const [x, z] of [
    [cx + 2, cz + 2],
    [cx - 3, cz + 2],
    [cx + 2, cz - 3],
    [cx - 3, cz - 3],
  ])
    put('plate-1x1', deck, x, y, z);
  y += 1;
  // 栏杆
  const rail: [number, number][] = [];
  for (let x = cx - 4; x < cx + 4; x++)
    for (let z = cz - 4; z < cz + 4; z++) {
      const inD = (px: number, pz: number) => (px + 0.5 - cx) ** 2 + (pz + 0.5 - cz) ** 2 <= 16.81;
      if (inD(x, z) && !(inD(x + 1, z) && inD(x - 1, z) && inD(x, z + 1) && inD(x, z - 1))) rail.push([x, z]);
    }
  for (const [x, z] of rail) put('round-plate-1x1', K.black, x, y, z);
  // 灯室：透明玻璃围着黄色灯
  for (let k = 0; k < 2; k++) {
    put('round-brick-2x2', K.transYellow, cx - 1, y + k * 3, cz - 1);
    for (const [x, z] of [
      [cx - 2, cz - 1],
      [cx - 2, cz],
      [cx + 1, cz - 1],
      [cx + 1, cz],
      [cx - 1, cz - 2],
      [cx, cz - 2],
      [cx - 1, cz + 1],
      [cx, cz + 1],
    ])
      put('round-brick-1x1', K.transClear, x, y + k * 3, z);
  }
  y += 6;
  // 深色圆顶
  put('plate-4x4', K.black, cx - 2, y, cz - 2);
  const dome = new Voxels(1).ellipsoid(cx, 0, cz, 2.3, 2.2, 2.3, K.black);
  dome.carve((_x, yy) => yy < 0);
  dome.build(b, { y0: y + 1 });
  let top = y + 1;
  dome.forEach((_x, l) => (top = Math.max(top, y + 2 + l)));
  put('round-plate-2x2', K.black, cx - 1, top, cz - 1);
  put('round-tile-2x2', K.pearlGold, cx - 1, top + 1, cz - 1);

  // —— 守塔人小屋 ——
  place(b, keeperCottage(), 0, -1, H0, -4, 5, 4);

  // —— 海面：近岸浅色、远处深色，岸边有浪花（回放时紧跟小岛之后出现）——
  const mSea = b.bricks.length;
  const sea: [number, number, number][] = [];
  for (let x = -16; x < 16; x++)
    for (let z = -16; z < 16; z++) {
      if (!b.isFree(x, 0, z)) continue;
      let near = 99;
      for (let dx = -3; dx <= 3; dx++)
        for (let dz = -3; dz <= 3; dz++) if (H.has(`${x + dx},${z + dz}`)) near = Math.min(near, Math.hypot(dx, dz));
      let c: number = near <= 2.3 ? K.transLightBlue : K.transDarkBlue;
      if (near <= 1 && hash2(x, z, 7) < 0.45) c = K.white;
      sea.push([x, z, c]);
    }
  cells(b, sea, 0, true);

  b.assertConnected();
  return reorder(b, [mIsland, mSea], [0, 2, 1]);
}

// ---------------------------------------------------------------------------
// 4. 石拱桥
// ---------------------------------------------------------------------------

/** 小划艇（局部：船头朝 +x，占地 6×4，两侧各伸出一支桨） */
function rowBoat(): BrickData[] {
  return group((put) => {
    const hull = K.reddishBrown;
    const rim = K.darkOrange;
    put('plate-2x6', hull, 0, 0, 1);
    put('plate-1x4', hull, 1, 0, 0);
    put('plate-1x4', hull, 1, 0, 3);
    put('plate-1x4', rim, 1, 1, 0);
    put('plate-1x4', rim, 1, 1, 3);
    put('plate-1x2', rim, 0, 1, 1, 1);
    put('plate-1x2', rim, 5, 1, 1, 1);
    put('tile-1x2', K.tan, 2, 1, 1, 1);
    put('tile-1x2', K.tan, 4, 1, 1, 1);
    // 船桨搭在船舷上
    put('plate-1x3', K.tan, 3, 2, -2, 1);
    put('plate-1x3', K.tan, 3, 2, 3, 1);
    for (const z of [0, 3]) {
      put('tile-1x2', rim, 1, 2, z);
      put('tile-1x1', rim, 4, 2, z);
    }
    put('tile-1x2', rim, 0, 2, 1, 1);
    put('tile-1x2', rim, 5, 2, 1, 1);
  });
}

function stoneBridge(): BrickData[] {
  const b = new Builder(16, { allowHanging: true });
  const put: Put = (part, color, x, y, z, rot = 0) => void b.add(part, color, x, y, z, rot);
  // 河道沿 z 方向（流向镜头），桥沿 x 方向跨河
  const riverC = (z: number) => 1.2 * Math.sin(z * 0.22 + 0.4);
  const HALF = 5;
  const BANK = 6;
  const edge = (x: number, z: number) => Math.abs(x + 0.5 - riverC(z + 0.5)) - HALF;
  const bankH = (x: number, z: number) => {
    const e = edge(x, z);
    if (e < 0) return 0;
    if (e >= 2.5) return BANK;
    return Math.max(2, Math.min(BANK, Math.round(2 + e * 1.7 + (hash2(x, z, 11) - 0.5) * 1.5)));
  };
  // 桥：x∈[-12,12)、z∈[-3,3)，驼背形桥面
  const BZ0 = -3;
  const BZ1 = 3;
  const deck = (x: number) => Math.round(6 + 11 * (1 - ((x + 0.5) / 11.8) ** 2));
  const inBridge = (x: number, z: number) => x >= -12 && x < 12 && z >= BZ0 && z < BZ1;
  const R = 5.1;
  const YC = 0.4;
  const v = new Voxels(1);
  const top = new Voxels(1);
  const stone = (x: number, l: number, z: number) => {
    const n = hash2(x * 3 + l, z * 5 - l, 21);
    return n < 0.3 ? K.darkGray : n < 0.4 ? K.veryLightGray : K.lightGray;
  };
  const isPath = (z: number) => z >= -2 && z < 2;
  const LAMPS: [number, number][] = [
    [-11, BZ0],
    [-11, BZ1 - 1],
    [10, BZ0],
    [10, BZ1 - 1],
  ];
  const lampAt = (x: number, z: number) => LAMPS.some(([lx, lz]) => lx === x && lz === z);
  const H = new Map<string, number>();
  for (let x = -16; x < 16; x++)
    for (let z = -16; z < 16; z++) {
      if (inBridge(x, z)) {
        const parapet = z === BZ0 || z === BZ1 - 1;
        const h = Math.max(deck(x), bankH(x, z)) + (parapet ? 3 : 0);
        H.set(`${x},${z}`, h);
        for (let l = 0; l < h; l++) {
          const yc = (l + 0.5) * 0.4;
          const d = Math.hypot(x + 0.5, yc - YC);
          if (d < R) continue;
          const ring = d < R + 1.3;
          const c = ring ? (hash2(x, l, 4) < 0.5 ? K.darkTan : K.tan) : stone(x, l, z);
          if (l === h - 1 && !lampAt(x, z)) top.set(x, l, z, parapet ? K.lightGray : K.darkTan);
          else v.set(x, l, z, l === h - 1 ? K.lightGray : c);
        }
        continue;
      }
      const h = bankH(x, z);
      if (h === 0) continue;
      H.set(`${x},${z}`, h);
      const e = edge(x, z);
      const path = isPath(z) && Math.abs(x) >= 12;
      for (let l = 0; l < h; l++) {
        let c: number = l < h - 1 ? K.darkTan : e < 1.2 ? (hash2(x, z, 8) < 0.5 ? K.darkGray : K.lightGray) : hash2(x, z, 2) < 0.15 ? K.brightGreen : K.green;
        if (l === h - 1 && path) {
          top.set(x, l, z, K.tan);
          continue;
        }
        if (l < h - 1 && e < 1.2) c = K.lightGray;
        v.set(x, l, z, c);
      }
    }
  v.build(b);
  top.build(b, { tileTop: true });

  // —— 河床与水面 ——
  const bed: [number, number, number][] = [];
  for (let x = -16; x < 16; x++) for (let z = -16; z < 16; z++) if (b.isFree(x, 0, z)) bed.push([x, z, K.blue]);
  cells(b, bed, 0, false, true);
  // 划艇与小鸭子（立在河床上）
  place(b, rowBoat(), 3, -5, 1, 7, 6, 8);
  for (const [x, z] of [
    [-2, -10],
    [-1, -8],
    [1, -11],
  ]) {
    put('plate-1x2', K.white, x, 1, z, 1);
    put('round-plate-1x1', K.white, x, 2, z);
    put('tile-1x1', K.orange, x, 3, z);
  }
  const water: [number, number, number][] = [];
  for (let x = -16; x < 16; x++)
    for (let z = -16; z < 16; z++) {
      if (!b.isFree(x, 1, z) || H.has(`${x},${z}`)) continue;
      water.push([x, z, edge(x, z) > -1.2 || hash2(x, z, 13) < 0.12 ? K.transLightBlue : K.transDarkBlue]);
    }
  cells(b, water, 1, true, true);

  // —— 桥头灯柱 ——
  for (const [x, z] of LAMPS) {
    const y0 = H.get(`${x},${z}`)!;
    put('round-brick-1x1', K.black, x, y0, z);
    put('round-brick-1x1', K.black, x, y0 + 3, z);
    put('round-brick-1x1', K.transYellow, x, y0 + 6, z);
    put('cone-1x1', K.black, x, y0 + 9, z);
  }

  // —— 岸上的树、灌木与小花 ——
  for (const [x, z] of [
    [-12, -11],
    [-10, 11],
    [12, -10],
    [13, 10],
    [9, -14],
    [-14, 6],
  ])
    roundTree(put, x, z, BANK, (x + z) % 2 === 0 ? K.green : K.brightGreen);
  const fr = rng(5);
  const flowers = [K.red, K.yellow, K.white, K.brightPink, K.mediumLavender];
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(fr() * 32) - 16;
    const z = Math.floor(fr() * 32) - 16;
    if (H.get(`${x},${z}`) !== BANK || inBridge(x, z) || isPath(z) || edge(x, z) < 2.5) continue;
    if (!b.isFree(x, BANK, z)) continue;
    if (fr() < 0.2) put('round-brick-1x1', K.darkGreen, x, BANK, z);
    else put('round-plate-1x1', flowers[i % flowers.length], x, BANK, z);
  }

  b.assertConnected();
  return b.bricks;
}

// ---------------------------------------------------------------------------
// 5. 复古小汽车
// ---------------------------------------------------------------------------

/**
 * 侧看是圆形的车轮（9 层板高、4 格宽、2 格厚），外侧面中央是轮毂 cap、上下一圈是轮圈 rim。
 * 逐层手工拼：边缘的竖向小板与内侧横板交替，保证每块都扣在一起。
 * x0 为最左一列，zi / zo 为内侧 / 外侧格。
 */
function wheel(put: Put, x0: number, zi: number, zo: number, rim: number, cap: number) {
  const z0 = Math.min(zi, zo);
  const side = (y: number, c: number) => put('plate-1x2', c, x0 + 1, y, zo);
  put('plate-2x2', K.black, x0 + 1, 0, z0);
  put('plate-1x2', K.black, x0 + 1, 1, zi);
  side(1, rim);
  for (let y = 2; y <= 6; y++) {
    const centre = y === 2 || y === 6 ? rim : cap;
    if (y % 2 === 0) {
      put('plate-1x4', K.black, x0, y, zi);
      put('plate-1x1', K.black, x0, y, zo);
      put('plate-1x1', K.black, x0 + 3, y, zo);
    } else {
      put('plate-1x2', K.black, x0, y, z0, 1);
      put('plate-1x2', K.black, x0 + 3, y, z0, 1);
      put('plate-1x2', K.black, x0 + 1, y, zi);
    }
    side(y, centre);
  }
  put('plate-2x2', K.black, x0 + 1, 7, z0);
  put('plate-2x2', K.black, x0 + 1, 8, z0);
}

function retroCar(): BrickData[] {
  const b = new Builder(12, { allowHanging: true });
  const put: Put = (part, color, x, y, z, rot = 0) => void b.add(part, color, x, y, z, rot);
  const BODY = K.azure;
  const ROOF = K.white;
  const CHROME = K.flatSilver;
  const ZC = -1; // 车身中线（z）
  const WX = 4; // 前后轮中心 x = ±4
  const WY = 1.8;
  // 车轮占的格子：x∈[±4-2, ±4+2)，z 为车身两侧各 2 格，高 9 层板
  const wheelZ = [
    [ZC - 3, ZC - 4],
    [ZC + 2, ZC + 3],
  ];
  const inWheelBox = (x: number, y: number, z: number) => {
    const dx = Math.abs(Math.abs(x) - WX);
    const l = Math.floor(y / 0.4);
    const inside = dx < 1 ? l <= 8 : dx < 2 && l >= 2 && l <= 6;
    return inside && wheelZ.some(([zi, zo]) => Math.floor(z) === zi || Math.floor(z) === zo);
  };

  // 车身中段（6 格宽）、四个鼓起的翼子板（8 格宽）、踏板、内收的车厢
  const core = (x: number, y: number, dz: number) => y >= 1.0 && (x / 6.8) ** 4 + ((y - 2.7) / 1.75) ** 4 + (dz / 3.1) ** 8 <= 1;
  const fender = (x: number, y: number, dz: number) =>
    y >= 1.2 && dz < 4 && Math.min(((x - WX) / 2.9) ** 2, ((x + WX) / 2.9) ** 2) + ((y - 1.9) / 2.75) ** 2 <= 1;
  const board = (x: number, y: number, dz: number) => y >= 1.2 && y < 1.6 && Math.abs(x) < 2 && dz < 4;
  const cabin = (x: number, y: number, dz: number) =>
    y >= 4.2 && Math.abs((x + 0.5) / 3.8) ** 2.5 + Math.abs((y - 4.2) / 2.5) ** 2.5 + Math.abs(dz / 2.3) ** 3 <= 1;
  const v = new Voxels(1);
  v.fill(-10, 10, 0, 7, ZC - 5, ZC + 5, (x, y, z) => {
    const dz = Math.abs(z - ZC);
    return core(x, y, dz) || fender(x, y, dz) || board(x, y, dz) || cabin(x, y, dz) ? BODY : null;
  });
  // 给车轮让位；外侧再挖出轮拱
  v.carve((x, y, z) => inWheelBox(x, y, z));
  v.carve((x, y, z) => Math.abs(z - ZC) > 3 && Math.min(Math.hypot(x - WX, y - WY), Math.hypot(x + WX, y - WY)) < 2.2);
  v.hollow(1);
  // 车内座椅（透过车窗可见）
  v.fill(-10, 10, 0, 7, ZC - 5, ZC + 5, (x, y, z) => {
    const dz = Math.abs(z - ZC);
    if (dz > 2 || y < 2.0 || v.has(Math.floor(x), Math.floor(y / 0.4), Math.floor(z))) return null;
    if (x > 0.4 && x < 2.0 && y < 3.6) return K.tan;
    if (x > -0.4 && x < 0.4 && y < 4.8) return K.tan;
    if (x > -3.6 && x < -2.2 && y < 3.6) return K.tan;
    if (x > -4.2 && x < -3.6 && y < 4.8) return K.tan;
    return null;
  });
  // 涂装：白色车顶、车窗、车灯、格栅、尾灯
  v.paint((x, y, z, c) => {
    if (c !== BODY) return null;
    const dz = Math.abs(z - ZC);
    if (cabin(x, y, dz) && !core(x, y, dz) && !fender(x, y, dz)) {
      if (y >= 5.9) return ROOF;
      if (Math.abs(x + 0.5) < 0.5 && dz > 1.4) return BODY; // B 柱
      return K.transLightBlue;
    }
    if (x > 5.9 && dz > 3 && y > 2.3 && y < 3.3) return K.transYellow; // 翼子板上的大圆灯
    if (x > 5.8 && dz < 1.5 && y > 1.6 && y < 3.6) return CHROME; // 格栅
    if (x < -5.9 && dz > 3 && y > 2.3 && y < 3.3) return K.transRed;
    return null;
  });
  // 镀银保险杠（向前后伸出，内侧压住车身）
  v.fill(-10, 10, 1.2, 2.0, ZC - 4, ZC + 4, (x, y, z) =>
    Math.abs(x) > 6 && Math.abs(x) < 8 && Math.abs(z - ZC) < 3.6 && y >= 1.2 && y < 2.0 ? CHROME : null,
  );
  buildSmooth(b, v);
  const mBody = b.bricks.length;
  for (const cx of [-WX, WX]) for (const [zi, zo] of wheelZ) wheel(put, cx - 2, zi, zo, K.black, CHROME);
  const mWheels = b.bricks.length;

  // —— 路面、车位线、人行道 ——
  const road: [number, number, number][] = [];
  for (let x = -12; x < 12; x++)
    for (let z = -6; z < 6; z++) {
      if (!b.isFree(x, 0, z)) continue;
      let c: number = K.darkGray;
      if (z === 4 && (x + 12) % 6 < 3) c = K.white;
      if ((x === -10 || x === 9) && z < 3) c = K.white;
      road.push([x, z, c]);
    }
  cells(b, road, 0, true);
  const WALK = [-9, -8, -7, 6, 7, 8];
  const walk: [number, number, number][] = [];
  for (let x = -12; x < 12; x++) for (const z of WALK) walk.push([x, z, K.lightGray]);
  cells(b, walk, 0, false);
  const mGround = b.bricks.length;
  // 路灯、消防栓、长椅、行道树
  for (let k = 0; k < 5; k++) put('round-brick-1x1', K.black, 9, 1 + k * 3, -8);
  put('plate-1x3', K.black, 9, 16, -8, 1);
  put('round-plate-1x1', K.transYellow, 9, 15, -6);
  put('tile-1x3', K.black, 9, 17, -8, 1);
  put('round-brick-1x1', K.red, -11, 1, -8);
  put('round-plate-1x1', K.red, -11, 4, -8);
  put('plate-1x1', K.flatSilver, -11, 5, -8);
  place(b, bench(), 0, -7, 1, -9, 4, 2);
  roundTree(put, 3, -8, 1, K.green);
  roundTree(put, -7, 8, 1, K.brightGreen);
  const walkTop: [number, number, number][] = [];
  for (let x = -12; x < 12; x++) for (const z of WALK) if (b.isFree(x, 1, z)) walkTop.push([x, z, K.lightGray]);
  cells(b, walkTop, 1, true);
  // 草地上的小花
  for (let x = -12; x < 12; x++)
    for (const z of [-12, -11, -10, 9, 10, 11]) {
      const n = hash2(x, z, 31);
      if (n < 0.12) put('round-plate-1x1', [K.red, K.yellow, K.white, K.brightPink][Math.floor(hash2(x, z, 33) * 4)], x, 0, z);
    }

  b.assertConnected();
  // 回放顺序：先铺路面，再装车轮、车身，最后是街景
  return reorder(b, [mBody, mWheels, mGround], [2, 1, 0, 3]);
}

/** 示例作品 · 城市与建筑 */
export const CITY_TEMPLATES: Template[] = [
  {
    id: 'city-block',
    level: 3,
    name: { zh: '城市街区', en: 'City Block' },
    description: {
      zh: '十字路口的城市一角：玻璃写字楼、红砖公寓、条纹遮阳棚小店和带喷泉的街心公园，还有斑马线、红绿灯、路灯、公交站、红色巴士和来往的小汽车。',
      en: 'A busy crossroads with a glass office tower, a red-brick apartment block, a corner shop with a striped awning and a little park with a fountain — plus zebra crossings, traffic lights, street lamps, a bus stop, a red bus and cars.',
    },
    baseplateSize: 64,
    baseplateColor: C.darkGray,
    build: cityBlock,
  },
  {
    id: 'castle-fortress',
    level: 3,
    name: { zh: '中世纪城堡', en: 'Medieval Fortress' },
    description: {
      zh: '护城河环绕的石砌要塞：四座尖顶圆塔、带垛口和走道的城墙、拱门城楼与吊桥，中央是高耸的主堡，处处飘着旗帜。',
      en: 'A moated stone fortress with four round towers under pointed roofs, crenellated curtain walls with a wall-walk, an arched gatehouse and drawbridge, a tall central keep and flags flying everywhere.',
    },
    baseplateSize: 64,
    baseplateColor: C.green,
    build: castleFortress,
  },
  {
    id: 'lighthouse',
    level: 2,
    name: { zh: '海边灯塔', en: 'Lighthouse' },
    description: {
      zh: '礁石小岛上的红白条纹灯塔：黄色灯光的灯室、深色圆顶、守塔人小屋，木码头边停着一艘小渔船。',
      en: 'A red-and-white striped lighthouse on a rocky island, with a glowing lantern room, a dark dome, the keeper’s cottage and a little fishing boat at the jetty.',
    },
    baseplateSize: 32,
    baseplateColor: C.blue,
    build: lighthouse,
  },
  {
    id: 'stone-bridge',
    level: 2,
    name: { zh: '石拱桥', en: 'Stone Arch Bridge' },
    description: {
      zh: '一座驼背石拱桥跨过蜿蜒的小河，桥头立着灯柱；两岸绿草如茵、树木成荫，河面上漂着小划艇，还有几只小鸭子。',
      en: 'A hump-backed stone arch bridge with lamp posts spans a winding river; grassy banks, shady trees, a little rowing boat and a few ducks complete the scene.',
    },
    baseplateSize: 32,
    baseplateColor: C.green,
    build: stoneBridge,
  },
  {
    id: 'retro-car',
    level: 2,
    name: { zh: '复古小汽车', en: 'Retro Car' },
    description: {
      zh: '圆润可爱的天蓝色复古小汽车：鼓鼓的翼子板、白色车顶、镀银保险杠与轮毂、翼子板上的大车灯，透过车窗还能看到座椅，安静地停在路边车位里。',
      en: 'A rounded sky-blue retro car with bulging fenders, a white roof, chrome bumpers and hubcaps and big fender headlights — you can even see the seats through the windows — parked by the kerb.',
    },
    baseplateSize: 24,
    baseplateColor: C.green,
    build: retroCar,
  },
];

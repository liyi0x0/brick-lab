import type { Brick, Rot } from './types';

export type PartCategory = 'brick' | 'plate' | 'tile' | 'slope' | 'round' | 'special';

export type PartShape =
  /** 长方体：砖、板、平滑砖 */
  | { kind: 'box'; studs: boolean }
  /** 斜坡：高侧在 z=0（后），向 +z（前）下降；run = 斜面覆盖的凸点数 */
  | { kind: 'slope'; run: number; inverted: boolean }
  /** 圆形：圆柱或圆锥 */
  | { kind: 'round'; profile: 'cylinder' | 'cone'; studs: boolean }
  /** L 形转角：缺少 (w-1, d-1) 这一格 */
  | { kind: 'corner'; studs: boolean }
  /** 拱：开口沿 x 居中，span = 开口宽（凸点），rise = 开口高（板） */
  | { kind: 'arch'; span: number; rise: number };

export interface PartDef {
  id: string;
  /** 稳定的数字编码，用于分享链接压缩，永远不要复用或修改 */
  code: number;
  /** LDraw 零件文件名（不含 .dat） */
  ldraw: string;
  /** BrickLink 编号（与 LDraw 不同时才填写） */
  bricklink?: string;
  name: { zh: string; en: string };
  category: PartCategory;
  /** 未旋转时沿 X 的凸点数 */
  w: number;
  /** 未旋转时沿 Z 的凸点数 */
  d: number;
  /** 高度（板数） */
  h: number;
  shape: PartShape;
}

export const CATEGORIES: { id: PartCategory; zh: string; en: string }[] = [
  { id: 'brick', zh: '砖块', en: 'Bricks' },
  { id: 'plate', zh: '薄板', en: 'Plates' },
  { id: 'tile', zh: '平滑板', en: 'Tiles' },
  { id: 'slope', zh: '斜坡', en: 'Slopes' },
  { id: 'round', zh: '圆形', en: 'Round' },
  { id: 'special', zh: '特殊', en: 'Special' },
];

const parts: PartDef[] = [];

function def(p: PartDef) {
  parts.push(p);
}

function sizeName(w: number, d: number) {
  return `${Math.min(w, d)}×${Math.max(w, d)}`;
}

// ---------- 砖块 ----------
const bricks: [number, number, string, number][] = [
  [1, 1, '3005', 1],
  [2, 1, '3004', 2],
  [3, 1, '3622', 3],
  [4, 1, '3010', 4],
  [6, 1, '3009', 5],
  [8, 1, '3008', 6],
  [2, 2, '3003', 7],
  [3, 2, '3002', 8],
  [4, 2, '3001', 9],
  [6, 2, '2456', 10],
  [8, 2, '3007', 11],
  [10, 2, '3006', 12],
];
for (const [w, d, ldraw, code] of bricks) {
  def({
    id: `brick-${d}x${w}`,
    code,
    ldraw,
    name: { zh: `砖 ${sizeName(w, d)}`, en: `Brick ${sizeName(w, d)}` },
    category: 'brick',
    w,
    d,
    h: 3,
    shape: { kind: 'box', studs: true },
  });
}

// ---------- 薄板 ----------
const plates: [number, number, string, number][] = [
  [1, 1, '3024', 20],
  [2, 1, '3023b', 21],
  [3, 1, '3623', 22],
  [4, 1, '3710', 23],
  [6, 1, '3666', 24],
  [8, 1, '3460', 25],
  [2, 2, '3022', 26],
  [3, 2, '3021', 27],
  [4, 2, '3020', 28],
  [6, 2, '3795', 29],
  [8, 2, '3034', 30],
  [4, 4, '3031', 31],
  [6, 4, '3032', 32],
  [8, 4, '3035', 33],
  [6, 6, '3958', 34],
  [8, 6, '3036', 35],
  [8, 8, '41539', 36],
];
for (const [w, d, ldraw, code] of plates) {
  def({
    id: `plate-${d}x${w}`,
    code,
    ldraw,
    name: { zh: `板 ${sizeName(w, d)}`, en: `Plate ${sizeName(w, d)}` },
    category: 'plate',
    w,
    d,
    h: 1,
    shape: { kind: 'box', studs: true },
  });
}

// ---------- 平滑板 ----------
const tiles: [number, number, string, number][] = [
  [1, 1, '3070b', 40],
  [2, 1, '3069b', 41],
  [3, 1, '63864', 42],
  [4, 1, '2431', 43],
  [6, 1, '6636', 44],
  [2, 2, '3068b', 45],
  [4, 2, '87079', 46],
];
for (const [w, d, ldraw, code] of tiles) {
  def({
    id: `tile-${d}x${w}`,
    code,
    ldraw,
    name: { zh: `平滑板 ${sizeName(w, d)}`, en: `Tile ${sizeName(w, d)}` },
    category: 'tile',
    w,
    d,
    h: 1,
    shape: { kind: 'box', studs: false },
  });
}

// ---------- 斜坡 ----------
const slopes: [string, number, number, number, boolean, string, number, string, string][] = [
  ['slope45-2x1', 1, 2, 1, false, '3040b', 60, '斜坡 45° 2×1', 'Slope 45° 2×1'],
  ['slope45-2x2', 2, 2, 1, false, '3039', 61, '斜坡 45° 2×2', 'Slope 45° 2×2'],
  ['slope45-2x3', 3, 2, 1, false, '3038', 62, '斜坡 45° 2×3', 'Slope 45° 2×3'],
  ['slope45-2x4', 4, 2, 1, false, '3037', 63, '斜坡 45° 2×4', 'Slope 45° 2×4'],
  ['slope33-3x1', 1, 3, 2, false, '4286', 64, '斜坡 33° 3×1', 'Slope 33° 3×1'],
  ['slope33-3x2', 2, 3, 2, false, '3298', 65, '斜坡 33° 3×2', 'Slope 33° 3×2'],
  ['slope45inv-2x1', 1, 2, 1, true, '3665b', 66, '反斜坡 45° 2×1', 'Inverted Slope 45° 2×1'],
  ['slope45inv-2x2', 2, 2, 1, true, '3660b', 67, '反斜坡 45° 2×2', 'Inverted Slope 45° 2×2'],
];
for (const [id, w, d, run, inverted, ldraw, code, zh, en] of slopes) {
  def({
    id,
    code,
    ldraw,
    name: { zh, en },
    category: 'slope',
    w,
    d,
    h: 3,
    shape: { kind: 'slope', run, inverted },
  });
}

// ---------- 圆形 ----------
def({
  id: 'round-brick-1x1',
  code: 80,
  ldraw: '3062b',
  name: { zh: '圆砖 1×1', en: 'Round Brick 1×1' },
  category: 'round',
  w: 1,
  d: 1,
  h: 3,
  shape: { kind: 'round', profile: 'cylinder', studs: true },
});
def({
  id: 'round-plate-1x1',
  code: 81,
  ldraw: '6141',
  bricklink: '4073',
  name: { zh: '圆板 1×1', en: 'Round Plate 1×1' },
  category: 'round',
  w: 1,
  d: 1,
  h: 1,
  shape: { kind: 'round', profile: 'cylinder', studs: true },
});
def({
  id: 'round-tile-1x1',
  code: 82,
  ldraw: '98138',
  name: { zh: '圆平滑板 1×1', en: 'Round Tile 1×1' },
  category: 'round',
  w: 1,
  d: 1,
  h: 1,
  shape: { kind: 'round', profile: 'cylinder', studs: false },
});
def({
  id: 'round-brick-2x2',
  code: 83,
  ldraw: '6143',
  bricklink: '3941',
  name: { zh: '圆砖 2×2', en: 'Round Brick 2×2' },
  category: 'round',
  w: 2,
  d: 2,
  h: 3,
  shape: { kind: 'round', profile: 'cylinder', studs: true },
});
def({
  id: 'round-plate-2x2',
  code: 84,
  ldraw: '4032b',
  bricklink: '4032',
  name: { zh: '圆板 2×2', en: 'Round Plate 2×2' },
  category: 'round',
  w: 2,
  d: 2,
  h: 1,
  shape: { kind: 'round', profile: 'cylinder', studs: true },
});
def({
  id: 'round-tile-2x2',
  code: 85,
  ldraw: '14769',
  name: { zh: '圆平滑板 2×2', en: 'Round Tile 2×2' },
  category: 'round',
  w: 2,
  d: 2,
  h: 1,
  shape: { kind: 'round', profile: 'cylinder', studs: false },
});
def({
  id: 'cone-1x1',
  code: 86,
  ldraw: '59900',
  bricklink: '4589b',
  name: { zh: '圆锥 1×1', en: 'Cone 1×1' },
  category: 'round',
  w: 1,
  d: 1,
  h: 3,
  shape: { kind: 'round', profile: 'cone', studs: true },
});

// ---------- 特殊 ----------
def({
  id: 'corner-brick-2x2',
  code: 100,
  ldraw: '2357',
  name: { zh: '转角砖 2×2', en: 'Corner Brick 2×2' },
  category: 'special',
  w: 2,
  d: 2,
  h: 3,
  shape: { kind: 'corner', studs: true },
});
def({
  id: 'corner-plate-2x2',
  code: 101,
  ldraw: '2420',
  name: { zh: '转角板 2×2', en: 'Corner Plate 2×2' },
  category: 'special',
  w: 2,
  d: 2,
  h: 1,
  shape: { kind: 'corner', studs: true },
});
def({
  id: 'arch-1x4',
  code: 102,
  ldraw: '3659',
  name: { zh: '拱门 1×4', en: 'Arch 1×4' },
  category: 'special',
  w: 4,
  d: 1,
  h: 3,
  shape: { kind: 'arch', span: 2, rise: 2 },
});
def({
  id: 'arch-1x6',
  code: 103,
  ldraw: '3455',
  name: { zh: '拱门 1×6', en: 'Arch 1×6' },
  category: 'special',
  w: 6,
  d: 1,
  h: 3,
  shape: { kind: 'arch', span: 4, rise: 2 },
});
def({
  id: 'brick-1x1x3',
  code: 104,
  ldraw: '14716',
  name: { zh: '高砖 1×1×3', en: 'Brick 1×1×3' },
  category: 'special',
  w: 1,
  d: 1,
  h: 9,
  shape: { kind: 'box', studs: true },
});
def({
  id: 'brick-1x2x3',
  code: 105,
  ldraw: '22886',
  name: { zh: '高砖 1×2×3', en: 'Brick 1×2×3' },
  category: 'special',
  w: 2,
  d: 1,
  h: 9,
  shape: { kind: 'box', studs: true },
});

export const PARTS: readonly PartDef[] = parts;

const byId = new Map(parts.map((p) => [p.id, p]));
const byCode = new Map(parts.map((p) => [p.code, p]));

export function getPart(id: string): PartDef {
  const p = byId.get(id);
  if (!p) throw new Error(`Unknown part: ${id}`);
  return p;
}

/** BrickLink 编号：默认去掉 LDraw 文件名中表示模具版本的字母后缀 */
export function bricklinkId(p: PartDef): string {
  return p.bricklink ?? p.ldraw.replace(/[a-z]$/, '');
}

export function findPart(id: string): PartDef | undefined {
  return byId.get(id);
}

export function partByCode(code: number): PartDef | undefined {
  return byCode.get(code);
}

export const DEFAULT_PART = 'brick-2x4';

// ---------------------------------------------------------------------------
// 旋转与占位计算
// ---------------------------------------------------------------------------

/** 旋转后的占地尺寸 [沿 X, 沿 Z] */
export function rotatedSize(part: PartDef, rot: Rot): [number, number] {
  return rot % 2 === 0 ? [part.w, part.d] : [part.d, part.w];
}

/** 把局部格子坐标 (lx, lz) 旋转到占地矩形中（与 three.js 绕 +Y 旋转一致） */
export function rotateCell(lx: number, lz: number, w: number, d: number, rot: Rot): [number, number] {
  switch (rot) {
    case 0:
      return [lx, lz];
    case 1:
      return [lz, w - 1 - lx];
    case 2:
      return [w - 1 - lx, d - 1 - lz];
    case 3:
      return [d - 1 - lz, lx];
  }
}

/** 连续坐标版本（u∈[0,w], v∈[0,d]） */
export function rotatePoint(u: number, v: number, w: number, d: number, rot: Rot): [number, number] {
  switch (rot) {
    case 0:
      return [u, v];
    case 1:
      return [v, w - u];
    case 2:
      return [w - u, d - v];
    case 3:
      return [d - v, u];
  }
}

/** 局部占地格子 */
export function footprintCells(part: PartDef): [number, number][] {
  const cells: [number, number][] = [];
  for (let x = 0; x < part.w; x++) {
    for (let z = 0; z < part.d; z++) {
      if (part.shape.kind === 'corner' && x === part.w - 1 && z === part.d - 1) continue;
      cells.push([x, z]);
    }
  }
  return cells;
}

const voxelCache = new Map<string, [number, number, number][]>();

/** 局部占位体素 [x, y, z] */
export function localVoxels(part: PartDef): [number, number, number][] {
  let v = voxelCache.get(part.id);
  if (v) return v;
  v = [];
  const shape = part.shape;
  for (const [x, z] of footprintCells(part)) {
    for (let y = 0; y < part.h; y++) {
      if (shape.kind === 'arch') {
        const x0 = (part.w - shape.span) / 2;
        if (x >= x0 && x < x0 + shape.span && y < shape.rise) continue;
      }
      v.push([x, y, z]);
    }
  }
  voxelCache.set(part.id, v);
  return v;
}

/** 顶部凸点所在的局部格子 */
export function topStudCells(part: PartDef): [number, number][] {
  const s = part.shape;
  switch (s.kind) {
    case 'box':
      return s.studs ? footprintCells(part) : [];
    case 'slope':
      return s.inverted ? footprintCells(part) : footprintCells(part).filter(([, z]) => z < part.d - s.run);
    case 'round':
      return s.studs ? footprintCells(part) : [];
    case 'corner':
      return s.studs ? footprintCells(part) : [];
    case 'arch':
      return footprintCells(part);
  }
}

/** 一块积木在世界网格中占据的体素 */
export function brickVoxels(b: Pick<Brick, 'part' | 'x' | 'y' | 'z' | 'rot'>): [number, number, number][] {
  const part = getPart(b.part);
  return localVoxels(part).map(([lx, ly, lz]) => {
    const [rx, rz] = rotateCell(lx, lz, part.w, part.d, b.rot);
    return [b.x + rx, b.y + ly, b.z + rz];
  });
}

/** 积木的包围盒（网格坐标，max 为开区间） */
export function brickBounds(b: Pick<Brick, 'part' | 'x' | 'y' | 'z' | 'rot'>) {
  const part = getPart(b.part);
  const [fw, fd] = rotatedSize(part, b.rot);
  return { x0: b.x, y0: b.y, z0: b.z, x1: b.x + fw, y1: b.y + part.h, z1: b.z + fd };
}

import { PLATE_H } from './constants';
import { getPart, PARTS, rotatedSize, type PartDef } from './parts';
import type { Brick } from './types';

// LDraw 坐标系：-Y 朝上，1 凸点 = 20 LDU，1 板 = 8 LDU。
// 本项目坐标（Y 朝上、右手系）到 LDraw 的映射为绕 X 轴旋转 180°：(x, y, z) → (20x, -20y, -20z)。

type Mat3 = [number, number, number, number, number, number, number, number, number];

/** 转角件：LDraw 原生缺角在 (+X,+Z)，本项目在 (+x,+z)（对应 LDraw 的 +X/-Z），需额外旋转 */
const CORNER_Q: Mat3 = [0, 0, 1, 0, 1, 0, -1, 0, 0];

function mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

/** LDraw 零件原点在本项目零件局部坐标中的位置（相对占地中心，单位：凸点） */
function originOffset(part: PartDef): [number, number] {
  switch (part.shape.kind) {
    case 'slope':
      // 斜坡原点在凸点那一排（高侧）的中心
      return [0, -(part.d / 2 - 0.5)];
    case 'corner':
      // 转角件原点在拐角处那颗凸点
      return [0.5 - part.w / 2, 0.5 - part.d / 2];
    default:
      return [0, 0];
  }
}

export interface LDrawPlacement {
  file: string;
  pos: [number, number, number];
  matrix: Mat3;
}

const fix = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
};

/** 计算一块积木在 LDraw 中的位置与旋转矩阵 */
export function ldrawPlacement(b: Pick<Brick, 'part' | 'x' | 'y' | 'z' | 'rot'>): LDrawPlacement {
  const part = getPart(b.part);
  const [fw, fd] = rotatedSize(part, b.rot);
  const theta = (b.rot * Math.PI) / 2;
  const c = Math.round(Math.cos(theta));
  const s = Math.round(Math.sin(theta));
  const [ox, oz] = originOffset(part);
  // 本项目中绕 +Y 旋转：x' = x·c + z·s，z' = -x·s + z·c
  const wx = b.x + fw / 2 + ox * c + oz * s;
  const wz = b.z + fd / 2 - ox * s + oz * c;
  const wy = (b.y + part.h) * PLATE_H; // LDraw 原点位于顶面
  // 绕 Y 旋转在 LDraw 坐标系中变为 rotY(-θ)
  const rot: Mat3 = [c, 0, -s, 0, 1, 0, s, 0, c];
  const matrix = part.shape.kind === 'corner' ? mul(rot, CORNER_Q) : rot;
  return {
    file: `${part.ldraw}.dat`,
    pos: [fix(wx * 20), fix(-wy * 20), fix(-wz * 20)],
    matrix: matrix.map(fix) as Mat3,
  };
}

/** 导出为 LDraw .ldr 文本；按高度分层插入 STEP，便于在其它软件中按步骤查看 */
export function toLDraw(name: string, bricks: Brick[]): string {
  const safe = name.replace(/[\r\n]/g, ' ').trim() || 'Untitled';
  const lines = [
    `0 ${safe}`,
    `0 Name: ${safe}.ldr`,
    '0 Author: BrickLab 积木工坊',
    '',
  ];
  const sorted = [...bricks].sort((a, b) => a.y - b.y || a.id - b.id);
  let layer: number | null = null;
  for (const b of sorted) {
    if (layer !== null && b.y !== layer) lines.push('0 STEP');
    layer = b.y;
    const p = ldrawPlacement(b);
    lines.push(`1 ${b.color} ${p.pos.join(' ')} ${p.matrix.join(' ')} ${p.file}`);
  }
  if (sorted.length) lines.push('0 STEP');
  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// 导入：解析 .ldr / .mpd，展开子模型，把受支持的零件还原为网格积木
// ---------------------------------------------------------------------------

/** 旧编号 / 其它模具版本 → 本项目零件 */
const ALIASES: Record<string, string> = {
  '3023': '3023b',
  '3040': '3040b',
  '3040a': '3040b',
  '3062': '3062b',
  '3062a': '3062b',
  '3068': '3068b',
  '3068a': '3068b',
  '3069': '3069b',
  '3069a': '3069b',
  '3070': '3070b',
  '3070a': '3070b',
  '3665': '3665b',
  '3665a': '3665b',
  '3660': '3660b',
  '3660a': '3660b',
  '4073': '6141',
  '3941': '6143',
  '4032': '4032b',
  '4032a': '4032b',
  '4589': '59900',
  '4589b': '59900',
  '2431b': '2431',
};

type Vec = [number, number, number];

interface Xform {
  m: Mat3;
  p: Vec;
}

function apply(x: Xform, child: Xform): Xform {
  const m = mul(x.m, child.m);
  const c = child.p;
  const p: Vec = [
    x.p[0] + x.m[0] * c[0] + x.m[1] * c[1] + x.m[2] * c[2],
    x.p[1] + x.m[3] * c[0] + x.m[4] * c[1] + x.m[5] * c[2],
    x.p[2] + x.m[6] * c[0] + x.m[7] * c[1] + x.m[8] * c[2],
  ];
  return { m, p };
}

export interface LDrawImport {
  name: string;
  bricks: { part: string; color: number; x: number; y: number; z: number; rot: 0 | 1 | 2 | 3 }[];
  skipped: number;
}

export function fromLDraw(text: string, knownColor: (code: number) => boolean): LDrawImport {
  const byFile = new Map<string, string>();
  for (const p of PARTS) byFile.set(p.ldraw.toLowerCase(), p.id);

  // 拆分 MPD 子文件
  const files = new Map<string, string[]>();
  let current = '__main__';
  let first: string | null = null;
  let name = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const fm = /^0\s+FILE\s+(.+)$/i.exec(line);
    if (fm) {
      current = fm[1].trim().toLowerCase();
      if (!first) first = current;
      files.set(current, []);
      continue;
    }
    if (!files.has(current)) files.set(current, []);
    files.get(current)!.push(line);
    if (!name) {
      const nm = /^0\s+(?!Name:|Author:|!|BFC|STEP|FILE|NOFILE)(.+)$/i.exec(line);
      if (nm) name = nm[1].trim();
    }
  }
  const root = first ?? '__main__';
  const out: LDrawImport['bricks'] = [];
  let skipped = 0;

  const walk = (file: string, x: Xform, parentColor: number, depth: number) => {
    const lines = files.get(file);
    if (!lines || depth > 16) return;
    for (const line of lines) {
      if (!line.startsWith('1 ')) continue;
      const tok = line.split(/\s+/);
      if (tok.length < 15) continue;
      const n = tok.slice(1, 14).map(Number);
      if (n.some((v) => Number.isNaN(v))) continue;
      const ref = tok.slice(14).join(' ').replace(/\\/g, '/').toLowerCase();
      let color = n[0];
      if (color === 16) color = parentColor;
      const local: Xform = { p: [n[1], n[2], n[3]], m: [n[4], n[5], n[6], n[7], n[8], n[9], n[10], n[11], n[12]] };
      const world = apply(x, local);
      if (files.has(ref)) {
        walk(ref, world, color, depth + 1);
        continue;
      }
      const base = ref.replace(/^.*\//, '').replace(/\.dat$/, '');
      const partId = byFile.get(base) ?? byFile.get(ALIASES[base] ?? '');
      const b = partId ? toGrid(partId, world) : null;
      if (!b) {
        skipped++;
        continue;
      }
      out.push({ ...b, color: knownColor(color) ? color : 15 });
    }
  };
  walk(root, { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], p: [0, 0, 0] }, 15, 0);

  // 让作品落在底板上并居中
  if (out.length) {
    let minY = Infinity,
      x0 = Infinity,
      x1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    for (const b of out) {
      const part = getPart(b.part);
      const [fw, fd] = rotatedSize(part, b.rot);
      minY = Math.min(minY, b.y);
      x0 = Math.min(x0, b.x);
      x1 = Math.max(x1, b.x + fw);
      z0 = Math.min(z0, b.z);
      z1 = Math.max(z1, b.z + fd);
    }
    const dx = -Math.round((x0 + x1) / 2);
    const dz = -Math.round((z0 + z1) / 2);
    for (const b of out) {
      b.x += dx;
      b.z += dz;
      b.y -= minY;
    }
  }
  return { name, bricks: out, skipped };
}

/** 由 LDraw 世界变换反推网格位置；非 90° 旋转或倾斜的零件返回 null */
function toGrid(partId: string, w: Xform) {
  const part = getPart(partId);
  for (const rot of [0, 1, 2, 3] as const) {
    const theta = (rot * Math.PI) / 2;
    const c = Math.round(Math.cos(theta));
    const s = Math.round(Math.sin(theta));
    const r: Mat3 = [c, 0, -s, 0, 1, 0, s, 0, c];
    const expect = part.shape.kind === 'corner' ? mul(r, CORNER_Q) : r;
    if (!expect.every((v, i) => Math.abs(v - w.m[i]) < 0.02)) continue;
    const [fw, fd] = rotatedSize(part, rot);
    const [ox, oz] = originOffset(part);
    const wx = w.p[0] / 20;
    const wy = -w.p[1] / 20;
    const wz = -w.p[2] / 20;
    const x = Math.round(wx - fw / 2 - (ox * c + oz * s));
    const z = Math.round(wz - fd / 2 - (-ox * s + oz * c));
    const y = Math.round(wy / PLATE_H - part.h);
    return { part: partId, x, y, z, rot };
  }
  return null;
}

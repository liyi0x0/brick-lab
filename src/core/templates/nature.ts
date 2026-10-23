import { brickVoxels, getPart, rotateCell, topStudCells } from '../parts';
import type { BrickData, Rot } from '../types';
import { Builder, C, rng, type Template } from './builder';
import { Voxels } from './sculpt';

// ---------------------------------------------------------------------------
// 工具：锥形胶囊体、可复现的 3D 噪声、竹子
// ---------------------------------------------------------------------------

type V3 = [number, number, number];

/** 允许悬挂的 Builder，额外记住底板范围，便于判断格子是否可用 */
class Scene extends Builder {
  constructor(readonly lim: number) {
    super(lim, { allowHanging: true });
  }

  /** (x, z) 在底板内，且从 y 起 h 层都空着 */
  free(x: number, y: number, z: number, h = 1) {
    return y >= 0 && x >= -this.lim && x < this.lim && z >= -this.lim && z < this.lim && this.isFree(x, y, z, h);
  }

  /** (x, z) 列最上面那块积木的顶面所在层（没有积木为 0） */
  top(x: number, z: number, from = 120) {
    for (let y = from; y >= 0; y--) if (this.has(x, y, z)) return y + 1;
    return 0;
  }

  /** w×d 区域各列顶面同高时返回该层，否则返回 -1 */
  level(x: number, z: number, w: number, d: number, from = 120) {
    let y = -1;
    for (let i = 0; i < w; i++)
      for (let j = 0; j < d; j++) {
        const t = this.top(x + i, z + j, from);
        if (y === -1) y = t;
        else if (y !== t) return -1;
      }
    return y;
  }

  /** w×d 区域从 y 起 h 层都可用 */
  areaFree(x: number, y: number, z: number, w: number, d: number, h = 1) {
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) if (!this.free(x + i, y, z + j, h)) return false;
    return true;
  }
}

/** 锥形胶囊体：线段 a→b 周围、半径由 ra 渐变到 rb 的范围（凸点单位） */
function capsule(v: Voxels, a: V3, b: V3, ra: number, rb: number, color: number) {
  const R = Math.max(ra, rb);
  const [ax, ay, az] = a;
  const [dx, dy, dz] = [b[0] - ax, b[1] - ay, b[2] - az];
  const L2 = dx * dx + dy * dy + dz * dz || 1e-9;
  return v.fill(
    Math.min(ax, b[0]) - R,
    Math.max(ax, b[0]) + R,
    Math.min(ay, b[1]) - R,
    Math.max(ay, b[1]) + R,
    Math.min(az, b[2]) - R,
    Math.max(az, b[2]) + R,
    (x, y, z) => {
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / L2));
      const r = ra + (rb - ra) * t;
      return (ax + dx * t - x) ** 2 + (ay + dy * t - y) ** 2 + (az + dz * t - z) ** 2 <= r * r ? color : null;
    },
  );
}

/** 可复现的 3D 值噪声，返回 [-1, 1] */
function valueNoise(seed: number) {
  const r = rng(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
    vals[i] = r() * 2 - 1;
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const h = (x: number, y: number, z: number) => vals[perm[perm[perm[x & 255] + (y & 255)] + (z & 255)]];
  const s = (t: number) => t * t * (3 - 2 * t);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return (x: number, y: number, z: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const u = s(x - xi);
    const v = s(y - yi);
    const w = s(z - zi);
    return lerp(
      lerp(lerp(h(xi, yi, zi), h(xi + 1, yi, zi), u), lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
      lerp(lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
      w,
    );
  };
}

/** 分形噪声（多个八度叠加，gain 为每个八度的振幅衰减） */
function fbm(noise: (x: number, y: number, z: number) => number, x: number, y: number, z: number, octaves = 4, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * f, y * f, z * f);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/** 没有经由凸点连到地面的积木序号 */
function looseIndices(bricks: BrickData[]): number[] {
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const studOwner = new Map<string, number>();
  const bottomOwner = new Map<string, number>();
  bricks.forEach((p, i) => {
    const def = getPart(p.part);
    for (const [lx, lz] of topStudCells(def)) {
      const [rx, rz] = rotateCell(lx, lz, def.w, def.d, p.rot);
      studOwner.set(key(p.x + rx, p.y + def.h, p.z + rz), i);
    }
    for (const [x, y, z] of brickVoxels(p)) if (y === p.y) bottomOwner.set(key(x, y, z), i);
  });
  const adj: number[][] = bricks.map(() => []);
  for (const [k, i] of studOwner) {
    const j = bottomOwner.get(k);
    if (j !== undefined && j !== i) {
      adj[i].push(j);
      adj[j].push(i);
    }
  }
  const seen = new Uint8Array(bricks.length);
  const queue: number[] = [];
  bricks.forEach((p, i) => {
    if (p.y === 0) {
      seen[i] = 1;
      queue.push(i);
    }
  });
  while (queue.length) {
    const i = queue.pop()!;
    for (const j of adj[i]) if (!seen[j]) (seen[j] = 1), queue.push(j);
  }
  const out: number[] = [];
  seen.forEach((s, i) => s || out.push(i));
  return out;
}

/**
 * 把体素雕塑拆成积木加入 b，并保证每块都连到地面：先在草稿里试拆，若有悬空的零件——
 * 下方是形体内部（挖空处）时，在它正下方补同色体素（藏在里面看不见）；
 * 下方是外面的空气时，把它改成相邻体素的颜色，好和旁边的板合并。然后重试。
 */
function sculpt(b: Scene, v: Voxels, opts: { y0?: number; tileTop?: boolean } = {}) {
  const y0 = opts.y0 ?? 0;
  const lowest = new Map<string, number>();
  v.forEach((x, l, z) => {
    const k = `${x},${z}`;
    lowest.set(k, Math.min(lowest.get(k) ?? Infinity, l));
  });
  for (let iter = 0; ; iter++) {
    const t = new Builder(b.lim, { allowHanging: true });
    for (const p of b.bricks) t.add(p.part, p.color, p.x, p.y, p.z, p.rot);
    const n0 = t.bricks.length;
    v.build(t, opts);
    const loose = iter < 12 ? looseIndices(t.bricks).filter((i) => i >= n0) : [];
    let changed = 0;
    for (const i of loose) {
      const p = t.bricks[i];
      const l = (p.y - y0) / v.layerH;
      const cells = brickVoxels(p).filter(([, y]) => y === p.y);
      const inside = l >= 1 && cells.some(([x, , z]) => !v.has(x, l - 1, z) && (lowest.get(`${x},${z}`) ?? Infinity) < l - 1);
      if (!inside) {
        // 改成相邻的另一种颜色
        const votes = new Map<number, number>();
        for (const [x, , z] of cells)
          for (const [dx, dz] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const c = v.get(x + dx, l, z + dz);
            if (c !== undefined && c !== p.color) votes.set(c, (votes.get(c) ?? 0) + 1);
          }
        const best = [...votes].sort((a, c) => c[1] - a[1] || a[0] - c[0])[0];
        if (best) {
          for (const [x, , z] of cells) v.set(x, l, z, best[0]);
          changed++;
          continue;
        }
      }
      for (const [x, , z] of cells) {
        if (l < 1 || v.has(x, l - 1, z) || !b.free(x, y0 + (l - 1) * v.layerH, z, v.layerH)) continue;
        v.set(x, l - 1, z, p.color);
        changed++;
      }
    }
    if (!changed) {
      for (let i = n0; i < t.bricks.length; i++) {
        const p = t.bricks[i];
        b.add(p.part, p.color, p.x, p.y, p.z, p.rot);
      }
      return;
    }
  }
}

/**
 * 在 (x, z) 处插一片竹叶：一块穿过竹竿格子的 1×N 板；叶片较长时，再在叶尖下方挂一小片，像下垂的竹叶。
 * prefer 为优先伸出的方向（如 [1, 0] 表示 +x）。挑不到空位就返回 false。
 */
function bambooLeaf(b: Scene, x: number, z: number, y: number, r: () => number, color: number, prefer?: [number, number]): boolean {
  const opts: [number, number, 'x' | 'z'][] = [];
  for (const len of [4, 3]) for (let off = 0; off < len; off++) for (const dir of ['x', 'z'] as const) opts.push([len, off, dir]);
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  if (prefer) {
    // 叶片朝 prefer 方向伸出得越多越优先
    const reach = ([len, off, dir]: [number, number, 'x' | 'z']) => (len - 1 - off - off) * (dir === 'x' ? prefer[0] : prefer[1]);
    opts.sort((a, c) => reach(c) - reach(a));
  }
  for (const [len, off, dir] of opts) {
    const at = (i: number): [number, number] => (dir === 'x' ? [x - off + i, z] : [x, z - off + i]);
    let ok = true;
    for (let i = 0; i < len && ok; i++) {
      const [cx, cz] = at(i);
      ok = b.free(cx, y, cz);
    }
    if (!ok) continue;
    const [x0, z0] = at(0);
    b.add(`plate-1x${len}`, color, x0, y, z0, dir === 'x' ? 0 : 1);
    // 叶尖下垂
    const plus = len - 1 - off;
    const minus = off;
    const reachOut = Math.max(plus, minus);
    if (reachOut >= 2 && y > 1 && r() < 0.75) {
      const sgn = plus >= minus ? 1 : -1;
      const tip = sgn > 0 ? len - 1 : 0;
      const n = r() < 0.5 ? 2 : 3;
      const cells: [number, number][] = [];
      for (let i = 0; i < n; i++) cells.push(at(tip + sgn * i));
      if (cells.every(([cx, cz]) => b.free(cx, y - 1, cz))) {
        const [sx, sz] = sgn > 0 ? cells[0] : cells[n - 1];
        b.add(`plate-1x${n}`, color === C.darkGreen ? C.green : color, sx, y - 1, sz, dir === 'x' ? 0 : 1);
      }
    }
    return true;
  }
  return false;
}

/**
 * 一根竹子：1×1 圆砖竹竿，每三节一个浅色竹节；从 leafFrom（0~1，按高度比例）往上的竹节都伸出竹叶。
 * 返回竹竿顶端所在的板层。
 */
function bamboo(b: Scene, x: number, z: number, y: number, bricks: number, stalk: number, node: number, r: () => number, leafFrom = 0.45) {
  let yy = y;
  const leafColors = [C.green, C.brightGreen, C.darkGreen, C.green];
  const leaf = () => leafColors[Math.floor(r() * leafColors.length)];
  for (let i = 0; i < bricks; i++) {
    b.add('round-brick-1x1', stalk, x, yy, z);
    yy += 3;
    if (i % 3 === 2 && i < bricks - 1) {
      if (!(i >= bricks * leafFrom && bambooLeaf(b, x, z, yy, r, leaf()))) b.add('round-plate-1x1', node, x, yy, z);
      yy += 1;
    }
  }
  // 竹梢：两片叶子 + 嫩芽
  if (bambooLeaf(b, x, z, yy, r, leaf())) yy += 1;
  if (bambooLeaf(b, x, z, yy, r, C.brightGreen)) yy += 1;
  b.add('cone-1x1', C.lime, x, yy, z);
  return yy + 3;
}

// ---------------------------------------------------------------------------
// 1. 大熊猫
// ---------------------------------------------------------------------------

function panda(): BrickData[] {
  const b = new Scene(16);
  const r = rng(20261101);
  const wob = valueNoise(11);

  // 草地：两层不规则的圆形草皮，熊猫坐在上面
  const g = new Voxels(1);
  g.fill(-16, 16, 0, 0.8, -16, 16, (x, y, z) => {
    const d = Math.hypot(x / 15, (z - 0.5) / 14) + 0.1 * wob(x * 0.3, 0, z * 0.3);
    if (y < 0.4) return d < 1 ? C.brightGreen : null;
    if (y > 0.8 || d >= 0.8) return null;
    const n = wob(x * 0.7 + 40, 3, z * 0.7);
    return n > 0.45 ? C.lime : n < -0.5 ? C.green : C.brightGreen;
  });
  sculpt(b, g);
  const Y0 = 2;

  const P = new Voxels(1);
  const W = C.white;
  const K = C.black;
  // 身体：坐姿，圆滚滚、下宽上窄；屁股后面一个小尾巴
  P.ellipsoid(0, 6.4, -0.8, 9.2, 6.8, 7.6, W);
  P.ellipsoid(0, 12.0, -1.4, 7.2, 5.6, 6.2, W);
  P.sphere(0, 3.4, -8.6, 1.6, W);
  // 后腿：向前伸出，脚掌朝前
  for (const s of [-1, 1]) {
    capsule(P, [s * 5.6, 4.6, -1.2], [s * 7.0, 3.4, 6.4], 3.8, 3.2, K);
    P.ellipsoid(s * 7.3, 3.6, 7.4, 3.2, 3.6, 2.4, K);
  }
  // 头、腮帮、吻部、耳朵
  const head = (x: number, y: number, z: number) =>
    (x / 7.6) ** 2 + ((y - 20.8) / 6.4) ** 2 + (z / 6.4) ** 2 <= 1.05 ||
    ((Math.abs(x) - 3.4) / 4.0) ** 2 + ((y - 18.8) / 3.3) ** 2 + ((z - 2.0) / 4.0) ** 2 <= 1.05;
  P.ellipsoid(0, 20.8, 0, 7.6, 6.4, 6.4, W);
  for (const s of [-1, 1]) P.ellipsoid(s * 3.4, 18.8, 2.0, 4.0, 3.3, 4.0, W);
  P.ellipsoid(0, 18.4, 4.8, 3.0, 2.2, 2.5, W);
  for (const s of [-1, 1]) P.sphere(s * 5.4, 26.0, -1.4, 2.6, K);
  // 右前臂（-x）向前弯，握住竹子；左前臂搭在肚子上
  capsule(P, [-6.2, 15.2, -0.8], [-8.2, 11.4, 3.4], 2.8, 2.4, K);
  capsule(P, [-8.2, 11.4, 3.4], [-6.6, 13.8, 7.0], 2.4, 2.2, K);
  P.ellipsoid(-6.4, 14.2, 7.4, 2.3, 2.3, 2.1, K);
  capsule(P, [6.2, 15.0, -0.8], [7.6, 10.8, 2.8], 2.8, 2.4, K);
  capsule(P, [7.6, 10.8, 2.8], [4.8, 9.8, 6.0], 2.4, 2.2, K);
  P.ellipsoid(4.4, 9.8, 6.4, 2.4, 2.1, 2.2, K);
  // 鼻子
  P.ellipsoid(0, 19.6, 7.1, 1.6, 0.8, 0.9, K);

  // 黑眼圈（向外下方倾斜的椭圆，里面一点高光）与肩带
  P.paint((x, y, z, c) => {
    if (c !== W) return null;
    if (z > 2.5 && y > 18 && y < 24.5) {
      for (const s of [-1, 1]) {
        if (Math.floor(x) === (s > 0 ? 2 : -3) && y > 21.6 && y < 22.4) return W;
        const dx = x - s * 3.1;
        const dy = y - 21.2;
        const th = 0.5;
        const u = dx * s * Math.sin(th) - dy * Math.cos(th);
        const w = dx * Math.cos(th) + dy * s * Math.sin(th);
        if ((u / 2.4) ** 2 + (w / 1.5) ** 2 <= 1) return K;
      }
    }
    if (!head(x, y, z) && y > 12.4 && y < 17.2 && (z < -0.5 || Math.abs(x) > 6.0)) return K;
    return null;
  });

  // 竹竿穿过右爪：先把那一列挖空
  const SX = -7;
  const SZ = 7;
  P.carve((x, y, z) => Math.floor(x) === SX && Math.floor(z) === SZ && y > 7.2);
  P.hollow(1);
  sculpt(b, P, { y0: Y0 });

  // 手里的竹子：立在脚背上，穿过爪子，竹梢的叶子正好送到嘴边
  let y = Y0;
  P.forEach((x, l, z) => {
    if (x === SX && z === SZ) y = Math.max(y, Y0 + l + 1);
  });
  const mouth = Y0 + 45;
  for (let i = 1; y + 3 <= mouth; i++) {
    b.add('round-brick-1x1', C.green, SX, y, SZ);
    y += 3;
    if (i % 3 === 0 && y + 4 <= mouth) b.add('round-plate-1x1', C.lime, SX, y++, SZ);
  }
  while (y < mouth) b.add('round-plate-1x1', C.lime, SX, y++, SZ);
  let free6 = true;
  for (let i = 0; i < 6; i++) free6 &&= b.free(SX + i, y, SZ);
  if (free6) b.add('plate-1x6', C.brightGreen, SX, y, SZ);
  else bambooLeaf(b, SX, SZ, y, r, C.brightGreen, [1, 0]);
  y++;
  b.add('round-brick-1x1', C.green, SX, y, SZ);
  y += 3;
  if (bambooLeaf(b, SX, SZ, y, r, C.green, [-1, 0])) y++;
  if (bambooLeaf(b, SX, SZ, y, r, C.darkGreen, [0, 1])) y++;
  b.add('cone-1x1', C.lime, SX, y, SZ);

  // 竹林
  for (const [x, z, n, stalk] of [
    [-11, -8, 22, C.lime],
    [-14, -4, 17, C.green],
    [-8, -12, 24, C.green],
    [-13, -12, 19, C.lime],
    [-4, -14, 17, C.lime],
    [-14, 3, 12, C.green],
    [10, -11, 21, C.green],
    [13, -7, 16, C.lime],
    [6, -14, 18, C.lime],
  ] as const) {
    bamboo(b, x, z, b.top(x, z, 3), n, stalk, stalk === C.lime ? C.green : C.lime, r);
  }

  // 竹笋与石头
  for (const [x, z] of [
    [-9, -4],
    [-12, -6],
    [11, -4],
    [-12, 6],
  ] as const) {
    const y = b.top(x, z, 3);
    if (!b.free(x, y, z, 6)) continue;
    b.add('round-plate-1x1', C.lime, x, y, z);
    b.add('cone-1x1', C.darkTan, x, y + 1, z);
  }
  for (const [x, z, part, color, rot] of [
    [9, 7, 'slope45-2x2', C.lightGray, 1],
    [11, 6, 'round-plate-2x2', C.darkGray, 0],
    [-11, 9, 'slope45-2x2', C.darkGray, 0],
  ] as const) {
    const y = b.level(x, z, 2, 2, 3);
    if (y >= 0 && b.areaFree(x, y, z, 2, 2, 3)) b.add(part, color, x, y, z, rot);
  }

  b.assertConnected();
  return b.bricks;
}

// ---------------------------------------------------------------------------
// 2. 小黄鸭
// ---------------------------------------------------------------------------

function rubberDuck(): BrickData[] {
  const b = new Scene(16);
  const r = rng(52013);
  const wob = valueNoise(7);

  // 池塘形状：不规则椭圆；外圈一圈沙岸
  const pond = (x: number, z: number) => Math.hypot(x / 14.2, (z - 0.2) / 13.4) + 0.06 * wob(x * 0.35, 1, z * 0.35);
  // 睡莲叶（先占位，水面平滑板要绕开它们）
  const pads: [number, number, 'round' | 'corner', Rot][] = [
    [-11, 3, 'round', 0],
    [-9, 6, 'corner', 1],
    [8, -9, 'corner', 2],
    [10, -6, 'round', 0],
    [9, 7, 'round', 0],
  ];
  const isPad = (x: number, z: number) => pads.some(([px, pz]) => x >= px && x < px + 2 && z >= pz && z < pz + 2);
  // 鸭子周围的涟漪
  const ripple = (x: number, z: number) => {
    const d = Math.hypot(x / 8.6, (z + 0.4) / 11.2);
    const a = Math.atan2(z + 0.4, x);
    const arc = Math.sin(a * 3 + 1.3) > -0.35;
    return arc && (Math.abs(d - 1.07) < 0.05 || (Math.abs(d - 1.3) < 0.04 && Math.sin(a * 2 + 0.4) > 0));
  };

  // 池底（天蓝色板）与沙岸
  const bed = new Voxels(1);
  bed.fill(-16, 16, 0, 0.2, -16, 16, (x, _y, z) => {
    const d = pond(x, z);
    if (d < 1) return C.azure;
    if (d < 1.12) return wob(x * 0.9, 5, z * 0.9) > 0.35 ? C.darkTan : C.tan;
    return null;
  });
  // 水面：透明浅蓝平滑板，涟漪处换成透明
  const surface = new Voxels(1);
  surface.fill(-16, 16, 0, 0.2, -16, 16, (x, _y, z) => {
    if (pond(x, z) >= 1 || isPad(Math.floor(x), Math.floor(z))) return null;
    return ripple(x, z) ? C.transClear : C.transLightBlue;
  });

  const duck = new Voxels(1);
  const Y = C.yellow;
  // 身体：前胸圆鼓鼓，后背抬起成尖尖的尾巴
  duck.ellipsoid(0, 3.0, -1.0, 7.0, 5.2, 9.0, Y);
  duck.ellipsoid(0, 4.2, 3.4, 6.0, 4.6, 5.4, Y);
  capsule(duck, [0, 5.0, -6.0], [0, 9.8, -10.0], 3.4, 1.3, Y);
  // 翅膀：两侧微微鼓起
  for (const s of [-1, 1]) duck.ellipsoid(s * 6.3, 5.4, -2.6, 1.2, 2.2, 4.2, Y);
  // 脖子与头（后脑勺比脖子突出，形成小鸭子的弧线）
  duck.ellipsoid(0, 8.4, 3.4, 4.0, 2.4, 3.6, Y);
  duck.sphere(0, 12.4, 3.6, 4.9, Y);
  // 扁扁的橙色嘴巴
  duck.ellipsoid(0, 11.0, 8.4, 3.0, 1.2, 2.8, C.orange);
  duck.ellipsoid(0, 10.2, 7.8, 2.2, 0.7, 2.3, C.orange);
  // 眼睛：白眼珠 + 黑眼仁，眼仁靠前靠下，像在好奇地往前看
  duck.paint((x, y, z, c) => {
    if (c !== Y || z < 5.5) return null;
    for (const s of [-1, 1]) {
      const e = ((x - s * 2.5) / 1.25) ** 2 + ((y - 13.8) / 1.55) ** 2;
      if (e > 1) continue;
      const pupil = Math.abs(x - s * 2.3) < 0.6 && y < 14.5 && y > 12.8;
      return pupil ? C.black : C.white;
    }
    return null;
  });
  // 旁边跟着一只小鸭子
  const DX = 10.5;
  const DZ = 1;
  duck.ellipsoid(DX, 1.0, DZ, 2.4, 1.8, 3.0, Y);
  capsule(duck, [DX, 1.6, DZ - 2.0], [DX, 3.2, DZ - 3.2], 1.1, 0.5, Y);
  duck.sphere(DX, 3.9, DZ + 1.0, 2.05, Y);
  duck.ellipsoid(DX, 3.5, DZ + 3.0, 1.0, 0.45, 1.0, C.orange);
  duck.paint((x, y, z) => {
    const fx = Math.floor(x);
    return (fx === 9 || fx === 11) && Math.floor(z) === DZ + 2 && y > 4.0 && y < 4.8 ? C.black : null;
  });
  duck.carve((_x, y) => y < 0); // 平底
  // 吃水线：底层补齐到上面两层的轮廓，免得边缘悬在水面的平滑板上
  duck.forEach((x, l, z, c) => {
    if ((l === 1 || l === 2) && !duck.has(x, 0, z)) duck.set(x, 0, z, c);
  });
  duck.hollow(1);
  // 鸭子底层所在的格子，水面要让出来
  const under = new Set<string>();
  duck.forEach((x, l, z) => {
    if (l === 0) under.add(`${x},${z}`);
  });
  surface.carve((x, _y, z) => under.has(`${Math.floor(x)},${Math.floor(z)}`));
  sculpt(b, bed);
  sculpt(b, surface, { y0: 1, tileTop: true });
  sculpt(b, duck, { y0: 1, tileTop: true });

  // 睡莲叶与花
  for (const [x, z, kind, rot] of pads) {
    if (kind === 'round') b.add('round-plate-2x2', C.green, x, 1, z);
    else b.add('corner-plate-2x2', C.brightGreen, x, 1, z, rot);
  }
  b.add('round-plate-1x1', C.white, -11, 2, 3);
  b.add('cone-1x1', C.brightPink, -11, 3, 3);
  b.add('round-plate-1x1', C.brightPink, 10, 2, 8);
  b.add('round-plate-1x1', C.yellow, 10, 3, 8);

  // 岸边的芦苇（香蒲）：沿方向 a 从池心往外找到岸边
  const shore = (a: number, out: number): [number, number] => {
    for (let t = 4; t < 16; t += 0.25) {
      const x = Math.cos(a) * t;
      const z = Math.sin(a) * t;
      if (pond(x, z) >= 1.02) return [Math.floor(x + Math.cos(a) * out), Math.floor(z + Math.sin(a) * out)];
    }
    return [15, 15];
  };
  for (const [a, out, h] of [
    [-2.2, 0.4, 3],
    [-2.32, 1.4, 4],
    [-2.05, 1.2, 2],
    [-2.5, 0.6, 3],
    [-1.9, 0.5, 2],
    [0.75, 0.5, 3],
    [0.62, 1.4, 2],
    [0.88, 1.2, 4],
  ] as const) {
    const [x, z] = shore(a, out);
    const y = b.top(x, z, 3);
    if (y > 1 || !b.free(x, y, z, 3 * h + 6)) continue;
    let yy = y;
    for (let i = 0; i < h; i++, yy += 3) b.add('round-brick-1x1', C.green, x, yy, z);
    b.add('round-brick-1x1', C.reddishBrown, x, yy, z);
    b.add('cone-1x1', C.green, x, yy + 3, z);
  }
  // 石头
  for (const [x, z, part, color, rot] of [
    [11, 10, 'slope45-2x2', C.lightGray, 0],
    [-15, 1, 'slope45-2x2', C.darkGray, 3],
    [3, -15, 'round-brick-2x2', C.lightGray, 0],
    [5, -15, 'round-plate-2x2', C.darkGray, 0],
  ] as const) {
    const y = b.level(x, z, 2, 2, 3);
    if (y >= 0 && b.areaFree(x, y, z, 2, 2, 3)) b.add(part, color, x, y, z, rot);
  }
  // 草地上的小花
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(r() * 32) - 16;
    const z = Math.floor(r() * 32) - 16;
    if (pond(x + 0.5, z + 0.5) < 1.2 || !b.free(x, 0, z, 2)) continue;
    b.add('plate-1x1', C.green, x, 0, z);
    b.add('round-plate-1x1', [C.white, C.yellow, C.brightPink, C.white][i % 4], x, 1, z);
  }

  b.assertConnected();
  return b.bricks;
}

// ---------------------------------------------------------------------------
// 3. 樱花树
// ---------------------------------------------------------------------------

function sakuraTree(): BrickData[] {
  const b = new Scene(16);
  const r = rng(3141);
  const n1 = valueNoise(21);
  const n2 = valueNoise(22);
  const BARK = C.reddishBrown;
  const DARK_BARK = 308;

  const v = new Voxels(1);
  // 树干：根部外扩，微微扭着向上，分成几根向外伸展的粗枝
  v.ellipsoid(0, 0.4, 0, 3.0, 1.2, 3.0, BARK);
  for (const [x, z] of [
    [3.4, 1.4],
    [-3.2, 1.8],
    [-2.0, -3.2],
    [2.4, -2.8],
  ])
    capsule(v, [0, 0.8, 0], [x, 0.2, z], 1.0, 0.5, BARK);
  capsule(v, [0, 0, 0], [-0.7, 3.4, 0.4], 2.2, 1.9, BARK);
  capsule(v, [-0.7, 3.4, 0.4], [0.5, 6.0, -0.3], 1.9, 1.7, BARK);
  const F: V3 = [0.5, 6.0, -0.3];
  const branches: [V3, number][] = [
    [[-7.2, 11.8, 2.4], 1.3],
    [[7.8, 12.0, -1.2], 1.3],
    [[1.8, 13.4, 6.0], 1.1],
    [[-2.6, 13.2, -6.8], 1.1],
    [[2.0, 17.0, -1.0], 1.1],
  ];
  for (const [to, rr] of branches) capsule(v, F, to, rr + 0.3, rr * 0.6, BARK);
  // 细枝
  capsule(v, [-7.2, 11.8, 2.4], [-10.6, 13.6, 4.6], 0.8, 0.6, BARK);
  capsule(v, [7.8, 12.0, -1.2], [10.8, 14.0, 1.8], 0.8, 0.6, BARK);
  capsule(v, [1.8, 13.4, 6.0], [4.8, 15.0, 8.0], 0.8, 0.6, BARK);
  capsule(v, [-2.6, 13.2, -6.8], [-6.4, 15.0, -4.4], 0.8, 0.6, BARK);
  // 树皮深浅
  v.paint((x, y, z) => (n1(x * 0.8, y * 0.8, z * 0.8) > 0.35 ? DARK_BARK : null));

  // 花冠：一团团带噪声的球，粉色为主，朝上的地方偏白
  const clusters: [number, number, number, number][] = [
    [-7.6, 15.0, 2.6, 4.4],
    [-10.8, 15.4, 5.0, 3.0],
    [8.0, 15.4, -1.2, 4.6],
    [11.0, 16.0, 2.0, 3.0],
    [1.8, 17.0, 6.2, 4.4],
    [4.8, 16.8, 8.2, 3.0],
    [-2.6, 16.8, -7.0, 4.4],
    [2.2, 20.2, -1.0, 5.0],
    [-3.8, 19.6, -0.6, 4.4],
    [5.8, 19.0, 3.0, 3.8],
    [-6.8, 17.2, -4.2, 3.6],
    [6.2, 17.4, -5.6, 3.6],
  ];
  const blossom = (x: number, y: number, z: number) => {
    const k = n2(x * 0.5, y * 0.5, z * 0.5);
    for (const [cx, cy, cz, cr] of clusters) {
      const d = Math.hypot(x - cx, (y - cy) * 1.15, z - cz);
      if (d <= cr * (1 + 0.16 * n1(x * 0.45 + 9, y * 0.45, z * 0.45))) {
        const up = (y - cy) / cr;
        return k > 0.4 || (up > 0.5 && k > 0.0) ? C.white : C.brightPink;
      }
    }
    return null;
  };
  v.fill(-16, 16, 10, 26, -16, 16, blossom);
  v.hollow(1);
  sculpt(b, v);

  // 长椅：铁脚、木座、靠背
  const BX = 3;
  const BZ = 9;
  b.add('brick-1x2', C.darkGray, BX, 0, BZ, 1);
  b.add('brick-1x2', C.darkGray, BX + 5, 0, BZ, 1);
  b.add('plate-2x6', C.reddishBrown, BX, 3, BZ);
  b.add('tile-1x1', C.reddishBrown, BX, 4, BZ + 1);
  b.add('round-tile-1x1', C.brightPink, BX + 1, 4, BZ + 1);
  b.add('tile-1x4', C.reddishBrown, BX + 2, 4, BZ + 1);
  b.add('brick-1x6', C.reddishBrown, BX, 4, BZ);
  b.add('plate-1x6', C.darkGray, BX, 7, BZ);
  b.add('tile-1x6', C.reddishBrown, BX, 8, BZ);

  // 踏脚石小路
  for (const [x, z] of [
    [5, 12],
    [3, 14],
  ] as const)
    b.add('round-tile-2x2', C.lightGray, x, 0, z);

  // 石灯笼
  const LX = -11;
  const LZ = 8;
  b.add('plate-2x2', C.darkGray, LX, 0, LZ);
  b.add('round-brick-2x2', C.lightGray, LX, 1, LZ);
  b.add('plate-2x2', C.darkGray, LX, 4, LZ);
  b.add('brick-1x1', C.lightGray, LX, 5, LZ);
  b.add('brick-1x1', C.transYellow, LX + 1, 5, LZ);
  b.add('brick-1x1', C.transYellow, LX, 5, LZ + 1);
  b.add('brick-1x1', C.lightGray, LX + 1, 5, LZ + 1);
  b.add('plate-4x4', C.darkGray, LX - 1, 8, LZ - 1);
  b.add('slope45-2x4', C.darkGray, LX - 1, 9, LZ - 1, 2);
  b.add('slope45-2x4', C.darkGray, LX - 1, 9, LZ + 1, 0);
  b.add('cone-1x1', C.darkGray, LX, 12, LZ);

  // 满地落樱：树冠下更密
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(r() * 32) - 16;
    const z = Math.floor(r() * 32) - 16;
    const d = Math.hypot(x + 0.5, z + 0.5);
    if (r() > 1.15 - d / 16 || !b.free(x, 0, z)) continue;
    const c = r();
    if (c < 0.6) b.add('round-tile-1x1', C.brightPink, x, 0, z);
    else if (c < 0.9) b.add('round-tile-1x1', C.white, x, 0, z);
    else b.add('round-plate-1x1', C.brightPink, x, 0, z);
  }

  b.assertConnected();
  return b.bricks;
}

// ---------------------------------------------------------------------------
// 4. 蘑菇小屋
// ---------------------------------------------------------------------------

function mushroomHouse(): BrickData[] {
  const b = new Scene(16);
  const r = rng(777);

  // 踏脚石小路：从门口弯到前面
  for (const [x, z, c] of [
    [-1, 6, C.lightGray],
    [0, 8, C.tan],
    [2, 10, C.lightGray],
    [1, 12, C.tan],
    [3, 14, C.lightGray],
  ] as const)
    b.add('round-tile-2x2', c, x, 0, z);

  // 菌柄：白色的胖圆筒（砖层），正面一扇木门，两侧与背后亮着暖黄的窗
  const STEM_L = 8;
  const stem = new Voxels(3);
  const doorCol = (x: number) => x >= -1 && x < 1;
  stem.fill(-7, 7, 0, STEM_L * 1.2 - 0.1, -7, 7, (x, y, z) => {
    const l = Math.floor(y / 1.2);
    const rr = 4.7 + 0.45 * Math.sin((Math.PI * (l + 0.5)) / STEM_L);
    if (x * x + z * z > rr * rr) return null;
    const a = Math.atan2(x, z); // 0 = 正前方（+z），向 +x 为正
    const fx = Math.floor(x);
    if (z > 3 && doorCol(fx) && l <= 2) return C.reddishBrown;
    if (z > 2.5 && (fx === -2 || fx === 1) && l <= 3) return C.tan;
    if (z > 2.5 && doorCol(fx) && l === 3) return C.tan;
    if (z > 3 && doorCol(fx) && l === 5) return C.transYellow;
    for (const wa of [1.05, -1.05, Math.PI]) {
      let da = Math.abs(a - wa);
      if (da > Math.PI) da = 2 * Math.PI - da;
      if (da < 0.2 && (l === 3 || l === 4)) return C.transYellow;
      if (da < 0.38 && l >= 2 && l <= 5) return C.tan;
    }
    return C.white;
  });
  stem.hollow(1);
  sculpt(b, stem);

  // 菌盖：红色圆顶 + 白色斑点，底面一圈白色菌褶，上面伸出一根小烟囱
  const CAP_Y = STEM_L * 3;
  const cap = new Voxels(1);
  const RX = 9.6;
  const RY = 6.4;
  const CY = 1.8;
  const spots: V3[] = [];
  for (const [el, n, off] of [
    [0.22, 6, 0.3],
    [0.62, 5, 0.9],
    [1.02, 3, 0.2],
    [1.5, 1, 0],
  ] as const)
    for (let i = 0; i < n; i++) {
      const az = off + (i / n) * Math.PI * 2;
      spots.push([Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)]);
    }
  cap.fill(-11, 11, 0, CY + RY, -11, 11, (x, y, z) => {
    const u = x / RX;
    const v = (y - CY) / RY;
    const w = z / RX;
    if (u * u + v * v + w * w > 1) return null;
    if (y < 0.8) return C.white;
    const len = Math.hypot(u, v, w) || 1;
    for (const [sx, sy, sz] of spots) if ((u * sx + v * sy + w * sz) / len > 0.986) return C.white;
    return C.red;
  });
  // 烟囱
  cap.fill(2, 4, 3, CY + RY + 1.6, -5, -3, () => C.darkGray);
  cap.hollow(1);
  sculpt(b, cap, { y0: CAP_Y, tileTop: true });

  // 门口的小灯
  b.add('round-brick-1x1', C.black, -3, 0, 6);
  b.add('round-brick-1x1', C.black, -3, 3, 6);
  b.add('brick-1x1', C.transYellow, -3, 6, 6);
  b.add('cone-1x1', C.black, -3, 9, 6);

  // 白色小栅栏：隔一格一根立柱，顶上一条横杆；小路处留出缺口
  const fence = (x0: number, z0: number, n: number, dir: 'x' | 'z') => {
    const at = (i: number): [number, number] => (dir === 'x' ? [x0 + i, z0] : [x0, z0 + i]);
    for (let i = 0; i < n; i += 2) {
      const [x, z] = at(i);
      b.add('brick-1x1', C.white, x, 0, z);
    }
    for (let i = 0; i < n; ) {
      const len = Math.min(n - i, n - i === 5 ? 3 : 4);
      const [x, z] = at(i);
      b.add(len === 1 ? 'plate-1x1' : `plate-1x${len}`, C.white, x, 3, z, dir === 'x' ? 0 : 1);
      i += len;
    }
  };
  fence(-11, 10, 9, 'x');
  fence(5, 10, 7, 'x');
  fence(-11, 2, 7, 'z');
  fence(11, 2, 7, 'z');

  // 小蘑菇
  for (const [x, z, h] of [
    [-14, 12, 1],
    [-12, 14, 2],
    [11, -10, 2],
    [13, -8, 1],
    [-12, -9, 1],
  ] as const) {
    let y = 0;
    for (let i = 0; i < h; i++, y += 3) b.add('round-brick-1x1', C.white, x, y, z);
    b.add('round-plate-2x2', C.red, x, y, z);
    b.add('round-tile-1x1', C.white, x + 1, y + 1, z + 1);
  }

  // 花丛与草丛
  const flowers = [C.red, C.yellow, C.white, C.brightPink, C.mediumLavender];
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(r() * 32) - 16;
    const z = Math.floor(r() * 32) - 16;
    if (Math.hypot(x + 0.5, z + 0.5) < 10.5 || !b.free(x, 0, z, 3)) continue;
    if (r() < 0.55) {
      b.add('plate-1x1', C.green, x, 0, z);
      b.add('round-plate-1x1', flowers[Math.floor(r() * flowers.length)], x, 1, z);
    } else b.add('plate-1x1', r() < 0.5 ? C.brightGreen : C.lime, x, 0, z);
  }

  b.assertConnected();
  return b.bricks;
}

// ---------------------------------------------------------------------------
// 5. 小星球
// ---------------------------------------------------------------------------

function tinyPlanet(): BrickData[] {
  const b = new Scene(16);
  const r = rng(424242);
  const land = valueNoise(1977);
  const det = valueNoise(2001);

  // 星球：半径 10.5 的球，底部稍稍压平落在底板上；地轴倾斜约 30°
  const R = 10.5;
  const CY = R - 0.6;
  const TOP = R - 1.0; // 顶上削出一小块平地，放小房子和树
  const ax = [0.4, 0.86, -0.3];
  const al = Math.hypot(ax[0], ax[1], ax[2]);
  const [ux, uy, uz] = ax.map((t) => t / al);
  const planet = new Voxels(1);
  planet.fill(-11, 11, 0, CY + R, -11, 11, (x, y, z) => {
    const dy = y - CY;
    const d = Math.hypot(x, dy, z);
    if (d > R || dy > TOP) return null;
    const nx = x / d;
    const ny = dy / d;
    const nz = z / d;
    const lat = nx * ux + ny * uy + nz * uz;
    const h = fbm(land, nx * 1.35 + 3.1, ny * 1.35 - 1.3, nz * 1.35 + 0.7, 3, 0.4) + 0.9 * Math.max(0, ny - 0.8);
    const k = det(nx * 3.2, ny * 3.2 + 7, nz * 3.2);
    if (Math.abs(lat) > 0.935 + 0.035 * k) return C.white; // 极地冰盖
    if (h > 0.06) {
      if (ny > 0.88) return C.brightGreen; // 顶上的草地
      if (h > 0.38) return C.lightGray; // 山
      if (Math.abs(lat) < 0.42 && k > 0.2) return C.tan; // 赤道附近的沙漠
      if (k < -0.25) return C.darkGreen; // 森林
      return k > 0.05 ? C.brightGreen : C.green;
    }
    return h > -0.02 ? C.azure : C.blue;
  });
  planet.hollow(1);
  sculpt(b, planet);

  // 顶上的小房子：白墙、木门、亮着的窗，红色双坡屋顶
  const ty = b.top(0, 0);
  const HX = -2;
  const HZ = -2;
  b.add('brick-2x2', C.white, HX, ty, HZ);
  b.add('brick-1x2', C.white, HX, ty, HZ + 2);
  b.add('brick-1x1', C.reddishBrown, HX, ty, HZ + 3);
  b.add('brick-1x1', C.transYellow, HX + 1, ty, HZ + 3);
  b.add('slope45-2x2', C.red, HX, ty + 3, HZ, 2);
  b.add('slope45-2x2', C.red, HX, ty + 3, HZ + 2, 0);
  b.add('tile-1x2', C.red, HX, ty + 6, HZ + 1, 1);
  b.add('round-brick-1x1', C.darkGray, HX + 1, ty + 6, HZ + 1);
  b.add('round-plate-1x1', C.lightGray, HX + 1, ty + 9, HZ + 1);
  // 一棵小树
  b.add('round-brick-1x1', C.reddishBrown, 1, ty, 0);
  b.add('round-plate-2x2', C.green, 1, ty + 3, 0);
  b.add('round-brick-2x2', C.brightGreen, 1, ty + 4, 0);
  b.add('round-plate-2x2', C.green, 1, ty + 7, 0);
  b.add('cone-1x1', C.lime, 1, ty + 8, 0);

  // 月亮：插在透明支架上，浮在星球右后方
  const MX = 12;
  const MZ = -13;
  const MR = 2.6;
  let my = 0;
  for (let i = 0; i < 11; i++, my += 3) b.add('round-brick-1x1', C.transClear, MX, my, MZ);
  const moon = new Voxels(1);
  const crater = valueNoise(5);
  moon.fill(MX - 3, MX + 4, 0, 2 * MR, MZ - 3, MZ + 4, (x, y, z) => {
    if (Math.hypot(x - MX - 0.5, y - MR, z - MZ - 0.5) > MR) return null;
    return crater(x * 0.9, y * 0.9, z * 0.9) > 0.3 ? C.darkGray : C.lightGray;
  });
  moon.hollow(1);
  sculpt(b, moon, { y0: my });

  // 满天繁星
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(r() * 32) - 16;
    const z = Math.floor(r() * 32) - 16;
    if (!b.free(x, 0, z)) continue;
    const c = r();
    b.add('round-tile-1x1', c < 0.6 ? C.white : c < 0.85 ? C.transClear : C.transYellow, x, 0, z);
  }

  b.assertConnected();
  return b.bricks;
}

/** 示例作品 · 自然与动物 */
export const NATURE_TEMPLATES: Template[] = [
  {
    id: 'panda',
    level: 3,
    name: { zh: '大熊猫', en: 'Giant Panda' },
    description: {
      zh: '坐在草地上啃竹子的大熊猫，黑眼圈、黑耳朵和黑色肩带一应俱全，身后是一片竹林。',
      en: 'A giant panda sitting on the grass munching bamboo — black eye patches, ears and shoulder band — with a bamboo grove behind.',
    },
    baseplateSize: 32,
    baseplateColor: C.green,
    build: panda,
  },
  {
    id: 'rubber-duck',
    level: 2,
    name: { zh: '小黄鸭', en: 'Rubber Duck' },
    description: {
      zh: '漂在池塘里的大号小黄鸭，身边跟着一只小鸭仔；水面荡着涟漪，睡莲叶上开着花，岸边长着香蒲。',
      en: 'A big yellow rubber duck and its duckling bobbing on a pond, with ripples, flowering lily pads and cattails on the shore.',
    },
    baseplateSize: 32,
    baseplateColor: C.brightGreen,
    build: rubberDuck,
  },
  {
    id: 'sakura-tree',
    level: 3,
    name: { zh: '樱花树', en: 'Cherry Blossom Tree' },
    description: {
      zh: '盛开的樱花树：红棕色的树干分出粗壮的枝杈，撑起一团团粉白的花冠，树下有长椅和满地落樱。',
      en: 'A cherry tree in full bloom — a gnarled reddish-brown trunk holds up clouds of pink and white blossom over a bench and a carpet of fallen petals.',
    },
    baseplateSize: 32,
    baseplateColor: C.brightGreen,
    build: sakuraTree,
  },
  {
    id: 'mushroom-house',
    level: 2,
    name: { zh: '蘑菇小屋', en: 'Mushroom House' },
    description: {
      zh: '童话里的蘑菇小屋：红色圆顶上点缀白色斑点，白色菌柄上开着木门和暖黄的小窗，门前有小路、栅栏和花丛。',
      en: 'A fairy-tale toadstool home — a spotted red cap over a white stem with a wooden door and glowing windows, plus a path, fence and flowers.',
    },
    baseplateSize: 32,
    baseplateColor: C.green,
    build: mushroomHouse,
  },
  {
    id: 'tiny-planet',
    level: 3,
    name: { zh: '小星球', en: 'Tiny Planet' },
    description: {
      zh: '漂浮在星空中的小星球：蓝色海洋、绿色与沙色的大陆、白色极地冰盖，顶上住着一座小房子和一棵树，旁边还有一轮月亮。',
      en: 'A tiny world in a starry sky — blue oceans, green and sandy continents, white polar caps, a little house and tree on top, and its own moon.',
    },
    baseplateSize: 32,
    baseplateColor: C.black,
    build: tinyPlanet,
  },
];

import type { BrickData } from '../types';
import { Builder, C, octagon, rng, tree, wallRing, type Template } from './builder';
import { brickVoxels, getPart, rotateCell, topStudCells } from '../parts';
import { Voxels } from './sculpt';

// ---------------------------------------------------------------------------
// 共用工具
// ---------------------------------------------------------------------------

/**
 * 体素拆成积木，且只有顶面外露的格子才换成平滑板（其余仍用带凸点的板），
 * 这样斜边上的台阶都是光滑的，内部又能牢牢扣在一起。
 * studs(x, l, z) 返回 true 的格子即使外露也保留凸点（上面还要再搭东西）。
 * 逐层拆：每层先拆带凸点的板，再把外露格拆成平滑板，搭建回放仍是自下而上。
 */
function sculptSmooth(v: Voxels, b: Builder, y0 = 0, studs?: (x: number, l: number, z: number) => boolean) {
  const layers = new Map<number, [number, number, number][]>();
  v.forEach((x, l, z, c) => {
    let arr = layers.get(l);
    if (!arr) layers.set(l, (arr = []));
    arr.push([x, z, c]);
  });
  for (const l of [...layers.keys()].sort((p, q) => p - q)) {
    const y = y0 + l * v.layerH;
    const sup = (x: number, z: number) => y === 0 || v.has(x, l - 1, z) || b.has(x, y - 1, z);
    // 外挑（下面悬空）的格子连同周围两格先拆，保证它们能和有支撑的格子拼成一块
    const near = new Set<string>();
    for (const [x, z] of layers.get(l)!)
      if (!sup(x, z)) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) near.add(`${x + dx},${z + dz}`);
    const groups = [0, 1, 2, 3].map(() => new Voxels(v.layerH));
    for (const [x, z, c] of layers.get(l)!) {
      const top = !v.has(x, l + 1, z) && !studs?.(x, l, z);
      groups[(near.has(`${x},${z}`) ? 0 : 2) + (top ? 1 : 0)].set(x, 0, z, c);
    }
    groups.forEach((g, i) => g.build(b, { y0: y, tileTop: i % 2 === 1 }));
  }
}

/** 一组积木中经由凸点咬合相连的分组：返回每块积木的组号 */
function components(bricks: BrickData[]): number[] {
  const k = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const studs = new Map<string, number>();
  const bottoms = new Map<string, number>();
  bricks.forEach((br, i) => {
    const p = getPart(br.part);
    for (const [lx, lz] of topStudCells(p)) {
      const [rx, rz] = rotateCell(lx, lz, p.w, p.d, br.rot);
      studs.set(k(br.x + rx, br.y + p.h, br.z + rz), i);
    }
    for (const [x, y, z] of brickVoxels(br)) if (y === br.y) bottoms.set(k(x, y, z), i);
  });
  const parent = bricks.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [key, i] of studs) {
    const j = bottoms.get(key);
    if (j !== undefined) parent[find(i)] = find(j);
  }
  return bricks.map((_, i) => find(i));
}

/**
 * 拆分外挑的体素（檐口等）并保证每块都连到下方已有的积木上：
 * 先在临时 Builder 里拆，若有积木没连上，就在它下面补一格体素（藏在檐下看不见；最底层则削掉），再重拆。
 */
function sculptSupported(v: Voxels, b: Builder, y0: number, studs?: (x: number, l: number, z: number) => boolean) {
  const anchors = b.bricks.filter((br) => br.y + getPart(br.part).h === y0);
  const dropped = new Set<string>(); // 已削掉的最底层格子，不再往回补
  for (let iter = 0; ; iter++) {
    const tmp = new Builder(1000, { allowHanging: true });
    for (const br of anchors) tmp.add(br.part, br.color, br.x, br.y, br.z, br.rot);
    sculptSmooth(v, tmp, y0, studs);
    const comp = components(tmp.bricks);
    const good = new Set(anchors.map((_, i) => comp[i]));
    const fresh = tmp.bricks.slice(anchors.length);
    const stray = fresh.filter((_, i) => !good.has(comp[i + anchors.length]));
    if (!stray.length || iter >= 12) {
      for (const br of fresh) b.add(br.part, br.color, br.x, br.y, br.z, br.rot);
      return;
    }
    for (const br of stray)
      for (const [x, y, z] of brickVoxels(br)) {
        const l = (y - y0) / v.layerH;
        if (l === 0 || dropped.has(`${x},${z}`)) {
          v.delete(x, l, z);
          dropped.add(`${x},${z}`);
        } else if (!v.has(x, l - 1, z)) v.set(x, l - 1, z, v.get(x, l, z)!);
      }
  }
}

/**
 * 把体素拆成积木，并保证拆出来的积木连成一体：细细的彩色条纹（例如灯笼的竖纹）
 * 常常只能上下相扣、自成孤岛，这里把不在最大连通块里的积木所在体素改回 body 颜色后重拆。
 */
function connectedSculpt(
  v: Voxels,
  body: number,
  opts: { y0?: number; smooth?: (color: number) => boolean } = {},
): BrickData[] {
  const y0 = opts.y0 ?? 0;
  for (let iter = 0; ; iter++) {
    const tmp = new Builder(1000, { allowHanging: true });
    if (opts.smooth) sculptSmooth(v, tmp, y0, (x, l, z) => !opts.smooth!(v.get(x, l, z)!));
    else v.build(tmp, { y0 });
    const comp = components(tmp.bricks);
    const size = new Map<number, number>();
    for (const c of comp) size.set(c, (size.get(c) ?? 0) + 1);
    const main = [...size.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const stray = tmp.bricks.filter((_, i) => comp[i] !== main);
    if (!stray.length || iter >= 6) return tmp.bricks;
    for (const br of stray) for (const [x, y, z] of brickVoxels(br)) v.set(x, (y - y0) / v.layerH, z, body);
  }
}

// ---------------------------------------------------------------------------
// 1. 福字斗方
// ---------------------------------------------------------------------------

/**
 * 「福」字位图：用 Playwright 在画布上以 PingFang SC 粗体渲染、按格取样阈值化后烘焙，
 * 再手工修整了笔画（礻 的竖用 2 格宽，畐 的口、田左右对称）。
 * 每列 1 个凸点宽，每行 1 块板高（0.4 凸点），所以竖向行数约为横向的 2.5 倍。
 */
const FU_GLYPH = [
  '..##...........',
  '..##..#########',
  '...##.#########',
  '...##.#########',
  '......#########',
  '#####..........',
  '#####..........',
  '#####..#######.',
  '#####..#######.',
  '...##..#######.',
  '...##..##...##.',
  '...##..##...##.',
  '..##...##...##.',
  '..##...#######.',
  '..##...#######.',
  '.###...#######.',
  '.####..........',
  '####.#.........',
  '#.##.##########',
  '..##..#########',
  '..##..#########',
  '..##..#########',
  '..##..##..#..##',
  '..##..##..#..##',
  '..##..##..#..##',
  '..##..#########',
  '..##..#########',
  '..##..#########',
  '..##..##..#..##',
  '..##..##..#..##',
  '..##..##..#..##',
  '..##..#########',
  '..##..#########',
  '..##..#########',
  '..##..#########',
  '..##..##.....##',
];

/** 一盆金桔（年桔）：八角花盆、圆砖树干、雕刻出的圆树冠，缀着橙色的小桔子 */
function kumquat(b: Builder, cx: number, cz: number, seed: number) {
  const r = rng(seed);
  octagon(b, cx, cz, 0, C.darkRed);
  octagon(b, cx, cz, 3, C.darkRed);
  b.add('round-brick-2x2', C.reddishBrown, cx - 1, 6, cz - 1);
  for (const [x, z, rot] of [
    [cx - 2, cz - 1, 1],
    [cx + 1, cz - 1, 1],
    [cx - 1, cz - 2, 0],
    [cx - 1, cz + 1, 0],
  ] as const)
    b.add('tile-1x2', C.pearlGold, x, 6, z, rot);
  b.add('round-brick-2x2', C.reddishBrown, cx - 1, 9, cz - 1);
  // 树冠：球心略高于树干顶，压平底部；挖空后只留外壳
  const top = 12 * 0.4;
  const v = new Voxels(1).sphere(cx, top + 2.6, cz, 3.1, C.green);
  v.carve((_x, y) => y < top);
  v.hollow(1);
  // 桔子：表面上零星的橙色格子，彼此不挨着（免得拼成一长条）
  const near = (x: number, l: number, z: number) => {
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) for (let dl = -2; dl <= 2; dl++) if (v.get(x + dx, l + dl, z + dz) === C.orange) return true;
    return false;
  };
  v.forEach((x, l, z, c) => {
    if (c !== C.green) return;
    const surface = !v.has(x + 1, l, z) || !v.has(x - 1, l, z) || !v.has(x, l, z + 1) || !v.has(x, l, z - 1) || !v.has(x, l + 1, z);
    if (surface && v.has(x, l - 1, z) && r() < 0.35 && !near(x, l, z)) v.set(x, l, z, C.orange);
  });
  v.build(b);
}

function fuMosaic(): BrickData[] {
  const b = new Builder(16, { allowHanging: true });
  const wood = C.reddishBrown;
  const gold = C.yellow;

  // 红木底座：四只转角砖做的脚，上面是「束腰」须弥座（宽 - 窄 - 宽）
  b.add('corner-brick-2x2', wood, 6, 0, 1, 2);
  b.add('corner-brick-2x2', wood, 6, 0, -3, 3);
  b.add('corner-brick-2x2', wood, -8, 0, -3, 0);
  b.add('corner-brick-2x2', wood, -8, 0, 1, 1);
  b.add('plate-6x8', wood, -8, 3, -3);
  b.add('plate-6x8', wood, 0, 3, -3);
  // 束腰：内缩一圈，正面是金色腰线
  b.add('brick-1x6', gold, -7, 4, 1);
  b.add('brick-1x2', gold, -1, 4, 1);
  b.add('brick-1x6', gold, 1, 4, 1);
  b.add('brick-1x6', wood, -7, 4, -2);
  b.add('brick-1x6', wood, 1, 4, -2);
  b.add('brick-1x2', wood, -1, 4, -2);
  b.add('brick-2x2', wood, -7, 4, -1);
  b.add('brick-2x2', wood, 5, 4, -1);
  b.add('plate-6x8', wood, -8, 7, -3);
  b.add('plate-6x8', wood, 0, 7, -3);
  // 台面四周铺平滑板
  for (const z of [-3, 2]) {
    b.add('tile-1x6', wood, -8, 8, z);
    b.add('tile-1x4', wood, -2, 8, z);
    b.add('tile-1x6', wood, 2, 8, z);
  }
  for (const x of [-8, 4]) {
    b.add('tile-2x4', wood, x, 8, -2);
    b.add('tile-2x4', wood, x, 8, 0);
  }

  // 斗方：菱形，半对角线 R 个凸点；每行是一层板（0.4 凸点），所以 45° 斜边每 2.5 层收进 1 格
  const R = 15;
  const ROWS = Math.round((2 * R) / 0.4);
  const dist = (i: number, j: number) => Math.abs(i + 0.5) + Math.abs((j + 0.5) * 0.4 - R);
  const gx0 = -8; // 字的左列
  const gj0 = 20; // 字的最底行
  const glyph = (i: number, j: number) => {
    const r = FU_GLYPH.length - 1 - (j - gj0);
    const c = i - gx0;
    return r >= 0 && r < FU_GLYPH.length && FU_GLYPH[r][c] === '#';
  };
  const v = new Voxels(1);
  // 台面中央的 V 形托槽，斗方的下角就插在里面（与斗方同一套体素，一起自下而上拆分）
  for (let j = 0; j < 5; j++)
    for (let i = -4; i < 4; i++) {
      if (dist(i, j) <= R) continue;
      for (let z = -2; z < 2; z++) v.set(i, j, z, wood);
    }
  // 红底金字：字只在正面（z = 0）那一层
  for (let j = 0; j < ROWS; j++)
    for (let i = -R; i < R; i++) {
      if (dist(i, j) > R) continue;
      v.set(i, j, -1, C.red);
      v.set(i, j, 0, glyph(i, j) ? gold : C.red);
    }
  sculptSmooth(v, b, 8);

  // 两盆金桔
  kumquat(b, -12, 4, 8);
  kumquat(b, 12, 4, 9);
  b.assertConnected();
  return b.bricks;
}

// ---------------------------------------------------------------------------
// 2. 大红灯笼
// ---------------------------------------------------------------------------

/**
 * 把体素先拆进一个临时 Builder，再按「自上而下」的顺序加进主 Builder：
 * 用于挂在横梁下的东西（灯笼），搭建回放时会从吊绳开始一层层往下长。
 */
function hangVoxels(v: Voxels, b: Builder, body: number) {
  const bricks = connectedSculpt(v, body, { smooth: (c) => c === body });
  const order = [...bricks].sort((p, q) => q.y - p.y || p.z - q.z || p.x - q.x);
  for (const br of order) b.add(br.part, br.color, br.x, br.y, br.z, br.rot);
}

/**
 * 一盏挂在横梁下的灯笼。(cx, cz) 是灯笼中心所在的格子，topY 是横梁底面所在的板层。
 * 自上而下：吊杆 → 金色顶盖 → 扁圆的红色灯身 → 金色底盖 → 金结 + 红穗子。返回流苏底部的板层。
 */
function lantern(b: Builder, cx: number, cz: number, topY: number, rx: number, ry: number, cord = 2, tassel = 2) {
  const G = C.yellow;
  const x = cx + 0.5;
  const z = cz + 0.5;
  let y = topY;
  for (let i = 0; i < cord; i++) b.add('round-brick-1x1', G, cx, (y -= 3), cz);
  const cut = ry * 0.8; // 灯身上下各削平一截，好装盖子
  const capR = Math.max(1.6, rx * 0.58);
  const bodyTop = y - 2;
  const yc = bodyTop * 0.4 - cut;
  const v = new Voxels(1);
  v.ellipsoid(x, yc, z, rx, ry, rx, C.red);
  v.carve((_x, py) => Math.abs(py - yc) > cut);
  v.hollow(1);
  // 顶盖、底盖：两层，外圈宽、内圈窄
  v.cylinder(x, z, capR, (bodyTop + 0) * 0.4, (bodyTop + 1) * 0.4, G);
  v.cylinder(x, z, capR - 1, (bodyTop + 1) * 0.4, (bodyTop + 2) * 0.4, G);
  const bodyBottom = Math.round((yc - cut) / 0.4);
  v.cylinder(x, z, capR, (bodyBottom - 1) * 0.4, bodyBottom * 0.4, G);
  v.cylinder(x, z, capR - 1, (bodyBottom - 2) * 0.4, (bodyBottom - 1) * 0.4, G);
  hangVoxels(v, b, C.red);
  // 流苏：金色结 + 红色穗子（倒挂的圆锥正好像散开的穗子）
  y = bodyBottom - 2;
  b.add('round-plate-1x1', G, cx, (y -= 1), cz);
  for (let i = 0; i < tassel; i++) b.add('round-brick-1x1', C.red, cx, (y -= 3), cz);
  b.add('cone-1x1', C.red, cx, (y -= 3), cz);
  return y;
}

function lanterns(): BrickData[] {
  const b = new Builder(16, { allowHanging: true });
  const post = C.darkRed;
  const stone = C.lightGray;
  const wood = C.reddishBrown;

  // 门前石板路（错缝铺）
  for (let z = 2, i = 0; z < 16; z += 2, i++) {
    const c = i % 3 === 1 ? C.darkGray : C.lightGray;
    if (i % 2 === 0) {
      b.add('tile-2x4', c, -3, 0, z);
      b.add('tile-2x2', C.lightGray, 1, 0, z);
    } else {
      b.add('tile-2x2', C.lightGray, -3, 0, z);
      b.add('tile-2x4', c, -1, 0, z);
    }
  }

  // 门下铺两排石板
  for (const [z, xs, short] of [
    [-2, [-11, -7, -3, 1, 5], 9],
    [0, [-9, -5, -1, 3, 7], -11],
  ] as const) {
    for (const x of xs) b.add('tile-2x4', C.lightGray, x, 0, z);
    b.add('tile-2x2', C.lightGray, short, 0, z);
  }
  // 路口两盆花：八角花盆里一丛绿叶，顶上点缀红黄小花
  for (const [cx, cz] of [
    [-7, 12],
    [7, 12],
  ]) {
    octagon(b, cx, cz, 0, C.darkRed);
    octagon(b, cx, cz, 3, C.darkGreen);
    b.add('round-brick-2x2', C.green, cx - 1, 6, cz - 1);
    const flowers = [C.yellow, C.red, C.brightPink, C.yellow];
    [
      [cx - 2, cz - 1],
      [cx + 1, cz],
      [cx - 1, cz + 1],
      [cx, cz - 2],
    ].forEach(([x, z], i) => b.add('round-plate-1x1', flowers[i], x, 6, z));
    b.add('round-plate-1x1', C.red, cx - 1, 9, cz - 1);
    b.add('round-plate-1x1', C.yellow, cx, 9, cz);
  }

  // 两根红柱，立在方形石墩上
  const BEAM = 49;
  for (const px of [-14, 12]) {
    b.add('plate-4x4', stone, px - 1, 0, -2);
    b.add('tile-1x4', stone, px - 1, 1, -2);
    b.add('tile-1x4', stone, px - 1, 1, 1);
    b.add('tile-1x2', stone, px - 1, 1, -1, 1);
    b.add('tile-1x2', stone, px + 2, 1, -1, 1);
    for (let y = 1; y < BEAM; y += 3) b.add('round-brick-2x2', post, px, y, -1);
  }

  // 横梁（3 格深，中线与灯笼对齐）：正面一排是蓝绿相间的彩画
  for (const z of [-1, 0]) for (let x = -16; x < 16; x += 8) b.add('brick-1x8', wood, x, BEAM, z);
  for (let x = -16, i = 0; x < 16; x += 4, i++) b.add('brick-1x4', i % 2 === 0 ? C.blue : C.green, x, BEAM, 1);
  // 雀替：柱头两侧的金色托木，挂在横梁下
  for (const px of [-14, 12]) {
    b.add('slope45inv-2x2', C.pearlGold, px - 2, BEAM - 3, -1, 3);
    b.add('slope45inv-2x2', C.pearlGold, px + 2, BEAM - 3, -1, 1);
  }
  // 檐下的椽子板：与横梁错缝，把整根梁连成一体，并向前后挑出
  const EY = BEAM + 3;
  b.add('plate-4x6', wood, -16, EY, -3, 1);
  for (const x of [-12, -4, 4]) b.add('plate-6x8', wood, x, EY, -3);
  b.add('plate-4x6', wood, 12, EY, -3, 1);
  for (let x = -16; x < 16; x += 8) b.add('plate-1x8', wood, x, EY, 3);

  // 灰瓦屋顶：檐口用 33° 缓坡、上段用 45° 陡坡，形成中式屋面的凹曲线；深浅相间像一垄垄筒瓦
  const tile = (x: number) => (x % 2 === 0 ? C.darkGray : C.black);
  const RY = EY + 1;
  for (let x = -16; x < 16; x++) {
    b.add('slope33-3x1', tile(x), x, RY, 1, 0);
    b.add('slope33-3x1', tile(x), x, RY, -3, 2);
  }
  for (let x = -16; x < 16; x += 8) b.add('brick-1x8', C.darkGray, x, RY, 0);
  for (let x = -16; x < 16; x++) {
    b.add('slope45-2x1', tile(x), x, RY + 3, 1, 0);
    b.add('slope45-2x1', tile(x), x, RY + 3, -2, 2);
  }
  for (let x = -16; x < 16; x += 8) b.add('brick-1x8', C.darkGray, x, RY + 3, 0);
  // 屋脊：两侧压一层板，中间凸起一道黑色正脊，两端翘起鸱吻
  for (let x = -12; x < 12; x += 8) {
    b.add('plate-1x8', C.darkGray, x, RY + 6, -1);
    b.add('plate-1x8', C.darkGray, x, RY + 6, 1);
  }
  for (const x of [-16, 12]) {
    b.add('plate-1x4', C.darkGray, x, RY + 6, -1);
    b.add('plate-1x4', C.darkGray, x, RY + 6, 1);
  }
  for (let x = -14; x < 14; x += 4) b.add('brick-1x4', C.black, x, RY + 6, 0);
  b.add('slope45-2x1', C.black, -16, RY + 6, 0, 1);
  b.add('slope45-2x1', C.black, 14, RY + 6, 0, 3);

  // 两盏大红灯笼，檐角再各挂一盏小灯笼
  lantern(b, -6, 0, BEAM, 4.5, 3.9);
  lantern(b, 5, 0, BEAM, 4.5, 3.9);
  for (const [x, z] of [
    [-16, 2],
    [14, 2],
    [-16, -3],
    [14, -3],
  ]) {
    // 圆筒形小灯笼：金顶、红身、金底，下面四个倒挂圆锥拼成穗子
    b.add('round-plate-2x2', C.yellow, x, EY - 1, z);
    b.add('round-brick-2x2', C.red, x, EY - 4, z);
    b.add('round-brick-2x2', C.red, x, EY - 7, z);
    b.add('round-plate-2x2', C.yellow, x, EY - 8, z);
    for (const [dx, dz] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ])
      b.add('cone-1x1', C.red, x + dx, EY - 11, z + dz);
  }

  b.assertConnected();
  return b.bricks;
}

// ---------------------------------------------------------------------------
// 3. 中式宝塔
// ---------------------------------------------------------------------------

/**
 * 一圈斜坡（屋面）：外缘半宽 r，进深 d（33° 斜坡 d=3，45° 斜坡 d=2），中心在格点 (0, 0)。
 * 前后两排横贯全宽、左右两排补在中间；1 格宽的斜坡深浅相间，像一垄垄筒瓦。
 * horns：四个檐角换成向外翘起的反向斜坡，尖上再立一个小圆锥。
 */
function slopeRing(b: Builder, r: number, d: 2 | 3, y: number, color: (i: number) => number, horns?: number) {
  const part = d === 3 ? 'slope33-3x1' : 'slope45-2x1';
  for (let x = -r; x < r; x++) {
    if (horns !== undefined && (x === -r || x === r - 1)) {
      b.add('brick-1x1', color(x), x, y, r - 3);
      b.add('slope45-2x1', color(x), x, y, r - 2, 2);
      b.add('cone-1x1', horns, x, y + 3, r - 1);
      b.add('brick-1x1', color(x), x, y, -r + 2);
      b.add('slope45-2x1', color(x), x, y, -r, 0);
      b.add('cone-1x1', horns, x, y + 3, -r);
      continue;
    }
    b.add(part, color(x), x, y, r - d, 0);
    b.add(part, color(x), x, y, -r, 2);
  }
  for (let z = -r + d; z < r - d; z++) {
    b.add(part, color(z), r - d, y, z, 1);
    b.add(part, color(z), -r, y, z, 3);
  }
}

/** 一圈 1 格宽的平滑板：铺在 [-r, r) 方框最外一圈 */
function tileRing(b: Builder, r: number, y: number, color: number) {
  // 把长度拆成 6、4、3、2、1 格的平滑板
  const pieces = (len: number) => {
    const out: number[] = [];
    while (len > 0) {
      const l = len >= 10 || len === 6 ? 6 : len >= 4 ? (len === 5 ? 3 : 4) : len;
      out.push(l);
      len -= l;
    }
    return out;
  };
  let p = 0;
  for (const l of pieces(2 * r)) {
    b.add(`tile-1x${l}`, color, -r + p, y, r - 1, 0);
    b.add(`tile-1x${l}`, color, -r + p, y, -r, 0);
    p += l;
  }
  p = 0;
  for (const l of pieces(2 * r - 2)) {
    b.add(`tile-1x${l}`, color, r - 1, y, -r + 1 + p, 1);
    b.add(`tile-1x${l}`, color, -r, y, -r + 1 + p, 1);
    p += l;
  }
}

function pagoda(): BrickData[] {
  const b = new Builder(16, { allowHanging: true });
  const stone = C.lightGray;
  const wallC = C.red;
  const tile = (i: number) => ((i + 100) % 2 === 0 ? C.darkGray : C.black);

  // 1. 石台基：两层方台 + 正面台阶
  const base = new Voxels(3);
  base.box(-12, 0, -12, 12, 1.2, 12, stone);
  base.box(-10, 1.2, -10, 10, 2.4, 10, stone);
  base.build(b);
  const steps = new Voxels(1);
  for (let x = -3; x < 3; x++)
    for (let z = 10; z < 15; z++) {
      const h = 15 - z;
      for (let l = 0; l < h; l++) if (!b.has(x, l, z)) steps.set(x, l, z, C.white);
    }
  sculptSmooth(steps, b);
  // 台基上一圈汉白玉栏杆：望柱 + 矮栏板，正面台阶处留口
  for (let i = -10; i < 10; i++) {
    for (const [x, z] of [
      [i, 9],
      [i, -10],
      [9, i],
      [-10, i],
    ]) {
      if (z === 9 && x >= -3 && x < 3) continue;
      if ((x === 9 || x === -10) && (z === 9 || z === -10) && i !== -10 && i !== 9) continue;
      if (b.has(x, 6, z)) continue;
      const post = (x + z) % 3 === 0 || ((x === 9 || x === -10) && (z === 9 || z === -10)) || (z === 9 && (x === -4 || x === 3));
      if (post) {
        b.add('round-brick-1x1', C.white, x, 6, z);
        b.add('round-plate-1x1', C.white, x, 9, z);
      } else b.add('plate-1x1', C.white, x, 6, z);
    }
  }

  // 2. 七层塔身
  const W = [6, 5, 5, 4, 4, 3, 3]; // 各层墙的半宽
  let y = 6;
  let prev = 0; // 下一层的屋面圈半宽（墙脚外露处铺平座）
  for (let s = 0; s < W.length; s++) {
    const w = W[s];
    const n = 4; // 墙的砖层数（不含斗拱层）；上层的第一圈藏在下层屋面后面
    const doorRows = s === 0 ? [0, 1] : [1];
    const archRow = 2;
    const onFace = (x: number, z: number, half: number) =>
      (Math.abs(x + 0.5) < half && (z === w - 1 || z === -w)) || (Math.abs(z + 0.5) < half && (x === w - 1 || x === -w));
    // 门窗洞后面衬一块黑砖，看起来是幽深的门洞
    for (let l = 0; l <= archRow; l++) {
      const yy = y + l * 3;
      b.add('brick-1x2', C.black, -1, yy, w - 2);
      b.add('brick-1x2', C.black, -1, yy, -w + 1);
      b.add('brick-1x2', C.black, w - 2, yy, -1, 1);
      b.add('brick-1x2', C.black, -w + 1, yy, -1, 1);
    }
    for (let l = 0; l < n; l++) {
      const yy = y + l * 3;
      // 四角是深红色的柱子
      for (const [x, z] of [
        [w - 1, w - 1],
        [-w, w - 1],
        [w - 1, -w],
        [-w, -w],
      ])
        b.add('brick-1x1', C.darkRed, x, yy, z);
      // 上层第一圈砖：把墙外到屋面之间的空隙也砌上（之后铺成平座）
      if (s > 0 && l === 0) for (let r = prev; r > w; r--) wallRing(b, -r, -r, r, r, yy, l, () => wallC);
      wallRing(b, -w, -w, w, w, yy, l, () => wallC, (x, z) =>
        (doorRows.includes(l) && onFace(x, z, 1)) || (l === archRow && onFace(x, z, 2)),
      );
      if (l === archRow) {
        b.add('arch-1x4', C.darkRed, -2, yy, w - 1);
        b.add('arch-1x4', C.darkRed, -2, yy, -w);
        b.add('arch-1x4', C.darkRed, w - 1, yy, -2, 1);
        b.add('arch-1x4', C.darkRed, -w, yy, -2, 1);
      }
      if (s > 0 && l === 0 && prev > w) for (let r = prev; r > w; r--) tileRing(b, r, yy + 3, C.reddishBrown);
    }
    y += n * 3;
    // 斗拱层：四面一排反斜坡向外挑出 1 格，转角立 1×1 柱头
    for (let x = -w + 1; x < w - 1; x += 2) {
      b.add('slope45inv-2x2', C.green, x, y, w - 1, 0);
      b.add('slope45inv-2x2', C.green, x, y, -w - 1, 2);
    }
    for (let z = -w + 1; z < w - 1; z += 2) {
      b.add('slope45inv-2x2', C.green, w - 1, y, z, 1);
      b.add('slope45inv-2x2', C.green, -w - 1, y, z, 3);
    }
    for (const [x, z] of [
      [w - 1, w - 1],
      [-w, w - 1],
      [w - 1, -w],
      [-w, -w],
    ])
      b.add('brick-1x1', C.darkRed, x, y, z);
    y += 3;
    // 檐板：整片板，向外挑出 3 格
    const R = w + 3;
    const eave = new Voxels(1).box(-R, 0, -R, R, 0.4, R, C.reddishBrown);
    eave.build(b, { y0: y });
    y += 1;
    // 瓦面：一圈 33° 缓坡
    slopeRing(b, R, 3, y, tile, C.pearlGold);
    prev = w;
    if (s === W.length - 1) {
      // 顶层：再收两圈 45° 陡坡成攒尖顶
      const fill = new Voxels(3).box(-w, 0, -w, w, 1.2, w, C.darkGray);
      fill.build(b, { y0: y });
      y += 3;
      slopeRing(b, w + 1, 2, y, tile);
      new Voxels(3).box(-w + 1, 0, -w + 1, w - 1, 1.2, w - 1, C.darkGray).build(b, { y0: y });
      y += 3;
      slopeRing(b, w, 2, y, tile);
      new Voxels(3).box(-w + 2, 0, -w + 2, w - 2, 1.2, w - 2, C.darkGray).build(b, { y0: y });
      y += 3;
    }
  }

  // 3. 金色塔刹：覆钵、相轮、宝顶
  const gold = C.pearlGold;
  octagon(b, 0, 0, y, gold);
  y += 3;
  for (let i = 0; i < 3; i++) {
    b.add('round-brick-2x2', gold, -1, y, -1);
    b.add('plate-2x2', gold, -1, y + 3, -1);
    y += 4;
  }
  b.add('round-brick-2x2', gold, -1, y, -1);
  y += 3;
  for (const [x, z] of [
    [-1, -1],
    [0, -1],
    [-1, 0],
    [0, 0],
  ])
    b.add('cone-1x1', gold, x, y, z);

  // 4. 四角的树
  tree(b, -13, -13);
  tree(b, 13, -13);
  tree(b, -13, 13);
  tree(b, 13, 13);

  b.assertConnected();
  return b.bricks;
}

// ---------------------------------------------------------------------------
// 4. 天坛祈年殿
// ---------------------------------------------------------------------------

/** 以格点 (0, 0) 为圆心、半径 r 的圆盘是否包含格子 (x, z) */
const inCircle = (x: number, z: number, r: number) => (x + 0.5) ** 2 + (z + 0.5) ** 2 <= r * r;

/** 圆盘的边界格（8 邻域有格子在圆外） */
function circleRing(r: number, fn: (x: number, z: number) => void) {
  const n = Math.ceil(r) + 1;
  for (let x = -n; x < n; x++)
    for (let z = -n; z < n; z++) {
      if (!inCircle(x, z, r)) continue;
      let edge = false;
      for (let dx = -1; dx <= 1 && !edge; dx++) for (let dz = -1; dz <= 1; dz++) if (!inCircle(x + dx, z + dz, r)) edge = true;
      if (edge) fn(x, z);
    }
}

/**
 * 圆锥形的檐顶：先一层一层向外挑（每层只挑 1 格，下面都有支撑），到檐口后再按凹曲线收到 rTop。
 * rBase 是下面墙（实心）的半径。返回屋顶最上一层之上的板层。
 */
function roundRoof(
  b: Builder,
  y: number,
  rBase: number,
  rEdge: number,
  rTop: number,
  layers: number,
  color: number,
  eaveColor: number,
  keep: number,
) {
  const v = new Voxels(1);
  const n = Math.ceil(rEdge) + 1;
  const radii: number[] = [];
  // 挑檐：rBase+1, rBase+2, … 直到 rEdge（两层同宽，上层铺平滑板）
  for (let r = rBase + 1; r < rEdge; r += 1) radii.push(r);
  radii.push(rEdge, rEdge);
  const flare = radii.length;
  for (let l = 1; l < layers; l++) {
    const t = l / (layers - 1);
    radii.push(rTop + (rEdge - rTop) * (1 - t) ** 1.25);
  }
  radii.forEach((r, l) => {
    for (let x = -n; x < n; x++)
      for (let z = -n; z < n; z++) if (inCircle(x, z, r)) v.set(x, l, z, l < flare - 1 ? eaveColor : color);
  });
  sculptSupported(v, b, y, (x, l, z) => l === radii.length - 1 && inCircle(x, z, keep));
  return y + radii.length;
}

function templeOfHeaven(): BrickData[] {
  const b = new Builder(24, { allowHanging: true });
  const marble = C.white;
  const T = [20.5, 17, 13.5]; // 三层台基的半径
  const stairHalf = 3;
  const inStair = (x: number, z: number) =>
    (Math.abs(x + 0.5) < stairHalf && Math.abs(z + 0.5) > T[2]) || (Math.abs(z + 0.5) < stairHalf && Math.abs(x + 0.5) > T[2]);

  // 1. 三层汉白玉圆台（四面台阶处留空）
  const terrace = new Voxels(3);
  for (let k = 0; k < 3; k++)
    for (let x = -22; x < 22; x++)
      for (let z = -22; z < 22; z++) if (inCircle(x, z, T[k]) && !inStair(x, z)) terrace.set(x, k, z, marble);
  terrace.build(b);
  // 四面台阶：每级一块板高
  const stairs = new Voxels(1);
  for (let x = -24; x < 24; x++)
    for (let z = -24; z < 24; z++) {
      if (!inStair(x, z)) continue;
      const d = Math.max(Math.abs(x + 0.5), Math.abs(z + 0.5));
      const h = Math.min(9, Math.max(0, Math.round(9 - (d - T[2]) * 1.0)));
      for (let l = 0; l < h; l++) stairs.set(x, l, z, C.lightGray);
    }
  sculptSmooth(stairs, b);
  // 栏杆：每层台边一圈两板高的白色矮墙，隔几格立一根望柱
  for (let k = 0; k < 3; k++) {
    const y = (k + 1) * 3;
    const v = new Voxels(1);
    const cells: [number, number][] = [];
    circleRing(T[k], (x, z) => {
      if (inStair(x, z) || (k < 2 && inCircle(x, z, T[k + 1] + 1))) return;
      if (Math.abs(x + 0.5) < stairHalf + 1 || Math.abs(z + 0.5) < stairHalf + 1) {
        if (Math.abs(x + 0.5) < stairHalf || Math.abs(z + 0.5) < stairHalf) return;
      }
      cells.push([x, z]);
      v.set(x, 0, z, marble);
      v.set(x, 1, z, marble);
    });
    const posts = new Set(cells.filter(([x, z]) => (x + z * 3 + 300) % 4 === 0).map(([x, z]) => `${x},${z}`));
    sculptSmooth(v, b, y, (x, _l, z) => posts.has(`${x},${z}`));
    for (const key of posts) {
      const [x, z] = key.split(',').map(Number);
      b.add('round-plate-1x1', marble, x, y + 2, z);
    }
  }

  // 2. 祈年殿：圆形大殿，三重蓝色檐顶
  let y = 9;
  const wall = (r: number, courses: number, door: boolean) => {
    for (let l = 0; l < courses; l++) {
      const v = new Voxels(3);
      const n = Math.ceil(r) + 1;
      for (let x = -n; x < n; x++) for (let z = -n; z < n; z++) if (inCircle(x, z, r)) v.set(x, 0, z, C.darkRed);
      circleRing(r, (x, z) => {
        const a = Math.atan2(z + 0.5, x + 0.5);
        const sector = (((a / (Math.PI * 2)) * 16 + 16.5) % 1 + 1) % 1; // 16 开间
        const column = sector < 0.22 || sector > 0.78;
        let c: number = column ? C.red : l === courses - 1 ? C.pearlGold : C.darkRed;
        if (door && !column && l < courses - 1 && Math.abs(x + 0.5) < 1.5 && z > 0) c = C.black;
        v.set(x, 0, z, c);
      });
      v.build(b, { y0: y + l * 3 });
    }
    y += courses * 3;
  };
  const band = (r: number) => {
    const v = new Voxels(3);
    const n = Math.ceil(r) + 1;
    for (let x = -n; x < n; x++) for (let z = -n; z < n; z++) if (inCircle(x, z, r)) v.set(x, 0, z, C.darkRed);
    circleRing(r, (x, z) => {
      const a = Math.atan2(z + 0.5, x + 0.5);
      const i = Math.floor(((a / (Math.PI * 2)) * 24 + 24) % 24);
      v.set(x, 0, z, i % 2 === 0 ? C.blue : C.green);
    });
    v.build(b, { y0: y });
    y += 3;
  };
  // 底层：殿身 + 彩画 + 第一重檐
  wall(7.5, 5, true);
  band(8.3);
  y = roundRoof(b, y, 8.3, 10, 6.2, 9, C.blue, C.pearlGold, 6.2);
  // 第二层：鼓座 + 彩画 + 第二重檐
  wall(5.8, 2, false);
  band(6.6);
  y = roundRoof(b, y, 6.6, 8.2, 4.4, 8, C.blue, C.pearlGold, 4.4);
  // 第三层
  wall(4.2, 2, false);
  band(5);
  y = roundRoof(b, y, 5, 6.6, 1, 11, C.blue, C.pearlGold, 1);
  // 3. 鎏金宝顶：短颈、八角金球、圆顶
  b.add('round-brick-2x2', C.pearlGold, -1, y, -1);
  octagon(b, 0, 0, y + 3, C.pearlGold);
  b.add('round-brick-2x2', C.pearlGold, -1, y + 6, -1);
  b.add('round-tile-2x2', C.pearlGold, -1, y + 9, -1);

  // 4. 四角的古柏：高高的深绿色树冠
  for (const [cx, cz] of [
    [-20, -20],
    [20, -20],
    [-20, 20],
    [20, 20],
  ]) {
    b.add('round-brick-2x2', C.reddishBrown, cx - 1, 0, cz - 1);
    // 体素坐标从树干顶面（第 3 层板）算起
    const crown = new Voxels(1).ellipsoid(cx, 3.2, cz, 2.2, 3.6, 2.2, C.darkGreen);
    crown.paint((_x, py) => (py > 4.4 ? C.green : null));
    sculptSupported(crown, b, 3);
  }
  b.assertConnected();
  return b.bricks;
}

// ---------------------------------------------------------------------------
// 5. 长城
// ---------------------------------------------------------------------------

function greatWall(): BrickData[] {
  const b = new Builder(24, { allowHanging: true });
  const r = rng(1949);
  const HALF = 24;
  const stone = C.lightGray;

  // 城墙路线：沿格线的 Z 形折线（左后方 → 拐角敌楼 → 朝镜头而来 → 拐角敌楼 → 右前方），不围成院子
  // 每个拐点的山脊高度（板）；线段中间有山脊起伏
  type Pt = { x: number; z: number; h: number };
  const pts: Pt[] = [
    { x: -27, z: -10, h: 8 },
    { x: -4, z: -10, h: 24 },
    { x: -4, z: 9, h: 17 },
    { x: 27, z: 9, h: 6 },
  ];
  const humps = [
    // 线段号、位置（0~1）、高度变化（正为山包、负为山坳）
    [0, 0.42, 7],
    [0, 0.75, -4],
    [1, 0.5, -9],
    [2, 0.42, 6],
    [2, 0.78, -3],
  ];
  const towers = [pts[1], pts[2], { x: 15, z: pts[2].z, h: 0 }];
  /** 点到路线的最近处：距离、所在线段、线段上的位置，以及该处山脊高度 */
  const nearest = (px: number, pz: number) => {
    let best = { d: Infinity, seg: 0, u: 0, h: 0, off: 0 };
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const c = pts[i + 1];
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      const u = Math.max(0, Math.min(1, ((px - a.x) * (c.x - a.x) + (pz - a.z) * (c.z - a.z)) / (len * len)));
      const d = Math.hypot(px - (a.x + (c.x - a.x) * u), pz - (a.z + (c.z - a.z) * u));
      if (d < best.d) {
        let h = a.h + (c.h - a.h) * u;
        for (const [seg, at, dh] of humps) if (seg === i) h += dh * Math.exp(-((((u - at) * len) / 5) ** 2));
        const off = a.x === c.x ? px - a.x : pz - a.z;
        best = { d, seg: i, u, h, off };
      }
    }
    return best;
  };
  const ridge = (x: number, z: number) => nearest(x, z).h;
  const T = 3; // 敌楼半宽（6×6）
  const tw = towers.map((t) => ({ ...t, pad: Math.round(ridge(t.x, t.z)) + 5, x0: t.x - T, x1: t.x + T, z0: t.z - T, z1: t.z + T }));
  const towerAt = (x: number, z: number) => tw.find((t) => x >= t.x0 && x < t.x1 && z >= t.z0 && z < t.z1);
  const WALL = 2; // 城墙半宽：两侧垛墙 + 2 格走道
  const RAISE = 5;

  // 1. 山体 + 城墙墙身：同一套体素一起自下而上拆
  const v = new Voxels(1);
  for (let x = -HALF; x < HALF; x++)
    for (let z = -HALF; z < HALF; z++) {
      const cx = x + 0.5;
      const cz = z + 0.5;
      const n = nearest(cx, cz);
      const side =
        9 * Math.exp(-(((cx - 14) / 8) ** 2 + ((cz + 12) / 8) ** 2)) +
        5 * Math.exp(-(((cx + 16) / 7) ** 2 + ((cz - 15) / 7) ** 2));
      const hill = Math.round(Math.max(n.h * Math.exp(-((n.d / 7) ** 2)), side));
      const t = towerAt(x, z);
      const onWall = !t && Math.abs(n.off) < WALL && n.d < WALL;
      if (t || onWall) {
        // 走道：随山脊起伏，敌楼前后两格拉平
        let top = Math.round(n.h) + RAISE;
        for (const q of tw) if (Math.abs(cx - q.x) < T + 2.5 && Math.abs(cz - q.z) < T + 2.5) top = q.pad;
        if (t) top = t.pad;
        for (let l = 0; l < top; l++) v.set(x, l, z, l < hill - 1 ? C.green : stone);
        if (onWall && Math.abs(n.off) > WALL - 1) {
          // 两侧垛墙，隔一格一个垛口
          const pos = pts[n.seg].x === pts[n.seg + 1].x ? z : x;
          const merlon = (pos + 100) % 2 === 0;
          for (let l = top; l < top + (merlon ? 5 : 2); l++) v.set(x, l, z, stone);
        }
      } else for (let l = 0; l < hill; l++) v.set(x, l, z, l >= 18 ? C.brightGreen : C.green);
    }
  // 山坡上点缀几丛深绿色的树
  for (let i = 0; i < 30; i++) {
    const x = Math.floor(r() * 44) - 22;
    const z = Math.floor(r() * 44) - 22;
    const n = nearest(x + 0.5, z + 0.5);
    if (n.d < 4.5 || towerAt(x, z)) continue;
    let top = 0;
    while (v.has(x, top, z)) top++;
    const rad = 1.3 + r() * 0.6;
    const tree = new Voxels(1).cylinder(x + 0.5, z + 0.5, rad, top * 0.4, (top + 5 + Math.floor(r() * 3)) * 0.4, C.darkGreen, 0.4);
    tree.forEach((tx, tl, tz, c) => {
      if (v.has(tx, tl, tz)) return;
      v.set(tx, tl, tz, c);
      for (let l = tl - 1; l >= 0 && !v.has(tx, l, tz); l--) v.set(tx, l, tz, C.green);
    });
  }
  v.hollow(1);
  sculptSmooth(v, b, 0, (x, l, z) => {
    const t = towerAt(x, z);
    return !!t && l === t.pad - 1;
  });

  // 2. 三座敌楼：砖砌方楼，城墙穿门而过，其余几面开拱窗，顶上一圈垛口
  for (const t of tw) {
    // 城墙从哪几面进出
    const i = pts.findIndex((q) => q.x === t.x && q.z === t.z);
    const nb = i >= 0 ? [pts[i - 1], pts[i + 1]] : [{ x: t.x - 1, z: t.z }, { x: t.x + 1, z: t.z }];
    const dirs: string[] = nb.map((q) => (q.x === t.x ? (q.z < t.z ? 'n' : 's') : q.x < t.x ? 'w' : 'e'));
    const side = (x: number, z: number) => (z === t.z0 ? 'n' : z === t.z1 - 1 ? 's' : x === t.x0 ? 'w' : x === t.x1 - 1 ? 'e' : '');
    let y = t.pad;
    for (let l = 0; l < 3; l++) {
      wallRing(b, t.x0, t.z0, t.x1, t.z1, y + l * 3, l, () => stone, (x, z) => {
        const sd = side(x, z);
        const mid = sd === 'n' || sd === 's' ? x - t.x : z - t.z;
        const half = l === 2 ? 2 : 1;
        if (!(mid >= -half && mid < half)) return false;
        return dirs.includes(sd) || l >= 1;
      });
    }
    b.add('arch-1x4', stone, t.x - 2, y + 6, t.z0);
    b.add('arch-1x4', stone, t.x - 2, y + 6, t.z1 - 1);
    b.add('arch-1x4', stone, t.x0, y + 6, t.z - 2, 1);
    b.add('arch-1x4', stone, t.x1 - 1, y + 6, t.z - 2, 1);
    y += 9;
    b.add('plate-6x6', C.darkGray, t.x0, y, t.z0);
    y += 1;
    for (let k = 0; k < 6; k += 2)
      for (const [x, z] of [
        [t.x0 + k, t.z0],
        [t.x0 + k + 1, t.z1 - 1],
        [t.x0, t.z0 + k + 1],
        [t.x1 - 1, t.z0 + k],
      ])
        if (!b.has(x, y, z)) b.add('brick-1x1', stone, x, y, z);
    // 最高的那座敌楼顶上加一座灰瓦小亭（楼橹）
    if (t === tw[0]) {
      for (const [x, z] of [
        [t.x - 2, t.z - 2],
        [t.x + 1, t.z - 2],
        [t.x - 2, t.z + 1],
        [t.x + 1, t.z + 1],
      ])
        b.add('round-brick-1x1', C.darkRed, x, y, z);
      b.add('plate-4x4', C.reddishBrown, t.x - 2, y + 3, t.z - 2);
      b.add('slope45-2x4', C.darkGray, t.x - 2, y + 4, t.z, 0);
      b.add('slope45-2x4', C.darkGray, t.x - 2, y + 4, t.z - 2, 2);
      b.add('tile-2x4', C.black, t.x - 2, y + 7, t.z - 1);
    }
  }

  b.assertConnected();
  return b.bricks;
}

/** 示例作品 · 中国风 */
export const CHINESE_TEMPLATES: Template[] = [
  {
    id: 'fu-mosaic',
    level: 2,
    name: { zh: '福字斗方', en: 'Fu Character Diamond' },
    description: {
      zh: '红底金字的「福」字斗方，立在红木底座上。',
      en: 'A red diamond with a golden "Fu" (good fortune) character, standing on a rosewood stand.',
    },
    baseplateSize: 32,
    baseplateColor: C.tan,
    build: fuMosaic,
  },
  {
    id: 'lanterns',
    level: 2,
    name: { zh: '大红灯笼', en: 'Red Lanterns' },
    description: {
      zh: '一对大红灯笼挂在红柱灰瓦的门楼下，金色顶盖、红色穗子，檐角还挂着四盏小宫灯。',
      en: 'A pair of big red lanterns with golden caps and red tassels under a red-pillared gate with a grey tiled roof, plus four small lanterns at the eaves.',
    },
    baseplateSize: 32,
    baseplateColor: C.green,
    build: lanterns,
  },
  {
    id: 'pagoda',
    level: 3,
    name: { zh: '中式宝塔', en: 'Chinese Pagoda' },
    description: {
      zh: '七层宝塔：红墙拱窗、绿色斗拱、层层出檐的灰瓦屋面，顶上是金色塔刹，立在带台阶的石台基上。',
      en: 'A seven-storey pagoda with red walls, arched windows, green brackets, tiers of grey-tiled eaves and a golden spire, on a stone base with steps.',
    },
    baseplateSize: 32,
    baseplateColor: C.green,
    build: pagoda,
  },
  {
    id: 'temple-of-heaven',
    level: 3,
    name: { zh: '天坛祈年殿', en: 'Temple of Heaven' },
    description: {
      zh: '三层汉白玉圆台、四面台阶与栏杆，圆形大殿红柱金窗，三重蓝色檐顶托着鎏金宝顶。',
      en: 'The Hall of Prayer for Good Harvests: a three-tier white marble terrace with stairs and balustrades, a round red-pillared hall and three tiers of blue roofs crowned with a golden finial.',
    },
    baseplateSize: 48,
    baseplateColor: C.darkGreen,
    build: templeOfHeaven,
  },
  {
    id: 'great-wall',
    level: 3,
    name: { zh: '长城', en: 'The Great Wall' },
    description: {
      zh: '城墙沿着起伏的青山山脊蜿蜒而过：灰砖墙身、两侧垛口、阶梯式走道，山头上立着三座带拱窗的敌楼。',
      en: 'The Great Wall winding along green ridges: grey stone walls, crenellated parapets, a stepped walkway and three watchtowers with arched windows on the hilltops.',
    },
    baseplateSize: 48,
    baseplateColor: C.green,
    build: greatWall,
  },
];

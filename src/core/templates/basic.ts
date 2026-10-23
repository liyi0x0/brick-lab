import { rotateGroup } from '../placement';
import type { BrickData } from '../types';
import { band2, Builder, C, rng, tree, wallRing, type Template } from './builder';

// ---------------------------------------------------------------------------
// 1. 温馨小屋
// ---------------------------------------------------------------------------

function cottage(): BrickData[] {
  const b = new Builder(16);
  // 墙体 x∈[-8,2)、z∈[-6,2)；门在前墙 x∈[-4,-2)
  const X0 = -8,
    X1 = 2,
    Z0 = -6,
    Z1 = 2;
  const front = Z1 - 1;
  const back = Z0;
  const roof = C.darkRed;

  // 门前小路与花坛
  for (const z of [2, 6, 10]) b.add('tile-2x4', C.tan, -4, 0, z, 1);
  b.add('plate-1x4', C.green, -8, 0, 2);
  b.add('plate-1x4', C.green, -1, 0, 2);
  const flowers = [C.red, C.yellow, C.brightPink, C.white];
  [-8, -7, -6, -5].forEach((x, i) => b.add('round-plate-1x1', flowers[i % 4], x, 1, 2));
  [-1, 0, 1, 2].forEach((x, i) => b.add('round-plate-1x1', flowers[(i + 2) % 4], x, 1, 2));

  // 第 0 层：门 + 灰色墙基
  b.add('brick-1x2', C.reddishBrown, -4, 0, front);
  wallRing(b, X0, Z0, X1, Z1, 0, 0, () => C.lightGray);

  // 第 1、2 层：窗户（透明砖）
  const windows = (y: number) => {
    b.add('brick-1x2', C.transClear, -7, y, front);
    b.add('brick-1x2', C.transClear, -1, y, front);
    b.add('brick-1x2', C.transClear, -4, y, back);
    b.add('brick-1x2', C.transClear, X0, y, -3, 1);
    b.add('brick-1x2', C.transClear, X1 - 1, y, -3, 1);
  };
  b.add('brick-1x2', C.reddishBrown, -4, 3, front);
  windows(3);
  wallRing(b, X0, Z0, X1, Z1, 3, 1, () => C.white);

  // 门顶：透明气窗 + 拱
  b.add('plate-1x2', C.transClear, -4, 6, front);
  b.add('plate-1x2', C.transClear, -4, 7, front);
  b.add('arch-1x4', C.white, -5, 6, front);
  windows(6);
  wallRing(b, X0, Z0, X1, Z1, 6, 2, () => C.white);
  wallRing(b, X0, Z0, X1, Z1, 9, 3, () => C.white);

  // 屋檐木梁（整块板盖住墙顶）
  b.add('plate-8x8', C.reddishBrown, X0, 12, Z0);
  b.add('plate-2x8', C.reddishBrown, X1 - 2, 12, Z0, 1);

  // 双坡屋顶：每层两侧斜坡各向内收 1 格，中间用白砖填出山墙
  for (let k = 0; k < 4; k++) {
    const y = 13 + k * 3;
    for (const x of [-9, -5, -1]) {
      b.add('slope45-2x4', roof, x, y, front - k, 0);
      b.add('slope45-2x4', roof, x, y, back - 1 + k, 2);
    }
    for (let z = -5 + k, i = 0; z < 1 - k; z += 2, i++) band2(b, 'x', X0, X1, z, y, C.white, (i + k) % 2 === 1);
  }

  // 屋脊盖瓦 + 烟囱
  b.add('tile-2x4', roof, -9, 25, -3);
  b.add('tile-2x4', roof, -5, 25, -3);
  b.add('brick-2x2', C.lightGray, -1, 25, -3);
  b.add('brick-2x2', C.lightGray, -1, 28, -3);
  b.add('plate-2x2', C.darkGray, -1, 31, -3);
  b.add('tile-2x2', roof, 1, 25, -3);

  // 院子里的树
  tree(b, 8, -2);
  tree(b, -12, 7);
  return b.bricks;
}

// ---------------------------------------------------------------------------
// 2. 小飞机
// ---------------------------------------------------------------------------

function airplane(): BrickData[] {
  // 先按「机头朝 +z」设计，最后整体旋转为机头朝 +x，以便默认视角看到侧前方
  const b = new Builder(16);

  // 跑道中线与橙色路锥
  for (const z of [-12, 9]) b.add('tile-2x4', C.white, -1, 0, z, 1);
  for (const [x, z] of [
    [-11, 2],
    [10, 2],
    [-11, -3],
    [10, -3],
  ]) {
    b.add('plate-1x1', C.white, x, 0, z);
    b.add('cone-1x1', C.orange, x, 1, z);
  }

  // 起落架：主轮在机翼下，前轮在机头下
  b.add('round-brick-1x1', C.black, -4, 0, 1);
  b.add('round-brick-1x1', C.black, 3, 0, 1);
  b.add('round-brick-1x1', C.black, -1, 0, 5);
  b.add('round-brick-1x1', C.black, 0, 0, 5);
  b.add('round-plate-1x1', C.lightGray, -1, 3, 5);
  b.add('round-plate-1x1', C.lightGray, 0, 3, 5);

  // 机翼（16 格翼展）与翼面平滑板
  b.add('plate-4x8', C.white, -8, 3, -1);
  b.add('plate-4x8', C.white, 0, 3, -1);
  b.add('tile-2x4', C.red, -8, 4, -1, 1);
  b.add('tile-2x4', C.white, -6, 4, -1, 1);
  b.add('tile-2x4', C.white, -4, 4, -1, 1);
  b.add('tile-1x4', C.white, -2, 4, -1, 1);
  b.add('tile-1x4', C.white, 1, 4, -1, 1);
  b.add('tile-2x4', C.white, 2, 4, -1, 1);
  b.add('tile-2x4', C.white, 4, 4, -1, 1);
  b.add('tile-2x4', C.red, 6, 4, -1, 1);

  // 机身底板（架在机翼上）
  b.add('plate-2x8', C.white, -1, 4, -7, 1);
  b.add('plate-2x6', C.white, -1, 4, 1, 1);

  // 机身
  b.add('brick-2x2', C.red, -1, 5, -7);
  b.add('brick-2x10', C.red, -1, 5, -5, 1);
  b.add('slope45-2x2', C.red, -1, 5, 5);

  // 座舱、挡风玻璃、仪表台
  b.add('brick-2x6', C.white, -1, 8, -5, 1);
  b.add('slope45-2x2', C.transLightBlue, -1, 8, 1);
  b.add('tile-2x2', C.red, -1, 8, 3);
  b.add('tile-2x4', C.white, -1, 11, -5, 1);
  b.add('tile-2x2', C.white, -1, 11, -1);
  b.add('tile-1x2', C.white, -1, 11, 1);

  // 尾翼：水平尾翼 + 垂直尾翼
  b.add('plate-2x6', C.white, -3, 8, -7);
  b.add('brick-2x2', C.red, -1, 9, -7);
  b.add('slope33-3x2', C.red, -1, 12, -7);
  b.add('tile-1x2', C.red, -3, 9, -7, 1);
  b.add('tile-1x2', C.red, 2, 9, -7, 1);

  return rotateGroup(b.bricks, 1, [0, 0]);
}

// ---------------------------------------------------------------------------
// 3. 城堡塔楼
// ---------------------------------------------------------------------------

function castle(): BrickData[] {
  const b = new Builder(16);
  const r = rng(20261023);
  const stone = () => (r() < 0.66 ? C.lightGray : C.darkGray);
  const X0 = -4,
    X1 = 4,
    Z0 = -4,
    Z1 = 4;
  const front = Z1 - 1;
  const back = Z0;
  const water = C.blue;

  // 护城河、吊桥与小路
  for (const x of [-7, -3, 1]) b.add('tile-2x4', water, x, 0, -7);
  b.add('tile-2x2', water, 5, 0, -7);
  b.add('tile-2x4', water, -7, 0, 5);
  b.add('tile-1x2', water, -3, 0, 5, 1);
  b.add('tile-1x2', water, 2, 0, 5, 1);
  b.add('tile-2x4', water, 3, 0, 5);
  for (const x of [-7, 5]) {
    b.add('tile-2x4', water, x, 0, -5, 1);
    b.add('tile-2x4', water, x, 0, -1, 1);
    b.add('tile-2x2', water, x, 0, 3);
  }
  b.add('tile-2x4', C.reddishBrown, -2, 0, 5);
  for (const z of [7, 9, 11, 13]) b.add('tile-2x4', C.darkTan, -2, 0, z);

  // 塔身：6 层石墙，正面拱门，侧面箭窗
  const opening = (layer: number) => (x: number, z: number) => {
    if (z === front && layer <= 1 && x >= -2 && x < 2) return true;
    if (layer === 3 || layer === 4) {
      if ((x === X0 || x === X1 - 1) && (z === -2 || z === 1)) return true;
      if ((z === front || z === back) && (x === -3 || x === 2)) return true;
    }
    return false;
  };
  for (let layer = 0; layer < 6; layer++) {
    const y = layer * 3;
    if (layer === 2) b.add('arch-1x6', C.lightGray, -3, y, front);
    wallRing(b, X0, Z0, X1, Z1, y, layer, stone, opening(layer));
  }

  // 大门两侧的火把
  for (const x of [-3, 2]) {
    b.add('round-brick-1x1', C.reddishBrown, x, 0, front + 1);
    b.add('round-brick-1x1', C.reddishBrown, x, 3, front + 1);
    b.add('cone-1x1', C.transOrange, x, 6, front + 1);
  }

  // 塔顶平台与垛口
  b.add('plate-8x8', C.darkGray, X0, 18, Z0);
  for (const [x, z] of [
    [X0, Z0],
    [X1 - 1, Z0],
    [X0, Z1 - 1],
    [X1 - 1, Z1 - 1],
  ]) {
    b.add('round-brick-1x1', C.lightGray, x, 19, z);
    b.add('cone-1x1', C.darkRed, x, 22, z);
  }
  for (const z of [Z0, Z1 - 1]) {
    b.add('brick-1x1', stone(), X0 + 1, 19, z);
    b.add('brick-1x2', stone(), X0 + 3, 19, z);
    b.add('brick-1x1', stone(), X0 + 6, 19, z);
  }
  for (const x of [X0, X1 - 1]) {
    b.add('brick-1x1', stone(), x, 19, Z0 + 1);
    b.add('brick-1x2', stone(), x, 19, Z0 + 3, 1);
    b.add('brick-1x1', stone(), x, 19, Z0 + 6);
  }

  // 烽火台
  b.add('round-brick-2x2', C.darkGray, -1, 19, -1);
  b.add('round-brick-2x2', C.darkGray, -1, 22, -1);
  b.add('cone-1x1', C.transOrange, -1, 25, -1);
  b.add('cone-1x1', C.transYellow, 0, 25, -1);
  b.add('cone-1x1', C.transYellow, -1, 25, 0);
  b.add('cone-1x1', C.transOrange, 0, 25, 0);

  tree(b, -11, -10);
  tree(b, 11, -9);
  tree(b, 11, 10);
  return b.bricks;
}

// ---------------------------------------------------------------------------
// 4. 火箭发射台
// ---------------------------------------------------------------------------

function rocket(): BrickData[] {
  const b = new Builder(12);
  // 9×9 发射台，中心与 3×3 火箭对齐（火箭占 x、z∈[-1,2)）
  b.add('plate-8x8', C.darkGray, -4, 0, -4);
  b.add('plate-1x8', C.darkGray, 4, 0, -4, 1);
  b.add('plate-1x8', C.darkGray, -4, 0, 4);
  b.add('plate-1x1', C.darkGray, 4, 0, 4);
  // 发射台四角警示灯
  b.add('tile-2x2', C.yellow, 3, 1, 3);
  b.add('tile-2x2', C.yellow, 3, 1, -4);
  b.add('round-plate-1x1', C.transRed, -4, 1, -4);
  b.add('round-plate-1x1', C.transRed, -4, 1, 4);

  // 发动机喷口
  for (const [x, z] of [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ]) {
    b.add('round-brick-1x1', C.darkGray, x, 1, z);
  }
  b.add('brick-1x1', C.black, 0, 1, 0);

  // 四片尾翼
  b.add('brick-1x2', C.red, 2, 1, 0);
  b.add('slope45-2x1', C.red, 2, 4, 0, 1);
  b.add('brick-1x2', C.red, -3, 1, 0);
  b.add('slope45-2x1', C.red, -3, 4, 0, 3);
  b.add('brick-1x2', C.red, 0, 1, 2, 1);
  b.add('slope45-2x1', C.red, 0, 4, 2, 0);
  b.add('brick-1x2', C.red, 0, 1, -3, 1);
  b.add('slope45-2x1', C.red, 0, 4, -3, 2);

  // 箭体：四角用圆砖让截面更圆润，中间十字交错咬合
  for (let i = 0; i < 6; i++) {
    const y = 4 + i * 3;
    const color = i === 2 ? C.red : C.white;
    for (const [x, z] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      b.add('round-brick-1x1', color, x, y, z);
    }
    if (i % 2 === 0) {
      b.add('brick-1x3', color, -1, y, 0);
      b.add('brick-1x1', color, 0, y, -1);
      if (i === 4) b.add('round-brick-1x1', C.transLightBlue, 0, y, 1);
      else b.add('brick-1x1', color, 0, y, 1);
    } else {
      b.add('brick-1x3', color, 0, y, -1, 1);
      b.add('brick-1x1', color, -1, y, 0);
      if (i === 3) b.add('round-brick-1x1', C.transLightBlue, 1, y, 0);
      else b.add('brick-1x1', color, 1, y, 0);
    }
  }

  // 箭头：逐层收窄的锥形
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    b.add('cone-1x1', C.red, x, 22, z);
  }
  b.add('brick-1x3', C.red, -1, 22, 0);
  b.add('brick-1x1', C.red, 0, 22, -1);
  b.add('brick-1x1', C.red, 0, 22, 1);
  b.add('brick-1x1', C.red, 0, 25, 0);
  for (const [x, z] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]) {
    b.add('cone-1x1', C.red, x, 25, z);
  }
  b.add('round-brick-1x1', C.red, 0, 28, 0);
  b.add('cone-1x1', C.white, 0, 31, 0);

  // 发射塔与摆臂
  for (let i = 0; i < 7; i++) b.add('brick-2x2', i % 2 === 0 ? C.lightGray : C.red, -4, 1 + i * 3, 1);
  b.add('plate-1x3', C.yellow, -4, 22, 1);
  b.add('plate-1x2', C.darkGray, -4, 22, 2);
  b.add('round-plate-1x1', C.transRed, -4, 23, 2);

  // 燃料罐
  for (const x of [6, 9]) {
    for (let i = 0; i < 3; i++) b.add('round-brick-2x2', C.white, x, i * 3, -9);
    b.add('round-plate-2x2', C.red, x, 9, -9);
  }
  // 指挥室（窗户朝向发射台）
  b.add('brick-2x4', C.darkGray, -10, 0, -8);
  b.add('brick-1x4', C.darkGray, -10, 3, -8);
  b.add('brick-1x4', C.transLightBlue, -10, 3, -7);
  b.add('plate-2x4', C.lightGray, -10, 6, -8);
  b.add('round-plate-1x1', C.transRed, -7, 7, -8);
  return b.bricks;
}

// ---------------------------------------------------------------------------
// 5. 像素爱心
// ---------------------------------------------------------------------------

const HEART = [
  '..KKK.....KKK..',
  '.KRRRK...KRRRK.',
  'KRWWRRK.KRRRRDK',
  'KRWRRRRKRRRRRDK',
  'KRRRRRRRRRRRRDK',
  'KRRRRRRRRRRRDDK',
  '.KRRRRRRRRRRDK.',
  '..KRRRRRRRRDK..',
  '...KRRRRRRDK...',
  '....KRRRRDK....',
  '.....KRRDK.....',
  '......KDK......',
  '.......K.......',
];

function heart(): BrickData[] {
  const b = new Builder(12);
  const palette: Record<string, number> = {
    K: C.black,
    R: C.red,
    D: C.darkRed,
    W: C.white,
    '.': C.brightLightBlue,
  };
  const W = HEART[0].length + 2;
  const H = HEART.length + 2;
  const x0 = -9;
  const z0 = -8;
  // 背景 + 爱心：逐行把同色格子合并成平滑板
  for (let row = 0; row < H; row++) {
    const line = row === 0 || row === H - 1 ? '.'.repeat(W) : `.${HEART[row - 1]}.`;
    let start = 0;
    for (let col = 1; col <= W; col++) {
      if (col < W && line[col] === line[start]) continue;
      let x = x0 + start;
      let len = col - start;
      while (len > 0) {
        const piece = len >= 6 ? 6 : len === 5 ? 4 : len;
        b.add(`tile-1x${piece}`, palette[line[start]], x, 0, z0 + row);
        x += piece;
        len -= piece;
      }
      start = col;
    }
  }
  // 木质相框
  const frame = () => C.reddishBrown;
  const fx0 = x0 - 1;
  const fz0 = z0 - 1;
  wallRing(b, fx0, fz0, fx0 + W + 2, fz0 + H + 2, 0, 0, frame);
  return b.bricks;
}

// ---------------------------------------------------------------------------
// 6. 彩虹金字塔
// ---------------------------------------------------------------------------

function pyramid(): BrickData[] {
  const b = new Builder(12);
  const colors = [C.red, C.orange, C.yellow, C.brightGreen, C.azure, C.blue, C.mediumLavender];
  for (let k = 0; k < colors.length; k++) {
    const y = k * 3;
    const a = -7 + k;
    const e = 7 - k;
    const color = colors[k];
    const size = e - a;
    const offset = k % 2 === 1;
    if (size <= 4) {
      // 顶部实心
      for (let z = a; z < e; z += 2) band2(b, 'x', a, e, z, y, color, false);
      continue;
    }
    // 2 格宽的回字形，奇偶层交替由哪一侧占用四角
    if (k % 2 === 0) {
      band2(b, 'x', a, e, a, y, color, offset);
      band2(b, 'x', a, e, e - 2, y, color, !offset);
      band2(b, 'z', a + 2, e - 2, a, y, color, offset);
      band2(b, 'z', a + 2, e - 2, e - 2, y, color, !offset);
    } else {
      band2(b, 'z', a, e, a, y, color, offset);
      band2(b, 'z', a, e, e - 2, y, color, !offset);
      band2(b, 'x', a + 2, e - 2, a, y, color, offset);
      band2(b, 'x', a + 2, e - 2, e - 2, y, color, !offset);
    }
  }
  // 塔顶的金色宝石
  b.add('round-brick-2x2', C.pearlGold, -1, 21, -1);
  b.add('round-plate-2x2', C.transYellow, -1, 24, -1);
  // 四周的小花
  const flowers = [C.red, C.yellow, C.brightPink, C.white];
  let i = 0;
  for (const [x, z] of [
    [-9, -9],
    [8, -9],
    [-9, 8],
    [8, 8],
    [-9, 0],
    [8, -1],
    [0, -9],
    [-1, 8],
  ]) {
    b.add('plate-1x1', C.green, x, 0, z);
    b.add('round-plate-1x1', flowers[i++ % flowers.length], x, 1, z);
  }
  return b.bricks;
}

/** 最初的 6 个示例 */
export const BASIC_TEMPLATES: Template[] = [
  {
    id: 'cottage',
    level: 2,
    name: { zh: '温馨小屋', en: 'Cosy Cottage' },
    description: {
      zh: '白墙红顶的小房子，有拱门、透明窗户、烟囱和院子里的树。',
      en: 'A white cottage with a red gable roof, arched door, glass windows, a chimney and garden trees.',
    },
    baseplateSize: 32,
    baseplateColor: C.brightGreen,
    build: cottage,
  },
  {
    id: 'airplane',
    level: 1,
    name: { zh: '红色小飞机', en: 'Red Airplane' },
    description: {
      zh: '停在跑道上的螺旋桨小飞机，带透明挡风玻璃和尾翼。',
      en: 'A little red plane waiting on the runway, with a glass windshield and tail fin.',
    },
    baseplateSize: 32,
    baseplateColor: C.darkGray,
    build: airplane,
  },
  {
    id: 'castle',
    level: 2,
    name: { zh: '城堡塔楼', en: 'Castle Tower' },
    description: {
      zh: '石砌塔楼，配有拱门、箭窗、垛口、烽火台和护城河吊桥。',
      en: 'A stone tower with an arched gate, arrow slits, battlements, a beacon and a moat with a drawbridge.',
    },
    baseplateSize: 32,
    baseplateColor: C.green,
    build: castle,
  },
  {
    id: 'rocket',
    level: 2,
    name: { zh: '火箭发射台', en: 'Rocket Launch' },
    description: {
      zh: '整装待发的火箭，旁边是发射塔、燃料罐和指挥室。',
      en: 'A rocket ready for lift-off, with a launch tower, fuel tanks and a control room.',
    },
    baseplateSize: 24,
    baseplateColor: C.tan,
    build: rocket,
  },
  {
    id: 'heart',
    level: 1,
    name: { zh: '像素爱心', en: 'Pixel Heart' },
    description: {
      zh: '用平滑板拼成的像素画，装在木质相框里。',
      en: 'A pixel-art mosaic made of smooth tiles, set in a wooden frame.',
    },
    baseplateSize: 24,
    baseplateColor: C.white,
    build: heart,
  },
  {
    id: 'pyramid',
    level: 1,
    name: { zh: '彩虹金字塔', en: 'Rainbow Pyramid' },
    description: {
      zh: '七种颜色层层堆叠的阶梯金字塔，顶上镶着金色宝石。',
      en: 'A seven-colour stepped pyramid crowned with a golden gem.',
    },
    baseplateSize: 24,
    baseplateColor: C.lightGray,
    build: pyramid,
  },
];

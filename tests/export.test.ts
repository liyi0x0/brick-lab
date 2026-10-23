import { describe, expect, it } from 'vitest';
import { buildBom, bomToBrickLinkXML, bomToCSV } from '../src/core/bom';
import { PLATE_H } from '../src/core/constants';
import { ldrawPlacement, toLDraw } from '../src/core/ldraw';
import { getPart, rotateCell, topStudCells } from '../src/core/parts';
import type { Brick, Rot } from '../src/core/types';

/**
 * 用官方 LDraw 零件文件中的凸点坐标做核对：
 * 把 LDraw 原生凸点位置按导出矩阵变换到世界坐标，应与本项目渲染的凸点位置完全重合。
 */
const LDRAW_STUDS: Record<string, [number, number, number][]> = {
  'brick-2x4': [[30, 0, 10], [10, 0, 10], [-10, 0, 10], [-30, 0, 10], [30, 0, -10], [10, 0, -10], [-10, 0, -10], [-30, 0, -10]],
  'brick-1x2': [[10, 0, 0], [-10, 0, 0]],
  'slope45-2x1': [[0, 0, 0]],
  'slope45-2x2': [[-10, 0, 0], [10, 0, 0]],
  'slope33-3x2': [[-10, 0, 0], [10, 0, 0]],
  'slope45inv-2x2': [[10, 0, 0], [10, 0, -20], [-10, 0, 0], [-10, 0, -20]],
  'corner-brick-2x2': [[0, 0, 0], [20, 0, 0], [0, 0, 20]],
  'arch-1x4': [[-30, 0, 0], [-10, 0, 0], [10, 0, 0], [30, 0, 0]],
  'round-brick-2x2': [[10, 0, 10], [-10, 0, 10], [10, 0, -10], [-10, 0, -10]],
};

function ourStudsLDU(b: Brick): string[] {
  const part = getPart(b.part);
  const top = (b.y + part.h) * PLATE_H;
  return topStudCells(part)
    .map(([lx, lz]) => {
      const [x, z] = rotateCell(lx, lz, part.w, part.d, b.rot);
      const wx = b.x + x + 0.5;
      const wz = b.z + z + 0.5;
      return [Math.round(wx * 20), Math.round(-top * 20), Math.round(-wz * 20)].join(',');
    })
    .sort();
}

function ldrawStudsLDU(b: Brick, native: [number, number, number][]): string[] {
  const p = ldrawPlacement(b);
  const m = p.matrix;
  return native
    .map(([x, y, z]) =>
      [
        Math.round(p.pos[0] + m[0] * x + m[1] * y + m[2] * z),
        Math.round(p.pos[1] + m[3] * x + m[4] * y + m[5] * z),
        Math.round(p.pos[2] + m[6] * x + m[7] * y + m[8] * z),
      ].join(','),
    )
    .sort();
}

describe('LDraw 导出', () => {
  for (const [partId, studs] of Object.entries(LDRAW_STUDS)) {
    for (const rot of [0, 1, 2, 3] as Rot[]) {
      it(`${partId} 朝向 ${rot} 的凸点与官方零件吻合`, () => {
        const b: Brick = { id: 1, part: partId, color: 4, x: 3, y: 6, z: -5, rot };
        expect(ldrawStudsLDU(b, studs)).toEqual(ourStudsLDU(b));
      });
    }
  }

  it('生成合法的 LDR 文本', () => {
    const text = toLDraw('测试', [
      { id: 1, part: 'brick-2x4', color: 4, x: 0, y: 0, z: 0, rot: 0 },
      { id: 2, part: 'plate-1x2', color: 15, x: 0, y: 3, z: 0, rot: 1 },
    ]);
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe('0 测试');
    expect(lines).toContain('1 4 40 -24 -20 1 0 0 0 1 0 0 0 1 3001.dat');
    expect(lines.filter((l) => l === '0 STEP')).toHaveLength(2);
    expect(text).toContain('3023b.dat');
  });
});

describe('零件清单', () => {
  const bricks: Brick[] = [
    { id: 1, part: 'brick-2x4', color: 4, x: 0, y: 0, z: 0, rot: 0 },
    { id: 2, part: 'brick-2x4', color: 4, x: 0, y: 3, z: 0, rot: 0 },
    { id: 3, part: 'brick-2x4', color: 1, x: 0, y: 6, z: 0, rot: 0 },
    { id: 4, part: 'tile-1x1', color: 15, x: 5, y: 0, z: 0, rot: 0 },
  ];
  it('按零件和颜色汇总', () => {
    const rows = buildBom(bricks);
    expect(rows.map((r) => [r.part.id, r.color, r.count])).toEqual([
      ['brick-2x4', 1, 1],
      ['brick-2x4', 4, 2],
      ['tile-1x1', 15, 1],
    ]);
  });
  it('导出 CSV 与 BrickLink XML', () => {
    const rows = buildBom(bricks);
    expect(bomToCSV(rows, 'en')).toContain('Brick 2×4,3001,3001,Red,4,5,2');
    const xml = bomToBrickLinkXML(rows);
    expect(xml).toContain('<ITEMID>3070</ITEMID>');
    expect(xml).toContain('<COLOR>5</COLOR>');
    expect(xml).toContain('<MINQTY>2</MINQTY>');
  });
});

describe('LDraw 导入', () => {
  it('导出后再导入得到相同的积木', async () => {
    const { fromLDraw } = await import('../src/core/ldraw');
    const bricks: Brick[] = [
      { id: 1, part: 'brick-2x4', color: 4, x: -2, y: 0, z: -1, rot: 0 },
      { id: 2, part: 'slope45-2x2', color: 1, x: -2, y: 3, z: -1, rot: 1 },
      { id: 3, part: 'corner-brick-2x2', color: 14, x: 0, y: 3, z: -1, rot: 3 },
      { id: 4, part: 'arch-1x4', color: 71, x: -2, y: 0, z: 1, rot: 2 },
      { id: 5, part: 'plate-1x2', color: 15, x: 3, y: 0, z: -1, rot: 1 },
    ];
    const res = fromLDraw(toLDraw('t', bricks), () => true);
    expect(res.skipped).toBe(0);
    const norm = (list: { part: string; color: number; x: number; y: number; z: number; rot: number }[]) =>
      list.map((b) => `${b.part}|${b.color}|${b.x}|${b.y}|${b.z}|${b.rot}`).sort();
    // 导入时会把作品居中，这里比较相对位置
    const shift = (list: typeof res.bricks) => {
      const mx = Math.min(...list.map((b) => b.x));
      const mz = Math.min(...list.map((b) => b.z));
      return list.map((b) => ({ ...b, x: b.x - mx, z: b.z - mz }));
    };
    expect(norm(shift(res.bricks))).toEqual(norm(shift(bricks)));
  });

  it('展开 MPD 子模型并识别旧零件编号', async () => {
    const { fromLDraw } = await import('../src/core/ldraw');
    const mpd = [
      '0 FILE main.ldr',
      '0 Demo model',
      '1 16 0 0 0 1 0 0 0 1 0 0 0 1 sub.ldr',
      '1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3023.dat',
      '1 4 100 0 0 1 0 0 0 1 0 0 0 1 99999.dat',
      '0 FILE sub.ldr',
      '1 1 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat',
    ].join('\n');
    const res = fromLDraw(mpd, () => true);
    expect(res.name).toBe('Demo model');
    expect(res.skipped).toBe(1);
    expect(res.bricks.map((b) => b.part).sort()).toEqual(['brick-2x4', 'plate-1x2']);
  });
});

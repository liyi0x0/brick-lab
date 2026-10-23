import { describe, expect, it } from 'vitest';
import { brickVoxels } from '../src/core/parts';
import { Builder } from '../src/core/templates/builder';
import { pixelArt, Voxels } from '../src/core/templates/sculpt';
import { looseBricks } from './templateChecks';

/** 拆出的积木恰好覆盖全部体素：不多不少、颜色一致 */
function coverage(v: Voxels, bricks: { part: string; color: number; x: number; y: number; z: number; rot: 0 | 1 | 2 | 3 }[]) {
  const got = new Map<string, number>();
  for (const b of bricks) for (const [x, y, z] of brickVoxels(b)) got.set(`${x},${Math.floor(y / v.layerH)},${z}`, b.color);
  const want = new Map<string, number>();
  v.forEach((x, l, z, c) => want.set(`${x},${l},${z}`, c));
  return { got, want };
}

describe('体素雕刻', () => {
  it('实心球：拆成的板恰好覆盖所有体素，且全部相连', () => {
    const v = new Voxels(1).sphere(0, 5, 0, 5, 4);
    const b = new Builder(16, { allowHanging: true });
    v.build(b);
    b.assertConnected();
    const { got, want } = coverage(v, b.bricks);
    expect(got).toEqual(want);
    expect(looseBricks(b.bricks)).toHaveLength(0);
    // 同色合并后零件数远少于体素数
    expect(b.bricks.length).toBeLessThan(v.size / 3);
  });

  it('挖空的椭球依然连成一体，零件更少', () => {
    const solid = new Voxels(1).ellipsoid(0, 6, 0, 6, 6, 5, 1);
    const hollow = new Voxels(1).ellipsoid(0, 6, 0, 6, 6, 5, 1).hollow(1);
    expect(hollow.size).toBeLessThan(solid.size * 0.7);
    const b = new Builder(16, { allowHanging: true });
    hollow.build(b);
    b.assertConnected();
    expect(looseBricks(b.bricks)).toHaveLength(0);
  });

  it('多色形状按颜色分别合并，砖层与平滑板顶面', () => {
    const v = new Voxels(3).box(-3, 0, -2, 3, 3.6, 2, 15);
    v.paint((x) => (x < 0 ? 4 : null));
    const b = new Builder(16);
    v.build(b);
    expect(new Set(b.bricks.map((x) => x.color))).toEqual(new Set([4, 15]));
    expect(b.bricks.every((x) => x.part.startsWith('brick-'))).toBe(true);
    const t = new Builder(16);
    new Voxels(1).box(-2, 0, -2, 2, 0.8, 2, 1).build(t, { tileTop: true });
    expect(t.bricks.filter((x) => x.y === 1).every((x) => x.part.startsWith('tile-'))).toBe(true);
  });

  it('像素画', () => {
    const v = pixelArt(['RRW', 'R.W'], { R: 4, W: 15 }, 0, 0);
    expect(v.size).toBe(5);
    const b = new Builder(8);
    v.build(b);
    expect(coverage(v, b.bricks).got).toEqual(coverage(v, b.bricks).want);
  });

  it('有悬空孤岛时 assertConnected 报错', () => {
    const v = new Voxels(1).box(0, 4, 0, 2, 4.4, 2, 1); // 悬在空中的一块
    const b = new Builder(8, { allowHanging: true });
    v.build(b);
    expect(() => b.assertConnected()).toThrow(/没有连到地面/);
  });
});

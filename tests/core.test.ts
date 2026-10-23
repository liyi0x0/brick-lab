import { describe, expect, it } from 'vitest';
import { PLATE_H } from '../src/core/constants';
import { Model } from '../src/core/model';
import {
  PARTS,
  brickVoxels,
  footprintCells,
  getPart,
  localVoxels,
  rotateCell,
  rotatedSize,
  topStudCells,
} from '../src/core/parts';
import { computePlacement, groupPivot, pickGrid, rotateGroup } from '../src/core/placement';
import { decodeShare, encodeShare, parseProjectFile, toProjectFile } from '../src/core/serialize';
import type { BrickData, Rot } from '../src/core/types';

describe('零件目录', () => {
  it('id 与 code 唯一', () => {
    expect(new Set(PARTS.map((p) => p.id)).size).toBe(PARTS.length);
    expect(new Set(PARTS.map((p) => p.code)).size).toBe(PARTS.length);
    for (const p of PARTS) expect(p.code).toBeLessThan(256);
  });

  it('旋转后的格子仍在占地矩形内且一一对应', () => {
    for (const p of PARTS) {
      for (const rot of [0, 1, 2, 3] as Rot[]) {
        const [fw, fd] = rotatedSize(p, rot);
        const seen = new Set<string>();
        for (const [lx, lz] of footprintCells(p)) {
          const [x, z] = rotateCell(lx, lz, p.w, p.d, rot);
          expect(x).toBeGreaterThanOrEqual(0);
          expect(z).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(fw);
          expect(z).toBeLessThan(fd);
          seen.add(`${x},${z}`);
        }
        expect(seen.size).toBe(footprintCells(p).length);
      }
    }
  });

  it('转角砖缺一格，拱门下方镂空', () => {
    expect(footprintCells(getPart('corner-brick-2x2'))).toHaveLength(3);
    const arch = getPart('arch-1x4');
    expect(localVoxels(arch)).toHaveLength(4 * 3 - 2 * 2);
  });

  it('斜坡只有后排有凸点', () => {
    expect(topStudCells(getPart('slope45-2x2'))).toEqual([
      [0, 0],
      [1, 0],
    ]);
    expect(topStudCells(getPart('slope45inv-2x2'))).toHaveLength(4);
    expect(topStudCells(getPart('tile-2x2'))).toHaveLength(0);
  });
});

describe('Model', () => {
  const brick = (x: number, y: number, z: number, part = 'brick-2x4', rot: Rot = 0): BrickData => ({
    part,
    color: 4,
    x,
    y,
    z,
    rot,
  });

  it('放置、碰撞与撤销重做', () => {
    const m = new Model();
    expect(m.addBricks([brick(0, 0, 0)])).not.toBeNull();
    expect(m.count).toBe(1);
    // 重叠位置被拒绝
    expect(m.addBricks([brick(1, 1, 0)])).toBeNull();
    // 正好在上方可以
    expect(m.addBricks([brick(1, 3, 0)])).not.toBeNull();
    expect(m.count).toBe(2);
    m.undo();
    expect(m.count).toBe(1);
    m.redo();
    expect(m.count).toBe(2);
    expect(m.grid.size).toBe(2 * 4 * 2 * 3);
  });

  it('更新颜色可撤销', () => {
    const m = new Model();
    const [b] = m.addBricks([brick(0, 0, 0)])!;
    m.updateBricks([{ ...b, color: 1 }], 'paint');
    expect(m.get(b.id)!.color).toBe(1);
    m.undo();
    expect(m.get(b.id)!.color).toBe(4);
  });

  it('移动时可以与自身原位置重叠', () => {
    const m = new Model();
    const [b] = m.addBricks([brick(0, 0, 0)])!;
    expect(m.updateBricks([{ ...b, x: 1 }], 'move')).toBe(true);
    expect(m.get(b.id)!.x).toBe(1);
    expect(m.grid.size).toBe(24);
  });

  it('批量删除与清空', () => {
    const m = new Model();
    m.addBricks([brick(0, 0, 0), brick(10, 0, 0), brick(0, 3, 0)]);
    m.clearAll();
    expect(m.count).toBe(0);
    expect(m.grid.size).toBe(0);
    m.undo();
    expect(m.count).toBe(3);
  });
});

describe('拾取与放置', () => {
  it('从上方射向底板命中地面', () => {
    const m = new Model();
    const hit = pickGrid(m.grid, { origin: [0.3, 10, 0.3], dir: [0, -1, 0] }, { groundHalf: 16 });
    expect(hit).not.toBeNull();
    expect(hit!.brickId).toBeNull();
    expect(hit!.normal).toEqual([0, 1, 0]);
  });

  it('命中积木顶面并在其上方放置', () => {
    const m = new Model();
    const [b] = m.addBricks([{ part: 'brick-2x4', color: 4, x: 0, y: 0, z: 0, rot: 0 }])!;
    const hit = pickGrid(m.grid, { origin: [1.5, 10, 0.5], dir: [0, -1, 0] }, { groundHalf: 16 })!;
    expect(hit.brickId).toBe(b.id);
    expect(hit.normal).toEqual([0, 1, 0]);
    expect(hit.point[1]).toBeCloseTo(3 * PLATE_H);
    const p = computePlacement(
      { grid: m.grid, getBrick: (id) => m.get(id), groundHalf: 16 },
      'brick-2x2',
      0,
      hit,
    );
    expect(p).toEqual({ x: 1, y: 3, z: 0, valid: true });
  });

  it('命中侧面时贴面放置', () => {
    const m = new Model();
    m.addBricks([{ part: 'brick-1x1', color: 4, x: 0, y: 0, z: 0, rot: 0 }]);
    const hit = pickGrid(m.grid, { origin: [10, 0.6, 0.5], dir: [-1, 0, 0] }, { groundHalf: 16 })!;
    expect(hit.normal).toEqual([1, 0, 0]);
    const p = computePlacement(
      { grid: m.grid, getBrick: (id) => m.get(id), groundHalf: 16 },
      'brick-1x2',
      0,
      hit,
    );
    expect(p.x).toBe(1);
    expect(p.y).toBe(0);
    expect(p.valid).toBe(true);
  });

  it('与其它积木冲突时自动抬升', () => {
    const m = new Model();
    m.addBricks([{ part: 'brick-1x1', color: 4, x: 1, y: 0, z: 0, rot: 0 }]);
    const hit = pickGrid(m.grid, { origin: [-0.5, 10, 0.5], dir: [0, -1, 0] }, { groundHalf: 16 })!;
    expect(hit.brickId).toBeNull();
    const p = computePlacement(
      { grid: m.grid, getBrick: (id) => m.get(id), groundHalf: 16 },
      'brick-1x4',
      0,
      hit,
    );
    expect(p.valid).toBe(true);
    expect(p.y).toBe(3);
  });

  it('整体旋转四次回到原位', () => {
    const group = [
      { part: 'brick-2x4', x: 0, y: 0, z: 0, rot: 0 as Rot },
      { part: 'brick-1x2', x: 4, y: 3, z: 1, rot: 1 as Rot },
      { part: 'slope45-2x2', x: -2, y: 0, z: 3, rot: 2 as Rot },
    ];
    // 复用同一个旋转中心时，四次旋转精确回到原位
    const pivot = groupPivot(group);
    let g = group;
    for (let i = 0; i < 4; i++) g = rotateGroup(g, 1, pivot);
    expect(g).toEqual(group);
    // 包围盒奇偶一致时，即使每次重新计算中心也能回到原位
    const square = [{ part: 'brick-2x4', x: 0, y: 0, z: 0, rot: 0 as Rot }];
    let s = square;
    for (let i = 0; i < 4; i++) s = rotateGroup(s, -1);
    expect(s).toEqual(square);
    // 旋转后体素数量不变且互不重叠
    const r = rotateGroup(group, 1);
    const keys = new Set(r.flatMap((b) => brickVoxels(b).map((v) => v.join(','))));
    expect(keys.size).toBe(group.reduce((n, b) => n + brickVoxels(b).length, 0));
  });
});

describe('序列化', () => {
  const data = {
    name: '测试作品 Test',
    baseplateSize: 32,
    baseplateColor: 2,
    bricks: [
      { part: 'brick-2x4', color: 4, x: -3, y: 0, z: 5, rot: 1 as Rot },
      { part: 'slope45-2x2', color: 1, x: 0, y: 3, z: 0, rot: 3 as Rot },
      { part: 'plate-8x8', color: 71, x: -10, y: 100, z: -12, rot: 0 as Rot },
    ],
  };

  it('JSON 往返', () => {
    const f = toProjectFile(data, data.bricks);
    const back = parseProjectFile(JSON.parse(JSON.stringify(f)));
    expect(back).toEqual(data);
  });

  it('分享链接往返', async () => {
    const s = await encodeShare(data);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeShare(s)).toEqual(data);
  });

  it('拒绝无效文件', () => {
    expect(() => parseProjectFile({ foo: 1 })).toThrow();
  });
});

describe('相连积木', () => {
  it('沿凸点连接扩散，侧面贴靠不算相连', async () => {
    const { connectedBricks } = await import('../src/core/placement');
    const m = new Model();
    const [a, b, c, d] = m.addBricks([
      { part: 'brick-2x4', color: 4, x: 0, y: 0, z: 0, rot: 0 },
      { part: 'brick-2x2', color: 4, x: 3, y: 3, z: 0, rot: 0 }, // 压在 a 右端
      { part: 'plate-1x1', color: 4, x: 4, y: 6, z: 1, rot: 0 }, // 压在 b 上
      { part: 'brick-1x1', color: 4, x: 0, y: 0, z: 2, rot: 0 }, // 与 a 侧面贴靠
    ])!;
    const ids = connectedBricks(m.grid, (id) => m.get(id), a.id).sort();
    expect(ids).toEqual([a.id, b.id, c.id].sort());
    expect(connectedBricks(m.grid, (id) => m.get(id), d.id)).toEqual([d.id]);
  });
});

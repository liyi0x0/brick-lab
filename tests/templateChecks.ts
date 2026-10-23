import { describe, expect, it } from 'vitest';
import { BASEPLATE_SIZES } from '../src/core/constants';
import { hasColor } from '../src/core/colors';
import { Model } from '../src/core/model';
import { brickVoxels, findPart, getPart, rotateCell, topStudCells } from '../src/core/parts';
import type { Template } from '../src/core/templates/builder';
import type { BrickData } from '../src/core/types';

/** 独立于 Builder 的连通性检查：每块积木都必须经由凸点咬合（向上或向下）连到地面 */
export function looseBricks(bricks: BrickData[]): BrickData[] {
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const studOwner = new Map<string, number>();
  const bottomOwner = new Map<string, number>();
  bricks.forEach((b, i) => {
    const p = getPart(b.part);
    for (const [lx, lz] of topStudCells(p)) {
      const [rx, rz] = rotateCell(lx, lz, p.w, p.d, b.rot);
      studOwner.set(key(b.x + rx, b.y + p.h, b.z + rz), i);
    }
    for (const [x, y, z] of brickVoxels(b)) if (y === b.y) bottomOwner.set(key(x, y, z), i);
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
  const queue = bricks.map((b, i) => (b.y === 0 ? i : -1)).filter((i) => i >= 0);
  queue.forEach((i) => (seen[i] = 1));
  while (queue.length) {
    const i = queue.pop()!;
    for (const j of adj[i]) if (!seen[j]) (seen[j] = 1), queue.push(j);
  }
  return bricks.filter((_, i) => !seen[i]);
}

/** 对一组示例作品做完整校验 */
export function checkTemplates(list: Template[]) {
  it('id 唯一', () => {
    expect(new Set(list.map((t) => t.id)).size).toBe(list.length);
  });

  for (const t of list) {
    describe(`${t.id}（${t.name.zh}）`, () => {
      const bricks = t.build();

      it('有内容，零件、颜色、难度都有效', () => {
        expect(bricks.length).toBeGreaterThan(20);
        for (const b of bricks) {
          expect(findPart(b.part), b.part).toBeDefined();
          expect(hasColor(b.color), `颜色 ${b.color}`).toBe(true);
        }
        expect(hasColor(t.baseplateColor)).toBe(true);
        expect((BASEPLATE_SIZES as readonly number[]).includes(t.baseplateSize)).toBe(true);
        expect([1, 2, 3]).toContain(t.level);
        // 「挑战」级是真正的大型作品
        if (t.level === 3) expect(bricks.length).toBeGreaterThanOrEqual(600);
        expect(t.name.en && t.description.zh && t.description.en).toBeTruthy();
      });

      it('载入模型时没有被跳过的积木（无重叠）', () => {
        const r = new Model().load(bricks);
        expect(r.skipped).toBe(0);
        expect(r.loaded).toBe(bricks.length);
      });

      it('全部位于底板范围内', () => {
        const h = t.baseplateSize / 2;
        for (const b of bricks) {
          for (const [x, y, z] of brickVoxels(b)) {
            expect(y).toBeGreaterThanOrEqual(0);
            expect(x).toBeGreaterThanOrEqual(-h);
            expect(x).toBeLessThan(h);
            expect(z).toBeGreaterThanOrEqual(-h);
            expect(z).toBeLessThan(h);
          }
        }
      });

      it('没有悬空的零件（全部经由凸点连到地面）', () => {
        const loose = looseBricks(bricks);
        expect(loose.length, loose.slice(0, 3).map((b) => `${b.part}@${b.x},${b.y},${b.z}`).join(' ')).toBe(0);
      });

      it('每次生成结果一致', () => {
        expect(t.build()).toEqual(bricks);
      });
    });
  }
}

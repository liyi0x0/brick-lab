import { describe, expect, it } from 'vitest';
import { BASEPLATE_SIZES } from '../src/core/constants';
import { hasColor } from '../src/core/colors';
import { Model } from '../src/core/model';
import { brickVoxels, findPart } from '../src/core/parts';
import { TEMPLATES } from '../src/core/templates';

describe('示例作品', () => {
  it('id 唯一', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(6);
  });

  for (const t of TEMPLATES) {
    describe(`${t.id}（${t.name.zh}）`, () => {
      const bricks = t.build();

      it('有内容且零件、颜色都有效', () => {
        expect(bricks.length).toBeGreaterThan(20);
        for (const b of bricks) {
          expect(findPart(b.part), b.part).toBeDefined();
          expect(hasColor(b.color), `颜色 ${b.color}`).toBe(true);
        }
        expect(hasColor(t.baseplateColor)).toBe(true);
        expect((BASEPLATE_SIZES as readonly number[]).includes(t.baseplateSize)).toBe(true);
      });

      it('载入模型时没有被跳过的积木', () => {
        const m = new Model();
        const r = m.load(bricks);
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

      it('每次生成结果一致', () => {
        expect(t.build()).toEqual(bricks);
      });
    });
  }
});

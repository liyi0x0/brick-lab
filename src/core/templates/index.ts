import type { BrickData } from '../types';
import { BASIC_TEMPLATES } from './basic';
import type { Template } from './builder';
import { CHINESE_TEMPLATES } from './chinese';
import { CITY_TEMPLATES } from './city';
import { NATURE_TEMPLATES } from './nature';

export type { Template, TemplateLevel } from './builder';

/** 全部示例作品（欢迎页按此顺序展示） */
export const TEMPLATES: Template[] = [...BASIC_TEMPLATES, ...CHINESE_TEMPLATES, ...NATURE_TEMPLATES, ...CITY_TEMPLATES];

const cache = new Map<string, BrickData[]>();

/** 生成示例作品的积木（结果缓存；大型作品的体素雕刻只需算一次） */
export function buildTemplate(t: Template): BrickData[] {
  let bricks = cache.get(t.id);
  if (!bricks) {
    bricks = t.build();
    cache.set(t.id, bricks);
  }
  return bricks;
}

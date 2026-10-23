import { getColor } from './colors';
import { bricklinkId, CATEGORIES, getPart, type PartDef } from './parts';
import type { Brick } from './types';

export interface BomRow {
  part: PartDef;
  color: number;
  count: number;
}

const catOrder = new Map(CATEGORIES.map((c, i) => [c.id, i]));

/** 零件清单：按零件 + 颜色汇总 */
export function buildBom(bricks: Iterable<Brick>): BomRow[] {
  const map = new Map<string, BomRow>();
  for (const b of bricks) {
    const key = `${b.part}|${b.color}`;
    const row = map.get(key);
    if (row) row.count++;
    else map.set(key, { part: getPart(b.part), color: b.color, count: 1 });
  }
  return [...map.values()].sort(
    (a, b) =>
      catOrder.get(a.part.category)! - catOrder.get(b.part.category)! ||
      a.part.code - b.part.code ||
      a.color - b.color,
  );
}

function csvCell(v: string | number) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function bomToCSV(rows: BomRow[], lang: 'zh' | 'en'): string {
  const header =
    lang === 'zh'
      ? ['零件', 'LDraw 编号', 'BrickLink 编号', '颜色', 'LDraw 颜色', 'BrickLink 颜色', '数量']
      : ['Part', 'LDraw ID', 'BrickLink ID', 'Color', 'LDraw color', 'BrickLink color', 'Quantity'];
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    const c = getColor(r.color);
    lines.push(
      [r.part.name[lang], r.part.ldraw, bricklinkId(r.part), lang === 'zh' ? c.zh : c.en, r.color, c.bl, r.count]
        .map(csvCell)
        .join(','),
    );
  }
  // 带 BOM 头，Excel 打开中文不乱码
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** BrickLink 愿望清单 XML（可在 BrickLink「Wanted → Upload」中导入） */
export function bomToBrickLinkXML(rows: BomRow[]): string {
  const items = rows.map(
    (r) =>
      `  <ITEM>\n    <ITEMTYPE>P</ITEMTYPE>\n    <ITEMID>${bricklinkId(r.part)}</ITEMID>\n    <COLOR>${getColor(r.color).bl}</COLOR>\n    <MINQTY>${r.count}</MINQTY>\n  </ITEM>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<INVENTORY>\n${items.join('\n')}\n</INVENTORY>\n`;
}

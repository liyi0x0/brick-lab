// 颜色编号采用 LDraw 官方颜色代码（LDConfig.ldr 2026-05），导出 .ldr 时无需转换。
// 显示用的十六进制值取自 LDConfig；三种蓝灰色采用更常见的 BrickLink 色值以还原实物的冷色调。
// bl = BrickLink 颜色编号（按 LEGO 官方颜色号核对），用于导出 BrickLink 采购清单。

export type ColorKind = 'solid' | 'trans' | 'metal';

export interface BrickColor {
  id: number;
  zh: string;
  en: string;
  hex: string;
  kind: ColorKind;
  bl: number;
}

export const COLORS: readonly BrickColor[] = [
  // —— 中性色 ——
  { id: 15, zh: '白色', en: 'White', hex: '#F4F4F4', kind: 'solid', bl: 1 },
  { id: 151, zh: '极浅灰', en: 'Very Light Bluish Gray', hex: '#E6E3E0', kind: 'solid', bl: 99 },
  { id: 71, zh: '浅灰', en: 'Light Bluish Gray', hex: '#A0A5A9', kind: 'solid', bl: 86 },
  { id: 72, zh: '深灰', en: 'Dark Bluish Gray', hex: '#6C6E68', kind: 'solid', bl: 85 },
  { id: 0, zh: '黑色', en: 'Black', hex: '#1B2A34', kind: 'solid', bl: 11 },
  // —— 红 / 橙 / 黄 ——
  { id: 4, zh: '红色', en: 'Red', hex: '#B40000', kind: 'solid', bl: 5 },
  { id: 320, zh: '深红', en: 'Dark Red', hex: '#720012', kind: 'solid', bl: 59 },
  { id: 353, zh: '珊瑚红', en: 'Coral', hex: '#FF6D77', kind: 'solid', bl: 220 },
  { id: 25, zh: '橙色', en: 'Orange', hex: '#D67923', kind: 'solid', bl: 4 },
  { id: 191, zh: '亮橙黄', en: 'Bright Light Orange', hex: '#FCAC00', kind: 'solid', bl: 110 },
  { id: 14, zh: '黄色', en: 'Yellow', hex: '#FAC80A', kind: 'solid', bl: 3 },
  { id: 226, zh: '浅黄', en: 'Bright Light Yellow', hex: '#FFEC6C', kind: 'solid', bl: 103 },
  // —— 绿 ——
  { id: 326, zh: '嫩黄绿', en: 'Yellowish Green', hex: '#E2F99A', kind: 'solid', bl: 158 },
  { id: 27, zh: '青柠绿', en: 'Lime', hex: '#A5CA18', kind: 'solid', bl: 34 },
  { id: 10, zh: '亮绿', en: 'Bright Green', hex: '#58AB41', kind: 'solid', bl: 36 },
  { id: 2, zh: '绿色', en: 'Green', hex: '#00852B', kind: 'solid', bl: 6 },
  { id: 288, zh: '深绿', en: 'Dark Green', hex: '#00451A', kind: 'solid', bl: 80 },
  { id: 378, zh: '沙绿', en: 'Sand Green', hex: '#708E7C', kind: 'solid', bl: 48 },
  { id: 330, zh: '橄榄绿', en: 'Olive Green', hex: '#77774E', kind: 'solid', bl: 155 },
  // —— 蓝 ——
  { id: 322, zh: '天蓝', en: 'Medium Azure', hex: '#68C3E2', kind: 'solid', bl: 156 },
  { id: 321, zh: '深天蓝', en: 'Dark Azure', hex: '#469BC3', kind: 'solid', bl: 153 },
  { id: 212, zh: '浅蓝', en: 'Bright Light Blue', hex: '#9DC3F7', kind: 'solid', bl: 105 },
  { id: 73, zh: '中蓝', en: 'Medium Blue', hex: '#7396C8', kind: 'solid', bl: 42 },
  { id: 1, zh: '蓝色', en: 'Blue', hex: '#1E5AA8', kind: 'solid', bl: 7 },
  { id: 272, zh: '深蓝', en: 'Dark Blue', hex: '#19325A', kind: 'solid', bl: 63 },
  { id: 379, zh: '沙蓝', en: 'Sand Blue', hex: '#70819A', kind: 'solid', bl: 55 },
  // —— 紫 / 粉 ——
  { id: 31, zh: '薰衣草紫', en: 'Lavender', hex: '#CDA4DE', kind: 'solid', bl: 154 },
  { id: 30, zh: '中紫', en: 'Medium Lavender', hex: '#A06EB9', kind: 'solid', bl: 157 },
  { id: 85, zh: '深紫', en: 'Dark Purple', hex: '#441A91', kind: 'solid', bl: 89 },
  { id: 26, zh: '洋红', en: 'Magenta', hex: '#901F76', kind: 'solid', bl: 71 },
  { id: 5, zh: '深粉', en: 'Dark Pink', hex: '#D3359D', kind: 'solid', bl: 47 },
  { id: 29, zh: '亮粉', en: 'Bright Pink', hex: '#FF9ECD', kind: 'solid', bl: 104 },
  // —— 棕 / 肤色 ——
  { id: 19, zh: '沙色', en: 'Tan', hex: '#D7BA8C', kind: 'solid', bl: 2 },
  { id: 28, zh: '深沙色', en: 'Dark Tan', hex: '#897D62', kind: 'solid', bl: 69 },
  { id: 78, zh: '浅肉色', en: 'Light Nougat', hex: '#FFC995', kind: 'solid', bl: 90 },
  { id: 92, zh: '肉色', en: 'Nougat', hex: '#BB805A', kind: 'solid', bl: 28 },
  { id: 84, zh: '中肉色', en: 'Medium Nougat', hex: '#AA7D55', kind: 'solid', bl: 150 },
  { id: 484, zh: '深橙', en: 'Dark Orange', hex: '#91501C', kind: 'solid', bl: 68 },
  { id: 70, zh: '红棕', en: 'Reddish Brown', hex: '#5F3109', kind: 'solid', bl: 88 },
  { id: 308, zh: '深棕', en: 'Dark Brown', hex: '#352100', kind: 'solid', bl: 120 },
  // —— 金属 ——
  { id: 297, zh: '珠光金', en: 'Pearl Gold', hex: '#AA7F2E', kind: 'metal', bl: 115 },
  { id: 315, zh: '亮银', en: 'Flat Silver', hex: '#8C8C8C', kind: 'metal', bl: 95 },
  { id: 80, zh: '金属银', en: 'Metallic Silver', hex: '#767676', kind: 'metal', bl: 67 },
  // —— 透明 ——
  { id: 47, zh: '透明', en: 'Trans-Clear', hex: '#FCFCFC', kind: 'trans', bl: 12 },
  { id: 40, zh: '透明烟灰', en: 'Trans-Brown', hex: '#635F52', kind: 'trans', bl: 13 },
  { id: 36, zh: '透明红', en: 'Trans-Red', hex: '#C91A09', kind: 'trans', bl: 17 },
  { id: 57, zh: '透明橙', en: 'Trans-Orange', hex: '#F08F1C', kind: 'trans', bl: 98 },
  { id: 46, zh: '透明黄', en: 'Trans-Yellow', hex: '#F5CD2F', kind: 'trans', bl: 19 },
  { id: 42, zh: '透明荧光绿', en: 'Trans-Neon Green', hex: '#C0FF00', kind: 'trans', bl: 16 },
  { id: 34, zh: '透明绿', en: 'Trans-Green', hex: '#237841', kind: 'trans', bl: 20 },
  { id: 43, zh: '透明浅蓝', en: 'Trans-Light Blue', hex: '#AEE9EF', kind: 'trans', bl: 15 },
  { id: 33, zh: '透明深蓝', en: 'Trans-Dark Blue', hex: '#0020A0', kind: 'trans', bl: 14 },
  { id: 52, zh: '透明紫', en: 'Trans-Purple', hex: '#A5A5CB', kind: 'trans', bl: 51 },
  { id: 37, zh: '透明深粉', en: 'Trans-Dark Pink', hex: '#DF6695', kind: 'trans', bl: 50 },
];

const byId = new Map(COLORS.map((c) => [c.id, c]));

export function getColor(id: number): BrickColor {
  return byId.get(id) ?? COLORS[0];
}

export function hasColor(id: number): boolean {
  return byId.has(id);
}

export function colorName(id: number, lang: 'zh' | 'en'): string {
  const c = getColor(id);
  return lang === 'zh' ? c.zh : c.en;
}

export const DEFAULT_COLOR = 4;

export const BASEPLATE_COLORS = [2, 10, 288, 71, 72, 19, 15, 1, 322, 0] as const;

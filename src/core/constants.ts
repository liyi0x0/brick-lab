// 世界坐标单位：1 = 一个凸点间距（真实积木 8mm）
// 网格坐标：x / z 以凸点为单位，y 以「板」高为单位（3.2mm）

/** 板（plate）的高度，世界单位 */
export const PLATE_H = 0.4;
/** 一块标准砖 = 3 块板高 */
export const BRICK_PLATES = 3;
/** 凸点半径（4.8mm 直径） */
export const STUD_R = 0.3;
/** 凸点高度（约 1.7mm） */
export const STUD_H = 0.2;
/** 每侧的装配间隙，让相邻积木之间出现细小接缝 */
export const GAP = 0.012;
/** 侧壁厚度（1.2mm） */
export const WALL = 0.15;
/** 顶板厚度（1.0mm） */
export const TOP = 0.125;
/** 边缘圆角 */
export const BEVEL = 0.028;

/** 允许的最高层（以板为单位） */
export const MAX_LEVEL = 600;
/** 网格坐标的最大范围（|x|、|z| 不超过该值） */
export const GRID_LIMIT = 2000;

/** 底板厚度（世界单位） */
export const BASEPLATE_THICKNESS = 0.16;

export const BASEPLATE_SIZES = [16, 24, 32, 48, 64] as const;
export type BaseplateSize = (typeof BASEPLATE_SIZES)[number];

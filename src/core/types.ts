/** 绕 Y 轴旋转的 90° 步数（俯视逆时针） */
export type Rot = 0 | 1 | 2 | 3;

/**
 * 一块已放置的积木。
 * (x, z) 是旋转后占地矩形的最小角（网格坐标），y 是底面所在的板层。
 */
export interface Brick {
  id: number;
  part: string;
  color: number;
  x: number;
  y: number;
  z: number;
  rot: Rot;
}

export type BrickData = Omit<Brick, 'id'>;

export type Vec3 = [number, number, number];

export type Tool = 'build' | 'select' | 'paint' | 'erase';

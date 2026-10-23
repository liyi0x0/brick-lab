import { MAX_LEVEL, PLATE_H } from './constants';
import type { OccupancyGrid } from './grid';
import { brickVoxels, getPart, rotatedSize } from './parts';
import type { Brick, Rot, Vec3 } from './types';

/** 射线拾取结果（网格坐标） */
export interface PickHit {
  /** 命中的积木，null 表示命中底板/地面 */
  brickId: number | null;
  /** 命中的体素（地面命中时 y = -1） */
  cell: Vec3;
  /** 命中面的法线（轴对齐） */
  normal: Vec3;
  /** 世界坐标下的命中点 */
  point: Vec3;
  /** 射线参数 t */
  t: number;
}

export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

export interface PickOptions {
  ignore?: ReadonlySet<number>;
  /** 底板范围（半宽，凸点）。命中底板以外的地面视为未命中 */
  groundHalf?: number;
  maxSteps?: number;
}

/**
 * 体素 DDA 射线遍历（Amanatides & Woo）。
 * 网格单元为 1×1 凸点 × 1 板高。比逐三角形求交快几个数量级，且法线天然轴对齐。
 */
export function pickGrid(grid: OccupancyGrid, ray: Ray, opts: PickOptions = {}): PickHit | null {
  const ignore = opts.ignore;
  const [ox, oyW, oz] = ray.origin;
  const [dx, dyW, dz] = ray.dir;
  // 转换到网格空间（y 以板为单位）
  const oy = oyW / PLATE_H;
  const dy = dyW / PLATE_H;

  // 地面 y=0 的交点
  let tGround = Infinity;
  if (dy < 0 && oy > 0) tGround = -oy / dy;

  const bounds = grid.bounds;
  let tStart = 0;
  let tEnd = tGround;
  if (bounds) {
    // 与积木包围盒求交，跳过空旷区域
    const [t0, t1] = slab([ox, oy, oz], [dx, dy, dz], bounds);
    if (t1 >= t0 && t1 >= 0) {
      tStart = Math.max(0, t0);
      tEnd = Math.min(tEnd, t1 + 1e-6);
    } else {
      tStart = Infinity;
    }
  } else {
    tStart = Infinity;
  }

  if (tStart < tEnd) {
    const eps = 1e-7;
    const sx = ox + dx * (tStart + eps);
    const sy = oy + dy * (tStart + eps);
    const sz = oz + dz * (tStart + eps);
    let ix = Math.floor(sx);
    let iy = Math.floor(sy);
    let iz = Math.floor(sz);
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tDX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = stepX > 0 ? (ix + 1 - ox) / dx : stepX < 0 ? (ix - ox) / dx : Infinity;
    let tMaxY = stepY > 0 ? (iy + 1 - oy) / dy : stepY < 0 ? (iy - oy) / dy : Infinity;
    let tMaxZ = stepZ > 0 ? (iz + 1 - oz) / dz : stepZ < 0 ? (iz - oz) / dz : Infinity;
    // 进入包围盒时穿过的面
    let lastAxis = entryAxis([ox, oy, oz], [dx, dy, dz], tStart, bounds!);
    let tCur = tStart;
    const maxSteps = opts.maxSteps ?? 4096;
    for (let i = 0; i < maxSteps && tCur <= tEnd; i++) {
      if (iy >= 0) {
        const id = grid.get(ix, iy, iz);
        if (id !== undefined && !(ignore && ignore.has(id))) {
          const normal: Vec3 = [0, 0, 0];
          if (lastAxis === 0) normal[0] = -stepX;
          else if (lastAxis === 1) normal[1] = -stepY;
          else normal[2] = -stepZ;
          return {
            brickId: id,
            cell: [ix, iy, iz],
            normal,
            point: [ox + dx * tCur, (oy + dy * tCur) * PLATE_H, oz + dz * tCur],
            t: tCur,
          };
        }
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        ix += stepX;
        tCur = tMaxX;
        tMaxX += tDX;
        lastAxis = 0;
      } else if (tMaxY < tMaxZ) {
        iy += stepY;
        tCur = tMaxY;
        tMaxY += tDY;
        lastAxis = 1;
      } else {
        iz += stepZ;
        tCur = tMaxZ;
        tMaxZ += tDZ;
        lastAxis = 2;
      }
    }
  }

  if (tGround < Infinity) {
    const px = ox + dx * tGround;
    const pz = oz + dz * tGround;
    if (opts.groundHalf !== undefined) {
      const h = opts.groundHalf;
      if (px < -h || px > h || pz < -h || pz > h) return null;
    }
    return {
      brickId: null,
      cell: [Math.floor(px), -1, Math.floor(pz)],
      normal: [0, 1, 0],
      point: [px, 0, pz],
      t: tGround,
    };
  }
  return null;
}

function slab(o: Vec3, d: Vec3, b: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }) {
  let t0 = -Infinity;
  let t1 = Infinity;
  const mins = [b.x0, b.y0, b.z0];
  const maxs = [b.x1, b.y1, b.z1];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < mins[a] || o[a] > maxs[a]) return [Infinity, -Infinity];
      continue;
    }
    let ta = (mins[a] - o[a]) / d[a];
    let tb = (maxs[a] - o[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
  }
  return [t0, t1];
}

function entryAxis(
  o: Vec3,
  d: Vec3,
  t: number,
  b: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number },
): 0 | 1 | 2 {
  // 判断在 t 处位于包围盒哪一个面上
  const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  const dist = [
    Math.min(Math.abs(p[0] - b.x0), Math.abs(p[0] - b.x1)),
    Math.min(Math.abs(p[1] - b.y0), Math.abs(p[1] - b.y1)),
    Math.min(Math.abs(p[2] - b.z0), Math.abs(p[2] - b.z1)),
  ];
  if (dist[0] <= dist[1] && dist[0] <= dist[2]) return 0;
  if (dist[1] <= dist[2]) return 1;
  return 2;
}

// ---------------------------------------------------------------------------
// 放置计算
// ---------------------------------------------------------------------------

export interface PlacementResult {
  x: number;
  y: number;
  z: number;
  valid: boolean;
}

export interface PlacementContext {
  grid: OccupancyGrid;
  getBrick: (id: number) => Brick | undefined;
  /** 底板半宽：在底板上放置时，把积木限制在底板范围内 */
  groundHalf: number;
  ignore?: ReadonlySet<number>;
}

/**
 * 通用放置计算（按包围盒 fw×fd×h）：
 * - 命中顶面 / 底板：放在其上，中心对准光标；若冲突则向上抬升
 * - 命中侧面：贴着该面放置，底部与被命中积木对齐
 * - 命中底面：挂在下方
 * collides(x, y, z) 判断以 (x, y, z) 为最小角时是否冲突。
 */
export function computeBoxPlacement(
  ctx: PlacementContext,
  fw: number,
  fd: number,
  h: number,
  hit: PickHit,
  collides: (x: number, y: number, z: number) => boolean,
): PlacementResult {
  const [nx, ny, nz] = hit.normal;
  const [px, , pz] = hit.point;
  const [cx, cy, cz] = hit.cell;
  let x = iround(px - fw / 2);
  let z = iround(pz - fd / 2);
  let y: number;
  const lift = ny === 1;

  if (ny === 1) {
    y = hit.brickId === null ? 0 : cy + 1;
    if (hit.brickId === null) {
      const g = ctx.groundHalf;
      if (fw <= g * 2) x = clamp(x, -g, g - fw);
      if (fd <= g * 2) z = clamp(z, -g, g - fd);
    }
  } else if (ny === -1) {
    y = cy - h;
  } else {
    const hb = hit.brickId !== null ? ctx.getBrick(hit.brickId) : undefined;
    y = hb ? hb.y : cy;
    if (nx === 1) x = cx + 1;
    else if (nx === -1) x = cx - fw;
    if (nz === 1) z = cz + 1;
    else if (nz === -1) z = cz - fd;
  }

  if (y < 0) return { x, y, z, valid: false };
  if (!collides(x, y, z)) return { x, y, z, valid: true };
  if (lift) {
    for (let yy = y + 1; yy < MAX_LEVEL; yy++) {
      if (!collides(x, yy, z)) return { x, y: yy, z, valid: true };
    }
  }
  return { x, y, z, valid: false };
}

/** 单块积木的放置 */
export function computePlacement(
  ctx: PlacementContext,
  partId: string,
  rot: Rot,
  hit: PickHit,
): PlacementResult {
  const part = getPart(partId);
  const [fw, fd] = rotatedSize(part, rot);
  const probe = { part: partId, rot, x: 0, y: 0, z: 0 };
  return computeBoxPlacement(ctx, fw, fd, part.h, hit, (x, y, z) => {
    probe.x = x;
    probe.y = y;
    probe.z = z;
    return ctx.grid.collides(brickVoxels(probe), ctx.ignore);
  });
}

/**
 * 一组积木（粘贴）的放置：以组合包围盒为整体对准光标。
 * 返回相对原始坐标的位移。
 */
export function computeGroupPlacement(
  ctx: PlacementContext,
  bricks: Pick<Brick, 'part' | 'x' | 'y' | 'z' | 'rot'>[],
  hit: PickHit,
): { dx: number; dy: number; dz: number; valid: boolean } {
  const b = groupBounds(bricks);
  const r = computeBoxPlacement(ctx, b.x1 - b.x0, b.z1 - b.z0, b.y1 - b.y0, hit, (x, y, z) =>
    !groupFits(ctx.grid, bricks, x - b.x0, y - b.y0, z - b.z0, ctx.ignore),
  );
  return { dx: r.x - b.x0, dy: r.y - b.y0, dz: r.z - b.z0, valid: r.valid };
}

/** 四舍五入并消除 -0 */
function iround(v: number) {
  return Math.round(v) || 0;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** 组合（多块积木）的整体位移是否合法 */
export function groupFits(
  grid: OccupancyGrid,
  bricks: Pick<Brick, 'part' | 'x' | 'y' | 'z' | 'rot'>[],
  dx: number,
  dy: number,
  dz: number,
  ignore?: ReadonlySet<number>,
): boolean {
  for (const b of bricks) {
    if (grid.collides(brickVoxels({ ...b, x: b.x + dx, y: b.y + dy, z: b.z + dz }), ignore)) return false;
  }
  return true;
}

/** 组合的网格包围盒 */
export function groupBounds(bricks: Pick<Brick, 'part' | 'x' | 'y' | 'z' | 'rot'>[]) {
  let x0 = Infinity,
    y0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity,
    z1 = -Infinity;
  for (const b of bricks) {
    const part = getPart(b.part);
    const [fw, fd] = rotatedSize(part, b.rot);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    z0 = Math.min(z0, b.z);
    x1 = Math.max(x1, b.x + fw);
    y1 = Math.max(y1, b.y + part.h);
    z1 = Math.max(z1, b.z + fd);
  }
  return { x0, y0, z0, x1, y1, z1 };
}

/**
 * 组合的旋转中心。若包围盒两边奇偶相同，取正中心（格点或格子中心），
 * 旋转四次可精确回到原位；否则取最近的格点，此时调用方应缓存该中心以保证可逆。
 */
export function groupPivot(bricks: Pick<Brick, 'part' | 'x' | 'y' | 'z' | 'rot'>[]): [number, number] {
  const b = groupBounds(bricks);
  const sx = b.x0 + b.x1;
  const sz = b.z0 + b.z1;
  if ((sx - sz) % 2 === 0) return [sx / 2, sz / 2];
  return [Math.floor(sx / 2), Math.floor(sz / 2)];
}

/** 整体绕 Y 轴旋转 90°（dir=1 俯视逆时针，-1 顺时针） */
export function rotateGroup<T extends Pick<Brick, 'part' | 'x' | 'y' | 'z' | 'rot'>>(
  bricks: T[],
  dir: 1 | -1,
  pivot: [number, number] = groupPivot(bricks),
): T[] {
  if (bricks.length === 0) return bricks;
  const [pcx, pcz] = pivot;
  return bricks.map((br) => {
    const part = getPart(br.part);
    const [fw, fd] = rotatedSize(part, br.rot);
    const cx = br.x + fw / 2 - pcx;
    const cz = br.z + fd / 2 - pcz;
    // three.js 绕 +Y 旋转 θ：x' = x cosθ + z sinθ, z' = -x sinθ + z cosθ
    const ncx = dir === 1 ? cz : -cz;
    const ncz = dir === 1 ? -cx : cx;
    const rot = ((((br.rot + dir) % 4) + 4) % 4) as Rot;
    const [nfw, nfd] = rotatedSize(part, rot);
    return {
      ...br,
      rot,
      x: iround(pcx + ncx - nfw / 2),
      z: iround(pcz + ncz - nfd / 2),
    };
  });
}

/**
 * 与指定积木相连的所有积木（通过上下叠放、凸点咬合连接；侧面贴靠不算相连）。
 */
export function connectedBricks(
  grid: OccupancyGrid,
  getBrick: (id: number) => Brick | undefined,
  startId: number,
): number[] {
  const seen = new Set<number>([startId]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.pop()!;
    const b = getBrick(id);
    if (!b) continue;
    const part = getPart(b.part);
    const cols = new Map<string, [number, number]>();
    for (const [x, , z] of brickVoxels(b)) cols.set(`${x},${z}`, [x, z]);
    for (const [x, z] of cols.values()) {
      for (const y of [b.y + part.h, b.y - 1]) {
        if (y < 0) continue;
        const other = grid.get(x, y, z);
        if (other !== undefined && !seen.has(other)) {
          seen.add(other);
          queue.push(other);
        }
      }
    }
  }
  return [...seen];
}

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BEVEL, GAP, PLATE_H, STUD_H, STUD_R, TOP, WALL } from '../core/constants';
import { getPart, topStudCells, type PartDef } from '../core/parts';

// 所有零件几何体以「占地中心、底面 y=0」为原点：x∈[-w/2,w/2]，z∈[-d/2,d/2]

type V3 = [number, number, number];
type V2 = [number, number];

/** 带显式法线的三角形累加器；自动校正绕序，保证正面朝向法线方向 */
class MeshBuilder {
  pos: number[] = [];
  nrm: number[] = [];

  tri(a: V3, b: V3, c: V3, na: V3, nb: V3, nc: V3) {
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2];
    const vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const area2 = cx * cx + cy * cy + cz * cz;
    if (area2 < 1e-14) return; // 退化三角形
    const nx = na[0] + nb[0] + nc[0];
    const ny = na[1] + nb[1] + nc[1];
    const nz = na[2] + nb[2] + nc[2];
    if (cx * nx + cy * ny + cz * nz < 0) {
      [b, c] = [c, b];
      [nb, nc] = [nc, nb];
    }
    this.pos.push(...a, ...b, ...c);
    this.nrm.push(...na, ...nb, ...nc);
  }

  quad(a: V3, b: V3, c: V3, d: V3, na: V3, nb: V3, nc: V3, nd: V3) {
    this.tri(a, b, c, na, nb, nc);
    this.tri(a, c, d, na, nc, nd);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    const merged = mergeVertices(g, 1e-5);
    g.dispose();
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }
}

function norm3(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// ---------------------------------------------------------------------------
// 轮廓扫掠：沿多边形边界扫一条 (内缩量, 高度) 截面，生成带圆角的外壳
// ---------------------------------------------------------------------------

/** 截面线段：p=(内缩, y)，n=(内缩方向分量, y 分量) 的法线 */
interface ProfileSeg {
  p0: V2;
  p1: V2;
  n0: V2;
  n1: V2;
}

function flatSeg(p0: V2, p1: V2): ProfileSeg {
  const dI = p1[0] - p0[0];
  const dY = p1[1] - p0[1];
  const l = Math.hypot(dI, dY) || 1;
  const n: V2 = [-dY / l, dI / l];
  return { p0, p1, n0: n, n1: n };
}

/** 顶部外缘圆角：从侧壁 (0, H-r) 到顶面 (r, H) */
function topBevel(H: number, r: number, steps: number): ProfileSeg[] {
  const segs: ProfileSeg[] = [];
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * (Math.PI / 2);
    const a1 = ((i + 1) / steps) * (Math.PI / 2);
    segs.push({
      p0: [r - r * Math.cos(a0), H - r + r * Math.sin(a0)],
      p1: [r - r * Math.cos(a1), H - r + r * Math.sin(a1)],
      n0: [-Math.cos(a0), Math.sin(a0)],
      n1: [-Math.cos(a1), Math.sin(a1)],
    });
  }
  return segs;
}

/** 底部外缘圆角：从底面 (r, 0) 到侧壁 (0, r) */
function bottomBevel(r: number, steps: number): ProfileSeg[] {
  const segs: ProfileSeg[] = [];
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * (Math.PI / 2);
    const a1 = ((i + 1) / steps) * (Math.PI / 2);
    segs.push({
      p0: [r - r * Math.sin(a0), r - r * Math.cos(a0)],
      p1: [r - r * Math.sin(a1), r - r * Math.cos(a1)],
      n0: [-Math.sin(a0), -Math.cos(a0)],
      n1: [-Math.sin(a1), -Math.cos(a1)],
    });
  }
  return segs;
}

function signedArea(poly: V2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/**
 * 正交多边形（只含水平/垂直边）向内偏移。poly 为 (x, z) 坐标。
 * 每个顶点沿两条相邻边的内法线之和移动，凸角与凹角都成立。
 */
function offsetOrtho(poly: V2[], inset: number): V2[] {
  const ccw = signedArea(poly) > 0;
  const n = poly.length;
  const inward = (i: number): V2 => {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[(i + 1) % n];
    const l = Math.hypot(x1 - x0, z1 - z0) || 1;
    const dx = (x1 - x0) / l;
    const dz = (z1 - z0) / l;
    return ccw ? [-dz, dx] : [dz, -dx];
  };
  return poly.map((v, i) => {
    const a = inward((i - 1 + n) % n);
    const b = inward(i);
    return [v[0] + inset * (a[0] + b[0]), v[1] + inset * (a[1] + b[1])];
  });
}

function outwardNormals(poly: V2[]): V2[] {
  const ccw = signedArea(poly) > 0;
  const n = poly.length;
  return poly.map((_, i) => {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[(i + 1) % n];
    const l = Math.hypot(x1 - x0, z1 - z0) || 1;
    const dx = (x1 - x0) / l;
    const dz = (z1 - z0) / l;
    return ccw ? [dz, -dx] : [-dz, dx];
  });
}

/** 在 y 平面上填充多边形（耳切法三角化） */
function cap(mb: MeshBuilder, poly: V2[], y: number, up: boolean) {
  const contour = poly.map(([x, z]) => new THREE.Vector2(x, z));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const n: V3 = [0, up ? 1 : -1, 0];
  for (const [a, b, c] of tris) {
    mb.tri([poly[a][0], y, poly[a][1]], [poly[b][0], y, poly[b][1]], [poly[c][0], y, poly[c][1]], n, n, n);
  }
}

function sweep(mb: MeshBuilder, poly: V2[], segs: ProfileSeg[]) {
  const outs = outwardNormals(poly);
  const cache = new Map<number, V2[]>();
  const ring = (inset: number) => {
    let r = cache.get(inset);
    if (!r) {
      r = offsetOrtho(poly, inset);
      cache.set(inset, r);
    }
    return r;
  };
  const n = poly.length;
  for (const s of segs) {
    const r0 = ring(s.p0[0]);
    const r1 = ring(s.p1[0]);
    for (let e = 0; e < n; e++) {
      const o = outs[e];
      const A0 = r0[e],
        B0 = r0[(e + 1) % n];
      const A1 = r1[e],
        B1 = r1[(e + 1) % n];
      // 截面法线 (nI, nY) → 世界：nI·(内向) + nY·上
      const w = (nn: V2): V3 => norm3([-nn[0] * o[0], nn[1], -nn[0] * o[1]]);
      const n0 = w(s.n0);
      const n1 = w(s.n1);
      mb.quad(
        [A0[0], s.p0[1], A0[1]],
        [B0[0], s.p0[1], B0[1]],
        [B1[0], s.p1[1], B1[1]],
        [A1[0], s.p1[1], A1[1]],
        n0,
        n0,
        n1,
        n1,
      );
    }
  }
}

interface ShellOptions {
  hollow: boolean;
  bevelTop: number;
  bevelBottom: number;
}

/** 带圆角的外壳，可选空心底部（内壁 + 天花板） */
function shell(mb: MeshBuilder, poly: V2[], H: number, o: ShellOptions) {
  const bt = Math.min(o.bevelTop, H / 3);
  const bb = Math.min(o.bevelBottom, H / 4);
  const segs: ProfileSeg[] = [];
  if (o.hollow) {
    const t = WALL;
    const ceil = H - TOP;
    segs.push(flatSeg([t, ceil], [t, 0])); // 内壁
    segs.push(flatSeg([t, 0], [bb, 0])); // 底边
  }
  if (bb > 0) segs.push(...bottomBevel(bb, 2));
  segs.push(flatSeg([0, bb], [0, H - bt])); // 外壁
  segs.push(...topBevel(H, bt, 3));
  sweep(mb, poly, segs);
  cap(mb, offsetOrtho(poly, bt), H, true);
  if (o.hollow) cap(mb, offsetOrtho(poly, WALL), H - TOP, false);
  else cap(mb, offsetOrtho(poly, bb), 0, false);
}

// ---------------------------------------------------------------------------
// 旋转体：凸点、底管、圆形零件
// ---------------------------------------------------------------------------

/** 旋转截面线段：p=(r, y)，n=(径向, y) */
interface LatheSeg {
  p0: V2;
  p1: V2;
  n0: V2;
  n1: V2;
}

function lflat(p0: V2, p1: V2, outward = true): LatheSeg {
  const dr = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const l = Math.hypot(dr, dy) || 1;
  let n: V2 = [dy / l, -dr / l];
  if (!outward) n = [-n[0], -n[1]];
  return { p0, p1, n0: n, n1: n };
}

function lathe(mb: MeshBuilder, segs: LatheSeg[], cx: number, cz: number, y0: number, radial: number) {
  for (const s of segs) {
    for (let i = 0; i < radial; i++) {
      const a0 = (i / radial) * Math.PI * 2;
      const a1 = ((i + 1) / radial) * Math.PI * 2;
      const c0 = Math.cos(a0),
        s0 = Math.sin(a0),
        c1 = Math.cos(a1),
        s1 = Math.sin(a1);
      const P = (r: number, y: number, c: number, sn: number): V3 => [cx + r * c, y0 + y, cz + r * sn];
      const N = (n: V2, c: number, sn: number): V3 => norm3([n[0] * c, n[1], n[0] * sn]);
      const a = P(s.p0[0], s.p0[1], c0, s0);
      const b = P(s.p0[0], s.p0[1], c1, s1);
      const c = P(s.p1[0], s.p1[1], c1, s1);
      const d = P(s.p1[0], s.p1[1], c0, s0);
      const na = N(s.n0, c0, s0);
      const nb = N(s.n0, c1, s1);
      const nc = N(s.n1, c1, s1);
      const nd = N(s.n1, c0, s0);
      if (s.p0[0] < 1e-9) mb.tri(a, c, d, na, nc, nd);
      else if (s.p1[0] < 1e-9) mb.tri(a, b, c, na, nb, nc);
      else mb.quad(a, b, c, d, na, nb, nc, nd);
    }
  }
}

/** 圆柱侧面 + 顶部圆角的截面 */
function roundTopProfile(R: number, y0: number, H: number, r: number, steps: number): LatheSeg[] {
  const segs: LatheSeg[] = [lflat([R, y0], [R, H - r])];
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * (Math.PI / 2);
    const a1 = ((i + 1) / steps) * (Math.PI / 2);
    segs.push({
      p0: [R - r + r * Math.cos(a0), H - r + r * Math.sin(a0)],
      p1: [R - r + r * Math.cos(a1), H - r + r * Math.sin(a1)],
      n0: [Math.cos(a0), Math.sin(a0)],
      n1: [Math.cos(a1), Math.sin(a1)],
    });
  }
  segs.push({ p0: [R - r, H], p1: [0, H], n0: [0, 1], n1: [0, 1] });
  return segs;
}

const STUD_PROFILE = roundTopProfile(STUD_R, -0.02, STUD_H, 0.03, 3);

export function addStud(mb: MeshBuilder, x: number, z: number, y: number, radial = 20) {
  lathe(mb, STUD_PROFILE, x, z, y, radial);
}

/** 2×N 积木底部的空心管 */
function addTube(mb: MeshBuilder, x: number, z: number, h: number) {
  const ro = 0.4069 - 0.004;
  const ri = 0.3;
  lathe(
    mb,
    [
      { p0: [ro, h], p1: [ro, 0], n0: [1, 0], n1: [1, 0] },
      { p0: [ro, 0], p1: [ri, 0], n0: [0, -1], n1: [0, -1] },
      { p0: [ri, 0], p1: [ri, h], n0: [-1, 0], n1: [-1, 0] },
    ],
    x,
    z,
    0,
    18,
  );
}

/** 1×N 积木底部的实心销 */
function addPin(mb: MeshBuilder, x: number, z: number, h: number) {
  const r = 0.2 - 0.004;
  lathe(
    mb,
    [
      { p0: [r, h], p1: [r, 0], n0: [1, 0], n1: [1, 0] },
      { p0: [r, 0], p1: [0, 0], n0: [0, -1], n1: [0, -1] },
    ],
    x,
    z,
    0,
    14,
  );
}

// ---------------------------------------------------------------------------
// 棱柱挤出：斜坡、拱门
// ---------------------------------------------------------------------------

/**
 * 把二维多边形 (u, v) 沿第三轴 w 从 w0 挤出到 w1。
 * toWorld 把 (u, v, w) 映射到世界坐标；相邻边夹角小于 smoothDeg 时共享平滑法线。
 */
function prism(
  mb: MeshBuilder,
  poly: V2[],
  w0: number,
  w1: number,
  toWorld: (u: number, v: number, w: number) => V3,
  smoothDeg = 0,
) {
  const n = poly.length;
  const ccw = signedArea(poly) > 0;
  const edgeN: V2[] = poly.map((_, i) => {
    const [u0, v0] = poly[i];
    const [u1, v1] = poly[(i + 1) % n];
    const l = Math.hypot(u1 - u0, v1 - v0) || 1;
    const du = (u1 - u0) / l;
    const dv = (v1 - v0) / l;
    return ccw ? [dv, -du] : [-dv, du];
  });
  const cosT = Math.cos((smoothDeg * Math.PI) / 180);
  const dirW = (nu: number, nv: number): V3 => {
    const o = toWorld(0, 0, 0);
    const p = toWorld(nu, nv, 0);
    return norm3([p[0] - o[0], p[1] - o[1], p[2] - o[2]]);
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ne = edgeN[i];
    // 顶点 i 处与上一条边平滑、顶点 j 处与下一条边平滑
    const prev = edgeN[(i - 1 + n) % n];
    const next = edgeN[j];
    const smooth = (a: V2, b: V2): V2 => {
      if (smoothDeg > 0 && a[0] * b[0] + a[1] * b[1] > cosT) {
        const s: V2 = [a[0] + b[0], a[1] + b[1]];
        const l = Math.hypot(s[0], s[1]) || 1;
        return [s[0] / l, s[1] / l];
      }
      return a;
    };
    const ni = smooth(ne, prev);
    const nj = smooth(ne, next);
    const Ni = dirW(ni[0], ni[1]);
    const Nj = dirW(nj[0], nj[1]);
    const [ui, vi] = poly[i];
    const [uj, vj] = poly[j];
    mb.quad(toWorld(ui, vi, w0), toWorld(uj, vj, w0), toWorld(uj, vj, w1), toWorld(ui, vi, w1), Ni, Nj, Nj, Ni);
  }
  // 两端封面
  const contour = poly.map(([u, v]) => new THREE.Vector2(u, v));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const o = toWorld(0, 0, 0);
  const wDir = toWorld(0, 0, 1);
  const axis = norm3([wDir[0] - o[0], wDir[1] - o[1], wDir[2] - o[2]]);
  const neg: V3 = [-axis[0], -axis[1], -axis[2]];
  for (const [a, b, c] of tris) {
    const pa = poly[a],
      pb = poly[b],
      pc = poly[c];
    mb.tri(toWorld(pa[0], pa[1], w0), toWorld(pb[0], pb[1], w0), toWorld(pc[0], pc[1], w0), neg, neg, neg);
    mb.tri(toWorld(pa[0], pa[1], w1), toWorld(pb[0], pb[1], w1), toWorld(pc[0], pc[1], w1), axis, axis, axis);
  }
}

// ---------------------------------------------------------------------------
// 零件几何体
// ---------------------------------------------------------------------------

function rectPoly(x0: number, z0: number, x1: number, z1: number): V2[] {
  return [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
}

function addTopStuds(mb: MeshBuilder, part: PartDef, H: number, radial = 20) {
  for (const [cx, cz] of topStudCells(part)) {
    addStud(mb, cx + 0.5 - part.w / 2, cz + 0.5 - part.d / 2, H, radial);
  }
}

function addUnderside(mb: MeshBuilder, part: PartDef, H: number) {
  const h = H - TOP + 0.002;
  const { w, d } = part;
  if (w >= 2 && d >= 2) {
    for (let i = 1; i < w; i++) {
      for (let j = 1; j < d; j++) {
        if (part.shape.kind === 'corner' && i === w - 1 && j === d - 1) continue;
        addTube(mb, i - w / 2, j - d / 2, h);
      }
    }
  } else if (w === 1 && d > 1) {
    for (let j = 1; j < d; j++) addPin(mb, 0, j - d / 2, h);
  } else if (d === 1 && w > 1) {
    for (let i = 1; i < w; i++) addPin(mb, i - w / 2, 0, h);
  }
}

function buildBox(mb: MeshBuilder, part: PartDef) {
  const H = part.h * PLATE_H;
  const hw = part.w / 2 - GAP;
  const hd = part.d / 2 - GAP;
  let poly: V2[];
  if (part.shape.kind === 'corner') {
    // L 形：缺少 (+x, +z) 那一格，内角同样留出间隙
    const mx = part.w / 2 - 1 - GAP;
    const mz = part.d / 2 - 1 - GAP;
    poly = [
      [-hw, -hd],
      [hw, -hd],
      [hw, mz],
      [mx, mz],
      [mx, hd],
      [-hw, hd],
    ];
  } else {
    poly = rectPoly(-hw, -hd, hw, hd);
  }
  shell(mb, poly, H, { hollow: true, bevelTop: BEVEL, bevelBottom: BEVEL * 0.5 });
  addUnderside(mb, part, H);
  addTopStuds(mb, part, H);
}

function buildSlope(mb: MeshBuilder, part: PartDef, run: number, inverted: boolean) {
  const H = part.h * PLATE_H;
  const hw = part.w / 2 - GAP;
  const z0 = -part.d / 2 + GAP;
  const z1 = part.d / 2 - GAP;
  const zf = -part.d / 2 + (part.d - run);
  const lip = 0.2; // 官方斜坡前沿 4 LDU
  // 截面在 (z, y) 平面
  const poly: V2[] = inverted
    ? [
        [z0, 0],
        [zf, 0],
        [z1, H - lip],
        [z1, H],
        [z0, H],
      ]
    : [
        [z0, 0],
        [z1, 0],
        [z1, lip],
        [zf, H],
        [z0, H],
      ];
  prism(mb, poly, -hw, hw, (u, v, w) => [w, v, u]);
  addTopStuds(mb, part, H);
}

function buildRound(mb: MeshBuilder, part: PartDef, profile: 'cylinder' | 'cone', studs: boolean) {
  const H = part.h * PLATE_H;
  // 2×2 圆件略放大，盖住下方积木对角凸点的外沿（凸点外沿距中心 1.007）
  const R = part.w > 1 ? part.w / 2 + 0.008 : part.w / 2 - GAP;
  const b = 0.02;
  if (profile === 'cone') {
    // 官方圆锥：底部 5 LDU 竖直，之后收窄到顶部半径约 6.5 LDU
    const top = 0.325;
    const segs: LatheSeg[] = [
      { p0: [0, 0], p1: [R - b, 0], n0: [0, -1], n1: [0, -1] },
      lflat([R - b, 0], [R, b]),
      lflat([R, b], [R, 0.25]),
      lflat([R, 0.25], [top, H - 0.02]),
      { p0: [top, H - 0.02], p1: [top - 0.02, H], n0: [0.7, 0.7], n1: [0, 1] },
      { p0: [top - 0.02, H], p1: [0, H], n0: [0, 1], n1: [0, 1] },
    ];
    lathe(mb, segs, 0, 0, 0, 28);
  } else {
    const radial = part.w > 1 ? 40 : 28;
    const segs: LatheSeg[] = [{ p0: [0, 0], p1: [R - b, 0], n0: [0, -1], n1: [0, -1] }, lflat([R - b, 0], [R, b])];
    if (part.w === 1 && part.h === 3) {
      // 1×1 圆砖：顶部略收窄的颈部
      const neck = 0.4;
      segs.push(lflat([R, b], [R, H - 0.3]));
      segs.push(lflat([R, H - 0.3], [neck, H - 0.2]));
      segs.push(...roundTopProfile(neck, H - 0.2, H, BEVEL, 3));
    } else {
      segs.push(...roundTopProfile(R, b, H, BEVEL, 3));
    }
    lathe(mb, segs, 0, 0, 0, radial);
  }
  if (studs) addTopStuds(mb, part, H, 20);
}

function buildArch(mb: MeshBuilder, part: PartDef, span: number, rise: number) {
  const H = part.h * PLATE_H;
  const hw = part.w / 2 - GAP;
  const hd = part.d / 2 - GAP;
  const rx = span / 2 - GAP;
  const ry = rise * PLATE_H;
  const poly: V2[] = [
    [-hw, 0],
    [-rx, 0],
  ];
  const steps = 18;
  for (let i = 1; i < steps; i++) {
    const a = Math.PI - (i / steps) * Math.PI;
    poly.push([rx * Math.cos(a), ry * Math.sin(a)]);
  }
  poly.push([rx, 0], [hw, 0], [hw, H], [-hw, H]);
  prism(mb, poly, -hd, hd, (u, v, w) => [u, v, w], 30);
  addTopStuds(mb, part, H);
}

const cache = new Map<string, THREE.BufferGeometry>();

/** 获取零件几何体（带缓存） */
export function getPartGeometry(partId: string): THREE.BufferGeometry {
  let g = cache.get(partId);
  if (g) return g;
  const part = getPart(partId);
  const mb = new MeshBuilder();
  const s = part.shape;
  switch (s.kind) {
    case 'box':
    case 'corner':
      buildBox(mb, part);
      break;
    case 'slope':
      buildSlope(mb, part, s.run, s.inverted);
      break;
    case 'round':
      buildRound(mb, part, s.profile, s.studs);
      break;
    case 'arch':
      buildArch(mb, part, s.span, s.rise);
      break;
  }
  g = mb.build();
  g.name = partId;
  cache.set(partId, g);
  return g;
}

/** 底板上的单个凸点（低面数） */
export function createStudGeometry(radial = 14): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  addStud(mb, 0, 0, 0, radial);
  return mb.build();
}

/** 圆角长方体（底板主体） */
export function createSlabGeometry(w: number, h: number, d: number, bevel: number): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  shell(mb, rectPoly(-w / 2, -d / 2, w / 2, d / 2), h, { hollow: false, bevelTop: bevel, bevelBottom: bevel });
  return mb.build();
}

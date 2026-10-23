import { hasColor } from './colors';
import { BASEPLATE_SIZES } from './constants';
import { findPart, partByCode, getPart } from './parts';
import type { Brick, BrickData, Rot } from './types';

export interface ProjectMeta {
  name: string;
  baseplateSize: number;
  baseplateColor: number;
}

export interface ProjectData extends ProjectMeta {
  bricks: BrickData[];
}

/** 文件格式：紧凑的 JSON，每块积木是 [零件, 颜色, x, y, z, 朝向] */
export interface ProjectFile {
  format: 'brick-lab';
  version: 1;
  name: string;
  baseplate: { size: number; color: number };
  bricks: [string, number, number, number, number, number][];
  savedAt?: string;
}

export const FILE_EXTENSION = '.brick.json';

export function toProjectFile(meta: ProjectMeta, bricks: (Brick | BrickData)[]): ProjectFile {
  return {
    format: 'brick-lab',
    version: 1,
    name: meta.name,
    baseplate: { size: meta.baseplateSize, color: meta.baseplateColor },
    bricks: bricks.map((b) => [b.part, b.color, b.x, b.y, b.z, b.rot]),
    savedAt: new Date().toISOString(),
  };
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function normalizeBaseplateSize(n: unknown): number {
  if (isInt(n) && (BASEPLATE_SIZES as readonly number[]).includes(n)) return n;
  return 32;
}

/** 解析并校验项目文件；无法识别的积木会被跳过 */
export function parseProjectFile(input: unknown): ProjectData {
  const f = input as Partial<ProjectFile>;
  if (!f || typeof f !== 'object' || f.format !== 'brick-lab' || !Array.isArray(f.bricks)) {
    throw new Error('不是有效的积木工坊作品文件');
  }
  const bricks: BrickData[] = [];
  for (const row of f.bricks) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [part, color, x, y, z, rot] = row;
    if (typeof part !== 'string' || !findPart(part)) continue;
    if (!isInt(color) || !isInt(x) || !isInt(y) || !isInt(z) || !isInt(rot)) continue;
    if (y < 0 || rot < 0 || rot > 3) continue;
    bricks.push({ part, color: hasColor(color) ? color : 15, x, y, z, rot: rot as Rot });
  }
  return {
    name: typeof f.name === 'string' && f.name.trim() ? f.name.slice(0, 80) : '未命名作品',
    baseplateSize: normalizeBaseplateSize(f.baseplate?.size),
    baseplateColor: isInt(f.baseplate?.color) && hasColor(f.baseplate!.color) ? f.baseplate!.color : 2,
    bricks,
  };
}

// ---------------------------------------------------------------------------
// 分享链接：二进制打包 + deflate + base64url
// ---------------------------------------------------------------------------

const SHARE_VERSION = 1;
const BYTES_PER_BRICK = 10;

export function packProject(data: ProjectData): Uint8Array {
  const nameBytes = new TextEncoder().encode(data.name).slice(0, 120);
  const header = 1 + 1 + 2 + 1 + nameBytes.length + 4;
  const buf = new ArrayBuffer(header + data.bricks.length * BYTES_PER_BRICK);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let o = 0;
  dv.setUint8(o++, SHARE_VERSION);
  dv.setUint8(o++, data.baseplateSize);
  dv.setUint16(o, data.baseplateColor, true);
  o += 2;
  dv.setUint8(o++, nameBytes.length);
  u8.set(nameBytes, o);
  o += nameBytes.length;
  dv.setUint32(o, data.bricks.length, true);
  o += 4;
  for (const b of data.bricks) {
    dv.setUint8(o, getPart(b.part).code);
    dv.setUint16(o + 1, b.color, true);
    dv.setInt16(o + 3, b.x, true);
    dv.setUint16(o + 5, b.y, true);
    dv.setInt16(o + 7, b.z, true);
    dv.setUint8(o + 9, b.rot);
    o += BYTES_PER_BRICK;
  }
  return u8;
}

export function unpackProject(u8: Uint8Array): ProjectData {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let o = 0;
  const version = dv.getUint8(o++);
  if (version !== SHARE_VERSION) throw new Error('不支持的分享数据版本');
  const baseplateSize = normalizeBaseplateSize(dv.getUint8(o++));
  const baseplateColor = dv.getUint16(o, true);
  o += 2;
  const nameLen = dv.getUint8(o++);
  const name = new TextDecoder().decode(u8.subarray(o, o + nameLen));
  o += nameLen;
  const count = dv.getUint32(o, true);
  o += 4;
  if (o + count * BYTES_PER_BRICK > u8.byteLength) throw new Error('分享数据已损坏');
  const bricks: BrickData[] = [];
  for (let i = 0; i < count; i++) {
    const part = partByCode(dv.getUint8(o));
    const color = dv.getUint16(o + 1, true);
    const x = dv.getInt16(o + 3, true);
    const y = dv.getUint16(o + 5, true);
    const z = dv.getInt16(o + 7, true);
    const rot = dv.getUint8(o + 9);
    o += BYTES_PER_BRICK;
    if (!part || rot > 3) continue;
    bricks.push({ part: part.id, color: hasColor(color) ? color : 15, x, y, z, rot: rot as Rot });
  }
  return {
    name: name || '分享的作品',
    baseplateSize,
    baseplateColor: hasColor(baseplateColor) ? baseplateColor : 2,
    bricks,
  };
}

async function pipeThrough(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const res = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export function toBase64Url(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export async function encodeShare(data: ProjectData): Promise<string> {
  const packed = packProject(data);
  const deflated = await pipeThrough(packed, new CompressionStream('deflate-raw'));
  return toBase64Url(deflated);
}

export async function decodeShare(str: string): Promise<ProjectData> {
  const raw = fromBase64Url(str);
  const inflated = await pipeThrough(raw, new DecompressionStream('deflate-raw'));
  return unpackProject(inflated);
}

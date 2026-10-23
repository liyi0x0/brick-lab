import * as THREE from 'three';
import { bomToBrickLinkXML, bomToCSV, buildBom } from '../core/bom';
import { hasColor } from '../core/colors';
import { fromLDraw, toLDraw } from '../core/ldraw';
import { groupBounds, groupFits, groupPivot, rotateGroup } from '../core/placement';
import { encodeShare, FILE_EXTENSION, parseProjectFile, toProjectFile, type ProjectData } from '../core/serialize';
import type { Brick, Rot, Tool } from '../core/types';
import type { ViewPreset } from '../engine/Engine';
import { sound } from '../engine/sound';
import { tr, type TKey } from '../i18n';
import { getEngine } from './engineRef';
import { model, newProjectId, useStore } from './store';

const st = () => useStore.getState();
const t = (key: TKey, params?: Record<string, string | number>) => tr(st().settings.lang, key, params);
const toast = (key: TKey, params?: Record<string, string | number>, kind?: 'info' | 'success' | 'error') =>
  st().toast(t(key, params), kind);

// ---------------------------------------------------------------------------
// 编辑
// ---------------------------------------------------------------------------

export function undo() {
  if (model.undo()) sound.play('select');
}

export function redo() {
  if (model.redo()) sound.play('select');
}

export function setTool(tool: Tool) {
  st().setTool(tool);
}

let pivotCache: { key: string; version: number; pivot: [number, number] } | null = null;

/** R：在搭建模式旋转待放置的积木；粘贴时旋转副本；选择模式下旋转所选积木 */
export function rotate(dir: 1 | -1 = 1) {
  const s = st();
  if (s.pasting && s.clipboard) {
    useStore.setState({ clipboard: rotateGroup(s.clipboard, dir) });
    sound.play('rotate');
    return;
  }
  if (s.tool === 'select' && s.selection.length) {
    const bricks = s.selection.map((id) => model.get(id)).filter((b): b is Brick => !!b);
    const key = [...s.selection].sort((a, b) => a - b).join(',');
    // 连续旋转同一组积木时沿用同一个旋转中心，保证转四次回到原位
    const pivot =
      pivotCache && pivotCache.key === key && pivotCache.version === model.version
        ? pivotCache.pivot
        : groupPivot(bricks);
    const rotated = rotateGroup(bricks, dir, pivot);
    if (model.updateBricks(rotated, 'rotate')) {
      pivotCache = { key, version: model.version, pivot };
      sound.play('rotate');
    } else {
      sound.play('error');
      toast('toast.noSpace');
    }
    return;
  }
  s.setRot((((s.rot + dir) % 4) + 4) % 4 as Rot);
  sound.play('rotate');
}

export function deleteSelection() {
  const ids = st().selection;
  if (!ids.length) return;
  if (model.removeBricks(ids, 'erase')) {
    sound.play('remove');
    st().setSelection([]);
    if (ids.length > 1) toast('toast.deleted', { n: ids.length });
  }
}

export function copySelection(cut = false) {
  const ids = st().selection;
  if (!ids.length) {
    toast('toast.nothingSelected');
    return false;
  }
  const bricks = ids
    .map((id) => model.get(id))
    .filter((b): b is Brick => !!b)
    .sort((a, b) => a.id - b.id);
  const b = groupBounds(bricks);
  const clipboard = bricks.map((br) => ({
    part: br.part,
    color: br.color,
    rot: br.rot,
    x: br.x - b.x0,
    y: br.y - b.y0,
    z: br.z - b.z0,
  }));
  useStore.setState({ clipboard });
  if (cut) deleteSelection();
  else toast('toast.copied', { n: bricks.length });
  return true;
}

export function paste() {
  const s = st();
  if (!s.clipboard?.length) return;
  useStore.setState({ pasting: true });
  toast('toast.pasteMode');
}

export function duplicate() {
  if (copySelection()) paste();
}

export function selectAll() {
  st().setTool('select');
  st().setSelection([...model.bricks.keys()]);
}

/** 选择与当前选中积木同零件、同颜色的全部积木 */
export function selectSimilar() {
  const s = st();
  const first = s.selection.map((id) => model.get(id)).find(Boolean);
  if (!first) return;
  const ids = [...model.bricks.values()].filter((b) => b.part === first.part && b.color === first.color).map((b) => b.id);
  s.setSelection(ids);
}

export function paintSelection(colorId: number) {
  const bricks = st()
    .selection.map((id) => model.get(id))
    .filter((b): b is Brick => !!b && b.color !== colorId);
  if (!bricks.length) return;
  if (model.updateBricks(bricks.map((b) => ({ ...b, color: colorId })), 'paint')) sound.play('paint');
}

/** 方向键：按当前相机朝向移动所选积木 */
export function nudge(key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight', vertical: boolean) {
  const s = st();
  const engine = getEngine();
  if (!engine || !s.selection.length) return;
  let dx = 0,
    dy = 0,
    dz = 0;
  if (vertical) {
    if (key === 'ArrowUp') dy = 1;
    else if (key === 'ArrowDown') dy = -1;
    else return;
  } else {
    const f = engine.camera.getWorldDirection(new THREE.Vector3());
    // 相机前方投影到地面并对齐到最近的坐标轴
    let fx = 0,
      fz = 0;
    if (Math.abs(f.x) > Math.abs(f.z)) fx = Math.sign(f.x);
    else fz = Math.sign(f.z);
    const rx = -fz,
      rz = fx;
    if (key === 'ArrowUp') [dx, dz] = [fx, fz];
    else if (key === 'ArrowDown') [dx, dz] = [-fx, -fz];
    else if (key === 'ArrowRight') [dx, dz] = [rx, rz];
    else [dx, dz] = [-rx, -rz];
  }
  const bricks = s.selection.map((id) => model.get(id)).filter((b): b is Brick => !!b);
  const ignore = new Set(s.selection);
  if (!groupFits(model.grid, bricks, dx, dy, dz, ignore)) {
    sound.play('error');
    return;
  }
  if (model.updateBricks(bricks.map((b) => ({ ...b, x: b.x + dx, y: b.y + dy, z: b.z + dz })), 'move')) {
    sound.play('select');
  }
}

export function focus() {
  const s = st();
  getEngine()?.frame(s.selection.length ? s.selection : undefined);
}

export function setView(v: ViewPreset) {
  getEngine()?.setView(v);
}

/** Esc：逐级取消（拖动 → 粘贴 → 选择） */
export function escape() {
  const s = st();
  if (getEngine()?.interaction.cancel()) return;
  if (s.pasting) {
    useStore.setState({ pasting: false });
    return;
  }
  if (s.selection.length) s.setSelection([]);
}

export function cyclePart(dir: 1 | -1, list: string[]) {
  const s = st();
  const i = list.indexOf(s.partId);
  const next = list[(i + dir + list.length) % list.length];
  if (next) s.setPart(next);
}

// ---------------------------------------------------------------------------
// 作品
// ---------------------------------------------------------------------------

export function currentProjectData(): ProjectData & { bricks: Brick[] } {
  const p = st().project;
  return {
    name: p.name,
    baseplateSize: p.baseplateSize,
    baseplateColor: p.baseplateColor,
    bricks: model.list(),
  };
}

/** 载入一份作品数据，成为当前作品 */
export function openProject(data: ProjectData, meta: { id?: string; createdAt?: number } = {}) {
  useStore.setState((s) => ({
    project: {
      id: meta.id ?? newProjectId(),
      name: data.name,
      baseplateSize: data.baseplateSize,
      baseplateColor: data.baseplateColor,
      createdAt: meta.createdAt ?? Date.now(),
    },
    selection: [],
    pasting: false,
    ui: { ...s.ui, playback: false },
  }));
  const res = model.load(data.bricks, 'load');
  getEngine()?.setPlayback(null);
  getEngine()?.setView('home', false);
  if (res.skipped) toast('toast.skipped', { n: res.skipped }, 'error');
  return res;
}

export function newProject() {
  openProject({ name: t('project.untitled'), baseplateSize: st().project.baseplateSize, baseplateColor: st().project.baseplateColor, bricks: [] });
  st().setTool('build');
}

export function clearAll() {
  if (!model.count) return;
  if (model.clearAll()) {
    st().setSelection([]);
    toast('toast.cleared');
  }
}

// ---------------------------------------------------------------------------
// 导入 / 导出
// ---------------------------------------------------------------------------

function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'brick-lab';
}

export function download(filename: string, data: Blob | string, mime = 'application/octet-stream') {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportJSON() {
  const d = currentProjectData();
  const file = `${safeName(d.name)}${FILE_EXTENSION}`;
  download(file, JSON.stringify(toProjectFile(d, d.bricks)), 'application/json');
  toast('toast.exported', { file }, 'success');
}

export function exportLDraw() {
  const d = currentProjectData();
  const file = `${safeName(d.name)}.ldr`;
  download(file, toLDraw(d.name, d.bricks), 'text/plain');
  toast('toast.exported', { file }, 'success');
}

export function exportCSV() {
  const d = currentProjectData();
  const file = `${safeName(d.name)}-parts.csv`;
  download(file, bomToCSV(buildBom(d.bricks), st().settings.lang), 'text/csv;charset=utf-8');
  toast('toast.exported', { file }, 'success');
}

export function exportBrickLink() {
  const d = currentProjectData();
  const file = `${safeName(d.name)}-bricklink.xml`;
  download(file, bomToBrickLinkXML(buildBom(d.bricks)), 'application/xml');
  toast('toast.exported', { file }, 'success');
}

export async function exportPNG(transparent = false) {
  const engine = getEngine();
  if (!engine) return;
  const el = engine.renderer.domElement;
  const scale = Math.min(2, 4096 / Math.max(el.clientWidth, el.clientHeight));
  const url = engine.capture(Math.round(el.clientWidth * scale), Math.round(el.clientHeight * scale), { transparent });
  const blob = await (await fetch(url)).blob();
  const file = `${safeName(st().project.name)}${transparent ? '-transparent' : ''}.png`;
  download(file, blob);
  toast('toast.screenshot', undefined, 'success');
}

export async function makeShareLink(): Promise<string> {
  const code = await encodeShare(currentProjectData());
  return `${location.origin}${location.pathname}#m=${code}`;
}

export async function copyShareLink() {
  try {
    const link = await makeShareLink();
    await navigator.clipboard.writeText(link);
    toast('toast.linkCopied', undefined, 'success');
    return link;
  } catch {
    toast('toast.linkFailed', undefined, 'error');
    return null;
  }
}

/** 打开 .brick.json / .json / .ldr / .mpd 文件 */
export async function importFile(file: File) {
  try {
    const text = await file.text();
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.ldr') || lower.endsWith('.mpd') || lower.endsWith('.dat')) {
      const res = fromLDraw(text, hasColor);
      if (!res.bricks.length) throw new Error(st().settings.lang === 'zh' ? '文件中没有可识别的积木' : 'no supported parts found');
      const span = Math.max(...res.bricks.map((b) => Math.max(Math.abs(b.x), Math.abs(b.z)))) * 2 + 4;
      const size = [16, 24, 32, 48, 64].find((s) => s >= span) ?? 64;
      const name = res.name || file.name.replace(/\.(ldr|mpd|dat)$/i, '');
      const loaded = openProject({ name, baseplateSize: size, baseplateColor: st().project.baseplateColor, bricks: res.bricks });
      toast('toast.imported', { name });
      if (res.skipped && !loaded.skipped) toast('toast.skipped', { n: res.skipped }, 'error');
      return;
    }
    const data = parseProjectFile(JSON.parse(text));
    openProject(data);
    toast('toast.imported', { name: data.name });
  } catch (e) {
    toast('toast.importFailed', { err: e instanceof Error ? e.message : String(e) }, 'error');
  }
}

export function pickFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.ldr,.mpd,application/json';
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) void importFile(f);
  };
  input.click();
}

import { createStore, del, get, set, type UseStore } from 'idb-keyval';
import { decodeShare, parseProjectFile, toProjectFile, type ProjectData, type ProjectFile } from '../core/serialize';
import { tr } from '../i18n';
import { currentProjectData, onAfterProjectOpen, onBeforeProjectSwitch, openProject } from './actions';
import { getEngine } from './engineRef';
import { model, newProjectId, useStore } from './store';

/** 「我的作品」中的一条记录 */
export interface LibraryEntry {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  count: number;
  thumb?: string;
}

const INDEX_KEY = 'index';
const CURRENT_KEY = 'brick-lab:current';

let idb: UseStore | null = null;
try {
  idb = typeof indexedDB !== 'undefined' ? createStore('brick-lab', 'kv') : null;
} catch {
  idb = null;
}

// IndexedDB 不可用时退回内存（例如隐私模式）
const memory = new Map<string, unknown>();

async function kvGet<T>(key: string): Promise<T | undefined> {
  if (idb) {
    try {
      return await get<T>(key, idb);
    } catch {
      /* 落到内存 */
    }
  }
  return memory.get(key) as T | undefined;
}

async function kvSet(key: string, value: unknown) {
  memory.set(key, value);
  if (idb) {
    try {
      await set(key, value, idb);
    } catch {
      /* ignore */
    }
  }
}

async function kvDel(key: string) {
  memory.delete(key);
  if (idb) {
    try {
      await del(key, idb);
    } catch {
      /* ignore */
    }
  }
}

function setCurrentId(id: string) {
  try {
    localStorage.setItem(CURRENT_KEY, id);
  } catch {
    /* ignore */
  }
}

function getCurrentId(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

export async function listProjects(): Promise<LibraryEntry[]> {
  const list = (await kvGet<LibraryEntry[]>(INDEX_KEY)) ?? [];
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

async function upsertEntry(entry: LibraryEntry) {
  const list = (await kvGet<LibraryEntry[]>(INDEX_KEY)) ?? [];
  const i = list.findIndex((e) => e.id === entry.id);
  if (i >= 0) list[i] = { ...list[i], ...entry, thumb: entry.thumb ?? list[i].thumb };
  else list.push(entry);
  await kvSet(INDEX_KEY, list);
  notifyLibrary();
}

const libraryListeners = new Set<() => void>();
export function onLibraryChange(fn: () => void) {
  libraryListeners.add(fn);
  return () => libraryListeners.delete(fn);
}
function notifyLibrary() {
  libraryListeners.forEach((fn) => fn());
}

let lastThumb = 0;
let lastThumbProject = '';

function makeThumb(): string | undefined {
  const engine = getEngine();
  if (!engine || model.count === 0) return undefined;
  try {
    return engine.thumbnail(360, 240);
  } catch {
    return undefined;
  }
}

/** 保存当前作品；thumb=true 时强制刷新缩略图 */
export async function saveCurrent(opts: { thumb?: boolean } = {}) {
  const p = useStore.getState().project;
  const data = currentProjectData();
  const now = Date.now();
  let thumb: string | undefined;
  if (opts.thumb || lastThumbProject !== p.id || now - lastThumb > 12000) {
    thumb = makeThumb();
    lastThumb = now;
    lastThumbProject = p.id;
  }
  await writeSnapshot({ ...p }, data, thumb, true);
}

/**
 * 把一份作品快照写入库中（与当前状态无关，可在切换作品前同步捕获）。
 * makeCurrent：写入后把它记为下次启动时恢复的作品——只有真正存进库里的作品才能成为启动作品。
 */
async function writeSnapshot(
  p: { id: string; name: string; createdAt: number },
  data: ReturnType<typeof currentProjectData>,
  thumb: string | undefined,
  makeCurrent: boolean,
) {
  const existing = (await kvGet<LibraryEntry[]>(INDEX_KEY))?.find((e) => e.id === p.id);
  if (!existing && data.bricks.length === 0) return;
  if (!thumb && !existing?.thumb && data.bricks.length) thumb = makeThumb();
  const file: ProjectFile = toProjectFile(data, data.bricks);
  await kvSet(`p:${p.id}`, file);
  await upsertEntry({ id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: Date.now(), count: data.bricks.length, thumb });
  if (makeCurrent) setCurrentId(p.id);
}

export async function loadProject(id: string): Promise<{ data: ProjectData; entry: LibraryEntry } | null> {
  const [file, list] = await Promise.all([kvGet<ProjectFile>(`p:${id}`), kvGet<LibraryEntry[]>(INDEX_KEY)]);
  const entry = list?.find((e) => e.id === id);
  if (!file || !entry) return null;
  try {
    return { data: parseProjectFile(file), entry };
  } catch {
    return null;
  }
}

export async function deleteProject(id: string) {
  const list = ((await kvGet<LibraryEntry[]>(INDEX_KEY)) ?? []).filter((e) => e.id !== id);
  await kvSet(INDEX_KEY, list);
  await kvDel(`p:${id}`);
  notifyLibrary();
}

export async function renameProject(id: string, name: string) {
  const list = (await kvGet<LibraryEntry[]>(INDEX_KEY)) ?? [];
  const e = list.find((x) => x.id === id);
  if (!e) return;
  e.name = name;
  await kvSet(INDEX_KEY, list);
  const file = await kvGet<ProjectFile>(`p:${id}`);
  if (file) await kvSet(`p:${id}`, { ...file, name });
  notifyLibrary();
}

export async function duplicateProject(id: string) {
  const src = await loadProject(id);
  if (!src) return;
  const nid = newProjectId();
  const now = Date.now();
  const lang = useStore.getState().settings.lang;
  const name = `${src.entry.name} ${lang === 'zh' ? '副本' : 'copy'}`;
  await kvSet(`p:${nid}`, toProjectFile({ ...src.data, name }, src.data.bricks));
  await upsertEntry({ ...src.entry, id: nid, name, createdAt: now, updatedAt: now });
}

/** 切换到库中的另一个作品（先保存当前作品） */
export async function switchToProject(id: string) {
  await flushSave();
  const p = await loadProject(id);
  if (!p) return;
  openProject(p.data, { id, createdAt: p.entry.createdAt });
  setCurrentId(id);
}

let timer = 0;
let pending = false;

export async function flushSave() {
  if (!pending) return;
  window.clearTimeout(timer);
  pending = false;
  await saveCurrent();
}

function schedule() {
  pending = true;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    pending = false;
    void saveCurrent();
  }, 900);
}

/** 自动保存：模型或作品信息变化后延迟写入 IndexedDB */
export function startAutosave(): () => void {
  // 切换作品前：若有未保存的修改，立即捕获旧作品的快照再写入
  const offSwitch = onBeforeProjectSwitch(() => {
    if (!pending) return;
    pending = false;
    window.clearTimeout(timer);
    const p = { ...useStore.getState().project };
    void writeSnapshot(p, currentProjectData(), makeThumb(), false);
  });
  // 分享链接、导入的文件：载入后尽快存入库中，刷新页面也不会丢
  const offOpen = onAfterProjectOpen((persist) => {
    if (persist && model.count > 0) schedule();
  });
  const unsubModel = model.subscribe((e) => {
    if (e.type === 'reset') return;
    schedule();
  });
  // 在已打开的页面里粘贴分享链接（只改变了 #m=…）也要能打开
  const onHash = () => void openShareFromHash();
  window.addEventListener('hashchange', onHash);
  const unsubStore = useStore.subscribe((s, p) => {
    if (s.project !== p.project && s.project.id === p.project.id) schedule();
  });
  const onHide = () => {
    if (document.visibilityState === 'hidden') void flushSave();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
  return () => {
    offSwitch();
    offOpen();
    window.removeEventListener('hashchange', onHash);
    unsubModel();
    unsubStore();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onHide);
  };
}

/** 若地址中带有分享数据（#m=…），打开它并从地址栏移除。返回是否成功打开 */
export async function openShareFromHash(): Promise<boolean> {
  const m = /[#&]m=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (!m) return false;
  const st = useStore.getState();
  try {
    const data = await decodeShare(m[1]);
    st.openDialog(null);
    openProject(data, {}, { persist: true });
    st.toast(tr(st.settings.lang, 'toast.shared', { name: data.name }), 'success');
    return true;
  } catch (e) {
    st.toast(tr(st.settings.lang, 'toast.importFailed', { err: e instanceof Error ? e.message : String(e) }), 'error');
    return false;
  } finally {
    history.replaceState(null, '', location.pathname + location.search);
  }
}

let restoring: Promise<'shared' | 'restored' | 'empty'> | null = null;

/**
 * 启动时恢复：优先分享链接，其次上次打开的作品。
 * 只执行一次（React 严格模式会把副作用执行两遍，不能因此打开两份分享作品）。
 */
export function restoreSession(): Promise<'shared' | 'restored' | 'empty'> {
  return (restoring ??= doRestore());
}

async function doRestore(): Promise<'shared' | 'restored' | 'empty'> {
  if (await openShareFromHash()) return 'shared';
  const id = getCurrentId();
  if (id) {
    const p = await loadProject(id);
    if (p) {
      openProject(p.data, { id, createdAt: p.entry.createdAt });
      return 'restored';
    }
  }
  return 'empty';
}

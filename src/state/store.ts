import { create } from 'zustand';
import { DEFAULT_COLOR } from '../core/colors';
import { Model } from '../core/model';
import { DEFAULT_PART } from '../core/parts';
import type { BrickData, Rot, Tool } from '../core/types';

/** 全局唯一的作品模型 */
export const model = new Model();

export type Quality = 'high' | 'medium' | 'low';
export type Theme = 'light' | 'dark' | 'system';
export type Lang = 'zh' | 'en';

export interface Settings {
  sound: boolean;
  quality: Quality;
  theme: Theme;
  lang: Lang;
  hints: boolean;
}

export interface Project {
  id: string;
  name: string;
  baseplateSize: number;
  baseplateColor: number;
  createdAt: number;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

export interface HoverInfo {
  brickId: number | null;
  /** 网格坐标（放置预览位置或命中积木位置） */
  x: number;
  y: number;
  z: number;
  valid: boolean;
}

export type Dialog = null | 'help' | 'library' | 'welcome' | 'settings' | 'export';

interface UIState {
  dialog: Dialog;
  leftOpen: boolean;
  bomOpen: boolean;
  mobileSheet: null | 'parts' | 'colors';
  playback: boolean;
}

export interface AppState {
  tool: Tool;
  partId: string;
  colorId: number;
  rot: Rot;
  selection: number[];
  clipboard: BrickData[] | null;
  pasting: boolean;
  modelVersion: number;
  canUndo: boolean;
  canRedo: boolean;
  project: Project;
  settings: Settings;
  ui: UIState;
  toasts: Toast[];
  hover: HoverInfo | null;
  recentColors: number[];
  /** 零件缩略图图集（按当前颜色渲染） */
  thumbs: { url: string; cols: number; cell: number; index: Record<string, number> } | null;

  setTool: (t: Tool) => void;
  setPart: (id: string) => void;
  setColor: (id: number) => void;
  setRot: (r: Rot) => void;
  setSelection: (ids: number[]) => void;
  setUI: (p: Partial<UIState>) => void;
  openDialog: (d: Dialog) => void;
  updateSettings: (p: Partial<Settings>) => void;
  updateProject: (p: Partial<Project>) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
}

const SETTINGS_KEY = 'brick-lab:settings';

function isMobile() {
  return typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches;
}

function loadSettings(): Settings {
  const defaults: Settings = {
    sound: true,
    quality: isMobile() ? 'medium' : 'high',
    theme: 'system',
    lang: typeof navigator !== 'undefined' && !navigator.language.startsWith('zh') ? 'en' : 'zh',
    hints: true,
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    /* 存储不可用时使用默认值 */
  }
  return defaults;
}

export function newProjectId() {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

let toastSeq = 1;

export const useStore = create<AppState>((set, get) => ({
  tool: 'build',
  partId: DEFAULT_PART,
  colorId: DEFAULT_COLOR,
  rot: 0,
  selection: [],
  clipboard: null,
  pasting: false,
  modelVersion: 0,
  canUndo: false,
  canRedo: false,
  project: {
    id: newProjectId(),
    name: '未命名作品',
    baseplateSize: 32,
    baseplateColor: 2,
    createdAt: Date.now(),
  },
  settings: loadSettings(),
  ui: { dialog: null, leftOpen: !isMobile(), bomOpen: false, mobileSheet: null, playback: false },
  toasts: [],
  hover: null,
  recentColors: [],
  thumbs: null,

  setTool: (tool) => set({ tool, pasting: false }),
  setPart: (partId) => set({ partId, tool: 'build', pasting: false }),
  setColor: (colorId) =>
    set((s) => ({
      colorId,
      recentColors: [colorId, ...s.recentColors.filter((c) => c !== colorId)].slice(0, 8),
    })),
  setRot: (rot) => set({ rot }),
  setSelection: (selection) => set({ selection }),
  setUI: (p) => set((s) => ({ ui: { ...s.ui, ...p } })),
  openDialog: (dialog) => set((s) => ({ ui: { ...s.ui, dialog } })),
  updateSettings: (p) => {
    const settings = { ...get().settings, ...p };
    set({ settings });
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  },
  updateProject: (p) => set((s) => ({ project: { ...s.project, ...p } })),
  toast: (text, kind = 'info') => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 4200 : 2600);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// 模型变化 → 同步撤销/重做状态并清理失效的选择
model.subscribe(() => {
  const s = useStore.getState();
  const selection = s.selection.filter((id) => model.bricks.has(id));
  useStore.setState({
    modelVersion: model.version,
    canUndo: model.canUndo,
    canRedo: model.canRedo,
    ...(selection.length !== s.selection.length ? { selection } : {}),
  });
});

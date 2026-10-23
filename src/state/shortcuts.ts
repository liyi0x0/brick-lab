import { COLORS } from '../core/colors';
import { getPart, PARTS } from '../core/parts';
import { tr } from '../i18n';
import {
  copySelection,
  cyclePart,
  deleteSelection,
  duplicate,
  escape,
  focus,
  nudge,
  paste,
  pickFile,
  redo,
  rotate,
  selectAll,
  setTool,
  setView,
  undo,
} from './actions';
import { getEngine } from './engineRef';
import { saveCurrent } from './persistence';
import { useStore } from './store';

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/** 全局键盘快捷键 */
export function installShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (isTyping(e) || e.defaultPrevented) return;
    const s = useStore.getState();
    if (s.ui.dialog) return;
    if (s.ui.playback) return; // 回放模式由播放条处理按键
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();

    if (mod) {
      switch (k) {
        case 'z':
          if (e.shiftKey) redo();
          else undo();
          break;
        case 'y':
          redo();
          break;
        case 'c':
          copySelection();
          break;
        case 'x':
          copySelection(true);
          break;
        case 'v':
          paste();
          break;
        case 'd':
          duplicate();
          break;
        case 'a':
          selectAll();
          break;
        case 's':
          void saveCurrent({ thumb: true }).then(() => s.toast(tr(s.settings.lang, 'toast.saved'), 'success'));
          break;
        case 'o':
          pickFile();
          break;
        case 'e':
          s.openDialog('export');
          break;
        default:
          return;
      }
      e.preventDefault();
      return;
    }
    if (e.altKey) return;

    const engine = getEngine();
    switch (e.key) {
      case 'b':
      case 'B':
      case '1':
        setTool('build');
        break;
      case 'v':
      case 'V':
      case '2':
        setTool('select');
        break;
      case 'p':
      case 'P':
      case '3':
        setTool('paint');
        break;
      case 'e':
      case 'E':
      case '4':
        setTool('erase');
        break;
      case 'r':
      case 'R':
        rotate(e.shiftKey ? -1 : 1);
        break;
      case 'Delete':
      case 'Backspace':
        deleteSelection();
        break;
      case 'Escape':
        escape();
        break;
      case 'f':
      case 'F':
        focus();
        break;
      case 'Home':
      case 'h':
      case 'H':
        setView('home');
        break;
      case 't':
      case 'T':
        setView('top');
        break;
      case '?':
        s.openDialog('help');
        break;
      case '[':
      case ']': {
        const cat = getPart(s.partId).category;
        cyclePart(e.key === ']' ? 1 : -1, PARTS.filter((p) => p.category === cat).map((p) => p.id));
        break;
      }
      case ',':
      case '.': {
        const i = COLORS.findIndex((c) => c.id === s.colorId);
        const n = COLORS[(i + (e.key === '.' ? 1 : -1) + COLORS.length) % COLORS.length];
        s.setColor(n.id);
        break;
      }
      case '=':
      case '+':
        engine?.zoom(0.8);
        break;
      case '-':
      case '_':
        engine?.zoom(1.25);
        break;
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
        if (s.selection.length) nudge(e.key, e.shiftKey);
        else if (engine) {
          const step = Math.PI / 12;
          if (e.key === 'ArrowLeft') engine.orbit(-step, 0);
          else if (e.key === 'ArrowRight') engine.orbit(step, 0);
          else if (e.key === 'ArrowUp') engine.orbit(0, -step / 1.5);
          else engine.orbit(0, step / 1.5);
        }
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

import type { ReactNode } from 'react';
import {
  Blocks,
  ClipboardPaste,
  CopyPlus,
  Eraser,
  Focus,
  Layers,
  MousePointer2,
  Network,
  PaintBucket,
  RotateCw,
  Trash,
  X,
} from 'lucide-react';
import { colorName, getColor } from '../core/colors';
import { getPart } from '../core/parts';
import type { Tool } from '../core/types';
import { useLang, useT, type TKey } from '../i18n';
import { deleteSelection, duplicate, escape, focus, paintSelection, rotate, selectConnected, selectSimilar } from '../state/actions';
import { model, useStore } from '../state/store';
import { PartIcon } from './PartsPanel';
import { useTouchDevice } from './device';
import { cx, IconButton } from './primitives';

const TOOLS: { id: Tool; icon: ReactNode; key: string }[] = [
  { id: 'build', icon: <Blocks size={19} />, key: 'B' },
  { id: 'select', icon: <MousePointer2 size={19} />, key: 'V' },
  { id: 'paint', icon: <PaintBucket size={19} />, key: 'P' },
  { id: 'erase', icon: <Eraser size={19} />, key: 'E' },
];

function ToolButton({ id, icon, shortcut }: { id: Tool; icon: ReactNode; shortcut: string }) {
  const t = useT();
  const tool = useStore((s) => s.tool);
  const pasting = useStore((s) => s.pasting);
  const setTool = useStore((s) => s.setTool);
  const active = tool === id && !pasting;
  return (
    <button
      type="button"
      onClick={() => setTool(id)}
      data-tip={t(`tool.${id}.tip` as TKey)}
      data-tip-key={shortcut}
      aria-pressed={active}
      className={cx(
        // 手机上图标在上、文字在下；桌面上横排
        'relative flex h-12 w-[52px] flex-col items-center justify-center gap-0.5 rounded-2xl transition-all duration-200 md:h-11 md:w-auto md:flex-row md:gap-2 md:px-3.5',
        active
          ? id === 'erase'
            ? 'bg-danger text-white shadow-[0_6px_16px_-6px_var(--danger)]'
            : 'bg-accent text-accent-ink shadow-[0_6px_16px_-6px_var(--accent)]'
          : 'text-ink-2 hover:bg-hover hover:text-ink',
      )}
    >
      {icon}
      <span className="text-[10px] leading-none font-medium md:text-[13px]">{t(`tool.${id}` as TKey)}</span>
    </button>
  );
}

function CurrentBrick() {
  const lang = useLang();
  const partId = useStore((s) => s.partId);
  const colorId = useStore((s) => s.colorId);
  const setUI = useStore((s) => s.setUI);
  const leftOpen = useStore((s) => s.ui.leftOpen);
  const part = getPart(partId);
  const color = getColor(colorId);
  return (
    <button
      type="button"
      onClick={() => {
        if (window.matchMedia('(max-width: 767px)').matches) setUI({ mobileSheet: 'parts' });
        else setUI({ leftOpen: !leftOpen });
      }}
      data-tip={`${part.name[lang]} · ${colorName(colorId, lang)}`}
      className="flex h-11 items-center gap-2 rounded-2xl pr-3 pl-1 transition-colors hover:bg-hover"
    >
      <PartIcon partId={partId} size={40} />
      <span className="hidden flex-col items-start leading-tight lg:flex">
        <span className="text-[12px] font-medium text-ink">{part.name[lang]}</span>
        <span className="flex items-center gap-1 text-[11px] text-ink-3">
          <span className={cx('h-2 w-2 rounded-full', color.kind === 'trans' && 'opacity-70')} style={{ background: color.hex }} />
          {colorName(colorId, lang)}
        </span>
      </span>
    </button>
  );
}

function SelectionBar() {
  const t = useT();
  const n = useStore((s) => s.selection.length);
  const colorId = useStore((s) => s.colorId);
  const color = getColor(colorId);
  return (
    <div className="glass anim-up flex items-center gap-0.5 rounded-2xl py-1 pr-1 pl-3.5">
      <span className="mr-1.5 text-[13px] font-medium whitespace-nowrap text-ink">{t('hint.selection', { n })}</span>
      <IconButton icon={<CopyPlus size={17} />} label={t('action.duplicate')} shortcut="Mod+D" onClick={duplicate} tipSide="top" size="sm" />
      <IconButton icon={<RotateCw size={17} />} label={t('action.rotate')} shortcut="R" onClick={() => rotate(1)} tipSide="top" size="sm" />
      <IconButton
        icon={<span className="h-4 w-4 rounded-full ring-2 ring-white/70" style={{ background: color.hex }} />}
        label={t('action.paintSelection')}
        onClick={() => paintSelection(colorId)}
        tipSide="top"
        size="sm"
      />
      <IconButton icon={<Network size={17} />} label={t('action.selectConnected')} onClick={() => selectConnected()} tipSide="top" size="sm" />
      <IconButton icon={<Layers size={17} />} label={t('action.selectSimilar')} onClick={selectSimilar} tipSide="top" size="sm" />
      <IconButton icon={<Focus size={17} />} label={t('action.focus')} shortcut="F" onClick={focus} tipSide="top" size="sm" />
      <IconButton icon={<Trash size={17} />} label={t('action.delete')} shortcut="Delete" onClick={deleteSelection} tipSide="top" size="sm" tone="danger" />
      <div className="mx-1 h-4 w-px bg-line-2" />
      <IconButton icon={<X size={17} />} label={t('action.deselect')} shortcut="Esc" onClick={escape} tipSide="top" size="sm" />
    </div>
  );
}

function PasteBar() {
  const t = useT();
  const touch = useTouchDevice();
  return (
    <div className="anim-up flex items-center gap-1 rounded-2xl bg-accent py-1 pr-1 pl-3.5 text-accent-ink shadow-[0_10px_30px_-10px_var(--accent)]">
      <ClipboardPaste size={16} />
      <span className="mx-1.5 text-[13px] font-medium whitespace-nowrap">{t(touch ? 'hint.paste.touch' : 'hint.paste')}</span>
      <button
        type="button"
        onClick={() => rotate(1)}
        className="flex h-8 w-8 items-center justify-center rounded-xl hover:bg-white/15"
        data-tip={t('action.rotate')}
        data-tip-key="R"
      >
        <RotateCw size={16} />
      </button>
      <button
        type="button"
        onClick={escape}
        className="flex h-8 w-8 items-center justify-center rounded-xl hover:bg-white/15"
        data-tip={t('dialog.close')}
        data-tip-key="Esc"
      >
        <X size={16} />
      </button>
    </div>
  );
}

function HintPill() {
  const t = useT();
  const tool = useStore((s) => s.tool);
  const hover = useStore((s) => (s.tool === 'build' ? s.hover : null));
  const hoverBrickId = useStore((s) => (s.tool !== 'build' ? (s.hover?.brickId ?? null) : null));
  useStore((s) => s.modelVersion); // 积木被上色等修改后同步刷新名称
  const hovered = hoverBrickId !== null ? model.get(hoverBrickId) : undefined;
  const lang = useLang();
  return (
    <div className="anim-fade hidden items-center gap-2 rounded-full bg-panel px-3.5 py-1.5 text-[12px] text-ink-2 shadow-sm ring-1 ring-line backdrop-blur-md md:flex">
      <span>{t(`hint.${tool}` as TKey)}</span>
      {hover && (
        <span
          className={cx(
            'rounded-full px-2 py-0.5 font-mono text-[11px] tabular-nums',
            hover.valid ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger',
          )}
        >
          x {hover.x} · z {hover.z} · {lang === 'zh' ? `高 ${hover.y} 板` : `y ${hover.y}`}
        </span>
      )}
      {hovered && (
        <span className="flex items-center gap-1.5 rounded-full bg-panel-2 px-2 py-0.5 text-[11px] text-ink ring-1 ring-line">
          <span className="h-2 w-2 rounded-full" style={{ background: getColor(hovered.color).hex }} />
          {getPart(hovered.part).name[lang]} · {colorName(hovered.color, lang)}
        </span>
      )}
    </div>
  );
}

export function Dock() {
  const t = useT();
  const hasSelection = useStore((s) => s.selection.length > 0);
  const pasting = useStore((s) => s.pasting);
  const hints = useStore((s) => s.settings.hints);
  return (
    <div className="pointer-events-none edge-b absolute inset-x-0 z-20 flex flex-col items-center gap-2 px-2">
      <div className="pointer-events-auto">
        {pasting ? <PasteBar /> : hasSelection ? <SelectionBar /> : hints ? <HintPill /> : null}
      </div>
      <div className="glass pointer-events-auto flex items-center gap-1 rounded-[22px] p-1.5">
        {TOOLS.map((tl) => (
          <ToolButton key={tl.id} id={tl.id} icon={tl.icon} shortcut={tl.key} />
        ))}
        <div className="mx-1 h-6 w-px bg-line-2" />
        <IconButton
          icon={<RotateCw size={19} />}
          label={t('tool.rotate.tip')}
          shortcut="R"
          onClick={() => rotate(1)}
          tipSide="top"
          size="lg"
          className="rounded-2xl"
        />
        <div className="mx-1 h-6 w-px bg-line-2" />
        <CurrentBrick />
      </div>
    </div>
  );
}


import { useMemo, useState } from 'react';
import { PanelLeftClose, Search, X } from 'lucide-react';
import { COLORS, colorName, getColor, type BrickColor } from '../core/colors';
import { CATEGORIES, PARTS, type PartCategory } from '../core/parts';
import { useLang, useT } from '../i18n';
import { paintSelection } from '../state/actions';
import { useStore } from '../state/store';
import { cx, IconButton } from './primitives';

/** 从图集中裁出零件图标 */
export function PartIcon({ partId, size = 64, className }: { partId: string; size?: number; className?: string }) {
  const thumbs = useStore((s) => s.thumbs);
  if (!thumbs || thumbs.index[partId] === undefined) {
    return <div className={cx('animate-pulse rounded-lg bg-hover', className)} style={{ width: size, height: size }} />;
  }
  const i = thumbs.index[partId];
  const col = i % thumbs.cols;
  const row = Math.floor(i / thumbs.cols);
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${thumbs.url})`,
        backgroundSize: `${thumbs.cols * size}px auto`,
        backgroundPosition: `-${col * size}px -${row * size}px`,
        backgroundRepeat: 'no-repeat',
      }}
    />
  );
}

const norm = (s: string) => s.toLowerCase().replace(/[×*х]/g, 'x').replace(/\s+/g, '');

function PartGrid({ query, cat }: { query: string; cat: 'all' | PartCategory }) {
  const t = useT();
  const lang = useLang();
  const partId = useStore((s) => s.partId);
  const setPart = useStore((s) => s.setPart);
  const parts = useMemo(() => {
    const q = norm(query);
    return PARTS.filter((p) => (cat === 'all' || p.category === cat) && (!q || norm(`${p.name.zh}${p.name.en}${p.id}${p.ldraw}`).includes(q)));
  }, [query, cat]);

  if (!parts.length) return <div className="px-2 py-10 text-center text-[12px] text-ink-3">{t('panel.noResult')}</div>;
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {parts.map((p) => {
        const active = p.id === partId;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => setPart(p.id)}
            data-tip={`${p.name[lang]}\nLDraw ${p.ldraw}`}
            data-tip-side="right"
            aria-pressed={active}
            className={cx(
              'group flex flex-col items-center gap-0.5 rounded-xl px-1 pt-1.5 pb-1.5 transition-all duration-150',
              active ? 'bg-accent-soft ring-2 ring-accent' : 'hover:bg-hover active:scale-[0.97]',
            )}
          >
            <PartIcon partId={p.id} size={62} className="transition-transform duration-200 group-hover:scale-105" />
            <span className={cx('w-full truncate text-center text-[11px] leading-tight', active ? 'font-medium text-accent' : 'text-ink-2')}>
              {p.name[lang]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Swatch({ color, active, onClick, size = 24 }: { color: BrickColor; active?: boolean; onClick?: () => void; size?: number }) {
  const lang = useLang();
  const inner =
    color.kind === 'metal'
      ? `linear-gradient(135deg, ${color.hex} 0%, #ffffff 45%, ${color.hex} 60%, ${color.hex} 100%)`
      : color.hex;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={lang === 'zh' ? color.zh : color.en}
      aria-pressed={active}
      data-tip={lang === 'zh' ? `${color.zh}  ${color.en}` : color.en}
      className={cx(
        'relative shrink-0 overflow-hidden rounded-full transition-transform duration-150 hover:scale-110',
        active ? 'ring-2 ring-accent ring-offset-2 ring-offset-[var(--panel-solid)]' : 'ring-1 ring-black/10 dark:ring-white/15',
        color.kind === 'trans' && 'checker',
      )}
      style={{ width: size, height: size }}
    >
      <span
        className="absolute inset-0 rounded-full"
        style={{
          background: inner,
          opacity: color.kind === 'trans' ? 0.62 : 1,
          boxShadow: 'inset 0 -3px 5px rgba(0,0,0,0.18), inset 0 2px 3px rgba(255,255,255,0.35)',
        }}
      />
    </button>
  );
}

export function ColorPalette({ compact }: { compact?: boolean }) {
  const t = useT();
  const lang = useLang();
  const colorId = useStore((s) => s.colorId);
  const setColor = useStore((s) => s.setColor);
  const groups: { key: 'solid' | 'trans' | 'metal'; label: string }[] = [
    { key: 'solid', label: t('color.solid') },
    { key: 'metal', label: t('color.metal') },
    { key: 'trans', label: t('color.trans') },
  ];
  const pick = (id: number) => {
    const s = useStore.getState();
    setColor(id);
    if (s.tool === 'select' && s.selection.length) paintSelection(id);
    else if (s.tool === 'erase') s.setTool('build');
  };
  const current = getColor(colorId);
  return (
    <div className="flex flex-col gap-2">
      {!compact && (
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold tracking-wide text-ink-2">{t('panel.colors')}</span>
          <span className="flex items-center gap-1.5 text-[12px] text-ink-2">
            <span
              className={cx('h-3 w-3 rounded-full ring-1 ring-black/10', current.kind === 'trans' && 'opacity-70')}
              style={{ background: current.hex }}
            />
            {colorName(colorId, lang)}
          </span>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.key} className="flex flex-col gap-1.5">
          {g.key !== 'solid' && <span className="text-[11px] text-ink-3">{g.label}</span>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(24px,1fr))] justify-items-center gap-x-1 gap-y-1.5">
            {COLORS.filter((c) => c.kind === g.key).map((c) => (
              <Swatch key={c.id} color={c} active={c.id === colorId} onClick={() => pick(c.id)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CategoryChips({ cat, setCat }: { cat: 'all' | PartCategory; setCat: (c: 'all' | PartCategory) => void }) {
  const t = useT();
  const lang = useLang();
  const items: { id: 'all' | PartCategory; label: string }[] = [
    { id: 'all', label: t('panel.all') },
    ...CATEGORIES.map((c) => ({ id: c.id, label: lang === 'zh' ? c.zh : c.en })),
  ];
  return (
    <div className="scroll-thin -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {items.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => setCat(c.id)}
          className={cx(
            'h-7 shrink-0 rounded-full px-3 text-[12px] font-medium transition-colors',
            cat === c.id ? 'bg-ink text-[var(--panel-solid)]' : 'bg-panel-2 text-ink-2 hover:text-ink',
          )}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  return (
    <label className="flex h-9 items-center gap-2 rounded-xl border border-line bg-panel-2 px-2.5 text-ink-3 focus-within:border-accent focus-within:text-accent">
      <Search size={15} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onChange('');
            (e.target as HTMLInputElement).blur();
          }
          e.stopPropagation();
        }}
        placeholder={t('panel.search')}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
      />
      {value && (
        <button type="button" onClick={() => onChange('')} className="text-ink-3 hover:text-ink" aria-label="clear">
          <X size={14} />
        </button>
      )}
    </label>
  );
}

/** 桌面端左侧面板：零件库 + 调色板 */
export function PartsPanel() {
  const t = useT();
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<'all' | PartCategory>('all');
  const setUI = useStore((s) => s.setUI);
  return (
    <aside className="glass anim-up absolute top-[72px] bottom-3 left-3 z-10 flex w-[300px] flex-col overflow-hidden rounded-[20px]">
      <div className="flex flex-col gap-2.5 px-3 pt-3 pb-2">
        <div className="flex items-center justify-between pl-1">
          <span className="text-[12px] font-semibold tracking-wide text-ink-2">{t('panel.parts')}</span>
          <IconButton icon={<PanelLeftClose size={16} />} label="收起面板" size="sm" tipSide="right" onClick={() => setUI({ leftOpen: false })} />
        </div>
        <SearchBox value={query} onChange={setQuery} />
        <CategoryChips cat={cat} setCat={setCat} />
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <PartGrid query={query} cat={cat} />
      </div>
      <div className="scroll-thin max-h-[42%] shrink-0 overflow-y-auto border-t border-line bg-panel-2/40 px-3 pt-2.5 pb-3">
        <ColorPalette />
      </div>
    </aside>
  );
}

/** 移动端底部抽屉 */
export function MobileSheet() {
  const t = useT();
  const sheet = useStore((s) => s.ui.mobileSheet);
  const setUI = useStore((s) => s.setUI);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<'all' | PartCategory>('all');
  if (!sheet) return null;
  return (
    <div className="fixed inset-0 z-30 md:hidden">
      <div className="anim-fade absolute inset-0 bg-[var(--backdrop)]" onClick={() => setUI({ mobileSheet: null })} />
      <div className="anim-up absolute inset-x-0 bottom-0 flex max-h-[62vh] flex-col rounded-t-[24px] border-t border-line bg-panel-solid pb-[env(safe-area-inset-bottom)] shadow-pop">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-2" />
        <div className="flex items-center gap-2 px-4 pt-2 pb-2">
          {(['parts', 'colors'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setUI({ mobileSheet: k })}
              className={cx('h-8 rounded-full px-4 text-[13px] font-medium', sheet === k ? 'bg-ink text-[var(--panel-solid)]' : 'text-ink-2')}
            >
              {k === 'parts' ? t('panel.parts') : t('panel.colors')}
            </button>
          ))}
          <div className="flex-1" />
          <IconButton icon={<X size={18} />} label="关闭" size="sm" onClick={() => setUI({ mobileSheet: null })} />
        </div>
        {sheet === 'parts' ? (
          <>
            <div className="flex flex-col gap-2 px-4 pb-2">
              <SearchBox value={query} onChange={setQuery} />
              <CategoryChips cat={cat} setCat={setCat} />
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-4" onClick={(e) => (e.target as HTMLElement).closest('button') && setUI({ mobileSheet: null })}>
              <PartGrid query={query} cat={cat} />
            </div>
          </>
        ) : (
          <div className="scroll-thin overflow-y-auto px-4 pb-6">
            <ColorPalette />
          </div>
        )}
      </div>
    </div>
  );
}

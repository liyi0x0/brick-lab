import { useMemo } from 'react';
import { FileSpreadsheet, ListChecks, ShoppingCart, X } from 'lucide-react';
import { buildBom } from '../core/bom';
import { colorName, getColor } from '../core/colors';
import { PLATE_H } from '../core/constants';
import { groupBounds } from '../core/placement';
import { useLang, useT } from '../i18n';
import { exportBrickLink, exportCSV } from '../state/actions';
import { model, useStore } from '../state/store';
import { Button, cx, IconButton } from './primitives';

function useModelSnapshot() {
  const version = useStore((s) => s.modelVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => model.list(), [version]);
}

/** 右上角：积木数量与尺寸 */
export function StatsCard() {
  const t = useT();
  const bricks = useModelSnapshot();
  const bomOpen = useStore((s) => s.ui.bomOpen);
  const setUI = useStore((s) => s.setUI);
  const playback = useStore((s) => s.ui.playback);
  const dims = useMemo(() => {
    if (!bricks.length) return null;
    const b = groupBounds(bricks);
    return { w: b.x1 - b.x0, d: b.z1 - b.z0, h: b.y1 - b.y0 };
  }, [bricks]);
  if (playback) return null;
  return (
    <button
      type="button"
      onClick={() => setUI({ bomOpen: !bomOpen })}
      data-tip={t('stats.partsList')}
      data-tip-side="left"
      className={cx(
        'glass below-bar edge-r absolute z-10 hidden items-center gap-3 rounded-2xl py-2 pr-2.5 pl-3.5 text-left transition-all hover:brightness-[1.02] md:flex',
        bomOpen && 'ring-2 ring-accent',
      )}
    >
      <div className="flex flex-col leading-tight">
        <span className="text-[18px] font-semibold tabular-nums tracking-tight text-ink">
          {bricks.length}
          <span className="ml-1 text-[12px] font-normal text-ink-3">{t('stats.bricks')}</span>
        </span>
        <span className="text-[11px] text-ink-3 tabular-nums">
          {dims
            ? `${dims.w}×${dims.d} ${t('stats.studs')} · ${t('stats.real')} ${(dims.w * 0.8).toFixed(1)}×${(dims.d * 0.8).toFixed(1)}×${(dims.h * PLATE_H * 0.8).toFixed(1)} cm`
            : t('stats.empty')}
        </span>
      </div>
      <ListChecks size={18} className="text-ink-3" />
    </button>
  );
}

/** 零件清单抽屉 */
export function BomPanel() {
  const t = useT();
  const lang = useLang();
  const open = useStore((s) => s.ui.bomOpen);
  const setUI = useStore((s) => s.setUI);
  const bricks = useModelSnapshot();
  const rows = useMemo(() => buildBom(bricks), [bricks]);
  if (!open) return null;
  return (
    <aside className="glass anim-right below-stats edge-r edge-b bom-panel absolute z-10 flex w-[320px] flex-col overflow-hidden rounded-[20px]">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <div className="flex-1">
          <div className="text-[14px] font-semibold">{t('bom.title')}</div>
          <div className="text-[11px] text-ink-3">
            {rows.length} {t('bom.kinds')} · {bricks.length} {t('bom.pieces')}
          </div>
        </div>
        <IconButton icon={<X size={16} />} label={t('dialog.close')} size="sm" onClick={() => setUI({ bomOpen: false })} />
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2">
        {rows.length === 0 && <p className="px-3 py-10 text-center text-[12px] leading-relaxed text-ink-3">{t('bom.empty')}</p>}
        {rows.map((r) => {
          const c = getColor(r.color);
          return (
            <div key={`${r.part.id}|${r.color}`} className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-hover">
              <span
                className={cx('h-7 w-7 shrink-0 rounded-lg ring-1 ring-black/10', c.kind === 'trans' && 'checker')}
                style={{ background: c.kind === 'trans' ? undefined : c.hex }}
              >
                {c.kind === 'trans' && <span className="block h-full w-full rounded-lg opacity-60" style={{ background: c.hex }} />}
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[12.5px] text-ink">{r.part.name[lang]}</div>
                <div className="truncate text-[11px] text-ink-3">
                  {colorName(r.color, lang)} · {r.part.ldraw}
                </div>
              </div>
              <span className="font-mono text-[13px] font-semibold tabular-nums text-ink">×{r.count}</span>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 border-t border-line p-3">
        <Button className="flex-1" icon={<FileSpreadsheet size={15} />} onClick={exportCSV} disabled={!rows.length}>
          CSV
        </Button>
        <Button className="flex-1" icon={<ShoppingCart size={15} />} onClick={exportBrickLink} disabled={!rows.length}>
          BrickLink
        </Button>
      </div>
    </aside>
  );
}

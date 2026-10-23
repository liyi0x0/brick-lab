import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Blocks, Hand, HardDrive, MousePointerClick } from 'lucide-react';
import { buildTemplate, TEMPLATES, type Template, type TemplateLevel } from '../core/templates';
import { thumbnailer } from '../engine/thumbnails';
import { useLang, useT, type TKey } from '../i18n';
import { newProject, openProject } from '../state/actions';
import { flushSave } from '../state/persistence';
import { model, useStore } from '../state/store';
import { askConfirm } from './ConfirmDialog';
import { useTouchDevice } from './device';
import { Logo } from './Logo';
import { cx, Dialog } from './primitives';

const LEVEL_STYLE: Record<TemplateLevel, string> = {
  1: 'bg-emerald-500/90',
  2: 'bg-sky-500/90',
  3: 'bg-orange-500/95',
};

const previewCache = new Map<string, { url: string; count: number }>();

/** 预览图只在卡片滚动进入视野时才生成（大型作品的生成与渲染都不便宜） */
function useLazyPreview(tpl: Template) {
  const ref = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState(() => previewCache.get(tpl.id) ?? null);
  useEffect(() => {
    if (preview || !ref.current) return;
    let timer = 0;
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        obs.disconnect();
        // 错开执行，让对话框先完成打开动画
        timer = window.setTimeout(() => {
          const bricks = buildTemplate(tpl);
          const p = { url: thumbnailer().modelImage(bricks, 480, 330), count: bricks.length };
          previewCache.set(tpl.id, p);
          setPreview(p);
        }, 60 + (TEMPLATES.indexOf(tpl) % 6) * 50);
      },
      { rootMargin: '120px' },
    );
    obs.observe(ref.current);
    return () => {
      obs.disconnect();
      window.clearTimeout(timer);
    };
  }, [preview, tpl]);
  return { ref, preview };
}

function TemplateCard({ tpl, onPick }: { tpl: Template; onPick: () => void }) {
  const lang = useLang();
  const t = useT();
  const { ref, preview } = useLazyPreview(tpl);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onPick}
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-panel-solid text-left transition-all duration-200 hover:-translate-y-1 hover:border-line-2 hover:shadow-panel"
    >
      <div className="relative aspect-[16/11] w-full overflow-hidden bg-gradient-to-b from-[var(--bg-top)] to-[var(--bg-bottom)]">
        {preview ? (
          <img src={preview.url} alt="" className="anim-fade h-full w-full object-contain p-2 transition-transform duration-300 group-hover:scale-[1.06]" />
        ) : (
          <div className="h-full w-full animate-pulse bg-hover" />
        )}
        <span className={cx('absolute top-2 left-2 rounded-full px-2 py-0.5 text-[10.5px] font-semibold text-white shadow-sm', LEVEL_STYLE[tpl.level])}>
          {t(`level.${tpl.level}` as TKey)}
        </span>
        {preview && (
          <span className="absolute right-2 bottom-2 rounded-full bg-black/55 px-2 py-0.5 text-[10.5px] font-medium text-white tabular-nums backdrop-blur">
            {t('library.bricks', { n: preview.count })}
          </span>
        )}
      </div>
      <div className="px-3 py-2.5">
        <div className="text-[13px] font-semibold">{tpl.name[lang]}</div>
        <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-ink-3">{tpl.description[lang]}</div>
      </div>
    </button>
  );
}

export function WelcomeDialog() {
  const t = useT();
  const open = useStore((s) => s.ui.dialog === 'welcome');
  const openDialog = useStore((s) => s.openDialog);
  const [level, setLevel] = useState<0 | TemplateLevel>(0);
  const touch = useTouchDevice();
  const close = () => openDialog(null);

  const start = () => {
    if (model.count) {
      void flushSave().then(newProject);
    }
    close();
  };

  const pick = async (tpl: Template) => {
    // 当前画面就是未改动过的示例时无需确认
    if (model.count && model.canUndo && !(await askConfirm(t('confirm.template')))) return;
    void flushSave().then(() => {
      openProject({
        name: tpl.name[useStore.getState().settings.lang],
        baseplateSize: tpl.baseplateSize,
        baseplateColor: tpl.baseplateColor,
        bricks: buildTemplate(tpl),
      });
      close();
    });
  };

  const tips = [
    { icon: <MousePointerClick size={16} />, text: t(touch ? 'welcome.tip1.touch' : 'welcome.tip1') },
    { icon: <Hand size={16} />, text: t(touch ? 'welcome.tip2.touch' : 'welcome.tip2') },
    { icon: <HardDrive size={16} />, text: t('welcome.tip3') },
  ];
  const levels: (0 | TemplateLevel)[] = [0, 1, 2, 3];
  const shown = TEMPLATES.filter((x) => level === 0 || x.level === level);

  return (
    <Dialog open={open} onClose={close} width={980} bare>
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-[#ff5a4a]/20 blur-3xl" />
        <div className="pointer-events-none absolute -top-16 left-1/3 h-56 w-56 rounded-full bg-[#2f6bff]/15 blur-3xl" />
        <div className="pointer-events-none absolute top-10 -left-16 h-56 w-56 rounded-full bg-[#fac80a]/20 blur-3xl" />
        <div className="relative px-6 pt-7 pb-6 sm:px-8">
          <div className="flex items-center gap-3">
            <Logo size={44} />
            <div>
              <h1 className="text-[22px] font-bold tracking-tight">{t('welcome.title')}</h1>
              <p className="text-[13px] text-ink-2">{t('welcome.subtitle')}</p>
            </div>
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {tips.map((tip) => (
              <div key={tip.text} className="flex items-center gap-2.5 rounded-xl bg-panel-2 px-3 py-2.5 text-[12px] text-ink-2 ring-1 ring-line">
                <span className="text-accent">{tip.icon}</span>
                {tip.text}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={start}
            className="group mt-5 flex w-full items-center gap-3 rounded-2xl bg-accent px-5 py-3.5 text-left text-accent-ink shadow-[0_14px_30px_-12px_var(--accent)] transition-transform hover:scale-[1.01] active:scale-[0.995]"
          >
            <Blocks size={20} />
            <span className="flex-1 text-[14.5px] font-semibold">{t('welcome.blank')}</span>
            <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
          </button>
          <div className="mt-6 mb-3 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[12px] font-semibold tracking-wide text-ink-2">
              {t('welcome.templates')} · {t('welcome.count', { n: TEMPLATES.length })}
            </span>
            <div className="flex flex-wrap gap-1">
              {levels.map((lv) => {
                const n = lv === 0 ? TEMPLATES.length : TEMPLATES.filter((x) => x.level === lv).length;
                if (lv !== 0 && n === 0) return null;
                return (
                  <button
                    key={lv}
                    type="button"
                    onClick={() => setLevel(lv)}
                    className={cx(
                      'h-7 rounded-full px-3 text-[12px] font-medium transition-colors',
                      level === lv ? 'bg-ink text-[var(--panel-solid)]' : 'bg-panel-2 text-ink-2 hover:text-ink',
                    )}
                  >
                    {t(lv === 0 ? 'level.all' : (`level.${lv}` as TKey))}
                    <span className="ml-1 opacity-60 tabular-nums">{n}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {shown.map((tpl) => (
              <TemplateCard key={tpl.id} tpl={tpl} onPick={() => void pick(tpl)} />
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

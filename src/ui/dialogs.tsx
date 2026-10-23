import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Check,
  Copy,
  CopyPlus,
  Download,
  FileBraces,
  FileSpreadsheet,
  FolderOpen,
  Image,
  Keyboard,
  Link,
  Mouse,
  Package,
  Pencil,
  Plus,
  Settings,
  Share2,
  ShoppingCart,
  Trash,
  CircleQuestionMark,
} from 'lucide-react';
import { BASEPLATE_COLORS, getColor } from '../core/colors';
import { BASEPLATE_SIZES } from '../core/constants';
import { toProjectFile } from '../core/serialize';
import { useLang, useT, type TKey } from '../i18n';
import {
  download,
  exportBrickLink,
  exportCSV,
  exportJSON,
  exportLDraw,
  exportPNG,
  makeShareLink,
  newProject,
} from '../state/actions';
import {
  deleteProject,
  duplicateProject,
  flushSave,
  listProjects,
  loadProject,
  onLibraryChange,
  renameProject,
  saveCurrent,
  switchToProject,
  type LibraryEntry,
} from '../state/persistence';
import { model, useStore, type Lang, type Quality, type Theme } from '../state/store';
import { askConfirm, askText } from './ConfirmDialog';
import { Swatch } from './PartsPanel';
import { Button, cx, Dialog, IconButton, Kbd, keyLabel, Segmented, Switch } from './primitives';

function useClose() {
  const openDialog = useStore((s) => s.openDialog);
  return () => openDialog(null);
}

// ---------------------------------------------------------------------------
// 帮助
// ---------------------------------------------------------------------------

export function HelpDialog() {
  const t = useT();
  const open = useStore((s) => s.ui.dialog === 'help');
  const close = useClose();
  const mouse: [string, TKey][] = [
    ['help.leftClick', 'help.leftClick.desc'],
    ['help.leftDrag', 'help.leftDrag.desc'],
    ['help.rightDrag', 'help.rightDrag.desc'],
    ['help.rightClick', 'help.rightClick.desc'],
    ['help.wheel', 'help.wheel.desc'],
    ['help.alt', 'help.alt.desc'],
    ['help.shift', 'help.shift.desc'],
    ['help.dbl', 'help.dbl.desc'],
    ['help.long', 'help.long.desc'],
  ] as [TKey, TKey][];
  const keys: [string[], TKey][] = [
    [['B', 'V', 'P', 'E'], 'help.k.tools'],
    [['R'], 'help.k.rotate'],
    [['Mod+Z', 'Mod+Shift+Z'], 'help.k.undo'],
    [['Mod+C', 'Mod+V', 'Mod+D'], 'help.k.copy'],
    [['Delete'], 'help.k.delete'],
    [['↑↓←→'], 'help.k.move'],
    [['Mod+A'], 'help.k.selectAll'],
    [['F'], 'help.k.focus'],
    [['H', 'T'], 'help.k.views'],
    [['[', ']'], 'help.k.cycle'],
    [['Esc'], 'help.k.esc'],
    [['?'], 'help.k.help'],
  ];
  return (
    <Dialog open={open} onClose={close} title={t('help.title')} icon={<CircleQuestionMark size={17} />} width={760}>
      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-[12px] font-semibold tracking-wide text-ink-2">
            <Mouse size={15} /> {t('help.mouse')}
          </h3>
          <div className="flex flex-col divide-y divide-line rounded-2xl border border-line">
            {mouse.map(([k, d]) => (
              <div key={k} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="w-[92px] shrink-0 text-[13px] font-medium">{t(k as TKey)}</span>
                <span className="text-[12.5px] leading-snug text-ink-2">{t(d)}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 rounded-xl bg-panel-2 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-2">📱 {t('help.touch')}</p>
        </section>
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-[12px] font-semibold tracking-wide text-ink-2">
            <Keyboard size={15} /> {t('help.keyboard')}
          </h3>
          <div className="flex flex-col divide-y divide-line rounded-2xl border border-line">
            {keys.map(([ks, d]) => (
              <div key={d} className="flex items-center gap-3 px-3.5 py-2">
                <span className="flex w-[124px] shrink-0 flex-wrap gap-1">
                  {ks.map((k) => (
                    <Kbd key={k}>{keyLabel(k)}</Kbd>
                  ))}
                </span>
                <span className="text-[12.5px] leading-snug text-ink-2">{t(d)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <div className="text-[11.5px] text-ink-3">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function SettingsDialog() {
  const t = useT();
  const open = useStore((s) => s.ui.dialog === 'settings');
  const close = useClose();
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const project = useStore((s) => s.project);
  const updateProject = useStore((s) => s.updateProject);
  const lang = useLang();
  return (
    <Dialog open={open} onClose={close} title={t('settings.title')} icon={<Settings size={17} />} width={520}>
      <div className="divide-y divide-line">
        <Row label={t('settings.quality')} hint={lang === 'zh' ? '高画质包含环境光遮蔽，更真实但更耗电' : 'High adds ambient occlusion — prettier, more GPU'}>
          <Segmented<Quality>
            value={settings.quality}
            onChange={(quality) => update({ quality })}
            options={[
              { value: 'high', label: t('settings.quality.high') },
              { value: 'medium', label: t('settings.quality.medium') },
              { value: 'low', label: t('settings.quality.low') },
            ]}
          />
        </Row>
        <Row label={t('settings.theme')}>
          <Segmented<Theme>
            value={settings.theme}
            onChange={(theme) => update({ theme })}
            options={[
              { value: 'light', label: t('settings.theme.light') },
              { value: 'dark', label: t('settings.theme.dark') },
              { value: 'system', label: t('settings.theme.system') },
            ]}
          />
        </Row>
        <Row label={t('settings.lang')}>
          <Segmented<Lang>
            value={settings.lang}
            onChange={(l) => update({ lang: l })}
            options={[
              { value: 'zh', label: '中文' },
              { value: 'en', label: 'English' },
            ]}
          />
        </Row>
        <Row label={t('settings.sound')}>
          <Switch checked={settings.sound} onChange={(sound) => update({ sound })} label={t('settings.sound')} />
        </Row>
        <Row label={t('settings.hints')}>
          <Switch checked={settings.hints} onChange={(hints) => update({ hints })} label={t('settings.hints')} />
        </Row>
        <Row label={t('settings.baseplateSize')}>
          <Segmented<number>
            value={project.baseplateSize}
            onChange={(baseplateSize) => updateProject({ baseplateSize })}
            options={BASEPLATE_SIZES.map((s) => ({ value: s, label: String(s) }))}
          />
        </Row>
        <div className="py-3">
          <div className="mb-2.5 text-[13px] font-medium">{t('settings.baseplateColor')}</div>
          <div className="flex flex-wrap gap-2">
            {BASEPLATE_COLORS.map((id) => (
              <Swatch
                key={id}
                color={getColor(id)}
                size={28}
                active={project.baseplateColor === id}
                onClick={() => updateProject({ baseplateColor: id })}
              />
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 导出与分享
// ---------------------------------------------------------------------------

function ExportCard({ icon, title, desc, onClick, accent }: { icon: ReactNode; title: string; desc: string; onClick: () => void; accent: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-start gap-3 rounded-2xl border border-line p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-line-2 hover:shadow-panel"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: accent }}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">{desc}</span>
      </span>
    </button>
  );
}

export function ExportDialog() {
  const t = useT();
  const open = useStore((s) => s.ui.dialog === 'export');
  const close = useClose();
  const version = useStore((s) => s.modelVersion);
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!open || __ARTIFACT__) return;
    setCopied(false);
    let alive = true;
    void makeShareLink().then((l) => alive && setLink(l));
    return () => {
      alive = false;
    };
  }, [open, version]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const el = document.getElementById('share-link') as HTMLInputElement | null;
      el?.select();
      document.execCommand?.('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const run = (fn: () => void) => () => {
    fn();
  };
  return (
    <Dialog open={open} onClose={close} title={t('export.title')} icon={<Share2 size={17} />} width={640}>
      {!__ARTIFACT__ && (
      <div className="mb-4 rounded-2xl bg-gradient-to-br from-accent-soft to-transparent p-4 ring-1 ring-line">
        <div className="mb-1 flex items-center gap-2 text-[13.5px] font-semibold">
          <Link size={16} className="text-accent" /> {t('export.share')}
        </div>
        <p className="mb-3 text-[12px] text-ink-3">{t('export.share.desc')}</p>
        <div className="flex gap-2">
          <input
            id="share-link"
            readOnly
            value={link}
            onFocus={(e) => e.target.select()}
            className="h-9 min-w-0 flex-1 rounded-xl border border-line-2 bg-panel-solid px-3 font-mono text-[12px] text-ink-2 outline-none"
          />
          <Button variant="primary" onClick={copy} icon={copied ? <Check size={15} /> : <Copy size={15} />} disabled={!link}>
            {copied ? '✓' : t('action.copy')}
          </Button>
        </div>
        {link.length > 8000 && (
          <p className="mt-2 text-[11.5px] text-ink-3">
            {t('export.json.desc')} · {Math.round(link.length / 1024)} KB
          </p>
        )}
      </div>
      )}
      <div className="grid gap-2.5 sm:grid-cols-2">
        <ExportCard icon={<Image size={19} />} accent="#7c5cff" title={t('export.png')} desc={t('export.png.desc')} onClick={run(() => void exportPNG(false))} />
        <ExportCard
          icon={<Image size={19} />}
          accent="#a855f7"
          title={t('export.pngTransparent')}
          desc={t('export.pngTransparent.desc')}
          onClick={run(() => void exportPNG(true))}
        />
        <ExportCard icon={<FileBraces size={19} />} accent="#2f6bff" title={t('export.json')} desc={t('export.json.desc')} onClick={run(exportJSON)} />
        <ExportCard icon={<Package size={19} />} accent="#0ea5a4" title={t('export.ldraw')} desc={t('export.ldraw.desc')} onClick={run(exportLDraw)} />
        <ExportCard icon={<FileSpreadsheet size={19} />} accent="#16a34a" title={t('export.csv')} desc={t('export.csv.desc')} onClick={run(exportCSV)} />
        <ExportCard icon={<ShoppingCart size={19} />} accent="#f97316" title={t('export.bricklink')} desc={t('export.bricklink.desc')} onClick={run(exportBrickLink)} />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 我的作品
// ---------------------------------------------------------------------------

function timeAgo(ts: number, lang: Lang) {
  const rtf = new Intl.RelativeTimeFormat(lang === 'zh' ? 'zh-CN' : 'en', { numeric: 'auto' });
  const s = Math.round((ts - Date.now()) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(Math.round(s), 'second');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(ts).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en');
}

export function LibraryDialog() {
  const t = useT();
  const lang = useLang();
  const open = useStore((s) => s.ui.dialog === 'library');
  const close = useClose();
  const currentId = useStore((s) => s.project.id);
  const [list, setList] = useState<LibraryEntry[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const refresh = () => void listProjects().then((l) => alive && setList(l));
    // 打开时先保存当前作品并刷新缩略图
    void (async () => {
      await flushSave();
      if (model.count) await saveCurrent({ thumb: true });
      refresh();
    })();
    const off = onLibraryChange(refresh);
    return () => {
      alive = false;
      off();
    };
  }, [open]);

  const exportEntry = async (e: LibraryEntry) => {
    const p = await loadProject(e.id);
    if (!p) return;
    download(`${e.name}.brick.json`, JSON.stringify(toProjectFile(p.data, p.data.bricks)), 'application/json');
  };

  return (
    <Dialog open={open} onClose={close} title={t('library.title')} icon={<FolderOpen size={17} />} width={880}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => {
            void flushSave().then(() => {
              newProject();
              close();
            });
          }}
          className="flex aspect-[4/3.6] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-2 text-ink-2 transition-colors hover:border-accent hover:text-accent"
        >
          <Plus size={26} />
          <span className="text-[13px] font-medium">{t('library.new')}</span>
        </button>
        {list?.map((e) => (
          <div
            key={e.id}
            className={cx(
              'group relative flex flex-col overflow-hidden rounded-2xl border bg-panel-solid transition-all hover:-translate-y-0.5 hover:shadow-panel',
              e.id === currentId ? 'border-accent ring-2 ring-accent/30' : 'border-line',
            )}
          >
            <button
              type="button"
              className="relative aspect-[3/2] w-full overflow-hidden bg-gradient-to-b from-[var(--bg-top)] to-[var(--bg-bottom)]"
              onClick={() => {
                if (e.id !== currentId) void switchToProject(e.id);
                close();
              }}
            >
              {e.thumb ? (
                <img src={e.thumb} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
              ) : (
                <span className="flex h-full items-center justify-center text-ink-3">
                  <Package size={28} />
                </span>
              )}
              {e.id === currentId && (
                <span className="absolute top-2 left-2 rounded-full bg-accent px-2 py-0.5 text-[10.5px] font-semibold text-accent-ink">
                  {t('library.current')}
                </span>
              )}
            </button>
            <div className="flex items-center gap-1 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{e.name}</div>
                <div className="text-[11px] text-ink-3">
                  {t('library.bricks', { n: e.count })} · {timeAgo(e.updatedAt, lang)}
                </div>
              </div>
            </div>
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              {[
                {
                  icon: <Pencil size={14} />,
                  label: t('project.rename'),
                  fn: async () => {
                    const name = await askText(t('project.rename'), e.name);
                    if (!name) return;
                    void renameProject(e.id, name);
                    if (e.id === currentId) useStore.getState().updateProject({ name });
                  },
                },
                { icon: <CopyPlus size={14} />, label: t('library.duplicate'), fn: () => void duplicateProject(e.id) },
                { icon: <Download size={14} />, label: t('library.export'), fn: () => void exportEntry(e) },
                {
                  icon: <Trash size={14} />,
                  label: t('dialog.delete'),
                  fn: async () => {
                    if (e.id === currentId) return;
                    if (await askConfirm(t('library.confirmDelete', { name: e.name }), { danger: true, confirmLabel: t('dialog.delete') }))
                      void deleteProject(e.id);
                  },
                  disabled: e.id === currentId,
                },
              ].map((a) => (
                <IconButton
                  key={a.label}
                  icon={a.icon}
                  label={a.label}
                  size="sm"
                  disabled={a.disabled}
                  onClick={() => void a.fn()}
                  className="!h-7 !w-7 bg-panel-solid/90 shadow-sm backdrop-blur"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      {list && list.length === 0 && <p className="mt-6 text-center text-[12.5px] text-ink-3">{t('library.empty')}</p>}
    </Dialog>
  );
}

export function useBaseplateLabel() {
  const size = useStore((s) => s.project.baseplateSize);
  return useMemo(() => `${size}×${size}`, [size]);
}

import { useEffect } from 'react';
import { PanelLeftOpen, Shapes } from 'lucide-react';
import { TEMPLATES } from './core/templates';
import { thumbnailer } from './engine/thumbnails';
import { useT } from './i18n';
import { openProject } from './state/actions';
import { getEngine } from './state/engineRef';
import { installShortcuts } from './state/shortcuts';
import { restoreSession, startAutosave } from './state/persistence';
import { useStore } from './state/store';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { HelpDialog, ExportDialog, LibraryDialog, SettingsDialog } from './ui/dialogs';
import { Dock } from './ui/Dock';
import { DropZone } from './ui/DropZone';
import { MobileSheet, PartsPanel } from './ui/PartsPanel';
import { PlaybackBar } from './ui/PlaybackBar';
import { IconButton, TooltipLayer } from './ui/primitives';
import { BomPanel, StatsCard } from './ui/Stats';
import { Toasts } from './ui/Toasts';
import { TopBar } from './ui/TopBar';
import { ViewControls } from './ui/ViewControls';
import { Viewport } from './ui/Viewport';
import { WelcomeDialog } from './ui/WelcomeDialog';

/** 主题：写入 <html data-theme>，跟随系统时监听变化 */
function useTheme() {
  const theme = useStore((s) => s.settings.theme);
  const lang = useStore((s) => s.settings.lang);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#151a24' : '#eef1f6');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = lang === 'zh' ? '积木工坊' : 'BrickLab';
  }, [lang]);
}

/** 当前颜色变化时重新渲染零件图标 */
function usePartAtlas() {
  const colorId = useStore((s) => s.colorId);
  useEffect(() => {
    let alive = true;
    const id = window.setTimeout(() => {
      const cell = Math.round(64 * Math.min(2, window.devicePixelRatio || 1));
      void thumbnailer()
        .partAtlas(colorId, cell)
        .then((atlas) => alive && useStore.setState({ thumbs: atlas }));
    }, 60);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [colorId]);
}

/** 让 3D 画面的中心落在未被面板遮挡的区域 */
function useViewInset() {
  const leftOpen = useStore((s) => s.ui.leftOpen);
  const bomOpen = useStore((s) => s.ui.bomOpen);
  const playback = useStore((s) => s.ui.playback);
  useEffect(() => {
    const apply = () => {
      const desktop = window.innerWidth >= 768;
      const left = desktop && leftOpen && !playback ? 320 : 0;
      const right = desktop && bomOpen && !playback ? (window.innerWidth >= 1024 ? 384 : 332) : 0;
      getEngine()?.setViewInset(left, right);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [leftOpen, bomOpen, playback]);
}

export default function App() {
  const t = useT();
  const leftOpen = useStore((s) => s.ui.leftOpen);
  const playback = useStore((s) => s.ui.playback);
  const setUI = useStore((s) => s.setUI);
  useTheme();
  usePartAtlas();
  useViewInset();

  useEffect(() => {
    const offKeys = installShortcuts();
    const offSave = startAutosave();
    void restoreSession().then((r) => {
      if (r !== 'empty') return;
      // 首次打开：先摆上一个示例作品，再弹出欢迎页，第一眼看到的就是真实的积木
      const tpl = TEMPLATES[0];
      openProject({
        name: tpl.name[useStore.getState().settings.lang],
        baseplateSize: tpl.baseplateSize,
        baseplateColor: tpl.baseplateColor,
        bricks: tpl.build(),
      });
      useStore.getState().openDialog('welcome');
    });
    return () => {
      offKeys();
      offSave();
    };
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Viewport />
      <TopBar />
      {!playback && (
        <>
          <div className="hidden md:block">
            {leftOpen ? (
              <PartsPanel />
            ) : (
              <div className="glass below-bar edge-l absolute z-10 rounded-2xl p-1">
                <IconButton icon={<PanelLeftOpen size={18} />} label={t('panel.parts')} tipSide="right" onClick={() => setUI({ leftOpen: true })} />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setUI({ mobileSheet: 'parts' })}
            className="glass mobile-parts-btn edge-l absolute z-20 flex h-11 items-center gap-2 rounded-2xl px-3.5 text-[13px] font-medium md:hidden"
          >
            <Shapes size={17} /> {t('panel.parts')}
          </button>
          <Dock />
          <StatsCard />
          <BomPanel />
          <MobileSheet />
        </>
      )}
      <ViewControls />
      <PlaybackBar />
      <Toasts />
      <HelpDialog />
      <SettingsDialog />
      <ExportDialog />
      <LibraryDialog />
      <WelcomeDialog />
      <DropZone />
      <ConfirmDialog />
      <TooltipLayer />
    </div>
  );
}

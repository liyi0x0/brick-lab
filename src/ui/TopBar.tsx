import { useState } from 'react';
import {
  Clapperboard,
  Ellipsis,
  FileUp,
  FolderOpen,
  CircleQuestionMark,
  Plus,
  Redo2,
  Settings,
  Share2,
  Sparkles,
  Trash,
  Undo2,
} from 'lucide-react';
import { useT } from '../i18n';
import { clearAll, newProject, pickFile, redo, undo } from '../state/actions';
import { flushSave } from '../state/persistence';
import { model, useStore } from '../state/store';
import { Logo } from './Logo';
import { Button, cx, IconButton, Menu } from './primitives';

function ProjectName() {
  const t = useT();
  const name = useStore((s) => s.project.name);
  const updateProject = useStore((s) => s.updateProject);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const commit = () => {
    const v = draft.trim().slice(0, 60);
    if (v && v !== name) updateProject({ name: v });
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
          e.stopPropagation();
        }}
        aria-label={t('project.rename')}
        className="h-8 w-[180px] rounded-lg border border-accent bg-panel-solid px-2 text-[13px] font-medium text-ink outline-none sm:w-[220px]"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(name);
        setEditing(true);
      }}
      data-tip={t('project.rename')}
      className="h-8 max-w-[96px] truncate rounded-lg px-2 text-[13px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink min-[420px]:max-w-[150px] sm:max-w-[240px]"
    >
      {name}
    </button>
  );
}

export function startPlayback() {
  const s = useStore.getState();
  if (!model.count) {
    s.toast(s.settings.lang === 'zh' ? '作品里还没有积木' : 'There are no bricks yet');
    return;
  }
  s.setSelection([]);
  useStore.setState({ pasting: false });
  s.setUI({ playback: true, bomOpen: false });
}

export function TopBar() {
  const t = useT();
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const openDialog = useStore((s) => s.openDialog);

  const confirmThen = (msg: string, fn: () => void) => {
    if (!model.count || window.confirm(msg)) fn();
  };

  const menuItems = [
    {
      label: t('menu.new'),
      icon: <Plus size={16} />,
      onClick: () =>
        confirmThen(t('confirm.new'), () => {
          void flushSave().then(newProject);
        }),
    },
    { label: t('menu.import'), icon: <FileUp size={16} />, shortcut: 'Mod+O', onClick: pickFile },
    { label: t('menu.library'), icon: <FolderOpen size={16} />, onClick: () => openDialog('library') },
    { label: t('menu.templates'), icon: <Sparkles size={16} />, onClick: () => openDialog('welcome') },
    { divider: true, label: '' },
    { label: t('menu.instructions'), icon: <Clapperboard size={16} />, onClick: startPlayback },
    { label: t('menu.settings'), icon: <Settings size={16} />, onClick: () => openDialog('settings') },
    { label: t('menu.help'), icon: <CircleQuestionMark size={16} />, shortcut: '?', onClick: () => openDialog('help') },
    { divider: true, label: '' },
    {
      label: t('menu.clear'),
      icon: <Trash size={16} />,
      danger: true,
      onClick: () => confirmThen(t('confirm.clear'), clearAll),
    },
  ];

  return (
    <>
      <div className="glass absolute top-3 left-3 z-20 flex h-12 items-center gap-1.5 rounded-2xl pr-1.5 pl-2.5">
        <Logo size={28} />
        <span className="hidden pr-1 text-[14px] font-semibold tracking-tight sm:inline">{t('app.name')}</span>
        <div className="mx-0.5 hidden h-5 w-px bg-line-2 sm:block" />
        <ProjectName />
      </div>

      <div className="glass absolute top-3 right-3 z-20 flex h-12 items-center gap-0.5 rounded-2xl px-1.5">
        <IconButton icon={<Undo2 size={18} />} label={t('action.undo')} shortcut="Mod+Z" disabled={!canUndo} onClick={undo} />
        <IconButton icon={<Redo2 size={18} />} label={t('action.redo')} shortcut="Mod+Shift+Z" disabled={!canRedo} onClick={redo} />
        <div className="mx-1 hidden h-5 w-px bg-line-2 sm:block" />
        <div className="hidden items-center gap-0.5 lg:flex">
          <IconButton icon={<FolderOpen size={18} />} label={t('menu.library')} onClick={() => openDialog('library')} />
          <IconButton icon={<Clapperboard size={18} />} label={t('menu.instructions')} onClick={startPlayback} />
          <IconButton icon={<Settings size={18} />} label={t('menu.settings')} onClick={() => openDialog('settings')} />
          <IconButton
            icon={<CircleQuestionMark size={18} />}
            label={t('menu.help')}
            shortcut="?"
            onClick={() => openDialog('help')}
          />
        </div>
        <Menu
          items={menuItems}
          trigger={(open, toggle) => (
            <IconButton icon={<Ellipsis size={18} />} label={t('menu.more')} onClick={toggle} className={cx(open && '!bg-hover !text-ink')} />
          )}
        />
        <span className="ml-1 hidden sm:block">
          <Button variant="primary" icon={<Share2 size={16} />} onClick={() => openDialog('export')}>
            {t('menu.export')}
          </Button>
        </span>
        <span className="sm:hidden">
          <IconButton icon={<Share2 size={18} />} label={t('menu.export')} onClick={() => openDialog('export')} />
        </span>
      </div>
    </>
  );
}

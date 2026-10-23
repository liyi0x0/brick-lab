import { ArrowDownToLine, Box, House, Scan, ZoomIn, ZoomOut } from 'lucide-react';
import { useT } from '../i18n';
import { focus, setView } from '../state/actions';
import { getEngine } from '../state/engineRef';
import { IconButton } from './primitives';

/** 右下角：视角预设与缩放 */
export function ViewControls() {
  const t = useT();
  return (
    <div className="glass absolute right-3 bottom-3 z-10 hidden flex-col items-center gap-0.5 rounded-2xl p-1 md:flex">
      <IconButton icon={<House size={17} />} label={t('view.home')} shortcut="H" tipSide="left" size="sm" onClick={() => setView('home')} />
      <IconButton icon={<ArrowDownToLine size={17} />} label={t('view.top')} shortcut="T" tipSide="left" size="sm" onClick={() => setView('top')} />
      <IconButton icon={<Box size={17} />} label={t('view.front')} tipSide="left" size="sm" onClick={() => setView('front')} />
      <IconButton
        icon={<Box size={17} className="-scale-x-100" />}
        label={t('view.right')}
        tipSide="left"
        size="sm"
        onClick={() => setView('right')}
      />
      <div className="my-0.5 h-px w-5 bg-line-2" />
      <IconButton icon={<ZoomIn size={17} />} label={t('view.zoomIn')} shortcut="+" tipSide="left" size="sm" onClick={() => getEngine()?.zoom(0.75)} />
      <IconButton icon={<ZoomOut size={17} />} label={t('view.zoomOut')} shortcut="-" tipSide="left" size="sm" onClick={() => getEngine()?.zoom(1.33)} />
      <IconButton icon={<Scan size={17} />} label={t('view.focus')} shortcut="F" tipSide="left" size="sm" onClick={focus} />
    </div>
  );
}

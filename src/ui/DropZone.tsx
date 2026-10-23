import { useEffect, useState } from 'react';
import { FileUp } from 'lucide-react';
import { importFile } from '../state/actions';
import { useLang } from '../i18n';

/** 把作品文件拖进窗口即可打开 */
export function DropZone() {
  const lang = useLang();
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const overFn = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) void importFile(f);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overFn);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('drop', drop);
    };
  }, []);
  if (!over) return null;
  return (
    <div className="anim-fade pointer-events-none fixed inset-3 z-[70] flex items-center justify-center rounded-[28px] border-2 border-dashed border-accent bg-accent-soft backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 text-accent">
        <FileUp size={40} />
        <span className="text-[15px] font-semibold">
          {lang === 'zh' ? '松开以打开作品（.brick.json / .ldr / .mpd）' : 'Drop to open (.brick.json / .ldr / .mpd)'}
        </span>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Check, Copy, FileText } from 'lucide-react';
import { useLang, useT } from '../i18n';
import { useStore } from '../state/store';
import { Button, Dialog } from './primitives';

/** 演示版：用页面内预览代替文件下载 */
export function ExportPreview() {
  const t = useT();
  const lang = useLang();
  const preview = useStore((s) => s.exportPreview);
  const [copied, setCopied] = useState(false);
  const close = () => {
    setCopied(false);
    useStore.setState({ exportPreview: null });
  };
  const copy = async () => {
    if (!preview?.text) return;
    try {
      await navigator.clipboard.writeText(preview.text);
    } catch {
      (document.getElementById('export-preview-text') as HTMLTextAreaElement | null)?.select();
    }
    setCopied(true);
  };
  return (
    <Dialog open={!!preview} onClose={close} title={preview?.file} icon={<FileText size={17} />} width={720}>
      {preview?.image ? (
        <div className="flex flex-col gap-3">
          <img src={preview.image} alt={preview.file} className="w-full rounded-xl ring-1 ring-line" />
          <p className="text-[12px] text-ink-3">
            {lang === 'zh' ? '在图片上右键（手机上长按）即可保存。' : 'Right-click (or long-press) the image to save it.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[12px] text-ink-3">
            {lang === 'zh'
              ? '演示环境不能直接下载文件。复制下面的内容，粘贴到同名文件中保存即可。'
              : 'Downloads are disabled here. Copy the content below into a file with this name.'}
          </p>
          <textarea
            id="export-preview-text"
            readOnly
            value={preview?.text ?? ''}
            className="scroll-thin h-[46vh] w-full resize-none rounded-xl border border-line-2 bg-panel-2 p-3 font-mono text-[11.5px] leading-relaxed text-ink-2 outline-none"
          />
          <div className="flex justify-end">
            <Button variant="primary" icon={copied ? <Check size={15} /> : <Copy size={15} />} onClick={copy}>
              {copied ? '✓' : t('action.copy')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

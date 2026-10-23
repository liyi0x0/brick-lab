import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n';
import { useConfirmStore } from '../state/confirm';
import { Button } from './primitives';

export { askConfirm, askText } from '../state/confirm';

export function ConfirmDialog() {
  const t = useT();
  const req = useConfirmStore((s) => s.req);
  const [value, setValue] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!req) return;
    setValue(req.input ?? '');
    const prevFocus = document.activeElement as HTMLElement | null;
    const id = window.setTimeout(() => (req.input !== undefined ? inputRef.current?.select() : okRef.current?.focus()), 30);
    // 焦点意外落到对话框外（例如 <body>）时，Esc 仍然取消、Tab 回到对话框内
    const outside = (e: KeyboardEvent) => {
      if (boxRef.current?.contains(document.activeElement)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        useConfirmStore.setState({ req: null });
        req.resolve(req.input !== undefined ? null : false);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        boxRef.current?.querySelector<HTMLElement>('input, button')?.focus();
      }
    };
    window.addEventListener('keydown', outside, true);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('keydown', outside, true);
      prevFocus?.focus?.();
    };
  }, [req]);

  if (!req) return null;
  const close = (v: string | boolean | null) => {
    useConfirmStore.setState({ req: null });
    req.resolve(v);
  };
  const cancel = () => close(req.input !== undefined ? null : false);
  const ok = () => {
    if (req.input !== undefined) {
      const v = value.trim();
      if (!v) return;
      close(v);
    } else close(true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && e.target === inputRef.current) {
      // 只有输入框里的回车代表确认；按钮上的回车交给按钮自己（聚焦「取消」时回车就是取消）
      e.preventDefault();
      ok();
    } else if (e.key === 'Tab') {
      // 焦点限制在对话框内
      const items = [...(boxRef.current?.querySelectorAll<HTMLElement>('input, button') ?? [])];
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
      e.preventDefault();
      items[next].focus();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="alertdialog" aria-modal="true" onKeyDown={onKeyDown}>
      <div className="anim-fade absolute inset-0 bg-[var(--backdrop)] backdrop-blur-[2px]" onClick={cancel} />
      <div ref={boxRef} className="anim-pop relative w-full max-w-[400px] rounded-[20px] border border-line bg-panel-solid p-5 shadow-pop">
        <p className="text-[14px] leading-relaxed text-ink">{req.message}</p>
        {req.input !== undefined && (
          <input
            ref={inputRef}
            id="confirm-input"
            value={value}
            maxLength={60}
            onChange={(e) => setValue(e.target.value)}
            className="mt-3 h-10 w-full rounded-xl border border-line-2 bg-panel-2 px-3 text-[14px] text-ink outline-none focus:border-accent"
          />
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={cancel}>
            {t('dialog.cancel')}
          </Button>
          <button
            ref={okRef}
            type="button"
            onClick={ok}
            className={
              req.danger
                ? 'inline-flex h-9 items-center rounded-xl bg-danger px-4 text-[13px] font-medium text-white hover:brightness-110'
                : 'inline-flex h-9 items-center rounded-xl bg-accent px-4 text-[13px] font-medium text-accent-ink hover:brightness-110'
            }
          >
            {req.confirmLabel ?? t('dialog.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useT } from '../i18n';
import { Button } from './primitives';

interface Request {
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  /** 提供时显示输入框（用于重命名） */
  input?: string;
  resolve: (v: string | boolean | null) => void;
}

const useConfirmStore = create<{ req: Request | null }>(() => ({ req: null }));

function ask(req: Omit<Request, 'resolve'>): Promise<string | boolean | null> {
  return new Promise((resolve) => {
    // 同一时间只保留一个请求，旧请求视为取消
    useConfirmStore.getState().req?.resolve(req.input !== undefined ? null : false);
    useConfirmStore.setState({ req: { ...req, resolve } });
  });
}

/** 应用内确认框（替代 window.confirm，外观统一且在受限环境中可用） */
export async function askConfirm(message: string, opts: { confirmLabel?: string; danger?: boolean } = {}) {
  return (await ask({ message, ...opts })) === true;
}

/** 应用内输入框（替代 window.prompt），取消返回 null */
export async function askText(message: string, initial: string): Promise<string | null> {
  const v = await ask({ message, input: initial });
  return typeof v === 'string' ? v : null;
}

export function ConfirmDialog() {
  const t = useT();
  const req = useConfirmStore((s) => s.req);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!req) return;
    setValue(req.input ?? '');
    const id = window.setTimeout(() => (req.input !== undefined ? inputRef.current?.select() : okRef.current?.focus()), 30);
    return () => window.clearTimeout(id);
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

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') cancel();
        if (e.key === 'Enter') ok();
      }}
    >
      <div className="anim-fade absolute inset-0 bg-[var(--backdrop)] backdrop-blur-[2px]" onClick={cancel} />
      <div className="anim-pop relative w-full max-w-[400px] rounded-[20px] border border-line bg-panel-solid p-5 shadow-pop">
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

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { isConfirmOpen } from '../state/confirm';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

/** 把 "Mod+Z" 之类的快捷键描述转成当前平台的显示文本 */
export function keyLabel(k: string) {
  return k
    .replace('Mod', MOD)
    .replace('Shift', isMac ? '⇧' : 'Shift')
    .replace('Alt', isMac ? '⌥' : 'Alt')
    .replace(/\+/g, isMac ? '' : '+');
}

// ---------------------------------------------------------------------------
// 全局提示气泡：任何带 data-tip 的元素悬停时显示
// ---------------------------------------------------------------------------

interface TipState {
  text: string;
  key?: string;
  x: number;
  y: number;
  side: 'top' | 'bottom' | 'left' | 'right';
}

export function TooltipLayer() {
  const [tip, setTip] = useState<TipState | null>(null);
  const timer = useRef<number>(0);
  const current = useRef<HTMLElement | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timer.current);
      current.current = null;
      setTip(null);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (el === current.current) return;
      hide();
      if (!el || !el.dataset.tip) return;
      current.current = el;
      timer.current = window.setTimeout(() => {
        if (!el.isConnected) return;
        const r = el.getBoundingClientRect();
        const side = (el.dataset.tipSide as TipState['side']) || 'top';
        const x = side === 'left' ? r.left : side === 'right' ? r.right : r.left + r.width / 2;
        const y = side === 'top' ? r.top : side === 'bottom' ? r.bottom : r.top + r.height / 2;
        setTip({ text: el.dataset.tip!, key: el.dataset.tipKey, x, y, side });
      }, 380);
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('blur', hide);
    document.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('blur', hide);
      document.removeEventListener('scroll', hide, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tip || !ref.current) {
      setPos(null);
      return;
    }
    const r = ref.current.getBoundingClientRect();
    const gap = 8;
    let left = tip.x - r.width / 2;
    let top = tip.y - r.height - gap;
    if (tip.side === 'bottom') top = tip.y + gap;
    if (tip.side === 'left') {
      left = tip.x - r.width - gap;
      top = tip.y - r.height / 2;
    }
    if (tip.side === 'right') {
      left = tip.x + gap;
      top = tip.y - r.height / 2;
    }
    left = Math.max(8, Math.min(window.innerWidth - r.width - 8, left));
    top = Math.max(8, Math.min(window.innerHeight - r.height - 8, top));
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={ref}
      className="tip"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
      role="tooltip"
    >
      {tip.text}
      {tip.key && <kbd>{keyLabel(tip.key)}</kbd>}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// 按钮
// ---------------------------------------------------------------------------

interface IconButtonProps {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  tipSide?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'default' | 'danger';
}

export function IconButton({
  icon,
  label,
  shortcut,
  onClick,
  active,
  disabled,
  tipSide = 'bottom',
  className,
  size = 'md',
  tone = 'default',
}: IconButtonProps) {
  const sz = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-11 w-11' : 'h-9 w-9';
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      data-tip={label}
      data-tip-key={shortcut}
      data-tip-side={tipSide}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-xl transition-colors duration-150',
        sz,
        disabled
          ? 'text-ink-3 opacity-50'
          : active
            ? 'bg-accent text-accent-ink shadow-sm'
            : tone === 'danger'
              ? 'text-danger hover:bg-danger-soft'
              : 'text-ink-2 hover:bg-hover hover:text-ink active:bg-press',
        className,
      )}
    >
      {icon}
    </button>
  );
}

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  className?: string;
  disabled?: boolean;
  icon?: ReactNode;
  title?: string;
}

export function Button({ children, onClick, variant = 'secondary', className, disabled, icon, title }: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-tip={title}
      className={cx(
        'inline-flex h-9 items-center justify-center gap-2 rounded-xl px-3.5 text-[13px] font-medium transition-all duration-150 disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-accent-ink shadow-sm hover:brightness-110 active:brightness-95',
        variant === 'secondary' && 'border border-line-2 bg-panel-solid text-ink hover:bg-hover',
        variant === 'ghost' && 'text-ink-2 hover:bg-hover hover:text-ink',
        variant === 'danger' && 'bg-danger text-white hover:brightness-110',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-md border border-line-2 bg-panel-solid px-1.5 font-mono text-[11px] text-ink-2 shadow-[0_1px_0_var(--line-2)]">
      {children}
    </kbd>
  );
}

// ---------------------------------------------------------------------------
// 分段选择 / 开关
// ---------------------------------------------------------------------------

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode; tip?: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cx('inline-flex rounded-xl bg-panel-2 p-1', className)} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          data-tip={o.tip}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-7 flex-1 whitespace-nowrap rounded-lg px-3 text-[12px] font-medium transition-all',
            o.value === value ? 'bg-panel-solid text-ink shadow-sm' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200',
        checked ? 'bg-accent' : 'bg-line-2',
      )}
    >
      <span
        className={cx(
          'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200',
          checked && 'translate-x-4',
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// 对话框
// ---------------------------------------------------------------------------

export function Dialog({
  open,
  onClose,
  title,
  children,
  width = 560,
  icon,
  footer,
  bare,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  width?: number;
  icon?: ReactNode;
  footer?: ReactNode;
  bare?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // 上层还有确认框时，Esc 应该先关掉确认框
      if (e.key === 'Escape' && !isConfirmOpen()) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true">
      <div className="anim-fade absolute inset-0 bg-[var(--backdrop)] backdrop-blur-[3px]" onClick={onClose} />
      <div
        className="anim-pop relative flex max-h-[min(88vh,820px)] w-full flex-col overflow-hidden rounded-[22px] border border-line bg-panel-solid shadow-pop"
        style={{ maxWidth: width }}
      >
        {!bare && (
          <div className="flex items-center gap-3 px-5 pt-4 pb-3">
            {icon && <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">{icon}</div>}
            <h2 className="flex-1 text-[16px] font-semibold tracking-tight">{title}</h2>
            <IconButton icon={<X size={18} />} label="关闭" onClick={onClose} size="sm" />
          </div>
        )}
        <div className={cx('scroll-thin min-h-0 flex-1 overflow-y-auto', !bare && 'px-5 pb-5')}>{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// 下拉菜单
// ---------------------------------------------------------------------------

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
}

export function Menu({
  trigger,
  items,
  align = 'right',
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div
          className={cx(
            'anim-pop absolute top-full z-40 mt-2 min-w-[220px] rounded-2xl border border-line bg-panel-solid p-1.5 shadow-pop',
            align === 'right' ? 'right-0' : 'left-0',
          )}
          role="menu"
        >
          {items.map((it, i) =>
            it.divider ? (
              <div key={i} className="my-1 h-px bg-line" />
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick?.();
                }}
                className={cx(
                  'flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[13px] transition-colors disabled:opacity-40',
                  it.danger ? 'text-danger hover:bg-danger-soft' : 'text-ink hover:bg-hover',
                )}
              >
                <span className="flex w-5 justify-center text-ink-2">{it.icon}</span>
                <span className="flex-1">{it.label}</span>
                {it.shortcut && <span className="font-mono text-[11px] text-ink-3">{keyLabel(it.shortcut)}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

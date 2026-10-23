import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { useStore } from '../state/store';
import { cx } from './primitives';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[72px] z-[60] flex flex-col items-center gap-2 px-3 md:top-auto md:bottom-[124px]">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          onClick={() => dismiss(t.id)}
          className={cx(
            'anim-pop pointer-events-auto flex max-w-[min(92vw,460px)] items-center gap-2.5 rounded-2xl px-4 py-2.5 text-[13px] shadow-pop',
            'bg-[#111827]/92 text-white backdrop-blur-md dark:bg-white/95 dark:text-[#0f172a]',
          )}
        >
          {t.kind === 'success' ? (
            <CircleCheck size={16} className="shrink-0 text-emerald-400 dark:text-emerald-600" />
          ) : t.kind === 'error' ? (
            <CircleAlert size={16} className="shrink-0 text-rose-400 dark:text-rose-600" />
          ) : (
            <Info size={16} className="shrink-0 text-sky-300 dark:text-sky-600" />
          )}
          <span className="leading-snug">{t.text}</span>
        </div>
      ))}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, StepBack, StepForward, X } from 'lucide-react';
import { sound } from '../engine/sound';
import { useT } from '../i18n';
import { getEngine } from '../state/engineRef';
import { model, useStore } from '../state/store';
import { cx, IconButton } from './primitives';

const SPEEDS = [0.5, 1, 2, 4];

function Player() {
  const t = useT();
  const setUI = useStore((s) => s.setUI);
  // 按「层」搭建：先按高度，再按放置顺序
  const order = useMemo(() => model.list().sort((a, b) => a.y - b.y || a.id - b.id).map((b) => b.id), []);
  const n = order.length;
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const prev = useRef(0);

  const exit = () => setUI({ playback: false });

  useEffect(() => {
    const e = getEngine();
    e?.setPlayback(order, 0);
    e?.frame();
    // 作品被修改时退出回放
    const unsub = model.subscribe(() => useStore.getState().setUI({ playback: false }));
    return () => {
      unsub();
      getEngine()?.setPlayback(null);
    };
  }, [order]);

  useEffect(() => {
    const forward = step > prev.current;
    getEngine()?.setPlayback(order, step, forward && step - prev.current === 1);
    if (forward && step - prev.current === 1 && speed <= 2) sound.play('place');
    prev.current = step;
  }, [step, order, speed]);

  useEffect(() => {
    if (!playing) return;
    if (step >= n) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => setStep((s) => Math.min(n, s + 1)), (step === 0 ? 500 : 420) / speed);
    return () => window.clearTimeout(id);
  }, [playing, step, speed, n]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useStore.getState().ui.dialog) return;
      switch (e.key) {
        case ' ':
          setPlaying((p) => (step >= n ? (setStep(0), true) : !p));
          break;
        case 'ArrowRight':
          setPlaying(false);
          setStep((s) => Math.min(n, s + 1));
          break;
        case 'ArrowLeft':
          setPlaying(false);
          setStep((s) => Math.max(0, s - 1));
          break;
        case 'Home':
          setStep(0);
          break;
        case 'End':
          setStep(n);
          break;
        case 'Escape':
          exit();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const go = (s: number) => {
    setPlaying(false);
    setStep(Math.max(0, Math.min(n, s)));
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-2">
      <div className="glass anim-up pointer-events-auto flex w-full max-w-[640px] flex-col gap-2 rounded-[22px] px-4 pt-3 pb-2.5">
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-semibold">{t('playback.title')}</span>
          <span className="text-[12px] text-ink-3 tabular-nums">{t('playback.step', { i: step, n })}</span>
          <div className="flex-1" />
          <div className="flex rounded-lg bg-panel-2 p-0.5">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={cx(
                  'h-6 rounded-md px-2 font-mono text-[11px] transition-colors',
                  speed === s ? 'bg-panel-solid text-ink shadow-sm' : 'text-ink-3 hover:text-ink',
                )}
              >
                {s}×
              </button>
            ))}
          </div>
          <IconButton icon={<X size={16} />} label={t('playback.exit')} shortcut="Esc" size="sm" tipSide="top" onClick={exit} />
        </div>
        <input
          type="range"
          min={0}
          max={n}
          value={step}
          onChange={(e) => go(Number(e.target.value))}
          className="w-full"
          aria-label={t('playback.step', { i: step, n })}
        />
        <div className="flex items-center justify-center gap-1">
          <IconButton icon={<SkipBack size={17} />} label="Home" size="sm" tipSide="top" onClick={() => go(0)} />
          <IconButton icon={<StepBack size={17} />} label={t('playback.prev')} shortcut="←" size="sm" tipSide="top" onClick={() => go(step - 1)} />
          <button
            type="button"
            onClick={() => {
              if (step >= n) {
                setStep(0);
                setPlaying(true);
              } else setPlaying((p) => !p);
            }}
            className="mx-2 flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-ink shadow-[0_8px_20px_-8px_var(--accent)] transition-transform hover:scale-105 active:scale-95"
            aria-label={playing ? t('playback.pause') : t('playback.play')}
            data-tip={playing ? t('playback.pause') : t('playback.play')}
            data-tip-key="Space"
          >
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
          </button>
          <IconButton icon={<StepForward size={17} />} label={t('playback.next')} shortcut="→" size="sm" tipSide="top" onClick={() => go(step + 1)} />
          <IconButton icon={<SkipForward size={17} />} label="End" size="sm" tipSide="top" onClick={() => go(n)} />
        </div>
      </div>
    </div>
  );
}

export function PlaybackBar() {
  const playback = useStore((s) => s.ui.playback);
  return playback ? <Player /> : null;
}

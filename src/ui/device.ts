import { useSyncExternalStore } from 'react';

const query = typeof window !== 'undefined' ? window.matchMedia('(pointer: coarse)') : null;

/** 主要输入设备是否为触屏（手机、平板） */
export function isTouchDevice(): boolean {
  return !!query?.matches;
}

/** React hook：触屏设备返回 true，接入 / 拔出鼠标时自动更新 */
export function useTouchDevice(): boolean {
  return useSyncExternalStore(
    (cb) => {
      query?.addEventListener('change', cb);
      return () => query?.removeEventListener('change', cb);
    },
    isTouchDevice,
    () => false,
  );
}

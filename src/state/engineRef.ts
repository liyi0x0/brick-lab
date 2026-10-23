import type { Engine } from '../engine/Engine';

let current: Engine | null = null;

export function getEngine(): Engine | null {
  return current;
}

export function setEngine(e: Engine | null) {
  current = e;
}

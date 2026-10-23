import { useEffect, useRef } from 'react';
import { Engine } from '../engine/Engine';
import { setEngine } from '../state/engineRef';
import { model, useStore } from '../state/store';

export function Viewport() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const engine = new Engine(ref.current!);
    setEngine(engine);
    Object.assign(window as object, { __engine: engine, __model: model, __store: useStore });
    return () => {
      setEngine(null);
      engine.dispose();
    };
  }, []);
  return <div ref={ref} className="absolute inset-0" />;
}

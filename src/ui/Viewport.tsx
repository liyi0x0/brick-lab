import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Engine } from '../engine/Engine';
import { setEngine } from '../state/engineRef';
import * as actions from '../state/actions';
import { model, useStore } from '../state/store';

export function Viewport() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const engine = new Engine(ref.current!);
    setEngine(engine);
    // 调试与端到端测试用的句柄
    Object.assign(window as object, {
      __engine: engine,
      __model: model,
      __store: useStore,
      __actions: actions,
      __project: (x: number, y: number, z: number) => engine.project(new THREE.Vector3(x, y, z)),
    });
    return () => {
      setEngine(null);
      engine.dispose();
    };
  }, []);
  return <div ref={ref} className="absolute inset-0" />;
}

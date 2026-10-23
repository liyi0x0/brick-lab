import * as THREE from 'three';
import { getColor } from '../core/colors';
import { PLATE_H } from '../core/constants';
import { getPart, rotatedSize } from '../core/parts';
import {
  computeGroupPlacement,
  computePlacement,
  groupFits,
  type PickHit,
  type PlacementContext,
} from '../core/placement';
import type { Brick, BrickData } from '../core/types';
import { tr } from '../i18n';
import { selectConnected } from '../state/actions';
import { model, useStore } from '../state/store';
import type { Engine } from './Engine';
import { sound } from './sound';

const DRAG_PX = 5;

type DownMode = 'pending' | 'pending-move' | 'pending-marquee' | 'orbit' | 'move' | 'marquee';

interface DownState {
  x: number;
  y: number;
  button: number;
  pointerId: number;
  shift: boolean;
  hit: PickHit | null;
  mode: DownMode;
}

interface MoveState {
  ids: number[];
  ignore: Set<number>;
  anchor: Brick;
  bricks: Brick[];
  offset: [number, number, number];
  valid: boolean;
}

/** 指针交互：悬停预览、点击放置/选择/上色/拆除、拖动积木、框选、粘贴 */
export class Interaction {
  hoverBrick: number | null = null;
  eraseIntent = false;
  private pointer = { x: 0, y: 0, inside: false, type: 'mouse' };
  private down: DownState | null = null;
  private pointers = new Set<number>();
  private move: MoveState | null = null;
  private marquee: HTMLDivElement;
  private paintPreview: number | null = null;
  private clipRef: BrickData[] | null = null;
  private clipKey = 0;
  private el: HTMLCanvasElement;
  private longPress = 0;
  private lastClick = { time: 0, id: -1 };

  constructor(private engine: Engine) {
    this.el = engine.renderer.domElement;
    this.el.addEventListener('pointerdown', this.onDown);
    this.el.addEventListener('pointermove', this.onMove);
    this.el.addEventListener('pointerup', this.onUp);
    this.el.addEventListener('pointercancel', this.onCancel);
    this.el.addEventListener('pointerleave', this.onLeave);
    this.el.addEventListener('contextmenu', this.onContext);
    this.marquee = document.createElement('div');
    this.marquee.className = 'marquee';
    this.marquee.style.display = 'none';
    engine.container.appendChild(this.marquee);
  }

  dispose() {
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('pointercancel', this.onCancel);
    this.el.removeEventListener('pointerleave', this.onLeave);
    this.el.removeEventListener('contextmenu', this.onContext);
    this.marquee.remove();
  }

  private get ctx(): PlacementContext {
    return {
      grid: model.grid,
      getBrick: (id) => model.get(id),
      groundHalf: this.engine.baseplate.half,
    };
  }

  // -------------------------------------------------------------------------
  // 指针事件
  // -------------------------------------------------------------------------

  private onContext = (e: Event) => e.preventDefault();

  private onDown = (e: PointerEvent) => {
    this.pointers.add(e.pointerId);
    this.pointer = { x: e.clientX, y: e.clientY, inside: true, type: e.pointerType };
    this.engine.cancelTween();
    if (this.pointers.size > 1) {
      // 多指手势：交给相机控制
      this.abortGesture();
      return;
    }
    if (e.button === 1) return;
    const s = useStore.getState();
    const hit = this.engine.isPlayback ? null : this.engine.pick(e.clientX, e.clientY);
    const d: DownState = {
      x: e.clientX,
      y: e.clientY,
      button: e.button,
      pointerId: e.pointerId,
      shift: e.shiftKey,
      hit,
      mode: 'pending',
    };
    this.down = d;
    if (this.engine.isPlayback) return;
    // 触屏长按：在搭建 / 上色模式下拆除积木（触屏没有右键）
    window.clearTimeout(this.longPress);
    if (e.pointerType !== 'mouse' && hit && hit.brickId !== null && (s.tool === 'build' || s.tool === 'paint') && !s.pasting) {
      const id = hit.brickId;
      this.longPress = window.setTimeout(() => {
        if (this.down !== d || d.mode !== 'pending') return;
        d.mode = 'orbit'; // 消耗掉这次手势，松手时不再放置
        navigator.vibrate?.(12);
        this.erase([id]);
      }, 520);
    }
    if (e.button === 0 && !e.altKey && s.tool === 'select' && !s.pasting) {
      if (hit && hit.brickId !== null) d.mode = 'pending-move';
      else if (e.shiftKey) d.mode = 'pending-marquee';
      if (d.mode !== 'pending') {
        this.engine.controls.enabled = false;
        this.el.setPointerCapture(e.pointerId);
      }
    }
    if (e.button === 2 && s.tool === 'build' && hit && hit.brickId !== null) {
      this.eraseIntent = true;
      this.engine.ghost.hide();
      this.setHover(hit.brickId);
    }
  };

  private onMove = (e: PointerEvent) => {
    this.pointer = { x: e.clientX, y: e.clientY, inside: true, type: e.pointerType };
    const d = this.down;
    if (d && d.pointerId === e.pointerId) {
      const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      if (dist > DRAG_PX) {
        if (d.mode === 'pending-move') this.startMove(d);
        else if (d.mode === 'pending-marquee') d.mode = 'marquee';
        else if (d.mode === 'pending') {
          d.mode = 'orbit';
          this.eraseIntent = false;
          this.engine.ghost.hide();
          this.setHover(null);
        }
      }
      if (d.mode === 'move') this.updateMove(e.clientX, e.clientY);
      else if (d.mode === 'marquee') this.updateMarquee(d, e.clientX, e.clientY);
      return;
    }
    if (!this.down) this.updateHover();
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    window.clearTimeout(this.longPress);
    const d = this.down;
    if (!d || d.pointerId !== e.pointerId) return;
    this.down = null;
    this.engine.controls.enabled = true;
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_PX;
    if (d.mode === 'move') this.commitMove();
    else if (d.mode === 'marquee') this.finishMarquee(d, e.clientX, e.clientY);
    else if (d.mode !== 'orbit' && !moved) this.click(e, d);
    this.eraseIntent = false;
    if (e.pointerType === 'mouse') this.updateHover();
    else {
      this.engine.ghost.hide();
      this.setHover(null);
    }
  };

  private onCancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    this.abortGesture();
  };

  private onLeave = () => {
    this.pointer.inside = false;
    if (this.down) return;
    this.engine.ghost.hide();
    this.setHover(null);
    useStore.setState({ hover: null });
    this.engine.invalidate();
  };

  /** 相机开始被拖动（含滚轮） */
  onCameraStart() {
    /* 由 onMove 判断拖动阈值后处理 */
  }

  private abortGesture() {
    if (this.move) this.cancelMove();
    this.marquee.style.display = 'none';
    this.down = null;
    this.eraseIntent = false;
    this.engine.controls.enabled = true;
  }

  // -------------------------------------------------------------------------
  // 悬停
  // -------------------------------------------------------------------------

  /** 重新计算当前指针位置的预览（工具 / 零件 / 模型变化后调用） */
  refresh() {
    if (this.down) return;
    if (!this.pointer.inside || this.pointer.type !== 'mouse') {
      this.engine.ghost.hide();
      this.setHover(null);
      this.engine.invalidate();
      return;
    }
    this.updateHover();
  }

  private setHover(id: number | null) {
    const s = useStore.getState();
    // 上色工具：悬停时直接预览新颜色
    const previewId = s.tool === 'paint' && !s.pasting ? id : null;
    if (this.paintPreview !== null && this.paintPreview !== previewId) {
      this.engine.bricks.previewColor(this.paintPreview, null);
    }
    if (previewId !== null) this.engine.bricks.previewColor(previewId, s.colorId);
    this.paintPreview = previewId;
    if (id !== this.hoverBrick) {
      this.hoverBrick = id;
      this.engine.updateHighlights();
    }
  }

  private updateHover() {
    const s = useStore.getState();
    const eng = this.engine;
    if (eng.isPlayback) {
      eng.ghost.hide();
      this.setHover(null);
      return;
    }
    const hit = eng.pick(this.pointer.x, this.pointer.y);
    if (s.pasting && s.clipboard && s.clipboard.length) {
      this.setHover(null);
      this.ensureClipGhost(s.clipboard);
      if (!hit) {
        eng.ghost.hide();
        useStore.setState({ hover: null });
        return;
      }
      const r = computeGroupPlacement(this.ctx, s.clipboard, hit);
      eng.ghost.showGroup(r.dx, r.dy, r.dz, r.valid);
      this.publishHover(null, r.dx, r.dy, r.dz, r.valid);
      eng.invalidate();
      return;
    }
    if (s.tool === 'build') {
      this.setHover(null);
      if (!hit) {
        eng.ghost.hide();
        useStore.setState({ hover: null });
        eng.invalidate();
        return;
      }
      const p = computePlacement(this.ctx, s.partId, s.rot, hit);
      eng.ghost.showSingle({ part: s.partId, color: s.colorId, x: p.x, y: p.y, z: p.z, rot: s.rot }, p.valid);
      this.publishHover(null, p.x, p.y, p.z, p.valid);
      eng.invalidate();
      return;
    }
    eng.ghost.hide();
    const id = hit?.brickId ?? null;
    this.setHover(id);
    if (id !== null) {
      const b = model.get(id)!;
      this.publishHover(id, b.x, b.y, b.z, true);
    } else {
      useStore.setState({ hover: null });
    }
    eng.invalidate();
  }

  private publishHover(brickId: number | null, x: number, y: number, z: number, valid: boolean) {
    const h = useStore.getState().hover;
    if (h && h.brickId === brickId && h.x === x && h.y === y && h.z === z && h.valid === valid) return;
    useStore.setState({ hover: { brickId, x, y, z, valid } });
  }

  private ensureClipGhost(clip: BrickData[]) {
    if (clip !== this.clipRef) {
      this.clipRef = clip;
      this.clipKey++;
    }
    this.engine.ghost.setGroup(clip, `clip:${this.clipKey}`);
  }

  // -------------------------------------------------------------------------
  // 点击
  // -------------------------------------------------------------------------

  private click(e: PointerEvent, d: DownState) {
    const s = useStore.getState();
    if (this.engine.isPlayback) return;
    const hit = this.engine.pick(e.clientX, e.clientY);
    if (d.button === 2) {
      if (s.tool === 'build' && !s.pasting && hit && hit.brickId !== null && hit.brickId === d.hit?.brickId) {
        this.erase([hit.brickId]);
      }
      return;
    }
    if (d.button !== 0) return;
    if (e.altKey) {
      if (hit && hit.brickId !== null) this.eyedropper(hit.brickId);
      return;
    }
    if (s.pasting) {
      this.placePaste(hit);
      return;
    }
    switch (s.tool) {
      case 'build':
        this.placeBrick(hit);
        break;
      case 'select':
        this.selectClick(hit, e.shiftKey || e.metaKey || e.ctrlKey);
        break;
      case 'paint':
        this.paint(hit);
        break;
      case 'erase':
        if (hit && hit.brickId !== null) this.erase([hit.brickId]);
        break;
    }
  }

  private placeBrick(hit: PickHit | null) {
    if (!hit) return;
    const s = useStore.getState();
    const p = computePlacement(this.ctx, s.partId, s.rot, hit);
    if (!p.valid) {
      sound.play('error');
      return;
    }
    const added = model.addBricks([{ part: s.partId, color: s.colorId, x: p.x, y: p.y, z: p.z, rot: s.rot }], 'place');
    sound.play(added ? 'place' : 'error');
  }

  private placePaste(hit: PickHit | null) {
    const s = useStore.getState();
    if (!hit || !s.clipboard) return;
    const r = computeGroupPlacement(this.ctx, s.clipboard, hit);
    if (!r.valid) {
      sound.play('error');
      return;
    }
    const added = model.addBricks(
      s.clipboard.map((b) => ({ ...b, x: b.x + r.dx, y: b.y + r.dy, z: b.z + r.dz })),
      'paste',
    );
    sound.play(added ? 'place' : 'error');
    if (added) useStore.getState().setSelection(added.map((b) => b.id));
  }

  private selectClick(hit: PickHit | null, additive: boolean) {
    const st = useStore.getState();
    if (!hit || hit.brickId === null) {
      if (!additive && st.selection.length) st.setSelection([]);
      return;
    }
    const id = hit.brickId;
    // 双击：选择相连的整组积木
    const now = performance.now();
    if (!additive && this.lastClick.id === id && now - this.lastClick.time < 360) {
      this.lastClick = { time: 0, id: -1 };
      selectConnected(id);
      return;
    }
    this.lastClick = { time: now, id };
    if (additive) {
      st.setSelection(st.selection.includes(id) ? st.selection.filter((x) => x !== id) : [...st.selection, id]);
    } else {
      st.setSelection([id]);
    }
    sound.play('select');
  }

  private paint(hit: PickHit | null) {
    if (!hit || hit.brickId === null) return;
    const s = useStore.getState();
    const b = model.get(hit.brickId);
    if (!b || b.color === s.colorId) return;
    this.engine.bricks.previewColor(b.id, null);
    this.paintPreview = null;
    if (model.updateBricks([{ ...b, color: s.colorId }], 'paint')) sound.play('paint');
  }

  private erase(ids: number[]) {
    if (model.removeBricks(ids, 'erase')) sound.play('remove');
  }

  private eyedropper(id: number) {
    const b = model.get(id);
    if (!b) return;
    const st = useStore.getState();
    st.setColor(b.color);
    const lang = st.settings.lang;
    const c = getColor(b.color);
    if (st.tool === 'build') {
      st.setPart(b.part);
      st.setRot(b.rot);
      const p = getPart(b.part);
      st.toast(tr(lang, 'toast.picked', { name: `${lang === 'zh' ? c.zh : c.en} · ${p.name[lang]}` }));
    } else {
      st.toast(tr(lang, 'toast.picked', { name: lang === 'zh' ? c.zh : c.en }));
    }
    sound.play('select');
  }

  // -------------------------------------------------------------------------
  // 拖动移动
  // -------------------------------------------------------------------------

  private startMove(d: DownState) {
    const st = useStore.getState();
    const id = d.hit?.brickId;
    if (id == null) return;
    let sel = st.selection;
    if (!sel.includes(id)) sel = d.shift ? [...sel, id] : [id];
    st.setSelection(sel);
    const bricks = sel.map((i) => model.get(i)).filter((b): b is Brick => !!b);
    const anchor = model.get(id)!;
    this.move = { ids: sel, ignore: new Set(sel), anchor, bricks, offset: [0, 0, 0], valid: true };
    for (const i of sel) this.engine.bricks.setHidden(i, true);
    this.engine.ghost.setGroup(bricks, `move:${sel.join(',')}:${model.version}`);
    this.engine.ghost.showGroup(0, 0, 0, true);
    this.engine.hideSelectionBox = true;
    this.engine.updateSelectionBox();
    this.setHover(null);
    d.mode = 'move';
    this.engine.invalidateShadows();
  }

  private updateMove(cx: number, cy: number) {
    const mv = this.move;
    if (!mv) return;
    const hit = this.engine.pick(cx, cy, mv.ignore);
    if (!hit) return;
    const ctx = { ...this.ctx, ignore: mv.ignore };
    const p = computePlacement(ctx, mv.anchor.part, mv.anchor.rot, hit);
    const dx = p.x - mv.anchor.x;
    let dy = p.y - mv.anchor.y;
    const dz = p.z - mv.anchor.z;
    let valid = groupFits(model.grid, mv.bricks, dx, dy, dz, mv.ignore);
    if (!valid && hit.normal[1] === 1) {
      for (let k = 1; k <= 96; k++) {
        if (groupFits(model.grid, mv.bricks, dx, dy + k, dz, mv.ignore)) {
          dy += k;
          valid = true;
          break;
        }
      }
    }
    mv.offset = [dx, dy, dz];
    mv.valid = valid;
    this.engine.ghost.showGroup(dx, dy, dz, valid);
    this.engine.invalidate();
  }

  private commitMove() {
    const mv = this.move;
    if (!mv) return;
    this.move = null;
    for (const i of mv.ids) this.engine.bricks.setHidden(i, false);
    this.engine.ghost.clearGroup();
    this.engine.hideSelectionBox = false;
    this.engine.updateSelectionBox();
    const [dx, dy, dz] = mv.offset;
    if (dx === 0 && dy === 0 && dz === 0) {
      this.engine.invalidateShadows();
      return;
    }
    if (!mv.valid) {
      sound.play('error');
      this.engine.invalidateShadows();
      return;
    }
    const ok = model.updateBricks(
      mv.bricks.map((b) => ({ ...b, x: b.x + dx, y: b.y + dy, z: b.z + dz })),
      'move',
    );
    sound.play(ok ? 'place' : 'error');
  }

  private cancelMove() {
    const mv = this.move;
    if (!mv) return;
    this.move = null;
    for (const i of mv.ids) this.engine.bricks.setHidden(i, false);
    this.engine.ghost.clearGroup();
    this.engine.hideSelectionBox = false;
    this.engine.updateSelectionBox();
    this.engine.invalidateShadows();
  }

  /** Esc：取消正在进行的拖动 */
  cancel(): boolean {
    if (this.move) {
      this.cancelMove();
      this.down = null;
      this.engine.controls.enabled = true;
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // 框选
  // -------------------------------------------------------------------------

  private updateMarquee(d: DownState, x: number, y: number) {
    const rect = this.engine.container.getBoundingClientRect();
    const x0 = Math.min(d.x, x) - rect.left;
    const y0 = Math.min(d.y, y) - rect.top;
    Object.assign(this.marquee.style, {
      display: 'block',
      left: `${x0}px`,
      top: `${y0}px`,
      width: `${Math.abs(x - d.x)}px`,
      height: `${Math.abs(y - d.y)}px`,
    });
  }

  private finishMarquee(d: DownState, x: number, y: number) {
    this.marquee.style.display = 'none';
    const x0 = Math.min(d.x, x),
      x1 = Math.max(d.x, x),
      y0 = Math.min(d.y, y),
      y1 = Math.max(d.y, y);
    const st = useStore.getState();
    const picked = new Set(d.shift ? st.selection : []);
    const v = new THREE.Vector3();
    for (const b of model.bricks.values()) {
      const part = getPart(b.part);
      const [fw, fd] = rotatedSize(part, b.rot);
      v.set(b.x + fw / 2, (b.y + part.h / 2) * PLATE_H, b.z + fd / 2);
      const p = this.engine.project(v);
      if (p.visible && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) picked.add(b.id);
    }
    st.setSelection([...picked]);
    if (picked.size) sound.play('select');
  }
}

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { N8AOPass } from 'n8ao';
import { PLATE_H } from '../core/constants';
import type { ModelEvent } from '../core/model';
import { pickGrid, type PickHit } from '../core/placement';
import { model, useStore, type AppState, type Quality } from '../state/store';
import { Animator } from './animator';
import { Baseplate } from './baseplate';
import { brickMatrix, BrickRenderer } from './bricks';
import { Ghost } from './ghost';
import { Interaction } from './interaction';
import { BrickMaterials } from './materials';
import { SelectionOutline } from './outline';
import { SelectionBox } from './selectionBox';
import { sound } from './sound';

export type ViewPreset = 'home' | 'top' | 'front' | 'right' | 'back' | 'left';

/** 高亮颜色（线性 RGB + 强度） */
export const TINT = {
  select: [0.6, 0.75, 1.0, 0.3] as const,
  selectHover: [0.7, 0.85, 1.0, 0.65] as const,
  hover: [1, 1, 1, 0.7] as const,
  erase: [1.0, 0.12, 0.08, 1.85] as const,
  paint: [1, 1, 1, 0.5] as const,
  step: [1.0, 0.8, 0.25, 0.9] as const,
};

interface CameraTween {
  fromPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toPos: THREE.Vector3;
  toTarget: THREE.Vector3;
  start: number;
  dur: number;
}

// 主光来自默认视角的左上方，让阴影落向画面右后方，增强立体感
const LIGHT_DIR = new THREE.Vector3(-0.52, 1.43, 0.85).normalize();

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly materials = new BrickMaterials();
  readonly bricks: BrickRenderer;
  readonly baseplate: Baseplate;
  readonly ghost = new Ghost();
  readonly selectionBox = new SelectionBox();
  readonly outline = new SelectionOutline();
  /** 拖动积木时隐藏选区框 */
  hideSelectionBox = false;
  readonly animator: Animator;
  readonly interaction: Interaction;
  readonly container: HTMLElement;
  private sun: THREE.DirectionalLight;
  private raycaster = new THREE.Raycaster();
  private needsRender = true;
  private raf = 0;
  private last = performance.now();
  private tween: CameraTween | null = null;
  private unsubs: (() => void)[] = [];
  private resizeObs: ResizeObserver;
  private shadowKey = '';
  /** 回放模式下被隐藏的积木 */
  private hiddenIds = new Set<number>();
  private stepHighlight: number | null = null;
  private envTexture: THREE.Texture;
  /** 被界面面板遮挡的左右宽度（像素），用于把画面中心移到可见区域中央 */
  private insetLeft = 0;
  private insetRight = 0;
  private composer: EffectComposer | null = null;
  private aoPass: N8AOPass | null = null;
  private bgTexture: THREE.CanvasTexture | null = null;
  private darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  dark = false;

  constructor(container: HTMLElement) {
    this.container = container;
    const r = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    r.setClearColor(0x000000, 0);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false;
    r.domElement.classList.add('viewport-canvas');
    container.appendChild(r.domElement);
    this.renderer = r;

    // 相机
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 3000);

    // 环境光照：程序化的摄影棚环境贴图，让塑料呈现柔和反射
    const pmrem = new THREE.PMREMGenerator(r);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.5;

    const hemi = new THREE.HemisphereLight(0xf2f6ff, 0xb9a98f, 0.4);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight(0xfff6ea, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 5;
    this.scene.add(this.sun, this.sun.target);

    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.55);
    fill.position.set(34, 16, -10);
    this.scene.add(fill);

    // 场景内容
    const s = useStore.getState();
    this.baseplate = new Baseplate(s.project.baseplateSize, s.project.baseplateColor);
    this.scene.add(this.baseplate.group);
    this.bricks = new BrickRenderer(this.materials);
    this.scene.add(this.bricks.group);
    this.animator = new Animator(this.bricks);
    this.scene.add(this.animator.group);
    this.scene.add(this.ghost.group);
    this.scene.add(this.selectionBox.object);
    this.scene.add(this.outline.group);

    // 交互监听必须先于 OrbitControls 注册，以便在拖动积木时禁用相机
    this.interaction = new Interaction(this);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 400;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.rotateSpeed = 0.8;
    this.controls.zoomSpeed = 1.1;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('change', () => this.invalidate());
    this.controls.addEventListener('start', () => this.interaction.onCameraStart());

    this.setView('home', false);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();

    this.unsubs.push(model.subscribe((e) => this.onModelEvent(e)));
    this.unsubs.push(useStore.subscribe((st, prev) => this.onStoreChange(st, prev)));
    this.applyTheme();
    this.darkQuery.addEventListener('change', this.applyTheme);
    this.applyQuality(s.settings.quality);
    sound.enabled = s.settings.sound;
    this.syncAll();
    this.raf = requestAnimationFrame(this.loop);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.unsubs.forEach((u) => u());
    this.resizeObs.disconnect();
    this.darkQuery.removeEventListener('change', this.applyTheme);
    this.disposeComposer();
    this.bgTexture?.dispose();
    this.interaction.dispose();
    this.controls.dispose();
    this.bricks.clear();
    this.materials.dispose();
    this.envTexture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  invalidate() {
    this.needsRender = true;
  }

  /** 需要重新渲染阴影贴图（积木变化时） */
  invalidateShadows() {
    this.renderer.shadowMap.needsUpdate = true;
    this.needsRender = true;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    let dirty = this.needsRender;
    if (this.tween) {
      this.updateTween(now);
      dirty = true;
    }
    if (this.controls.update(dt)) dirty = true;
    if (this.animator.active) {
      this.animator.update(now);
      this.renderer.shadowMap.needsUpdate = true;
      dirty = true;
    }
    if (this.ghost.visible) {
      this.ghost.update(dt);
      dirty = true;
    }
    if (dirty) {
      this.needsRender = false;
      this.renderFrame();
    }
  };

  private renderFrame() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.selectionBox.setResolution(w, h);
    this.outline.setProjection(this.camera.fov, h);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
    this.camera.aspect = w / h;
    this.applyViewOffset();
    this.invalidate();
  }

  setViewInset(left: number, right: number) {
    if (left === this.insetLeft && right === this.insetRight) return;
    this.insetLeft = left;
    this.insetRight = right;
    this.applyViewOffset();
    this.invalidate();
  }

  private applyViewOffset() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const dx = (this.insetLeft - this.insetRight) / 2;
    if (Math.abs(dx) < 1 || w < 768) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, -dx, 0, w, h);
    this.camera.updateProjectionMatrix();
  }

  /** 背景渐变与地面阴影随主题变化 */
  applyTheme = () => {
    const theme = useStore.getState().settings.theme;
    const dark = theme === 'dark' || (theme === 'system' && this.darkQuery.matches);
    this.dark = dark;
    const [top, bottom] = this.backgroundColors();
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 512;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.bgTexture?.dispose();
    this.bgTexture = tex;
    this.scene.background = tex;
    (this.baseplate.ground.material as THREE.ShadowMaterial).opacity = dark ? 0.35 : 0.16;
    this.selectionBox.setColor(dark ? '#6f9bff' : '#2f6bff');
    this.outline.setColor(dark ? '#6f9bff' : '#2f6bff');
    this.invalidate();
  };

  backgroundColors(): [string, string] {
    return this.dark ? ['#222a38', '#0f131b'] : ['#f6f8fc', '#d9e0ea'];
  }

  private setupComposer(enabled: boolean) {
    if (!enabled) {
      this.disposeComposer();
      return;
    }
    if (this.composer) return;
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    const composer = new EffectComposer(r, rt);
    const ao = new N8AOPass(this.scene, this.camera, size.x, size.y);
    ao.configuration.gammaCorrection = false;
    ao.configuration.aoRadius = 0.55;
    ao.configuration.distanceFalloff = 1.2;
    ao.configuration.intensity = 2.4;
    ao.configuration.color = new THREE.Color(0x0a0d14);
    ao.setQualityMode('Medium');
    ao.configuration.halfRes = r.getPixelRatio() > 1.5;
    composer.addPass(ao);
    composer.addPass(new OutputPass());
    composer.addPass(new SMAAPass());
    composer.setPixelRatio(r.getPixelRatio());
    composer.setSize(size.x, size.y);
    this.composer = composer;
    this.aoPass = ao;
  }

  private disposeComposer() {
    if (!this.composer) return;
    this.aoPass?.dispose();
    this.composer.dispose();
    this.composer = null;
    this.aoPass = null;
  }

  applyQuality(q: Quality) {
    const dpr = window.devicePixelRatio || 1;
    const ratio = q === 'high' ? Math.min(dpr, 2) : q === 'medium' ? Math.min(dpr, 1.5) : 1;
    this.renderer.setPixelRatio(ratio);
    const shadows = q !== 'low';
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    const size = q === 'high' ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    // 切换阴影开关需要重新编译材质
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else if (m) m.needsUpdate = true;
    });
    this.disposeComposer();
    this.setupComposer(q === 'high');
    this.resize();
    this.invalidateShadows();
  }

  // -------------------------------------------------------------------------
  // 与模型 / 状态同步
  // -------------------------------------------------------------------------

  private syncAll() {
    this.bricks.clear();
    for (const b of model.bricks.values()) this.bricks.add(b);
    for (const id of this.hiddenIds) this.bricks.setHidden(id, true);
    this.updateShadowBounds();
    this.updateHighlights();
    this.invalidateShadows();
  }

  private onModelEvent(e: ModelEvent) {
    if (e.type === 'reset') {
      this.hiddenIds.clear();
      this.syncAll();
      this.interaction.refresh();
      return;
    }
    const now = performance.now();
    const { patch, reason } = e;
    const addedIds = new Set(patch.add.map((b) => b.id));
    const removedOnly = patch.remove.filter((b) => !addedIds.has(b.id));
    const animate = patch.add.length + removedOnly.length <= 400;
    for (const r of patch.remove) {
      this.animator.cancel(r.id);
      this.bricks.remove(r.id);
    }
    if (animate && removedOnly.length <= 80) {
      for (const r of removedOnly) this.animator.vanish(r, now);
    }
    const updated = new Set(patch.remove.map((b) => b.id));
    patch.add.forEach((b, i) => {
      this.bricks.add(b);
      if (this.hiddenIds.has(b.id)) this.bricks.setHidden(b.id, true);
      const isNew = !updated.has(b.id);
      if (animate && isNew && reason !== 'load') {
        const stagger = patch.add.length > 1 ? Math.min(i * 12, 500) : 0;
        this.animator.drop(b.id, now, stagger, reason === 'place' ? 0.9 : 0.5);
      }
    });
    this.updateShadowBounds();
    this.updateHighlights();
    this.invalidateShadows();
    this.interaction.refresh();
  }

  private onStoreChange(s: AppState, p: AppState) {
    if (s.project.baseplateSize !== p.project.baseplateSize) {
      this.baseplate.setSize(s.project.baseplateSize);
      this.updateShadowBounds();
      this.invalidateShadows();
    }
    if (s.project.baseplateColor !== p.project.baseplateColor) {
      this.baseplate.setColor(s.project.baseplateColor);
      this.invalidate();
    }
    if (s.settings.quality !== p.settings.quality) this.applyQuality(s.settings.quality);
    if (s.settings.sound !== p.settings.sound) sound.enabled = s.settings.sound;
    if (s.settings.theme !== p.settings.theme) this.applyTheme();
    if (s.selection !== p.selection) this.updateHighlights();
    if (
      s.tool !== p.tool ||
      s.partId !== p.partId ||
      s.colorId !== p.colorId ||
      s.rot !== p.rot ||
      s.pasting !== p.pasting ||
      s.clipboard !== p.clipboard
    ) {
      this.interaction.refresh();
    }
  }

  /** 根据选择 / 悬停 / 工具计算每块积木的高亮 */
  updateHighlights() {
    const s = useStore.getState();
    const next = new Map<number, readonly number[]>();
    for (const id of s.selection) next.set(id, TINT.select);
    if (this.stepHighlight !== null) next.set(this.stepHighlight, TINT.step);
    const h = this.interaction.hoverBrick;
    if (h !== null && !s.pasting) {
      if (s.tool === 'erase' || this.interaction.eraseIntent) next.set(h, TINT.erase);
      else if (s.tool === 'select') next.set(h, next.has(h) ? TINT.selectHover : TINT.hover);
      else if (s.tool === 'paint') next.set(h, TINT.paint);
    }
    this.bricks.applyTints(next);
    this.updateSelectionBox();
    this.invalidate();
  }

  /** 选区的描边与折角框 */
  updateSelectionBox() {
    const ids = useStore.getState().selection;
    if (!ids.length || this.hideSelectionBox || this.isPlayback) {
      this.selectionBox.update(null);
      this.outline.update([]);
      return;
    }
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    const m = new THREE.Matrix4();
    const bricks = [];
    for (const id of ids) {
      const b = model.get(id);
      if (!b) continue;
      bricks.push(b);
      const bb = this.bricks.geometryBox(b.part);
      if (bb) box.union(tmp.copy(bb).applyMatrix4(brickMatrix(b, m)));
    }
    this.outline.update(bricks);
    this.selectionBox.update(box.isEmpty() ? null : box.expandByScalar(0.09));
  }

  private updateShadowBounds() {
    const half = this.baseplate.half;
    const b = model.grid.bounds;
    let x0 = -half,
      x1 = half,
      z0 = -half,
      z1 = half,
      y1 = 1;
    if (b && model.count > 0) {
      x0 = Math.min(x0, b.x0);
      x1 = Math.max(x1, b.x1);
      z0 = Math.min(z0, b.z0);
      z1 = Math.max(z1, b.z1);
      y1 = Math.max(y1, b.y1 * PLATE_H);
    }
    const key = [x0, x1, z0, z1, Math.ceil(y1)].join(',');
    if (key === this.shadowKey) return;
    this.shadowKey = key;
    const c = new THREE.Vector3((x0 + x1) / 2, y1 / 2, (z0 + z1) / 2);
    const r = Math.hypot(x1 - x0, y1, z1 - z0) / 2 + 2;
    this.sun.position.copy(c).addScaledVector(LIGHT_DIR, r + 30);
    this.sun.target.position.copy(c);
    this.sun.target.updateMatrixWorld();
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 1;
    cam.far = 2 * r + 60;
    cam.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------------
  // 拾取
  // -------------------------------------------------------------------------

  /** 屏幕坐标 → 网格拾取 */
  pick(clientX: number, clientY: number, ignore?: ReadonlySet<number>): PickHit | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
    const ig = this.hiddenIds.size > 0 ? new Set([...(ignore ?? []), ...this.hiddenIds]) : ignore;
    return pickGrid(
      model.grid,
      { origin: [origin.x, origin.y, origin.z], dir: [direction.x, direction.y, direction.z] },
      { ignore: ig, groundHalf: this.baseplate.half },
    );
  }

  /** 世界坐标 → 屏幕坐标（相对画布） */
  project(p: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const v = p.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height,
      visible: v.z > -1 && v.z < 1,
    };
  }

  // -------------------------------------------------------------------------
  // 相机
  // -------------------------------------------------------------------------

  /** 模型（或底板）的包围球 */
  private sceneSphere(ids?: number[]): THREE.Sphere {
    const box = new THREE.Box3();
    const list = ids && ids.length ? ids.map((id) => model.get(id)!).filter(Boolean) : [...model.bricks.values()];
    if (list.length === 0) {
      const h = this.baseplate.half;
      box.set(new THREE.Vector3(-h, 0, -h), new THREE.Vector3(h, 1, h));
    } else {
      const m = new THREE.Matrix4();
      const tmp = new THREE.Box3();
      for (const b of list) {
        brickMatrix(b, m);
        const bb = this.bricks.geometryBox(b.part);
        if (bb) box.union(tmp.copy(bb).applyMatrix4(m));
      }
    }
    return box.getBoundingSphere(new THREE.Sphere());
  }

  private viewDirection(preset: ViewPreset): THREE.Vector3 {
    const sph = new THREE.Spherical();
    switch (preset) {
      case 'home':
        sph.set(1, THREE.MathUtils.degToRad(57), THREE.MathUtils.degToRad(38));
        break;
      case 'top':
        sph.set(1, 0.0001, 0);
        break;
      case 'front':
        sph.set(1, THREE.MathUtils.degToRad(80), 0);
        break;
      case 'back':
        sph.set(1, THREE.MathUtils.degToRad(80), Math.PI);
        break;
      case 'right':
        sph.set(1, THREE.MathUtils.degToRad(80), Math.PI / 2);
        break;
      case 'left':
        sph.set(1, THREE.MathUtils.degToRad(80), -Math.PI / 2);
        break;
    }
    return new THREE.Vector3().setFromSpherical(sph);
  }

  private fitDistance(radius: number) {
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const w = Math.max(1, this.container.clientWidth);
    const free = this.camera.view?.enabled ? Math.max(0.3, (w - this.insetLeft - this.insetRight) / w) : 1;
    const fovH = 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect * free);
    const f = Math.min(fov, fovH);
    return Math.max(this.controls?.minDistance ?? 2, (radius / Math.sin(f / 2)) * 1.08);
  }

  setView(preset: ViewPreset, animate = true) {
    const sphere = this.sceneSphere();
    const dir = this.viewDirection(preset);
    const target = sphere.center.clone();
    if (model.count === 0) target.set(0, 0, 0);
    const dist = this.fitDistance(Math.max(sphere.radius, 6) * (preset === 'home' ? 0.82 : 0.75));
    this.moveCamera(target.clone().addScaledVector(dir, dist), target, animate);
  }

  /** 聚焦到选中的积木或整个作品 */
  frame(ids?: number[]) {
    const sphere = this.sceneSphere(ids);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = this.fitDistance(Math.max(sphere.radius, 2.5));
    this.moveCamera(sphere.center.clone().addScaledVector(dir, dist), sphere.center, true);
  }

  /** 键盘环绕：水平 / 垂直旋转视角（弧度） */
  orbit(dAzimuth: number, dPolar: number) {
    const off = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.theta += dAzimuth;
    sph.phi = THREE.MathUtils.clamp(sph.phi + dPolar, 0.05, this.controls.maxPolarAngle);
    this.moveCamera(this.controls.target.clone().add(new THREE.Vector3().setFromSpherical(sph)), this.controls.target.clone(), true, 260);
  }

  zoom(factor: number) {
    const dir = this.camera.position.clone().sub(this.controls.target);
    const len = THREE.MathUtils.clamp(dir.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    dir.setLength(len);
    this.moveCamera(this.controls.target.clone().add(dir), this.controls.target.clone(), true, 260);
  }

  private moveCamera(pos: THREE.Vector3, target: THREE.Vector3, animate: boolean, dur = 520) {
    if (!animate || !this.controls) {
      this.camera.position.copy(pos);
      this.camera.lookAt(target);
      if (this.controls) this.controls.target.copy(target);
      this.tween = null;
      this.invalidate();
      return;
    }
    this.tween = {
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: pos,
      toTarget: target,
      start: performance.now(),
      dur,
    };
  }

  private updateTween(now: number) {
    const tw = this.tween!;
    const t = Math.min(1, (now - tw.start) / tw.dur);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    // 绕目标点做球面插值，避免穿过模型
    const fromOff = tw.fromPos.clone().sub(tw.fromTarget);
    const toOff = tw.toPos.clone().sub(tw.toTarget);
    const s0 = new THREE.Spherical().setFromVector3(fromOff);
    const s1 = new THREE.Spherical().setFromVector3(toOff);
    let dTheta = s1.theta - s0.theta;
    if (dTheta > Math.PI) dTheta -= Math.PI * 2;
    if (dTheta < -Math.PI) dTheta += Math.PI * 2;
    const sph = new THREE.Spherical(
      THREE.MathUtils.lerp(s0.radius, s1.radius, e),
      THREE.MathUtils.lerp(s0.phi, s1.phi, e),
      s0.theta + dTheta * e,
    );
    const target = tw.fromTarget.clone().lerp(tw.toTarget, e);
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(sph));
    this.camera.lookAt(target);
    if (t >= 1) this.tween = null;
  }

  cancelTween() {
    this.tween = null;
  }

  // -------------------------------------------------------------------------
  // 回放（搭建步骤）
  // -------------------------------------------------------------------------

  /** 只显示 order 中前 count 块积木；传 null 结束回放 */
  setPlayback(order: number[] | null, count = 0, animateLast = false) {
    const prevHidden = this.hiddenIds;
    this.hiddenIds = new Set<number>();
    if (order) {
      for (let i = count; i < order.length; i++) this.hiddenIds.add(order[i]);
    }
    for (const id of prevHidden) if (!this.hiddenIds.has(id)) this.bricks.setHidden(id, false);
    for (const id of this.hiddenIds) this.bricks.setHidden(id, true);
    this.stepHighlight = order && count > 0 ? order[count - 1] : null;
    if (order && animateLast && count > 0) this.animator.drop(order[count - 1], performance.now(), 0, 1.2, 320);
    this.updateHighlights();
    this.invalidateShadows();
  }

  get isPlayback() {
    return this.stepHighlight !== null || this.hiddenIds.size > 0;
  }

  // -------------------------------------------------------------------------
  // 截图
  // -------------------------------------------------------------------------

  /**
   * 以指定尺寸渲染当前视角并返回 dataURL。transparent 时输出透明背景（不含环境光遮蔽）。
   */
  capture(
    width: number,
    height: number,
    opts: { transparent?: boolean; type?: string; quality?: number; fast?: boolean } = {},
  ): string {
    const r = this.renderer;
    const prevRatio = r.getPixelRatio();
    const prevSize = r.getSize(new THREE.Vector2());
    const ghostVisible = this.ghost.group.visible;
    const boxVisible = this.selectionBox.object.visible;
    this.ghost.group.visible = false;
    this.selectionBox.object.visible = false;
    this.outline.group.visible = false;
    const tints = this.bricks.suspendTints();
    const prevBg = this.scene.background;
    if (opts.transparent) this.scene.background = null;
    r.setPixelRatio(1);
    r.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    r.shadowMap.needsUpdate = true;
    const useComposer = this.composer && !opts.transparent && !opts.fast;
    if (useComposer) {
      this.composer!.setPixelRatio(1);
      this.composer!.setSize(width, height);
      this.composer!.render();
    } else {
      r.render(this.scene, this.camera);
    }
    const url = r.domElement.toDataURL(opts.type ?? 'image/png', opts.quality ?? 0.92);
    // 恢复
    this.scene.background = prevBg;
    this.bricks.restoreTints(tints);
    this.ghost.group.visible = ghostVisible;
    this.selectionBox.object.visible = boxVisible;
    this.outline.group.visible = true;
    r.setPixelRatio(prevRatio);
    r.setSize(prevSize.x, prevSize.y, false);
    if (useComposer) {
      this.composer!.setPixelRatio(prevRatio);
      this.composer!.setSize(prevSize.x, prevSize.y);
    }
    this.camera.aspect = prevSize.x / prevSize.y;
    this.applyViewOffset();
    this.invalidateShadows();
    return url;
  }

  /** 生成作品缩略图（固定斜视角，不影响当前相机） */
  thumbnail(width: number, height: number): string {
    const saved = { pos: this.camera.position.clone(), target: this.controls.target.clone(), tween: this.tween };
    this.tween = null;
    const sphere = this.sceneSphere();
    const dir = this.viewDirection('home');
    const prevAspect = this.camera.aspect;
    this.camera.aspect = width / height;
    const dist = this.fitDistance(Math.max(sphere.radius, 4) * 0.9);
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.camera.lookAt(sphere.center);
    this.camera.aspect = prevAspect;
    const url = this.capture(width, height, { type: 'image/jpeg', quality: 0.86, fast: true });
    this.camera.position.copy(saved.pos);
    this.camera.lookAt(saved.target);
    this.controls.target.copy(saved.target);
    this.tween = saved.tween;
    this.invalidate();
    return url;
  }
}

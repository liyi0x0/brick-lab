import * as THREE from 'three';
import { getColor, type ColorKind } from '../core/colors';

/**
 * 为积木材质注入逐实例的「高亮色」属性 aTint(rgb, 强度)。
 * 用于选中、悬停、删除预览等效果，无需拆分实例化网格。
 */
function patchTint(mat: THREE.Material) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aTint;\nvarying vec4 vTint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTint = aTint;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vTint;')
      .replace(
        '#include <tonemapping_fragment>',
        `if (vTint.a > 0.001) {
          // a ≤ 1：仅边缘光（保持积木本色）；a > 1：额外整体着色（a-1 为着色强度）
          float rim = min(vTint.a, 1.0);
          float fill = clamp(vTint.a - 1.0, 0.0, 1.0);
          float fres = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.2);
          vec3 c = mix(gl_FragColor.rgb, vTint.rgb, fill * 0.6);
          c = mix(c, vTint.rgb, clamp(rim * fres * 1.15, 0.0, 1.0));
          gl_FragColor.rgb = c + vTint.rgb * rim * 0.07;
        }
        #include <tonemapping_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'brick-tint';
}

function makeSolid() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.18,
    specularIntensity: 0.55,
  });
}

function makeTrans() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.06,
    metalness: 0,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    specularIntensity: 1,
    clearcoat: 0.6,
    clearcoatRoughness: 0.05,
  });
}

function makeMetal() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.3,
    metalness: 0.55,
    clearcoat: 0.5,
    clearcoatRoughness: 0.15,
    envMapIntensity: 1.6,
  });
}

/** 实例化积木共享的三种材质（颜色由 instanceColor 提供） */
export class BrickMaterials {
  readonly solid = makeSolid();
  readonly trans = makeTrans();
  readonly metal = makeMetal();

  constructor() {
    patchTint(this.solid);
    patchTint(this.trans);
    patchTint(this.metal);
  }

  get(kind: ColorKind): THREE.Material {
    return kind === 'trans' ? this.trans : kind === 'metal' ? this.metal : this.solid;
  }

  dispose() {
    this.solid.dispose();
    this.trans.dispose();
    this.metal.dispose();
  }
}

const plainCache = new Map<number, THREE.MeshPhysicalMaterial>();

/** 普通（非实例化）网格用的单色材质，例如删除动画、缩略图 */
export function plainMaterial(colorId: number): THREE.MeshPhysicalMaterial {
  let m = plainCache.get(colorId);
  if (m) return m;
  const c = getColor(colorId);
  m = c.kind === 'trans' ? makeTrans() : c.kind === 'metal' ? makeMetal() : makeSolid();
  m.color.set(c.hex);
  plainCache.set(colorId, m);
  return m;
}

/** 放置预览（幽灵积木）材质 */
export function createGhostMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.4,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    emissive: 0xffffff,
    emissiveIntensity: 0.12,
  });
}

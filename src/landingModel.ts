export const LANDING_HASH = '#/home';

/** 首页地址：/、#、#/、#/home。每次访问首页都显示启动页。 */
export function shouldShowLanding(hash: string): boolean {
  return hash === '' || hash === '#' || hash === '#/' || hash === '#/home' || hash === '#/home/';
}

export type ImageKind = 'real' | 'virtual' | 'infinite';
export interface ThinLensImage { v: number; magnification: number; kind: ImageKind }

/** 薄透镜成像（实物在透镜左侧距离 u > 0）：1/v = 1/f − 1/u，v > 0 为实像。 */
export function thinLensImage(u: number, f: number): ThinLensImage {
  const d = u - f;
  if (Math.abs(d) < f * 1e-6) return { v: Infinity, magnification: Infinity, kind: 'infinite' };
  const v = (u * f) / d;
  return { v, magnification: -v / u, kind: v > 0 ? 'real' : 'virtual' };
}

/**
 * 从物点（高度 sourceHeight）出发、在透镜高度 h 处穿过薄透镜后的出射斜率。
 * 采用近轴近似：出射斜率 = 入射斜率 − h / f。高度向下为正。
 */
export function slopeAfterLens(sourceHeight: number, u: number, h: number, f: number): number {
  return (h - sourceHeight) / u - h / f;
}

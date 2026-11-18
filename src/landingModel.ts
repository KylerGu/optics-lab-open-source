export const LANDING_SEEN_KEY = 'optics-lab:landing-seen';
export const LANDING_HASH = '#/home';

export function isLandingHash(hash: string): boolean {
  return hash === '#/home' || hash === '#/home/';
}

/** 首次访问根地址时显示引导页；任何时候访问 #/home 也会显示。 */
export function shouldShowLanding(hash: string, seen: boolean): boolean {
  if (isLandingHash(hash)) return true;
  return !seen && (hash === '' || hash === '#' || hash === '#/');
}

export function readLandingSeen(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): boolean {
  try { return storage?.getItem(LANDING_SEEN_KEY) === '1'; } catch { return false; }
}

export function markLandingSeen(storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try { storage?.setItem(LANDING_SEEN_KEY, '1'); } catch { /* 隐私模式等情况下忽略 */ }
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

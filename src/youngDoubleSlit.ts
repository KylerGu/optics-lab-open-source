import { defaultScene, parseScene, SCENE_DEFINITIONS, type SceneState } from './sceneRuntime';

export const YOUNG_SCENE_ID = 'interference-0';
export interface YoungParameters { wavelengthNm: number; slitDistanceMm: number; screenDistanceM: number; observationMm: number }
export const DEFAULT_YOUNG = defaultScene(YOUNG_SCENE_ID).parameters as unknown as YoungParameters;
export const YOUNG_DRAFT_KEY = 'optics-scene-draft-v1-' + YOUNG_SCENE_ID;
const symbols = { wavelengthNm: 'λ', slitDistanceMm: 'd', screenDistanceM: 'L', observationMm: 'y' };
const tones = { wavelengthNm: 'wavelength', slitDistanceMm: 'distance', screenDistanceM: 'angle', observationMm: 'screen' };
export const YOUNG_FIELDS = SCENE_DEFINITIONS[YOUNG_SCENE_ID].parameters.map(f => ({ ...f, key: f.key as keyof YoungParameters, symbol: symbols[f.key as keyof YoungParameters], tone: tones[f.key as keyof YoungParameters] }));
export function youngState(p: YoungParameters): SceneState { return { version: 1, sceneId: YOUNG_SCENE_ID, parameters: { ...p } }; }
export function parseYoung(p: unknown): YoungParameters { return parseScene({ version: 1, sceneId: YOUNG_SCENE_ID, parameters: p }, YOUNG_SCENE_ID).parameters as unknown as YoungParameters; }
export function youngDoubleSlit(p: YoungParameters) {
  const lambdaMm = p.wavelengthNm * 1e-6, L = p.screenDistanceM * 1000, d = p.slitDistanceMm;
  const at = (yMm: number) => {
    const r1 = Math.hypot(L, yMm - d / 2), r2 = Math.hypot(L, yMm + d / 2);
    // Rationalized subtraction keeps sub-wavelength differences precise.
    const deltaMm = 2 * d * yMm / (r1 + r2), cycles = deltaMm / lambdaMm;
    const raw = Math.cos(Math.PI * (cycles % 1)) ** 2;
    const intensity = raw < 1e-12 ? 0 : 1 - raw < 1e-12 ? 1 : raw;
    return { r1, r2, deltaMm, deltaUm: deltaMm * 1000, cycles, intensity };
  };
  const position = (order: number) => {
    const delta = order * lambdaMm, denominator = d * d - delta * delta;
    if (denominator <= 0) throw new Error('该级次没有有限的屏上位置。');
    return delta * Math.sqrt(L * L / denominator + .25);
  };
  const observation = at(p.observationMm);
  return { at, position, observation, spacingApproxMm: lambdaMm * L / d, firstBrightMm: position(1), firstDarkMm: position(.5),
    status: observation.intensity === 1 ? '亮纹 · 相长干涉' : observation.intensity === 0 ? '暗纹 · 相消干涉' : '明暗之间' };
}
export interface YoungHistory { past: YoungParameters[]; present: YoungParameters; future: YoungParameters[] }
export function youngHistory(h: YoungHistory, action: { type: 'commit'; parameters: YoungParameters } | { type: 'undo' | 'redo' }): YoungHistory {
  if (action.type === 'commit') {
    const next = parseYoung(action.parameters);
    if (YOUNG_FIELDS.every(f => next[f.key] === h.present[f.key])) return h;
    return { past: [...h.past, h.present].slice(-80), present: next, future: [] };
  }
  if (action.type === 'undo' && h.past.length) return { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] };
  if (action.type === 'redo' && h.future.length) return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
  return h;
}

// Approximate visible hue; the numerical intensity is independent of this display mapping.
export function youngLightColor(nm: number): [number, number, number] {
  const rgb = nm < 440 ? [(440 - nm) / 60, 0, 1] : nm < 490 ? [0, (nm - 440) / 50, 1] : nm < 510 ? [0, 1, (510 - nm) / 20] : nm < 580 ? [(nm - 510) / 70, 1, 0] : nm < 645 ? [1, (645 - nm) / 65, 0] : [1, 0, 0];
  return rgb.map(c => Math.round(c * 255)) as [number, number, number];
}

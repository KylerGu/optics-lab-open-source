import { defaultScene, parseScene, SCENE_DEFINITIONS, type SceneState } from './sceneRuntime';

export const ILLUMINATION_ID = 'photometric-quantities-0';
export const MAP_EXTENT = 4;
export const MAP_SIZE = 81;
export interface IlluminationParameters { intensityCd: number; sourceXM: number; heightM: number; tiltDeg: number; halfAngleDeg: number; observationXM: number; observationYM: number }
export const DEFAULT_ILLUMINATION = defaultScene(ILLUMINATION_ID).parameters as unknown as IlluminationParameters;
const symbols: Record<keyof IlluminationParameters, string> = { intensityCd: 'I₀', sourceXM: 'xₛ', heightM: 'h', tiltDeg: 'θ', halfAngleDeg: 'β', observationXM: 'x', observationYM: 'y' };
const tones: Record<keyof IlluminationParameters, string> = { intensityCd: 'source', sourceXM: 'distance', heightM: 'distance', tiltDeg: 'angle', halfAngleDeg: 'angle', observationXM: 'screen', observationYM: 'screen' };
export const ILLUMINATION_FIELDS = SCENE_DEFINITIONS[ILLUMINATION_ID].parameters.map(f => ({ ...f, key: f.key as keyof IlluminationParameters, symbol: symbols[f.key as keyof IlluminationParameters], tone: tones[f.key as keyof IlluminationParameters] }));
export const illuminationState = (p: IlluminationParameters): SceneState => ({ version: 1, sceneId: ILLUMINATION_ID, parameters: { ...p } });
export const parseIllumination = (p: unknown) => parseScene({ version: 1, sceneId: ILLUMINATION_ID, parameters: p }, ILLUMINATION_ID).parameters as unknown as IlluminationParameters;
export function illuminanceAt(p: IlluminationParameters, x = p.observationXM, y = p.observationYM) {
  const dx = x - p.sourceXM, r = Math.hypot(dx, y, p.heightM), theta = p.tiltDeg * Math.PI / 180;
  const cosine = Math.max(-1, Math.min(1, (dx * Math.sin(theta) + p.heightM * Math.cos(theta)) / r));
  const order = Math.log(.5) / Math.log(Math.cos(p.halfAngleDeg * Math.PI / 180));
  const factor = Math.max(0, cosine) ** order;
  return { value: p.intensityCd * factor * p.heightM / r ** 3, distance: r, alphaDeg: Math.acos(cosine) * 180 / Math.PI, incidenceDeg: Math.acos(p.heightM / r) * 180 / Math.PI, order };
}
export function illuminationMap(p: IlluminationParameters) {
  const values: number[] = [], step = MAP_EXTENT * 2 / (MAP_SIZE - 1);
  let weighted = 0, maximum = 0, minimum = Infinity, peakX = 0, peakY = 0;
  for (let j = 0; j < MAP_SIZE; j++) for (let i = 0; i < MAP_SIZE; i++) {
    const x = -MAP_EXTENT + i * step, y = MAP_EXTENT - j * step, e = illuminanceAt(p, x, y).value;
    values.push(e); weighted += e * (i === 0 || i === MAP_SIZE - 1 ? .5 : 1) * (j === 0 || j === MAP_SIZE - 1 ? .5 : 1);
    minimum = Math.min(minimum, e);
    if (e > maximum) { maximum = e; peakX = x; peakY = y; }
  }
  const average = weighted / (MAP_SIZE - 1) ** 2;
  const curve = Array.from({ length: 321 }, (_, i) => { const x = -MAP_EXTENT + MAP_EXTENT * 2 * i / 320; return { x, y: illuminanceAt(p, x, p.observationYM).value }; });
  return { values, curve, maximum, minimum, average, uniformity: average > 0 ? minimum / average : null, peak: maximum > 0 ? { x: peakX, y: peakY } : null, observation: illuminanceAt(p) };
}
export interface IlluminationHistory { past: IlluminationParameters[]; present: IlluminationParameters; future: IlluminationParameters[] }
export function illuminationHistory(h: IlluminationHistory, action: { type: 'commit'; parameters: IlluminationParameters } | { type: 'undo' | 'redo' }): IlluminationHistory {
  if (action.type === 'commit') {
    const next = parseIllumination(action.parameters);
    if (ILLUMINATION_FIELDS.every(f => next[f.key] === h.present[f.key])) return h;
    return { past: [...h.past, h.present].slice(-80), present: next, future: [] };
  }
  if (action.type === 'undo' && h.past.length) return { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] };
  if (action.type === 'redo' && h.future.length) return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
  return h;
}

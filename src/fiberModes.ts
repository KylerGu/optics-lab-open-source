import { defaultScene, parseScene, SCENE_DEFINITIONS, type SceneState } from './sceneRuntime';

export const FIBER_ID = 'fiber-modes-0';
// First zero of J0, for the weak-guidance LP11 cutoff.
export const FIBER_CUTOFF = 2.404825557695773;
export interface FiberParameters { coreIndex: number; claddingIndex: number; radiusUm: number; wavelengthNm: number; angleDeg: number }
export const DEFAULT_FIBER = defaultScene(FIBER_ID).parameters as unknown as FiberParameters;
const SYMBOLS = { coreIndex: 'n₁', claddingIndex: 'n₂', radiusUm: 'a', wavelengthNm: 'λ', angleDeg: 'θ' };
export const FIBER_FIELDS = SCENE_DEFINITIONS[FIBER_ID].parameters.map(f => ({ ...f, key: f.key as keyof FiberParameters, symbol: SYMBOLS[f.key as keyof FiberParameters] }));
export const fiberState = (p: FiberParameters): SceneState => ({ version: 1, sceneId: FIBER_ID, parameters: { ...p } });
export const parseFiber = (p: unknown) => parseScene({ version: 1, sceneId: FIBER_ID, parameters: p }, FIBER_ID).parameters as unknown as FiberParameters;
export type RayStatus = 'guided' | 'critical' | 'escaping' | 'unguided';
export interface FiberSegment { start: [number, number]; end: [number, number]; role: 'core' | 'escaping' }
export function fiberModes(p: FiberParameters, windowRadii = 80) {
  const rad = Math.PI / 180;
  const guiding = p.coreIndex > p.claddingIndex;
  const na = guiding ? Math.sqrt((p.coreIndex - p.claddingIndex) * (p.coreIndex + p.claddingIndex)) : null;
  const acceptanceDeg = na === null ? null : Math.asin(na) / rad;
  const criticalDeg = guiding ? Math.asin(p.claddingIndex / p.coreIndex) / rad : null;
  const internalDeg = Math.asin(Math.sin(p.angleDeg * rad) / p.coreIndex) / rad;
  const incidenceDeg = 90 - internalDeg;
  const v = na === null ? null : 2 * Math.PI * p.radiusUm * na / (p.wavelengthNm * .001);
  const cutoffNm = na === null ? null : 2 * Math.PI * p.radiusUm * na / FIBER_CUTOFF * 1000;
  const rayStatus: RayStatus = !guiding ? 'unguided' : Math.abs(p.angleDeg - acceptanceDeg!) <= 1e-9 ? 'critical' : p.angleDeg < acceptanceDeg! ? 'guided' : 'escaping';
  const mode = v === null ? '无折射率导光' : Math.abs(v - FIBER_CUTOFF) <= 1e-9 ? '截止边界' : v < FIBER_CUTOFF ? '单模' : '多模';
  // Meridional ray in a straight fibre. Coordinates are in units of a;
  // the view window is not a propagation parameter or a power calculation.
  const segments: FiberSegment[] = [];
  let x = 0, y = 0, slope = Math.tan(internalDeg * rad);
  let firstHit: [number, number] | null = null;
  for (let j = 0; j < 200 && x < windowRadii; j++) {
    const edge = slope >= 0 ? 1 : -1;
    const hit = Math.abs(slope) < 1e-14 ? Infinity : x + (edge - y) / slope;
    const end: [number, number] = hit > windowRadii ? [windowRadii, y + (windowRadii - x) * slope] : [hit, edge];
    segments.push({ start: [x, y], end, role: 'core' });
    if (hit >= windowRadii) break;
    firstHit ??= end;
    if (rayStatus !== 'guided') {
      const refracted = Math.asin(Math.min(1, p.coreIndex / p.claddingIndex * Math.cos(internalDeg * rad)));
      const outgoingSlope = edge / Math.max(1e-14, Math.tan(refracted));
      const dx = Math.min(windowRadii - hit, 1.25 / Math.max(1e-14, Math.abs(outgoingSlope)));
      segments.push({ start: end, end: [hit + dx, edge + dx * outgoingSlope], role: 'escaping' });
      break;
    }
    x = hit; y = edge; slope = -slope;
  }
  return { guiding, na, acceptanceDeg, criticalDeg, internalDeg, incidenceDeg, v, cutoffNm, rayStatus, mode, segments, firstHit };
}
export interface FiberHistory { past: FiberParameters[]; present: FiberParameters; future: FiberParameters[] }
export function fiberHistory(h: FiberHistory, action: { type: 'commit'; parameters: FiberParameters } | { type: 'undo' | 'redo' }): FiberHistory {
  if (action.type === 'commit') {
    const next = parseFiber(action.parameters);
    if (FIBER_FIELDS.every(f => next[f.key] === h.present[f.key])) return h;
    return { past: [...h.past, h.present].slice(-80), present: next, future: [] };
  }
  if (action.type === 'undo' && h.past.length) return { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] };
  if (action.type === 'redo' && h.future.length) return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
  return h;
}

import { defaultScene, parseScene, SCENE_DEFINITIONS, type SceneState } from './sceneRuntime';

export const POINT_SOURCE_ID = 'radiometric-quantities-0';
export interface PointParameters { intensityCd: number; distanceM: number }
export const DEFAULT_POINT = defaultScene(POINT_SOURCE_ID).parameters as unknown as PointParameters;
export const POINT_FIELDS = SCENE_DEFINITIONS[POINT_SOURCE_ID].parameters.map(f => ({ ...f, key: f.key as keyof PointParameters, symbol: f.key === 'intensityCd' ? 'I' : 'r', tone: f.key === 'intensityCd' ? 'source' : 'distance' }));
export const pointState = (p: PointParameters): SceneState => ({ version: 1, sceneId: POINT_SOURCE_ID, parameters: { ...p } });
export const parsePoint = (p: unknown) => parseScene({ version: 1, sceneId: POINT_SOURCE_ID, parameters: p }, POINT_SOURCE_ID).parameters as unknown as PointParameters;
export const illuminance = (p: PointParameters, distance = p.distanceM) => p.intensityCd / distance ** 2;
export interface PointHistory { past: PointParameters[]; present: PointParameters; future: PointParameters[] }
export function pointHistory(h: PointHistory, action: { type: 'commit'; parameters: PointParameters } | { type: 'undo' | 'redo' }): PointHistory {
  if (action.type === 'commit') {
    const next = parsePoint(action.parameters);
    if (POINT_FIELDS.every(f => next[f.key] === h.present[f.key])) return h;
    return { past: [...h.past, h.present].slice(-80), present: next, future: [] };
  }
  if (action.type === 'undo' && h.past.length) return { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] };
  if (action.type === 'redo' && h.future.length) return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
  return h;
}

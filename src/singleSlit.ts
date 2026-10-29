import { defaultScene, parseScene, SCENE_DEFINITIONS, type SceneState } from './sceneRuntime';
import { makeSpatialElement, parseSpatial, type SpatialExperiment } from './builderModel';

export const SINGLE_SLIT_ID = 'diffraction-0';
export interface SlitParameters { wavelengthNm: number; slitWidthMm: number; screenDistanceM: number; observationMm: number }
export const DEFAULT_SLIT = defaultScene(SINGLE_SLIT_ID).parameters as unknown as SlitParameters;
export const SLIT_DRAFT_KEY = 'optics-scene-draft-v1-' + SINGLE_SLIT_ID;
const symbols = { wavelengthNm: 'λ', slitWidthMm: 'a', screenDistanceM: 'L', observationMm: 'y' };
const tones = { wavelengthNm: 'wavelength', slitWidthMm: 'distance', screenDistanceM: 'angle', observationMm: 'screen' };
export const SLIT_FIELDS = SCENE_DEFINITIONS[SINGLE_SLIT_ID].parameters.map(f => ({ ...f, key: f.key as keyof SlitParameters, symbol: symbols[f.key as keyof SlitParameters], tone: tones[f.key as keyof SlitParameters] }));
export function slitState(p: SlitParameters): SceneState { return { version: 1, sceneId: SINGLE_SLIT_ID, parameters: { ...p } }; }
export function parseSlit(p: unknown): SlitParameters { return parseScene({ version: 1, sceneId: SINGLE_SLIT_ID, parameters: p }, SINGLE_SLIT_ID).parameters as unknown as SlitParameters; }
export function singleSlit(p: SlitParameters) {
  const lambda = p.wavelengthNm * 1e-6, L = p.screenDistanceM * 1000, a = p.slitWidthMm;
  const at = (y: number) => {
    const sinTheta = y / Math.hypot(L, y), beta = Math.PI * a * sinTheta / lambda;
    const intensity = Math.abs(beta) < 1e-8 ? 1 : (Math.sin(beta) / beta) ** 2;
    return { intensity: intensity < 1e-14 ? 0 : intensity, thetaDeg: Math.atan2(y, L) * 180 / Math.PI, beta, cycles: a * sinTheta / lambda };
  };
  const ratio = lambda / a, firstMinimumMm = L * ratio / Math.sqrt(1 - ratio * ratio);
  const observation = at(p.observationMm);
  return { at, observation, firstMinimumMm, centralWidthMm: 2 * firstMinimumMm, fresnelNumber: a * a / (lambda * L),
    status: observation.intensity === 1 ? '中央最亮' : observation.intensity === 0 ? '暗纹' : Math.abs(p.observationMm) < firstMinimumMm ? '中央亮纹内' : '旁侧条纹' };
}
export interface SlitHistory { past: SlitParameters[]; present: SlitParameters; future: SlitParameters[] }
export function slitHistory(h: SlitHistory, action: { type: 'commit'; parameters: SlitParameters } | { type: 'undo' | 'redo' }): SlitHistory {
  if (action.type === 'commit') {
    const next = parseSlit(action.parameters);
    if (SLIT_FIELDS.every(f => next[f.key] === h.present[f.key])) return h;
    return { past: [...h.past, h.present].slice(-80), present: next, future: [] };
  }
  if (action.type === 'undo' && h.past.length) return { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] };
  if (action.type === 'redo' && h.future.length) return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
  return h;
}
export function slitBuilderCopy(p: SlitParameters): SpatialExperiment {
  parseSlit(p);
  return parseSpatial({ schemaVersion: 2, name: '单缝衍射', elements: [
    makeSpatialElement('laser', [20,60,0], {id:'slit-source',name:'平行光源',wavelengthNm:p.wavelengthNm,beamModel:'parallel',beamRadiusMm:.8,divergenceMrad:0,rayCount:201}),
    makeSpatialElement('slit', [100,60,0], {id:'single-slit',name:'单缝',slitWidthMm:p.slitWidthMm,slitHeightMm:20,rollDeg:90}),
    makeSpatialElement('screen', [100+p.screenDistanceM*1000,60,0], {id:'slit-screen',name:'观察屏',diameterMm:100}),
  ]});
}

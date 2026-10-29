import { defaultScene, parseScene, SCENE_DEFINITIONS, type SceneState } from './sceneRuntime';

export const WAVE_SCENE_ID = 'wave-fields-1';
export interface WaveParameters { wavelengthNm: number; amplitude1: number; amplitude2: number; phaseDeg: number; observationUm: number }
export const DEFAULT_WAVE = defaultScene(WAVE_SCENE_ID).parameters as unknown as WaveParameters;
export const WAVE_DRAFT_KEY = 'optics-scene-draft-v1-' + WAVE_SCENE_ID;
const symbols: Record<keyof WaveParameters, string> = { wavelengthNm: 'λ', amplitude1: 'A₁', amplitude2: 'A₂', phaseDeg: 'Δφ', observationUm: 'z' };
const tones: Record<keyof WaveParameters, string> = { wavelengthNm: 'wavelength', amplitude1: 'wave-first', amplitude2: 'wave-second', phaseDeg: 'angle', observationUm: 'screen' };
export const WAVE_FIELDS = SCENE_DEFINITIONS[WAVE_SCENE_ID].parameters.map(f => ({ ...f, key: f.key as keyof WaveParameters, symbol: symbols[f.key as keyof WaveParameters], tone: tones[f.key as keyof WaveParameters] }));
export function waveState(p: WaveParameters): SceneState { return { version: 1, sceneId: WAVE_SCENE_ID, parameters: { ...p } }; }
export function parseWave(value: unknown): WaveParameters {
  // Migrate the previous animated draft without losing the optical parameters.
  if (value && typeof value === 'object' && !Array.isArray(value) && 'timePhaseDeg' in value) {
    const { timePhaseDeg, ...parameters } = value as Record<string, unknown>;
    if (typeof timePhaseDeg !== 'number' || !Number.isFinite(timePhaseDeg) || timePhaseDeg < 0 || timePhaseDeg > 360) throw new Error('无效的旧场景时间相位');
    value = parameters;
  }
  return parseScene({ version: 1, sceneId: WAVE_SCENE_ID, parameters: value }, WAVE_SCENE_ID).parameters as unknown as WaveParameters; }
export function waveSuperposition(p: WaveParameters) {
  const phi = p.phaseDeg * Math.PI / 180, re = p.amplitude1 + p.amplitude2 * Math.cos(phi), im = p.amplitude2 * Math.sin(phi);
  const rawAmplitude = Math.hypot(re, im);
  const amplitude = rawAmplitude < 1e-12 * (p.amplitude1 + p.amplitude2) ? 0 : rawAmplitude;
  const resultantPhase = amplitude === 0 ? null : Math.atan2(im, re);
  const fieldsAt = (zUm: number) => {
    const theta = 2 * Math.PI * zUm / (p.wavelengthNm / 1000);
    const first = p.amplitude1 * Math.cos(theta), second = p.amplitude2 * Math.cos(theta + phi);
    return { first, second, sum: amplitude === 0 ? 0 : first + second };
  };
  return { amplitude, intensity: amplitude * amplitude, firstIntensity: p.amplitude1 ** 2, secondIntensity: p.amplitude2 ** 2,
    resultantPhase, fieldsAt, observation: fieldsAt(p.observationUm),
    status: p.amplitude1 === 0 && p.amplitude2 === 0 ? '两束振幅均为零' : p.amplitude1 === 0 || p.amplitude2 === 0 ? '仅一束光' : amplitude === 0 ? '完全相消' : Math.abs(p.phaseDeg % 360) < 1e-10 ? '同相增强' : Math.abs(p.phaseDeg - 180) < 1e-10 ? '反相抵消' : Math.abs(Math.cos(phi)) < 1e-10 ? '光强等于两束之和' : Math.cos(phi) > 0 ? '部分增强' : '部分抵消' };
}
export interface WaveHistory { past: WaveParameters[]; present: WaveParameters; future: WaveParameters[] }
export function waveHistory(h: WaveHistory, action: { type: 'commit'; parameters: WaveParameters } | { type: 'undo' | 'redo' }): WaveHistory {
  if (action.type === 'commit') {
    const next = parseWave(action.parameters);
    if (WAVE_FIELDS.every(f => h.present[f.key] === next[f.key])) return h;
    return { past: [...h.past, h.present].slice(-80), present: next, future: [] };
  }
  if (action.type === 'undo' && h.past.length) return { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] };
  if (action.type === 'redo' && h.future.length) return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
  return h;
}

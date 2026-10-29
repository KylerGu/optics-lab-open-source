export interface LaserGainParameters {
  lengthMm: number; smallSignalGain: number; lossPerM: number; firstReflectivityPct: number; secondReflectivityPct: number; probeIntensity: number;
}
export const GAIN_DRAFT_KEY = 'optics-laser-threshold:v1';
export const DEFAULT_GAIN: LaserGainParameters = { lengthMm: 100, smallSignalGain: 2, lossPerM: .2, firstReflectivityPct: 99, secondReflectivityPct: 90, probeIntensity: .5 };
export const GAIN_FIELDS: { key: keyof LaserGainParameters; label: string; symbol: string; unit: string; min: number; max: number; step: number; tone: string }[] = [
  { key: 'lengthMm', label: '增益介质长度', symbol: 'L', unit: 'mm', min: 10, max: 1000, step: 1, tone: 'lens' },
  { key: 'smallSignalGain', label: '小信号增益', symbol: 'g₀', unit: 'm⁻¹', min: 0, max: 50, step: .01, tone: 'waist' },
  { key: 'lossPerM', label: '内部损耗系数', symbol: 'α', unit: 'm⁻¹', min: 0, max: 10, step: .01, tone: 'wavelength' },
  { key: 'firstReflectivityPct', label: '第一镜反射率', symbol: 'R₁', unit: '%', min: 1, max: 100, step: .1, tone: 'lens' },
  { key: 'secondReflectivityPct', label: '输出镜反射率', symbol: 'R₂', unit: '%', min: 1, max: 100, step: .1, tone: 'output' },
  { key: 'probeIntensity', label: '试算相对光强', symbol: 'I/Iₛ', unit: '', min: 0, max: 20, step: .01, tone: 'screen' },
];
export function parseGain(value: unknown): LaserGainParameters {
  if (!value || typeof value !== 'object') throw new Error('增益参数格式无效。');
  const p = value as LaserGainParameters;
  for (const f of GAIN_FIELDS) if (typeof p[f.key] !== 'number' || !Number.isFinite(p[f.key]) || p[f.key] < f.min || p[f.key] > f.max) throw new Error(`${f.label}超出有效范围。`);
  return Object.fromEntries(GAIN_FIELDS.map(f => [f.key, p[f.key]])) as unknown as LaserGainParameters;
}
// g and alpha are intensity coefficients, not field-amplitude coefficients.
// Uniform effective saturation represents one existing resonant mode, not a spatial or temporal laser simulation.
export function laserGain(p: LaserGainParameters) {
  const lengthM = p.lengthMm * .001, r1 = p.firstReflectivityPct / 100, r2 = p.secondReflectivityPct / 100;
  const mirrorLoss = -Math.log(r1) - Math.log(r2), internalLoss = 2 * p.lossPerM * lengthM;
  const thresholdGain = p.lossPerM + mirrorLoss / (2 * lengthM);
  const logRoundTrip = 2 * lengthM * (p.smallSignalGain - thresholdGain);
  const margin = p.smallSignalGain - thresholdGain, tolerance = 1e-10 * Math.max(1, p.smallSignalGain, thresholdGain);
  const lossless = thresholdGain === 0;
  const above = margin > tolerance, atThreshold = Math.abs(margin) <= tolerance;
  const status = lossless ? p.smallSignalGain > 0 ? '无有限稳态' : '理想无损' : above ? '阈值以上' : atThreshold ? '达到阈值' : '阈值以下';
  const steadyIntensity = lossless ? null : above ? margin / thresholdGain : 0;
  const outputIntensity = steadyIntensity === null ? null : (1 - r2) * steadyIntensity;
  const steadyGain = lossless ? null : above || atThreshold ? thresholdGain : p.smallSignalGain;
  const gainAt = (intensity: number) => p.smallSignalGain / (1 + intensity);
  const outputAt = (gain: number) => lossless ? null : (1 - r2) * Math.max(0, gain / thresholdGain - 1);
  return { lengthM, thresholdGain, logRoundTrip, roundTrip: Math.exp(logRoundTrip), margin, status, lossless, above, atThreshold,
    mirrorLoss, internalLoss, steadyIntensity, outputIntensity, steadyGain, probeGain: gainAt(p.probeIntensity), gainAt, outputAt };
}
export function gainTarget(p: LaserGainParameters, above = false): number | null {
  const b = laserGain(p), target = b.thresholdGain * (above ? 1.2 : 1);
  return b.lossless || target > 50 ? null : target;
}
export interface GainHistory { past: LaserGainParameters[]; present: LaserGainParameters; future: LaserGainParameters[] }
export function gainHistory(h: GainHistory, a: { type: 'commit'; parameters: LaserGainParameters } | { type: 'undo' | 'redo' }): GainHistory {
  if (a.type === 'commit') { const p = parseGain(a.parameters); if (JSON.stringify(p) === JSON.stringify(h.present)) return h; return { past: [...h.past, h.present].slice(-80), present: p, future: [] }; }
  if (a.type === 'undo') return h.past.length ? { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] } : h;
  return h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h;
}

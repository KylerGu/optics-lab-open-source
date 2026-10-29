import { gaussianBeam } from './gaussianBeam';
import { makeElement, parseExperiment, type Experiment, type Laser, type Lens, type Screen } from './model';

export interface FocusParameters {
  wavelengthNm: number; waistMm: number; waistPositionMm: number;
  focalLengthMm: number; lensPositionMm: number; observationMm: number;
}
export const FOCUS_DRAFT_KEY = 'optics-gaussian-focus:v1';
export const DEFAULT_FOCUS: FocusParameters = {
  wavelengthNm: 532, waistMm: .5, waistPositionMm: 0,
  focalLengthMm: 100, lensPositionMm: 200, observationMm: 320,
};
export const FOCUS_FIELDS: { key: keyof FocusParameters; label: string; symbol: string; unit: string; min: number; max: number; step: number; tone: string }[] = [
  { key: 'wavelengthNm', label: '波长', symbol: 'λ', unit: 'nm', min: 380, max: 1100, step: 1, tone: 'wavelength' },
  { key: 'waistMm', label: '入射束腰半径', symbol: 'w₀', unit: 'mm', min: .01, max: 5, step: .01, tone: 'waist' },
  { key: 'waistPositionMm', label: '入射束腰位置', symbol: 'z₀', unit: 'mm', min: -2000, max: 2000, step: 1, tone: 'waist' },
  { key: 'focalLengthMm', label: '透镜焦距', symbol: 'f', unit: 'mm', min: 10, max: 5000, step: 1, tone: 'lens' },
  { key: 'lensPositionMm', label: '透镜位置', symbol: 'zᴸ', unit: 'mm', min: 0, max: 600, step: 1, tone: 'lens' },
  { key: 'observationMm', label: '观察位置', symbol: 'z', unit: 'mm', min: 0, max: 2000, step: 1, tone: 'screen' },
];
export function parseFocus(value: unknown): FocusParameters {
  if (!value || typeof value !== 'object') throw new Error('聚焦参数格式无效。');
  const p = value as FocusParameters;
  for (const f of FOCUS_FIELDS) {
    if (!Number.isFinite(p[f.key]) || p[f.key] < f.min || p[f.key] > f.max) throw new Error(`${f.label}需在 ${f.min}–${f.max} ${f.unit} 范围内。`);
  }
  return Object.fromEntries(FOCUS_FIELDS.map(f => [f.key, p[f.key]])) as unknown as FocusParameters;
}

// q = (z-z0)+i*zR; 1/q+ = 1/q- - 1/f. Analytic real arithmetic
// preserves the positive imaginary part even for a very small focused waist.
export function gaussianFocus(p: FocusParameters) {
  const laser: Laser = { id: 'incident', kind: 'laser', name: '入射光束', positionMm: p.waistPositionMm, wavelengthNm: p.wavelengthNm, waistMm: p.waistMm };
  const screen: Screen = { id: 'observation', kind: 'screen', name: '观察位置', positionMm: p.observationMm, sizeMm: 40 };
  const input = gaussianBeam(laser, screen);
  const d = p.lensPositionMm - p.waistPositionMm, zr = input.rayleighMm, f = p.focalLengthMm;
  const denominator = (1 - d / f) ** 2 + (zr / f) ** 2;
  const qRealMm = (d * (1 - d / f) - zr * zr / f) / denominator;
  const outputRayleighMm = zr / denominator;
  const outputWaistMm = Math.sqrt(p.wavelengthNm * 1e-6 * outputRayleighMm / Math.PI);
  const outputWaistPositionMm = p.lensPositionMm - qRealMm;
  const output = gaussianBeam({ ...laser, positionMm: outputWaistPositionMm, waistMm: outputWaistMm }, screen);
  const radiusAt = (z: number) => z < p.lensPositionMm ? input.radiusAt(z) : output.radiusAt(z);
  const virtual = outputWaistPositionMm < p.lensPositionMm - 1e-8;
  const lensRadiusMm = input.radiusAt(p.lensPositionMm);
  const observationRadiusMm = radiusAt(p.observationMm);
  const minimumForwardMm = virtual ? lensRadiusMm : outputWaistMm;
  const windowRadii = [0, 50, 100].map(s => output.radiusAt(p.lensPositionMm + s));
  if (-qRealMm >= 0 && -qRealMm <= 100) windowRadii.push(outputWaistMm);
  const nearlyParallel = Math.max(...windowRadii) / Math.min(...windowRadii) < 1.01;
  return { input, output, radiusAt, lensRadiusMm, outputWaistMm, outputWaistPositionMm, outputRayleighMm, qRealMm,
    waistDistanceMm: -qRealMm, observationRadiusMm, virtual, nearlyParallel, minimumForwardMm,
    observationBeforeLens: p.observationMm < p.lensPositionMm,
    paraxial: Math.max(input.divergenceMrad, output.divergenceMrad) < 100,
  };
}

export function focusBuilderCopy(p: FocusParameters): { experiment: Experiment | null; reason: string } {
  const beam = gaussianFocus(p);
  if (p.waistPositionMm < 0 || p.waistPositionMm >= p.lensPositionMm || p.observationMm <= p.lensPositionMm || p.observationMm > 600) {
    return { experiment: null, reason: '搭建器从光源束腰向右传播。复制需满足 0 ≤ z₀ < zᴸ < z ≤ 600 mm。' };
  }
  // A finite builder lens must not noticeably truncate the ideal input beam.
  const diameterMm = Math.max(25.4, beam.lensRadiusMm * 8);
  if (diameterMm > 100 || beam.observationRadiusMm * 8 > 100) return { experiment: null, reason: '当前光斑超出搭建器可用口径，无法完整复制这组参数。' };
  const experiment = parseExperiment({ schemaVersion: 1, name: '高斯光束 · 透镜聚焦', railLengthMm: 600,
    elements: [
      { ...makeElement('laser', p.waistPositionMm), wavelengthNm: p.wavelengthNm, waistMm: p.waistMm } as Laser,
      { ...makeElement('lens', p.lensPositionMm), focalLengthMm: p.focalLengthMm, diameterMm } as Lens,
      { ...makeElement('screen', p.observationMm), sizeMm: Math.max(40, beam.observationRadiusMm * 8) } as Screen,
    ],
  });
  return { experiment, reason: '复制相同波长、入射束腰、透镜位置与焦距、观察位置；器件口径足够容纳光束。' };
}

export interface FocusHistory { past: FocusParameters[]; present: FocusParameters; future: FocusParameters[] }
export function focusHistory(h: FocusHistory, a: { type: 'commit'; parameters: FocusParameters } | { type: 'undo' | 'redo' }): FocusHistory {
  if (a.type === 'commit') {
    const p = parseFocus(a.parameters);
    if (JSON.stringify(h.present) === JSON.stringify(p)) return h;
    return { past: [...h.past, h.present].slice(-80), present: p, future: [] };
  }
  if (a.type === 'undo') return h.past.length ? { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] } : h;
  return h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h;
}

import { gaussianBeam } from './gaussianBeam';
import { makeElement, parseExperiment, type Experiment, type Laser, type Lens, type Screen } from './model';

export interface ExpanderParameters {
  wavelengthNm: number; waistMm: number; waistPositionMm: number; firstKind: number;
  firstFocalMm: number; secondFocalMm: number; firstPositionMm: number; secondPositionMm: number; observationMm: number;
}
export const EXPANDER_DRAFT_KEY = 'optics-gaussian-expander:v1';
export const DEFAULT_EXPANDER: ExpanderParameters = { wavelengthNm: 532, waistMm: .5, waistPositionMm: 0,
  firstKind: -1, firstFocalMm: 25, secondFocalMm: 100, firstPositionMm: 100, secondPositionMm: 175, observationMm: 500 };
export const EXPANDER_FIELDS: { key: keyof ExpanderParameters; label: string; symbol: string; unit: string; min: number; max: number; step: number; tone: string }[] = [
  { key: 'wavelengthNm', label: '波长', symbol: 'λ', unit: 'nm', min: 380, max: 1100, step: 1, tone: 'wavelength' },
  { key: 'waistMm', label: '入射束腰半径', symbol: 'w₀', unit: 'mm', min: .01, max: 5, step: .01, tone: 'waist' },
  { key: 'waistPositionMm', label: '入射束腰位置', symbol: 'z₀', unit: 'mm', min: -2000, max: 2000, step: 1, tone: 'waist' },
  { key: 'firstKind', label: '装置类型', symbol: '', unit: '', min: -1, max: 1, step: 2, tone: 'lens' },
  { key: 'firstFocalMm', label: '第一镜焦距大小', symbol: '|f₁|', unit: 'mm', min: 10, max: 500, step: 1, tone: 'lens' },
  { key: 'firstPositionMm', label: '第一镜位置', symbol: 'z₁', unit: 'mm', min: 0, max: 500, step: 1, tone: 'lens' },
  { key: 'secondFocalMm', label: '第二镜焦距', symbol: 'f₂', unit: 'mm', min: 10, max: 1000, step: 1, tone: 'output' },
  { key: 'secondPositionMm', label: '第二镜位置', symbol: 'z₂', unit: 'mm', min: 1, max: 1100, step: 1, tone: 'output' },
  { key: 'observationMm', label: '观察位置', symbol: 'z', unit: 'mm', min: 0, max: 2000, step: 1, tone: 'screen' },
];
export function parseExpander(value: unknown): ExpanderParameters {
  if (!value || typeof value !== 'object') throw new Error('扩束参数格式无效。');
  const p = value as ExpanderParameters;
  for (const f of EXPANDER_FIELDS) if (typeof p[f.key] !== 'number' || !Number.isFinite(p[f.key]) || p[f.key] < f.min || p[f.key] > f.max) throw new Error(`${f.label}超出有效范围。`);
  if (![1, -1].includes(p.firstKind)) throw new Error('装置类型无效。');
  if (p.secondPositionMm - p.firstPositionMm < 1) throw new Error('第二镜需在第一镜右侧，至少相隔 1 mm。');
  return Object.fromEntries(EXPANDER_FIELDS.map(f => [f.key, p[f.key]])) as unknown as ExpanderParameters;
}
export const expanderFields = (p: ExpanderParameters) => EXPANDER_FIELDS.map(f => ({ ...f,
  min: f.key === 'secondPositionMm' ? Math.max(1, p.firstPositionMm + 1) : f.min,
  max: f.key === 'firstPositionMm' ? Math.min(500, p.secondPositionMm - 1) : f.max }));
type Q = { real: number; imaginary: number };
function lens(q: Q, f: number): Q {
  const den = (1 - q.real / f) ** 2 + (q.imaginary / f) ** 2;
  return { real: (q.real * (1 - q.real / f) - q.imaginary ** 2 / f) / den, imaginary: q.imaginary / den };
}
export function gaussianExpander(p: ExpanderParameters) {
  const source = { id: 'input', kind: 'laser', name: '入射光束', positionMm: p.waistPositionMm, wavelengthNm: p.wavelengthNm, waistMm: p.waistMm } as Laser;
  const screen = { id: 'observer', kind: 'screen', name: '观察面', positionMm: p.observationMm, sizeMm: 40 } as Screen;
  const input = gaussianBeam(source, screen), spacingMm = p.secondPositionMm - p.firstPositionMm;
  const q1 = lens({ real: p.firstPositionMm - p.waistPositionMm, imaginary: input.rayleighMm }, p.firstKind * p.firstFocalMm);
  const q2 = lens({ real: q1.real + spacingMm, imaginary: q1.imaginary }, p.secondFocalMm);
  const fromQ = (q: Q, z: number) => {
    const waistPositionMm = z - q.real, waistMm = Math.sqrt(p.wavelengthNm * 1e-6 * q.imaginary / Math.PI);
    return { ...gaussianBeam({ ...source, positionMm: waistPositionMm, waistMm }, screen), waistPositionMm, waistMm };
  };
  const middle = fromQ(q1, p.firstPositionMm), output = fromQ(q2, p.secondPositionMm);
  const radiusAt = (z: number) => z < p.firstPositionMm ? input.radiusAt(z) : z < p.secondPositionMm ? middle.radiusAt(z) : output.radiusAt(z);
  const firstRadiusMm = input.radiusAt(p.firstPositionMm), secondRadiusMm = middle.radiusAt(p.secondPositionMm);
  const radii = [0, 50, 100].map(d => output.radiusAt(p.secondPositionMm + d));
  if (output.waistPositionMm >= p.secondPositionMm && output.waistPositionMm <= p.secondPositionMm + 100) radii.push(output.waistMm);
  const nearCollimated = Math.max(...radii) / Math.min(...radii) < 1.01;
  const status = nearCollimated ? '近准直' : q2.real < 0 ? '出射会聚' : '出射发散';
  return { input, middle, output, q1, q2, radiusAt, spacingMm, firstRadiusMm, secondRadiusMm,
    expansion: secondRadiusMm / firstRadiusMm, nominalExpansion: p.secondFocalMm / p.firstFocalMm,
    observationRadiusMm: radiusAt(p.observationMm), divergenceMrad: output.divergenceMrad, status,
    intermediateWaist: middle.waistPositionMm > p.firstPositionMm && middle.waistPositionMm < p.secondPositionMm,
    observationRegion: p.observationMm < p.firstPositionMm ? '观察面在第一镜前' : p.observationMm < p.secondPositionMm ? '观察面在两镜之间' : '',
    paraxial: Math.max(input.divergenceMrad, middle.divergenceMrad, output.divergenceMrad) < 100 };
}
// A flat wavefront at lens 2 requires x/(x²+y²)=1/f₂. The larger root
// gives the larger output waist, and therefore the lower diffraction divergence.
export function collimatedPosition(p: ExpanderParameters): { positionMm: number | null; reason: string } {
  const { q1 } = gaussianExpander(p), discriminant = p.secondFocalMm ** 2 - 4 * q1.imaginary ** 2;
  if (discriminant < 0) return { positionMm: null, reason: '当前输入与第二镜焦距没有平波前解。' };
  const positionMm = p.firstPositionMm + (p.secondFocalMm + Math.sqrt(discriminant)) / 2 - q1.real;
  if (positionMm < p.firstPositionMm + 1 || positionMm > 1100) return { positionMm: null, reason: '准直镜距超出当前可调范围。' };
  return { positionMm, reason: '移动第二镜，使其出射波前为平面；取较大束腰解。' };
}
export function expanderBuilderCopy(p: ExpanderParameters): { experiment: Experiment | null; reason: string } {
  const b = gaussianExpander(p);
  if (p.waistPositionMm < 0 || p.waistPositionMm >= p.firstPositionMm || p.observationMm <= p.secondPositionMm || p.observationMm > 600 || p.secondPositionMm > 600)
    return { experiment: null, reason: '复制需满足 0 ≤ z₀ < z₁ < z₂ < z ≤ 600 mm。' };
  const diameters = [b.firstRadiusMm, b.secondRadiusMm].map(w => Math.max(25.4, w * 8));
  if (Math.max(...diameters, b.observationRadiusMm * 8) > 100) return { experiment: null, reason: '当前光斑超出搭建器可用口径。' };
  return { experiment: parseExperiment({ schemaVersion: 1, name: '激光扩束与准直', railLengthMm: 600, elements: [
    { ...makeElement('laser', p.waistPositionMm), wavelengthNm: p.wavelengthNm, waistMm: p.waistMm } as Laser,
    { ...makeElement('lens', p.firstPositionMm), focalLengthMm: p.firstKind * p.firstFocalMm, diameterMm: diameters[0] } as Lens,
    { ...makeElement('lens', p.secondPositionMm), focalLengthMm: p.secondFocalMm, diameterMm: diameters[1] } as Lens,
    { ...makeElement('screen', p.observationMm), sizeMm: Math.max(40, b.observationRadiusMm * 8) } as Screen,
  ] }), reason: '复制相同光束、两镜参数及观察位置。' };
}
export interface ExpanderHistory { past: ExpanderParameters[]; present: ExpanderParameters; future: ExpanderParameters[] }
export function expanderHistory(h: ExpanderHistory, a: { type: 'commit'; parameters: ExpanderParameters } | { type: 'undo' | 'redo' }): ExpanderHistory {
  if (a.type === 'commit') { const p = parseExpander(a.parameters); if (JSON.stringify(p) === JSON.stringify(h.present)) return h;
    return { past: [...h.past, h.present].slice(-80), present: p, future: [] }; }
  if (a.type === 'undo') return h.past.length ? { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] } : h;
  return h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h;
}

export interface ResonatorParameters {
  wavelengthNm: number; lengthMm: number; firstKind: number; firstRadiusMm: number;
  secondKind: number; secondRadiusMm: number; observationMm: number;
}
export const RESONATOR_DRAFT_KEY = 'optics-two-mirror-resonator:v1';
export const DEFAULT_RESONATOR: ResonatorParameters = { wavelengthNm: 532, lengthMm: 300, firstKind: 1, firstRadiusMm: 500, secondKind: 1, secondRadiusMm: 500, observationMm: 150 };
export const RESONATOR_FIELDS: { key: keyof ResonatorParameters; label: string; symbol: string; unit: string; min: number; max: number; step: number; tone: string }[] = [
  { key: 'wavelengthNm', label: '波长', symbol: 'λ', unit: 'nm', min: 380, max: 1100, step: 1, tone: 'wavelength' },
  { key: 'lengthMm', label: '镜间距', symbol: 'L', unit: 'mm', min: 10, max: 2000, step: 1, tone: 'lens' },
  { key: 'firstKind', label: '第一镜类型', symbol: '', unit: '', min: -1, max: 1, step: 1, tone: 'lens' },
  { key: 'firstRadiusMm', label: '第一镜曲率半径大小', symbol: '|R₁|', unit: 'mm', min: 20, max: 5000, step: 1, tone: 'lens' },
  { key: 'secondKind', label: '第二镜类型', symbol: '', unit: '', min: -1, max: 1, step: 1, tone: 'output' },
  { key: 'secondRadiusMm', label: '第二镜曲率半径大小', symbol: '|R₂|', unit: 'mm', min: 20, max: 5000, step: 1, tone: 'output' },
  { key: 'observationMm', label: '观察位置', symbol: 'z', unit: 'mm', min: 0, max: 2000, step: 1, tone: 'screen' },
];
export function parseResonator(value: unknown): ResonatorParameters {
  if (!value || typeof value !== 'object') throw new Error('谐振腔参数格式无效。');
  const p = value as ResonatorParameters;
  for (const f of RESONATOR_FIELDS) if (typeof p[f.key] !== 'number' || !Number.isFinite(p[f.key]) || p[f.key] < f.min || p[f.key] > f.max) throw new Error(`${f.label}超出有效范围。`);
  if (![1, 0, -1].includes(p.firstKind) || ![1, 0, -1].includes(p.secondKind)) throw new Error('腔镜类型无效。');
  return Object.fromEntries(RESONATOR_FIELDS.map(f => [f.key, p[f.key]])) as unknown as ResonatorParameters;
}
// Concave mirrors facing the cavity have positive signed radii; plane mirrors have zero reciprocal curvature.
export function resonator(p: ResonatorParameters) {
  const rho1 = p.firstKind / p.firstRadiusMm, rho2 = p.secondKind / p.secondRadiusMm;
  const g1 = 1 - p.lengthMm * rho1, g2 = 1 - p.lengthMm * rho2, product = g1 * g2;
  const confocal = g1 === 0 && g2 === 0;
  const stable = product > 0 && product < 1;
  const status = confocal ? '共焦（简并）' : stable ? '稳定' : product === 0 || product === 1 ? '临界' : '不稳定';
  let mode: { waistPositionMm: number; rayleighMm: number; waistMm: number; firstSpotMm: number; secondSpotMm: number; waistInside: boolean; radiusAt: (z: number) => number } | null = null;
  if (stable || confocal) {
    const denominator = g1 + g2 - 2 * product;
    const waistPositionMm = confocal ? p.lengthMm / 2 : p.lengthMm * g2 * (1 - g1) / denominator;
    const rayleighMm = confocal ? p.lengthMm / 2 : p.lengthMm * Math.sqrt(product * (1 - product)) / Math.abs(denominator);
    const waistMm = Math.sqrt(p.wavelengthNm * 1e-6 * rayleighMm / Math.PI);
    const radiusAt = (z: number) => waistMm * Math.hypot(1, (z - waistPositionMm) / rayleighMm);
    mode = { waistPositionMm, rayleighMm, waistMm, radiusAt, firstSpotMm: radiusAt(0), secondSpotMm: radiusAt(p.lengthMm), waistInside: waistPositionMm >= 0 && waistPositionMm <= p.lengthMm };
  }
  const observationInside = p.observationMm >= 0 && p.observationMm <= p.lengthMm;
  return { g1, g2, product, confocal, stable, status, mode, observationInside,
    observationRadiusMm: mode && observationInside ? mode.radiusAt(p.observationMm) : null,
    paraxial: !mode || p.wavelengthNm * 1e-6 / (Math.PI * mode.waistMm) < .1 };
}
export function stableLength(p: ResonatorParameters): number | null {
  if (resonator(p).stable) return p.lengthMm;
  const r1 = p.firstKind ? p.firstKind * p.firstRadiusMm : null, r2 = p.secondKind ? p.secondKind * p.secondRadiusMm : null;
  const roots = [10, 2000, r1, r2, r1 !== null && r2 !== null ? r1 + r2 : null].filter((n): n is number => n !== null && n >= 10 && n <= 2000);
  const boundaries = [...new Set(roots)].sort((a, b) => a - b);
  const candidates = boundaries.slice(1).map((n, i) => (n + boundaries[i]) / 2).filter(lengthMm => resonator({ ...p, lengthMm }).stable);
  return candidates.sort((a, b) => Math.abs(a - p.lengthMm) - Math.abs(b - p.lengthMm))[0] ?? null;
}
export interface ResonatorHistory { past: ResonatorParameters[]; present: ResonatorParameters; future: ResonatorParameters[] }
export function resonatorHistory(h: ResonatorHistory, a: { type: 'commit'; parameters: ResonatorParameters } | { type: 'undo' | 'redo' }): ResonatorHistory {
  if (a.type === 'commit') { const p = parseResonator(a.parameters); if (JSON.stringify(p) === JSON.stringify(h.present)) return h; return { past: [...h.past, h.present].slice(-80), present: p, future: [] }; }
  if (a.type === 'undo') return h.past.length ? { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] } : h;
  return h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h;
}

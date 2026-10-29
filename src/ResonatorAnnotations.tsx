import type { ResonatorParameters } from './resonator';
import { resonator } from './resonator';
export const ANNOTATIONS = ['lengthMm', 'firstRadiusMm', 'secondRadiusMm', 'observationMm', 'waistPosition', 'waistRadius', 'firstSpot', 'secondSpot', 'observationRadius'] as const;
export type Annotation = typeof ANNOTATIONS[number];
export const DEFAULT_ANNOTATIONS: Annotation[] = ['lengthMm', 'waistPosition', 'observationMm', 'observationRadius'];
export function readAnnotations(): Annotation[] {
  try { const a = JSON.parse(localStorage.getItem('optics-resonator-annotations:v1') ?? 'null'); if (Array.isArray(a)) return a.filter((k): k is Annotation => ANNOTATIONS.includes(k)); } catch { /* Use defaults. */ }
  return [...DEFAULT_ANNOTATIONS];
}
export default function ResonatorAnnotations({ parameters: p, layers, width, height, margin, x, y }: { parameters: ResonatorParameters; layers: Annotation[]; width: number; height: number; margin: { left: number; right: number; top: number; bottom: number }; x: (z: number) => number; y: (r: number) => number }) {
  const b = resonator(p), bottom = height - margin.bottom;
  const visible = (z: number) => x(z) >= margin.left && x(z) <= width - margin.right;
  const transverseVisible = (r: number) => y(r) >= margin.top && y(r) <= bottom;
  const horizontal = (key: Annotation, a: number, z: number, label: string, yy: number, color: string) => layers.includes(key) && visible(a) && visible(z) && <g key={key} data-testid={`resonator-annotation-${key}`} stroke={color} fill={color}><line x1={x(a)} x2={x(z)} y1={yy} y2={yy}/>{[a, z].map((v, i) => <line key={i} x1={x(v)} x2={x(v)} y1={yy - 4} y2={yy + 4}/>)}<text className="resonator-annotation-text" x={(x(a) + x(z)) / 2} y={yy - 7} textAnchor="middle" stroke="none">{label}</text></g>;
  const radius = (key: Annotation, z: number, r: number, label: string, dx: number, color: string) => layers.includes(key) && visible(z) && x(z) + dx >= margin.left && x(z) + dx <= width - margin.right && transverseVisible(0) && transverseVisible(r) && <g key={key} data-testid={`resonator-annotation-${key}`} stroke={color} fill={color}><line x1={x(z) + dx} x2={x(z) + dx} y1={y(0)} y2={y(r)}/>{[0, r].map(v => <line key={v} x1={x(z) + dx - 5} x2={x(z) + dx + 5} y1={y(v)} y2={y(v)}/>)}<text className="resonator-annotation-text" x={x(z) + dx + (dx < 0 ? -8 : 8)} y={(y(0) + y(r)) / 2} textAnchor={dx < 0 ? 'end' : 'start'} stroke="none">{label}</text></g>;
  return <g aria-label="物理量标注">
    {horizontal('lengthMm', 0, p.lengthMm, 'L', margin.top - 37, '#357fc6')}
    {p.firstKind !== 0 && horizontal('firstRadiusMm', 0, p.firstKind * p.firstRadiusMm, '|R₁|', margin.top - 64, '#357fc6')}
    {p.secondKind !== 0 && horizontal('secondRadiusMm', p.lengthMm, p.lengthMm - p.secondKind * p.secondRadiusMm, '|R₂|', margin.top - 79, '#8a5eac')}
    {[{ key: 'firstRadiusMm' as const, mirror: 0, center: p.firstKind * p.firstRadiusMm, kind: p.firstKind, label: 'C₁', color: '#357fc6', yy: margin.top - 64 }, { key: 'secondRadiusMm' as const, mirror: p.lengthMm, center: p.lengthMm - p.secondKind * p.secondRadiusMm, kind: p.secondKind, label: 'C₂', color: '#8a5eac', yy: margin.top - 79 }].map(c => c.kind !== 0 && layers.includes(c.key) && visible(c.mirror) && visible(c.center) && <g key={c.key}><circle cx={x(c.center)} cy={c.yy} r={3} fill={c.color}/><text className="resonator-annotation-text" x={x(c.center)} y={c.yy + 16} textAnchor="middle" fill={c.color}>{c.label}</text></g>)}
    {b.mode?.waistInside && horizontal('waistPosition', 0, b.mode.waistPositionMm, 'z₀', bottom + 29, '#8a5eac')}
    {b.mode?.waistInside && radius('waistRadius', b.mode.waistPositionMm, b.mode.waistMm, 'w₀', -20, '#8a5eac')}
    {b.mode && radius('firstSpot', 0, b.mode.firstSpotMm, 'w₁', 20, '#357fc6')}
    {b.mode && radius('secondSpot', p.lengthMm, b.mode.secondSpotMm, 'w₂', -20, '#8a5eac')}
    {b.observationRadiusMm !== null && radius('observationRadius', p.observationMm, b.observationRadiusMm, 'w(z)', 20, '#26836a')}
    {layers.includes('observationMm') && visible(p.observationMm) && <text data-testid="resonator-annotation-observationMm" className="gs-annotation-symbol" x={x(p.observationMm)} y={margin.top - 15} textAnchor="middle" fill="#26836a">z</text>}
  </g>;
}

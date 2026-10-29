import type { ReactNode } from 'react';
import { type ExpanderParameters, type gaussianExpander } from './gaussianExpander';

export type ExpanderAnnotation = Exclude<keyof ExpanderParameters, 'firstKind' | 'wavelengthNm'> | 'spacing' | 'firstRadius' | 'secondRadius' | 'observationRadius';
const KEYS: ExpanderAnnotation[] = ['waistMm', 'waistPositionMm', 'firstFocalMm', 'firstPositionMm', 'secondFocalMm', 'secondPositionMm', 'observationMm', 'spacing', 'firstRadius', 'secondRadius', 'observationRadius'];
export const isExpanderAnnotation = (key: string): key is ExpanderAnnotation => (KEYS as string[]).includes(key);
export const DEFAULT_EXPANDER_ANNOTATIONS: ExpanderAnnotation[] = ['waistPositionMm', 'firstPositionMm', 'secondPositionMm', 'observationMm', 'observationRadius'];
const STORAGE_KEY = 'optics-expander-annotations:v1';
export function readExpanderAnnotations(): ExpanderAnnotation[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(saved)) return [...new Set(saved.filter(k => typeof k === 'string' && isExpanderAnnotation(k)))] as ExpanderAnnotation[];
  } catch { /* Display preferences are optional. */ }
  return [...DEFAULT_EXPANDER_ANNOTATIONS];
}
export function saveExpanderAnnotations(layers: ExpanderAnnotation[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layers)); } catch { /* Keep the in-memory preference. */ }
}
export function QuantityLabel({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children?: ReactNode }) {
  return <button type="button" className="gexpander-quantity-label" aria-label={label} aria-pressed={active} title={active ? '点击隐藏图中标注' : '点击显示图中标注'} onClick={onClick}>{children ?? label}</button>;
}

export default function GaussianExpanderAnnotations({ parameters: p, beam, layers, width, height, margin, x, y, clipId }: {
  parameters: ExpanderParameters; beam: ReturnType<typeof gaussianExpander>; layers: ExpanderAnnotation[];
  width: number; height: number; margin: { left: number; right: number; top: number; bottom: number };
  x: (z: number) => number; y: (r: number) => number; clipId: string;
}) {
  const enabled = (k: ExpanderAnnotation) => layers.includes(k), axisY = y(0);
  const left = margin.left, right = width - margin.right, bottom = height - margin.bottom;
  const clampX = (v: number, padding = 0) => Math.min(right - padding, Math.max(left + padding, v));
  const inside = (z: number) => x(z) >= left && x(z) <= right;
  const insideY = (py: number) => py >= margin.top && py <= bottom;
  const format = (n: number) => Number(n.toPrecision(5)).toString();
  const radius = (key: ExpanderAnnotation, z: number, r: number, symbol: string, color: string, side = 1) => {
    if (!enabled(key) || !inside(z) || !insideY(axisY) || !insideY(y(r))) return null;
    const sx = x(z), top = y(r);
    side = sx > right - 100 ? -1 : sx < left + 100 ? 1 : side;
    const dx = clampX(sx + side * 22, 15), nearAxis = Math.abs(top - axisY) < 22;
    return <g data-testid={`expander-annotation-${key}`} stroke={color}>
      <line x1={sx} x2={dx} y1={top} y2={top}/><line x1={dx} x2={dx} y1={axisY} y2={top}/>
      {[axisY, top].map((py, i) => <line key={i} x1={dx - 4} x2={dx + 4} y1={py} y2={py}/>)}
      <text className="gfocus-dimension-label" x={clampX(dx + side * 9, 45)} y={nearAxis ? axisY + 27 : (axisY + top) / 2 + 5} textAnchor={side > 0 ? 'start' : 'end'} style={{ fill: color }}>{symbol}</text>
    </g>;
  };
  const distance = (key: ExpanderAnnotation, from: number, to: number, py: number, text: string, color: string) => {
    if (!enabled(key) || !inside(from) || !inside(to)) return null;
    const start = x(from), end = x(to);
    return <g data-testid={`expander-annotation-${key}`} stroke={color}>
      <line x1={start} x2={end} y1={py} y2={py}/>
      {[from, to].filter(inside).map((z, i) => <line key={i} x1={x(z)} x2={x(z)} y1={py - 4} y2={py + 4}/>)}
      <text className="gexpander-annotation-text" x={clampX((start + end) / 2, 65)} y={py - 8} textAnchor="middle" style={{ fill: color }}>{text}</text>
    </g>;
  };
  const focal = (key: 'firstFocalMm' | 'secondFocalMm', z: number, f: number, index: string, row: number, color: string) => enabled(key) && inside(z) && insideY(axisY) && <g>
    {distance(key, z, z + f, bottom - row, `f${index} = ${format(f)} mm`, color)}
    {[{ z: z - f, name: `F${index}` }, { z: z + f, name: `F′${index}` }].filter(v => inside(v.z)).map(v => <g key={v.name} stroke={color}>
      <line x1={x(v.z)} x2={x(v.z)} y1={axisY - 4} y2={axisY + 4}/>
      <text className="gexpander-annotation-text" x={clampX(x(v.z), 18)} y={axisY + (index === '₁' ? 23 : 43)} textAnchor="middle" style={{ fill: color }}>{v.name}</text>
    </g>)}
  </g>;
  return <g className="gexpander-annotations" pointerEvents="none">
    <g clipPath={`url(#${clipId})`} strokeWidth={1.3}>
      {p.waistPositionMm <= p.firstPositionMm && radius('waistMm', p.waistPositionMm, p.waistMm, 'w₀', '#c16b37')}
      {radius('firstRadius', p.firstPositionMm, beam.firstRadiusMm, 'w₁', '#357fc6')}
      {radius('secondRadius', p.secondPositionMm, beam.secondRadiusMm, 'w₂', '#8a5eac')}
      {radius('observationRadius', p.observationMm, beam.observationRadiusMm, 'w(z)', '#26836a')}
      {focal('firstFocalMm', p.firstPositionMm, p.firstKind * p.firstFocalMm, '₁', 20, '#357fc6')}
      {focal('secondFocalMm', p.secondPositionMm, p.secondFocalMm, '₂', 50, '#8a5eac')}
      {distance('spacing', p.firstPositionMm, p.secondPositionMm, bottom - 80, `d = ${format(beam.spacingMm)} mm`, '#62748a')}
    </g>
  </g>;
}

import { useEffect, useId, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { Minus, Plus } from 'lucide-react';
import { laserGain, GAIN_FIELDS, DEFAULT_GAIN, type LaserGainParameters } from './laserGain';
export const GAIN_LAYERS = ['lengthMm', 'smallSignalGain', 'probeIntensity', 'thresholdGain', 'steadyIntensity', 'outputIntensity'] as const;
export type GainLayer = typeof GAIN_LAYERS[number];
export type GainTab = 'output' | 'saturation';
export const DEFAULT_GAIN_LAYERS: GainLayer[] = ['lengthMm', 'smallSignalGain', 'thresholdGain', 'probeIntensity'];
type View = { startX: number; spanX: number; startY: number; spanY: number; zoom: number };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const fmt = (v: number) => v !== 0 && (Math.abs(v) < .0001 || Math.abs(v) > 1e5) ? v.toExponential(2) : Number(v.toPrecision(4)).toString();
function fit(tab: GainTab, p: LaserGainParameters): View {
  const b = laserGain(p);
  const spanX = tab === 'output' ? Math.max(4, p.smallSignalGain * 1.4, b.thresholdGain <= 50 ? b.thresholdGain * 1.4 : 0) : Math.max(4, p.probeIntensity * 1.4, b.steadyIntensity !== null && b.steadyIntensity <= 20 ? b.steadyIntensity * 1.4 : 0);
  const spanY = tab === 'output' ? Math.max(.25, (b.outputAt(Math.min(50, spanX)) ?? 0) * 1.2) : Math.max(1, p.smallSignalGain * 1.2, b.thresholdGain <= 50 ? b.thresholdGain * 1.2 : 0);
  return { startX: -spanX * .03, spanX: spanX * 1.06, startY: -spanY * .05, spanY: spanY * 1.1, zoom: 1 };
}
export default function LaserGainPlot({ parameters: p, tab, layers, resetView, start, change, finish }: { parameters: LaserGainParameters; tab: GainTab; layers: GainLayer[]; resetView: number; start: () => void; change: (field: keyof LaserGainParameters, value: number) => void; finish: () => void }) {
  const plot = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null), uid = useId().replace(/:/g, '');
  const [size, setSize] = useState({ width: 700, height: 450 });
  const [views, setViews] = useState<Record<GainTab, View>>(() => ({ output: fit('output', p), saturation: fit('saturation', p) }));
  const resetSeen = useRef(resetView);
  useEffect(() => { if (resetSeen.current !== resetView) { resetSeen.current = resetView; setViews({ output: fit('output', DEFAULT_GAIN), saturation: fit('saturation', DEFAULT_GAIN) }); } }, [resetView]);
  useEffect(() => { const el = plot.current; if (!el) return; const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0 && entry.contentRect.height > 0) setSize({ width: entry.contentRect.width, height: entry.contentRect.height }); }); observer.observe(el); return () => observer.disconnect(); }, []);
  const v = views[tab], b = laserGain(p), width = Math.max(240, size.width), height = Math.max(200, size.height), margin = { left: 65, right: 30, top: 40, bottom: 64 }, pw = width - margin.left - margin.right, ph = height - margin.top - margin.bottom;
  const x = (n: number) => margin.left + (n - v.startX) / v.spanX * pw, y = (n: number) => height - margin.bottom - (n - v.startY) / v.spanY * ph;
  const visibleX = (n: number) => n >= v.startX && n <= v.startX + v.spanX, visibleY = (n: number) => n >= v.startY && n <= v.startY + v.spanY;
  const field = tab === 'output' ? 'smallSignalGain' : 'probeIntensity', currentX = p[field], currentY = tab === 'output' ? b.outputIntensity : b.probeGain;
  const currentVisible = currentY !== null && visibleX(currentX) && visibleY(currentY);
  const setView = (next: View) => setViews(all => ({ ...all, [tab]: next }));
  const drag = useRef<{ id: number; field: typeof field | 'pan'; x: number; y: number; value: number; view: View; pw: number; ph: number } | null>(null);
  const move = (e: PointerEvent<SVGSVGElement>) => { const d = drag.current; if (!d || e.pointerId !== d.id) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (d.field === 'pan') setView({ ...d.view, startX: d.view.startX - dx / d.pw * d.view.spanX, startY: d.view.startY + dy / d.ph * d.view.spanY }); else { const f = GAIN_FIELDS.find(f => f.key === d.field)!; change(d.field, Number(clamp(d.value + dx / d.pw * d.view.spanX, f.min, f.max).toFixed(4))); } };
  const end = () => { if (drag.current?.field !== 'pan') finish(); drag.current = null; };
  const handle = { role: 'slider', tabIndex: 0, 'aria-label': tab === 'output' ? '图中小信号增益' : '图中试算相对光强', 'aria-valuemin': 0, 'aria-valuemax': tab === 'output' ? 50 : 20, 'aria-valuenow': p[field],
    onPointerDown: (e: PointerEvent<SVGGElement>) => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); e.currentTarget.focus(); start(); drag.current = { id: e.pointerId, field, x: e.clientX, y: e.clientY, value: p[field], view: v, pw, ph }; svg.current?.setPointerCapture(e.pointerId); },
    onKeyDown: (e: KeyboardEvent<SVGGElement>) => { if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault(); const max = tab === 'output' ? 50 : 20; start(); change(field, Number(clamp(p[field] + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? .1 : .01), 0, max).toFixed(4))); finish(); } };
  const zoom = (factor: number, rx = .5, ry = .5) => { const next = clamp(v.zoom * factor, .25, 16), scale = v.zoom / next; setView({ startX: v.startX + rx * v.spanX * (1 - scale), spanX: v.spanX * scale, startY: v.startY + (1 - ry) * v.spanY * (1 - scale), spanY: v.spanY * scale, zoom: next }); };
  const wheel = useRef<(e: WheelEvent) => void>(() => {});
  wheel.current = e => { e.preventDefault(); const box = plot.current!.getBoundingClientRect(); zoom(Math.exp(-e.deltaY * .0015), clamp((e.clientX - box.left - margin.left) / pw, 0, 1), clamp((e.clientY - box.top - margin.top) / ph, 0, 1)); };
  useEffect(() => { const el = plot.current; if (!el) return; const onWheel = (e: WheelEvent) => wheel.current(e); el.addEventListener('wheel', onWheel, { passive: false }); return () => el.removeEventListener('wheel', onWheel); }, []);
  const low = Math.max(0, v.startX), high = tab === 'output' ? Math.min(50, v.startX + v.spanX) : v.startX + v.spanX;
  const samples = low <= high ? [...Array.from({ length: 301 }, (_, i) => low + (high - low) * i / 300), ...(tab === 'output' && b.thresholdGain >= low && b.thresholdGain <= high ? [b.thresholdGain] : [])].sort((a, c) => a - c) : [];
  const points = samples.map(n => ({ x: n, y: tab === 'output' ? b.outputAt(n) : b.gainAt(n) })).filter((n): n is { x: number; y: number } => n.y !== null);
  const thresholdVisible = tab === 'output' ? visibleX(b.thresholdGain) : visibleY(b.thresholdGain);
  const marked = (key: GainLayer) => layers.includes(key);
  const locate = (xx: number, yy: number) => setView({ ...v, startX: xx - v.spanX / 2, startY: yy - v.spanY / 2 });
  return <><div ref={plot} className="gs-plot gain-chart">
    <div className="gfocus-outside">{!currentVisible && currentY !== null && <button onClick={() => locate(currentX, currentY)}>当前点在图外 · 定位</button>}{!thresholdVisible && <button onClick={() => locate(tab === 'output' ? b.thresholdGain : currentX, tab === 'output' ? 0 : b.thresholdGain)}>阈值在图外 · 定位</button>}{tab === 'saturation' && b.steadyIntensity !== null && b.above && !visibleX(b.steadyIntensity) && <button onClick={() => locate(b.steadyIntensity!, b.thresholdGain)}>稳态点在图外 · 定位</button>}</div>
    <svg ref={svg} viewBox={`0 0 ${width} ${height}`} data-testid="gain-plot" data-tab={tab} data-start-x={v.startX} data-span-x={v.spanX} data-start-y={v.startY} data-span-y={v.spanY} role="img" aria-label={tab === 'output' ? '出射相对光强随小信号增益的变化，可拖动当前点调节增益' : '增益随相对光强的饱和曲线，可拖动试算点'} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onPointerDown={e => { if (e.button !== 0) return; drag.current = { id: e.pointerId, field: 'pan', x: e.clientX, y: e.clientY, value: 0, view: v, pw, ph }; e.currentTarget.setPointerCapture(e.pointerId); }}>
      <defs><clipPath id={`${uid}-clip`}><rect x={margin.left} y={margin.top} width={pw} height={ph}/></clipPath></defs>
      {Array.from({ length: 6 }, (_, i) => { const xx = v.startX + v.spanX * i / 5; return <g key={i}><line className="gs-grid" x1={x(xx)} x2={x(xx)} y1={margin.top} y2={height - margin.bottom}/><text x={x(xx)} y={height - margin.bottom + 21} textAnchor="middle">{fmt(xx)}</text></g>; })}
      {Array.from({ length: 5 }, (_, i) => { const yy = v.startY + v.spanY * i / 4; return <g key={i}><line className="gs-grid" x1={margin.left} x2={width - margin.right} y1={y(yy)} y2={y(yy)}/><text x={margin.left - 8} y={y(yy) + 4} textAnchor="end">{fmt(yy)}</text></g>; })}
      <text className="gs-axis-label" x={margin.left} y={21}>{tab === 'output' ? '出射光强 / Iₛ' : '增益 / m⁻¹'}</text><text className="gs-axis-label" x={width - margin.right} y={height - 13} textAnchor="end">{tab === 'output' ? '小信号增益 g₀ / m⁻¹ →' : '相对光强 I / Iₛ →'}</text>
      <g clipPath={`url(#${uid}-clip)`}>
        <line className="gs-axis" x1={x(0)} x2={x(0)} y1={margin.top} y2={height - margin.bottom}/><line className="gs-axis" x1={margin.left} x2={width - margin.right} y1={y(0)} y2={y(0)}/>
        {points.length > 0 && <polyline data-testid="gain-curve" points={points.map(n => `${x(n.x)},${y(n.y)}`).join(' ')} fill="none" stroke={tab === 'output' ? '#8a5eac' : '#527fa9'} strokeWidth={2.6}/>}
        {marked('thresholdGain') && thresholdVisible && <g data-testid="gain-annotation-thresholdGain">{tab === 'output' ? <line x1={x(b.thresholdGain)} x2={x(b.thresholdGain)} y1={margin.top} y2={height - margin.bottom} stroke="#c38c53" strokeDasharray="5 5"/> : <line x1={margin.left} x2={width - margin.right} y1={y(b.thresholdGain)} y2={y(b.thresholdGain)} stroke="#c38c53" strokeDasharray="5 5"/>}<text className="gain-annotation-text" x={tab === 'output' ? x(b.thresholdGain) + 8 : margin.left + 8} y={tab === 'output' ? margin.top + 17 : y(b.thresholdGain) - 9} fill="#b27b43">gₜₕ</text></g>}
        {tab === 'saturation' && marked('smallSignalGain') && visibleY(p.smallSignalGain) && visibleX(0) && <g data-testid="gain-annotation-smallSignalGain"><circle cx={x(0)} cy={y(p.smallSignalGain)} r={3.5} fill="#c16b37"/><text className="gain-annotation-text" x={x(0) + 9} y={y(p.smallSignalGain) - 9} fill="#c16b37">g₀</text></g>}
        {currentVisible && <g className="gs-drag-handle" data-testid="gain-current-point" {...handle}><circle cx={x(currentX)} cy={y(currentY!)} r={16} fill="transparent"/>{marked(field) && <g data-testid={`gain-annotation-${field}`}><line x1={x(currentX)} x2={x(currentX)} y1={y(0)} y2={y(currentY!)} stroke="#26836a" strokeDasharray="3 4"/><text className="gain-annotation-text" x={x(currentX) + 11} y={y(currentY!) - 12} fill="#26836a">{tab === 'output' ? 'g₀' : 'I / Iₛ'}</text></g>}<circle cx={x(currentX)} cy={y(currentY!)} r={5} fill="#26836a" stroke="#fff" strokeWidth={2}/></g>}
        {tab === 'output' && marked('outputIntensity') && currentVisible && <g data-testid="gain-annotation-outputIntensity"><line x1={x(0)} x2={x(currentX)} y1={y(currentY!)} y2={y(currentY!)} stroke="#8a5eac" strokeDasharray="3 4"/><text className="gain-annotation-text" x={x(currentX) + 11} y={y(currentY!) + 21} fill="#8a5eac">Iₒᵤₜ / Iₛ</text></g>}
        {tab === 'saturation' && marked('steadyIntensity') && b.above && b.steadyIntensity !== null && visibleX(b.steadyIntensity) && visibleY(b.thresholdGain) && <g data-testid="gain-annotation-steadyIntensity"><circle cx={x(b.steadyIntensity)} cy={y(b.thresholdGain)} r={5} fill="#8a5eac" stroke="#fff" strokeWidth={2}/><line x1={x(b.steadyIntensity)} x2={x(b.steadyIntensity)} y1={y(0)} y2={y(b.thresholdGain)} stroke="#8a5eac" strokeDasharray="3 4"/><text className="gain-annotation-text" x={x(b.steadyIntensity) + 10} y={y(b.thresholdGain) + 22} fill="#8a5eac">稳态 I / Iₛ</text></g>}
      </g>
      {tab === 'output' && b.lossless && <text className="gain-empty" x={margin.left + pw / 2} y={margin.top + ph / 2} textAnchor="middle">理想无损：无法确定有限稳态输出</text>}
    </svg>
  </div><div className="gs-visual-footer"><div className="gs-plot-controls"><button className="icon-button" aria-label="缩小增益图" disabled={v.zoom <= .25} onClick={() => zoom(1 / 1.35)}><Minus size={16}/></button><span>{fmt(v.zoom)}×</span><button className="icon-button" aria-label="放大增益图" disabled={v.zoom >= 16} onClick={() => zoom(1.35)}><Plus size={16}/></button></div></div></>;
}

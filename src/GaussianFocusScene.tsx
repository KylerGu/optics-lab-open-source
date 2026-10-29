import SceneAssistantToggle from './SceneAssistantToggle';
import { useCallback, useEffect, useId, useReducer, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { BookOpen, ChevronLeft, Copy, Maximize, Minus, PanelLeftClose, PanelLeftOpen, Plus, Redo2, RotateCcw, ScanLine, Settings2, Undo2, X } from 'lucide-react';
import { DEFAULT_FOCUS, FOCUS_DRAFT_KEY, FOCUS_FIELDS, focusBuilderCopy, focusHistory, gaussianFocus, parseFocus, type FocusHistory, type FocusParameters } from './gaussianFocus';
import AssistantPanel from './AssistantPanel';
import type { SceneState } from './sceneRuntime';
import GaussianFocusFormulaSheet from './GaussianFocusFormulaSheet';
import { useScenePanelWidth } from './useScenePanelWidth';
import type { Experiment } from './model';
import './gaussian-scene.css';
import './gaussian-focus.css';

const fmt = (v: number, digits = 4) => !Number.isFinite(v) ? '∞' : (Math.abs(v) >= 1e6 || Math.abs(v) > 0 && Math.abs(v) < .0001) ? v.toExponential(3) : Math.abs(v) > 0 && Math.abs(v) < .01 ? Number(v.toPrecision(4)).toString() : Number(v.toFixed(digits)).toString();
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
type Field = keyof FocusParameters;
type View = { startMm: number; spanMm: number; radiusMm: number; centerRadiusMm: number };
function fitView(p: FocusParameters): View {
  const b = gaussianFocus(p);
  const positions = [0, 600, p.lensPositionMm, p.observationMm, p.waistPositionMm];
  // Extremely distant virtual waists remain a labelled out-of-view result.
  if (Math.abs(b.outputWaistPositionMm) < 5000) positions.push(b.outputWaistPositionMm);
  const min = Math.min(...positions), max = Math.max(...positions), span = Math.max(600, max - min) * 1.15;
  const startMm = (min + max - span) / 2;
  return { startMm, spanMm: span, radiusMm: Math.max(b.radiusAt(startMm), b.radiusAt(startMm + span), b.lensRadiusMm) * 1.2, centerRadiusMm: 0 };
}
function readFocus() {
  try { const stored = localStorage.getItem(FOCUS_DRAFT_KEY); if (stored) return parseFocus(JSON.parse(stored)); } catch { /* Preserve malformed saved data until a valid edit. */ }
  return { ...DEFAULT_FOCUS };
}

function Parameter({ field, value, start, finish, change }: { field: typeof FOCUS_FIELDS[number]; value: number; start: () => void; finish: () => void; change: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value)), [error, setError] = useState(false);
  useEffect(() => { setDraft(String(value)); setError(false); }, [value]);
  const submit = () => {
    const n = Number(draft);
    if (!draft.trim() || !Number.isFinite(n) || n < field.min || n > field.max) { setError(true); return; }
    setError(false); start(); change(n); finish();
  };
  const logarithmic = field.key === 'waistMm' || field.key === 'focalLengthMm';
  const fraction = logarithmic ? Math.log(value / field.min) / Math.log(field.max / field.min) : (value - field.min) / (field.max - field.min);
  return <div className={`gs-parameter gs-tone-${field.tone}`}>
    <label><span>{field.label}<i className="gs-quantity-symbol">{field.symbol}</i></span><div className="gs-number"><input aria-label={field.label} aria-invalid={error} type="number" min={field.min} max={field.max} step={field.step} value={draft} onChange={e => { setDraft(e.target.value); setError(false); }} onBlur={submit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /><span>{field.unit}</span></div></label>
    <input type="range" aria-label={`${field.label}滑杆`} min={logarithmic ? 0 : field.min} max={logarithmic ? 1000 : field.max} step={logarithmic ? 1 : field.step} value={logarithmic ? fraction * 1000 : value}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); start(); }} onChange={e => { start(); const n = Number(e.target.value); change(logarithmic ? Number((field.min * (field.max / field.min) ** (n / 1000)).toPrecision(6)) : n); }}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onBlur={finish} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) start(); }} onKeyUp={finish}
      style={{ '--range-fill': `${fraction * 100}%` } as CSSProperties} />
    {error && <small className="gs-error" role="alert">请输入 {field.min}–{field.max} {field.unit}。</small>}
  </div>;
}

export default function GaussianFocusScene({ onDirectory, onExplore, assistantOpen, onCloseAssistant }: { onDirectory: () => void; onExplore: (e: Experiment) => void; assistantOpen: boolean; onCloseAssistant: () => void }) {
  const [initial] = useState(readFocus);
  const [history, dispatch] = useReducer(focusHistory, { past: [], present: initial, future: [] } as FocusHistory);
  const [preview, setPreview] = useState<FocusParameters | null>(null);
  const p = preview ?? history.present;
  const latest = useRef(p); latest.current = p;
  const pending = useRef<FocusParameters | null>(null), gesture = useRef(false), raf = useRef<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(true), [resultsOpen, setResultsOpen] = useState(true), [formulaOpen, setFormulaOpen] = useState(false);
  const [view, setView] = useState(() => fitView(initial)), [zoom, setZoom] = useState(1);
  const [notice, setNotice] = useState(''), [saveFailed, setSaveFailed] = useState(false);
  const root = useRef<HTMLElement>(null), workspace = useRef<HTMLDivElement>(null), plot = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const layout = useScenePanelWidth(workspace, resultsOpen, panelOpen,{onLeftClose:()=>setPanelOpen(false),onRightClose:()=>setResultsOpen(false)});
  const [size, setSize] = useState({ width: 800, height: 550 });
  const uid = useId().replace(/:/g, '');
  const start = useCallback(() => { gesture.current = true; }, []);
  const change = useCallback((field: Field, value: number) => {
    const next = { ...latest.current, [field]: value };
    latest.current = next; pending.current = next;
    if (raf.current === null) raf.current = requestAnimationFrame(() => { raf.current = null; setPreview(pending.current); });
  }, []);
  const finish = useCallback(() => {
    if (!gesture.current) return;
    gesture.current = false;
    if (raf.current !== null) { cancelAnimationFrame(raf.current); raf.current = null; }
    if (pending.current) dispatch({ type: 'commit', parameters: pending.current });
    pending.current = null; setPreview(null);
  }, []);
  useEffect(() => () => { if (raf.current !== null) cancelAnimationFrame(raf.current); }, []);
  useEffect(() => { try { localStorage.setItem(FOCUS_DRAFT_KEY, JSON.stringify(history.present)); setSaveFailed(false); } catch { setSaveFailed(true); } }, [history.present]);
  useEffect(() => {
    const el = plot.current; if (!el) return;
    const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; if (width > 0 && height > 0) setSize({ width, height }); });
    observer.observe(el); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as Element)?.closest('input,textarea,select,[contenteditable=true]') || document.querySelector('dialog[open]')) return;
      if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); finish(); dispatch({ type: e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo' }); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [finish]);
  const beam = gaussianFocus(p), copy = focusBuilderCopy(p);
  const width = Math.max(240, size.width), height = Math.max(240, size.height);
  const margin = { left: 52, right: 26, top: 96, bottom: 64 };
  const pw = width - margin.left - margin.right, ph = height - margin.top - margin.bottom;
  const endMm = view.startMm + view.spanMm;
  const x = (z: number) => margin.left + (z - view.startMm) / view.spanMm * pw;
  const y = (r: number) => margin.top + ph / 2 - (r - view.centerRadiusMm) / view.radiusMm * ph / 2;
  const axisY = y(0), lensX = x(p.lensPositionMm), observationX = x(p.observationMm), waistX = x(beam.outputWaistPositionMm);
  const visible = (z: number) => z >= view.startMm && z <= endMm;
  const labelX = (z: number, halfWidth = 35) => clamp(x(z), margin.left + halfWidth, width - margin.right - halfWidth);
  const polyline = (low: number, high: number, radius: (z: number) => number, extras: number[] = []) => {
    if (low > high) return null;
    const positions = [...Array.from({ length: 241 }, (_, i) => low + (high - low) * i / 240), ...extras.filter(z => z >= low && z <= high)].sort((a, b) => a - b);
    const upper = positions.map(z => `${x(z)},${y(radius(z))}`).join(' '), lower = [...positions].reverse().map(z => `${x(z)},${y(-radius(z))}`).join(' ');
    return { upper, lower };
  };
  const inputPath = polyline(view.startMm, Math.min(endMm, p.lensPositionMm), beam.input.radiusAt, [p.waistPositionMm]);
  const outputPath = polyline(Math.max(view.startMm, p.lensPositionMm), endMm, beam.output.radiusAt, [beam.outputWaistPositionMm]);
  const virtualPath = beam.virtual ? polyline(Math.max(view.startMm, beam.outputWaistPositionMm), Math.min(endMm, p.lensPositionMm), beam.output.radiusAt, [beam.outputWaistPositionMm]) : null;
  const screenNearWaist = Math.abs(observationX - waistX) < 76 && !beam.observationBeforeLens && !beam.virtual;
  const drag = useRef<{ id: number; field: Field | 'pan'; clientX: number; clientY: number; value: number; view: View; pw: number; ph: number } | null>(null);
  const startDrag = (e: ReactPointerEvent<SVGElement>, field: Field) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.focus(); start();
    drag.current = { id: e.pointerId, field, clientX: e.clientX, clientY: e.clientY, value: latest.current[field], view, pw, ph };
    svg.current?.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.clientX, dy = e.clientY - d.clientY;
    if (d.field === 'pan') { setView({ ...d.view, startMm: d.view.startMm - dx / d.pw * d.view.spanMm, centerRadiusMm: d.view.centerRadiusMm + dy / d.ph * d.view.radiusMm * 2 }); return; }
    const f = FOCUS_FIELDS.find(f => f.key === d.field)!;
    change(d.field, Number(clamp(d.value + dx / d.pw * d.view.spanMm, f.min, f.max).toFixed(1)));
  };
  const endDrag = () => { if (drag.current?.field !== 'pan') finish(); drag.current = null; };
  const adjustZoom = (factor: number, rx = .5, ry = .5) => {
    const nextZoom = clamp(zoom * factor, .25, 16), scale = zoom / nextZoom;
    const spanMm = view.spanMm * scale, radiusMm = view.radiusMm * scale;
    const anchorZ = view.startMm + rx * view.spanMm, anchorR = view.centerRadiusMm + (1 - 2 * ry) * view.radiusMm;
    setView({ startMm: anchorZ - rx * spanMm, spanMm, radiusMm, centerRadiusMm: anchorR - (1 - 2 * ry) * radiusMm }); setZoom(nextZoom);
  };
  const wheelHandler = useRef<(e: WheelEvent) => void>(() => {});
  wheelHandler.current = e => {
    e.preventDefault(); const box = plot.current!.getBoundingClientRect();
    adjustZoom(Math.exp(-e.deltaY * .0015), clamp((e.clientX - box.left - margin.left) / pw, 0, 1), clamp((e.clientY - box.top - margin.top) / ph, 0, 1));
  };
  useEffect(() => { const el = plot.current; if (!el) return; const onWheel = (e: WheelEvent) => wheelHandler.current(e); el.addEventListener('wheel', onWheel, { passive: false }); return () => el.removeEventListener('wheel', onWheel); }, []);
  const keyboardMove = (e: React.KeyboardEvent<SVGGElement>, field: Field) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault(); const f = FOCUS_FIELDS.find(f => f.key === field)!; start();
    change(field, Number(clamp(latest.current[field] + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : .1), f.min, f.max).toFixed(1))); finish();
  };
  const handleProps = (field: Field, label: string) => ({ role: 'slider', tabIndex: 0, 'aria-label': label, 'aria-valuemin': FOCUS_FIELDS.find(f => f.key === field)!.min, 'aria-valuemax': FOCUS_FIELDS.find(f => f.key === field)!.max, 'aria-valuenow': p[field], onPointerDown: (e: ReactPointerEvent<SVGGElement>) => startDrag(e, field), onKeyDown: (e: React.KeyboardEvent<SVGGElement>) => keyboardMove(e, field) });
  const applyAssistant = (state: SceneState) => {
    if (state.sceneId !== 'gaussian-focus' || gesture.current || document.activeElement?.matches('.gaussian-focus-scene .gs-parameter input')) return false;
    try { const parameters = parseFocus(state.parameters); dispatch({ type: 'commit', parameters }); return true; } catch { return false; }
  };
  const restoreAssistant = (before: SceneState, after: SceneState) => {
    if (gesture.current || JSON.stringify(parseFocus(after.parameters)) !== JSON.stringify(latest.current)) return false;
    const previous = history.past.at(-1);
    if (previous && FOCUS_FIELDS.every(f => previous[f.key] === before.parameters[f.key])) {
      dispatch({ type: 'undo' }); return true;
    }
    return applyAssistant(before);
  };
  const focusAt = (z: number) => setView(v => ({ ...v, startMm: z - v.spanMm / 2, centerRadiusMm: 0 }));
  const spotExtent = Math.max(.05, beam.observationRadiusMm * 2.2), spotRadius = beam.observationRadiusMm / spotExtent * 100;
  const dimensions = (z: number, radius: number, symbol: string, color: string, side: number) => {
    const sx = x(z);
    side = sx > width - margin.right - 90 ? -1 : sx < margin.left + 90 ? 1 : side;
    const dx = clamp(sx + side * 20, margin.left + 15, width - margin.right - 15), pixels = Math.abs(y(radius) - axisY);
    return <g pointerEvents="none"><line x1={sx} x2={dx} y1={y(radius)} y2={y(radius)} stroke={color} /><line x1={dx} x2={dx} y1={axisY} y2={y(radius)} stroke={color} strokeWidth={1.5} /><line x1={dx - 4} x2={dx + 4} y1={axisY} y2={axisY} stroke={color}/><line x1={dx - 4} x2={dx + 4} y1={y(radius)} y2={y(radius)} stroke={color}/><text className="gfocus-dimension-label" x={clamp(dx + side * 9, margin.left + 25, width - margin.right - 25)} y={pixels < 20 ? axisY + 26 : (axisY + y(radius)) / 2 + 5} textAnchor={side > 0 ? 'start' : 'end'} style={{ fill: color }}>{symbol}</text></g>;
  };
  return <section ref={root} className={`gaussian-scene gaussian-focus-scene ${layout.resizing ? 'gs-panel-resizing' : ''}`} aria-label="高斯光束透镜聚焦场景">
    <div className="gs-heading"><div className="gs-title"><button className="icon-button" aria-label="返回仿真场景库" onClick={onDirectory}><ChevronLeft size={20}/></button><h1>高斯光束透镜聚焦</h1></div><div className="gs-heading-actions"><SceneAssistantToggle/><button className="gs-copy-button" disabled={!copy.experiment} title={copy.reason} onClick={() => { finish(); const result = focusBuilderCopy(latest.current); if (result.experiment) onExplore(result.experiment); }}><Copy size={16}/>复制到光路搭建</button><button className="outline-button" aria-haspopup="dialog" aria-expanded={formulaOpen} onClick={() => { finish(); setFormulaOpen(true); }}><BookOpen size={15}/>相关公式</button><button className="icon-button" aria-label="全屏查看场景" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen())?.catch(() => setNotice('浏览器未开启全屏。'))}><Maximize size={18}/></button></div></div>
    <div className="gs-workspace" ref={workspace}>
      {panelOpen && <><aside className="gs-sidebar" style={{ width: layout.width }} aria-label="聚焦参数"><div className="gs-sidebar-title"><h2><Settings2 size={16}/>参数调节</h2><button className="icon-button" aria-label="收起左侧参数" onClick={() => setPanelOpen(false)}><PanelLeftClose size={17}/></button></div><div className="gs-sidebar-scroll">
        {[{ title: '入射光束', keys: ['wavelengthNm', 'waistMm', 'waistPositionMm'] }, { title: '理想薄透镜', keys: ['focalLengthMm', 'lensPositionMm'] }, { title: '观察平面', keys: ['observationMm'] }].map(section => <section key={section.title}><h3>{section.title}</h3>{FOCUS_FIELDS.filter(f => section.keys.includes(f.key)).map(f => <Parameter key={f.key} field={f} value={p[f.key]} start={start} finish={finish} change={value => change(f.key, value)}/>)}</section>)}
      </div><div className="gs-sidebar-footer"><button className="text-button" onClick={() => { finish(); dispatch({ type: 'commit', parameters: DEFAULT_FOCUS }); setView(fitView(DEFAULT_FOCUS)); setZoom(1); }}><RotateCcw size={14}/>恢复默认</button><span>{saveFailed ? '本机保存不可用' : '已自动保存'}</span></div></aside><div className="gs-panel-resizer" {...layout.separator}/></>}
      <main className="gs-visual"><div className="gs-toolbar"><div className="gs-toolbar-left">{!panelOpen && <button className="icon-button" aria-label="展开左侧参数" onClick={() => setPanelOpen(true)}><PanelLeftOpen size={17}/></button>}<span className="gfocus-view-title">传播包络</span></div><div className="gs-toolbar-right"><button className="icon-button" aria-label="撤销聚焦参数" disabled={!history.past.length} onClick={() => { finish(); dispatch({ type: 'undo' }); }}><Undo2 size={16}/></button><button className="icon-button" aria-label="重做聚焦参数" disabled={!history.future.length} onClick={() => { finish(); dispatch({ type: 'redo' }); }}><Redo2 size={16}/></button>{!resultsOpen && <button className="gs-spot-toggle" aria-label="展开聚焦结果" onClick={() => setResultsOpen(true)}><ScanLine size={15}/>结果</button>}</div></div>
        <div className="gs-plot" ref={plot}>
          <div className="gfocus-outside">{!visible(p.lensPositionMm) && <button onClick={() => focusAt(p.lensPositionMm)}>透镜在视野外 · 定位</button>}{!visible(beam.outputWaistPositionMm) && <button onClick={() => focusAt(beam.outputWaistPositionMm)}>出射束腰在视野外 · 定位</button>}{!visible(p.observationMm) && <button onClick={() => focusAt(p.observationMm)}>观察位置在视野外 · 定位</button>}</div>
          <svg ref={svg} viewBox={`0 0 ${width} ${height}`} aria-label="透镜前后高斯光束传播包络，可拖动透镜、入射束腰和观察位置" data-testid="focus-plot" data-start-mm={view.startMm} data-span-mm={view.spanMm} data-radius-mm={view.radiusMm} data-center-radius-mm={view.centerRadiusMm} onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} onPointerDown={e => { if (e.button !== 0) return; drag.current = { id: e.pointerId, field: 'pan', clientX: e.clientX, clientY: e.clientY, value: 0, view, pw, ph }; e.currentTarget.setPointerCapture(e.pointerId); }}>
            <defs><clipPath id={`${uid}-clip`}><rect x={margin.left} y={margin.top} width={pw} height={ph}/></clipPath><linearGradient id={`${uid}-beam`}><stop stopColor="#9dc3ea" stopOpacity=".16"/><stop offset="1" stopColor="#78a9db" stopOpacity=".3"/></linearGradient></defs>
            {Array.from({ length: 6 }, (_, i) => { const z = view.startMm + view.spanMm * i / 5; return <g key={i}><line className="gs-grid" x1={x(z)} x2={x(z)} y1={margin.top} y2={height - margin.bottom}/><text x={x(z)} y={height - margin.bottom + 21} textAnchor="middle">{fmt(z, 1)}</text></g>; })}
            {[-1, -.5, 0, .5, 1].map(t => { const r = view.centerRadiusMm + t * view.radiusMm; return <g key={t}><line className="gs-grid" x1={margin.left} x2={width - margin.right} y1={y(r)} y2={y(r)}/><text x={margin.left - 8} y={y(r) + 4} textAnchor="end">{fmt(r, 3)}</text></g>; })}
            <text className="gs-axis-label" x={margin.left} y={margin.top - 70}>横向 / mm</text><text className="gs-axis-label" x={width - margin.right} y={height - 15} textAnchor="end">位置 z / mm →</text>
            <g clipPath={`url(#${uid}-clip)`}>
              <line className="gs-axis" x1={margin.left} x2={width - margin.right} y1={axisY} y2={axisY}/>
              {[inputPath, outputPath].map((path, i) => path && <g key={i} data-testid={i === 0 ? 'focus-input-envelope' : 'focus-output-envelope'}><polygon points={`${path.upper} ${path.lower}`} fill={`url(#${uid}-beam)`}/><polyline points={path.upper} fill="none" stroke="#607fa7" strokeWidth={2.6}/><polyline points={path.lower} fill="none" stroke="#607fa7" strokeWidth={2.6}/></g>)}
              {virtualPath && <g data-testid="focus-virtual-envelope"><polyline points={virtualPath.upper} fill="none" stroke="#8a5eac" strokeDasharray="5 5"/><polyline points={virtualPath.lower} fill="none" stroke="#8a5eac" strokeDasharray="5 5"/></g>}
              {visible(beam.outputWaistPositionMm) && <g data-testid="focus-output-waist" data-position-mm={beam.outputWaistPositionMm}><line x1={waistX} x2={waistX} y1={margin.top} y2={height - margin.bottom} stroke="#8a5eac" strokeDasharray="4 5"/><circle cx={waistX} cy={axisY} r={5} fill="#8a5eac" stroke="#fff" strokeWidth={2}/>{!screenNearWaist && dimensions(beam.outputWaistPositionMm, beam.outputWaistMm, 'w′₀', '#8a5eac', waistX < lensX ? -1 : 1)}</g>}
              {visible(p.waistPositionMm) && <g className="gs-drag-handle" data-testid="focus-input-waist" {...handleProps('waistPositionMm', '图中入射束腰位置')}><rect x={x(p.waistPositionMm) - 12} y={margin.top} width={24} height={ph} fill="transparent"/><line x1={x(p.waistPositionMm)} x2={x(p.waistPositionMm)} y1={margin.top} y2={height - margin.bottom} stroke="#c16b37" strokeDasharray="3 5"/><circle cx={x(p.waistPositionMm)} cy={axisY} r={5} fill="#c16b37" stroke="#fff" strokeWidth={2}/></g>}
              {visible(p.lensPositionMm) && <g className="gs-drag-handle" data-testid="focus-lens" {...handleProps('lensPositionMm', '图中透镜位置')}><rect x={lensX - 14} y={margin.top} width={28} height={ph} fill="transparent"/><path d={`M${lensX} ${margin.top + 12} Q${lensX + 19} ${margin.top + ph / 2} ${lensX} ${height - margin.bottom - 12} Q${lensX - 19} ${margin.top + ph / 2} ${lensX} ${margin.top + 12}Z`} fill="#c4dcf3" fillOpacity=".38" stroke="#357fc6" strokeWidth={1.8}/><circle cx={lensX} cy={axisY} r={5} fill="#357fc6" stroke="#fff" strokeWidth={2}/></g>}
              {visible(p.observationMm) && <g className="gs-drag-handle" data-testid="focus-observation" {...handleProps('observationMm', '图中观察位置')}><rect x={observationX - 12} y={margin.top} width={24} height={ph} fill="transparent"/><line x1={observationX} x2={observationX} y1={margin.top} y2={height - margin.bottom} stroke="#26836a" strokeWidth={1.8}/><circle cx={observationX} cy={axisY} r={5} fill="#fff" stroke="#26836a" strokeWidth={2}/>{dimensions(p.observationMm, beam.observationRadiusMm, screenNearWaist && Math.abs(p.observationMm - beam.outputWaistPositionMm) < 1e-6 ? 'w(z)=w′₀' : 'w(z)', '#26836a', observationX > width - margin.right - 85 ? -1 : 1)}</g>}
            </g>
            {visible(p.waistPositionMm) && <g className="gs-drag-handle" {...handleProps('waistPositionMm', '入射束腰位置顶部把手')}><rect x={labelX(p.waistPositionMm) - 14} y={margin.top - 65} width={28} height={18} fill="transparent"/><text className="gs-annotation-symbol" x={labelX(p.waistPositionMm)} y={margin.top - 50} textAnchor="middle" style={{ fill: '#c16b37' }}>z₀</text></g>}
            {visible(p.lensPositionMm) && <g className="gs-drag-handle" {...handleProps('lensPositionMm', '透镜位置顶部把手')}><rect x={labelX(p.lensPositionMm) - 14} y={margin.top - 33} width={28} height={18} fill="transparent"/><text className="gs-annotation-symbol" x={labelX(p.lensPositionMm)} y={margin.top - 18} textAnchor="middle" style={{ fill: '#357fc6' }}>zᴸ</text></g>}
            {visible(p.observationMm) && <g className="gs-drag-handle" {...handleProps('observationMm', '观察位置顶部把手')}><rect x={labelX(p.observationMm) - 14} y={margin.top - 49} width={28} height={18} fill="transparent"/><text className="gs-annotation-symbol" x={labelX(p.observationMm)} y={margin.top - 34} textAnchor="middle" style={{ fill: '#26836a' }}>z</text></g>}
            {visible(beam.outputWaistPositionMm) && <text className="gs-annotation-symbol" x={labelX(beam.outputWaistPositionMm, beam.virtual ? 60 : 35)} y={height - 23} textAnchor="middle" style={{ fill: '#8a5eac' }}>z′₀{beam.virtual ? '（延拓）' : ''}</text>}
          </svg>
        </div><div className="gs-visual-footer"><div className="gs-plot-controls"><button className="icon-button" aria-label="缩小传播图" disabled={zoom <= .25} onClick={() => adjustZoom(1 / 1.35)}><Minus size={16}/></button><span>{fmt(zoom, 2)}×</span><button className="icon-button" aria-label="放大传播图" disabled={zoom >= 16} onClick={() => adjustZoom(1.35)}><Plus size={16}/></button></div></div>
      </main>
      {resultsOpen && <><div className="gs-panel-resizer" {...layout.results.separator}/><aside className="gs-sidebar gfocus-results" style={{ width: layout.results.width }} aria-label="聚焦结果"><div className="gs-sidebar-title"><h2>聚焦结果</h2><button className="icon-button" aria-label="收起聚焦结果" onClick={() => setResultsOpen(false)}><X size={17}/></button></div><div className="gs-sidebar-scroll">
        <section className="gs-readouts gfocus-main-readouts"><div className="gs-primary-reading gs-tone-output"><small>出射束腰位置 <i className="gs-quantity-symbol">z′₀</i></small><strong data-testid="focus-waist-position">{fmt(beam.outputWaistPositionMm, 3)}<span>mm</span></strong></div><p className="gfocus-result-note">{beam.virtual ? '透镜前方（延拓）' : Math.abs(beam.waistDistanceMm) < 1e-8 ? '位于透镜平面' : `透镜后 ${fmt(beam.waistDistanceMm, 3)} mm`}</p><div className="gs-primary-reading gs-tone-output"><small>{beam.virtual ? '延拓束腰半径' : '最小光斑半径'} <i className="gs-quantity-symbol">w′₀</i></small><strong data-testid="focus-waist-radius">{fmt(beam.outputWaistMm)}<span>mm</span></strong></div>{beam.virtual && <p className="gfocus-result-note">出射段最小半径 {fmt(beam.minimumForwardMm)} mm</p>}<div className="gs-primary-reading gs-tone-screen"><small>观察光斑半径 <i className="gs-quantity-symbol">w(z)</i></small><strong data-testid="focus-observation-radius">{fmt(beam.observationRadiusMm)}<span>mm</span></strong></div>{beam.observationBeforeLens && <p className="gfocus-result-note">观察面在透镜前</p>}{beam.nearlyParallel && <p className="gfocus-result-note">出射近平行</p>}{!beam.paraxial && <p className="gs-error">超出小角度范围</p>}</section>
        <section className="gfocus-spot"><div className="gs-spot-heading"><div><h2>观察平面光斑</h2><p>z = {fmt(p.observationMm, 1)} mm</p></div></div><svg className="gs-spot-image" viewBox="0 0 230 230" role="img" aria-label="观察位置的高斯光斑，按当前中心光强归一化"><defs><radialGradient id={`${uid}-spot`}>{Array.from({ length: 49 }, (_, i) => <stop key={i} offset={i / 48} stopColor="#9cc8ff" stopOpacity={Math.exp(-2 * (i / 48 * 3) ** 2)}/>)}</radialGradient></defs><rect width={230} height={230} rx={12} fill="#10203a"/><circle cx={115} cy={115} r={spotRadius * 3} fill={`url(#${uid}-spot)`}/><circle cx={115} cy={115} r={spotRadius} fill="none" stroke="#abe1ce" strokeDasharray="3 4"/><g className="gs-spot-annotations"><line x1={115} x2={115 + spotRadius} y1={115} y2={115}/><text x={115 + spotRadius / 2} y={105} textAnchor="middle">w(z)</text></g><text x={115} y={216} fill="#aac3df" fontSize={10} textAnchor="middle">横向范围 ±{fmt(spotExtent, 3)} mm</text></svg></section>
      </div></aside></>}
    </div><div className="gs-model-strip"><span>横纵比例不同</span></div>
    {formulaOpen && <GaussianFocusFormulaSheet parameters={p} onClose={() => setFormulaOpen(false)}/>}
    {assistantOpen && <aside className="gs-drawer gs-assistant" aria-label="场景AI助手"><button className="gs-assistant-close icon-button" aria-label="关闭场景AI助手" onClick={onCloseAssistant}><X size={18}/></button><AssistantPanel sceneState={{ version: 1, sceneId: 'gaussian-focus', parameters: { ...p } }} editing={gesture.current || preview !== null} onApplyScene={applyAssistant} onRestoreScene={restoreAssistant}/></aside>}
    {notice && <div className="gs-notice" role="status">{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15}/></button></div>}
  </section>;
}

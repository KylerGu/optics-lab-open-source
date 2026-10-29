import SceneAssistantToggle from './SceneAssistantToggle';
import { useCallback, useEffect, useId, useReducer, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { BookOpen, ChevronLeft, Maximize, Minus, PanelLeftClose, PanelLeftOpen, Plus, Redo2, RotateCcw, ScanLine, Settings2, Undo2, X } from 'lucide-react';
import { DEFAULT_RESONATOR, RESONATOR_DRAFT_KEY, RESONATOR_FIELDS, resonatorHistory, resonator, parseResonator, type ResonatorHistory, type ResonatorParameters, stableLength } from './resonator';
import AssistantPanel from './AssistantPanel';
import type { SceneState } from './sceneRuntime';
import ResonatorFormulaSheet from './ResonatorFormulaSheet';
import ResonatorAnnotations, { DEFAULT_ANNOTATIONS, readAnnotations, type Annotation } from './ResonatorAnnotations';
import ResonatorStabilityDiagram from './ResonatorStabilityDiagram';
import { useScenePanelWidth } from './useScenePanelWidth';
import './gaussian-scene.css';
import './gaussian-focus.css';
import './resonator-scene.css';

const fmt = (v: number, digits = 4) => !Number.isFinite(v) ? '∞' : (Math.abs(v) >= 1e6 || Math.abs(v) > 0 && Math.abs(v) < .0001) ? v.toExponential(3) : Math.abs(v) > 0 && Math.abs(v) < .01 ? Number(v.toPrecision(4)).toString() : Number(v.toFixed(digits)).toString();
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
type Field = keyof ResonatorParameters;
type View = { startMm: number; spanMm: number; radiusMm: number; centerRadiusMm: number };
function fitView(p: ResonatorParameters): View {
  const b = resonator(p), max = Math.max(p.lengthMm, p.observationMm, 300), span = max * 1.18;
  return { startMm: (max - span) / 2, spanMm: span, radiusMm: b.mode ? Math.max(b.mode.firstSpotMm, b.mode.secondSpotMm) * 1.4 : 1, centerRadiusMm: 0 };
}
function readResonator() {
  try { const stored = localStorage.getItem(RESONATOR_DRAFT_KEY); if (stored) return parseResonator(JSON.parse(stored)); } catch { /* Preserve malformed saved data until a valid edit. */ }
  return { ...DEFAULT_RESONATOR };
}

function QuantityLabel({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className="resonator-quantity-label" title={active ? '点击隐藏图中标注' : '点击显示图中标注'} aria-label={label} aria-pressed={active} onClick={onClick}>{children}</button>;
}
function Parameter({ field, value, start, finish, change, marked, toggle }: { field: typeof RESONATOR_FIELDS[number]; value: number; start: () => void; finish: () => void; change: (value: number) => void; marked: boolean; toggle?: () => void }) {
  const [draft, setDraft] = useState(String(value)), [error, setError] = useState(false);
  useEffect(() => { setDraft(String(value)); setError(false); }, [value]);
  const submit = () => {
    const n = Number(draft);
    if (!draft.trim() || !Number.isFinite(n) || n < field.min || n > field.max) { setError(true); return; }
    setError(false); start(); change(n); finish();
  };
  const logarithmic = field.key === 'firstRadiusMm' || field.key === 'secondRadiusMm';
  const fraction = logarithmic ? Math.log(value / field.min) / Math.log(field.max / field.min) : (value - field.min) / (field.max - field.min);
  return <div className={`gs-parameter gs-tone-${field.tone}`}>
    <div className="resonator-parameter-line">{toggle ? <QuantityLabel label={field.label} active={marked} onClick={toggle}>{field.label}<i className="gs-quantity-symbol">{field.symbol}</i></QuantityLabel> : <span className="resonator-quantity-text">{field.label}<i className="gs-quantity-symbol">{field.symbol}</i></span>}<div className="gs-number"><input aria-label={field.label} aria-invalid={error} type="number" min={field.min} max={field.max} step={field.step} value={draft} onChange={e => { setDraft(e.target.value); setError(false); }} onBlur={submit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /><span>{field.unit}</span></div></div>
    <input type="range" aria-label={`${field.label}滑杆`} min={logarithmic ? 0 : field.min} max={logarithmic ? 1000 : field.max} step={logarithmic ? 1 : field.step} value={logarithmic ? fraction * 1000 : value}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); start(); }} onChange={e => { start(); const n = Number(e.target.value); change(logarithmic ? Number((field.min * (field.max / field.min) ** (n / 1000)).toPrecision(6)) : n); }}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onBlur={finish} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) start(); }} onKeyUp={finish}
      style={{ '--range-fill': `${fraction * 100}%` } as CSSProperties} />
    {error && <small className="gs-error" role="alert">请输入 {field.min}–{field.max} {field.unit}。</small>}
  </div>;
}

export default function ResonatorScene({ onDirectory, assistantOpen, onCloseAssistant }: { onDirectory: () => void; assistantOpen: boolean; onCloseAssistant: () => void }) {
  const [initial] = useState(readResonator);
  const [history, dispatch] = useReducer(resonatorHistory, { past: [], present: initial, future: [] } as ResonatorHistory);
  const [preview, setPreview] = useState<ResonatorParameters | null>(null);
  const p = preview ?? history.present;
  const latest = useRef(p); latest.current = p;
  const pending = useRef<ResonatorParameters | null>(null), gesture = useRef(false), raf = useRef<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(true), [resultsOpen, setResultsOpen] = useState(true), [formulaOpen, setFormulaOpen] = useState(false);
  const [annotations, setAnnotations] = useState(readAnnotations);
  const annotated = (key: Annotation) => annotations.includes(key);
  const toggleAnnotation = (key: Annotation) => setAnnotations(layers => layers.includes(key) ? layers.filter(k => k !== key) : [...layers, key]);
  const quantityLabel = (key: Annotation, label: string, symbol?: string) => <QuantityLabel label={label} active={annotated(key)} onClick={() => toggleAnnotation(key)}>{label}{symbol && <i className="gs-quantity-symbol">{symbol}</i>}</QuantityLabel>;
  useEffect(() => { try { localStorage.setItem('optics-resonator-annotations:v1', JSON.stringify(annotations)); } catch { /* Labels remain usable without storage. */ } }, [annotations]);
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
  useEffect(() => { try { localStorage.setItem(RESONATOR_DRAFT_KEY, JSON.stringify(history.present)); setSaveFailed(false); } catch { setSaveFailed(true); } }, [history.present]);
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
  const beam = resonator(p), stableDistance = stableLength(p);
  const width = Math.max(240, size.width), height = Math.max(240, size.height);
  const margin = { left: 52, right: 26, top: 96, bottom: 64 };
  const pw = width - margin.left - margin.right, ph = height - margin.top - margin.bottom;
  const endMm = view.startMm + view.spanMm;
  const x = (z: number) => margin.left + (z - view.startMm) / view.spanMm * pw;
  const y = (r: number) => margin.top + ph / 2 - (r - view.centerRadiusMm) / view.radiusMm * ph / 2;
  const axisY = y(0), observationX = x(p.observationMm);
  const visible = (z: number) => z >= view.startMm && z <= endMm;
  const labelX = (z: number, halfWidth = 35) => clamp(x(z), margin.left + halfWidth, width - margin.right - halfWidth);
  const polyline = (low: number, high: number, radius: (z: number) => number, extras: number[] = []) => {
    if (low > high) return null;
    const positions = [...Array.from({ length: 241 }, (_, i) => low + (high - low) * i / 240), ...extras.filter(z => z >= low && z <= high)].sort((a, b) => a - b);
    const upper = positions.map(z => `${x(z)},${y(radius(z))}`).join(' '), lower = [...positions].reverse().map(z => `${x(z)},${y(-radius(z))}`).join(' ');
    return { upper, lower };
  };
  const envelope = beam.mode ? polyline(Math.max(0, view.startMm), Math.min(p.lengthMm, endMm), beam.mode.radiusAt, [beam.mode.waistPositionMm]) : null;
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
    const f = RESONATOR_FIELDS.find(f => f.key === d.field)!;
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
    e.preventDefault(); const f = RESONATOR_FIELDS.find(f => f.key === field)!; start();
    change(field, Number(clamp(latest.current[field] + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : .1), f.min, f.max).toFixed(1))); finish();
  };
  const handleProps = (field: Field, label: string) => ({ role: 'slider', tabIndex: 0, 'aria-label': label, 'aria-valuemin': RESONATOR_FIELDS.find(f => f.key === field)!.min, 'aria-valuemax': RESONATOR_FIELDS.find(f => f.key === field)!.max, 'aria-valuenow': p[field], onPointerDown: (e: ReactPointerEvent<SVGGElement>) => startDrag(e, field), onKeyDown: (e: React.KeyboardEvent<SVGGElement>) => keyboardMove(e, field) });
  const applyAssistant = (state: SceneState) => {
    if (state.sceneId !== 'resonators-0' || gesture.current || document.activeElement?.matches('.resonator-scene .gs-parameter input')) return false;
    try { const parameters = parseResonator(state.parameters); dispatch({ type: 'commit', parameters }); return true; } catch { return false; }
  };
  const restoreAssistant = (before: SceneState, after: SceneState) => {
    if (gesture.current || JSON.stringify(parseResonator(after.parameters)) !== JSON.stringify(latest.current)) return false;
    const previous = history.past.at(-1);
    if (previous && RESONATOR_FIELDS.every(f => previous[f.key] === before.parameters[f.key])) {
      dispatch({ type: 'undo' }); return true;
    }
    return applyAssistant(before);
  };
  const focusAt = (z: number) => setView(v => ({ ...v, startMm: z - v.spanMm / 2, centerRadiusMm: 0 }));
  const spotExtent = beam.observationRadiusMm === null ? 1 : Math.max(.05, beam.observationRadiusMm * 2.2), spotRadius = (beam.observationRadiusMm ?? 0) / spotExtent * 100;
  const readout = (key: Annotation, label: string, value: number | null, symbol: string, canMark = true) => <div className="gs-primary-reading gs-tone-output"><small>{canMark && value !== null ? quantityLabel(key, label, symbol) : <>{label}<i className="gs-quantity-symbol">{symbol}</i></>}</small><strong data-testid={`resonator-reading-${key}`}>{value === null ? '—' : fmt(value)}{value !== null && <span>mm</span>}</strong></div>;
  const mirrorType = (field: 'firstKind' | 'secondKind', label: string) => <div className="resonator-type"><label>{label}<select aria-label={label} value={p[field]} onChange={e => { finish(); dispatch({ type: 'commit', parameters: { ...latest.current, [field]: Number(e.target.value) } }); }}><option value={1}>凹面镜</option><option value={0}>平面镜</option><option value={-1}>凸面镜</option></select></label></div>;
  return <section ref={root} className={`gaussian-scene gaussian-focus-scene resonator-scene ${layout.resizing ? 'gs-panel-resizing' : ''}`} aria-label="两镜谐振腔稳定性场景">
    <div className="gs-heading"><div className="gs-title"><button className="icon-button" aria-label="返回仿真场景库" onClick={onDirectory}><ChevronLeft size={20}/></button><h1>两镜谐振腔稳定性</h1></div><div className="gs-heading-actions"><SceneAssistantToggle/><button className="outline-button" aria-haspopup="dialog" aria-expanded={formulaOpen} onClick={() => { finish(); setFormulaOpen(true); }}><BookOpen size={15}/>相关公式</button><button className="icon-button" aria-label="全屏查看场景" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen())?.catch(() => setNotice('浏览器未开启全屏。'))}><Maximize size={18}/></button></div></div>
    <div className="gs-workspace" ref={workspace}>
      {panelOpen && <><aside className="gs-sidebar" style={{ width: layout.width }} aria-label="谐振腔参数"><div className="gs-sidebar-title"><h2><Settings2 size={16}/>参数调节</h2><button className="icon-button" aria-label="收起左侧参数" onClick={() => setPanelOpen(false)}><PanelLeftClose size={17}/></button></div><div className="gs-sidebar-scroll">
        {[{ title: '腔参数', keys: ['wavelengthNm', 'lengthMm'] }, { title: '第一腔镜 · z = 0', keys: ['firstRadiusMm'] }, { title: '第二腔镜 · z = L', keys: ['secondRadiusMm'] }, { title: '观察平面', keys: ['observationMm'] }].map(section => <section key={section.title}><h3>{section.title}</h3>{section.keys.includes('firstRadiusMm') && mirrorType('firstKind', '第一镜类型')}{section.keys.includes('secondRadiusMm') && mirrorType('secondKind', '第二镜类型')}{RESONATOR_FIELDS.filter(f => section.keys.includes(f.key) && !(f.key === 'firstRadiusMm' && p.firstKind === 0) && !(f.key === 'secondRadiusMm' && p.secondKind === 0)).map(f => {
          const key = f.key as Annotation;
          // Curvature centers are not forced onto the plot when they are outside the view.
          const markable = f.key === 'lengthMm' || f.key === 'observationMm' || f.key === 'firstRadiusMm' && visible(0) && visible(p.firstKind * p.firstRadiusMm) || f.key === 'secondRadiusMm' && visible(p.lengthMm) && visible(p.lengthMm - p.secondKind * p.secondRadiusMm);
          return <Parameter key={f.key} field={f} value={p[f.key]} start={start} finish={finish} change={value => change(f.key, value)} marked={annotated(key)} toggle={markable ? () => toggleAnnotation(key) : undefined}/>;
        })}{section.keys.includes('lengthMm') && <div className="resonator-stabilize"><button className="text-button" disabled={beam.stable || stableDistance === null} title={stableDistance === null ? '当前腔镜在可调镜距内没有稳定区域' : '只调整镜间距，移到稳定区域内部'} onClick={() => { finish(); const lengthMm = stableLength(latest.current); if (lengthMm !== null) dispatch({ type: 'commit', parameters: { ...latest.current, lengthMm } }); }}>调到稳定</button></div>}</section>)}
      </div><div className="gs-sidebar-footer"><button className="text-button" onClick={() => { finish(); dispatch({ type: 'commit', parameters: DEFAULT_RESONATOR }); setView(fitView(DEFAULT_RESONATOR)); setZoom(1); setAnnotations([...DEFAULT_ANNOTATIONS]); }}><RotateCcw size={14}/>恢复默认</button><span>{saveFailed ? '本机保存不可用' : '已自动保存'}</span></div></aside><div className="gs-panel-resizer" {...layout.separator}/></>}
      <main className="gs-visual"><div className="gs-toolbar"><div className="gs-toolbar-left">{!panelOpen && <button className="icon-button" aria-label="展开左侧参数" onClick={() => setPanelOpen(true)}><PanelLeftOpen size={17}/></button>}<span className="gfocus-view-title">腔内光束</span></div><div className="gs-toolbar-right"><button className="icon-button" aria-label="撤销谐振腔参数" disabled={!history.past.length} onClick={() => { finish(); dispatch({ type: 'undo' }); }}><Undo2 size={16}/></button><button className="icon-button" aria-label="重做谐振腔参数" disabled={!history.future.length} onClick={() => { finish(); dispatch({ type: 'redo' }); }}><Redo2 size={16}/></button>{!resultsOpen && <button className="gs-spot-toggle" aria-label="展开谐振腔结果" onClick={() => setResultsOpen(true)}><ScanLine size={15}/>结果</button>}</div></div>
        <div className="gs-plot" ref={plot}>
          <div className="gfocus-outside">{[['第一镜', 0], ['第二镜', p.lengthMm], ['观察面', p.observationMm]].map(([name, position]) => !visible(Number(position)) && <button key={name} onClick={() => focusAt(Number(position))}>{name}在视野外 · 定位</button>)}</div>
          <svg ref={svg} viewBox={`0 0 ${width} ${height}`} aria-label="两镜谐振腔光束包络，可拖动第二镜和观察面" data-testid="resonator-plot" data-start-mm={view.startMm} data-span-mm={view.spanMm} data-radius-mm={view.radiusMm} data-center-radius-mm={view.centerRadiusMm} onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} onPointerDown={e => { if (e.button !== 0) return; drag.current = { id: e.pointerId, field: 'pan', clientX: e.clientX, clientY: e.clientY, value: 0, view, pw, ph }; e.currentTarget.setPointerCapture(e.pointerId); }}>
            <defs><clipPath id={`${uid}-clip`}><rect x={margin.left} y={margin.top} width={pw} height={ph}/></clipPath><linearGradient id={`${uid}-beam`}><stop stopColor="#9dc3ea" stopOpacity=".16"/><stop offset="1" stopColor="#78a9db" stopOpacity=".3"/></linearGradient></defs>
            {Array.from({ length: 6 }, (_, i) => { const z = view.startMm + view.spanMm * i / 5; return <g key={i}><line className="gs-grid" x1={x(z)} x2={x(z)} y1={margin.top} y2={height - margin.bottom}/><text x={x(z)} y={height - margin.bottom + 21} textAnchor="middle">{fmt(z, 1)}</text></g>; })}
            {[-1, -.5, 0, .5, 1].map(t => { const r = view.centerRadiusMm + t * view.radiusMm; return <g key={t}><line className="gs-grid" x1={margin.left} x2={width - margin.right} y1={y(r)} y2={y(r)}/><text x={margin.left - 8} y={y(r) + 4} textAnchor="end">{fmt(r, 3)}</text></g>; })}
            <text className="gs-axis-label" x={margin.left} y={margin.top - 70}>横向 / mm</text><text className="gs-axis-label" x={width - margin.right} y={height - 15} textAnchor="end">位置 z / mm →</text>
            <g clipPath={`url(#${uid}-clip)`}>
              <line className="gs-axis" x1={margin.left} x2={width - margin.right} y1={axisY} y2={axisY}/>
              {envelope && <g data-testid="resonator-envelope"><polygon points={`${envelope.upper} ${envelope.lower}`} fill={`url(#${uid}-beam)`}/><polyline points={envelope.upper} fill="none" stroke="#607fa7" strokeWidth={2.6}/><polyline points={envelope.lower} fill="none" stroke="#607fa7" strokeWidth={2.6}/></g>}
              {beam.mode?.waistInside && visible(beam.mode.waistPositionMm) && (annotated('waistPosition') || annotated('waistRadius')) && <g data-testid="resonator-waist"><line x1={x(beam.mode.waistPositionMm)} x2={x(beam.mode.waistPositionMm)} y1={margin.top} y2={height - margin.bottom} stroke="#8a5eac" strokeDasharray="4 5"/><circle cx={x(beam.mode.waistPositionMm)} cy={axisY} r={4} fill="#8a5eac" stroke="#fff" strokeWidth={2}/></g>}
              {[{ z: 0, kind: p.firstKind, index: 1, color: '#357fc6' }, { z: p.lengthMm, kind: p.secondKind, index: 2, color: '#8a5eac' }].map(({ z, kind, index, color }) => {
                const sx = x(z), side = index === 1 ? 1 : -1, top = margin.top + 12, bottom = height - margin.bottom - 12;
                return visible(z) && <g key={index} className={index === 2 ? 'gs-drag-handle' : ''} data-testid={`resonator-mirror-${index}`} {...(index === 2 ? handleProps('lengthMm', '图中第二镜位置') : {})}><rect x={sx - 14} y={margin.top} width={28} height={ph} fill="transparent"/><path d={kind === 0 ? `M${sx} ${top}V${bottom}` : `M${sx + side * kind * 16} ${top} Q${sx - side * kind * 16} ${(top + bottom) / 2} ${sx + side * kind * 16} ${bottom}`} fill="none" stroke={color} strokeWidth={4}/><circle cx={sx} cy={axisY} r={5} fill={color} stroke="#fff" strokeWidth={2}/></g>;
              })}
              {visible(p.observationMm) && <g className="gs-drag-handle" data-testid="resonator-observation" {...handleProps('observationMm', '图中观察位置')}><rect x={observationX - 12} y={margin.top} width={24} height={ph} fill="transparent"/><line x1={observationX} x2={observationX} y1={margin.top} y2={height - margin.bottom} stroke="#26836a" strokeWidth={1.8}/><circle cx={observationX} cy={axisY} r={5} fill="#fff" stroke="#26836a" strokeWidth={2}/></g>}
            </g>
            {!beam.mode && <text className="resonator-empty" x={margin.left + pw / 2} y={margin.top + 28} textAnchor="middle">{beam.status}：无稳定腔内高斯解</text>}
            {visible(0) && <text x={labelX(0)} y={margin.top - 14} textAnchor="middle" fill="#357fc6">M₁</text>}{visible(p.lengthMm) && <text x={labelX(p.lengthMm)} y={margin.top - 14} textAnchor="middle" fill="#8a5eac">M₂</text>}
            <ResonatorAnnotations parameters={p} layers={annotations} width={width} height={height} margin={margin} x={x} y={y}/>
          </svg>
        </div><div className="gs-visual-footer"><div className="gs-plot-controls"><button className="icon-button" aria-label="缩小传播图" disabled={zoom <= .25} onClick={() => adjustZoom(1 / 1.35)}><Minus size={16}/></button><span>{fmt(zoom, 2)}×</span><button className="icon-button" aria-label="放大传播图" disabled={zoom >= 16} onClick={() => adjustZoom(1.35)}><Plus size={16}/></button></div></div>
      </main>
      {resultsOpen && <><div className="gs-panel-resizer" {...layout.results.separator}/><aside className="gs-sidebar gfocus-results" style={{ width: layout.results.width }} aria-label="谐振腔结果"><div className="gs-sidebar-title"><h2>谐振腔结果</h2><button className="icon-button" aria-label="收起谐振腔结果" onClick={() => setResultsOpen(false)}><X size={17}/></button></div><div className="gs-sidebar-scroll">
        <section className="resonator-status"><p data-testid="resonator-status" className={`resonator-state ${beam.stable || beam.confocal ? 'is-stable' : 'is-unstable'}`}>{beam.status}</p><div className="gs-primary-reading"><small>稳定乘积 g₁g₂</small><strong data-testid="resonator-product">{fmt(beam.product)}</strong></div><div className="resonator-pair"><span>g₁ = {fmt(beam.g1)}</span><span>g₂ = {fmt(beam.g2)}</span></div><ResonatorStabilityDiagram g1={beam.g1} g2={beam.g2}/></section>
        <section className="gs-readouts gfocus-main-readouts">{readout('waistRadius', '束腰半径', beam.mode?.waistMm ?? null, 'w₀', beam.mode?.waistInside)}{readout('waistPosition', '束腰位置', beam.mode?.waistPositionMm ?? null, 'z₀', beam.mode?.waistInside)}{beam.confocal && <p className="gfocus-result-note">对称高斯解</p>}{beam.mode && !beam.mode.waistInside && <p className="gfocus-result-note">束腰在腔外延拓位置</p>}<div className="resonator-pair resonator-mirror-readings">{readout('firstSpot', '第一镜处半径', beam.mode?.firstSpotMm ?? null, 'w₁')}{readout('secondSpot', '第二镜处半径', beam.mode?.secondSpotMm ?? null, 'w₂')}</div>{!beam.paraxial && <p className="gs-error">超出小角度范围</p>}</section>
        <section className="gfocus-spot">{readout('observationRadius', '观察光斑半径', beam.observationRadiusMm, 'w(z)')}<div className="gs-spot-heading"><div><h2>观察平面光斑</h2><p>z = {fmt(p.observationMm, 1)} mm</p></div></div>{beam.observationRadiusMm !== null ? <svg className="gs-spot-image" viewBox="0 0 230 230" role="img" aria-label="腔内观察位置的高斯光斑，按中心光强归一化" data-testid="resonator-spot"><defs><radialGradient id={`${uid}-spot`}>{Array.from({ length: 49 }, (_, i) => <stop key={i} offset={i / 48} stopColor="#9cc8ff" stopOpacity={Math.exp(-2 * (i / 48 * 3) ** 2)}/>)}</radialGradient></defs><rect width={230} height={230} rx={12} fill="#10203a"/><circle cx={115} cy={115} r={spotRadius * 3} fill={`url(#${uid}-spot)`}/>{annotated('observationRadius') && <><circle cx={115} cy={115} r={spotRadius} fill="none" stroke="#abe1ce" strokeDasharray="3 4"/><g className="gs-spot-annotations"><line x1={115} x2={115 + spotRadius} y1={115} y2={115}/><text x={115 + spotRadius / 2} y={105} textAnchor="middle">w(z)</text></g></>}<text x={115} y={216} fill="#aac3df" fontSize={10} textAnchor="middle">横向范围 ±{fmt(spotExtent, 3)} mm</text></svg> : <p className="gfocus-result-note">{!beam.observationInside ? '观察面在腔外' : '当前无稳定光斑'}</p>}</section>
      </div></aside></>}
    </div><div className="gs-model-strip"><span>横纵比例不同</span></div>
    {formulaOpen && <ResonatorFormulaSheet parameters={p} onClose={() => setFormulaOpen(false)}/>}
    {assistantOpen && <aside className="gs-drawer gs-assistant" aria-label="场景AI助手"><button className="gs-assistant-close icon-button" aria-label="关闭场景AI助手" onClick={onCloseAssistant}><X size={18}/></button><AssistantPanel sceneState={{ version: 1, sceneId: 'resonators-0', parameters: { ...p } }} editing={gesture.current || preview !== null} onApplyScene={applyAssistant} onRestoreScene={restoreAssistant}/></aside>}
    {notice && <div className="gs-notice" role="status">{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15}/></button></div>}
  </section>;
}

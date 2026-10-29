import SceneAssistantToggle from './SceneAssistantToggle';
import { useCallback, useEffect, useId, useReducer, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { BookOpen, ChevronLeft, Maximize, Minus, PanelLeftClose, PanelLeftOpen, Plus, Redo2, RotateCcw, ScanLine, Settings2, Undo2, X } from 'lucide-react';
import { DEFAULT_WAVE, WAVE_DRAFT_KEY, WAVE_FIELDS, WAVE_SCENE_ID, parseWave, waveHistory, waveState, waveSuperposition, type WaveHistory, type WaveParameters } from './waveSuperposition';
import AssistantPanel from './AssistantPanel';
import SceneFormulaSheet from './SceneFormulaSheet';
import { useScenePanelWidth } from './useScenePanelWidth';
import { type SceneState, sceneKey } from './sceneRuntime';
import './gaussian-scene.css';
import './gaussian-focus.css';
import './resonator-scene.css';
import './wave-superposition.css';

type Field = keyof WaveParameters;
type Annotation = 'wavelengthNm' | 'amplitude1' | 'amplitude2' | 'observationUm' | 'amplitude' | 'first' | 'second' | 'sum';
const ANNOTATIONS: Annotation[] = ['wavelengthNm', 'amplitude1', 'amplitude2', 'observationUm', 'amplitude', 'first', 'second', 'sum'];
const DEFAULT_ANNOTATIONS: Annotation[] = ['wavelengthNm', 'observationUm', 'first', 'second', 'sum'];
const ANNOTATION_KEY = 'optics-wave-superposition-annotations:v2';
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const fmt = (n: number) => Math.abs(n) < 1e-10 ? '0' : Math.abs(n) < .0001 ? n.toExponential(3) : Number(n.toFixed(4)).toString();
function readWave() {
  try { const stored = localStorage.getItem(WAVE_DRAFT_KEY); if (stored) { const s = JSON.parse(stored); if (s.version === 1 && s.sceneId === WAVE_SCENE_ID) return parseWave(s.parameters); } } catch { /* Fall back to a valid scene. */ }
  return { ...DEFAULT_WAVE };
}
function readAnnotations(): Annotation[] {
  try { const a = JSON.parse(localStorage.getItem(ANNOTATION_KEY) ?? 'null'); if (Array.isArray(a)) return a.filter((k): k is Annotation => ANNOTATIONS.includes(k)); } catch { /* Optional preferences. */ }
  return [...DEFAULT_ANNOTATIONS];
}
function QuantityLabel({ label, symbol, active, onClick }: { label: string; symbol: string; active: boolean; onClick: () => void }) {
  return <button type="button" className="resonator-quantity-label" aria-label={label} aria-pressed={active} title={active ? '点击隐藏图中标注' : '点击显示图中标注'} onClick={onClick}>{label}<i className="gs-quantity-symbol">{symbol}</i></button>;
}
function Parameter({ field, value, change, start, finish, marked, toggle }: { field: typeof WAVE_FIELDS[number]; value: number; change: (v: number) => void; start: () => void; finish: () => void; marked: boolean; toggle?: () => void }) {
  const [draft, setDraft] = useState(String(value)), [error, setError] = useState(false);
  useEffect(() => { setDraft(String(value)); setError(false); }, [value]);
  const submit = () => {
    const n = Number(draft);
    if (!draft.trim() || !Number.isFinite(n) || n < field.min || n > field.max) { setError(true); return; }
    setError(false); start(); change(n); finish();
  };
  const fill = (value - field.min) / (field.max - field.min) * 100;
  return <div className={`gs-parameter gs-tone-${field.tone}`}>
    <div className="resonator-parameter-line">{toggle ? <QuantityLabel label={field.label} symbol={field.symbol} active={marked} onClick={toggle}/> : <span className="resonator-quantity-text">{field.label}<i className="gs-quantity-symbol">{field.symbol}</i></span>}<div className="gs-number"><input type="number" aria-label={field.label} aria-invalid={error} min={field.min} max={field.max} step={field.step} value={draft} onChange={e => { setDraft(e.target.value); setError(false); }} onBlur={submit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/><span>{field.unit}</span></div></div>
    <input type="range" aria-label={field.label + '滑杆'} min={field.min} max={field.max} step={field.step} value={value} style={{ '--range-fill': `${fill}%` } as CSSProperties}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); start(); }} onChange={e => { start(); change(Number(e.target.value)); }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onBlur={finish} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) start(); }} onKeyUp={finish}/>
    {error && <small className="gs-error" role="alert">请输入 {field.min}–{field.max} {field.unit}。</small>}
  </div>;
}

export default function WaveSuperpositionScene({ onDirectory, assistantOpen, onCloseAssistant }: { onDirectory: () => void; assistantOpen: boolean; onCloseAssistant: () => void }) {
  const [initial] = useState(readWave);
  const [history, dispatch] = useReducer(waveHistory, { past: [], present: initial, future: [] } as WaveHistory);
  const [preview, setPreview] = useState<WaveParameters | null>(null);
  const p = preview ?? history.present, latest = useRef(p); latest.current = p;
  const pending = useRef<WaveParameters | null>(null), gesture = useRef(false), raf = useRef<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(true), [resultsOpen, setResultsOpen] = useState(true), [formulaOpen, setFormulaOpen] = useState(false);
  const [annotations, setAnnotations] = useState(readAnnotations);
  const [view, setView] = useState({ start: 0, span: 2.4 }), [zoom, setZoom] = useState(1);
  const [notice, setNotice] = useState(''), [saveFailed, setSaveFailed] = useState(false);
  const root = useRef<HTMLElement>(null), workspace = useRef<HTMLDivElement>(null), plot = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const layout = useScenePanelWidth(workspace, resultsOpen, panelOpen,{onLeftClose:()=>setPanelOpen(false),onRightClose:()=>setResultsOpen(false)});
  const [size, setSize] = useState({ width: 800, height: 550 });
  const uid = useId().replace(/:/g, '');
  const start = useCallback(() => { gesture.current = true; }, []);
  const change = useCallback((field: Field, value: number) => {
    const next = { ...latest.current, [field]: value }; latest.current = next; pending.current = next;
    if (raf.current === null) raf.current = requestAnimationFrame(() => { raf.current = null; setPreview(pending.current); });
  }, []);
  const finish = useCallback(() => {
    if (!gesture.current) return;
    gesture.current = false;
    if (raf.current !== null) { cancelAnimationFrame(raf.current); raf.current = null; }
    if (pending.current) dispatch({ type: 'commit', parameters: pending.current });
    pending.current = null; setPreview(null);
  }, []);
  const toggle = (key: Annotation) => setAnnotations(a => a.includes(key) ? a.filter(k => k !== key) : [...a, key]);
  const marked = (key: Annotation) => annotations.includes(key);
  const label = (key: Annotation, title: string, symbol: string) => <QuantityLabel label={title} symbol={symbol} active={marked(key)} onClick={() => toggle(key)}/>;
  useEffect(() => { try { localStorage.setItem(ANNOTATION_KEY, JSON.stringify(annotations)); } catch { /* Optional preferences. */ } }, [annotations]);
  useEffect(() => { try { localStorage.setItem(WAVE_DRAFT_KEY, JSON.stringify(waveState(history.present))); setSaveFailed(false); } catch { setSaveFailed(true); } }, [history.present]);
  useEffect(() => () => { if (raf.current !== null) cancelAnimationFrame(raf.current); }, []);
  useEffect(() => { const el = plot.current; if (!el) return; const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; if (width > 0 && height > 0) setSize({ width, height }); }); observer.observe(el); return () => observer.disconnect(); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as Element)?.closest('input,textarea,select,[contenteditable=true]') || document.querySelector('dialog[open]')) return;
      if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); finish(); dispatch({ type: e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo' }); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [finish]);

  const b = waveSuperposition(p), width = Math.max(220, size.width), height = Math.max(240, size.height);
  const margin = { left: 48, right: 23, top: 58 };
  const pw = width - margin.left - margin.right;
  // Keep a common, fixed scale for the three waveforms while parameters change.
  const plotBottom = height - 55;
  const scale = Math.max(5, (plotBottom - margin.top) / 8.8);
  const base = (margin.top + plotBottom) / 2;
  const x = (z: number) => margin.left + (z - view.start) / view.span * pw;
  const y = (field: number) => base - field * scale;
  const end = view.start + view.span, visible = (z: number) => z >= view.start && z <= end;
  const lambda = p.wavelengthNm / 1000;
  const phases = [0, p.phaseDeg * Math.PI / 180, b.resultantPhase ?? 0];
  const amplitudes = [p.amplitude1, p.amplitude2, b.amplitude], colors = ['#357fc6', '#c16b37', '#8a5eac'];
  const fieldKeys = ['first', 'second', 'sum'] as const;
  const crest = (row: number) => {
    const offset = -phases[row] / (2 * Math.PI) * lambda;
    return offset + Math.ceil((view.start + view.span * [.12, .43, .7][row] - offset) / lambda) * lambda;
  };
  const sampleCount = Math.max(361, Math.ceil(pw * 1.5));
  const paths = fieldKeys.map(key => Array.from({ length: sampleCount }, (_, i) => {
    const z = view.start + view.span * i / (sampleCount - 1); return `${x(z)},${y(b.fieldsAt(z)[key])}`;
  }).join(' '));
  const shownFields = fieldKeys.filter(marked);
  const equation = `${fmt(b.observation.first)} + (${fmt(b.observation.second)}) = ${fmt(b.observation.sum)}`;
  const calloutWidth = Math.min(pw - 16, Math.max(185, equation.length * 7 + 24));
  const calloutHeight = shownFields.length === 3 ? 58 : 18 + shownFields.length * 21;
  const observationX = x(p.observationUm);
  const calloutX = clamp(observationX + 18 + calloutWidth < width - margin.right ? observationX + 18 : observationX - calloutWidth - 18, margin.left + 8, width - margin.right - calloutWidth - 8);
  const fieldYs = shownFields.length ? shownFields.map(key => y(b.observation[key])) : [base];
  const fieldTop = Math.min(...fieldYs), fieldBottom = Math.max(...fieldYs);
  const calloutY = clamp(fieldTop - calloutHeight - 22 >= margin.top + 28 ? fieldTop - calloutHeight - 22 : fieldBottom + 22, margin.top + 28, plotBottom - calloutHeight - 12);
  const drag = useRef<{ id: number; field: Field | 'pan'; clientX: number; clientY: number; value: number; start: number; span: number; pw: number; scale: number; lambda: number } | null>(null);
  const startDrag = (e: ReactPointerEvent<SVGElement>, field: Field) => {
    if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); e.currentTarget.focus(); start();
    drag.current = { id: e.pointerId, field, clientX: e.clientX, clientY: e.clientY, value: latest.current[field], start: view.start, span: view.span, pw, scale, lambda };
    svg.current?.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.clientX;
    if (d.field === 'pan') { setView({ start: d.start - dx / d.pw * d.span, span: d.span }); return; }
    const f = WAVE_FIELDS.find(f => f.key === d.field)!;
    const value = d.field === 'amplitude1' || d.field === 'amplitude2' ? d.value - (e.clientY - d.clientY) / d.scale : d.field === 'phaseDeg' ? ((d.value - dx / d.pw * d.span / d.lambda * 360) % 360 + 360) % 360 : d.value + dx / d.pw * d.span;
    change(d.field, Number(clamp(value, f.min, f.max).toFixed(3)));
  };
  const endDrag = () => { if (drag.current?.field !== 'pan') finish(); drag.current = null; };
  const keyboardMove = (e: React.KeyboardEvent<SVGGElement>, field: Field) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault(); start(); const f = WAVE_FIELDS.find(f => f.key === field)!;
    const direction = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1;
    change(field, Number(clamp(latest.current[field] + direction * f.step * (e.shiftKey ? 10 : 1), f.min, f.max).toFixed(3))); finish();
  };
  const handleProps = (field: Field, title: string) => ({ role: 'slider', tabIndex: 0, 'aria-label': title, 'aria-valuemin': WAVE_FIELDS.find(f => f.key === field)!.min, 'aria-valuemax': WAVE_FIELDS.find(f => f.key === field)!.max, 'aria-valuenow': p[field], onPointerDown: (e: ReactPointerEvent<SVGGElement>) => startDrag(e, field), onKeyDown: (e: React.KeyboardEvent<SVGGElement>) => keyboardMove(e, field) });
  const adjustZoom = (factor: number, rx = .5) => {
    const next = clamp(zoom * factor, .5, 12), span = view.span * zoom / next;
    setView({ start: view.start + rx * (view.span - span), span }); setZoom(next);
  };
  const wheelHandler = useRef<(e: WheelEvent) => void>(() => {});
  wheelHandler.current = e => { e.preventDefault(); const box = plot.current!.getBoundingClientRect(); adjustZoom(Math.exp(-e.deltaY * .0015), clamp((e.clientX - box.left - margin.left) / pw, 0, 1)); };
  useEffect(() => { const el = plot.current; if (!el) return; const wheel = (e: WheelEvent) => wheelHandler.current(e); el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel); }, []);
  const applyAssistant = (state: SceneState) => {
    if (state.sceneId !== WAVE_SCENE_ID || gesture.current || document.activeElement?.matches('.wave-superposition-scene .gs-parameter input')) return false;
    try { dispatch({ type: 'commit', parameters: parseWave(state.parameters) }); return true; } catch { return false; }
  };
  const restoreAssistant = (before: SceneState, after: SceneState) => {
    if (gesture.current || sceneKey(waveState(latest.current)) !== sceneKey(after)) return false;
    const previous = history.past.at(-1);
    if (previous && sceneKey(waveState(previous)) === sceneKey(before)) { dispatch({ type: 'undo' }); return true; }
    return applyAssistant(before);
  };
  const reset = () => { finish(); dispatch({ type: 'commit', parameters: { ...DEFAULT_WAVE } }); setView({ start: 0, span: 2.4 }); setZoom(1); setAnnotations([...DEFAULT_ANNOTATIONS]); };
  const amplitudeMark = (row: number, key: Annotation, symbol: string) => {
    const z = crest(row), value = amplitudes[row];
    if (!marked(key) || value === 0 || !visible(z) || x(z) < margin.left + 10 || x(z) > width - margin.right - 40) return null;
    return <g data-testid={`wave-annotation-${key}`} className={row < 2 ? 'wave-amplitude-handle' : ''} {...(row < 2 ? handleProps(row === 0 ? 'amplitude1' : 'amplitude2', row === 0 ? '图中第一束振幅' : '图中第二束振幅') : {})}>
      {row < 2 && <rect x={x(z) - 12} y={y(value) - 10} width={48} height={value * scale + 20} fill="transparent"/>}
      <path d={`M${x(z)} ${base}V${y(value)} M${x(z)-4} ${base}H${x(z)+4} M${x(z)-4} ${y(value)}H${x(z)+4}`} fill="none" stroke={colors[row]} strokeWidth={1.4}/>
      <text className="wave-annotation" x={x(z) + 9} y={base - value * scale / 2 + 4} style={{ fill: colors[row] }}>{symbol}</text>
      {row < 2 && <circle cx={x(z)} cy={y(value)} r={4} fill="#fff" stroke={colors[row]} strokeWidth={1.7}/>}
    </g>;
  };
  const wavelengthStart = crest(0), wavelengthEnd = wavelengthStart + lambda;

  return <section ref={root} className={`gaussian-scene gaussian-focus-scene wave-superposition-scene ${layout.resizing ? 'gs-panel-resizing' : ''}`} aria-label="光波叠加场景">
    <div className="gs-heading"><div className="gs-title"><button className="icon-button" aria-label="返回仿真场景库" onClick={onDirectory}><ChevronLeft size={20}/></button><h1>光波叠加</h1></div><div className="gs-heading-actions"><SceneAssistantToggle/><button className="outline-button" aria-haspopup="dialog" aria-expanded={formulaOpen} onClick={() => { finish(); setFormulaOpen(true); }}><BookOpen size={15}/>相关公式</button><button className="icon-button" aria-label="全屏查看场景" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen())?.catch(() => setNotice('浏览器未开启全屏。'))}><Maximize size={18}/></button></div></div>
    <div ref={workspace} className="gs-workspace">
      {panelOpen && <><aside className="gs-sidebar" style={{ width: layout.width }} aria-label="光波叠加参数"><div className="gs-sidebar-title"><h2><Settings2 size={16}/>参数调节</h2><button className="icon-button" aria-label="收起左侧参数" onClick={() => setPanelOpen(false)}><PanelLeftClose size={17}/></button></div><div className="gs-sidebar-scroll">
        {[{ title: '两束光波', keys: ['wavelengthNm', 'amplitude1', 'amplitude2', 'phaseDeg'] }, { title: '观察位置', keys: ['observationUm'] }].map(section => <section key={section.title}><h3>{section.title}</h3>{WAVE_FIELDS.filter(f => section.keys.includes(f.key)).map(f => <Parameter key={f.key} field={f} value={p[f.key]} start={start} finish={finish} change={value => change(f.key, value)} marked={marked(f.key as Annotation)} toggle={ANNOTATIONS.includes(f.key as Annotation) ? () => toggle(f.key as Annotation) : undefined}/>)}{section.keys.includes('phaseDeg') && <div className="gs-presets">{[{ title: '同相', value: 0 }, { title: '反相', value: 180 }, { title: '相差90°', value: 90 }].map(preset => <button key={preset.title} className={Math.abs(p.phaseDeg - preset.value) < 1e-8 || preset.value === 0 && p.phaseDeg === 360 ? 'selected' : ''} onClick={() => { finish(); dispatch({ type: 'commit', parameters: { ...latest.current, phaseDeg: preset.value } }); }}>{preset.title}</button>)}</div>}</section>)}
      </div><div className="gs-sidebar-footer"><button className="text-button" onClick={reset}><RotateCcw size={14}/>恢复默认</button><span>{saveFailed ? '本机保存不可用' : '已自动保存'}</span></div></aside><div className="gs-panel-resizer" {...layout.separator}/></>}
      <main className="gs-visual"><div className="gs-toolbar"><div className="gs-toolbar-left">{!panelOpen && <button className="icon-button" aria-label="展开左侧参数" onClick={() => setPanelOpen(true)}><PanelLeftOpen size={17}/></button>}<span className="gfocus-view-title">电场叠加</span></div><div className="gs-toolbar-right"><button className="icon-button" aria-label="撤销光波参数" disabled={!history.past.length && !preview} onClick={() => { finish(); dispatch({ type: 'undo' }); }}><Undo2 size={16}/></button><button className="icon-button" aria-label="重做光波参数" disabled={!history.future.length} onClick={() => { finish(); dispatch({ type: 'redo' }); }}><Redo2 size={16}/></button>{!resultsOpen && <button className="gs-spot-toggle" aria-label="展开叠加结果" onClick={() => setResultsOpen(true)}><ScanLine size={15}/>结果</button>}</div></div>
        <div ref={plot} className="gs-plot">
          {marked('observationUm') && !visible(p.observationUm) && <button className="gs-outside-screen" onClick={() => setView(v => ({ ...v, start: p.observationUm - v.span / 2 }))}>观察位置在视野外 · 定位</button>}
          <svg ref={svg} viewBox={`0 0 ${width} ${height}`} data-testid="wave-plot" data-start-um={view.start} data-span-um={view.span} aria-label="两束光波及合成波，共用位置坐标和电场尺度" onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} onPointerDown={e => { if (e.button !== 0) return; drag.current = { id: e.pointerId, field: 'pan', clientX: e.clientX, clientY: e.clientY, value: 0, start: view.start, span: view.span, pw, scale, lambda }; e.currentTarget.setPointerCapture(e.pointerId); }}>
            <defs>
              <clipPath id={`${uid}-clip`}><rect x={margin.left} y={margin.top - 8} width={pw} height={plotBottom - margin.top + 16}/></clipPath>
            </defs>
            <text className="gs-axis-label" x={margin.left} y={19}>电场 / 相对单位</text>
            {['第一束 E₁', '第二束 E₂', '合成波 E'].map((title, i) => <g key={title}>
              <line x1={margin.left + pw * i / 3} x2={margin.left + pw * i / 3 + 20} y1={38} y2={38} stroke={colors[i]} strokeWidth={i === 2 ? 3 : 2} strokeDasharray={i === 0 ? '7 4' : i === 1 ? '2 4' : undefined}/>
              <text className="wave-row-title" x={margin.left + pw * i / 3 + 26} y={42} style={{ fill: colors[i] }}>{title}</text>
            </g>)}
            {Array.from({ length: 5 }, (_, i) => { const z = view.start + view.span * i / 4; return <g key={i}><line className="gs-grid" x1={x(z)} x2={x(z)} y1={margin.top} y2={plotBottom}/><text x={x(z)} y={plotBottom + 21} textAnchor="middle">{fmt(z)}</text></g>; })}
            {[-4, -2, 0, 2, 4].map(value => <g key={value}><line className={value === 0 ? 'gs-axis' : 'gs-grid'} x1={margin.left} x2={width - margin.right} y1={y(value)} y2={y(value)}/><text x={margin.left - 10} y={y(value) + 4} textAnchor="end">{value}</text></g>)}
            <text className="gs-axis-label" x={width - margin.right} y={plotBottom + 41} textAnchor="end">位置 z / μm →</text>
            <g clipPath={`url(#${uid}-clip)`}>
              <polyline data-testid="wave-curve-sum" points={paths[2]} fill="none" stroke={colors[2]} strokeWidth={3.4} opacity={.78}/>
              <polyline data-testid="wave-curve-first" points={paths[0]} fill="none" stroke={colors[0]} strokeWidth={2.2} strokeDasharray="8 5"/>
              <g className="gs-drag-handle" {...handleProps('phaseDeg', '图中相位差')}>
                <polyline points={paths[1]} fill="none" stroke="transparent" strokeWidth={16}/>
                <polyline data-testid="wave-curve-second" points={paths[1]} fill="none" stroke={colors[1]} strokeWidth={2.5} strokeDasharray="2 5" strokeLinecap="round"/>
              </g>
              {marked('observationUm') && visible(p.observationUm) && <g className="gs-drag-handle" data-testid="wave-annotation-observationUm" {...handleProps('observationUm', '图中观察位置')}>
                <rect x={x(p.observationUm) - 10} y={margin.top} width={20} height={plotBottom - margin.top} fill="transparent"/>
                <line x1={x(p.observationUm)} x2={x(p.observationUm)} y1={margin.top} y2={plotBottom} stroke="#26836a" strokeDasharray="4 5"/>
                <rect x={x(p.observationUm) - 11} y={plotBottom - 12} width={22} height={12} rx={3} fill="#fbfdff"/>
                <text className="wave-annotation" x={x(p.observationUm)} y={plotBottom - 2} textAnchor="middle" style={{ fill: '#26836a' }}>z</text>
              </g>}
              {visible(p.observationUm) && [2, 0, 1].filter(row => marked(fieldKeys[row])).map((row, i) => <g key={row} className="gs-drag-handle" tabIndex={-1} data-testid={`wave-annotation-${fieldKeys[row]}`} onPointerDown={e => startDrag(e, 'observationUm')} onKeyDown={e => keyboardMove(e, 'observationUm')}>
                <circle data-testid={`wave-point-${fieldKeys[row]}`} data-field-value={b.observation[fieldKeys[row]]} cx={observationX} cy={y(b.observation[fieldKeys[row]])} r={[6, 4.5, 3][i]} fill={colors[row]} stroke="#fff" strokeWidth={1.3}/>
              </g>)}
              {amplitudeMark(0, 'amplitude1', 'A₁')}{amplitudeMark(1, 'amplitude2', 'A₂')}{amplitudeMark(2, 'amplitude', 'A')}
              {marked('wavelengthNm') && p.amplitude1 > 0 && visible(wavelengthStart) && visible(wavelengthEnd) && x(wavelengthEnd) - x(wavelengthStart) > 42 && <g data-testid="wave-annotation-wavelengthNm"><path d={`M${x(wavelengthStart)} ${margin.top + 14}H${x(wavelengthEnd)} M${x(wavelengthStart)} ${margin.top + 10}V${margin.top + 18} M${x(wavelengthEnd)} ${margin.top + 10}V${margin.top + 18}`} stroke="#357fc6" fill="none"/><text className="wave-annotation" x={(x(wavelengthStart) + x(wavelengthEnd))/2} y={margin.top + 8} textAnchor="middle" style={{ fill: '#357fc6' }}>λ</text></g>}
            </g>
            {visible(p.observationUm) && shownFields.length > 0 && <g className="wave-observation-callout" data-testid="wave-observation-callout" pointerEvents="none" transform={`translate(${calloutX}, ${calloutY})`}>
              <path d={`M${observationX - calloutX} ${y(b.observation[marked('sum') ? 'sum' : shownFields[0]]) - calloutY}L${clamp(observationX - calloutX, 12, calloutWidth - 12)} ${calloutY < fieldTop ? calloutHeight : 0}`} stroke="#c8d5e2" fill="none"/>
              <rect width={calloutWidth} height={calloutHeight} rx={6} fill="#ffffffed" stroke="#e0e7f0"/>
              {shownFields.length === 3 ? <>
                <text x={12} y={21} className="wave-equation-symbols"><tspan fill={colors[0]}>E₁</tspan><tspan> + </tspan><tspan fill={colors[1]}>E₂</tspan><tspan> = </tspan><tspan fill={colors[2]}>E</tspan></text>
                <text data-testid="wave-addition-equation" x={12} y={43} className="wave-equation-values" textLength={equation.length * 7 + 24 > calloutWidth ? calloutWidth - 24 : undefined} lengthAdjust="spacingAndGlyphs"><tspan fill={colors[0]}>{fmt(b.observation.first)}</tspan><tspan> + </tspan><tspan fill={colors[1]}>({fmt(b.observation.second)})</tspan><tspan> = </tspan><tspan fill={colors[2]}>{fmt(b.observation.sum)}</tspan></text>
              </> : shownFields.map((key, i) => <text key={key} x={12} y={23 + i * 21} className="wave-equation-values" style={{ fill: colors[fieldKeys.indexOf(key)] }}>{['E₁', 'E₂', 'E'][fieldKeys.indexOf(key)]} = {fmt(b.observation[key])}</text>)}
            </g>}

          </svg>
        </div>
        <div className="gs-visual-footer"><span>向上为正 · 向下为负</span><div className="gs-plot-controls"><button className="icon-button" aria-label="缩小光波图" disabled={zoom <= .5} onClick={() => adjustZoom(1 / 1.35)}><Minus size={16}/></button><span>{fmt(zoom)}×</span><button className="icon-button" aria-label="放大光波图" disabled={zoom >= 12} onClick={() => adjustZoom(1.35)}><Plus size={16}/></button></div></div>
      </main>
      {resultsOpen && <><div className="gs-panel-resizer" {...layout.results.separator}/><aside className="gs-sidebar gfocus-results" style={{ width: layout.results.width }} aria-label="叠加结果"><div className="gs-sidebar-title"><h2>叠加结果</h2><button className="icon-button" aria-label="收起叠加结果" onClick={() => setResultsOpen(false)}><X size={17}/></button></div><div className="gs-sidebar-scroll">
        <section className="gs-readouts gfocus-main-readouts"><div className="gs-primary-reading gs-tone-output"><small>{label('amplitude', '合成振幅', 'A')}</small><strong data-testid="wave-amplitude">{fmt(b.amplitude)}</strong></div><div className="gs-primary-reading gs-tone-output"><small>平均相对光强 <i className="gs-quantity-symbol">I</i></small><strong data-testid="wave-intensity">{fmt(b.intensity)}</strong></div><p className="wave-status" data-testid="wave-status">{b.status}</p></section>
        <section className="gs-readouts"><h3>观察点电场<span>瞬时值</span></h3><dl>{[{ title: '第一束', symbol: 'E₁', value: b.observation.first, tone: 'wave-first' }, { title: '第二束', symbol: 'E₂', value: b.observation.second, tone: 'wave-second' }, { title: '合成电场', symbol: 'E', value: b.observation.sum, tone: 'output' }].map((r, i) => <div className={`gs-tone-${r.tone}`} key={r.title}><dt>{label(fieldKeys[i], r.title, r.symbol)}</dt><dd data-testid={'wave-observation-' + fieldKeys[i]}>{fmt(r.value)}</dd></div>)}</dl></section>
        <details className="wave-details"><summary>两束光强</summary><dl><div><dt>第一束相对光强</dt><dd data-testid="wave-first-intensity">{fmt(b.firstIntensity)}</dd></div><div><dt>第二束相对光强</dt><dd data-testid="wave-second-intensity">{fmt(b.secondIntensity)}</dd></div></dl></details>
        <details className="wave-details"><summary>模型条件</summary><p>两束光同频、同向、同偏振；图中显示固定时刻的电场。</p><p>采用同一相对基准：单束光振幅为 1 时，平均相对光强为 1。</p></details>
      </div></aside></>}
    </div><div className="gs-model-strip"><span>同频 · 同向 · 同偏振</span><span>同一位置：E₁ + E₂ = E</span></div>
    {formulaOpen && <SceneFormulaSheet state={waveState(p)} onClose={() => setFormulaOpen(false)}/>}
    {assistantOpen && <aside className="gs-drawer gs-assistant" aria-label="场景AI助手"><button className="gs-assistant-close icon-button" aria-label="关闭场景AI助手" onClick={onCloseAssistant}><X size={18}/></button><AssistantPanel sceneState={waveState(p)} editing={gesture.current || preview !== null} onApplyScene={applyAssistant} onRestoreScene={restoreAssistant}/></aside>}
    {notice && <div className="gs-notice" role="status">{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15}/></button></div>}
  </section>;
}

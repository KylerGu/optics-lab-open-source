import SceneAssistantToggle from './SceneAssistantToggle';
import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { BookOpen, ChevronLeft, Maximize, PanelLeftClose, PanelLeftOpen, Redo2, RotateCcw, ScanLine, Settings2, Undo2, X } from 'lucide-react';
import { renderToString } from 'katex';
import AssistantPanel from './AssistantPanel';
import SceneFormulaSheet from './SceneFormulaSheet';
import { useScenePanelWidth } from './useScenePanelWidth';
import { draftKey, numberText as fullNumberText, readScene, sceneKey, type SceneState } from './sceneRuntime';
import { DEFAULT_ILLUMINATION, ILLUMINATION_FIELDS, ILLUMINATION_ID, MAP_SIZE, illuminationHistory, illuminationMap, illuminationState, parseIllumination, type IlluminationHistory, type IlluminationParameters } from './illumination';
import './gaussian-scene.css';
import './gaussian-focus.css';
import './resonator-scene.css';
import './point-source.css';
import './illumination-scene.css';

type Field = keyof IlluminationParameters;
type Annotation = Field | 'illuminance';
const ANNOTATIONS: Annotation[] = ['intensityCd', 'sourceXM', 'heightM', 'tiltDeg', 'halfAngleDeg', 'observationXM', 'observationYM', 'illuminance'];
const DEFAULT_ANNOTATIONS: Annotation[] = ['heightM', 'tiltDeg', 'observationXM', 'observationYM', 'illuminance'];
const ANNOTATION_KEY = 'optics-illumination-annotations:v1';
const equation = renderToString('E=\\frac{I(\\alpha)\\cos\\gamma}{r^2}', { displayMode: true, throwOnError: false });
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const numberText = (value: number | null) => value === null ? '—' : fullNumberText(Number(value.toPrecision(4)));
function readAnnotations(): Annotation[] {
  try { const a = JSON.parse(localStorage.getItem(ANNOTATION_KEY) ?? 'null'); if (Array.isArray(a)) return a.filter((k): k is Annotation => ANNOTATIONS.includes(k)); } catch { /* Optional preference. */ }
  return [...DEFAULT_ANNOTATIONS];
}
function Label({ label, symbol, active, onClick }: { label: string; symbol: string; active: boolean; onClick: () => void }) {
  return <button className="resonator-quantity-label" aria-label={label} aria-pressed={active} title={active ? '点击隐藏图中标注' : '点击显示图中标注'} onClick={onClick}>{label}<i className="gs-quantity-symbol">{symbol}</i></button>;
}
function Parameter({ field, value, start, change, finish, marked, toggle }: { field: typeof ILLUMINATION_FIELDS[number]; value: number; start: () => void; change: (value: number) => void; finish: () => void; marked: boolean; toggle: () => void }) {
  const [draft, setDraft] = useState(String(value)), [error, setError] = useState(false);
  useEffect(() => { setDraft(String(value)); setError(false); }, [value]);
  const submit = () => { const n = Number(draft); if (!draft.trim() || !Number.isFinite(n) || n < field.min || n > field.max) { setError(true); return; } start(); change(n); finish(); setError(false); };
  return <div className={`gs-parameter gs-tone-${field.tone}`}><div className="resonator-parameter-line"><Label label={field.label} symbol={field.symbol} active={marked} onClick={toggle}/><div className="gs-number"><input type="number" aria-label={field.label} aria-invalid={error} min={field.min} max={field.max} step={field.step} value={draft} onChange={e => { setDraft(e.target.value); setError(false); }} onBlur={submit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/><span>{field.unit}</span></div></div>
    <input type="range" aria-label={field.label + '滑杆'} min={field.min} max={field.max} step={field.step} value={value} style={{ '--range-fill': `${(value - field.min) / (field.max - field.min) * 100}%` } as CSSProperties}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); start(); }} onChange={e => { start(); change(Number(e.target.value)); }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onBlur={finish}
      onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) start(); }} onKeyUp={finish}/>
    {error && <small className="gs-error" role="alert">请输入 {field.min}–{field.max} {field.unit}。</small>}
  </div>;
}

const COLORS = [[247, 250, 255], [206, 230, 244], [132, 196, 196], [65, 146, 141], [220, 182, 105]];
function color(value: number) { const t = clamp(value, 0, 1) * 4, a = Math.min(3, Math.floor(t)), f = t - a; return COLORS[a].map((v, i) => Math.round(v + (COLORS[a + 1][i] - v) * f)); }
function Heatmap({ values, colorMax, left, top, side }: { values: number[]; colorMax: number; left: number; top: number; side: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const ctx = canvas.current?.getContext('2d'); if (!ctx) return; const data = ctx.createImageData(MAP_SIZE, MAP_SIZE); values.forEach((v, i) => { const rgb = color(v / colorMax); data.data.set([...rgb, 255], i * 4); }); ctx.putImageData(data, 0, 0); }, [values, colorMax]);
  return <canvas ref={canvas} width={MAP_SIZE} height={MAP_SIZE} role="img" aria-label="接收面照度颜色分布" style={{ left, top, width: side, height: side }}/>;
}

function SectionCurve({ p, b }: { p: IlluminationParameters; b: ReturnType<typeof illuminationMap> }) {
  const w = 310, h = 245, left = 51, right = 15, top = 25, bottom = 39;
  const peak = Math.max(1, ...b.curve.map(row => row.y)), step = 10 ** Math.floor(Math.log10(peak)) / 2, ymax = Math.ceil(peak * 1.05 / step) * step;
  const x = (v: number) => left + (v + 4) / 8 * (w - left - right), y = (v: number) => top + (1 - v / ymax) * (h - top - bottom);
  return <section className="illumination-curve"><h3>观察线照度</h3><p>y = {numberText(p.observationYM)} m</p><svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`观察线照度曲线，观察点照度${numberText(b.observation.value)}勒克斯`}>
    {[0, .25, .5, .75, 1].map(t => <g key={t}><line x1={left} x2={w - right} y1={y(ymax * t)} y2={y(ymax * t)} className="gs-grid"/><text x={left - 7} y={y(ymax * t) + 3} textAnchor="end">{numberText(ymax * t)}</text></g>)}
    {[-4, -2, 0, 2, 4].map(t => <g key={t}><line x1={x(t)} x2={x(t)} y1={top} y2={h - bottom} className="gs-grid"/><text x={x(t)} y={h - bottom + 18} textAnchor="middle">{t}</text></g>)}
    <path d={`M${left} ${top}V${h - bottom}H${w - right}`} fill="none" className="gs-axis"/><polyline points={b.curve.map(row => `${x(row.x)},${y(row.y)}`).join(' ')} fill="none" stroke="#26836a" strokeWidth={2}/>
    <path d={`M${x(p.observationXM)} ${h - bottom}V${y(b.observation.value)}H${left}`} fill="none" stroke="#8bb7a8" strokeDasharray="4 4"/><circle data-testid="illumination-curve-current" cx={x(p.observationXM)} cy={y(b.observation.value)} r={4} fill="#fff" stroke="#26836a" strokeWidth={2}/>
    <text x={left} y={12}>E / lx</text><text x={w - right} y={h - 5} textAnchor="end">x / m</text>
  </svg></section>;
}

export default function IlluminationScene({ onDirectory, assistantOpen, onCloseAssistant }: { onDirectory: () => void; assistantOpen: boolean; onCloseAssistant: () => void }) {
  const [history, dispatch] = useReducer(illuminationHistory, undefined, () => ({ past: [], present: parseIllumination(readScene(ILLUMINATION_ID).parameters), future: [] } as IlluminationHistory));
  const [preview, setPreview] = useState<IlluminationParameters | null>(null);
  const p = preview ?? history.present, latest = useRef(p); latest.current = p;
  const pending = useRef<IlluminationParameters | null>(null), gesture = useRef(false), raf = useRef<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(true), [resultsOpen, setResultsOpen] = useState(true), [formulaOpen, setFormulaOpen] = useState(false);
  const [annotations, setAnnotations] = useState(readAnnotations), [saveFailed, setSaveFailed] = useState(false), [notice, setNotice] = useState(''), [colorMax, setColorMax] = useState(200);
  const root = useRef<HTMLElement>(null), workspace = useRef<HTMLDivElement>(null), plot = useRef<HTMLDivElement>(null);
  const layout = useScenePanelWidth(workspace, resultsOpen, panelOpen,{onLeftClose:()=>setPanelOpen(false),onRightClose:()=>setResultsOpen(false)});
  const [size, setSize] = useState({ width: 800, height: 620 });
  const uid = useId().replace(/:/g, '');
  const start = useCallback(() => { gesture.current = true; }, []);
  const change = useCallback((patch: Partial<IlluminationParameters>) => {
    const next = { ...latest.current, ...patch }; latest.current = next; pending.current = next;
    if (raf.current === null) raf.current = requestAnimationFrame(() => { raf.current = null; setPreview(pending.current); });
  }, []);
  const finish = useCallback(() => {
    if (!gesture.current) return; gesture.current = false;
    if (raf.current !== null) { cancelAnimationFrame(raf.current); raf.current = null; }
    if (pending.current) dispatch({ type: 'commit', parameters: pending.current }); pending.current = null; setPreview(null);
  }, []);
  const marked = (key: Annotation) => annotations.includes(key), toggle = (key: Annotation) => setAnnotations(a => a.includes(key) ? a.filter(k => k !== key) : [...a, key]);
  useEffect(() => { try { localStorage.setItem(draftKey(ILLUMINATION_ID), JSON.stringify(illuminationState(history.present))); setSaveFailed(false); } catch { setSaveFailed(true); } }, [history.present]);
  useEffect(() => { try { localStorage.setItem(ANNOTATION_KEY, JSON.stringify(annotations)); } catch { /* Optional preference. */ } }, [annotations]);
  useEffect(() => () => { if (raf.current !== null) cancelAnimationFrame(raf.current); }, []);
  useEffect(() => { const el = plot.current; if (!el) return; const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; if (width > 0 && height > 0) setSize({ width, height }); }); observer.observe(el); return () => observer.disconnect(); }, []);
  useEffect(() => { const key = (e: KeyboardEvent) => { if ((e.target as Element)?.closest('input,textarea,select,[contenteditable=true]') || document.querySelector('dialog[open]')) return; if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); finish(); dispatch({ type: e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo' }); } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [finish]);

  const b = useMemo(() => illuminationMap(p), [p]);
  const width = Math.max(260, size.width), height = Math.max(490, size.height), profileH = Math.max(190, Math.min(250, height * .35)), mapH = height - profileH - 34;
  const scale = Math.min((width - 70) / 8, (profileH - 48) / 5.5), ground = profileH - 30, center = width / 2;
  const sx = center + p.sourceXM * scale, sy = ground - p.heightM * scale, theta = p.tiltDeg * Math.PI / 180;
  const directionLength = Math.max(24, Math.min(50, p.heightM * scale * .65));
  const ax = sx + Math.sin(theta) * directionLength, ay = sy + Math.cos(theta) * directionLength;
  const side = Math.max(150, Math.min(width - 120, mapH - 61)), mapLeft = (width - side) / 2, mapTop = 18;
  const mx = (x: number) => mapLeft + (x + 4) / 8 * side, my = (y: number) => mapTop + (4 - y) / 8 * side;
  const arc = (a: number, z: number, radius: number) => Array.from({ length: 25 }, (_, i) => { const angle = (a + (z - a) * i / 24) * Math.PI / 180; return `${sx + Math.sin(angle) * radius},${sy + Math.cos(angle) * radius}`; }).join(' ');
  const drag = useRef<{ id: number; kind: 'source' | 'direction' | 'observation'; svg: SVGSVGElement; before: IlluminationParameters; x: number; y: number; scale: number; center: number; ground: number; width: number; height: number; left: number; top: number; side: number } | null>(null);
  const beginDrag = (event: ReactPointerEvent<SVGElement>, kind: 'source' | 'direction' | 'observation') => {
    if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); start();
    const svg = event.currentTarget.ownerSVGElement!; drag.current = { id: event.pointerId, kind, svg, before: { ...latest.current }, x: event.clientX, y: event.clientY, scale, center, ground, width, height: kind === 'observation' ? mapH : profileH, left: mapLeft, top: mapTop, side }; svg.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current; if (!d || d.id !== event.pointerId) return; const box = d.svg.getBoundingClientRect(), x = (event.clientX - box.left) * d.width / box.width, y = (event.clientY - box.top) * d.height / box.height;
    if (d.kind === 'source') change({ sourceXM: Number(clamp(d.before.sourceXM + (event.clientX - d.x) * d.width / box.width / d.scale, -3, 3).toFixed(2)), heightM: Number(clamp(d.before.heightM - (event.clientY - d.y) * d.height / box.height / d.scale, .5, 5).toFixed(2)) });
    else if (d.kind === 'direction') change({ tiltDeg: Number(clamp(Math.atan2(x - d.center - d.before.sourceXM * d.scale, y - d.ground + d.before.heightM * d.scale) * 180 / Math.PI, -70, 70).toFixed(1)) });
    else change({ observationXM: Number(clamp((x - d.left) / d.side * 8 - 4, -4, 4).toFixed(2)), observationYM: Number(clamp(4 - (y - d.top) / d.side * 8, -4, 4).toFixed(2)) });
  };
  const endDrag = () => { if (!drag.current) return; drag.current = null; finish(); };
  const handleKey = (event: React.KeyboardEvent<SVGGElement>, kind: 'source' | 'direction' | 'observation') => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); start();
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight', positive = event.key === 'ArrowRight' || event.key === 'ArrowUp', sign = positive ? 1 : -1;
    const key: Field = kind === 'direction' ? 'tiltDeg' : kind === 'source' ? horizontal ? 'sourceXM' : 'heightM' : horizontal ? 'observationXM' : 'observationYM';
    const f = ILLUMINATION_FIELDS.find(f => f.key === key)!; change({ [key]: Number(clamp(latest.current[key] + sign * f.step * (event.shiftKey ? 10 : 1), f.min, f.max).toFixed(2)) }); finish();
  };
  const applyAssistant = (state: SceneState) => { if (state.sceneId !== ILLUMINATION_ID || gesture.current || document.activeElement?.matches('.illumination-scene .gs-parameter input')) return false; try { dispatch({ type: 'commit', parameters: parseIllumination(state.parameters) }); return true; } catch { return false; } };
  const restoreAssistant = (before: SceneState, after: SceneState) => { if (gesture.current || sceneKey(illuminationState(latest.current)) !== sceneKey(after)) return false; const previous = history.past.at(-1); if (previous && sceneKey(illuminationState(previous)) === sceneKey(before)) { dispatch({ type: 'undo' }); return true; } return applyAssistant(before); };
  const reset = () => { finish(); dispatch({ type: 'commit', parameters: { ...DEFAULT_ILLUMINATION } }); setAnnotations([...DEFAULT_ANNOTATIONS]); setColorMax(200); };
  const marker = (key: Annotation, content: React.ReactNode) => marked(key) ? <g className="illumination-annotation" data-testid={'illumination-annotation-' + key}>{content}</g> : null;

  return <section ref={root} className={`gaussian-scene gaussian-focus-scene illumination-scene ${layout.resizing ? 'gs-panel-resizing' : ''}`} aria-label="照度分布与光源方向场景">
    <div className="gs-heading"><div className="gs-title"><button className="icon-button" aria-label="返回仿真场景库" onClick={onDirectory}><ChevronLeft size={20}/></button><h1>照度分布与光源方向</h1></div><div className="gs-heading-actions"><SceneAssistantToggle/><button className="outline-button" aria-haspopup="dialog" aria-expanded={formulaOpen} onClick={() => { finish(); setFormulaOpen(true); }}><BookOpen size={15}/>相关公式</button><button className="icon-button" aria-label="全屏查看场景" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen())?.catch(() => setNotice('浏览器未开启全屏。'))}><Maximize size={18}/></button></div></div>
    <div ref={workspace} className="gs-workspace">
      {panelOpen && <><aside className="gs-sidebar" style={{ width: layout.width }} aria-label="照明参数"><div className="gs-sidebar-title"><h2><Settings2 size={16}/>参数调节</h2><button className="icon-button" aria-label="收起左侧参数" onClick={() => setPanelOpen(false)}><PanelLeftClose size={17}/></button></div><div className="gs-sidebar-scroll">
        <div className="illumination-equation" dangerouslySetInnerHTML={{ __html: equation }}/>
        {[{ title: '射灯', keys: ['intensityCd', 'sourceXM', 'heightM', 'tiltDeg', 'halfAngleDeg'] }, { title: '观察点', keys: ['observationXM', 'observationYM'] }].map(group => <section key={group.title}><h3>{group.title}</h3>{ILLUMINATION_FIELDS.filter(f => group.keys.includes(f.key)).map(f => <Parameter key={f.key} field={f} value={p[f.key]} start={start} finish={finish} change={v => change({ [f.key]: v })} marked={marked(f.key)} toggle={() => toggle(f.key)}/>)}{group.title === '射灯' && <p className="point-label-hint">β 处光强减半；正倾角朝右</p>}</section>)}
        <p className="point-label-hint">点击名称，切换图中字母</p><details className="point-conditions"><summary>模型条件</summary><p>简化定向点光源，主轴在侧视图平面内转动。半强角不是截止角；后半空间无光。</p><p>接收区域为 8 m × 8 m。平均值为积分近似，极值与均匀度按网格估算。不含环境光、吸收、反射和遮挡。</p><p>固定主轴光强，改变半强角不保持总光通量。颜色超过色标上限时显示同一颜色，以数值为准。</p></details>
      </div><div className="gs-sidebar-footer"><button className="text-button" onClick={reset}><RotateCcw size={14}/>恢复默认</button><span>{saveFailed ? '本机保存不可用' : '已自动保存'}</span></div></aside><div className="gs-panel-resizer" {...layout.separator}/></>}
      <main className="gs-visual"><div className="gs-toolbar"><div className="gs-toolbar-left">{!panelOpen && <button className="icon-button" aria-label="展开左侧参数" onClick={() => setPanelOpen(true)}><PanelLeftOpen size={17}/></button>}<span className="gfocus-view-title">射灯与接收面</span></div><div className="gs-toolbar-right"><button className="icon-button" aria-label="撤销照明参数" disabled={!history.past.length && !preview} onClick={() => { finish(); dispatch({ type: 'undo' }); }}><Undo2 size={16}/></button><button className="icon-button" aria-label="重做照明参数" disabled={!history.future.length} onClick={() => { finish(); dispatch({ type: 'redo' }); }}><Redo2 size={16}/></button>{!resultsOpen && <button className="gs-spot-toggle" onClick={() => setResultsOpen(true)}><ScanLine size={15}/>结果</button>}</div></div>
        <div ref={plot} className="illumination-visuals">
          <svg className="illumination-profile" viewBox={`0 0 ${width} ${profileH}`} style={{ height: profileH }} role="img" aria-label="可拖动射灯和方向的二维侧视图" onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
            <text x={18} y={22} className="illumination-view-label">侧视</text><path d={`M35 ${ground}H${width - 35}`} className="gs-axis"/><text x={width - 38} y={ground - 8} textAnchor="end">接收面</text>
            <line x1={sx} x2={sx} y1={sy} y2={ground} stroke="#c8d4df" strokeDasharray="4 4"/>
            {p.intensityCd > 0 && <line x1={sx} y1={sy} x2={sx + p.heightM * Math.tan(theta) * scale} y2={ground} stroke="#d2aa66" strokeWidth={1.5}/>}
            <g className="illumination-source-handle" role="button" tabIndex={0} aria-label="图中射灯位置" onPointerDown={event => beginDrag(event, 'source')} onKeyDown={event => handleKey(event, 'source')}><circle cx={sx} cy={sy} r={18} fill="transparent"/><g transform={`translate(${sx},${sy}) rotate(${-p.tiltDeg})`}><rect x={-10} y={-14} width={20} height={20} rx={5} fill={p.intensityCd ? '#eac57e' : '#becbd6'} stroke="#b99454"/><path d="M-13 7H13L8 1H-8Z" fill="#f6dfaa" stroke="#b99454"/></g></g>
            <g className="illumination-direction-handle" role="slider" tabIndex={0} aria-label="图中光源倾角" aria-valuemin={-70} aria-valuemax={70} aria-valuenow={p.tiltDeg} onPointerDown={event => beginDrag(event, 'direction')} onKeyDown={event => handleKey(event, 'direction')}><line x1={sx} y1={sy} x2={ax} y2={ay} stroke="transparent" strokeWidth={16}/><line x1={sx} y1={sy} x2={ax} y2={ay} stroke="#bd9146" strokeWidth={2}/><circle cx={ax} cy={ay} r={5} fill="#fff" stroke="#bd9146" strokeWidth={2}/></g>
            {marker('intensityCd', <text x={sx} y={sy - 24} textAnchor="middle" className="illumination-symbol illumination-source-symbol">I₀ = {numberText(p.intensityCd)} cd</text>)}
            {marker('sourceXM', <><path d={`M${center} ${ground + 12}H${sx} M${center} ${ground + 8}v8 M${sx} ${ground + 8}v8`} className="gs-dimension"/><text x={sx} y={ground + 27} textAnchor="middle" className="illumination-symbol">xₛ = {numberText(p.sourceXM)} m</text></>)}
            {marker('heightM', <><path d={`M${sx - 28} ${sy}V${ground} M${sx - 32} ${sy}h8 M${sx - 32} ${ground}h8`} className="gs-dimension"/><text x={sx - 36} y={(sy + ground) / 2} textAnchor="end" className="illumination-symbol">h = {numberText(p.heightM)} m</text></>)}
            {marker('tiltDeg', <><polyline points={arc(0, p.tiltDeg, 20)} fill="none" stroke="#8a5eac"/><text x={sx + 32} y={sy + 20} className="illumination-symbol illumination-angle-symbol">θ = {numberText(p.tiltDeg)}°</text></>)}
            {marker('halfAngleDeg', <><polyline points={arc(p.tiltDeg, p.tiltDeg + p.halfAngleDeg, 39)} fill="none" stroke="#8a5eac" strokeDasharray="3 3"/>{[-1, 1].map(sign => { const a = (p.tiltDeg + sign * p.halfAngleDeg) * Math.PI / 180; return <line key={sign} x1={sx} y1={sy} x2={sx + Math.sin(a) * 58} y2={sy + Math.cos(a) * 58} stroke="#aa8fbb" strokeDasharray="3 3"/>; })}<text x={sx + 60} y={sy + 43} className="illumination-symbol illumination-angle-symbol">β = {numberText(p.halfAngleDeg)}°</text></>)}
          </svg>
          <div className="illumination-map-heading"><span>接收面俯视</span><label>色标上限<select aria-label="色标上限" value={colorMax} onChange={event => setColorMax(Number(event.target.value))}>{[50, 200, 1000, 8000].map(v => <option key={v} value={v}>{v} lx</option>)}</select></label></div>
          <div className="illumination-map" style={{ height: mapH }}><Heatmap values={b.values} colorMax={colorMax} left={mapLeft} top={mapTop} side={side}/><svg viewBox={`0 0 ${width} ${mapH}`} role="img" aria-label="可拖动观察点的接收面俯视图" onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
            <defs><linearGradient id={uid + '-color'} x1="0" y1="1" x2="0" y2="0">{COLORS.map((c, i) => <stop key={i} offset={i / 4} stopColor={`rgb(${c.join(',')})`}/>)}</linearGradient></defs>
            <rect x={mapLeft} y={mapTop} width={side} height={side} fill="none" stroke="#a9bdce"/>
            {[-4, -2, 0, 2, 4].map(v => <g key={v}><path d={`M${mx(v)} ${mapTop}V${mapTop + side} M${mapLeft} ${my(v)}H${mapLeft + side}`} stroke="#ffffff" strokeOpacity={.45} strokeWidth={.7}/><text x={mx(v)} y={mapTop + side + 17} textAnchor="middle">{v}</text><text x={mapLeft - 9} y={my(v) + 4} textAnchor="end">{v}</text></g>)}
            <text x={mapLeft - 8} y={mapTop - 4}>y / m</text><text x={mapLeft + side} y={mapTop + side + 34} textAnchor="end">x / m</text>
            <line x1={mapLeft} x2={mapLeft + side} y1={my(p.observationYM)} y2={my(p.observationYM)} stroke="#526f82" strokeDasharray="5 4" strokeWidth={1.1}/>
            {marker('observationXM', <><line x1={mx(p.observationXM)} x2={mx(p.observationXM)} y1={mapTop} y2={mapTop + side} stroke="#26836a" strokeDasharray="3 4"/><text x={mx(p.observationXM)} y={mapTop + side - 8} textAnchor="middle" className="illumination-symbol illumination-observation-symbol">x = {numberText(p.observationXM)} m</text></>)}
            {marker('observationYM', <text x={mapLeft + 7} y={clamp(my(p.observationYM) - 8, mapTop + 16, mapTop + side - 10)} className="illumination-symbol illumination-observation-symbol">y = {numberText(p.observationYM)} m</text>)}
            <g className="illumination-observation-handle" role="button" tabIndex={0} aria-label="图中观察点" onPointerDown={event => beginDrag(event, 'observation')} onKeyDown={event => handleKey(event, 'observation')}><circle cx={mx(p.observationXM)} cy={my(p.observationYM)} r={15} fill="transparent"/><circle cx={mx(p.observationXM)} cy={my(p.observationYM)} r={5} fill="#fff" stroke="#26836a" strokeWidth={2}/></g>
            {marker('illuminance', <text x={clamp(mx(p.observationXM) + 14, mapLeft + 72, mapLeft + side - 68)} y={clamp(my(p.observationYM) - 19, mapTop + 21, mapTop + side - 18)} textAnchor="middle" className="illumination-symbol illumination-observation-symbol">E = {numberText(b.observation.value)} lx</text>)}
            <rect x={mapLeft + side + 20} y={mapTop + 24} width={10} height={side - 48} fill={`url(#${uid}-color)`}/><text x={mapLeft + side + 35} y={mapTop + 29}>{colorMax}</text><text x={mapLeft + side + 35} y={mapTop + side - 23}>0</text><text x={mapLeft + side + 17} y={mapTop + side - 5}>lx</text>
          </svg></div>
        </div><div className="gs-visual-footer"><span>拖动灯体、方向点或观察点</span><span>虚线为观察线</span></div>
      </main>
      {resultsOpen && <><div className="gs-panel-resizer" {...layout.results.separator}/><aside className="gs-sidebar gfocus-results illumination-results" style={{ width: layout.results.width }} aria-label="照明结果"><div className="gs-sidebar-title"><h2><ScanLine size={16}/>结果与曲线</h2><button className="icon-button" aria-label="收起照明结果" onClick={() => setResultsOpen(false)}><X size={17}/></button></div><div className="gs-sidebar-scroll"><section className="gs-readouts gs-tone-screen"><h3>观察点</h3><div className="gs-primary-reading"><Label label="照度" symbol="E" active={marked('illuminance')} onClick={() => toggle('illuminance')}/><strong data-testid="illumination-reading">{numberText(b.observation.value)} <span>lx</span></strong></div></section><SectionCurve p={p} b={b}/><section className="gs-readouts illumination-area"><h3>接收区域</h3><dl><div><dt>平均照度</dt><dd>{numberText(b.average)} <span>lx</span></dd></div><div><dt>采样最大</dt><dd>{numberText(b.maximum)} <span>lx</span></dd></div><div><dt>均匀度</dt><dd>{numberText(b.uniformity)}</dd></div></dl><p className="point-label-hint">均匀度：最暗处 ÷ 平均照度<br/>固定 8 m × 8 m 区域，按网格估算</p></section></div></aside></>}
    </div><div className="gs-model-strip"><span>简化定向点光源 · 水平接收面</span><span>固定主轴光强</span></div>
    {formulaOpen && <SceneFormulaSheet state={illuminationState(p)} onClose={() => setFormulaOpen(false)}/>}
    {assistantOpen && <aside className="gs-drawer gs-assistant" aria-label="场景AI助手"><button className="gs-assistant-close icon-button" aria-label="关闭场景AI助手" onClick={onCloseAssistant}><X size={18}/></button><AssistantPanel sceneState={illuminationState(p)} editing={gesture.current || preview !== null} onApplyScene={applyAssistant} onRestoreScene={restoreAssistant}/></aside>}
    {notice && <div className="gs-notice" role="status">{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15}/></button></div>}
  </section>;
}

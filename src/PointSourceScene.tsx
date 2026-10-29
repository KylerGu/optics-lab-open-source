import SceneAssistantToggle from './SceneAssistantToggle';
import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, BookOpen, Maximize, PanelLeftClose, PanelLeftOpen, Redo2, RotateCcw, ScanLine, Settings2, Undo2, X } from 'lucide-react';
import { renderToString } from 'katex';
import AssistantPanel from './AssistantPanel';
import SceneFormulaSheet from './SceneFormulaSheet';
import { useScenePanelWidth } from './useScenePanelWidth';
import { draftKey, numberText, readScene, sceneKey, type SceneState } from './sceneRuntime';
import { DEFAULT_POINT, POINT_FIELDS, POINT_SOURCE_ID, illuminance, parsePoint, pointHistory, pointState, type PointHistory, type PointParameters } from './pointSource';
import './gaussian-scene.css';
import './gaussian-focus.css';
import './resonator-scene.css';
import './point-source.css';

type Annotation = keyof PointParameters | 'illuminance';
const ANNOTATIONS: Annotation[] = ['intensityCd', 'distanceM', 'illuminance'];
const ANNOTATION_KEY = 'optics-point-source-annotations:v1';
const equation = renderToString('E=\\frac{I}{r^2}', { displayMode: true, throwOnError: false });
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
function readAnnotations(): Annotation[] {
  try { const a = JSON.parse(localStorage.getItem(ANNOTATION_KEY) ?? 'null'); if (Array.isArray(a)) return a.filter((k): k is Annotation => ANNOTATIONS.includes(k)); } catch { /* Optional preference. */ }
  return [...ANNOTATIONS];
}
function QuantityLabel({ label, symbol, active, onClick }: { label: string; symbol: string; active: boolean; onClick: () => void }) {
  return <button className="resonator-quantity-label" aria-label={label} aria-pressed={active} title={active ? '点击隐藏图中标注' : '点击显示图中标注'} onClick={onClick}>{label}<i className="gs-quantity-symbol">{symbol}</i></button>;
}
function Parameter({ field, value, start, change, finish, marked, toggle }: { field: typeof POINT_FIELDS[number]; value: number; start: () => void; change: (value: number) => void; finish: () => void; marked: boolean; toggle: () => void }) {
  const [draft, setDraft] = useState(String(value)), [error, setError] = useState(false);
  useEffect(() => { setDraft(String(value)); setError(false); }, [value]);
  const submit = () => {
    const n = Number(draft);
    if (!draft.trim() || !Number.isFinite(n) || n < field.min || n > field.max) { setError(true); return; }
    start(); change(n); finish(); setError(false);
  };
  return <div className={`gs-parameter gs-tone-${field.tone}`}>
    <div className="resonator-parameter-line"><QuantityLabel label={field.label} symbol={field.symbol} active={marked} onClick={toggle}/><div className="gs-number"><input type="number" aria-label={field.label} aria-invalid={error} min={field.min} max={field.max} step={field.step} value={draft} onChange={e => { setDraft(e.target.value); setError(false); }} onBlur={submit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/><span>{field.unit}</span></div></div>
    <input type="range" aria-label={field.label + '滑杆'} min={field.min} max={field.max} step={field.step} value={value} style={{ '--range-fill': `${(value - field.min) / (field.max - field.min) * 100}%` } as CSSProperties}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); start(); }} onChange={e => { start(); change(Number(e.target.value)); }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onBlur={finish}
      onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) start(); }} onKeyUp={finish}/>
    {error && <small className="gs-error" role="alert">请输入 {field.min}–{field.max} {field.unit}。</small>}
  </div>;
}

function DistanceCurve({ p }: { p: PointParameters }) {
  const [logarithmic, setLogarithmic] = useState(true);
  const log = logarithmic && p.intensityCd > 0;
  const w = 310, h = 260, left = 57, right = 15, top = 28, bottom = 43;
  const pw = w - left - right, ph = h - top - bottom;
  const low = p.intensityCd > 0 ? Math.floor(Math.log10(illuminance(p, 10))) : 0;
  const high = p.intensityCd > 0 ? Math.ceil(Math.log10(illuminance(p, .2))) : 0;
  const ymax = Math.max(1, illuminance(p, .2));
  const x = (r: number) => left + (r - .2) / 9.8 * pw;
  const y = (e: number) => top + ph * (1 - (log ? (Math.log10(e) - low) / (high - low) : e / ymax));
  const yticks = log ? Array.from({ length: high - low + 1 }, (_, i) => 10 ** (low + i)) : [0, ymax / 4, ymax / 2, ymax * .75, ymax];
  const points = Array.from({ length: 501 }, (_, i) => { const r = .2 + 9.8 * i / 500; return `${x(r)},${y(illuminance(p, r))}`; }).join(' ');
  return <section className="point-curve" aria-label="照度随距离变化曲线"><div className="point-curve-heading"><h3>照度与距离</h3><div className="gs-plot-switch"><button aria-pressed={!logarithmic} className={!logarithmic ? 'active' : ''} onClick={() => setLogarithmic(false)}>线性</button><button aria-pressed={logarithmic} className={logarithmic ? 'active' : ''} onClick={() => setLogarithmic(true)}>对数</button></div></div>
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`照度距离曲线，当前距离${numberText(p.distanceM)}米，照度${numberText(illuminance(p))}勒克斯`}>
      {yticks.map(t => <g key={t}><line x1={left} x2={w - right} y1={y(t)} y2={y(t)} className="gs-grid"/><text x={left - 8} y={y(t) + 3} textAnchor="end">{numberText(t)}</text></g>)}
      {[.2, 2, 4, 6, 8, 10].map(t => <g key={t}><line x1={x(t)} x2={x(t)} y1={top} y2={h - bottom} className="gs-grid"/><text x={x(t)} y={h - bottom + 18} textAnchor="middle">{t}</text></g>)}
      <path d={`M${left} ${top}V${h - bottom}H${w - right}`} fill="none" className="gs-axis"/>
      <polyline points={points} fill="none" stroke="#26836a" strokeWidth={2}/>
      <path d={`M${x(p.distanceM)} ${h - bottom}V${y(illuminance(p))}H${left}`} fill="none" stroke="#8bb7a8" strokeDasharray="4 4"/>
      <circle data-testid="point-curve-current" cx={x(p.distanceM)} cy={y(illuminance(p))} r={4} fill="#fff" stroke="#26836a" strokeWidth={2}/>
      <text x={left} y={14}>E / lx</text><text x={w - right} y={h - 5} textAnchor="end">r / m</text>
    </svg><p>{log ? '纵轴每格相差 10 倍' : p.intensityCd === 0 ? '光源关闭，照度为 0' : '纵轴为等间距刻度'}</p>
  </section>;
}

export default function PointSourceScene({ onDirectory, assistantOpen, onCloseAssistant }: { onDirectory: () => void; assistantOpen: boolean; onCloseAssistant: () => void }) {
  const [history, dispatch] = useReducer(pointHistory, undefined, () => ({ past: [], present: parsePoint(readScene(POINT_SOURCE_ID).parameters), future: [] } as PointHistory));
  const [preview, setPreview] = useState<PointParameters | null>(null);
  const p = preview ?? history.present, latest = useRef(p); latest.current = p;
  const pending = useRef<PointParameters | null>(null), gesture = useRef(false), raf = useRef<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(true), [resultsOpen, setResultsOpen] = useState(true), [formulaOpen, setFormulaOpen] = useState(false);
  const [annotations, setAnnotations] = useState(readAnnotations), [saveFailed, setSaveFailed] = useState(false), [notice, setNotice] = useState('');
  const root = useRef<HTMLElement>(null), workspace = useRef<HTMLDivElement>(null), plot = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const layout = useScenePanelWidth(workspace, resultsOpen, panelOpen,{onLeftClose:()=>setPanelOpen(false),onRightClose:()=>setResultsOpen(false)});
  const [size, setSize] = useState({ width: 800, height: 550 });
  const start = useCallback(() => { gesture.current = true; }, []);
  const change = useCallback((field: keyof PointParameters, value: number) => {
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
  const marked = (key: Annotation) => annotations.includes(key);
  const toggle = (key: Annotation) => setAnnotations(a => a.includes(key) ? a.filter(k => k !== key) : [...a, key]);
  useEffect(() => { try { localStorage.setItem(draftKey(POINT_SOURCE_ID), JSON.stringify(pointState(history.present))); setSaveFailed(false); } catch { setSaveFailed(true); } }, [history.present]);
  useEffect(() => { try { localStorage.setItem(ANNOTATION_KEY, JSON.stringify(annotations)); } catch { /* Optional preference. */ } }, [annotations]);
  useEffect(() => () => { if (raf.current !== null) cancelAnimationFrame(raf.current); }, []);
  useEffect(() => { const el = plot.current; if (!el) return; const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; if (width > 0 && height > 0) setSize({ width, height }); }); observer.observe(el); return () => observer.disconnect(); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as Element)?.closest('input,textarea,select,[contenteditable=true]') || document.querySelector('dialog[open]')) return;
      if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); finish(); dispatch({ type: e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo' }); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [finish]);

  const width = Math.max(260, size.width), height = Math.max(300, size.height);
  const sx = 65, maxX = width - 68, scale = (maxX - sx) / 10, rx = sx + p.distanceM * scale;
  const cy = height * .46, screenHalf = Math.min(85, height * .18), e = illuminance(p);
  const brightness = e / (e + 100);
  const drag = useRef<{ id: number; x: number; distance: number; scale: number } | null>(null);
  const endDrag = () => { if (!drag.current) return; drag.current = null; finish(); };
  const applyAssistant = (state: SceneState) => {
    if (state.sceneId !== POINT_SOURCE_ID || gesture.current || document.activeElement?.matches('.point-source-scene .gs-parameter input')) return false;
    try { dispatch({ type: 'commit', parameters: parsePoint(state.parameters) }); return true; } catch { return false; }
  };
  const restoreAssistant = (before: SceneState, after: SceneState) => {
    if (gesture.current || sceneKey(pointState(latest.current)) !== sceneKey(after)) return false;
    const previous = history.past.at(-1);
    if (previous && sceneKey(pointState(previous)) === sceneKey(before)) { dispatch({ type: 'undo' }); return true; }
    return applyAssistant(before);
  };
  const reset = () => { finish(); dispatch({ type: 'commit', parameters: { ...DEFAULT_POINT } }); setAnnotations([...ANNOTATIONS]); };

  return <section ref={root} className={`gaussian-scene gaussian-focus-scene point-source-scene ${layout.resizing ? 'gs-panel-resizing' : ''}`} aria-label="点光源照度与距离场景">
    <div className="gs-heading"><div className="gs-title"><button className="icon-button" aria-label="返回仿真场景库" onClick={onDirectory}><ChevronLeft size={20}/></button><h1>点光源照度与距离</h1></div><div className="gs-heading-actions"><SceneAssistantToggle/><button className="outline-button" aria-haspopup="dialog" aria-expanded={formulaOpen} onClick={() => { finish(); setFormulaOpen(true); }}><BookOpen size={15}/>相关公式</button><button className="icon-button" aria-label="全屏查看场景" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen())?.catch(() => setNotice('浏览器未开启全屏。'))}><Maximize size={18}/></button></div></div>
    <div ref={workspace} className="gs-workspace">
      {panelOpen && <><aside className="gs-sidebar" style={{ width: layout.width }} aria-label="点光源参数"><div className="gs-sidebar-title"><h2><Settings2 size={16}/>参数调节</h2><button className="icon-button" aria-label="收起左侧参数" onClick={() => setPanelOpen(false)}><PanelLeftClose size={17}/></button></div><div className="gs-sidebar-scroll">
        <section><div className="point-equation" dangerouslySetInnerHTML={{ __html: equation }}/>{POINT_FIELDS.map(f => <Parameter key={f.key} field={f} value={p[f.key]} start={start} finish={finish} change={v => change(f.key, v)} marked={marked(f.key)} toggle={() => toggle(f.key)}/>)}<p className="point-label-hint">点击名称，显示或隐藏图中字母</p></section>
        <section className="gs-readouts point-reading gs-tone-screen"><h3>当前结果</h3><div className="gs-primary-reading"><QuantityLabel label="照度" symbol="E" active={marked('illuminance')} onClick={() => toggle('illuminance')}/><strong data-testid="point-illuminance">{numberText(e)} <span>lx</span></strong></div><p className="point-label-hint">接收面中心 · 垂直接收</p></section>
        <details className="point-conditions"><summary>模型条件</summary><p>理想点光源，只计算接收面中心。距离应远大于真实光源尺寸；不含环境光、吸收和反射。</p><p>光强 I：沿接收方向发出的光，单位 cd。照度 E：接收点有多亮，单位 lx。</p><p>接收面颜色仅作明暗示意，不代表整面照度分布。</p></details>
      </div><div className="gs-sidebar-footer"><button className="text-button" onClick={reset}><RotateCcw size={14}/>恢复默认</button><span>{saveFailed ? '本机保存不可用' : '已自动保存'}</span></div></aside><div className="gs-panel-resizer" {...layout.separator}/></>}
      <main className="gs-visual"><div className="gs-toolbar"><div className="gs-toolbar-left">{!panelOpen && <button className="icon-button" aria-label="展开左侧参数" onClick={() => setPanelOpen(true)}><PanelLeftOpen size={17}/></button>}<span className="gfocus-view-title">点光源与接收面</span></div><div className="gs-toolbar-right"><button className="icon-button" aria-label="撤销参数" disabled={!history.past.length && !preview} onClick={() => { finish(); dispatch({ type: 'undo' }); }}><Undo2 size={16}/></button><button className="icon-button" aria-label="重做参数" disabled={!history.future.length} onClick={() => { finish(); dispatch({ type: 'redo' }); }}><Redo2 size={16}/></button>{!resultsOpen && <button className="gs-spot-toggle" onClick={() => setResultsOpen(true)}><ScanLine size={15}/>曲线</button>}</div></div>
        <div ref={plot} className="gs-plot"><svg ref={svg} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="可拖动接收面的二维点光源示意图"
          onPointerMove={event => { const d = drag.current; if (d?.id === event.pointerId) { const box = svg.current!.getBoundingClientRect(); const delta = (event.clientX - d.x) * width / box.width / d.scale; change('distanceM', Number(clamp(d.distance + delta, .2, 10).toFixed(2))); } }}
          onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
          {[0, 2, 4, 6, 8, 10].map(r => <g key={r}><line x1={sx + r * scale} x2={sx + r * scale} y1={55} y2={height - 55} className="gs-grid" opacity={.6}/><text x={sx + r * scale} y={height - 30} textAnchor="middle">{r}</text></g>)}
          <line x1={sx - 28} x2={maxX + 24} y1={cy} y2={cy} className="gs-axis" strokeDasharray="5 5"/>
          <text x={maxX + 18} y={height - 10} textAnchor="end">距离 / m</text>
          {p.intensityCd > 0 && <g opacity={.25 + .6 * brightness}>{[-1, -.5, 0, .5, 1].map((a, i) => <line key={i} x1={sx} y1={cy} x2={rx} y2={cy + a * Math.min(screenHalf, (rx - sx) * .3)} stroke="#d6a253" strokeWidth={a === 0 ? 2 : 1.2}/>)}</g>}
          <circle cx={sx} cy={cy} r={23} fill={p.intensityCd ? '#f7dba3' : '#d8e0e9'} opacity={.35}/><circle cx={sx} cy={cy} r={9} fill={p.intensityCd ? '#e3b764' : '#9fabb8'}/>
          <text x={sx} y={cy + 46} textAnchor="middle">点光源</text>
          {marked('intensityCd') && <text data-testid="point-annotation-intensityCd" className="point-symbol point-source-symbol" x={sx} y={cy - 40} textAnchor="middle">I = {numberText(p.intensityCd)} cd</text>}
          <g className="point-receiver" role="slider" tabIndex={0} aria-label="图中接收面距离" aria-valuemin={.2} aria-valuemax={10} aria-valuenow={p.distanceM}
            onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); start(); drag.current = { id: event.pointerId, x: event.clientX, distance: latest.current.distanceM, scale }; svg.current?.setPointerCapture(event.pointerId); }}
            onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); start(); change('distanceM', event.key === 'Home' ? .2 : event.key === 'End' ? 10 : Number(clamp(latest.current.distanceM + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? .1 : .01), .2, 10).toFixed(2))); finish(); }}>
            <rect x={rx - 16} y={cy - screenHalf - 10} width={32} height={screenHalf * 2 + 20} fill="transparent"/>
            <rect x={rx - 7} y={cy - screenHalf} width={14} height={screenHalf * 2} rx={5} fill={`hsl(44 75% ${94 - 35 * brightness}%)`} stroke="#759e90" strokeWidth={1.7}/>
            <circle cx={rx} cy={cy} r={4} fill="#26836a" stroke="#fff"/>
          </g>
          <text x={rx} y={cy + screenHalf + 23} textAnchor="middle">接收面</text>
          {marked('illuminance') && <g className="point-annotation" data-testid="point-annotation-illuminance"><path d={`M${rx} ${cy}h22v-${screenHalf + 24}`} fill="none" stroke="#26836a" strokeWidth={1.1}/><text x={clamp(rx + 22, 92, width - 80)} y={cy - screenHalf - 35} textAnchor="middle" className="point-symbol point-result-symbol">E = {numberText(e)} lx</text></g>}
          {marked('distanceM') && <g className="point-annotation" data-testid="point-annotation-distanceM"><path d={`M${sx} ${cy + screenHalf + 62}H${rx} M${sx} ${cy + screenHalf + 57}v10 M${rx} ${cy + screenHalf + 57}v10`} className="gs-dimension"/><text x={Math.max(sx + 35, (sx + rx) / 2)} y={cy + screenHalf + 86} className="point-symbol" textAnchor="middle">r = {numberText(p.distanceM)} m</text></g>}
        </svg></div><div className="gs-visual-footer"><span>拖动接收面，改变距离</span><span>光线与颜色为示意</span></div>
      </main>
      {resultsOpen && <><div className="gs-panel-resizer" {...layout.results.separator}/><aside className="gs-sidebar gfocus-results point-results" style={{ width: layout.results.width }} aria-label="结果曲线"><div className="gs-sidebar-title"><h2><ScanLine size={16}/>结果曲线</h2><button className="icon-button" aria-label="收起结果曲线" onClick={() => setResultsOpen(false)}><X size={17}/></button></div><div className="gs-sidebar-scroll"><DistanceCurve p={p}/><section className="point-comparison"><h3>距离加倍</h3><div><span>{numberText(p.distanceM * 2)} m</span><strong>{numberText(e / 4)} <small>lx</small></strong></div><p>光强不变，照度为原来的 ¼</p></section></div></aside></>}
    </div><div className="gs-model-strip"><span>理想点光源 · 中心垂直接收</span><span>距离平方反比</span></div>
    {formulaOpen && <SceneFormulaSheet state={pointState(p)} onClose={() => setFormulaOpen(false)}/>}
    {assistantOpen && <aside className="gs-drawer gs-assistant" aria-label="场景AI助手"><button className="gs-assistant-close icon-button" aria-label="关闭场景AI助手" onClick={onCloseAssistant}><X size={18}/></button><AssistantPanel sceneState={pointState(p)} editing={gesture.current || preview !== null} onApplyScene={applyAssistant} onRestoreScene={restoreAssistant}/></aside>}
    {notice && <div className="gs-notice" role="status">{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15}/></button></div>}
  </section>;
}

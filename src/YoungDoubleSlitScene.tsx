import SceneAssistantToggle from './SceneAssistantToggle';
import { useCallback, useEffect, useId, useReducer, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { BookOpen, ChevronLeft, Maximize, Minus, PanelLeftClose, PanelLeftOpen, Plus, Redo2, RotateCcw, ScanLine, Settings2, Undo2, X } from 'lucide-react';
import { DEFAULT_YOUNG, YOUNG_DRAFT_KEY, YOUNG_FIELDS, YOUNG_SCENE_ID, parseYoung, youngHistory, youngState, youngDoubleSlit, youngLightColor, type YoungHistory, type YoungParameters } from './youngDoubleSlit';
import AssistantPanel from './AssistantPanel';
import SceneFormulaSheet from './SceneFormulaSheet';
import { useScenePanelWidth } from './useScenePanelWidth';
import { type SceneState, sceneKey } from './sceneRuntime';
import './gaussian-scene.css';
import './gaussian-focus.css';
import './resonator-scene.css';
import './young-double-slit.css';

type Field = keyof YoungParameters;
type Annotation = 'slitDistanceMm' | 'screenDistanceM' | 'observationMm' | 'spacing' | 'r1' | 'r2';
const ANNOTATIONS: Annotation[] = ['slitDistanceMm', 'screenDistanceM', 'observationMm', 'spacing', 'r1', 'r2'];
const DEFAULT_ANNOTATIONS: Annotation[] = ['slitDistanceMm', 'screenDistanceM', 'observationMm', 'spacing'];
const ANNOTATION_KEY = 'optics-young-double-slit-annotations:v1';
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const fmt = (n: number) => Math.abs(n) < 1e-10 ? '0' : Math.abs(n) < .0001 ? n.toExponential(3) : Number(n.toFixed(4)).toString();
function readYoung() {
  try { const stored = localStorage.getItem(YOUNG_DRAFT_KEY); if (stored) { const s = JSON.parse(stored); if (s.version === 1 && s.sceneId === YOUNG_SCENE_ID) return parseYoung(s.parameters); } } catch { /* Fall back to a valid scene. */ }
  return { ...DEFAULT_YOUNG };
}
function readAnnotations(): Annotation[] {
  try { const a = JSON.parse(localStorage.getItem(ANNOTATION_KEY) ?? 'null'); if (Array.isArray(a)) return a.filter((k): k is Annotation => ANNOTATIONS.includes(k)); } catch { /* Optional preferences. */ }
  return [...DEFAULT_ANNOTATIONS];
}
function QuantityLabel({ label, symbol, active, onClick }: { label: string; symbol: string; active: boolean; onClick: () => void }) {
  return <button type="button" className="resonator-quantity-label" aria-label={label} aria-pressed={active} title={active ? '点击隐藏图中标注' : '点击显示图中标注'} onClick={onClick}>{label}<i className="gs-quantity-symbol">{symbol}</i></button>;
}
function Parameter({ field, value, change, start, finish, marked, toggle }: { field: typeof YOUNG_FIELDS[number]; value: number; change: (v: number) => void; start: () => void; finish: () => void; marked: boolean; toggle?: () => void }) {
  const display = Number(value.toFixed(5)).toString();
  const [draft, setDraft] = useState(display), [error, setError] = useState(false);
  useEffect(() => { setDraft(Number(value.toFixed(5)).toString()); setError(false); }, [value]);
  const submit = () => {
    if (draft === display) return;
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

export default function YoungDoubleSlitScene({ onDirectory, assistantOpen, onCloseAssistant }: { onDirectory: () => void; assistantOpen: boolean; onCloseAssistant: () => void }) {
  const [initial] = useState(readYoung);
  const [history, dispatch] = useReducer(youngHistory, { past: [], present: initial, future: [] } as YoungHistory);
  const [preview, setPreview] = useState<YoungParameters | null>(null);
  const p = preview ?? history.present, latest = useRef(p); latest.current = p;
  const pending = useRef<YoungParameters | null>(null), gesture = useRef(false), raf = useRef<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(true), [resultsOpen, setResultsOpen] = useState(true), [formulaOpen, setFormulaOpen] = useState(false);
  const [annotations, setAnnotations] = useState(readAnnotations);
  const [view, setView] = useState({ center: 0, span: 10 }), [zoom, setZoom] = useState(1);
  const [notice, setNotice] = useState(''), [saveFailed, setSaveFailed] = useState(false), [resetVersion, setResetVersion] = useState(0);
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
  useEffect(() => { try { localStorage.setItem(YOUNG_DRAFT_KEY, JSON.stringify(youngState(history.present))); setSaveFailed(false); } catch { setSaveFailed(true); } }, [history.present]);
  useEffect(() => () => { if (raf.current !== null) cancelAnimationFrame(raf.current); }, []);
  useEffect(() => { const el = plot.current; if (!el) return; const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; if (width > 0 && height > 0) setSize({ width, height }); }); observer.observe(el); return () => observer.disconnect(); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as Element)?.closest('input,textarea,select,[contenteditable=true]') || document.querySelector('dialog[open]')) return;
      if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); finish(); dispatch({ type: e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo' }); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [finish]);

  const b = youngDoubleSlit(p), width = Math.max(300, size.width), height = Math.max(240, size.height);
  const top = 48, bottom = height - 54, ph = bottom - top, left = 40, right = width - 24, pw = right - left;
  const y = (position: number) => top + (.5 - (position - view.center) / view.span) * ph;
  const visible = (position: number) => y(position) >= top && y(position) <= bottom;
  const zero = y(0), slitX = left + pw * .09, screenX = left + pw * (.49 + .09 * (p.screenDistanceM - .5) / 1.5);
  const stripWidth = clamp(pw * .065, 20, 44), curveX = screenX + stripWidth + 56, curveWidth = right - curveX;
  const gap = 15 + 28 * p.slitDistanceMm, slitYs = [zero - gap, zero + gap], pointY = y(p.observationMm);
  const intensityX = (intensity: number) => curveX + intensity * curveWidth;
  const samples = Math.max(360, Math.ceil(ph * 2));
  const atPixel = (i: number) => b.at(view.center + view.span * (.5 - i / samples));
  const curve = Array.from({ length: samples + 1 }, (_, i) => `${intensityX(atPixel(i).intensity)},${top + ph * i / samples}`).join(' ');
  const lightColor = youngLightColor(p.wavelengthNm);
  const bands = Array.from({ length: Math.ceil(ph) }, (_, i) => {
    let intensity = 0;
    for (let j = 0; j < 5; j++) intensity += b.at(view.center + view.span * (.5 - (i + (j + .5) / 5) / ph)).intensity / 5;
    return { yy: top + i, color: `rgb(${lightColor.map(c => Math.round(7 + (c - 7) * Math.sqrt(intensity))).join(',')})` };
  });
  const drag = useRef<{ id: number; clientY: number; value: number; span: number; height: number } | null>(null);
  const startDrag = (e: ReactPointerEvent<SVGGElement>) => {
    if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); e.currentTarget.focus(); start();
    drag.current = { id: e.pointerId, clientY: e.clientY, value: latest.current.observationMm, span: view.span, height: ph };
    svg.current?.setPointerCapture(e.pointerId);
  };
  const endDrag = () => { finish(); drag.current = null; };
  const moveObservation = (value: number) => change('observationMm', Number(clamp(value, -20, 20).toFixed(5)));
  const adjustZoom = (factor: number, ratio = .5) => {
    const next = clamp(zoom * factor, .25, 12), span = view.span * zoom / next;
    setView({ center: view.center + (.5 - ratio) * (view.span - span), span }); setZoom(next);
  };
  const wheelHandler = useRef<(e: WheelEvent) => void>(() => {});
  wheelHandler.current = e => { e.preventDefault(); const box = plot.current!.getBoundingClientRect(); adjustZoom(Math.exp(-e.deltaY * .0015), clamp((e.clientY - box.top - top) / ph, 0, 1)); };
  useEffect(() => { const el = plot.current; if (!el) return; const wheel = (e: WheelEvent) => wheelHandler.current(e); el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel); }, []);
  const showObservation = (value: number) => {
    if (!visible(value) || !visible(0)) {
      const span = Math.min(40, Math.max(10, Math.abs(value) * 1.4));
      setView({ center: value / 2, span }); setZoom(10 / span);
    }
  };
  const applyAssistant = (state: SceneState) => {
    if (state.sceneId !== YOUNG_SCENE_ID || gesture.current || document.activeElement?.matches('.young-double-slit-scene .gs-parameter input')) return false;
    try { const next = parseYoung(state.parameters); dispatch({ type: 'commit', parameters: next }); showObservation(next.observationMm); return true; } catch { return false; }
  };
  const restoreAssistant = (before: SceneState, after: SceneState) => {
    if (gesture.current || sceneKey(youngState(latest.current)) !== sceneKey(after)) return false;
    const previous = history.past.at(-1);
    if (previous && sceneKey(youngState(previous)) === sceneKey(before)) { dispatch({ type: 'undo' }); showObservation(previous.observationMm); return true; }
    return applyAssistant(before);
  };
  const reset = () => { finish(); dispatch({ type: 'commit', parameters: { ...DEFAULT_YOUNG } }); setView({ center: 0, span: 10 }); setZoom(1); setAnnotations([...DEFAULT_ANNOTATIONS]); setResetVersion(v => v + 1); };
  const preset = (value: number) => { finish(); dispatch({ type: 'commit', parameters: { ...latest.current, observationMm: value } }); showObservation(value); };
  const dimension = (key: Annotation, xx: number, y1: number, y2: number, symbol: string, color: string) => marked(key) && <g data-testid={`young-${key==='observationMm'?'dimension':'annotation'}-${key}`}><path d={`M${xx} ${y1}V${y2} M${xx-4} ${y1}H${xx+4} M${xx-4} ${y2}H${xx+4}`} fill="none" stroke={color}/><text className="young-symbol" x={key==='spacing'?xx+8:xx-9} y={(y1 + y2)/2 + (key==='spacing'?-9:5)} textAnchor={key==='spacing'?'start':'end'} style={{ fill: color }}>{symbol}</text></g>;

  return <section ref={root} className={`gaussian-scene gaussian-focus-scene young-double-slit-scene ${layout.resizing ? 'gs-panel-resizing' : ''}`} aria-label="杨氏双缝干涉场景">
    <div className="gs-heading"><div className="gs-title"><button className="icon-button" aria-label="返回仿真场景库" onClick={onDirectory}><ChevronLeft size={20}/></button><h1>杨氏双缝干涉</h1></div><div className="gs-heading-actions"><SceneAssistantToggle/><button className="outline-button" aria-haspopup="dialog" aria-expanded={formulaOpen} onClick={() => { finish(); setFormulaOpen(true); }}><BookOpen size={15}/>相关公式</button><button className="icon-button" aria-label="全屏查看场景" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen())?.catch(() => setNotice('浏览器未开启全屏。'))}><Maximize size={18}/></button></div></div>
    <div ref={workspace} className="gs-workspace">
      {panelOpen && <><aside className="gs-sidebar" style={{ width: layout.width }} aria-label="双缝参数"><div className="gs-sidebar-title"><h2><Settings2 size={16}/>参数调节</h2><button className="icon-button" aria-label="收起左侧参数" onClick={() => setPanelOpen(false)}><PanelLeftClose size={17}/></button></div><div className="gs-sidebar-scroll">
        {[{ title: '光源与装置', keys: ['wavelengthNm', 'slitDistanceMm', 'screenDistanceM'] }, { title: '观察位置', keys: ['observationMm'] }].map(section => <section key={section.title}><h3>{section.title}</h3>{YOUNG_FIELDS.filter(f => section.keys.includes(f.key)).map(f => <Parameter key={f.key + resetVersion} field={f} value={p[f.key]} start={start} finish={finish} change={value => change(f.key, value)} marked={marked(f.key as Annotation)} toggle={ANNOTATIONS.includes(f.key as Annotation) ? () => toggle(f.key as Annotation) : undefined}/>)}{section.keys.includes('observationMm') && <div className="gs-presets">{[{ title: '中央亮纹', value: 0 }, { title: '第一亮纹', value: b.firstBrightMm }, { title: '第一暗纹', value: b.firstDarkMm }].map(t => <button key={t.title} className={Math.abs(p.observationMm - t.value) < 1e-8 ? 'selected' : ''} onClick={() => preset(t.value)}>{t.title}</button>)}</div>}</section>)}
      </div><div className="gs-sidebar-footer"><button className="text-button" onClick={reset}><RotateCcw size={14}/>恢复默认</button><span>{saveFailed ? '本机保存不可用' : '已自动保存'}</span></div></aside><div className="gs-panel-resizer" {...layout.separator}/></>}
      <main className="gs-visual"><div className="gs-toolbar"><div className="gs-toolbar-left">{!panelOpen && <button className="icon-button" aria-label="展开左侧参数" onClick={() => setPanelOpen(true)}><PanelLeftOpen size={17}/></button>}<span className="gfocus-view-title">光路与干涉条纹</span></div><div className="gs-toolbar-right"><button className="icon-button" aria-label="撤销双缝参数" disabled={!history.past.length && !preview} onClick={() => { finish(); dispatch({ type: 'undo' }); }}><Undo2 size={16}/></button><button className="icon-button" aria-label="重做双缝参数" disabled={!history.future.length} onClick={() => { finish(); dispatch({ type: 'redo' }); }}><Redo2 size={16}/></button>{!resultsOpen && <button className="gs-spot-toggle" aria-label="展开干涉结果" onClick={() => setResultsOpen(true)}><ScanLine size={15}/>结果</button>}</div></div>
        <div ref={plot} className="gs-plot">
          {!visible(p.observationMm) && <button className="gs-outside-screen" onClick={() => showObservation(p.observationMm)}>观察位置在视野外 · 定位</button>}
          <svg ref={svg} viewBox={`0 0 ${width} ${height}`} data-testid="young-plot" data-center-mm={view.center} data-span-mm={view.span} aria-label="双缝到同一观察点的光路、屏上明暗条纹与对应光强" onPointerMove={e => { const d = drag.current; if (d && d.id === e.pointerId) moveObservation(d.value - (e.clientY - d.clientY) / d.height * d.span); }} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
            <defs><clipPath id={`${uid}-clip`}><rect x={left - 35} y={top} width={pw + 41} height={ph}/></clipPath></defs>
            <text className="young-title" x={slitX} y={25} textAnchor="middle">双缝</text><text className="young-title" x={screenX + stripWidth/2} y={25} textAnchor="middle">观察屏</text><text className="young-title" x={curveX + curveWidth/2} y={25} textAnchor="middle">光强</text>
            <g clipPath={`url(#${uid}-clip)`}>
              {Array.from({ length: 5 }, (_, i) => { const position = view.center + view.span * (.5 - i/4), yy = y(position); return <g key={i}><line className="gs-grid" x1={screenX} x2={right} y1={yy} y2={yy}/><text className="young-tick" x={screenX - 9} y={yy + (i===0?12:i===4?-4:4)} textAnchor="end">{fmt(position)}</text></g>; })}
              <line className="gs-axis" x1={left - 30} x2={right} y1={zero} y2={zero} strokeDasharray="5 5"/>
              <path d={`M${slitX} ${top}V${slitYs[0]-5} M${slitX} ${slitYs[0]+5}V${slitYs[1]-5} M${slitX} ${slitYs[1]+5}V${bottom}`} stroke="#b6c8db" strokeWidth={5} fill="none"/>
              {[slitYs[0], zero, slitYs[1]].map((yy, i) => <path key={i} d={`M${left-28} ${yy}H${slitX-12}`} stroke="#d0deeb" strokeWidth={1.4}/>)}
              <text className="young-symbol" x={slitX+10} y={slitYs[0]-9} style={{ fill: '#357fc6' }}>S₁</text><text className="young-symbol" x={slitX+10} y={slitYs[1]+20} style={{ fill: '#c16b37' }}>S₂</text>
              {dimension('slitDistanceMm', slitX - 14, slitYs[0], slitYs[1], 'd', '#357fc6')}
              {visible(p.observationMm) && slitYs.map((yy, i) => <g key={i}><line data-testid={`young-path-${i+1}`} x1={slitX} x2={screenX} y1={yy} y2={pointY} stroke={['#357fc6','#c16b37'][i]} strokeWidth={2} opacity={.8}/>{marked(i===0?'r1':'r2') && <text data-testid={`young-annotation-r${i+1}`} className="young-symbol" x={slitX+(screenX-slitX)*(.4+i*.2)} y={yy+(pointY-yy)*(.4+i*.2)+(i===0?-12:20)} style={{ fill: ['#357fc6','#c16b37'][i] }}>r{i===0?'₁':'₂'}</text>}</g>)}
              <rect x={screenX} y={top} width={stripWidth} height={ph} fill="#070707"/>
              <g data-testid="young-fringes">{bands.map((t,i) => <rect key={i} x={screenX} y={t.yy} width={stripWidth} height={Math.min(1.15,bottom-t.yy)} fill={t.color}/>)}</g>
              <rect x={screenX} y={top} width={stripWidth} height={ph} fill="none" stroke="#ccd8e4"/>
              {dimension('spacing', screenX + stripWidth + 17, zero, y(b.spacingApproxMm), 'Δy', '#8a5eac')}
              {marked('observationMm') && Math.abs(p.observationMm) > 1e-8 && dimension('observationMm', screenX - 23, zero, pointY, 'y', '#26836a')}
              <line className="gs-axis" x1={curveX} x2={curveX} y1={top} y2={bottom}/>
              <polyline data-testid="young-intensity-curve" points={curve} fill="none" stroke="#8a5eac" strokeWidth={2}/>
              {marked('observationMm') && visible(p.observationMm) && <g data-testid="young-annotation-observationMm" className="young-observation-handle" role="slider" tabIndex={0} aria-label="图中观察位置" aria-valuemin={-20} aria-valuemax={20} aria-valuenow={p.observationMm} onPointerDown={startDrag} onKeyDown={e => { if (!['ArrowUp','ArrowDown'].includes(e.key)) return; e.preventDefault(); start(); moveObservation(latest.current.observationMm + (e.key==='ArrowUp'?1:-1) * (e.shiftKey?.1:.01)); finish(); }}>
                <rect x={screenX-6} y={pointY-10} width={right-screenX+12} height={20} fill="transparent"/>
                <line x1={screenX-4} x2={right} y1={pointY} y2={pointY} stroke="#26836a" strokeDasharray="4 4"/>
                <circle data-testid="young-observation-point" cx={screenX} cy={pointY} r={5} fill="#26836a" stroke="#fff" strokeWidth={1.4}/><text className="young-symbol" x={screenX-9} y={pointY-11} textAnchor="end" style={{ fill: '#26836a' }}>P</text>
                <circle data-testid="young-intensity-point" data-intensity={b.observation.intensity} cx={intensityX(b.observation.intensity)} cy={pointY} r={4.5} fill="#8a5eac" stroke="#fff" strokeWidth={1.4}/>
              </g>}
            </g>
            {marked('screenDistanceM') && <g data-testid="young-annotation-screenDistanceM"><path d={`M${slitX} ${bottom+20}H${screenX} M${slitX} ${bottom+16}V${bottom+24} M${screenX} ${bottom+16}V${bottom+24}`} stroke="#8a5eac" fill="none"/><text className="young-symbol" x={(slitX+screenX)/2} y={bottom+15} textAnchor="middle" style={{ fill:'#8a5eac' }}>L</text></g>}
            <text x={curveX} y={bottom+20} textAnchor="middle">0</text><text x={right} y={bottom+20} textAnchor="middle">1</text>
            <text className="gs-axis-label" x={screenX+stripWidth/2} y={bottom+43} textAnchor="middle">y / mm</text><text className="gs-axis-label" x={curveX+curveWidth/2} y={bottom+43} textAnchor="middle">I / Iₘₐₓ →</text>
          </svg>
        </div>
        <div className="gs-visual-footer"><span>拖动观察点 · 滚轮缩放</span><div className="gs-plot-controls"><button className="icon-button" aria-label="缩小双缝图" disabled={zoom <= .25} onClick={() => adjustZoom(1/1.35)}><Minus size={16}/></button><span>{fmt(zoom)}×</span><button className="icon-button" aria-label="放大双缝图" disabled={zoom >= 12} onClick={() => adjustZoom(1.35)}><Plus size={16}/></button></div></div>
      </main>
      {resultsOpen && <><div className="gs-panel-resizer" {...layout.results.separator}/><aside className="gs-sidebar gfocus-results" style={{ width: layout.results.width }} aria-label="干涉结果"><div className="gs-sidebar-title"><h2>干涉结果</h2><button className="icon-button" aria-label="收起干涉结果" onClick={() => setResultsOpen(false)}><X size={17}/></button></div><div className="gs-sidebar-scroll">
        <section className="gs-readouts gfocus-main-readouts"><div className="gs-primary-reading gs-tone-output"><small>{label('spacing','条纹间距','Δy')}</small><strong data-testid="young-spacing">{fmt(b.spacingApproxMm)}<span> mm</span></strong><span className="young-primary-note">近轴近似</span></div><div className="gs-primary-reading gs-tone-output"><small>观察点相对光强 <i className="gs-quantity-symbol">I / Iₘₐₓ</i></small><strong data-testid="young-intensity">{fmt(b.observation.intensity)}</strong></div><p className="young-status" data-testid="young-status">{b.status}</p></section>
        <section className="gs-readouts"><h3>同一观察点</h3><dl><div><dt>有向光程差 <i className="gs-quantity-symbol">δ</i></dt><dd data-testid="young-delta">{fmt(b.observation.deltaUm)} μm</dd></div><div><dt>光程差 / 波长</dt><dd data-testid="young-cycles">{fmt(b.observation.cycles)}</dd></div></dl><p className="young-primary-note">整数为亮纹 · 半整数为暗纹</p></section>
        <section className="gs-readouts"><h3>两条光程</h3><dl>{[{ key:'r1' as const, title:'上缝到观察点', symbol:'r₁', value:b.observation.r1 },{ key:'r2' as const, title:'下缝到观察点', symbol:'r₂', value:b.observation.r2 }].map(t => <div key={t.key}><dt>{label(t.key,t.title,t.symbol)}</dt><dd>{(t.value/1000).toFixed(7)} m</dd></div>)}</dl></section>
        <details className="young-details"><summary>模型条件</summary><p>单色、等强、同相、同偏振且完全相干。采用理想窄缝，忽略单缝衍射包络、传播振幅衰减与部分相干；显示时间平均光强，最亮为1。</p><p>按两条完整距离之差计算光程差与亮暗。双缝局部放大；屏上的毫米标尺与光强曲线共用同一位置坐标。条纹颜色仅示意波长。</p></details>
      </div></aside></>}
    </div><div className="gs-model-strip"><span>双缝局部放大 · 屏上位置按毫米标尺</span><span>δ = r₂ − r₁</span></div>
    {formulaOpen && <SceneFormulaSheet state={youngState(p)} onClose={() => setFormulaOpen(false)}/>}
    {assistantOpen && <aside className="gs-drawer gs-assistant" aria-label="场景AI助手"><button className="gs-assistant-close icon-button" aria-label="关闭场景AI助手" onClick={onCloseAssistant}><X size={18}/></button><AssistantPanel sceneState={youngState(p)} editing={gesture.current || preview !== null} onApplyScene={applyAssistant} onRestoreScene={restoreAssistant}/></aside>}
    {notice && <div className="gs-notice" role="status">{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15}/></button></div>}
  </section>;
}

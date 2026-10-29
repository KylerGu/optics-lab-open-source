import SceneAssistantToggle from './SceneAssistantToggle';
import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { BookOpen, Copy, ChevronLeft, Maximize, PanelLeftClose, PanelLeftOpen, Redo2, RotateCcw, ScanLine, Settings2, Undo2, X } from 'lucide-react';
import { DEFAULT_CIRCULAR, CIRCULAR_DRAFT_KEY, CIRCULAR_FIELDS, CIRCULAR_ID, parseCircular, circularHistory, circularState, circularDiffraction, type CircularHistory, type CircularParameters } from './circularDiffraction';
import CircularDiffractionApparatus from './CircularDiffractionApparatus';
import CircularObservation from './CircularObservation';
import { circularBuilderCopy } from './circularDiffraction';
import type { SpatialExperiment } from './builderModel';
import AssistantPanel from './AssistantPanel';
import SceneFormulaSheet from './SceneFormulaSheet';
import { useScenePanelWidth } from './useScenePanelWidth';
import { type SceneState, sceneKey } from './sceneRuntime';
import './gaussian-scene.css';
import './gaussian-focus.css';
import './resonator-scene.css';
import './circular-diffraction.css';

type Field = keyof CircularParameters;
type Annotation = 'wavelengthNm' | 'apertureDiameterMm' | 'focalLengthMm' | 'observationRadiusUm' | 'airyDiameter' | 'firstDark' | 'theta' | 'intensity';
const ANNOTATIONS: Annotation[] = ['wavelengthNm','apertureDiameterMm','focalLengthMm','observationRadiusUm','airyDiameter','firstDark','theta','intensity'];
const DEFAULT_ANNOTATIONS: Annotation[] = ['apertureDiameterMm','focalLengthMm','observationRadiusUm','airyDiameter'];
const ANNOTATION_KEY = 'optics-circular-diffraction-annotations:v1';
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const fmt = (n: number) => Math.abs(n) < 1e-10 ? '0' : Math.abs(n) < .0001 ? n.toExponential(3) : Number(n.toFixed(4)).toString();
function readCircular() {
  try { const stored = localStorage.getItem(CIRCULAR_DRAFT_KEY); if (stored) { const s = JSON.parse(stored); if (s.version === 1 && s.sceneId === CIRCULAR_ID) return parseCircular(s.parameters); } } catch { /* Fall back to a valid scene. */ }
  return { ...DEFAULT_CIRCULAR };
}
function readAnnotations(): Annotation[] {
  try { const a = JSON.parse(localStorage.getItem(ANNOTATION_KEY) ?? 'null'); if (Array.isArray(a)) return a.filter((k): k is Annotation => ANNOTATIONS.includes(k)); } catch { /* Optional preferences. */ }
  return [...DEFAULT_ANNOTATIONS];
}
function QuantityLabel({ label, symbol, active, onClick }: { label: string; symbol: string; active: boolean; onClick: () => void }) {
  return <button type="button" className="resonator-quantity-label" aria-label={label} aria-pressed={active} title={active ? '点击隐藏图中标注' : '点击显示图中标注'} onClick={onClick}>{label}<i className="gs-quantity-symbol">{symbol}</i></button>;
}
function Parameter({ field, value, change, start, finish, marked, toggle }: { field: typeof CIRCULAR_FIELDS[number]; value: number; change: (v: number) => void; start: () => void; finish: () => void; marked: boolean; toggle?: () => void }) {
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

export default function CircularDiffractionScene({ onDirectory, assistantOpen, onCloseAssistant, onCopy }: { onCopy: (s: SpatialExperiment) => void; onDirectory: () => void; assistantOpen: boolean; onCloseAssistant: () => void }) {
  const [initial] = useState(readCircular);
  const [history, dispatch] = useReducer(circularHistory, { past: [], present: initial, future: [] } as CircularHistory);
  const [preview, setPreview] = useState<CircularParameters | null>(null);
  const p = preview ?? history.present, latest = useRef(p); latest.current = p;
  const pending = useRef<CircularParameters | null>(null), gesture = useRef(false), raf = useRef<number | null>(null);
  const [compact,setCompact]=useState(()=>window.innerWidth<1000);
  const [panelOpen, setPanelOpen] = useState(()=>window.innerWidth>=1000), [resultsOpen, setResultsOpen] = useState(()=>window.innerWidth>=1280), [formulaOpen, setFormulaOpen] = useState(false);
  const [annotations, setAnnotations] = useState(readAnnotations);
  useEffect(()=>{
    const left=matchMedia('(max-width:999px)'),right=matchMedia('(max-width:1279px)');
    const changeLeft=()=>{setCompact(left.matches);setPanelOpen(!left.matches);};
    const changeRight=()=>setResultsOpen(!right.matches);
    left.addEventListener('change',changeLeft);right.addEventListener('change',changeRight);
    return()=>{left.removeEventListener('change',changeLeft);right.removeEventListener('change',changeRight);};
  },[]);
  const [viewRadius, setViewRadius] = useState(160), [zoom, setZoom] = useState(1);
  const [notice, setNotice] = useState(''), [saveFailed, setSaveFailed] = useState(false), [resetVersion, setResetVersion] = useState(0);
  const root = useRef<HTMLElement>(null), workspace = useRef<HTMLDivElement>(null);
  const layout = useScenePanelWidth(workspace, resultsOpen, panelOpen,{onLeftClose:()=>setPanelOpen(false),onRightClose:()=>setResultsOpen(false)});
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
  useEffect(() => { try { localStorage.setItem(CIRCULAR_DRAFT_KEY, JSON.stringify(circularState(history.present))); setSaveFailed(false); } catch { setSaveFailed(true); } }, [history.present]);
  useEffect(() => () => { if (raf.current !== null) cancelAnimationFrame(raf.current); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as Element)?.closest('input,textarea,select,[contenteditable=true]') || document.querySelector('dialog[open]')) return;
      if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); finish(); dispatch({ type: e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo' }); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [finish]);

  const b=circularDiffraction(p),visible=(v:number)=>v<=viewRadius;
  const adjustZoom=(factor:number)=>{const next=clamp(zoom*factor,.16,40);setViewRadius(160/next);setZoom(next);};
  const fitScreen=()=>{const next=clamp(Math.max(b.firstDarkRadiusUm*4.2,p.observationRadiusUm*1.15),4,1000);setViewRadius(next);setZoom(160/next);};
  const showObservation=(v:number)=>{if(!visible(v)){const next=Math.max(160,v*1.15);setViewRadius(next);setZoom(160/next);}};
  const applyAssistant = (state: SceneState) => {
    if (state.sceneId !== CIRCULAR_ID || gesture.current || document.activeElement?.matches('.circular-diffraction-scene .gs-parameter input')) return false;
    try { const next = parseCircular(state.parameters); dispatch({ type: 'commit', parameters: next }); showObservation(next.observationRadiusUm); return true; } catch { return false; }
  };
  const restoreAssistant = (before: SceneState, after: SceneState) => {
    if (gesture.current || sceneKey(circularState(latest.current)) !== sceneKey(after)) return false;
    const previous = history.past.at(-1);
    if (previous && sceneKey(circularState(previous)) === sceneKey(before)) { dispatch({ type: 'undo' }); showObservation(previous.observationRadiusUm); return true; }
    return applyAssistant(before);
  };
  const reset = () => { finish(); dispatch({ type: 'commit', parameters: { ...DEFAULT_CIRCULAR } }); setViewRadius(160); setZoom(1); setAnnotations([...DEFAULT_ANNOTATIONS]); setResetVersion(v => v + 1); };
  const preset = (value: number) => { finish(); dispatch({ type: 'commit', parameters: { ...latest.current, observationRadiusUm: value } }); showObservation(value); };

  return <section ref={root} className={`gaussian-scene gaussian-focus-scene circular-diffraction-scene ${layout.resizing ? 'gs-panel-resizing' : ''}`} aria-label="圆孔衍射场景">
    <div className="gs-heading"><div className="gs-title"><button className="icon-button" aria-label="返回仿真场景库" onClick={onDirectory}><ChevronLeft size={20}/></button><h1>圆孔衍射</h1></div><div className="gs-heading-actions"><SceneAssistantToggle/><button className="gs-copy-button" onClick={() => { finish(); onCopy(circularBuilderCopy(latest.current)); }}><Copy size={16}/>复制到光路搭建</button><button className="outline-button" aria-haspopup="dialog" aria-expanded={formulaOpen} onClick={() => { finish(); setFormulaOpen(true); }}><BookOpen size={15}/>相关公式</button><button className="icon-button" aria-label="全屏查看场景" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen())?.catch(() => setNotice('浏览器未开启全屏。'))}><Maximize size={18}/></button></div></div>
    <div ref={workspace} className="gs-workspace">
      {panelOpen && <><aside className="gs-sidebar" style={{ width: layout.width }} aria-label="圆孔参数"><div className="gs-sidebar-title"><h2><Settings2 size={16}/>参数调节</h2><button className="icon-button" aria-label="收起左侧参数" onClick={() => setPanelOpen(false)}><PanelLeftClose size={17}/></button></div><div className="gs-sidebar-scroll">
        {[{ title: '光源与装置', keys: ['wavelengthNm', 'apertureDiameterMm', 'focalLengthMm'] }, { title: '观察位置', keys: ['observationRadiusUm'] }].map(section => <section key={section.title}><h3>{section.title}</h3>{CIRCULAR_FIELDS.filter(f => section.keys.includes(f.key)).map(f => <Parameter key={f.key + resetVersion} field={f} value={p[f.key]} start={start} finish={finish} change={value => change(f.key, value)} marked={marked(f.key as Annotation)} toggle={ANNOTATIONS.includes(f.key as Annotation) ? () => toggle(f.key as Annotation) : undefined}/>)}{section.keys.includes('observationRadiusUm') && <div className="gs-presets">{[{ title: '中央亮斑', value: 0 }, { title: '第一暗环', value: b.firstDarkRadiusUm }].map(t => <button key={t.title} className={Math.abs(p.observationRadiusUm - t.value) < 1e-8 ? 'selected' : ''} onClick={() => preset(t.value)}>{t.title}</button>)}</div>}</section>)}
      <details className="circular-details"><summary>符号与操作</summary><p>点击物理量名称开关图中标注。拖圆孔边缘改孔径，拖焦平面改焦距；右侧屏面拖观察点。圆孔到透镜的间隔固定，透镜到屏的距离始终等于 f。</p><p>λ 波长 · D 圆孔直径 · f 观察透镜焦距 · r 观察点距中心的半径。</p><p>dₐ 艾里斑直径 · r₁ 第一暗环半径 · θ 观察角 · I/I₀ 相对光强。</p></details></div><div className="gs-sidebar-footer"><button className="text-button" onClick={reset}><RotateCcw size={14}/>恢复默认</button><span>{saveFailed ? '本机保存不可用' : '已自动保存'}</span></div></aside><div className="gs-panel-resizer" {...layout.separator}/></>}
      <main className="gs-visual"><div className="gs-toolbar"><div className="gs-toolbar-left">{!panelOpen && <button className="icon-button" aria-label="展开左侧参数" onClick={() => {setPanelOpen(true);if(compact)setResultsOpen(false);}}><PanelLeftOpen size={17}/></button>}<span className="gfocus-view-title">实验装置</span></div><div className="gs-toolbar-right"><button className="icon-button" aria-label="撤销圆孔参数" disabled={!history.past.length && !preview} onClick={() => { finish(); dispatch({ type: 'undo' }); }}><Undo2 size={16}/></button><button className="icon-button" aria-label="重做圆孔参数" disabled={!history.future.length} onClick={() => { finish(); dispatch({ type: 'redo' }); }}><Redo2 size={16}/></button>{!resultsOpen && <button className="gs-spot-toggle" aria-label="展开衍射结果" onClick={() => {setResultsOpen(true);if(compact)setPanelOpen(false);}}><ScanLine size={15}/>结果</button>}</div></div>
        <div className="gs-plot circular-device-stage">
          <CircularDiffractionApparatus p={p} annotations={annotations} viewRadius={viewRadius} onStart={start} onChange={change} onFinish={finish}/>
        </div>
        <div className="gs-visual-footer"><span>拖圆孔边缘改 D · 拖焦平面改 f</span><span>屏到透镜的距离 = f</span></div>

      </main>
      {resultsOpen && <><div className="gs-panel-resizer" {...layout.results.separator}/><aside className="gs-sidebar gfocus-results" style={{ width: layout.results.width }} aria-label="衍射结果"><div className="gs-sidebar-title"><h2>衍射结果</h2><button className="icon-button" aria-label="收起衍射结果" onClick={() => setResultsOpen(false)}><X size={17}/></button></div><div className="gs-sidebar-scroll">
        <CircularObservation p={p} annotations={annotations} viewRadius={viewRadius} zoom={zoom} onZoom={adjustZoom} onFit={fitScreen} onStart={start} onChange={value=>change('observationRadiusUm',value)} onFinish={finish}/>
        <section className="gs-readouts gfocus-main-readouts"><div className="gs-primary-reading gs-tone-output"><small>{label('airyDiameter','艾里斑直径','dₐ')}</small><strong data-testid="circular-width">{fmt(b.airyDiameterUm)}<span> μm</span></strong></div><div className="gs-primary-reading gs-tone-output"><small>{label('intensity','观察点相对光强','I / I₀')}</small><strong data-testid="circular-intensity">{fmt(b.observation.intensity)}</strong><div className="circular-meter"><i style={{width:`${b.observation.intensity*100}%`}}/></div></div><p className="circular-status" data-testid="circular-status">{b.status}</p></section>
        <section className="gs-readouts"><h3>位置与方向</h3><dl><div><dt>{label('firstDark','第一暗环半径','r₁')}</dt><dd data-testid="circular-minimum">{fmt(b.firstDarkRadiusUm)} μm</dd></div><div><dt>{label('theta','观察角','θ')}</dt><dd data-testid="circular-angle">{fmt(b.observation.thetaDeg)}°</dd></div></dl></section>
        <details className="circular-details circular-curve"><summary>光强曲线</summary><svg viewBox="0 0 240 150" aria-label="观察屏径向光强曲线"><path d="M29 14V117H226" stroke="#aebfd0" fill="none"/>{[0,.5,1].map(i=><g key={i}><line x1={29} x2={226} y1={117-i*100} y2={117-i*100} stroke="#e5ecf3"/><text x={23} y={121-i*100} textAnchor="end">{i}</text></g>)}<polyline data-testid="circular-intensity-curve" points={Array.from({length:401},(_,i)=>`${29+i/400*197},${117-b.at(viewRadius*i/400).intensity*100}`).join(' ')} fill="none" stroke="#8a5eac" strokeWidth={1.7}/>{visible(p.observationRadiusUm)&&<circle data-testid="circular-intensity-point" data-intensity={b.observation.intensity} cx={29+p.observationRadiusUm/viewRadius*197} cy={117-b.observation.intensity*100} r={3} fill="#8a5eac"/>}<text x={29} y={133}>0</text><text x={226} y={133} textAnchor="end">{fmt(viewRadius)}</text><text x={128} y={149} textAnchor="middle">r / μm</text><text x={36} y={12}>I / I₀</text></svg></details>
        <div className="circular-insight">圆孔越小，中央亮斑越大。</div>
        <details className="circular-details"><summary>图样与模型说明</summary><p>艾里斑是第一条暗环以内的中央亮斑；dₐ=2r₁。I₀ 是中心光强，相对光强 0 表示暗、1 表示中央最亮。</p><p>单色平行光均匀照亮圆孔，用理想观察透镜在焦平面成图。采用近轴标量衍射；忽略像差与偏振效应。J₁ 是计算圆环形状的数学函数。</p><p>装置与角度示意放大，屏面以微米标尺显示图样；光线用于说明几何聚焦，圆环由衍射模型计算。圆环适当提亮以便观察；曲线和读数保持真实相对光强。</p><p>复制保留波长、孔径和透镜焦距，屏跟随焦平面。搭建页呈现器件与几何光路；艾里圆环在本场景分析。</p><a href="https://interactivetextbooks.tudelft.nl/interactive-optics/content/Chap6_Diffraction/DiffractiveOptics_2022_01Clean.html" target="_blank" rel="noreferrer">物理依据 ↗</a></details>
      </div></aside></>}
    </div><div className="gs-model-strip"><span>横向尺寸与角度示意放大</span><span>dₐ = {fmt(b.airyDiameterUm)} μm · I/I₀ = {fmt(b.observation.intensity)}</span></div>
    {formulaOpen && <SceneFormulaSheet state={circularState(p)} onClose={() => setFormulaOpen(false)}/>}
    {assistantOpen && <aside className="gs-drawer gs-assistant" aria-label="场景AI助手"><button className="gs-assistant-close icon-button" aria-label="关闭场景AI助手" onClick={onCloseAssistant}><X size={18}/></button><AssistantPanel sceneState={circularState(p)} editing={gesture.current || preview !== null} onApplyScene={applyAssistant} onRestoreScene={restoreAssistant}/></aside>}
    {notice && <div className="gs-notice" role="status">{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15}/></button></div>}
  </section>;
}

import SceneAssistantToggle from './SceneAssistantToggle';
import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { BookOpen, Copy, ChevronLeft, Maximize, PanelLeftClose, PanelLeftOpen, Redo2, RotateCcw, ScanLine, Settings2, Undo2, X } from 'lucide-react';
import { DEFAULT_FOURIER, FOURIER_DRAFT_KEY, FOURIER_FIELDS, FOURIER_ID, parseFourier, fourierHistory, fourierState, fourierLens, type FourierHistory, type FourierParameters } from './fourierLens';
import FourierApparatus from './FourierApparatus';
import FourierScreen from './FourierScreen';
import { fourierBuilderCopy } from './fourierLens';
import type { SpatialExperiment } from './builderModel';
import AssistantPanel from './AssistantPanel';
import SceneFormulaSheet from './SceneFormulaSheet';
import { useScenePanelWidth } from './useScenePanelWidth';
import { type SceneState, sceneKey } from './sceneRuntime';
import './gaussian-scene.css';
import './gaussian-focus.css';
import './resonator-scene.css';
import './fourier-lens.css';

type Field = keyof FourierParameters;
type Annotation = keyof FourierParameters | 'spatialFrequency' | 'orderPosition' | 'spectrumWidth' | 'intensity';
const ANNOTATIONS: Annotation[] = ['wavelengthNm','periodMm','waistMm','modulation','focalLengthMm','observationUm','spatialFrequency','orderPosition','spectrumWidth','intensity'];
const DEFAULT_ANNOTATIONS: Annotation[] = ['periodMm','waistMm','focalLengthMm','orderPosition','observationUm'];
const ANNOTATION_KEY = 'optics-fourier-lens-annotations:v1';
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const fmt = (n: number) => Math.abs(n) < 1e-10 ? '0' : Math.abs(n) < .0001 ? n.toExponential(3) : Number(n.toFixed(4)).toString();
function readFourier() {
  try { const stored = localStorage.getItem(FOURIER_DRAFT_KEY); if (stored) { const s = JSON.parse(stored); if (s.version === 1 && s.sceneId === FOURIER_ID) return parseFourier(s.parameters); } } catch { /* Fall back to a valid scene. */ }
  return { ...DEFAULT_FOURIER };
}
function readAnnotations(): Annotation[] {
  try { const a = JSON.parse(localStorage.getItem(ANNOTATION_KEY) ?? 'null'); if (Array.isArray(a)) return a.filter((k): k is Annotation => ANNOTATIONS.includes(k)); } catch { /* Optional preferences. */ }
  return [...DEFAULT_ANNOTATIONS];
}
function QuantityLabel({ label, symbol, active, onClick }: { label: string; symbol: string; active: boolean; onClick: () => void }) {
  return <button type="button" className="resonator-quantity-label" aria-label={label} aria-pressed={active} title={active ? '点击隐藏图中标注' : '点击显示图中标注'} onClick={onClick}>{label}<i className="gs-quantity-symbol">{symbol}</i></button>;
}
function Parameter({ field, value, change, start, finish, marked, toggle, disabled = false }: { field: typeof FOURIER_FIELDS[number]; value: number; change: (v: number) => void; start: () => void; finish: () => void; marked: boolean; toggle?: () => void; disabled?: boolean }) {
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
  return <div className={`gs-parameter gs-tone-${field.tone} ${disabled ? 'fourier-inactive' : ''}`}>
    <div className="resonator-parameter-line">{toggle ? <QuantityLabel label={field.label} symbol={field.symbol} active={marked} onClick={toggle}/> : <span className="resonator-quantity-text">{field.label}<i className="gs-quantity-symbol">{field.symbol}</i></span>}<div className="gs-number"><input type="number" disabled={disabled} aria-label={field.label} aria-invalid={error} min={field.min} max={field.max} step={field.step} value={draft} onChange={e => { setDraft(e.target.value); setError(false); }} onBlur={submit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/><span>{field.unit}</span></div></div>
    <input type="range" disabled={disabled} aria-label={field.label + '滑杆'} min={field.min} max={field.max} step={field.step} value={value} style={{ '--range-fill': `${fill}%` } as CSSProperties}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); start(); }} onChange={e => { start(); change(Number(e.target.value)); }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onBlur={finish} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) start(); }} onKeyUp={finish}/>
    {error && <small className="gs-error" role="alert">请输入 {field.min}–{field.max} {field.unit}。</small>}
  </div>;
}

export default function FourierDiffractionScene({ onDirectory, assistantOpen, onCloseAssistant, onCopy }: { onCopy: (s: SpatialExperiment) => void; onDirectory: () => void; assistantOpen: boolean; onCloseAssistant: () => void }) {
  const [initial] = useState(readFourier);
  const [history, dispatch] = useReducer(fourierHistory, { past: [], present: initial, future: [] } as FourierHistory);
  const [preview, setPreview] = useState<FourierParameters | null>(null);
  const p = preview ?? history.present, latest = useRef(p); latest.current = p;
  const pending = useRef<FourierParameters | null>(null), gesture = useRef(false), raf = useRef<number | null>(null);
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
  const [viewRadius, setViewRadius] = useState(600), [zoom, setZoom] = useState(1);
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
  useEffect(() => { try { localStorage.setItem(FOURIER_DRAFT_KEY, JSON.stringify(fourierState(history.present))); setSaveFailed(false); } catch { setSaveFailed(true); } }, [history.present]);
  useEffect(() => () => { if (raf.current !== null) cancelAnimationFrame(raf.current); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as Element)?.closest('input,textarea,select,[contenteditable=true]') || document.querySelector('dialog[open]')) return;
      if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); finish(); dispatch({ type: e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo' }); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [finish]);

  const b=fourierLens(p),visible=(v:number)=>Math.abs(v)<=viewRadius;
  const adjustZoom=(factor:number)=>{const next=clamp(zoom*factor,.16,40);setViewRadius(600/next);setZoom(next);};
  const fitScreen=()=>{const next=clamp(Math.max((p.modulation ? b.orderPositionUm*1.35 : 0)+b.spotRadiusUm*4,Math.abs(p.observationUm)*1.15),30,4000);setViewRadius(next);setZoom(600/next);};
  const showObservation=(v:number)=>{if(!visible(v)){const next=Math.max(600,Math.abs(v)*1.15);setViewRadius(next);setZoom(600/next);}};
  const applyAssistant = (state: SceneState) => {
    if (state.sceneId !== FOURIER_ID || gesture.current || document.activeElement?.matches('.fourier-lens-scene .gs-parameter input')) return false;
    try { const next = parseFourier(state.parameters); dispatch({ type: 'commit', parameters: next }); showObservation(next.observationUm); return true; } catch { return false; }
  };
  const restoreAssistant = (before: SceneState, after: SceneState) => {
    if (gesture.current || sceneKey(fourierState(latest.current)) !== sceneKey(after)) return false;
    const previous = history.past.at(-1);
    if (previous && sceneKey(fourierState(previous)) === sceneKey(before)) { dispatch({ type: 'undo' }); showObservation(previous.observationUm); return true; }
    return applyAssistant(before);
  };
  const reset = () => { finish(); dispatch({ type: 'commit', parameters: { ...DEFAULT_FOURIER } }); setViewRadius(600); setZoom(1); setAnnotations([...DEFAULT_ANNOTATIONS]); setResetVersion(v => v + 1); };
  const preset = (value: number) => { finish(); dispatch({ type: 'commit', parameters: { ...latest.current, observationUm: value } }); showObservation(value); };

  const inputPreset = (modulation: number) => { finish(); dispatch({type:'commit',parameters:{...latest.current,modulation,observationUm:0}}); const extent=modulation ? 600 : Math.max(30,b.spotRadiusUm*4);setViewRadius(extent);setZoom(600/extent); };
  return <section ref={root} className={`gaussian-scene gaussian-focus-scene fourier-lens-scene ${layout.resizing?'gs-panel-resizing':''}`} aria-label="傅里叶变换场景">
    <div className="gs-heading"><div className="gs-title"><button className="icon-button" aria-label="返回仿真场景库" onClick={onDirectory}><ChevronLeft size={20}/></button><h1>傅里叶变换</h1></div><div className="gs-heading-actions"><SceneAssistantToggle/><button className="gs-copy-button" title="复制当前光源、输入条纹、透镜与频谱屏" onClick={()=>{finish();onCopy(fourierBuilderCopy(latest.current));}}><Copy size={16}/>复制到光路搭建</button><button className="outline-button" aria-haspopup="dialog" aria-expanded={formulaOpen} onClick={()=>{finish();setFormulaOpen(true);}}><BookOpen size={15}/>相关公式</button><button className="icon-button" aria-label="全屏查看场景" onClick={()=>void(document.fullscreenElement?document.exitFullscreen():root.current?.requestFullscreen())?.catch(()=>setNotice('浏览器未开启全屏。'))}><Maximize size={18}/></button></div></div>
    <div ref={workspace} className="gs-workspace">
      {panelOpen&&<><aside className="gs-sidebar" style={{width:layout.width}} aria-label="傅里叶参数"><div className="gs-sidebar-title"><h2><Settings2 size={16}/>参数调节</h2><button className="icon-button" aria-label="收起左侧参数" onClick={()=>setPanelOpen(false)}><PanelLeftClose size={17}/></button></div><div className="gs-sidebar-scroll">
        {[{title:'输入光场',keys:['periodMm','waistMm','modulation']},{title:'光源与透镜',keys:['wavelengthNm','focalLengthMm']},{title:'观察位置',keys:['observationUm']}].map(section=><section key={section.title}><h3>{section.title}</h3>{section.title==='输入光场'&&<div className="gs-presets">{[{label:'条纹输入',value:1},{label:'无条纹',value:0}].map(t=><button key={t.label} className={p.modulation===t.value?'selected':''} onClick={()=>inputPreset(t.value)}>{t.label}</button>)}</div>}{FOURIER_FIELDS.filter(f=>section.keys.includes(f.key)).map(f=><Parameter key={f.key+resetVersion} field={f} value={p[f.key]} change={v=>change(f.key,v)} start={start} finish={finish} marked={marked(f.key)} toggle={()=>toggle(f.key)} disabled={f.key==='periodMm'&&p.modulation===0}/>)}{section.title==='观察位置'&&<div className="gs-presets"><button onClick={()=>preset(0)}>零级</button><button disabled={!p.modulation} onClick={()=>preset(b.orderPositionUm)}>＋一级</button><button disabled={!p.modulation} onClick={()=>preset(-b.orderPositionUm)}>－一级</button></div>}</section>)}
        <details className="fourier-details"><summary>符号与操作</summary><p>点击中文名称开关字母标注。拖 d 改条纹周期，拖 w 改光束半径，拖频谱面改 f，拖观察点改 xꜰ。</p><p>w 从中心量到一侧，上下合起来为 2w。λ 波长 · d 条纹周期 · w 输入高斯包络半径 · m 振幅条纹对比 · f 焦距。</p><p>ν₀ 每毫米的条纹周期数 · x₁ 一级位置 · wꜰ 单个频谱光斑半径 · I/I₀ 相对光强。</p></details>
      </div><div className="gs-sidebar-footer"><button className="text-button" onClick={reset}><RotateCcw size={14}/>恢复默认</button><span>{saveFailed?'本机保存不可用':'已自动保存'}</span></div></aside><div className="gs-panel-resizer" {...layout.separator}/></>}
      <main className="gs-visual"><div className="gs-toolbar"><div className="gs-toolbar-left">{!panelOpen&&<button className="icon-button" aria-label="展开左侧参数" onClick={()=>{setPanelOpen(true);if(compact)setResultsOpen(false);}}><PanelLeftOpen size={17}/></button>}<span className="gfocus-view-title">二维光路</span></div><div className="gs-toolbar-right"><button className="icon-button" aria-label="撤销傅里叶参数" disabled={!history.past.length&&!preview} onClick={()=>{finish();dispatch({type:'undo'});}}><Undo2 size={16}/></button><button className="icon-button" aria-label="重做傅里叶参数" disabled={!history.future.length} onClick={()=>{finish();dispatch({type:'redo'});}}><Redo2 size={16}/></button>{!resultsOpen&&<button className="gs-spot-toggle" aria-label="展开频谱结果" onClick={()=>{setResultsOpen(true);if(compact)setPanelOpen(false);}}><ScanLine size={15}/>结果</button>}</div></div>
        <div className="gs-plot fourier-stage"><FourierApparatus p={p} annotations={annotations} viewRadius={viewRadius} onStart={start} onChange={change} onFinish={finish}/></div>
        <div className="gs-visual-footer"><span>拖条纹改 d · 拖半径标记改 w · 拖频谱面改 f</span><span>前后焦距均为 f</span></div>
      </main>
      {resultsOpen&&<><div className="gs-panel-resizer" {...layout.results.separator}/><aside className="gs-sidebar gfocus-results" style={{width:layout.results.width}} aria-label="频谱结果"><div className="gs-sidebar-title"><h2>频谱结果</h2><button className="icon-button" aria-label="收起频谱结果" onClick={()=>setResultsOpen(false)}><X size={17}/></button></div><div className="gs-sidebar-scroll">
        <FourierScreen p={p} annotations={annotations} viewRadius={viewRadius} zoom={zoom} onZoom={adjustZoom} onFit={fitScreen} onStart={start} onChange={v=>change('observationUm',v)} onFinish={finish}/>
        <section className="gs-readouts gfocus-main-readouts"><div className="gs-primary-reading gs-tone-output"><small>{label('orderPosition','一级位置','x₁')}</small><strong data-testid="fourier-order">{p.modulation?fmt(b.orderPositionUm):'—'}<span> μm</span></strong></div><div className="gs-primary-reading gs-tone-screen"><small>{label('intensity','观察点光强','I / I₀')}</small><strong data-testid="fourier-intensity">{fmt(b.observation.intensity)}</strong></div></section>
        <section className="gs-readouts"><dl><div><dt>{label('spatialFrequency','条纹空间频率','ν₀')}</dt><dd data-testid="fourier-frequency">{p.modulation?fmt(b.spatialFrequency):'—'} mm⁻¹</dd></div><div><dt>{label('spectrumWidth','频谱宽度','wꜰ')}</dt><dd data-testid="fourier-width">{fmt(b.spotRadiusUm)} μm</dd></div></dl></section>
        <details className="fourier-details fourier-curve"><summary>光强曲线</summary><svg viewBox="0 0 240 145" aria-label="频谱面横向光强曲线"><path d="M25 12V114H228" stroke="#aebfd0" fill="none"/>{[0,.5,1].map(t=><g key={t}><line x1={25} x2={228} y1={114-t*98} y2={114-t*98} stroke="#e5ecf3"/><text x={20} y={118-t*98} textAnchor="end">{t}</text></g>)}<polyline data-testid="fourier-intensity-curve" points={Array.from({length:801},(_,i)=>`${25+i/800*203},${114-b.at(-viewRadius+2*viewRadius*i/800).intensity*98}`).join(' ')} fill="none" stroke="#8a5eac" strokeWidth={1.6}/>{visible(p.observationUm)&&<circle cx={25+(p.observationUm/viewRadius+1)*101.5} cy={114-b.observation.intensity*98} r={3} fill="#26836a"/>}<text x={25} y={129}>−{fmt(viewRadius)}</text><text x={228} y={129} textAnchor="end">{fmt(viewRadius)}</text><text x={130} y={144} textAnchor="middle">xꜰ / μm</text></svg></details>
        <div className="fourier-insight">条纹越密，一级频谱离中心越远。</div>
        <details className="fourier-details"><summary>模型说明</summary><p>输入是高斯光场叠加余弦振幅条纹。透镜变换光场振幅，再取模平方得到光强；不是直接变换输入光强。</p><p>输入面、频谱面分别位于透镜前后焦面。w 与 wꜰ 都是1/e²光强半径。忽略有限透镜截光、像差、偏振与离焦；不包含4f滤波。</p><p>光路横向示意放大，输入条纹按振幅灰度显示；频谱屏略提亮以便观察，曲线与读数使用真实相对光强。</p><p>可复制当前光源、输入条纹、透镜与频谱屏到光路搭建，保留条纹和观察参数；共轴且输入与屏均在焦面时显示相同频谱。</p><a href="https://qiweb.tudelft.nl/aoi/coherentimaging/coherentimaging/" target="_blank" rel="noreferrer">物理依据 ↗</a></details>
      </div></aside></>}
    </div><div className="gs-model-strip"><span>横向示意放大 · 频谱屏以微米计</span><span>x₁ = λf/d · wꜰ = λf/(πw)</span></div>
    {formulaOpen&&<SceneFormulaSheet state={fourierState(p)} onClose={()=>setFormulaOpen(false)}/>}
    {assistantOpen&&<aside className="gs-drawer gs-assistant" aria-label="场景AI助手"><button className="gs-assistant-close icon-button" aria-label="关闭场景AI助手" onClick={onCloseAssistant}><X size={18}/></button><AssistantPanel sceneState={fourierState(p)} editing={gesture.current||preview!==null} onApplyScene={applyAssistant} onRestoreScene={restoreAssistant}/></aside>}
    {notice&&<div className="gs-notice" role="status">{notice}<button className="icon-button" aria-label="关闭提示" onClick={()=>setNotice('')}><X size={15}/></button></div>}
  </section>;
}

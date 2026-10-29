import SceneAssistantToggle from './SceneAssistantToggle';
import { COUPLING_COLORS, quantityStyle } from './quantityColors';
import './quantity-colors.css';
import { useEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { BookOpen, ChevronLeft, Maximize, PanelLeftClose, PanelLeftOpen, Redo2, RotateCcw, ScanLine, Settings2, Undo2, X } from 'lucide-react';
import AssistantPanel from './AssistantPanel';
import SceneFormulaSheet from './SceneFormulaSheet';
import { useScenePanelWidth } from './useScenePanelWidth';
import { draftKey, numberText, readScene, sceneKey, SCENE_DEFINITIONS, type SceneState } from './sceneRuntime';
import { DEFAULT_COUPLING, COUPLING_FIELDS, COUPLING_ID, couplingHistory, fiberCoupling, couplingState, parseCoupling, type CouplingHistory, type CouplingParameters } from './fiberCoupling';
import './gaussian-scene.css';
import './gaussian-focus.css';
import './resonator-scene.css';
import './fiber-modes.css';
import './fiber-coupling.css';
import FiberCouplingDiagram, { type CouplingAnnotation } from './FiberCouplingDiagram';

const RESULTS = [
  { key:'coupledPowerMw', label:'耦合功率', symbol:'Pₒᵤₜ', unit:'mW' },
  { key:'lossDb', label:'耦合损耗', symbol:'L', unit:'dB' },
  { key:'sizePct', label:'尺寸匹配', symbol:'', unit:'%' },
  { key:'positionPct', label:'位置对准', symbol:'', unit:'%' },
  { key:'anglePct', label:'角度对准', symbol:'', unit:'%' },
] as const;
type Annotation=CouplingAnnotation;
const KEYS:Annotation[]=['beamRadiusUm','modeRadiusUm','offsetUm','tiltDeg'];
const DEFAULT_MARKS:Annotation[]=['beamRadiusUm','modeRadiusUm','offsetUm','tiltDeg'];
const MARK_KEY = 'optics-fiber-coupling-annotations:v1';
function readMarks(): Annotation[] {
  try { const a = JSON.parse(localStorage.getItem(MARK_KEY) ?? 'null'); if (Array.isArray(a)) return a.filter((k): k is Annotation => KEYS.includes(k)); } catch { /* Optional preference. */ }
  return DEFAULT_MARKS;
}
function Quantity({ label, symbol, active, onClick }: { label: string; symbol: string; active: boolean; onClick?: () => void }) {
  if (!onClick) return <span className="fiber-quantity-text">{label}<i className="gs-quantity-symbol">{symbol==='w_f'?<>w<sub>f</sub></>:symbol}</i></span>;
  return <button className="resonator-quantity-label" aria-label={label} aria-pressed={active} title={active ? '点击隐藏图中标注' : '点击显示图中标注'} onClick={onClick}>{label}<i className="gs-quantity-symbol">{symbol==='w_f'?<>w<sub>f</sub></>:symbol}</i></button>;
}
function Parameter({ field, value, start, change, finish, active, toggle }: { field: typeof COUPLING_FIELDS[number]; value: number; start: () => void; change: (n: number) => void; finish: () => void; active: boolean; toggle?: () => void }) {
  const [draft, setDraft] = useState(String(value)), [error, setError] = useState(false);
  useEffect(() => { setDraft(String(value)); setError(false); }, [value]);
  const submit = () => {
    const n = Number(draft);
    if (!draft.trim() || !Number.isFinite(n) || n < field.min || n > field.max) { setError(true); return; }
    start(); change(n); finish(); setError(false);
  };
  return <div className="gs-parameter quantity-color" style={quantityStyle(COUPLING_COLORS[field.key])}><div className="resonator-parameter-line"><Quantity label={field.label} symbol={field.symbol} active={active} onClick={toggle}/><div className="gs-number"><input type="number" aria-label={field.label} aria-invalid={error} min={field.min} max={field.max} step={field.step} value={draft} onChange={e => { setDraft(e.target.value); setError(false); }} onBlur={submit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/><span>{field.unit}</span></div></div>
    <input type="range" aria-label={field.label + '滑杆'} min={field.min} max={field.max} step={field.step} value={value} style={{ '--range-fill': `${(value - field.min) / (field.max - field.min) * 100}%` } as CSSProperties} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); start(); }} onChange={e => { start(); change(Number(e.target.value)); }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onBlur={finish} onKeyDown={e => { if (['ArrowLeft','ArrowRight','Home','End','ArrowUp','ArrowDown','PageUp','PageDown'].includes(e.key)) start(); }} onKeyUp={finish}/>
    {error && <small className="gs-error" role="alert">请输入 {field.min}–{field.max}{field.unit}。</small>}
  </div>;
}

export default function FiberCouplingScene({ onDirectory, assistantOpen, onCloseAssistant }: { onDirectory: () => void; assistantOpen: boolean; onCloseAssistant: () => void }) {
  const [history, dispatch] = useReducer(couplingHistory, undefined, () => ({ past: [], present: parseCoupling(readScene(COUPLING_ID).parameters), future: [] } as CouplingHistory));
  const [preview, setPreview] = useState<CouplingParameters|null>(null), p = preview ?? history.present, b = fiberCoupling(p);
  const latest = useRef(p); latest.current = p;
  const gesture = useRef(false), pending = useRef<CouplingParameters|null>(null);
  const [panelOpen, setPanelOpen] = useState(true), [resultsOpen, setResultsOpen] = useState(true), [formulaOpen, setFormulaOpen] = useState(false);
  const [annotations, setAnnotations] = useState(readMarks), [saveFailed, setSaveFailed] = useState(false), [notice, setNotice] = useState('');
  const [resetCount,setResetCount]=useState(0);
  const root = useRef<HTMLElement>(null), workspace = useRef<HTMLDivElement>(null);
  const layout = useScenePanelWidth(workspace, resultsOpen, panelOpen,{onLeftClose:()=>setPanelOpen(false),onRightClose:()=>setResultsOpen(false)});
  const start = () => { gesture.current = true; };
  const change = (key: keyof CouplingParameters, value: number) => { const next = { ...latest.current, [key]: value }; latest.current = next; pending.current = next; setPreview(next); };
  const finish = () => { if (!gesture.current) return; gesture.current = false; if (pending.current) dispatch({ type: 'commit', parameters: pending.current }); pending.current = null; setPreview(null); };
  const marked = (k: Annotation) => annotations.includes(k), toggle = (k: Annotation) => setAnnotations(a => a.includes(k) ? a.filter(v => v !== k) : [...a,k]);
  useEffect(() => { try { localStorage.setItem(draftKey(COUPLING_ID),JSON.stringify(couplingState(history.present))); setSaveFailed(false); } catch { setSaveFailed(true); } },[history.present]);
  useEffect(() => { try { localStorage.setItem(MARK_KEY,JSON.stringify(annotations)); } catch { /* Optional preference. */ } },[annotations]);
  useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.target as Element)?.closest('input,textarea,select,[contenteditable=true]') || document.querySelector('dialog[open]')) return; if ((e.ctrlKey || e.metaKey) && ['z','y'].includes(e.key.toLowerCase())) { e.preventDefault(); gesture.current=false; if(pending.current)dispatch({type:'commit',parameters:pending.current});pending.current=null;setPreview(null);dispatch({type:e.key.toLowerCase()==='y'||e.shiftKey?'redo':'undo'}); } }; window.addEventListener('keydown',handler); return () => window.removeEventListener('keydown',handler); },[]);
  const applyAssistant = (state: SceneState) => { if(state.sceneId!==COUPLING_ID || gesture.current || document.activeElement?.matches('.fiber-modes-scene .gs-parameter input'))return false; try { dispatch({type:'commit',parameters:parseCoupling(state.parameters)}); return true; } catch { return false; } };
  const restoreAssistant = (before: SceneState, after: SceneState) => { if(gesture.current || sceneKey(couplingState(latest.current))!==sceneKey(after))return false;const previous=history.past.at(-1);if(previous&&sceneKey(couplingState(previous))===sceneKey(before)){dispatch({type:'undo'});return true;}return applyAssistant(before); };
  return <section ref={root} className={`gaussian-scene gaussian-focus-scene fiber-modes-scene fiber-coupling-scene ${layout.resizing?'gs-panel-resizing':''}`} aria-label="单模光纤耦合场景">
    <div className="gs-heading"><div className="gs-title"><button className="icon-button" aria-label="返回仿真场景库" onClick={onDirectory}><ChevronLeft size={20}/></button><h1>单模光纤耦合</h1></div><div className="gs-heading-actions"><SceneAssistantToggle/><button className="outline-button" aria-haspopup="dialog" aria-expanded={formulaOpen} onClick={() => { finish(); setFormulaOpen(true); }}><BookOpen size={15}/>相关公式</button><button className="icon-button" aria-label="全屏查看场景" onClick={() => void(document.fullscreenElement?document.exitFullscreen():root.current?.requestFullscreen())?.catch(() => setNotice('浏览器未开启全屏。'))}><Maximize size={18}/></button></div></div>
    <div ref={workspace} className="gs-workspace">
      {panelOpen && <><aside className="gs-sidebar" style={{width:layout.width}} aria-label="耦合参数"><div className="gs-sidebar-title"><h2><Settings2 size={16}/>参数调节</h2><button className="icon-button" aria-label="收起左侧参数" onClick={() => setPanelOpen(false)}><PanelLeftClose size={17}/></button></div><div className="gs-sidebar-scroll"><section>{COUPLING_FIELDS.map(f => <Parameter key={f.key+resetCount} field={f} value={p[f.key]} start={start} change={v => change(f.key,v)} finish={finish} active={marked(f.key as Annotation)} toggle={KEYS.includes(f.key as Annotation)?() => toggle(f.key as Annotation):undefined}/>)}<p className="fiber-hint">点击名称切换对应标注</p></section><section className="gs-presets">{SCENE_DEFINITIONS[COUPLING_ID].presets.map(preset => <button key={preset.label} onClick={() => {finish();dispatch({type:'commit',parameters:parseCoupling({...latest.current,...preset.values})});}}>{preset.label}</button>)}</section><details className="fiber-conditions"><summary>模型条件</summary><p>高斯光束近似，焦点在端面，不计端面反射。模场半径表示导光光斑的大小。</p></details></div><div className="gs-sidebar-footer"><button className="text-button" onClick={() => {finish();dispatch({type:'commit',parameters:{...DEFAULT_COUPLING}});setAnnotations([...DEFAULT_MARKS]);setResetCount(c=>c+1);}}><RotateCcw size={14}/>恢复默认</button><span>{saveFailed?'本机保存不可用':'已自动保存'}</span></div></aside><div className="gs-panel-resizer" {...layout.separator}/></>}
      <main className="gs-visual"><div className="gs-toolbar"><div className="gs-toolbar-left">{!panelOpen&&<button className="icon-button" aria-label="展开左侧参数" onClick={() => setPanelOpen(true)}><PanelLeftOpen size={17}/></button>}<span className="gfocus-view-title">端面对准</span></div><div className="gs-toolbar-right"><button className="icon-button" aria-label="撤销参数" disabled={!history.past.length&&!preview} onClick={() => {finish();dispatch({type:'undo'});}}><Undo2 size={16}/></button><button className="icon-button" aria-label="重做参数" disabled={!history.future.length} onClick={() => {finish();dispatch({type:'redo'});}}><Redo2 size={16}/></button>{!resultsOpen&&<button className="gs-spot-toggle" onClick={() => setResultsOpen(true)}><ScanLine size={15}/>结果</button>}</div></div><FiberCouplingDiagram p={p} annotations={annotations} onStart={start} onChange={change} onFinish={finish}/></main>
      {resultsOpen&&<><div className="gs-panel-resizer" {...layout.results.separator}/><aside className="gs-sidebar gfocus-results fiber-results" style={{width:layout.results.width}} aria-label="耦合结果"><div className="gs-sidebar-title"><h2><ScanLine size={16}/>当前结果</h2><button className="icon-button" aria-label="收起右侧结果" onClick={() => setResultsOpen(false)}><X size={17}/></button></div><div className="gs-sidebar-scroll"><section className="fiber-mode-summary"><span className="coupling-efficiency-label" style={{color:COUPLING_COLORS.efficiencyPct}}>耦合效率</span><strong data-testid="coupling-efficiency" style={{color:COUPLING_COLORS.efficiencyPct}}>{Number(b.efficiencyPct.toFixed(2))}<small>%</small></strong><p>理想光场匹配</p></section><section className="fiber-readings">{RESULTS.map(f => <div key={f.key} className="quantity-color" style={quantityStyle(COUPLING_COLORS[f.key])}><Quantity label={f.label} symbol={f.symbol} active={false}/><strong data-testid={'coupling-reading-'+f.key}>{f.unit==='%'?Number(b[f.key].toFixed(2)):numberText(b[f.key])}<small>{f.unit}</small></strong></div>)}</section></div></aside></>}
    </div><div className="gs-model-strip"><span>理想单模 · 同偏振</span><span>效率由光场重叠决定</span></div>
    {formulaOpen&&<SceneFormulaSheet state={couplingState(p)} onClose={() => setFormulaOpen(false)}/>}
    {assistantOpen&&<aside className="gs-drawer gs-assistant" aria-label="场景AI助手"><button className="gs-assistant-close icon-button" aria-label="关闭场景AI助手" onClick={onCloseAssistant}><X size={18}/></button><AssistantPanel sceneState={couplingState(p)} editing={gesture.current||preview!==null} onApplyScene={applyAssistant} onRestoreScene={restoreAssistant}/></aside>}
    {notice&&<div className="gs-notice" role="status">{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15}/></button></div>}
  </section>;
}

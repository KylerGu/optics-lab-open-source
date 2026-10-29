import SceneAssistantToggle from './SceneAssistantToggle';
import MalusCurve from './MalusCurve';
import { MALUS_COLORS, quantityStyle } from './quantityColors';
import './quantity-colors.css';
import { useEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { BookOpen, Copy, ChevronLeft, Maximize, PanelLeftClose, PanelLeftOpen, Redo2, RotateCcw, ScanLine, Settings2, Undo2, X } from 'lucide-react';
import AssistantPanel from './AssistantPanel';
import SceneFormulaSheet from './SceneFormulaSheet';
import { useScenePanelWidth } from './useScenePanelWidth';
import { draftKey, numberText, readScene, sceneKey, SCENE_DEFINITIONS, type SceneState } from './sceneRuntime';
import { DEFAULT_MALUS, MALUS_FIELDS, MALUS_ID, malusHistory, malus, malusBuilderCopy, malusState, parseMalus, type MalusHistory, type MalusParameters } from './malus';
import './gaussian-scene.css';
import './gaussian-focus.css';
import './resonator-scene.css';
import './fiber-modes.css';
import './malus-scene.css';
import MalusDiagram, { type MalusAnnotation } from './MalusDiagram';

const RESULTS = [
  {key:'transmissionPct',label:'透过比例',symbol:'T',unit:'%'},
  {key:'relativeAngleDeg',label:'夹角',symbol:'θ',unit:'°'},
] as const;
type Annotation=MalusAnnotation;
const KEYS:Annotation[]=['inputAngleDeg','axisAngleDeg','relativeAngleDeg'];
const DEFAULT_MARKS:Annotation[]=['inputAngleDeg','axisAngleDeg','relativeAngleDeg'];
const MARK_KEY = 'optics-malus-annotations:v1';
function readMarks(): Annotation[] {
  try { const a = JSON.parse(localStorage.getItem(MARK_KEY) ?? 'null'); if (Array.isArray(a)) return a.filter((k): k is Annotation => KEYS.includes(k)); } catch { /* Optional preference. */ }
  return DEFAULT_MARKS;
}
function Quantity({ label, symbol, active, onClick }: { label: string; symbol: string; active: boolean; onClick?: () => void }) {
  if (!onClick) return <span className="fiber-quantity-text">{label}<i className="gs-quantity-symbol">{symbol}</i></span>;
  return <button className="resonator-quantity-label" aria-label={label} aria-pressed={active} title={active ? '点击隐藏图中标注' : '点击显示图中标注'} onClick={onClick}>{label}<i className="gs-quantity-symbol">{symbol}</i></button>;
}
function Parameter({ field, value, start, change, finish, active, toggle }: { field: typeof MALUS_FIELDS[number]; value: number; start: () => void; change: (n: number) => void; finish: () => void; active: boolean; toggle?: () => void }) {
  const [draft, setDraft] = useState(String(value)), [error, setError] = useState(false);
  useEffect(() => { setDraft(String(value)); setError(false); }, [value]);
  const submit = () => {
    const n = Number(draft);
    if (!draft.trim() || !Number.isFinite(n) || n < field.min || n > field.max) { setError(true); return; }
    start(); change(n); finish(); setError(false);
  };
  return <div className="gs-parameter quantity-color" style={quantityStyle(MALUS_COLORS[field.key])}><div className="resonator-parameter-line"><Quantity label={field.label} symbol={field.symbol} active={active} onClick={toggle}/><div className="gs-number"><input type="number" aria-label={field.label} aria-invalid={error} min={field.min} max={field.max} step={field.step} value={draft} onChange={e => { setDraft(e.target.value); setError(false); }} onBlur={submit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/><span>{field.unit}</span></div></div>
    <input type="range" aria-label={field.label + '滑杆'} min={field.min} max={field.max} step={field.step} value={value} style={{ '--range-fill': `${(value - field.min) / (field.max - field.min) * 100}%` } as CSSProperties} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); start(); }} onChange={e => { start(); change(Number(e.target.value)); }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onBlur={finish} onKeyDown={e => { if (['ArrowLeft','ArrowRight','Home','End','ArrowUp','ArrowDown','PageUp','PageDown'].includes(e.key)) start(); }} onKeyUp={finish}/>
    {error && <small className="gs-error" role="alert">请输入 {field.min}–{field.max}{field.unit}。</small>}
  </div>;
}

export default function MalusScene({ onDirectory, assistantOpen, onCloseAssistant, onCopy }: { onDirectory: () => void; assistantOpen: boolean; onCloseAssistant: () => void; onCopy: (experiment:ReturnType<typeof malusBuilderCopy>)=>void }) {
  const [history, dispatch] = useReducer(malusHistory, undefined, () => ({ past: [], present: parseMalus(readScene(MALUS_ID).parameters), future: [] } as MalusHistory));
  const [preview, setPreview] = useState<MalusParameters|null>(null), p = preview ?? history.present, b = malus(p);
  const latest = useRef(p); latest.current = p;
  const gesture = useRef(false), pending = useRef<MalusParameters|null>(null);
  const [panelOpen, setPanelOpen] = useState(true), [resultsOpen, setResultsOpen] = useState(true), [formulaOpen, setFormulaOpen] = useState(false);
  const [annotations, setAnnotations] = useState(readMarks), [saveFailed, setSaveFailed] = useState(false), [notice, setNotice] = useState('');
  const [resetCount,setResetCount]=useState(0);
  const root = useRef<HTMLElement>(null), workspace = useRef<HTMLDivElement>(null);
  const layout = useScenePanelWidth(workspace, resultsOpen, panelOpen,{onLeftClose:()=>setPanelOpen(false),onRightClose:()=>setResultsOpen(false)});
  const start = () => { gesture.current = true; };
  const change = (key: keyof MalusParameters, value: number) => { const next = { ...latest.current, [key]: value }; latest.current = next; pending.current = next; setPreview(next); };
  const finish = () => { if (!gesture.current) return; gesture.current = false; if (pending.current) dispatch({ type: 'commit', parameters: pending.current }); pending.current = null; setPreview(null); };
  const marked = (k: Annotation) => annotations.includes(k), toggle = (k: Annotation) => setAnnotations(a => a.includes(k) ? a.filter(v => v !== k) : [...a,k]);
  useEffect(() => { try { localStorage.setItem(draftKey(MALUS_ID),JSON.stringify(malusState(history.present))); setSaveFailed(false); } catch { setSaveFailed(true); } },[history.present]);
  useEffect(() => { try { localStorage.setItem(MARK_KEY,JSON.stringify(annotations)); } catch { /* Optional preference. */ } },[annotations]);
  useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.target as Element)?.closest('input,textarea,select,[contenteditable=true]') || document.querySelector('dialog[open]')) return; if ((e.ctrlKey || e.metaKey) && ['z','y'].includes(e.key.toLowerCase())) { e.preventDefault(); gesture.current=false; if(pending.current)dispatch({type:'commit',parameters:pending.current});pending.current=null;setPreview(null);dispatch({type:e.key.toLowerCase()==='y'||e.shiftKey?'redo':'undo'}); } }; window.addEventListener('keydown',handler); return () => window.removeEventListener('keydown',handler); },[]);
  const applyAssistant = (state: SceneState) => { if(state.sceneId!==MALUS_ID || gesture.current || document.activeElement?.matches('.fiber-modes-scene .gs-parameter input'))return false; try { dispatch({type:'commit',parameters:parseMalus(state.parameters)}); return true; } catch { return false; } };
  const restoreAssistant = (before: SceneState, after: SceneState) => { if(gesture.current || sceneKey(malusState(latest.current))!==sceneKey(after))return false;const previous=history.past.at(-1);if(previous&&sceneKey(malusState(previous))===sceneKey(before)){dispatch({type:'undo'});return true;}return applyAssistant(before); };
  return <section ref={root} className={`gaussian-scene gaussian-focus-scene fiber-modes-scene malus-scene ${layout.resizing?'gs-panel-resizing':''}`} aria-label="偏振片与马吕斯定律场景">
    <div className="gs-heading"><div className="gs-title"><button className="icon-button" aria-label="返回仿真场景库" onClick={onDirectory}><ChevronLeft size={20}/></button><h1>偏振片与马吕斯定律</h1></div><div className="gs-heading-actions"><SceneAssistantToggle/><button className="outline-button" onClick={()=>{finish();try{onCopy(malusBuilderCopy(latest.current));}catch{setNotice('当前参数无法复制，请检查输入。');}}}><Copy size={15}/>复制到光路搭建</button><button className="outline-button" aria-haspopup="dialog" aria-expanded={formulaOpen} onClick={() => { finish(); setFormulaOpen(true); }}><BookOpen size={15}/>相关公式</button><button className="icon-button" aria-label="全屏查看场景" onClick={() => void(document.fullscreenElement?document.exitFullscreen():root.current?.requestFullscreen())?.catch(() => setNotice('浏览器未开启全屏。'))}><Maximize size={18}/></button></div></div>
    <div ref={workspace} className="gs-workspace">
      {panelOpen && <><aside className="gs-sidebar" style={{width:layout.width}} aria-label="偏振参数"><div className="gs-sidebar-title"><h2><Settings2 size={16}/>参数调节</h2><button className="icon-button" aria-label="收起左侧参数" onClick={() => setPanelOpen(false)}><PanelLeftClose size={17}/></button></div><div className="gs-sidebar-scroll"><section>{MALUS_FIELDS.map(f => <Parameter key={f.key+resetCount} field={f} value={p[f.key]} start={start} change={v => change(f.key,v)} finish={finish} active={marked(f.key as Annotation)} toggle={KEYS.includes(f.key as Annotation)?() => toggle(f.key as Annotation):undefined}/>)}<p className="fiber-hint">点击名称切换对应标注</p></section><section className="gs-presets">{SCENE_DEFINITIONS[MALUS_ID].presets.map(preset => <button key={preset.label} onClick={() => {finish();dispatch({type:'commit',parameters:parseMalus({...latest.current,...preset.values})});}}>{preset.label}</button>)}</section><details className="fiber-conditions"><summary>模型条件</summary><p>线偏振光正入射理想偏振片，光束完整通过。夹角取两条轴之间的较小角。</p></details></div><div className="gs-sidebar-footer"><button className="text-button" onClick={() => {finish();dispatch({type:'commit',parameters:{...DEFAULT_MALUS}});setAnnotations([...DEFAULT_MARKS]);setResetCount(c=>c+1);}}><RotateCcw size={14}/>恢复默认</button><span>{saveFailed?'本机保存不可用':'已自动保存'}</span></div></aside><div className="gs-panel-resizer" {...layout.separator}/></>}
      <main className="gs-visual"><div className="gs-toolbar"><div className="gs-toolbar-left">{!panelOpen&&<button className="icon-button" aria-label="展开左侧参数" onClick={() => setPanelOpen(true)}><PanelLeftOpen size={17}/></button>}<span className="gfocus-view-title">偏振片正视图</span></div><div className="gs-toolbar-right"><button className="icon-button" aria-label="撤销参数" disabled={!history.past.length&&!preview} onClick={() => {finish();dispatch({type:'undo'});}}><Undo2 size={16}/></button><button className="icon-button" aria-label="重做参数" disabled={!history.future.length} onClick={() => {finish();dispatch({type:'redo'});}}><Redo2 size={16}/></button>{!resultsOpen&&<button className="gs-spot-toggle" onClick={() => setResultsOpen(true)}><ScanLine size={15}/>结果</button>}</div></div><MalusDiagram p={p} annotations={annotations} onStart={start} onChange={change} onFinish={finish}/></main>
      {resultsOpen&&<><div className="gs-panel-resizer" {...layout.results.separator}/><aside className="gs-sidebar gfocus-results fiber-results" style={{width:layout.results.width}} aria-label="偏振结果"><div className="gs-sidebar-title"><h2><ScanLine size={16}/>当前结果</h2><button className="icon-button" aria-label="收起右侧结果" onClick={() => setResultsOpen(false)}><X size={17}/></button></div><div className="gs-sidebar-scroll"><section className="fiber-mode-summary"><span className="malus-efficiency-label">透射功率</span><strong data-testid="malus-efficiency">{numberText(b.outputPowerMw)}<small>mW</small></strong><p>理想偏振片</p></section><section className="fiber-readings">{RESULTS.map(f => <div key={f.key} className="quantity-color" style={quantityStyle(MALUS_COLORS[f.key])}><Quantity label={f.label} symbol={f.symbol} active={marked(f.key as Annotation)} onClick={KEYS.includes(f.key as Annotation)?()=>toggle(f.key as Annotation):undefined}/><strong data-testid={'malus-reading-'+f.key}>{f.unit==='%'?Number(b[f.key].toFixed(2)):numberText(b[f.key])}<small>{f.unit}</small></strong></div>)}</section><MalusCurve p={p}/></div></aside></>}
    </div><div className="gs-model-strip"><span>线偏振光 · 理想偏振片</span><span>正视图 · 光沿视线传播</span></div>
    {formulaOpen&&<SceneFormulaSheet state={malusState(p)} onClose={() => setFormulaOpen(false)}/>}
    {assistantOpen&&<aside className="gs-drawer gs-assistant" aria-label="场景AI助手"><button className="gs-assistant-close icon-button" aria-label="关闭场景AI助手" onClick={onCloseAssistant}><X size={18}/></button><AssistantPanel sceneState={malusState(p)} editing={gesture.current||preview!==null} onApplyScene={applyAssistant} onRestoreScene={restoreAssistant}/></aside>}
    {notice&&<div className="gs-notice" role="status">{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15}/></button></div>}
  </section>;
}

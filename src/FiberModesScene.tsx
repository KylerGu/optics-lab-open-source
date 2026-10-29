import SceneAssistantToggle from './SceneAssistantToggle';
import { FIBER_COLORS, quantityStyle } from './quantityColors';
import './quantity-colors.css';
import { useEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { BookOpen, ChevronLeft, Maximize, PanelLeftClose, PanelLeftOpen, Redo2, RotateCcw, ScanLine, Settings2, Undo2, X } from 'lucide-react';
import AssistantPanel from './AssistantPanel';
import SceneFormulaSheet from './SceneFormulaSheet';
import { useScenePanelWidth } from './useScenePanelWidth';
import { draftKey, numberText, readScene, sceneKey, SCENE_DEFINITIONS, type SceneState } from './sceneRuntime';
import { DEFAULT_FIBER, FIBER_FIELDS, FIBER_ID, fiberHistory, fiberModes, fiberState, parseFiber, type FiberHistory, type FiberParameters } from './fiberModes';
import './gaussian-scene.css';
import './gaussian-focus.css';
import './resonator-scene.css';
import './fiber-modes.css';
import FiberDiagram, { type FiberAnnotation } from './FiberDiagram';

const RESULTS = [
  { key: 'na', label: '数值孔径', symbol: 'NA', unit: '' },
  { key: 'acceptanceDeg', label: '接收半角', symbol: 'θₐ', unit: '°' },
  { key: 'criticalDeg', label: '临界角', symbol: 'θc', unit: '°' },
  { key: 'internalDeg', label: '芯内角', symbol: 'θ₁', unit: '°' },
  { key: 'incidenceDeg', label: '界面入射角', symbol: 'i', unit: '°' },
  { key: 'v', label: '归一化频率', symbol: 'V', unit: '' },
  { key: 'cutoffNm', label: '截止波长', symbol: 'λc', unit: 'nm' },
] as const;
type Annotation = FiberAnnotation;
const KEYS: Annotation[] = ['coreIndex','claddingIndex','radiusUm','angleDeg','acceptanceDeg','criticalDeg','internalDeg','incidenceDeg'];
const DEFAULT_MARKS: Annotation[] = ['coreIndex', 'claddingIndex', 'radiusUm', 'angleDeg'];
const MARK_KEY = 'optics-fiber-modes-annotations:v1';
function readMarks(): Annotation[] {
  try { const a = JSON.parse(localStorage.getItem(MARK_KEY) ?? 'null'); if (Array.isArray(a)) return a.filter((k): k is Annotation => KEYS.includes(k)); } catch { /* Optional preference. */ }
  return DEFAULT_MARKS;
}
function Quantity({ label, symbol, active, onClick }: { label: string; symbol: string; active: boolean; onClick?: () => void }) {
  if (!onClick) return <span className="fiber-quantity-text">{label}<i className="gs-quantity-symbol">{symbol}</i></span>;
  return <button className="resonator-quantity-label" aria-label={label} aria-pressed={active} title={active ? '点击隐藏图中标注' : '点击显示图中标注'} onClick={onClick}>{label}<i className="gs-quantity-symbol">{symbol}</i></button>;
}
function Parameter({ field, value, start, change, finish, active, toggle }: { field: typeof FIBER_FIELDS[number]; value: number; start: () => void; change: (n: number) => void; finish: () => void; active: boolean; toggle?: () => void }) {
  const [draft, setDraft] = useState(String(value)), [error, setError] = useState(false);
  useEffect(() => { setDraft(String(value)); setError(false); }, [value]);
  const submit = () => {
    const n = Number(draft);
    if (!draft.trim() || !Number.isFinite(n) || n < field.min || n > field.max) { setError(true); return; }
    start(); change(n); finish(); setError(false);
  };
  return <div className="gs-parameter quantity-color" style={quantityStyle(FIBER_COLORS[field.key])}><div className="resonator-parameter-line"><Quantity label={field.label} symbol={field.symbol} active={active} onClick={toggle}/><div className="gs-number"><input type="number" aria-label={field.label} aria-invalid={error} min={field.min} max={field.max} step={field.step} value={draft} onChange={e => { setDraft(e.target.value); setError(false); }} onBlur={submit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/><span>{field.unit}</span></div></div>
    <input type="range" aria-label={field.label + '滑杆'} min={field.min} max={field.max} step={field.step} value={value} style={{ '--range-fill': `${(value - field.min) / (field.max - field.min) * 100}%` } as CSSProperties} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); start(); }} onChange={e => { start(); change(Number(e.target.value)); }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onBlur={finish} onKeyDown={e => { if (['ArrowLeft','ArrowRight','Home','End','ArrowUp','ArrowDown','PageUp','PageDown'].includes(e.key)) start(); }} onKeyUp={finish}/>
    {error && <small className="gs-error" role="alert">请输入 {field.min}–{field.max}{field.unit}。</small>}
  </div>;
}

export default function FiberModesScene({ onDirectory, assistantOpen, onCloseAssistant }: { onDirectory: () => void; assistantOpen: boolean; onCloseAssistant: () => void }) {
  const [history, dispatch] = useReducer(fiberHistory, undefined, () => ({ past: [], present: parseFiber(readScene(FIBER_ID).parameters), future: [] } as FiberHistory));
  const [preview, setPreview] = useState<FiberParameters|null>(null), p = preview ?? history.present, b = fiberModes(p);
  const latest = useRef(p); latest.current = p;
  const gesture = useRef(false), pending = useRef<FiberParameters|null>(null);
  const [panelOpen, setPanelOpen] = useState(true), [resultsOpen, setResultsOpen] = useState(true), [formulaOpen, setFormulaOpen] = useState(false);
  const [annotations, setAnnotations] = useState(readMarks), [saveFailed, setSaveFailed] = useState(false), [notice, setNotice] = useState('');
  const root = useRef<HTMLElement>(null), workspace = useRef<HTMLDivElement>(null);
  const layout = useScenePanelWidth(workspace, resultsOpen, panelOpen,{onLeftClose:()=>setPanelOpen(false),onRightClose:()=>setResultsOpen(false)});
  const start = () => { gesture.current = true; };
  const change = (key: keyof FiberParameters, value: number) => { const next = { ...latest.current, [key]: value }; latest.current = next; pending.current = next; setPreview(next); };
  const finish = () => { if (!gesture.current) return; gesture.current = false; if (pending.current) dispatch({ type: 'commit', parameters: pending.current }); pending.current = null; setPreview(null); };
  const marked = (k: Annotation) => annotations.includes(k), toggle = (k: Annotation) => setAnnotations(a => a.includes(k) ? a.filter(v => v !== k) : [...a,k]);
  useEffect(() => { try { localStorage.setItem(draftKey(FIBER_ID),JSON.stringify(fiberState(history.present))); setSaveFailed(false); } catch { setSaveFailed(true); } },[history.present]);
  useEffect(() => { try { localStorage.setItem(MARK_KEY,JSON.stringify(annotations)); } catch { /* Optional preference. */ } },[annotations]);
  useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.target as Element)?.closest('input,textarea,select,[contenteditable=true]') || document.querySelector('dialog[open]')) return; if ((e.ctrlKey || e.metaKey) && ['z','y'].includes(e.key.toLowerCase())) { e.preventDefault(); gesture.current=false; if(pending.current)dispatch({type:'commit',parameters:pending.current});pending.current=null;setPreview(null);dispatch({type:e.key.toLowerCase()==='y'||e.shiftKey?'redo':'undo'}); } }; window.addEventListener('keydown',handler); return () => window.removeEventListener('keydown',handler); },[]);
  const applyAssistant = (state: SceneState) => { if(state.sceneId!==FIBER_ID || gesture.current || document.activeElement?.matches('.fiber-modes-scene .gs-parameter input'))return false; try { dispatch({type:'commit',parameters:parseFiber(state.parameters)}); return true; } catch { return false; } };
  const restoreAssistant = (before: SceneState, after: SceneState) => { if(gesture.current || sceneKey(fiberState(latest.current))!==sceneKey(after))return false;const previous=history.past.at(-1);if(previous&&sceneKey(fiberState(previous))===sceneKey(before)){dispatch({type:'undo'});return true;}return applyAssistant(before); };
  return <section ref={root} className={`gaussian-scene gaussian-focus-scene fiber-modes-scene ${layout.resizing?'gs-panel-resizing':''}`} aria-label="光纤数值孔径与导模场景">
    <div className="gs-heading"><div className="gs-title"><button className="icon-button" aria-label="返回仿真场景库" onClick={onDirectory}><ChevronLeft size={20}/></button><h1>光纤数值孔径与导模</h1></div><div className="gs-heading-actions"><SceneAssistantToggle/><button className="outline-button" aria-haspopup="dialog" aria-expanded={formulaOpen} onClick={() => { finish(); setFormulaOpen(true); }}><BookOpen size={15}/>相关公式</button><button className="icon-button" aria-label="全屏查看场景" onClick={() => void(document.fullscreenElement?document.exitFullscreen():root.current?.requestFullscreen())?.catch(() => setNotice('浏览器未开启全屏。'))}><Maximize size={18}/></button></div></div>
    <div ref={workspace} className="gs-workspace">
      {panelOpen && <><aside className="gs-sidebar" style={{width:layout.width}} aria-label="光纤参数"><div className="gs-sidebar-title"><h2><Settings2 size={16}/>参数调节</h2><button className="icon-button" aria-label="收起左侧参数" onClick={() => setPanelOpen(false)}><PanelLeftClose size={17}/></button></div><div className="gs-sidebar-scroll"><section>{FIBER_FIELDS.map(f => <Parameter key={f.key} field={f} value={p[f.key]} start={start} change={v => change(f.key,v)} finish={finish} active={marked(f.key as Annotation)} toggle={KEYS.includes(f.key as Annotation)?() => toggle(f.key as Annotation):undefined}/>)}<p className="fiber-hint">点击名称切换对应标注</p></section><section className="gs-presets">{SCENE_DEFINITIONS[FIBER_ID].presets.map(preset => <button key={preset.label} onClick={() => {finish();dispatch({type:'commit',parameters:parseFiber({...latest.current,...preset.values})});}}>{preset.label}</button>)}</section><details className="fiber-conditions"><summary>模型条件</summary><p>直光纤、空气入射，忽略吸收与弯曲。单模判断适用于纤芯与包层折射率接近时。</p></details></div><div className="gs-sidebar-footer"><button className="text-button" onClick={() => {finish();dispatch({type:'commit',parameters:{...DEFAULT_FIBER}});setAnnotations([...DEFAULT_MARKS]);}}><RotateCcw size={14}/>恢复默认</button><span>{saveFailed?'本机保存不可用':'已自动保存'}</span></div></aside><div className="gs-panel-resizer" {...layout.separator}/></>}
      <main className="gs-visual"><div className="gs-toolbar"><div className="gs-toolbar-left">{!panelOpen&&<button className="icon-button" aria-label="展开左侧参数" onClick={() => setPanelOpen(true)}><PanelLeftOpen size={17}/></button>}<span className="gfocus-view-title">光纤纵截面</span></div><div className="gs-toolbar-right"><button className="icon-button" aria-label="撤销参数" disabled={!history.past.length&&!preview} onClick={() => {finish();dispatch({type:'undo'});}}><Undo2 size={16}/></button><button className="icon-button" aria-label="重做参数" disabled={!history.future.length} onClick={() => {finish();dispatch({type:'redo'});}}><Redo2 size={16}/></button>{!resultsOpen&&<button className="gs-spot-toggle" onClick={() => setResultsOpen(true)}><ScanLine size={15}/>结果</button>}</div></div><FiberDiagram p={p} annotations={annotations} onStart={start} onChange={change} onFinish={finish}/></main>
      {resultsOpen&&<><div className="gs-panel-resizer" {...layout.results.separator}/><aside className="gs-sidebar gfocus-results fiber-results" style={{width:layout.results.width}} aria-label="光纤结果"><div className="gs-sidebar-title"><h2><ScanLine size={16}/>当前结果</h2><button className="icon-button" aria-label="收起右侧结果" onClick={() => setResultsOpen(false)}><X size={17}/></button></div><div className="gs-sidebar-scroll"><section className="fiber-mode-summary"><strong data-testid="fiber-mode">{b.mode}</strong><p>{b.guiding?'折射率相近时适用':'纤芯折射率须高于包层'}</p></section><section className="fiber-readings">{RESULTS.map(f => <div key={f.key} className="quantity-color" style={quantityStyle(FIBER_COLORS[f.key])}><Quantity label={f.label} symbol={f.symbol} active={marked(f.key as Annotation)} onClick={KEYS.includes(f.key as Annotation)?() => toggle(f.key as Annotation):undefined}/><strong data-testid={'fiber-reading-'+f.key}>{numberText(b[f.key])}<small>{f.unit}</small></strong></div>)}</section></div></aside></>}
    </div><div className="gs-model-strip"><span>阶跃型光纤 · 空气入射</span><span>几何导光与模式判据分别计算</span></div>
    {formulaOpen&&<SceneFormulaSheet state={fiberState(p)} onClose={() => setFormulaOpen(false)}/>}
    {assistantOpen&&<aside className="gs-drawer gs-assistant" aria-label="场景AI助手"><button className="gs-assistant-close icon-button" aria-label="关闭场景AI助手" onClick={onCloseAssistant}><X size={18}/></button><AssistantPanel sceneState={fiberState(p)} editing={gesture.current||preview!==null} onApplyScene={applyAssistant} onRestoreScene={restoreAssistant}/></aside>}
    {notice&&<div className="gs-notice" role="status">{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15}/></button></div>}
  </section>;
}

import SceneAssistantToggle from './SceneAssistantToggle';
import { REFRACTION_COLORS, quantityStyle } from './quantityColors';
import PolarizationDiagram, { type RefractionAnnotation } from './PolarizationDiagram';
import BrewsterCurve from './BrewsterCurve';
import './quantity-colors.css';
import { useEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { BookOpen, ChevronLeft, Maximize, PanelLeftClose, PanelLeftOpen, Redo2, RotateCcw, ScanLine, Settings2, Undo2, X } from 'lucide-react';
import AssistantPanel from './AssistantPanel';
import SceneFormulaSheet from './SceneFormulaSheet';
import { useScenePanelWidth } from './useScenePanelWidth';
import { draftKey, numberText, readScene, sceneKey, SCENE_DEFINITIONS, type SceneState } from './sceneRuntime';
import { DEFAULT_POLARIZATION_REFRACTION, POLARIZATION_REFRACTION_FIELDS, POLARIZATION_REFRACTION_ID, polarizationRefractionHistory, polarizationRefraction, polarizationRefractionState, parsePolarizationRefraction, type PolarizationRefractionHistory, type PolarizationRefractionParameters } from './polarizationRefraction';
import './gaussian-scene.css';
import './gaussian-focus.css';
import './resonator-scene.css';
import './fiber-modes.css';
import './waveplate-scene.css';
import './polarization-refraction.css';

const BREWSTER_RESULTS=[
  {key:'brewsterDeg',label:'布儒斯特角',symbol:'θB',unit:'°'},
  {key:'transmissionDeg',label:'折射角',symbol:'θₜ',unit:'°'},
  {key:'rsPct',label:'s 反射率',symbol:'Rₛ',unit:'%'},
  {key:'rpPct',label:'p 反射率',symbol:'Rₚ',unit:'%'},
  {key:'reflectancePct',label:'总反射率',symbol:'R',unit:'%'},
  {key:'transmissionPct',label:'总透射率',symbol:'T',unit:'%'},
] as const;
const CRYSTAL_RESULTS=[
  {key:'effectiveIndex',label:'e 有效折射率',symbol:'nₑ(γ)',unit:''},
  {key:'walkoffDeg',label:'走离角',symbol:'ρ',unit:'°'},
  {key:'separationMm',label:'出射间距',symbol:'d',unit:'mm'},
] as const;
type Annotation=RefractionAnnotation;
const KEYS:Annotation[]=['n1','n2','angleDeg','brewsterDeg','transmissionDeg','ordinaryIndex','extraordinaryIndex','axisAngleDeg','thicknessMm','walkoffDeg','separationMm'];
const DEFAULT_MARKS:Annotation[]=['n1','n2','angleDeg','transmissionDeg','ordinaryIndex','extraordinaryIndex','axisAngleDeg','thicknessMm','separationMm'];
const MARK_KEY='optics-polarization-refraction-annotations:v1';
const BREWSTER_FIELDS=['mode','n1','n2','angleDeg','polarization'];
const CRYSTAL_FIELDS=['mode','ordinaryIndex','extraordinaryIndex','axisAngleDeg','thicknessMm'];
function readMarks(): Annotation[] {
  try { const a = JSON.parse(localStorage.getItem(MARK_KEY) ?? 'null'); if (Array.isArray(a)) return a.filter((k): k is Annotation => KEYS.includes(k)); } catch { /* Optional preference. */ }
  return DEFAULT_MARKS;
}
function Quantity({ label, symbol, active, onClick }: { label: string; symbol: string; active: boolean; onClick?: () => void }) {
  if (!onClick) return <span className="fiber-quantity-text">{label}<i className="gs-quantity-symbol">{symbol}</i></span>;
  return <button className="resonator-quantity-label" aria-label={label} aria-pressed={active} title={active ? '点击隐藏图中标注' : '点击显示图中标注'} onClick={onClick}>{label}<i className="gs-quantity-symbol">{symbol}</i></button>;
}
function Parameter({ field, value, start, change, finish, active, toggle }: { field: typeof POLARIZATION_REFRACTION_FIELDS[number]; value: number; start: () => void; change: (n: number) => void; finish: () => void; active: boolean; toggle?: () => void }) {
  const [draft, setDraft] = useState(String(value)), [error, setError] = useState(false);
  useEffect(() => { setDraft(String(value)); setError(false); }, [value]);
  const submit = () => {
    const n = Number(draft);
    if (!draft.trim() || !Number.isFinite(n) || n < field.min || n > field.max) { setError(true); return; }
    start(); change(n); finish(); setError(false);
  };
  if(field.options)return <div className="waveplate-type"><span>{field.label}</span><div role="group" aria-label={field.label}>{field.options.map(option=><button key={option.value} aria-pressed={value===option.value} onClick={()=>{start();change(option.value);finish();}}>{option.label}</button>)}</div></div>;
  return <div className="gs-parameter quantity-color" style={quantityStyle(REFRACTION_COLORS[field.key])}><div className="resonator-parameter-line"><Quantity label={field.label} symbol={field.symbol} active={active} onClick={toggle}/><div className="gs-number"><input type="number" aria-label={field.label} aria-invalid={error} min={field.min} max={field.max} step={field.step} value={draft} onChange={e => { setDraft(e.target.value); setError(false); }} onBlur={submit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/><span>{field.unit}</span></div></div>
    <input type="range" aria-label={field.label + '滑杆'} min={field.min} max={field.max} step={field.step} value={value} style={{ '--range-fill': `${(value - field.min) / (field.max - field.min) * 100}%` } as CSSProperties} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); start(); }} onChange={e => { start(); change(Number(e.target.value)); }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onBlur={finish} onKeyDown={e => { if (['ArrowLeft','ArrowRight','Home','End','ArrowUp','ArrowDown','PageUp','PageDown'].includes(e.key)) start(); }} onKeyUp={finish}/>
    {error && <small className="gs-error" role="alert">请输入 {field.min}–{field.max}{field.unit}。</small>}
  </div>;
}

export default function PolarizationRefractionScene({ onDirectory, assistantOpen, onCloseAssistant, }: { onDirectory: () => void; assistantOpen: boolean; onCloseAssistant: () => void }) {
  const [history, dispatch] = useReducer(polarizationRefractionHistory, undefined, () => ({ past: [], present: parsePolarizationRefraction(readScene(POLARIZATION_REFRACTION_ID).parameters), future: [] } as PolarizationRefractionHistory));
  const [preview, setPreview] = useState<PolarizationRefractionParameters|null>(null), p = preview ?? history.present, b = polarizationRefraction(p);
  const latest = useRef(p); latest.current = p;
  const gesture = useRef(false), pending = useRef<PolarizationRefractionParameters|null>(null);
  const [panelOpen, setPanelOpen] = useState(true), [resultsOpen, setResultsOpen] = useState(true), [formulaOpen, setFormulaOpen] = useState(false);
  const [annotations, setAnnotations] = useState(readMarks), [saveFailed, setSaveFailed] = useState(false), [notice, setNotice] = useState('');
  const [resetCount,setResetCount]=useState(0);
  const root = useRef<HTMLElement>(null), workspace = useRef<HTMLDivElement>(null);
  const layout = useScenePanelWidth(workspace, resultsOpen, panelOpen,{onLeftClose:()=>setPanelOpen(false),onRightClose:()=>setResultsOpen(false)});
  const start = () => { gesture.current = true; };
  const change = (key: keyof PolarizationRefractionParameters, value: number) => { const next = { ...latest.current, [key]: value }; latest.current = next; pending.current = next; setPreview(next); };
  const finish = () => { if (!gesture.current) return; gesture.current = false; if (pending.current) dispatch({ type: 'commit', parameters: pending.current }); pending.current = null; setPreview(null); };
  const marked = (k: Annotation) => annotations.includes(k), toggle = (k: Annotation) => setAnnotations(a => a.includes(k) ? a.filter(v => v !== k) : [...a,k]);
  useEffect(() => { try { localStorage.setItem(draftKey(POLARIZATION_REFRACTION_ID),JSON.stringify(polarizationRefractionState(history.present))); setSaveFailed(false); } catch { setSaveFailed(true); } },[history.present]);
  useEffect(() => { try { localStorage.setItem(MARK_KEY,JSON.stringify(annotations)); } catch { /* Optional preference. */ } },[annotations]);
  useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.target as Element)?.closest('input,textarea,select,[contenteditable=true]') || document.querySelector('dialog[open]')) return; if ((e.ctrlKey || e.metaKey) && ['z','y'].includes(e.key.toLowerCase())) { e.preventDefault(); gesture.current=false; if(pending.current)dispatch({type:'commit',parameters:pending.current});pending.current=null;setPreview(null);dispatch({type:e.key.toLowerCase()==='y'||e.shiftKey?'redo':'undo'}); } }; window.addEventListener('keydown',handler); return () => window.removeEventListener('keydown',handler); },[]);
  const applyAssistant = (state: SceneState) => { if(state.sceneId!==POLARIZATION_REFRACTION_ID || gesture.current || document.activeElement?.matches('.fiber-modes-scene .gs-parameter input'))return false; try { dispatch({type:'commit',parameters:parsePolarizationRefraction(state.parameters)}); return true; } catch { return false; } };
  const restoreAssistant = (before: SceneState, after: SceneState) => { if(gesture.current || sceneKey(polarizationRefractionState(latest.current))!==sceneKey(after))return false;const previous=history.past.at(-1);if(previous&&sceneKey(polarizationRefractionState(previous))===sceneKey(before)){dispatch({type:'undo'});return true;}return applyAssistant(before); };
  return <section ref={root} className={`gaussian-scene gaussian-focus-scene fiber-modes-scene polarization-refraction-scene ${layout.resizing?'gs-panel-resizing':''}`} aria-label="布儒斯特角与双折射场景">
    <div className="gs-heading"><div className="gs-title"><button className="icon-button" aria-label="返回仿真场景库" onClick={onDirectory}><ChevronLeft size={20}/></button><h1>布儒斯特角与双折射</h1></div><div className="gs-heading-actions"><SceneAssistantToggle/><button className="outline-button" aria-haspopup="dialog" aria-expanded={formulaOpen} onClick={() => { finish(); setFormulaOpen(true); }}><BookOpen size={15}/>相关公式</button><button className="icon-button" aria-label="全屏查看场景" onClick={() => void(document.fullscreenElement?document.exitFullscreen():root.current?.requestFullscreen())?.catch(() => setNotice('浏览器未开启全屏。'))}><Maximize size={18}/></button></div></div>
    <div ref={workspace} className="gs-workspace">
      {panelOpen && <><aside className="gs-sidebar" style={{width:layout.width}} aria-label="偏振参数"><div className="gs-sidebar-title"><h2><Settings2 size={16}/>参数调节</h2><button className="icon-button" aria-label="收起左侧参数" onClick={() => setPanelOpen(false)}><PanelLeftClose size={17}/></button></div><div className="gs-sidebar-scroll"><section>{POLARIZATION_REFRACTION_FIELDS.filter(f=>(p.mode===0?BREWSTER_FIELDS:CRYSTAL_FIELDS).includes(f.key)).map(f => <Parameter key={f.key+resetCount} field={f} value={p[f.key]} start={start} change={v => change(f.key,v)} finish={finish} active={marked(f.key as Annotation)} toggle={KEYS.includes(f.key as Annotation)?() => toggle(f.key as Annotation):undefined}/>)}<p className="fiber-hint">点击名称切换对应标注</p></section><section className="gs-presets">{SCENE_DEFINITIONS[POLARIZATION_REFRACTION_ID].presets.filter(preset=>preset.values.mode===p.mode).map(preset => <button key={preset.label} disabled={preset.label==='布儒斯特角'&&b.brewsterDeg===null} onClick={() => {finish();dispatch({type:'commit',parameters:parsePolarizationRefraction(preset.label==='布儒斯特角'?{...latest.current,angleDeg:b.brewsterDeg??latest.current.angleDeg}:{...latest.current,...preset.values})});}}>{preset.label}</button>)}</section><details className="fiber-conditions"><summary>模型条件</summary><p>{p.mode===0?'无吸收单界面；s、p 按功率反射率计算。':'单轴晶体平行平板、正入射；光轴在图面内，不计表面反射。'}</p></details></div><div className="gs-sidebar-footer"><button className="text-button" onClick={() => {finish();dispatch({type:'commit',parameters:{...DEFAULT_POLARIZATION_REFRACTION,mode:latest.current.mode}});setAnnotations([...DEFAULT_MARKS]);setResetCount(c=>c+1);}}><RotateCcw size={14}/>恢复默认</button><span>{saveFailed?'本机保存不可用':'已自动保存'}</span></div></aside><div className="gs-panel-resizer" {...layout.separator}/></>}
      <main className="gs-visual"><div className="gs-toolbar"><div className="gs-toolbar-left">{!panelOpen&&<button className="icon-button" aria-label="展开左侧参数" onClick={() => setPanelOpen(true)}><PanelLeftOpen size={17}/></button>}<span className="gfocus-view-title">{p.mode===0?'界面反射与折射':'晶体分束'}</span></div><div className="gs-toolbar-right"><button className="icon-button" aria-label="撤销参数" disabled={!history.past.length&&!preview} onClick={() => {finish();dispatch({type:'undo'});}}><Undo2 size={16}/></button><button className="icon-button" aria-label="重做参数" disabled={!history.future.length} onClick={() => {finish();dispatch({type:'redo'});}}><Redo2 size={16}/></button>{!resultsOpen&&<button className="gs-spot-toggle" onClick={() => setResultsOpen(true)}><ScanLine size={15}/>结果</button>}</div></div><PolarizationDiagram p={p} annotations={annotations} onStart={start} onChange={change} onFinish={finish}/></main>
      {resultsOpen&&<><div className="gs-panel-resizer" {...layout.results.separator}/><aside className="gs-sidebar gfocus-results fiber-results" style={{width:layout.results.width}} aria-label="偏振结果"><div className="gs-sidebar-title"><h2><ScanLine size={16}/>当前结果</h2><button className="icon-button" aria-label="收起右侧结果" onClick={() => setResultsOpen(false)}><X size={17}/></button></div><div className="gs-sidebar-scroll"><section className="fiber-mode-summary"><span className="waveplate-efficiency-label">{p.mode===0?'界面状态':'空间分束'}</span><strong data-testid="pr-state">{b.status}</strong><p>{p.mode===0?(b.atBrewster?'p 光不反射；s 光仍可反射':b.tir?'无传播折射光':b.brewsterDeg===null?'各种入射角均无反射':'改变入射角，观察两种偏振'):(b.separationMm===0?'出射位置重合':'o 光直行，e 光在晶体内偏移')}</p></section>
        <section className="fiber-readings">{(p.mode===0?BREWSTER_RESULTS:CRYSTAL_RESULTS).map(f=><div key={f.key} className="quantity-color" style={quantityStyle(REFRACTION_COLORS[f.key])}><Quantity label={f.label} symbol={f.symbol} active={marked(f.key as Annotation)} onClick={KEYS.includes(f.key as Annotation)&&b[f.key]!==null?()=>toggle(f.key as Annotation):undefined}/><strong data-testid={'pr-reading-'+f.key}>{numberText(b[f.key])}<small>{b[f.key]===null?'':f.unit}</small></strong></div>)}
          {p.mode===0&&b.criticalDeg!==null&&<div style={quantityStyle(REFRACTION_COLORS.criticalDeg)} className="quantity-color"><Quantity label="临界角" symbol="θc" active={false}/><strong>{numberText(b.criticalDeg)}<small>°</small></strong></div>}
        </section>
        {p.mode===0?<BrewsterCurve p={p}/>:<p className="pr-output-note">两束出射光平行，偏振方向相互垂直。走离角：正向上、负向下。e 主折射率为材料参数，有效折射率随光轴角变化。</p>}
        </div></aside></>}
    </div><div className="gs-model-strip"><span>{p.mode===0?'透明介质 · 单界面':'单轴晶体 · 正入射'}</span><span>{p.mode===0?'s 垂直图面 · p 在图面内':'o 普通光 · e 非普通光'}</span></div>
    {formulaOpen&&<SceneFormulaSheet state={polarizationRefractionState(p)} onClose={() => setFormulaOpen(false)}/>}
    {assistantOpen&&<aside className="gs-drawer gs-assistant" aria-label="场景AI助手"><button className="gs-assistant-close icon-button" aria-label="关闭场景AI助手" onClick={onCloseAssistant}><X size={18}/></button><AssistantPanel sceneState={polarizationRefractionState(p)} editing={gesture.current||preview!==null} onApplyScene={applyAssistant} onRestoreScene={restoreAssistant}/></aside>}
    {notice&&<div className="gs-notice" role="status">{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15}/></button></div>}
  </section>;
}

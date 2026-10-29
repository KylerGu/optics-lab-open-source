import SceneAssistantToggle from './SceneAssistantToggle';
import { useCallback, useEffect, useReducer, useRef, useState, useMemo, type CSSProperties } from 'react';
import { BookOpen, Copy, ChevronLeft, Maximize, PanelLeftClose, PanelLeftOpen, Redo2, RotateCcw, ScanLine, Settings2, Undo2, X } from 'lucide-react';
import { DEFAULT_FOUR_F, FOUR_F_DRAFT_KEY, FOUR_F_FIELDS, FOUR_F_ID, parseFourF, fourFHistory, fourFState, fourF, type FourFHistory, type FourFParameters } from './fourF';
import FourFApparatus from './FourFApparatus';
import FourFScreen from './FourFScreen';
import { fourFBuilderCopy, fourFTarget } from './fourF';
import type { SpatialExperiment } from './builderModel';
import AssistantPanel from './AssistantPanel';
import SceneFormulaSheet from './SceneFormulaSheet';
import { useScenePanelWidth } from './useScenePanelWidth';
import { type SceneState, sceneKey } from './sceneRuntime';
import './gaussian-scene.css';
import './gaussian-focus.css';
import './resonator-scene.css';
import './fourier-lens.css';
import './four-f.css';

type Field = keyof FourFParameters;
type Annotation = keyof FourFParameters | 'transmission' | 'cutoffFrequency' | 'intensity';
const ANNOTATIONS: Annotation[] = ['wavelengthNm','periodMm','waistMm','modulation','focalLengthMm','filterWidthUm','filterOffsetUm','observationMm','transmission','cutoffFrequency','intensity'];
const DEFAULT_ANNOTATIONS: Annotation[] = ['filterWidthUm','filterOffsetUm','focalLengthMm','observationMm'];
const ANNOTATION_KEY = 'optics-fourF-lens-annotations:v1';
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const fmt = (n: number) => Math.abs(n) < 1e-10 ? '0' : Math.abs(n) < .0001 ? n.toExponential(3) : Number(n.toFixed(4)).toString();
function readFourF() {
  try { const stored = localStorage.getItem(FOUR_F_DRAFT_KEY); if (stored) { const s = JSON.parse(stored); if (s.version === 1 && s.sceneId === FOUR_F_ID) return parseFourF(s.parameters); } } catch { /* Fall back to a valid scene. */ }
  return { ...DEFAULT_FOUR_F };
}
function readAnnotations(): Annotation[] {
  try { const a = JSON.parse(localStorage.getItem(ANNOTATION_KEY) ?? 'null'); if (Array.isArray(a)) return a.filter((k): k is Annotation => ANNOTATIONS.includes(k)); } catch { /* Optional preferences. */ }
  return [...DEFAULT_ANNOTATIONS];
}
function QuantityLabel({ label, symbol, active, onClick }: { label: string; symbol: string; active: boolean; onClick: () => void }) {
  return <button type="button" className="resonator-quantity-label" aria-label={label} aria-pressed={active} title={active ? '点击隐藏图中标注' : '点击显示图中标注'} onClick={onClick}>{label}<i className="gs-quantity-symbol">{symbol}</i></button>;
}
function Parameter({ field, value, change, start, finish, marked, toggle, disabled = false }: { field: typeof FOUR_F_FIELDS[number]; value: number; change: (v: number) => void; start: () => void; finish: () => void; marked: boolean; toggle?: () => void; disabled?: boolean }) {
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
  return <div className={`gs-parameter gs-tone-${field.tone} ${disabled ? 'fourF-inactive' : ''}`}>
    <div className="resonator-parameter-line">{toggle ? <QuantityLabel label={field.label} symbol={field.symbol} active={marked} onClick={toggle}/> : <span className="resonator-quantity-text">{field.label}<i className="gs-quantity-symbol">{field.symbol}</i></span>}<div className="gs-number"><input type="number" disabled={disabled} aria-label={field.label} aria-invalid={error} min={field.min} max={field.max} step={field.step} value={draft} onChange={e => { setDraft(e.target.value); setError(false); }} onBlur={submit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/><span>{field.unit}</span></div></div>
    <input type="range" disabled={disabled} aria-label={field.label + '滑杆'} min={field.min} max={field.max} step={field.step} value={value} style={{ '--range-fill': `${fill}%` } as CSSProperties}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); start(); }} onChange={e => { start(); change(Number(e.target.value)); }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onBlur={finish} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) start(); }} onKeyUp={finish}/>
    {error && <small className="gs-error" role="alert">请输入 {field.min}–{field.max} {field.unit}。</small>}
  </div>;
}

export default function FourFDiffractionScene({ onDirectory, assistantOpen, onCloseAssistant, onCopy }: { onCopy: (s: SpatialExperiment) => void; onDirectory: () => void; assistantOpen: boolean; onCloseAssistant: () => void }) {
  const [initial] = useState(readFourF);
  const [history, dispatch] = useReducer(fourFHistory, { past: [], present: initial, future: [] } as FourFHistory);
  const [preview, setPreview] = useState<FourFParameters | null>(null);
  const p = preview ?? history.present, latest = useRef(p); latest.current = p;
  const pending = useRef<FourFParameters | null>(null), gesture = useRef(false), raf = useRef<number | null>(null);
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
  const [viewRadius, setViewRadius] = useState(2), [zoom, setZoom] = useState(1);
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
  useEffect(() => { try { localStorage.setItem(FOUR_F_DRAFT_KEY, JSON.stringify(fourFState(history.present))); setSaveFailed(false); } catch { setSaveFailed(true); } }, [history.present]);
  useEffect(() => () => { if (raf.current !== null) cancelAnimationFrame(raf.current); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as Element)?.closest('input,textarea,select,[contenteditable=true]') || document.querySelector('dialog[open]')) return;
      if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); finish(); dispatch({ type: e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo' }); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [finish]);


  const b=useMemo(()=>fourF(p),[p]),visible=(v:number)=>Math.abs(v)<=viewRadius;
  const adjustZoom=(factor:number)=>{const next=clamp(zoom*factor,.3,8);setViewRadius(2/next);setZoom(next);};
  const fitScreen=()=>{const next=clamp(Math.max(p.waistMm*2.5,Math.abs(p.observationMm)*1.2,.4),.25,6);setViewRadius(next);setZoom(2/next);};
  const showObservation=(v:number)=>{if(!visible(v)){const next=Math.max(2,Math.abs(v)*1.2);setViewRadius(next);setZoom(2/next);}};
  const applyAssistant=(state:SceneState)=>{
    if(state.sceneId!==FOUR_F_ID||gesture.current||document.activeElement?.matches('.four-f-scene .gs-parameter input'))return false;
    try{const next=parseFourF(state.parameters);dispatch({type:'commit',parameters:next});showObservation(next.observationMm);return true;}catch{return false;}
  };
  const restoreAssistant=(before:SceneState,after:SceneState)=>{
    if(gesture.current||sceneKey(fourFState(latest.current))!==sceneKey(after))return false;
    const previous=history.past.at(-1);
    if(previous&&sceneKey(fourFState(previous))===sceneKey(before)){dispatch({type:'undo'});showObservation(previous.observationMm);return true;}
    return applyAssistant(before);
  };
  const reset=()=>{finish();dispatch({type:'commit',parameters:{...DEFAULT_FOUR_F}});setViewRadius(2);setZoom(1);setAnnotations([...DEFAULT_ANNOTATIONS]);setResetVersion(v=>v+1);};
  const patch=(values:Partial<FourFParameters>)=>{finish();dispatch({type:'commit',parameters:{...latest.current,...values}});};
  const target=(value:string)=>patch(fourFTarget(latest.current,value));
  const curve=useMemo(()=>Array.from({length:401},(_,i)=>{const x=-viewRadius+2*viewRadius*i/400;return {x,input:b.input(x)**2,output:b.at(x)};}),[b,viewRadius]);
  return <section ref={root} className={`gaussian-scene gaussian-focus-scene fourier-lens-scene four-f-scene ${layout.resizing?'gs-panel-resizing':''}`} aria-label="4f空间滤波场景">
    <div className="gs-heading"><div className="gs-title"><button className="icon-button" aria-label="返回仿真场景库" onClick={onDirectory}><ChevronLeft size={20}/></button><h1>4f 空间滤波</h1></div><div className="gs-heading-actions"><SceneAssistantToggle/><button className="gs-copy-button" title="复制当前光源、条纹、透镜、滤波片与输出屏" onClick={()=>{finish();onCopy(fourFBuilderCopy(latest.current));}}><Copy size={16}/>复制到光路搭建</button><button className="outline-button" aria-haspopup="dialog" aria-expanded={formulaOpen} onClick={()=>{finish();setFormulaOpen(true);}}><BookOpen size={15}/>相关公式</button><button className="icon-button" aria-label="全屏查看场景" onClick={()=>void(document.fullscreenElement?document.exitFullscreen():root.current?.requestFullscreen())?.catch(()=>setNotice('浏览器未开启全屏。'))}><Maximize size={18}/></button></div></div>
    <div ref={workspace} className="gs-workspace">
      {panelOpen&&<><aside className="gs-sidebar" style={{width:layout.width}} aria-label="4f参数"><div className="gs-sidebar-title"><h2><Settings2 size={16}/>参数调节</h2><button className="icon-button" aria-label="收起左侧参数" onClick={()=>setPanelOpen(false)}><PanelLeftClose size={17}/></button></div><div className="gs-sidebar-scroll">
        <section><h3>频谱滤波</h3><div className="gs-presets four-f-mode">{[{title:'狭缝',mode:0},{title:'挡片',mode:1},{title:'全通',mode:2}].map(t=><button key={t.mode} aria-pressed={p.filterMode===t.mode} onClick={()=>patch({filterMode:t.mode})}>{t.title}</button>)}</div><div className="gs-presets">{[{title:'低通',target:'low_pass'},{title:'高通',target:'high_pass'},{title:'选一级',target:'positive_order'}].map(t=><button key={t.target} disabled={t.target==='positive_order'&&!p.modulation} onClick={()=>target(t.target)}>{t.title}</button>)}</div>{FOUR_F_FIELDS.filter(f=>['filterWidthUm','filterOffsetUm'].includes(f.key)).map(f=><Parameter key={f.key+resetVersion} field={f} value={p[f.key]} change={v=>change(f.key,v)} start={start} finish={finish} marked={marked(f.key)} toggle={()=>toggle(f.key)} disabled={p.filterMode===2}/>)}</section>
        {[{title:'输入光场',keys:['periodMm','waistMm','modulation']},{title:'光源与透镜',keys:['wavelengthNm','focalLengthMm']},{title:'观察位置',keys:['observationMm']}].map(section=><section key={section.title}><h3>{section.title}</h3>{section.title==='输入光场'&&<div className="gs-presets"><button aria-pressed={p.modulation===1} onClick={()=>patch({modulation:1})}>条纹输入</button><button aria-pressed={p.modulation===0} onClick={()=>patch({modulation:0})}>无条纹</button></div>}{FOUR_F_FIELDS.filter(f=>section.keys.includes(f.key)).map(f=><Parameter key={f.key+resetVersion} field={f} value={p[f.key]} change={v=>change(f.key,v)} start={start} finish={finish} marked={marked(f.key)} toggle={()=>toggle(f.key)} disabled={f.key==='periodMm'&&!p.modulation}/>)}{section.title==='观察位置'&&<div className="gs-presets"><button onClick={()=>patch({observationMm:0})}>中心</button></div>}</section>)}
        <details className="fourier-details"><summary>符号与操作</summary><p>点击中文名称开关字母标注。拖滤波边缘改 a，拖中心改 c，拖输出面改 f。</p><p>a 是滤波片全宽；w 是光束半径，上下合起来为 2w。λ 波长 · d 条纹周期 · m 条纹对比 · x′ 输出观察位置。</p><p>T 总功率透过比 · ν꜀ 滤波半带宽。输入、输出以毫米计；滤波面以微米计。</p></details>
      </div><div className="gs-sidebar-footer"><button className="text-button" onClick={reset}><RotateCcw size={14}/>恢复默认</button><span>{saveFailed?'本机保存不可用':'已自动保存'}</span></div></aside><div className="gs-panel-resizer" {...layout.separator}/></>}
      <main className="gs-visual"><div className="gs-toolbar"><div className="gs-toolbar-left">{!panelOpen&&<button className="icon-button" aria-label="展开左侧参数" onClick={()=>{setPanelOpen(true);if(compact)setResultsOpen(false);}}><PanelLeftOpen size={17}/></button>}<span className="gfocus-view-title">二维光路</span></div><div className="gs-toolbar-right"><button className="icon-button" aria-label="撤销4f参数" disabled={!history.past.length&&!preview} onClick={()=>{finish();dispatch({type:'undo'});}}><Undo2 size={16}/></button><button className="icon-button" aria-label="重做4f参数" disabled={!history.future.length} onClick={()=>{finish();dispatch({type:'redo'});}}><Redo2 size={16}/></button>{!resultsOpen&&<button className="gs-spot-toggle" aria-label="展开滤波结果" onClick={()=>{setResultsOpen(true);if(compact)setPanelOpen(false);}}><ScanLine size={15}/>结果</button>}</div></div>
        <div className="gs-plot fourier-stage"><FourFApparatus p={p} annotations={annotations} onStart={start} onChange={change} onFinish={finish}/></div><div className="gs-visual-footer"><span>拖边缘改 a · 拖滤波片改 c · 拖输出面改 f</span><span>两镜间距 2f</span></div>
      </main>
      {resultsOpen&&<><div className="gs-panel-resizer" {...layout.results.separator}/><aside className="gs-sidebar gfocus-results" style={{width:layout.results.width}} aria-label="滤波结果"><div className="gs-sidebar-title"><h2>滤波结果</h2><button className="icon-button" aria-label="收起滤波结果" onClick={()=>setResultsOpen(false)}><X size={17}/></button></div><div className="gs-sidebar-scroll">
        <FourFScreen p={p} b={b} annotations={annotations} viewRadius={viewRadius} zoom={zoom} onZoom={adjustZoom} onFit={fitScreen} onStart={start} onChange={v=>change('observationMm',v)} onFinish={finish}/>
        <section className="gs-readouts gfocus-main-readouts"><div className="gs-primary-reading gs-tone-output"><small>{label('transmission','透过功率比','T')}</small><strong data-testid="4f-transmission">{fmt(b.transmission*100)}<span> %</span></strong></div><div className="gs-primary-reading gs-tone-screen"><small>{label('intensity','观察点光强','I / Iᵢₙ(0)')}</small><strong data-testid="4f-intensity">{fmt(b.observation)}</strong></div></section>
        <section className="gs-readouts"><dl><div><dt>{label('cutoffFrequency','滤波半带宽','ν꜀')}</dt><dd data-testid="4f-bandwidth">{p.filterMode===2?'—':fmt(b.cutoffFrequency)} mm⁻¹</dd></div><div><dt>成像比例</dt><dd>−1 倍</dd></div></dl></section>
        <details className="fourier-details fourier-curve"><summary>输入与输出曲线</summary><svg viewBox="0 0 240 145" aria-label="输入与输出同一亮度基准的光强曲线"><path d="M25 12V114H228" stroke="#aebfd0" fill="none"/>{[0,.5,1].map(t=><g key={t}><line x1={25} x2={228} y1={114-t*98} y2={114-t*98} stroke="#e5ecf3"/><text x={20} y={118-t*98} textAnchor="end">{t}</text></g>)}<polyline points={curve.map((q,i)=>`${25+i/400*203},${114-q.input*98}`).join(' ')} fill="none" stroke="#8d9fb1" strokeWidth={1.2}/><polyline data-testid="4f-output-curve" points={curve.map((q,i)=>`${25+i/400*203},${114-q.output*98}`).join(' ')} fill="none" stroke="#8a5eac" strokeWidth={1.6}/>{visible(p.observationMm)&&<circle cx={25+(p.observationMm/viewRadius+1)*101.5} cy={114-b.observation*98} r={3} fill="#26836a"/>}<text x={25} y={129}>−{fmt(viewRadius)}</text><text x={228} y={129} textAnchor="end">{fmt(viewRadius)}</text><text x={130} y={144} textAnchor="middle">x′ / mm</text></svg><p>灰色：输入 · 紫色：输出</p></details>
        <div className="fourier-insight">{p.filterMode===2?'全通时，输出为等大小倒像。':Math.abs(p.filterOffsetUm)<1e-8?(p.filterMode===0?'保留中心频谱，条纹变平滑。':'挡住中心频谱，留下较高频率。'):'移动滤波片，选择不同频谱分量。'}</div>
        <details className="fourier-details"><summary>模型说明</summary><p>两片等焦距透镜构成 4f 系统，滤波片固定在公共焦面。两镜间距 2f；输入与输出各距相邻透镜 f。全通时等大小倒像，本例输入对称。</p><p>变换光场振幅，乘滤波片透过函数，再经第二片透镜变换得到输出。狭缝只让宽 a 的频谱通过；挡片遮住这一段，其他频谱通过。</p><p>这是横向一维滤波，另一方向保持高斯形状。输入、输出共用输入中心光强基准，屏面用平方根提亮，读数与曲线为真实光强；T 为完整平面总功率比。w 是1/e²光强半径，a 是全宽。</p><p>忽略有限镜片口径、像差与离焦。可复制当前装置到光路搭建；满足 4f 间距与共轴条件时，搭建页也显示滤波后的输出。</p><a href="https://qiweb.tudelft.nl/aoi/coherentimaging/coherentimaging/" target="_blank" rel="noreferrer">物理依据 ↗</a></details>
      </div></aside></>}
    </div><div className="gs-model-strip"><span>光路为示意 · 滤波面以微米计</span><span>输入 → 频谱滤波 → 输出</span></div>
    {formulaOpen&&<SceneFormulaSheet state={fourFState(p)} onClose={()=>setFormulaOpen(false)}/>}
    {assistantOpen&&<aside className="gs-drawer gs-assistant" aria-label="场景AI助手"><button className="gs-assistant-close icon-button" aria-label="关闭场景AI助手" onClick={onCloseAssistant}><X size={18}/></button><AssistantPanel sceneState={fourFState(p)} editing={gesture.current||preview!==null} onApplyScene={applyAssistant} onRestoreScene={restoreAssistant}/></aside>}
    {notice&&<div className="gs-notice" role="status">{notice}<button className="icon-button" aria-label="关闭提示" onClick={()=>setNotice('')}><X size={15}/></button></div>}
  </section>;
}

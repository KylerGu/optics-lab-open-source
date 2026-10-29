import SceneAssistantToggle from './SceneAssistantToggle';
import { useCallback, useEffect, useId, useReducer, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { BookOpen, ChevronLeft, Copy, Maximize, Minus, PanelLeftClose, PanelLeftOpen, Plus, Redo2, RotateCcw, ScanLine, Settings2, Undo2, X } from 'lucide-react';
import { DEFAULT_MICHELSON, MICHELSON_DRAFT_KEY, MICHELSON_FIELDS, MICHELSON_SCENE_ID, parseMichelson, michelsonHistory, michelsonState, michelson, michelsonTarget, type MichelsonHistory, type MichelsonParameters } from './michelson';
import AssistantPanel from './AssistantPanel';
import { youngLightColor } from './youngDoubleSlit';
import SceneFormulaSheet from './SceneFormulaSheet';
import { useScenePanelWidth } from './useScenePanelWidth';
import { type SceneState, sceneKey } from './sceneRuntime';
import { MICHELSON_DEVICE_FIELDS, MICHELSON_DEVICE_NAMES, type MichelsonDevice, type MichelsonPath } from './MichelsonApparatus';
import { michelsonBuilderCopy } from './michelsonBuilderCopy';
import type { SpatialExperiment } from './builderModel';
import { MICHELSON_QUANTITIES, MICHELSON_PARAMETER_MEANINGS, type MichelsonAnnotation } from './michelsonAnnotations';
import './gaussian-scene.css';
import './gaussian-focus.css';
import './resonator-scene.css';
import './michelson-scene.css';
import Michelson3D from './Michelson3D';

type Field = keyof MichelsonParameters;
type Annotation = MichelsonAnnotation;
const ANNOTATIONS=Object.keys(MICHELSON_QUANTITIES) as Annotation[];
const DEFAULT_ANNOTATIONS:Annotation[]=['observationRadiusMm','arm1Mm','arm2Mm','intensity'];
const ANNOTATION_KEY='optics-michelson-annotations:v3';
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const fmtMm = (n:number) => Number(n.toFixed(6)).toString();
const fmt = (n: number) => Math.abs(n) < 1e-10 ? '0' : Math.abs(n) < .0001 ? n.toExponential(3) : Number(n.toFixed(4)).toString();
function readMichelson() {
  try { const stored = localStorage.getItem(MICHELSON_DRAFT_KEY); if (stored) { const s = JSON.parse(stored); if (s.version === 1 && s.sceneId === MICHELSON_SCENE_ID) return parseMichelson({...DEFAULT_MICHELSON,...s.parameters}); } } catch { /* Fall back to a valid scene. */ }
  return { ...DEFAULT_MICHELSON };
}
function readAnnotations(): Annotation[] {
  try {
    const stored=localStorage.getItem(ANNOTATION_KEY);
    if(stored){const a=JSON.parse(stored);if(Array.isArray(a))return a.filter((k):k is Annotation=>ANNOTATIONS.includes(k));}
    const legacy=JSON.parse(localStorage.getItem('optics-michelson-annotations:v2')??localStorage.getItem('optics-michelson-annotations:v1')??'null');
    if(Array.isArray(legacy))return DEFAULT_ANNOTATIONS.filter(k=>legacy.includes(k));
  } catch { /* Optional preferences. */ }
  return [...DEFAULT_ANNOTATIONS];
}
function QuantityLabel({ label, symbol, active, onClick, quantity }: { label: string; symbol: string; active: boolean; onClick: () => void; quantity:Annotation }) {
  const q=MICHELSON_QUANTITIES[quantity];
  return <button type="button" className="resonator-quantity-label" data-quantity={quantity} style={{'--quantity-color':q.color} as CSSProperties} aria-label={label} aria-pressed={active} title={`${q.meaning} ${active?'点击隐藏图中标注。':'点击显示图中标注。'}`} onClick={onClick}>{label}<i className="gs-quantity-symbol">{symbol}</i></button>;
}
function Parameter({ field, value, change, start, finish, marked, toggle }: { field: typeof MICHELSON_FIELDS[number]; value: number; change: (v: number) => void; start: () => void; finish: () => void; marked: boolean; toggle?: () => void }) {
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
  return <div className={`gs-parameter gs-tone-${field.tone}`} style={toggle?{'--quantity-color':MICHELSON_QUANTITIES[field.key as Annotation].color} as CSSProperties:undefined}>
    <div className="resonator-parameter-line">{toggle ? <QuantityLabel quantity={field.key as Annotation} label={field.label} symbol={field.symbol} active={marked} onClick={toggle}/> : <span className="resonator-quantity-text" title={MICHELSON_PARAMETER_MEANINGS[field.key]}>{field.label}<i className="gs-quantity-symbol">{field.symbol}</i></span>}<div className="gs-number"><input type="number" aria-label={field.label} aria-invalid={error} min={field.min} max={field.max} step={field.step} value={draft} onChange={e => { setDraft(e.target.value); setError(false); }} onBlur={submit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/><span>{field.unit}</span></div></div>
    <input type="range" aria-label={field.label + '滑杆'} min={field.min} max={field.max} step={field.step} value={value} style={{ '--range-fill': `${fill}%` } as CSSProperties}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); start(); }} onChange={e => { start(); change(Number(e.target.value)); }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onBlur={finish} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) start(); }} onKeyUp={finish}/>
    {error && <small className="gs-error" role="alert">请输入 {field.min}–{field.max} {field.unit}。</small>}
  </div>;
}

export default function MichelsonScene({ onDirectory, assistantOpen, onCloseAssistant, onCopy }: { onDirectory: () => void; assistantOpen: boolean; onCloseAssistant: () => void; onCopy:(experiment:SpatialExperiment)=>void }) {
  const [initial] = useState(readMichelson);
  const [history, dispatch] = useReducer(michelsonHistory, { past: [], present: initial, future: [] } as MichelsonHistory);
  const [preview, setPreview] = useState<MichelsonParameters | null>(null);
  const p = preview ?? history.present, latest = useRef(p); latest.current = p;
  const pending = useRef<MichelsonParameters | null>(null), gesture = useRef(false), raf = useRef<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(true), [resultsOpen, setResultsOpen] = useState(true), [formulaOpen, setFormulaOpen] = useState(false);
  const [annotations, setAnnotations] = useState(readAnnotations);
  const [zoom, setZoom] = useState(1);
  const [device,setDevice]=useState<MichelsonDevice>('mirror2'),[apparatusView,setApparatusView]=useState<'perspective'|'top'>('perspective'),[path,setPath]=useState<MichelsonPath>('both');
  const [viewReset,setViewReset]=useState(0);
  const [reference,setReference]=useState(initial);
  const [notice, setNotice] = useState(''), [saveFailed, setSaveFailed] = useState(false), [resetVersion, setResetVersion] = useState(0);
  const root = useRef<HTMLElement>(null), workspace = useRef<HTMLDivElement>(null), plot = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const layout = useScenePanelWidth(workspace, resultsOpen, panelOpen,{onLeftClose:()=>setPanelOpen(false),onRightClose:()=>setResultsOpen(false),resultKey:'optics-michelson-result-width:v1',resultDefault:400,resultMin:300});
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
  const label = (key: Annotation, title: string, symbol: string) => <QuantityLabel quantity={key} label={title} symbol={symbol} active={marked(key)} onClick={() => toggle(key)}/>;
  useEffect(()=>{setAnnotations(readAnnotations());},[]);
  useEffect(() => { try { localStorage.setItem(ANNOTATION_KEY, JSON.stringify(annotations)); } catch { /* Optional preferences. */ } }, [annotations]);
  useEffect(() => { try { localStorage.setItem(MICHELSON_DRAFT_KEY, JSON.stringify(michelsonState(history.present))); setSaveFailed(false); } catch { setSaveFailed(true); } }, [history.present]);
  useEffect(() => () => { if (raf.current !== null) cancelAnimationFrame(raf.current); }, []);
  useEffect(() => { const el = plot.current; if (!el) return; const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; if (width > 0 && height > 0) setSize({ width, height }); }); observer.observe(el); return () => observer.disconnect(); }, [resultsOpen]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as Element)?.closest('input,textarea,select,[contenteditable=true]') || document.querySelector('dialog[open]')) return;
      if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); finish(); dispatch({ type: e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo' }); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [finish]);

  const b=michelson(p),width=Math.max(240,size.width);
  const opticalReadingRows=Number(marked('axisDeltaUm'))+Number(marked('deltaUm'));
  const R=Math.max(70,Math.min(145,(width-64)/2));
  const cx=width/2,cy=R+38,viewRadius=12/zoom;
  const height=cy+R+68+opticalReadingRows*22+90+50;
  const rr=(r:number)=>r/viewRadius*R,visible=p.observationRadiusMm<=viewRadius,pointX=cx+rr(p.observationRadiusMm);
  const curveLeft=cx-R,curveRight=cx+R,curveTop=cy+R+68+opticalReadingRows*22,curveHeight=90;
  const curveX=(r:number)=>curveLeft+r/viewRadius*2*R,curveY=(I:number)=>curveTop+(1-I)*curveHeight;
  const count=Math.max(300,Math.ceil(R*2)),rgb=youngLightColor(p.wavelengthNm);
  const rings=Array.from({length:count},(_,i)=>{const outer=R*(1-i/count);let I=0;for(let j=0;j<4;j++)I+=b.at(viewRadius*(1-(i+(j+.5)/4)/count)).intensity/4;return {radius:outer,color:`rgb(${rgb.map(c=>Math.round(7+(c-7)*Math.sqrt(I))).join(',')})`};});
  const curveSamples=Math.max(401,Math.ceil(R*4));
  const curve=Array.from({length:curveSamples},(_,i)=>{const r=viewRadius*i/(curveSamples-1);return `${curveX(r)},${curveY(b.at(r).intensity)}`;}).join(' ');
  const drag=useRef<{id:number;field:'observationRadiusMm';x:number;y:number;value:number;scale:number}|null>(null);
  const startDrag=(e:ReactPointerEvent<SVGGElement>,field:'observationRadiusMm')=>{
    if(e.button!==0)return;e.preventDefault();e.stopPropagation();e.currentTarget.focus();start();
    drag.current={id:e.pointerId,field,x:e.clientX,y:e.clientY,value:latest.current[field],scale:R/viewRadius};svg.current?.setPointerCapture(e.pointerId);
  };
  const endDrag=()=>{finish();drag.current=null;};
  const keyboard=(e:React.KeyboardEvent<SVGGElement>,field:'observationRadiusMm')=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();start();const f=MICHELSON_FIELDS.find(f=>f.key===field)!;
    change(field,clamp(latest.current[field]+(['ArrowUp','ArrowRight'].includes(e.key)?1:-1)*f.step*(e.shiftKey?10:1),f.min,f.max));finish();
  };
  const sliderProps=(field:'observationRadiusMm',title:string)=>({role:'slider',tabIndex:0,'aria-label':title,'aria-valuemin':0,'aria-valuemax':12,'aria-valuenow':p[field],onPointerDown:(e:ReactPointerEvent<SVGGElement>)=>startDrag(e,field),onKeyDown:(e:React.KeyboardEvent<SVGGElement>)=>keyboard(e,field)});
  const zoomTo=(factor:number)=>setZoom(z=>clamp(z*factor,.5,4));
  const wheelHandler=useRef<(e:WheelEvent)=>void>(()=>{});wheelHandler.current=e=>{e.preventDefault();zoomTo(Math.exp(-e.deltaY*.0015));};
  useEffect(()=>{const el=plot.current;if(!el)return;const wheel=(e:WheelEvent)=>wheelHandler.current(e);el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);},[resultsOpen]);
  const applyAssistant=(state:SceneState)=>{
    if(state.sceneId!==MICHELSON_SCENE_ID||gesture.current||document.activeElement?.matches('.michelson-scene .gs-parameter input'))return false;
    try{const next=parseMichelson(state.parameters);dispatch({type:'commit',parameters:next});if(next.observationRadiusMm>viewRadius)setZoom(1);return true;}catch{return false;}
  };
  const restoreAssistant=(before:SceneState,after:SceneState)=>{
    if(gesture.current||sceneKey(michelsonState(latest.current))!==sceneKey(after))return false;
    const previous=history.past.at(-1);if(previous&&sceneKey(michelsonState(previous))===sceneKey(before)){dispatch({type:'undo'});return true;}return applyAssistant(before);
  };
  const reset=()=>{finish();dispatch({type:'commit',parameters:{...DEFAULT_MICHELSON}});setReference({...DEFAULT_MICHELSON});setViewReset(n=>n+1);setZoom(1);setAnnotations([...DEFAULT_ANNOTATIONS]);setResetVersion(v=>v+1);};
  const selectedField=MICHELSON_DEVICE_FIELDS[device],mirrorField=device==='mirror1'?'mirror1MoveUm':'mirrorMoveUm';
  const stepMirror=(multiple:number)=>{finish();dispatch({type:'commit',parameters:{...latest.current,[mirrorField]:clamp(latest.current[mirrorField]+multiple*p.wavelengthNm/1000,-1,1)}});};
  const target=(kind:'bright'|'dark')=>{finish();dispatch({type:'commit',parameters:{...latest.current,mirrorMoveUm:michelsonTarget(latest.current,kind)}});};
  const baseline=michelson({...p,baseDifferenceUm:reference.baseDifferenceUm,mirrorMoveUm:reference.mirrorMoveUm,mirror1MoveUm:reference.mirror1MoveUm});
  const changeDelta=b.observation.deltaUm-baseline.observation.deltaUm;
  const deviceHelp:Record<MichelsonDevice,string>={mirror1:'向外移镜，第二臂与第一臂的长度差减小。',mirror2:'向外移镜，第二臂与第一臂的长度差增大。',source:'沿入射光路移动，条纹亮暗不变。',lens:'沿出射光路移动，观察屏跟随透镜。',splitter:'固定在两臂交点，分光并汇合两路返回光。',compensator:'平衡两路穿过玻璃的光程，本场景按理想补偿处理。',screen:'位于透镜后方一个焦距处，圆环显示在右侧。'};

  return <section ref={root} className={`gaussian-scene gaussian-focus-scene michelson-scene ${layout.resizing?'gs-panel-resizing':''}`} aria-label="迈克耳孙干涉仪场景">
    <div className="gs-heading"><div className="gs-title"><button className="icon-button" aria-label="返回仿真场景库" onClick={onDirectory}><ChevronLeft size={20}/></button><h1>迈克耳孙干涉仪</h1></div><div className="gs-heading-actions"><SceneAssistantToggle/><button className="gs-copy-button" title="复制当前器件位置、波长、分光比例和焦距；搭建页计算几何光路，圆环分析保留在本场景" onClick={()=>{finish();onCopy(michelsonBuilderCopy(latest.current));}}><Copy size={16}/>复制到光路搭建</button><button className="outline-button" aria-haspopup="dialog" aria-expanded={formulaOpen} onClick={()=>{finish();setFormulaOpen(true);}}><BookOpen size={15}/>相关公式</button><button className="icon-button" aria-label="全屏查看场景" onClick={()=>void(document.fullscreenElement?document.exitFullscreen():root.current?.requestFullscreen())?.catch(()=>setNotice('浏览器未开启全屏。'))}><Maximize size={18}/></button></div></div>
    <div ref={workspace} className="gs-workspace">
      {panelOpen&&<><aside className="gs-sidebar" style={{width:layout.width}} aria-label="迈克耳孙参数"><div className="gs-sidebar-title"><h2><Settings2 size={16}/>参数调节</h2><button className="icon-button" aria-label="收起左侧参数" onClick={()=>setPanelOpen(false)}><PanelLeftClose size={17}/></button></div><div className="gs-sidebar-scroll">
        {[{title:'光源与镜臂',keys:['wavelengthNm','baseDifferenceUm']},{title:'装置操作',keys:selectedField?[selectedField]:[]},{title:'观察位置',keys:['focalLengthMm','observationRadiusMm']}].map(section=><section key={section.title}><h3>{section.title}</h3>{section.title==='装置操作'&&<><select className="michelson-device-select" aria-label="选择操作器件" value={device} onChange={e=>{finish();setDevice(e.target.value as MichelsonDevice);}}>{Object.entries(MICHELSON_DEVICE_NAMES).map(([id,title])=><option key={id} value={id}>{title}</option>)}</select><p className="michelson-device-hint">{deviceHelp[device]}</p></>}{MICHELSON_FIELDS.filter(f=>section.keys.includes(f.key)).map(f=><Parameter key={f.key+resetVersion} field={f} value={p[f.key]} change={value=>change(f.key,value)} start={start} finish={finish} marked={marked(f.key as Annotation)} toggle={ANNOTATIONS.includes(f.key as Annotation)?()=>toggle(f.key as Annotation):undefined}/>)}
          {section.title==='装置操作'&&['mirror1','mirror2'].includes(device)&&<div className="gs-presets">{[{title:'−λ/4',step:-.25},{title:'+λ/4',step:.25},{title:'+λ/2',step:.5}].map(t=><button key={t.title} disabled={p[mirrorField]+t.step*p.wavelengthNm/1000< -1||p[mirrorField]+t.step*p.wavelengthNm/1000>1} onClick={()=>stepMirror(t.step)}>{t.title}</button>)}</div>}
          {section.keys.includes('observationRadiusMm')&&<div className="gs-presets"><button onClick={()=>target('bright')}>调到亮环</button><button onClick={()=>target('dark')}>调到暗环</button><button onClick={()=>{finish();dispatch({type:'commit',parameters:{...latest.current,baseDifferenceUm:0,mirrorMoveUm:0,mirror1MoveUm:0}});}}>两臂等长</button></div>}
        </section>)}

      </div><div className="gs-sidebar-footer"><button className="text-button" onClick={reset}><RotateCcw size={14}/>恢复默认</button><span>{saveFailed?'本机保存不可用':'已自动保存'}</span></div></aside><div className="gs-panel-resizer" {...layout.separator}/></>}
      <main className="gs-visual"><div className="gs-toolbar"><div className="gs-toolbar-left">{!panelOpen&&<button className="icon-button" aria-label="展开左侧参数" onClick={()=>setPanelOpen(true)}><PanelLeftOpen size={17}/></button>}<div className="michelson-view-switch" aria-label="装置视图">{[{key:'perspective',title:'立体装置'},{key:'top',title:'俯视光路'}].map(v=><button key={v.key} aria-pressed={apparatusView===v.key} onClick={()=>{finish();setApparatusView(v.key as 'perspective'|'top');}}>{v.title}</button>)}</div></div><div className="gs-toolbar-right"><button className="icon-button" aria-label="撤销迈克耳孙参数" disabled={!history.past.length&&!preview} onClick={()=>{finish();dispatch({type:'undo'});}}><Undo2 size={16}/></button><button className="icon-button" aria-label="重做迈克耳孙参数" disabled={!history.future.length} onClick={()=>{finish();dispatch({type:'redo'});}}><Redo2 size={16}/></button>{!resultsOpen&&<button className="gs-spot-toggle" aria-label="展开干涉结果" onClick={()=>setResultsOpen(true)}><ScanLine size={15}/>结果</button>}</div></div>
        <div className="gs-plot michelson-center" data-testid="michelson-3d-stage">
          <div className="michelson-path-switch" aria-label="选择显示光路">{[{key:'both',title:'两路光路'},{key:'arm1',title:'经 M₁'},{key:'arm2',title:'经 M₂'}].map(t=><button key={t.key} aria-pressed={path===t.key} onClick={()=>setPath(t.key as MichelsonPath)}>{t.title}</button>)}</div>
          <Michelson3D p={p} view={apparatusView} reset={viewReset} path={path} selected={device} annotations={annotations} onSelect={setDevice} onStart={start} onChange={change} onFinish={finish}/>
        </div><div className="gs-visual-footer"><span>拖空白旋转 · 滚轮缩放 · 拖器件沿光路移动</span><button className="text-button" onClick={()=>setViewReset(n=>n+1)}><RotateCcw size={15}/>复位视角</button></div>
      </main>
      {resultsOpen&&<><div className="gs-panel-resizer" {...layout.results.separator}/><aside className="gs-sidebar gfocus-results" style={{width:layout.results.width}} aria-label="干涉结果"><div className="gs-sidebar-title"><h2>干涉结果</h2><button className="icon-button" aria-label="收起干涉结果" onClick={()=>setResultsOpen(false)}><X size={17}/></button></div><div className="gs-sidebar-scroll">
        <div ref={plot} className="gs-plot michelson-results-plot" style={{height}}>
          <svg ref={svg} viewBox={`0 0 ${width} ${height}`} data-testid="michelson-plot" data-radius-mm={viewRadius} aria-label="等倾圆环与径向光强曲线" onPointerMove={e=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;const f=MICHELSON_FIELDS.find(f=>f.key===d.field)!;const next=d.value+(e.clientX-d.x)/d.scale;change(d.field,Number(clamp(next,f.min,f.max).toFixed(6)));}} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
            <defs><marker id={`${uid}-blue`} markerWidth={7} markerHeight={7} refX={5} refY={3} orient="auto"><path d="M0 0L6 3L0 6" fill="none" stroke="#357fc6"/></marker><marker id={`${uid}-orange`} markerWidth={7} markerHeight={7} refX={5} refY={3} orient="auto"><path d="M0 0L6 3L0 6" fill="none" stroke="#c16b37"/></marker><clipPath id={`${uid}-curve`}><rect x={curveLeft-5} y={curveTop-5} width={2*R+10} height={curveHeight+10}/></clipPath></defs>
            <text className="michelson-title" x={cx} y={cy-R-21} textAnchor="middle">观察屏 · 等倾圆环</text>
            <g data-testid="michelson-rings">{rings.map((t,i)=><circle key={i} cx={cx} cy={cy} r={t.radius} fill={t.color}/>)}</g><circle cx={cx} cy={cy} r={R} fill="none" stroke="#ccd8e4"/>
            {visible&&<g>
              {marked('observationRadiusMm')&&<g data-testid="michelson-annotation-observationRadiusMm" pointerEvents="none">
                {p.observationRadiusMm>0&&<><line x1={cx} x2={pointX} y1={cy} y2={cy} stroke="#dceee6" strokeWidth={1.6}/><line x1={cx} x2={cx} y1={cy-4} y2={cy+4} stroke="#dceee6"/><line x1={pointX} x2={pointX} y1={cy-4} y2={cy+4} stroke="#dceee6"/><circle cx={cx} cy={cy} r={2.5} fill="#dceee6"/><text className="michelson-screen-label" x={cx-7} y={cy+20} textAnchor="end">圆心</text></>}
                <text className="michelson-screen-label" x={cx} y={cy-R+20} textAnchor="middle">观察半径 r = {fmt(p.observationRadiusMm)} mm</text>
              </g>}
              <g className="michelson-observation-handle" {...sliderProps('observationRadiusMm','图中观察半径')}>
                <circle cx={pointX} cy={cy} r={12} fill="transparent"/>
                <circle data-testid="michelson-observation-point" cx={pointX} cy={cy} r={5} fill="#26836a" stroke="#fff" strokeWidth={1.4}/>
                <text className="michelson-screen-label" x={pointX-9} y={cy-13} textAnchor="end">{p.observationRadiusMm===0?'观察点 · 圆心':'观察点'}</text>
              </g>
            </g>}
            {marked('axisDeltaUm')&&<g data-testid="michelson-annotation-axisDeltaUm" pointerEvents="none"><circle cx={cx} cy={cy} r={9} fill="none" stroke="#dceee6" strokeDasharray="3 2"/><text className="michelson-diagram-reading" x={cx} y={cy+R+52} textAnchor="middle">圆心光程差 δ₀ = {fmt(b.axis.deltaUm)} μm</text></g>}
            {marked('deltaUm')&&visible&&<g data-testid="michelson-annotation-deltaUm" pointerEvents="none"><circle cx={pointX} cy={cy} r={9} fill="none" stroke="#dceee6"/><text className="michelson-diagram-reading" x={cx} y={cy+R+52+(marked('axisDeltaUm')?22:0)} textAnchor="middle">观察点光程差 δ = {fmt(b.observation.deltaUm)} μm</text></g>}
            <path d={`M${cx-R} ${cy+R+17}H${cx+R} M${cx-R} ${cy+R+13}V${cy+R+21} M${cx} ${cy+R+13}V${cy+R+21} M${cx+R} ${cy+R+13}V${cy+R+21}`} stroke="#bacbdf" fill="none"/>
            <text x={cx-R} y={cy+R+34} textAnchor="middle">−{fmt(viewRadius)}</text><text x={cx} y={cy+R+34} textAnchor="middle">0</text><text x={cx+R} y={cy+R+34} textAnchor="middle">{fmt(viewRadius)} mm</text>
            <text className="gs-axis-label" x={curveLeft} y={curveTop-10}>相对光强 I / Iₘₐₓ</text>
            {[0,.5,1].map(I=><g key={I}><line className="gs-grid" x1={curveLeft} x2={curveRight} y1={curveY(I)} y2={curveY(I)}/><text x={curveLeft-8} y={curveY(I)+4} textAnchor="end">{I}</text></g>)}
            <g clipPath={`url(#${uid}-curve)`}><polyline data-testid="michelson-intensity-curve" points={curve} fill="none" stroke="#8a5eac" strokeWidth={2}/>{visible&&<>
              {marked('observationRadiusMm')&&<line x1={curveX(p.observationRadiusMm)} x2={curveX(p.observationRadiusMm)} y1={curveTop} y2={curveTop+curveHeight} stroke="#26836a" strokeDasharray="4 4"/>}
              {marked('intensity')&&<g data-testid="michelson-annotation-intensity"><line x1={curveLeft} x2={curveX(p.observationRadiusMm)} y1={curveY(b.observation.intensity)} y2={curveY(b.observation.intensity)} stroke="#8a5eac" strokeDasharray="4 4"/><circle data-testid="michelson-intensity-point" data-intensity={b.observation.intensity} cx={curveX(p.observationRadiusMm)} cy={curveY(b.observation.intensity)} r={4} fill="#8a5eac" stroke="#fff"/></g>}
            </>}</g>
            {[0,viewRadius/2,viewRadius].map(r=><text key={r} x={curveX(r)} y={curveTop+curveHeight+20} textAnchor="middle">{fmt(r)}</text>)}<text className="gs-axis-label" x={curveRight} y={curveTop+curveHeight+40} textAnchor="end">观察半径 r / mm →</text>
          </svg>
          {!visible&&<button className="gs-outside-screen" onClick={()=>setZoom(1)}>观察点在视野外 · 定位</button>}
        </div><div className="michelson-ring-tools"><button className="icon-button" aria-label="缩小圆环图" disabled={zoom<=.5} onClick={()=>zoomTo(1/1.35)}><Minus size={16}/></button><span>圆环 {fmt(zoom)}×</span><button className="icon-button" aria-label="放大圆环图" disabled={zoom>=4} onClick={()=>zoomTo(1.35)}><Plus size={16}/></button></div>
        <section className="gs-readouts gfocus-main-readouts"><div className="gs-primary-reading gs-tone-output"><small>{label('intensity','观察点相对光强','I / Iₘₐₓ')}</small><strong data-testid="michelson-intensity">{fmt(b.observation.intensity)}</strong></div><div className="gs-primary-reading gs-tone-output"><small>{label('differenceUm','两臂长度差','ΔL')}</small><strong data-testid="michelson-difference">{fmt(b.differenceUm)}<span> μm</span></strong></div><p className="michelson-status" data-testid="michelson-status">{b.status}</p></section>
        <details className="michelson-details"><summary>亮暗对比</summary><section className="gs-readouts michelson-comparison"><div className="michelson-compare-bar"><span>基准</span><div><i style={{width:`${baseline.observation.intensity*100}%`}}/></div><b data-testid="michelson-baseline-intensity">{fmt(baseline.observation.intensity)}</b></div><div className="michelson-compare-bar is-current"><span>现在</span><div><i style={{width:`${b.observation.intensity*100}%`}}/></div><b>{fmt(b.observation.intensity)}</b></div><button className="text-button" title="以当前镜位为基准，比较同一观察点的亮暗变化" onClick={()=>{finish();setReference({...latest.current});}}>设为基准</button></section></details>
        <details className="michelson-details"><summary>镜臂长度</summary><section className="gs-readouts"><dl><div><dt>{label('arm1Mm','第一臂长度','L₁')}<small>分光镜到第一反射镜</small></dt><dd data-testid="michelson-arm1-length">{fmtMm(b.arm1Mm)} mm</dd></div><div><dt>{label('arm2Mm','第二臂长度','L₂')}<small>分光镜到第二反射镜</small></dt><dd data-testid="michelson-arm2-length">{fmtMm(b.arm2Mm)} mm</dd></div></dl></section></details>
        <details className="michelson-details"><summary>更多读数</summary><section className="gs-readouts"><dl>
          <div><dt>{label('axisDeltaUm','圆心光程差','δ₀')}<small>圆心处的两路光程差，δ₀ = 2ΔL</small></dt><dd data-testid="michelson-axis-delta">{fmt(b.axis.deltaUm)} μm</dd></div>
          <div><dt>{label('deltaUm','观察点光程差','δ')}<small>所选观察点处的两路光程差</small></dt><dd data-testid="michelson-delta">{fmt(b.observation.deltaUm)} μm</dd></div>
          <div><dt>光程差变化</dt><dd data-testid="michelson-change-delta">{changeDelta>0?'+':''}{fmt(changeDelta)} μm</dd></div>
          <div><dt>光程差 / 波长<small>整数时亮，半整数时暗</small></dt><dd data-testid="michelson-cycles">{fmt(b.observation.cycles)}</dd></div>
          <div><dt>圆心条纹变化 <i className="gs-quantity-symbol">N</i><small>从初始镜位算起，1 表示一个亮暗周期</small></dt><dd data-testid="michelson-fringe-shift">{fmt(b.fringeShift)}</dd></div>
          <div><dt>一个亮暗周期的移镜量<small>只移动一面镜子：λ / 2</small></dt><dd>{fmt(b.oneFringeMoveUm)} μm</dd></div>
        </dl></section></details>
        <details className="michelson-details"><summary>模型条件</summary><p>单色光，两路等强、同偏振；两镜等效平行，玻璃光程已补偿。</p><p>观察屏在透镜后方一个焦距处；未考虑镜面倾斜。</p><p>移镜距离在装置中放大显示，读数与圆环使用真实数值。</p></details>
      </div></aside></>}
    </div><div className="gs-model-strip"><span>点击带下划线的中文名称，显示或隐藏对应标注</span><span>移镜示意放大 · 圆环按毫米标尺</span></div>
    {formulaOpen&&<SceneFormulaSheet state={michelsonState(p)} onClose={()=>setFormulaOpen(false)}/>}
    {assistantOpen&&<aside className="gs-drawer gs-assistant" aria-label="场景AI助手"><button className="gs-assistant-close icon-button" aria-label="关闭场景AI助手" onClick={onCloseAssistant}><X size={18}/></button><AssistantPanel sceneState={michelsonState(p)} editing={gesture.current||preview!==null} onApplyScene={applyAssistant} onRestoreScene={restoreAssistant}/></aside>}
    {notice&&<div className="gs-notice" role="status">{notice}<button className="icon-button" aria-label="关闭提示" onClick={()=>setNotice('')}><X size={15}/></button></div>}
  </section>;
}

import {createContext,useContext,useState,type CSSProperties,type ReactNode} from 'react';
import type {SceneResult,SceneState} from './sceneRuntime';
import TelescopeSampleField from './TelescopeSampleField';
import MicroscopeDetails from './MicroscopeDetails';
import SceneValue from './SceneValue';
import {telescopeComparison,telescopeVisibleAnnotation} from './telescopeFieldPresentation';

type FieldView={reference:boolean;setReference:(value:boolean)=>void;showRange:boolean;toggleRange:()=>void;showVisible:boolean;toggleVisible:()=>void};
const Context=createContext<FieldView|null>(null);
export const useTelescopeField=()=>useContext(Context);
export function TelescopeFieldProvider({children}:{children:ReactNode}){
  const [reference,setReference]=useState(false),[showRange,setShowRange]=useState(false),[showVisible,setShowVisible]=useState(false);
  return <Context.Provider value={{reference,setReference,showRange,toggleRange:()=>setShowRange(value=>!value),showVisible,toggleVisible:()=>setShowVisible(value=>!value)}}>{children}</Context.Provider>;
}

export function TelescopeFieldObservation({state}:{state:SceneState}){
  const c=useContext(Context)!,comparison=telescopeComparison(state.parameters);
  return <div className="os-microscope-observation os-microscope-observation-field os-telescope-observation-field">
    <h3>{c.reference?'原始样品示意':'目视视野示意'}</h3>
    <div className="os-telescope-field-switch os-microscope-presentation" role="group" aria-label="视场观察方式" onPointerDown={e=>e.stopPropagation()}>
      {([[false,'目视观察'],[true,'原始样品']] as const).map(([reference,label])=><button key={label} type="button" aria-pressed={c.reference===reference} onClick={()=>c.setReference(reference)}>{label}</button>)}
    </div>
    <TelescopeSampleField state={state} reference={c.reference} framed showRange={c.showRange} showVisible={c.showVisible}/>
    <p className="os-microscope-preview-note">{c.reference?comparison?(Math.abs(comparison.M)>=1?'绿圈对应目视图中的范围。':'当前目视图覆盖范围比原图更大。'):'原始 F 样品；恢复平行出射后可比较。':'同一个远处 F 样品 · 角高度 0.6°'}</p>
  </div>;
}

export function TelescopeFieldResults({state,result}:{state:SceneState;result:SceneResult}){
  const c=useContext(Context)!,comparison=telescopeComparison(state.parameters),M=comparison?.M??null;
  const angle=c.reference?6:comparison?.skyAngle??null,metric=(key:string)=>result.metrics.find(m=>m.key===key);
  const canMarkVisible=telescopeVisibleAnnotation(state.parameters,c.reference)!==null;
  const style=(color:string)=>({'--quantity-color':color} as CSSProperties);
  return <section className="gs-readouts os-microscope-readouts os-telescope-field-results" aria-label="实时结果">
    <dl><div style={style('#8a5eac')}><dt>目视放大倍数<span className="gs-quantity-symbol">M</span></dt><dd data-testid="telescope-primary"><SceneValue value={M===null?null:Math.abs(M)} unit="倍"/></dd></div>
      <div style={style('#26836a')}><dt>{angle===null?'图中观察角宽':<button type="button" className="os-quantity-toggle" aria-label="查看图中观察角宽图示" aria-controls="telescope-field-diagram" aria-pressed={c.showRange} onClick={c.toggleRange}>图中观察角宽<span className="gs-quantity-symbol">β</span></button>}</dt><dd data-testid="telescope-metric-sky-angle"><SceneValue value={angle} unit="°"/></dd></div>
      <div style={style('#357fc6')}><dt><button type="button" className="os-quantity-toggle" aria-label="查看模型内可见角宽图示" aria-controls="telescope-field-diagram" aria-pressed={canMarkVisible&&c.showVisible} disabled={!canMarkVisible} onClick={c.toggleVisible}>模型内可见角宽<span className="gs-quantity-symbol">βᵥ</span></button></dt><dd data-testid="telescope-field-visible-angle"><SceneValue value={metric('visibleField')?.value??null} unit="°"/></dd></div>
      <div style={style('#357fc6')}><dt>物镜角分辨率<span className="gs-quantity-symbol">θᵣ</span></dt><dd data-testid="telescope-field-resolution"><SceneValue value={metric('resolution')?.value??null} unit="角秒"/></dd></div>
      <div style={style('#62748a')}><dt>望远镜成像方向</dt><dd data-testid="telescope-field-orientation">{M===null?'—':M<0?'倒像':'正像'}</dd></div>
    </dl>
    <MicroscopeDetails id="telescope-field-explanation" title="详细说明">
      <p>目视图的观察角宽 β = 6° ÷ |M|，放大倍数越大，看到的范围越小。切换“原始样品”可对照 F 的大小和方向。</p>
      <p>开普勒倒像，伽利略正像。F 的模糊程度随物镜口径、波长同步变化，采用简化示意；原始样品保持清晰。</p>
      <p>βᵥ 是镜片和眼瞳允许通光的水平角宽（限 ±3°）；β 只是画面覆盖范围。</p>
      {result.warnings.map(w=><p className="os-warning" key={w}>{w}</p>)}
    </MicroscopeDetails>
  </section>;
}

import {createContext,useContext,useState,type CSSProperties,type ReactNode} from 'react';
import type {SceneState} from './sceneRuntime';
import {telescopeOptics} from './telescopeModel';
import SceneValue,{displayNumber} from './SceneValue';
import SceneQuantityLabel from './SceneQuantityLabel';
import MicroscopeDetails from './MicroscopeDetails';
import {quantityColor} from './scenePresentation';

type Selection={selected:ReadonlySet<string>;toggle:(key:string)=>void;canMark:(key:string)=>boolean};
const Context=createContext<Selection|null>(null);
export const useTelescopeResolution=()=>useContext(Context);
export function TelescopeResolutionProvider({state,children}:{state:SceneState;children:ReactNode}){
  const [selected,setSelected]=useState<ReadonlySet<string>>(new Set());
  const p=state.parameters,r=telescopeOptics(p).resolution,extent=Math.max(r*4,p.starSeparation*.8);
  const canMark=(key:string)=>telescopeOptics(p).afocal&&['resolution','starSeparation'].includes(key)&&140*(key==='resolution'?r:p.starSeparation)/extent>=18;
  const toggle=(key:string)=>setSelected(previous=>{const next=new Set(previous);if(next.has(key))next.delete(key);else next.add(key);return next;});
  return <Context.Provider value={p.study===2?{selected,toggle,canMark}:null}>{children}</Context.Provider>;
}
export function TelescopeResolutionLabel({quantity,label}:{quantity:string;label:string}){
  const c=useTelescopeResolution(),content=<SceneQuantityLabel quantity={quantity} label={label} model="telescope"/>;
  if(!c||!['resolution','starSeparation'].includes(quantity))return content;
  return <button type="button" className="os-quantity-toggle" aria-label={`查看${quantity==='resolution'?'物镜角分辨率':'双星角间距'}图示`} aria-controls="telescope-resolution-diagram" aria-pressed={c.canMark(quantity)&&c.selected.has(quantity)} disabled={!c.canMark(quantity)} onClick={()=>c.toggle(quantity)}>{content}</button>;
}
export function TelescopeResolutionResults({state}:{state:SceneState}){
  const p=state.parameters,r=telescopeOptics(p).resolution,focused=telescopeOptics(p).afocal,resolved=p.starSeparation>=r;
  const style=(color:string)=>({'--quantity-color':color} as CSSProperties);
  return <section className="gs-readouts os-microscope-readouts" aria-label="实时结果"><dl>
    {([['resolution','物镜角分辨率',r],['starSeparation','双星角间距',p.starSeparation]] as const).map(([key,label,value])=><div key={key} style={style(quantityColor(key,'telescope'))}><dt><TelescopeResolutionLabel quantity={key} label={label}/></dt><dd data-testid={key==='resolution'?'telescope-primary':'telescope-resolution-separation'}><SceneValue value={value} unit="角秒"/></dd></div>)}
    <div style={style(resolved?'#26836a':'#c16b37')}><dt>分辨状态</dt><dd data-testid="telescope-resolution-status">{!focused?'未对焦':resolved?'达到分辨条件':'未达到分辨条件'}</dd></div>
  </dl><MicroscopeDetails id="telescope-resolution-explanation" title="详细说明">
    <p>θᵣ = 1.22 λ / Dₒ（弧度），表示对焦后的理论分辨能力，越小越好；Δθ ≥ θᵣ 时达到瑞利判据，即两颗等亮星点刚好可分辨的标准。1° = 3600 角秒。</p>
    <p>按理想圆形物镜计算，不含大气、像差和目镜遮挡。下方曲线表示双星中心连线上的亮度；光斑已提亮以显示暗环。</p>
  </MicroscopeDetails></section>;
}
export function TelescopeResolutionAnnotations({state}:{state:SceneState}){
  const c=useTelescopeResolution(),p=state.parameters,r=telescopeOptics(p).resolution,extent=Math.max(r*4,p.starSeparation*.8),left=400-70*p.starSeparation/extent;
  return <g pointerEvents="none">{(['resolution','starSeparation'] as const).filter(key=>c?.selected.has(key)&&c.canMark(key)).map(key=>{
    const value=key==='resolution'?r:p.starSeparation,a=left,b=a+140*value/extent,lane=key==='resolution'?410:385,color=quantityColor(key,'telescope'),symbol=key==='resolution'?'θᵣ':'Δθ';
    return <g key={key} data-testid={`telescope-resolution-annotation-${key}`} data-value={value}>
      <title>{symbol} = {displayNumber(value)} 角秒</title>
      <path d={`M${a} 225V${lane} M${b} 225V${lane}`} stroke={color} strokeOpacity={.45} strokeDasharray="3 4"/>
      <path d={`M${a} ${lane-4}V${lane+4} M${a} ${lane}H${b} M${b} ${lane-4}V${lane+4}`} stroke={color} strokeWidth={1.5}/>
      <text x={(a+b)/2} y={lane-7} textAnchor="middle" style={{fill:color,fontSize:13}}>{symbol}</text>
    </g>;
  })}</g>;
}

import {createContext,useContext,useState,type CSSProperties,type ReactNode} from 'react';
import type {SceneState,SceneResult} from './sceneRuntime';
import {telescopeOptics} from './telescopeModel';
import {TELESCOPE_EYE_QUANTITIES as quantities,telescopeEyeCanMark} from './telescopeEyeQuantities';
import SceneValue from './SceneValue';
import SceneQuantityLabel from './SceneQuantityLabel';
import MicroscopeDetails from './MicroscopeDetails';
type Controls={selected:ReadonlySet<string>;toggle:(key:string)=>void;canMark:(key:string)=>boolean};
const Context=createContext<Controls|null>(null);
export const useTelescopeEye=()=>useContext(Context);
export function TelescopeEyeProvider({state,children}:{state:SceneState;children:ReactNode}){
 const [selected,setSelected]=useState<ReadonlySet<string>>(new Set());
 const toggle=(key:string)=>setSelected(previous=>{const next=new Set(previous);if(next.has(key))next.delete(key);else next.add(key);return next;});
 return <Context.Provider value={state.parameters.study===3?{selected,toggle,canMark:key=>telescopeEyeCanMark(state.parameters,key)}:null}>{children}</Context.Provider>;
}
export function TelescopeEyeLabel({quantity,label}:{quantity:string;label:string}){
 const c=useTelescopeEye(),content=<SceneQuantityLabel quantity={quantity} label={quantities[quantity]?.label??label} model="telescope"/>;
 if(!c||!['pupilDiameter','pupilPosition','eyeDistance','eyeOffset','eyeDiameter'].includes(quantity))return content;
 return <button type="button" className="os-quantity-toggle" aria-label={`查看${quantities[quantity].label}图示`} aria-controls="telescope-eye-diagram" aria-pressed={c.canMark(quantity)&&c.selected.has(quantity)} disabled={!c.canMark(quantity)} onClick={()=>c.toggle(quantity)}>{content}</button>;
}
export function TelescopeEyeResults({state,result}:{state:SceneState;result:SceneResult}){
 const o=telescopeOptics(state.parameters),style=(color:string)=>({'--quantity-color':color} as CSSProperties);
 return <section className="gs-readouts os-microscope-readouts" aria-label="实时结果"><dl>
 {['pupilDiameter','pupilPosition','acceptedLight','visibleField'].map(key=>{const m=result.metrics.find(m=>m.key===key)!,q=quantities[key];return <div key={key} style={style(q.color)}><dt><TelescopeEyeLabel quantity={key} label={q.label}/></dt><dd data-testid={key==='pupilDiameter'?'telescope-primary':`telescope-metric-${key}`}><SceneValue value={m.value} unit={m.unit}/></dd></div>;})}
 <div style={style('#62748a')}><dt>出瞳类型</dt><dd>{o.pupilPosition===null?'位于无穷远':o.pupilPosition<0?'镜内虚出瞳':o.pupilPosition===0?'位于目镜处':'镜后实出瞳'}</dd></div>
 </dl><MicroscopeDetails id="telescope-eye-explanation" title="详细说明">
 <p>出瞳是从目镜后看到的通光孔径的像。眼瞳靠近并对准它，通常能接收到更多光；虚出瞳在镜内，眼睛仍留在目镜后。</p>
 <p>η 表示进入眼睛的光束比例，βᵥ 是模型内的水平通光角宽（限 ±3°）。按理想镜片计算，不代表实际视觉亮度。</p>
 {o.eyepieceLimits&&<p>当前目镜口径限制了通光范围。</p>}{result.warnings.map(w=><p key={w} className="os-warning">{w}</p>)}
 </MicroscopeDetails></section>;
}
export function TelescopeEyeAnnotations({state}:{state:SceneState}){
 const c=useTelescopeEye(),p=state.parameters,o=telescopeOptics(p),eyeX=270+p.eyeDistance*3,eyeY=300-p.eyeOffset*12,px=270+(o.pupilPosition??0)*3;
 return <g pointerEvents="none">{Object.keys(quantities).filter(key=>c?.selected.has(key)&&c.canMark(key)).map(key=>{
 const q=quantities[key],horizontal=key==='pupilPosition'||key==='eyeDistance';
 const x=key==='pupilDiameter'?px-24:key==='eyeDiameter'?eyeX+58:eyeX+98;
 const y=key==='pupilPosition'?490:535;
 const a=horizontal?270:key==='pupilDiameter'?300-o.pupilDiameter!*6:key==='eyeDiameter'?eyeY-p.eyeDiameter*6:eyeY;
 const b=horizontal?(key==='pupilPosition'?px:eyeX):key==='pupilDiameter'?300+o.pupilDiameter!*6:key==='eyeDiameter'?eyeY+p.eyeDiameter*6:300;
 return <g key={key} data-testid={`telescope-eye-annotation-${key}`}>
 <path d={horizontal?`M${a} ${y-4}V${y+4} M${a} ${y}H${b} M${b} ${y-4}V${y+4}`:`M${x-4} ${a}H${x+4} M${x} ${a}V${b} M${x-4} ${b}H${x+4}`} fill="none" stroke={q.color} strokeWidth={1.5}/>
 <path d={horizontal?`M${b} 300V${y}`:`M${key==='pupilDiameter'?px:eyeX} ${a}H${x} M${key==='pupilDiameter'?px:eyeX} ${b}H${x}`} stroke={q.color} strokeOpacity={.4} strokeDasharray="3 4"/>
 <text x={horizontal?(a+b)/2:x-9} y={horizontal?y-9:(a+b)/2} textAnchor="middle" transform={horizontal?undefined:`rotate(-90 ${x-9} ${(a+b)/2})`} style={{fill:q.color,fontSize:14}}>{q.symbol}</text>
 </g>;
 })}</g>;
}

import {createContext,useContext,useState,type ReactNode} from 'react';
import SceneQuantityLabel from './SceneQuantityLabel';
import {sceneDisplayValue} from './SceneValue';
import {MICROSCOPE_QUANTITIES,canAnnotateMicroscope,microscopeRayMeasure,type MicroscopeQuantity} from './microscopeQuantities';
import type {SceneResult,SceneState} from './sceneRuntime';
import {SceneAnswerProvider} from './SceneAnswer';
import {microscopeAnswerQuantities} from './microscopeAnswerQuantities';

type Controls={state:SceneState;result:SceneResult|null;selected:ReadonlySet<MicroscopeQuantity>;toggle:(key:MicroscopeQuantity)=>void};
const Context=createContext<Controls|null>(null);
export function MicroscopeAnnotationProvider({state,result,children}:{state:SceneState;result:SceneResult|null;children:ReactNode}){
  const [selected,setSelected]=useState<ReadonlySet<MicroscopeQuantity>>(()=>new Set());
  const toggle=(key:MicroscopeQuantity)=>setSelected(previous=>{const next=new Set(previous);if(next.has(key))next.delete(key);else next.add(key);return next;});
  return <Context.Provider value={state.sceneId==='instruments-0'?{state,result,selected,toggle}:null}><SceneAnswerProvider resolve={source=>microscopeAnswerQuantities(state,result,source,selected,toggle)}>{children}</SceneAnswerProvider></Context.Provider>;
}
export function MicroscopeQuantityLabel({quantity,label}:{quantity:string;label:string}){
  const c=useContext(Context),content=<SceneQuantityLabel model="microscope" label={label} quantity={quantity}/>;
  if(!c||!canAnnotateMicroscope(c.state,c.result,quantity))return content;
  const controls=c.state.parameters.study===0?'microscope-ray-diagram':c.state.parameters.study===2?'microscope-field-diagram':'microscope-performance-diagram';
  return <button type="button" className="os-quantity-toggle os-microscope-quantity-toggle" style={{color:MICROSCOPE_QUANTITIES[quantity].color}} aria-label={`查看${label.replace(/ [A-Za-z].*$/,'')}图示`} aria-controls={controls} aria-pressed={c.selected.has(quantity)} onClick={()=>c.toggle(quantity)}>{content}</button>;
}
export function MicroscopeDimension({quantity,a,b,value,unit='mm',outside=false,labelOffset}:{quantity:MicroscopeQuantity;a:[number,number];b:[number,number];value:number|null;unit?:string;outside?:boolean;labelOffset?:[number,number]}){
  const c=useContext(Context);
  if(!c||!c.selected.has(quantity)||!canAnnotateMicroscope(c.state,c.result,quantity))return null;
  const {symbol,color}=MICROSCOPE_QUANTITIES[quantity],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),ux=length?dx/length:1,uy=length?dy/length:0,head=Math.min(5,length/3),shown=sceneDisplayValue(value,unit),offset=labelOffset??(Math.abs(dy)>Math.abs(dx)?[12,0]:[0,-9]);
  const tip=(p:[number,number],sign:number)=>`M${p[0]+sign*ux*head-uy*4} ${p[1]+sign*uy*head+ux*4}L${p[0]} ${p[1]}L${p[0]+sign*ux*head+uy*4} ${p[1]+sign*uy*head-ux*4}`;
  return <g className="os-microscope-annotation" pointerEvents="none" data-testid={`microscope-quantity-${quantity}`} data-value={value} data-unit={unit} data-a={a.join(',')} data-b={b.join(',')}>
    <title>{symbol} = {shown.text} {shown.unit}{quantity==='resolution'?'；瑞利判据的分辨间距参考，不是当前两点间距':''}{outside?'；端点超出当前画面':''}</title>
    <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={color} strokeWidth={1.5} strokeDasharray={outside?'5 3':undefined}/>{length>=1?<path d={tip(a,1)+tip(b,-1)} stroke={color} fill="none"/>:<circle cx={a[0]} cy={a[1]} r={2} fill={color}/>}
    <text x={(a[0]+b[0])/2+offset[0]} y={(a[1]+b[1])/2+offset[1]} textAnchor="middle" style={{fill:color}}>{symbol}{value===0&&' = 0'}{outside&&<tspan style={{fontSize:11}}>（端点在图外）</tspan>}</text>
  </g>;
}
export function MicroscopeRayAnnotations({result,x,y,width,height}:{result:SceneResult;x:(n:number)=>number;y:(n:number)=>number;width:number;height:number}){
  const c=useContext(Context);if(!c)return null;
  const keys=(['u','d','v1','v','f1','f2','tubeF','focusOffset','h'] as const).filter(key=>c.selected.has(key)&&canAnnotateMicroscope(c.state,result,key));
  const cx=(n:number)=>Math.max(40,Math.min(width-40,n)),cy=(n:number)=>Math.max(50,Math.min(height-45,n)),axis=cy(y(0)),room=Math.max(height-45-axis,axis-50),direction=height-45-axis>=axis-50?1:-1,gap=Math.min(32,Math.max(18,(room-46)/Math.max(1,keys.length-1)));
  return <g className="os-microscope-ray-annotations" pointerEvents="none">{keys.map((key,i)=>{
    const m=microscopeRayMeasure(result,key);if(m.end===null)return null;
    const lane=cy(axis+direction*(46+i*gap)),a:[number,number]=m.vertical?[cx(x(m.position)-24),cy(y(0))]:[cx(x(m.start)),lane],b:[number,number]=m.vertical?[a[0],cy(y(m.end))]:[cx(x(m.end)),lane];
    const outside=m.vertical?cy(y(0))!==y(0)||cy(y(m.end))!==y(m.end)||cx(x(m.position)-24)!==x(m.position)-24:cx(x(m.start))!==x(m.start)||cx(x(m.end))!==x(m.end),color=MICROSCOPE_QUANTITIES[key].color;
    return <g key={key} data-physical-start={m.start} data-physical-end={m.end}>{!m.vertical&&<><line x1={a[0]} x2={a[0]} y1={axis} y2={lane} stroke={color} opacity={.3} strokeDasharray="3 4"/><line x1={b[0]} x2={b[0]} y1={axis} y2={lane} stroke={color} opacity={.3} strokeDasharray="3 4"/></>}<MicroscopeDimension quantity={key} a={a} b={b} value={m.value} outside={outside}/></g>;
  })}</g>;
}

import SceneQuantityLabel from './SceneQuantityLabel';
import {sceneDisplayValue} from './SceneValue';
import {APERTURE_QUANTITIES,apertureDrawable,apertureMeasure,type ApertureQuantity} from './apertureQuantities';
import type {SceneResult} from './sceneRuntime';

export function ApertureQuantityLabel({label,quantity,selected,onToggle}:{label:string;quantity:string;selected:ReadonlySet<ApertureQuantity>;onToggle:(key:ApertureQuantity)=>void}){
  const content=<SceneQuantityLabel label={label} quantity={quantity} model="aperture"/>;
  if(!apertureDrawable(quantity))return content;
  return <button type="button" className="os-quantity-toggle" style={{color:APERTURE_QUANTITIES[quantity].color}} aria-label={`查看${label}图示`} aria-pressed={selected.has(quantity)} aria-controls="aperture-ray-diagram" onClick={()=>onToggle(quantity)}>{content}</button>;
}
export default function ApertureAnnotations({result,selected,x,y,width,height}:{result:SceneResult;selected:ReadonlySet<ApertureQuantity>;x:(n:number)=>number;y:(n:number)=>number;width:number;height:number}){
  const cx=(n:number)=>Math.max(40,Math.min(width-40,n)),cy=(n:number)=>Math.max(50,Math.min(height-45,n)),axis=cy(y(0));
  const keys=[...selected],horizontal=keys.filter(k=>!apertureMeasure(result,k).vertical),vertical=keys.filter(k=>apertureMeasure(result,k).vertical),direction=height-45-axis>=axis-50?1:-1;
  const room=Math.max(height-45-axis,axis-50),gap=Math.min(30,Math.max(18,(room-46)/Math.max(1,horizontal.length-1)));
  return <g pointerEvents="none">{keys.map((key,i)=>{
    const m=apertureMeasure(result,key),{symbol,color}=APERTURE_QUANTITIES[key],shown=sceneDisplayValue(m.value,'mm');
    if(m.start===null||m.end===null||m.position===null)return <g key={key} data-testid={`aperture-quantity-${key}`}><text x={width-40} y={50+i*22} textAnchor="end" style={{fill:color}}>{symbol}：{key.endsWith('Diameter')?'无有限直径':'在无穷远'}</text></g>;
    const verticalIndex=vertical.indexOf(key),offset=(verticalIndex%2?-1:1)*(24+Math.floor(verticalIndex/2)*24),rawSide=x(m.position)+offset;
    const rawA=m.vertical?y(m.start):x(m.start),rawB=m.vertical?y(m.end):x(m.end),a=m.vertical?cy(rawA):cx(rawA),b=m.vertical?cy(rawB):cx(rawB),side=m.vertical?cx(rawSide):cy(axis+direction*(46+horizontal.indexOf(key)*gap)),outside=a!==rawA||b!==rawB||m.vertical&&side!==rawSide,lo=Math.min(a,b),hi=Math.max(a,b),head=Math.min(5,(hi-lo)/3);
    return <g key={key} data-testid={`aperture-quantity-${key}`} data-start={m.start} data-end={m.end} data-position={m.position} data-value={m.value}>
      <title>{symbol} = {shown.text} {shown.unit}{outside?'；端点超出当前画面':''}</title>
      {m.vertical?<><line x1={cx(x(m.position))} x2={side} y1={a} y2={a} stroke={color} opacity={.3} strokeDasharray="3 4"/><line x1={cx(x(m.position))} x2={side} y1={b} y2={b} stroke={color} opacity={.3} strokeDasharray="3 4"/><line x1={side} x2={side} y1={a} y2={b} stroke={color} strokeDasharray={outside?'5 3':undefined}/><path d={`M${side-4} ${lo+head}L${side} ${lo}L${side+4} ${lo+head}M${side-4} ${hi-head}L${side} ${hi}L${side+4} ${hi-head}`} fill="none" stroke={color}/><text x={side+(offset<0?-10:10)} y={(a+b)/2-5} textAnchor={offset<0?'end':'start'} className="os-angle-label" style={{fill:color}}>{symbol}</text></>:<><line x1={a} x2={a} y1={axis} y2={side} stroke={color} opacity={.3} strokeDasharray="3 4"/><line x1={b} x2={b} y1={axis} y2={side} stroke={color} opacity={.3} strokeDasharray="3 4"/><line x1={a} x2={b} y1={side} y2={side} stroke={color} strokeDasharray={outside?'5 3':undefined}/><path d={`M${lo+head} ${side-4}L${lo} ${side}L${lo+head} ${side+4}M${hi-head} ${side-4}L${hi} ${side}L${hi-head} ${side+4}`} fill="none" stroke={color}/><text x={(a+b)/2} y={side-8} textAnchor="middle" className="os-angle-label" style={{fill:color}}>{symbol}</text></>}
      {outside&&<text x={m.vertical?side:cx((a+b)/2)} y={m.vertical?cy(hi+20):side+17} textAnchor={m.vertical&&side>width/2?'end':'middle'} style={{fill:color,fontSize:11}}>端点在图外</text>}
    </g>;
  })}</g>;
}

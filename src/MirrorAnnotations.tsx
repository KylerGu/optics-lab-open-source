import SceneQuantityLabel from './SceneQuantityLabel';
import {sceneDisplayValue} from './SceneValue';
import {MIRROR_QUANTITIES,mirrorMeasure,type MirrorQuantity} from './mirrorQuantities';
import type {SceneResult} from './sceneRuntime';

export function MirrorQuantityLabel({label,quantity,selected,onToggle}:{label:string;quantity:string;selected:ReadonlySet<MirrorQuantity>;onToggle:(key:MirrorQuantity)=>void}){
  const content=<SceneQuantityLabel label={label} quantity={quantity} model="mirror"/>;
  if(!(quantity in MIRROR_QUANTITIES))return content;
  const key=quantity as MirrorQuantity;
  return <button type="button" className="os-quantity-toggle" style={{color:MIRROR_QUANTITIES[key].color}} aria-label={`查看${label.replace(/ [A-Za-z].*$/,'')}图示`} aria-pressed={selected.has(key)} aria-controls="mirror-ray-diagram" onClick={()=>onToggle(key)}>{content}</button>;
}
export default function MirrorAnnotations({result,selected,x,y,width,height}:{result:SceneResult;selected:ReadonlySet<MirrorQuantity>;x:(n:number)=>number;y:(n:number)=>number;width:number;height:number}){
  const cx=(n:number)=>Math.max(40,Math.min(width-40,n)),cy=(n:number)=>Math.max(50,Math.min(height-45,n)),axis=cy(y(0));
  const keys=(['u','v','f','R','h','imageHeight'] as const).filter(key=>selected.has(key)),direction=height-45-axis>=axis-50?1:-1;
  const room=Math.max(height-45-axis,axis-50),gap=Math.min(32,Math.max(19,(room-46)/Math.max(1,keys.length-1)));
  return <g pointerEvents="none" className="os-mirror-annotations">{keys.map((key,i)=>{
    const m=mirrorMeasure(result,key),{symbol,color}=MIRROR_QUANTITIES[key],shown=sceneDisplayValue(m.value,'mm');
    if(m.end===null||m.position===null)return <g key={key} data-testid={`mirror-quantity-${key}`}><text x={width-40} y={50+i*25} textAnchor="end" style={{fill:color}}>{symbol}：{key==='v'?'像在无穷远':'无有限像高'}</text></g>;
    const rawA=m.vertical?y(0):x(m.start),rawB=m.vertical?y(m.end):x(m.end),a=m.vertical?cy(rawA):cx(rawA),b=m.vertical?cy(rawB):cx(rawB),side=m.vertical?cx(x(m.position)+(key==='h'?-24:24)):cy(axis+direction*(46+i*gap)),outside=a!==rawA||b!==rawB||m.vertical&&side!==x(m.position)+(key==='h'?-24:24),lo=Math.min(a,b),hi=Math.max(a,b),head=Math.min(5,(hi-lo)/3);
    return <g key={key} data-testid={`mirror-quantity-${key}`} data-start={m.start} data-end={m.end} data-position={m.position} data-value={m.value}>
      <title>{symbol} = {shown.text} {shown.unit}{outside?'；端点超出当前画面':''}</title>
      {m.vertical?<><line x1={side} x2={side} y1={a} y2={b} stroke={color} strokeDasharray={outside?'5 3':undefined}/><path d={`M${side-4} ${lo+head}L${side} ${lo}L${side+4} ${lo+head}M${side-4} ${hi-head}L${side} ${hi}L${side+4} ${hi-head}`} fill="none" stroke={color}/><text x={side+(side>width-70?-12:12)} y={(a+b)/2} textAnchor={side>width-70?'end':'start'} className="os-angle-label" style={{fill:color}}>{symbol}</text></>:<><line x1={a} x2={a} y1={axis} y2={side} stroke={color} opacity={.3} strokeDasharray="3 4"/><line x1={b} x2={b} y1={axis} y2={side} stroke={color} opacity={.3} strokeDasharray="3 4"/><line x1={a} x2={b} y1={side} y2={side} stroke={color} strokeDasharray={outside?'5 3':undefined}/><path d={`M${lo+head} ${side-4}L${lo} ${side}L${lo+head} ${side+4}M${hi-head} ${side-4}L${hi} ${side}L${hi-head} ${side+4}`} fill="none" stroke={color}/><text x={(a+b)/2} y={side-8} textAnchor="middle" className="os-angle-label" style={{fill:color}}>{symbol}</text></>}
      {outside&&<text x={m.vertical?cx(side):cx((a+b)/2)} y={m.vertical?cy(hi+20):side+17} textAnchor={m.vertical&&side>width/2?'end':'middle'} style={{fill:color,fontSize:11}}>端点在图外</text>}
    </g>;
  })}</g>;
}

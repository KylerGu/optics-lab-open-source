import {thinLensMeasure,type ThinLensQuantity} from './thinLensQuantities';
import {quantityColor} from './scenePresentation';
import {numberText,type SceneResult} from './sceneRuntime';

export default function ThinLensAnnotations({result,selected,x,y,width,height}:{result:SceneResult;selected:ReadonlySet<ThinLensQuantity>;x:(n:number)=>number;y:(n:number)=>number;width:number;height:number}){
  const cx=(n:number)=>Math.max(38,Math.min(width-38,n)),cy=(n:number)=>Math.max(48,Math.min(height-42,n));
  const keys=(['u','v','f','h','imageHeight'] as const).filter(k=>selected.has(k)),axis=cy(y(0)),direction=height-42-axis>=axis-48?1:-1;
  return <g className="os-lens-annotations" pointerEvents="none">{keys.map((key,i)=>{
    const m=thinLensMeasure(result,key),color=quantityColor(key);
    if(m.end===null||m.position===null)return <g key={key} data-testid={`lens-quantity-${key}`}><text x={width-38} y={48+i*26} textAnchor="end" style={{fill:color}}>{m.symbol}：{key==='v'?'像在无穷远':'无有限像高'}</text></g>;
    const rawA=m.vertical?y(m.start):x(m.start),rawB=m.vertical?y(m.end):x(m.end),a=m.vertical?cy(rawA):cx(rawA),b=m.vertical?cy(rawB):cx(rawB),rawSide=m.vertical?x(m.position)+(key==='h'?-24:24):axis+direction*(48+i*32),side=m.vertical?cx(rawSide):cy(rawSide),cropped=a!==rawA||b!==rawB||m.vertical&&side!==rawSide;
    const low=Math.min(a,b),high=Math.max(a,b),head=Math.min(5,(high-low)/3);
    return <g key={key} data-testid={`lens-quantity-${key}`} data-start={m.start} data-end={m.end} data-position={m.position} aria-label={`${m.symbol} = ${numberText(m.value)} mm`}>
      <title>{m.symbol} = {numberText(m.value)} mm{cropped?'；端点超出当前画面':''}</title>
      {m.vertical?<><line x1={side} x2={side} y1={a} y2={b} stroke={color} strokeDasharray={cropped?'5 3':undefined}/><path d={`M${side-4} ${low+head}L${side} ${low}L${side+4} ${low+head}M${side-4} ${high-head}L${side} ${high}L${side+4} ${high-head}`} fill="none" stroke={color}/><text className="os-angle-label" x={side+(side>width-70?-10:10)} y={(a+b)/2} textAnchor={side>width-70?'end':'start'} style={{fill:color}}>{m.symbol}</text>{cropped&&<text x={cx(side)} y={cy(Math.max(a,b)+20)} textAnchor={side>width/2?'end':'start'} style={{fill:color,fontSize:12}}>端点在图外</text>}</>:<>
        <line x1={a} x2={a} y1={axis} y2={side} stroke={color} strokeDasharray="3 4" opacity={.35}/><line x1={b} x2={b} y1={axis} y2={side} stroke={color} strokeDasharray="3 4" opacity={.35}/><line x1={a} x2={b} y1={side} y2={side} stroke={color} strokeWidth={1.4} strokeDasharray={cropped?'5 3':undefined}/><path d={`M${low+head} ${side-4}L${low} ${side}L${low+head} ${side+4}M${high-head} ${side-4}L${high} ${side}L${high-head} ${side+4}`} fill="none" stroke={color}/><text className="os-angle-label" x={(a+b)/2} y={side-8} textAnchor="middle" style={{fill:color}}>{m.symbol}{cropped&&<tspan style={{fontSize:12}}>（端点在图外）</tspan>}</text>
      </>}
    </g>;
  })}</g>;
}

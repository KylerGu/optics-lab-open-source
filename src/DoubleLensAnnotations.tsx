import {doubleLensMeasure,type DoubleLensQuantity} from './doubleLensQuantities';
import {quantityColor} from './scenePresentation';
import {numberText,type SceneResult} from './sceneRuntime';

export default function DoubleLensAnnotations({result,selected,x,y,width,height}:{result:SceneResult;selected:ReadonlySet<DoubleLensQuantity>;x:(n:number)=>number;y:(n:number)=>number;width:number;height:number}){
  const clampX=(n:number)=>Math.max(38,Math.min(width-38,n)),clampY=(n:number)=>Math.max(48,Math.min(height-42,n));
  const keys=(['u','d','v1','v','f1','f2','equivalentFocal','h'] as const).filter(k=>selected.has(k));
  const axis=clampY(y(0)),below=height-42-axis,above=axis-48,direction=below>=above?1:-1,room=Math.max(below,above),gap=Math.min(32,Math.max(18,(room-48)/Math.max(1,keys.length-1)));
  return <g className="os-double-annotations" pointerEvents="none">{keys.map((key,i)=>{
    const m=doubleLensMeasure(result,key),color=quantityColor(key,'double-lens');
    if(m.end===null)return <g key={key} data-testid={`double-lens-quantity-${key}`}><text x={width-38} y={48+i*26} textAnchor="end" style={{fill:color}}>{m.symbol}：{key==='equivalentFocal'?'无焦系统':'像在无穷远'}</text></g>;
    const lane=clampY(axis+direction*(48+i*gap)),rawA=m.vertical?y(0):x(m.start),rawB=m.vertical?y(m.end):x(m.end),a=m.vertical?clampY(rawA):clampX(rawA),b=m.vertical?clampY(rawB):clampX(rawB),cropped=a!==rawA||b!==rawB;
    const low=Math.min(a,b),high=Math.max(a,b),head=Math.min(5,(high-low)/3),side=clampX(x(-result.input.parameters.u)-28);
    return <g key={key} data-testid={`double-lens-quantity-${key}`} data-start={m.start} data-end={m.end} aria-label={`${m.symbol} = ${numberText(m.value)} mm`}>
      <title>{m.symbol} = {numberText(m.value)} mm{cropped?'；端点超出当前画面':''}</title>
      {m.vertical?<><line x1={side} x2={side} y1={a} y2={b} stroke={color}/><path d={`M${side-4} ${low+head}L${side} ${low}L${side+4} ${low+head}M${side-4} ${high-head}L${side} ${high}L${side+4} ${high-head}`} fill="none" stroke={color}/><text x={side+10} y={(a+b)/2} className="os-angle-label" style={{fill:color}}>h</text></>:<>
        <line x1={a} x2={a} y1={clampY(y(0))} y2={lane} stroke={color} opacity={.35} strokeDasharray="3 4"/><line x1={b} x2={b} y1={clampY(y(0))} y2={lane} stroke={color} opacity={.35} strokeDasharray="3 4"/>
        <line x1={a} x2={b} y1={lane} y2={lane} stroke={color} strokeWidth={1.4} strokeDasharray={cropped?'5 3':undefined}/><path d={`M${low+head} ${lane-4}L${low} ${lane}L${low+head} ${lane+4}M${high-head} ${lane-4}L${high} ${lane}L${high-head} ${lane+4}`} fill="none" stroke={color}/>
        <text x={(a+b)/2} y={lane-8} textAnchor="middle" className="os-angle-label" style={{fill:color}}>{m.symbol}{cropped&&<tspan className="os-double-outside">（端点在图外）</tspan>}</text>
        {b===rawB&&['f1','f2','equivalentFocal','v1'].includes(key)&&<><circle cx={b} cy={clampY(y(0))} r={4} fill={color}/>{!(key==='v1'&&result.markers.some(marker=>marker.label==='中间像'))&&<text x={clampX(b+12)} y={clampY(y(0)-64-i*17)} textAnchor={b>width-110?'end':'start'} style={{fill:color}}>{key==='v1'?'第一片单独像':key==='equivalentFocal'?'F′':key==='f1'?'F₁′':'F₂′'}</text>}</>}
        {m.reference&&a===rawA&&<><line x1={a} x2={a} y1={clampY(y(0)-35)} y2={clampY(y(0)+35)} stroke={color} strokeDasharray="4 3"/><text x={a-8} y={clampY(y(0)-20)} textAnchor="end" style={{fill:color}}>{m.reference}</text></>}
      </>}
    </g>;
  })}</g>;
}

import SceneQuantityLabel from './SceneQuantityLabel';
import {displayNumber} from './SceneValue';
import {REFRACTION_QUANTITIES,refractionArc,refractionDrawable,refractionSymbol,type RefractionQuantity} from './refractionQuantities';
import type {SceneResult} from './sceneRuntime';

export function RefractionQuantityLabel({label,quantity,result,selected,onToggle}:{label:string;quantity:string;result:SceneResult;selected:ReadonlySet<RefractionQuantity>;onToggle:(key:RefractionQuantity)=>void}){
  const content=<SceneQuantityLabel model={result.model} label={label} quantity={quantity}/>;
  if(!refractionDrawable(result.model,quantity))return content;
  return <button type="button" className="os-quantity-toggle" aria-label={`查看${label}图示`} aria-pressed={selected.has(quantity)} aria-controls="refraction-ray-diagram" onClick={()=>onToggle(quantity)}>{content}</button>;
}
export default function RefractionAnnotations({result,selected,x,y,width,height,scale}:{result:SceneResult;selected:ReadonlySet<RefractionQuantity>;x:(n:number)=>number;y:(n:number)=>number;width:number;height:number;scale:number}){
  const prism=result.model==='prism',p=result.input.parameters,inside=result.segments.find(s=>s.role==='internal'),span=inside?Math.abs(x(inside.end[0])-x(inside.start[0])):200;
  const normal=(point:[number,number],a:number)=><line x1={x(point[0]-.26*Math.cos(a))} y1={y(point[1]-.26*Math.sin(a))} x2={x(point[0]+.26*Math.cos(a))} y2={y(point[1]+.26*Math.sin(a))} stroke="#8ba9c6" strokeDasharray="5 5"/>;
  const label=(key:RefractionQuantity,text:string,px:number,py:number)=><text key={key} data-testid={`refraction-quantity-${key}`} x={Math.max(40,Math.min(width-40,px))} y={Math.max(40,Math.min(height-40,py))} style={{fill:REFRACTION_QUANTITIES[key].color}}>{text}</text>;
  return <g pointerEvents="none">
    {prism&&<>{normal(result.segments[0].end,-p.apex*Math.PI/360)}{inside&&refractionArc(result,'r2')?.reason===undefined&&normal(inside.end,p.apex*Math.PI/360)}</>}
    {[...selected].filter(key=>refractionDrawable(result.model,key)).map((key,i)=>{
      const symbol=refractionSymbol(key,result.model),color=REFRACTION_QUANTITIES[key].color,arc=refractionArc(result,key);
      if(!arc){
        if(prism)return label(key,`${symbol} = ${displayNumber(p[key])}`,key==='n'?x(0):40,key==='n'?y(.1):75);
        const upper=key==='n1',top=upper?25:Math.max(25,y(0)),bottom=upper?Math.min(height-25,y(0)):height-25;
        return bottom-top>=40?<g key={key}>{label(key,`${symbol} = ${displayNumber(p[key])}`,40,upper?top+35:bottom-30)}</g>:null;
      }
      if(arc.reason||arc.value===null)return <g key={key}>{label(key,`${symbol}：${arc.reason??'无有限结果'}`,40,48+i*23)}</g>;
      const inner=key==='r1'||key==='r2',radius=prism?(inner?Math.min(key==='r1'?30:42,span*.16):key==='deviation'?Math.min(76,.52*scale):key==='apex'?Math.min(32,.18*scale):key==='exitAngle'?Math.min(34,.23*scale):42):key==='angle'?48:key==='reflectedAngle'?76:key==='criticalAngle'?112:60;
      const point=(a:number,r:number):[number,number]=>[x(arc.center[0])+r*Math.cos(a),y(arc.center[1])-r*Math.sin(a)],start=point(arc.from,radius),end=point(arc.to,radius),mid=(arc.from+arc.to)/2,text=point(mid,radius+(inner?Math.min(22,span*.15):23));
      const delta=Math.abs(arc.from-arc.to),zero=delta<1e-10,title=`${symbol} = ${displayNumber(arc.value)}°${key==='criticalAngle'?'；虚线为临界入射方向参考':arc.reference?'；临界处的极限折射方向':''}`;
      return <g key={key} data-testid={`refraction-quantity-${key}`} data-value={arc.value} data-from={arc.from} data-to={arc.to} data-x={arc.center[0]} data-y={arc.center[1]}>
        <title>{title}</title>
        {key==='criticalAngle'&&<line x1={x(0)} y1={y(0)} x2={x(-.88*Math.sin(arc.value*Math.PI/180))} y2={y(.88*Math.cos(arc.value*Math.PI/180))} stroke={color} strokeDasharray="5 5" opacity={.65}/>}
        {key==='deviation'&&!zero&&<line x1={x(arc.center[0])} y1={y(arc.center[1])} x2={x(arc.center[0]+.8*Math.cos(arc.from))} y2={y(arc.center[1]+.8*Math.sin(arc.from))} stroke={color} strokeDasharray="5 5" opacity={.65}/>}
        {!zero&&<path d={`M${start[0]} ${start[1]} A${radius} ${radius} 0 0 ${arc.to>arc.from?0:1} ${end[0]} ${end[1]}`} fill="none" stroke={color} strokeWidth={1.6} strokeDasharray={arc.reference?'5 3':undefined}/>}
        <text className="os-angle-label" x={Math.max(40,Math.min(width-40,text[0]))} y={Math.max(40,Math.min(height-40,text[1]+(inner?8:0)))} textAnchor="middle" style={{fill:color,fontSize:prism?Math.max(12,Math.min(19,span/6)):19}}>{symbol}{zero?' = 0':''}</text>
      </g>;
    })}
  </g>;
}

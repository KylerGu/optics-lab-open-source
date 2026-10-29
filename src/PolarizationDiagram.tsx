import { useEffect,useRef,useState,type PointerEvent } from 'react';
import { birefringence,brewster,polarizationAngleFromPoint,type PolarizationRefractionParameters } from './polarizationRefraction';
import { crystalLayout,refractionLayout } from './polarizationDiagramGeometry';
import { arcPath } from './fiberDiagramGeometry';
import { REFRACTION_COLORS as C,quantityStyle } from './quantityColors';
import { numberText } from './sceneRuntime';
export type RefractionAnnotation='n1'|'n2'|'angleDeg'|'brewsterDeg'|'transmissionDeg'|'ordinaryIndex'|'extraordinaryIndex'|'axisAngleDeg'|'thicknessMm'|'walkoffDeg'|'separationMm';
interface Props {p:PolarizationRefractionParameters;annotations:RefractionAnnotation[];onStart:()=>void;onChange:(key:keyof PolarizationRefractionParameters,value:number)=>void;onFinish:()=>void}
const RAD=Math.PI/180,fmt=(v:number)=>Number(v.toFixed(2)).toString();
export default function PolarizationDiagram({p,annotations,onStart,onChange,onFinish}:Props){
  const host=useRef<HTMLDivElement>(null),svg=useRef<SVGSVGElement>(null),drag=useRef<{id:number;field:'angleDeg'|'axisAngleDeg';cx:number;cy:number;mode:number}|null>(null);
  const [size,setSize]=useState({w:700,h:600});
  useEffect(()=>{const el=host.current!;const ro=new ResizeObserver(([e])=>{if(e.contentRect.width&&e.contentRect.height)setSize({w:e.contentRect.width,h:e.contentRect.height});});ro.observe(el);return()=>ro.disconnect();},[]);
  const g=refractionLayout(size.w,size.h),q=crystalLayout(size.w,size.h,p),b=brewster(p),c=birefringence(p),{w,h,cx,cy,r}=g;
  const point=(e:PointerEvent<SVGElement>)=>{const pt=svg.current!.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;return pt.matrixTransform(svg.current!.getScreenCTM()!.inverse());};
  const begin=(e:PointerEvent<SVGGElement>)=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.focus();onStart();drag.current={id:e.pointerId,field:p.mode===0?'angleDeg':'axisAngleDeg',cx:p.mode===0?cx:q.axisX,cy:p.mode===0?cy:q.axisY,mode:p.mode};svg.current!.setPointerCapture(e.pointerId);};
  const move=(e:PointerEvent<SVGSVGElement>)=>{const d=drag.current;if(!d||e.pointerId!==d.id)return;const pt=point(e);if(Math.hypot(pt.x-d.cx,pt.y-d.cy)<8)return;onChange(d.field,polarizationAngleFromPoint(pt.x,pt.y,d.cx,d.cy,d.mode));};
  const finish=()=>{if(!drag.current)return;drag.current=null;onFinish();};
  const keyboard=(e:React.KeyboardEvent<SVGGElement>)=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const field=p.mode===0?'angleDeg':'axisAngleDeg',max=p.mode===0?89.9:90;onStart();onChange(field,e.key==='Home'?0:e.key==='End'?max:Math.round(Math.max(0,Math.min(max,p[field]+(['ArrowUp','ArrowRight'].includes(e.key)?.1:-.1)))*10)/10);onFinish();};
  const tag=(key:RefractionAnnotation,children:React.ReactNode)=>annotations.includes(key)?<g className="quantity-annotation" style={quantityStyle(C[key])} data-testid={'pr-annotation-'+key}>{children}</g>:null;
  const label=(x:number,y:number,text:string,anchor:'middle'|'start'|'end'='middle')=><text x={x} y={y} textAnchor={anchor} className="fiber-symbol">{text}</text>;
  const incident={x:cx-r*Math.sin(p.angleDeg*RAD),y:cy-r*Math.cos(p.angleDeg*RAD)},reflected={x:cx+r*Math.sin(p.angleDeg*RAD),y:cy-r*Math.cos(p.angleDeg*RAD)},t=(b.transmissionDeg??0)*RAD;
  const axis={x:q.axisX+q.axisRadius*Math.cos(p.axisAngleDeg*RAD),y:q.axisY-q.axisRadius*Math.sin(p.axisAngleDeg*RAD)};
  const handle=(x:number,y:number,name:string,field:'angleDeg'|'axisAngleDeg')=><g className="pr-angle-control" role="slider" tabIndex={0} aria-label={name} aria-valuemin={0} aria-valuemax={field==='angleDeg'?89.9:90} aria-valuenow={p[field]} onPointerDown={begin} onKeyDown={keyboard}><title>拖动改变{name.replace('图中','')}</title><circle cx={x} cy={y} r={14} fill="transparent"/><circle data-testid={'pr-handle-'+field} cx={x} cy={y} r={6} fill="#fff" stroke={C[field]} strokeWidth={2}/></g>;
  return <div className="gs-plot fiber-plot pr-plot"><div className={`fiber-banner ${p.mode===0&&(b.tir||b.critical)?'is-leaking':''}`}>{p.mode===0?b.status:c.status}</div><div className="fiber-canvas" ref={host}><svg ref={svg} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={p.mode===0?'布儒斯特角二维光线图':'双折射晶体二维剖面'} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
    {p.mode===0?<>
      <rect x={28} y={cy-r-28} width={w-56} height={r+28} rx={3} fill="#f5f8fc"/><rect x={28} y={cy} width={w-56} height={r+34} rx={3} fill="#eaf0fa"/>
      <line x1={28} x2={w-28} y1={cy} y2={cy} stroke="#9eb6ce"/><line x1={cx} x2={cx} y1={cy-r-28} y2={cy+r+34} stroke="#a9bcd0" strokeDasharray="5 5"/>
      <text x={cx+8} y={cy-r-11}>法线</text>
      {tag('n1',label(43,cy-r-7,`n₁ = ${numberText(p.n1)}`,'start'))}{tag('n2',label(43,cy+r+16,`n₂ = ${numberText(p.n2)}`,'start'))}
      {annotations.includes('brewsterDeg')&&b.brewsterDeg!==null&&<g>{tag('brewsterDeg',<><line x1={cx} y1={cy} x2={cx-r*Math.sin(b.brewsterDeg*RAD)} y2={cy-r*Math.cos(b.brewsterDeg*RAD)} stroke="currentColor" strokeDasharray="4 5"/><path d={arcPath(cx,cy,r*.25,-Math.PI/2-b.brewsterDeg*RAD,-Math.PI/2)} fill="none" stroke="currentColor"/>{label(cx-12,cy-r*.12,`θB = ${fmt(b.brewsterDeg)}°`,'end')}</>)}</g>}
      <line data-testid="pr-incident-ray" x1={incident.x} y1={incident.y} x2={cx} y2={cy} stroke={C.angleDeg} strokeWidth={2.8}/>
      {b.reflectancePct>1e-8&&<><line data-testid="pr-reflected-ray" x1={cx} y1={cy} x2={reflected.x} y2={reflected.y} stroke={C.reflectancePct} strokeWidth={2.4} opacity={.35+.65*Math.sqrt(b.reflectancePct/100)}/><text x={Math.min(w-70,reflected.x+9)} y={Math.max(cy-r+28,reflected.y-12)} textAnchor="middle">反射光</text></>}
      {b.transmissionPct>1e-8&&b.transmissionDeg!==null&&<><line data-testid="pr-transmitted-ray" x1={cx} y1={cy} x2={cx+r*Math.sin(t)} y2={cy+r*Math.cos(t)} stroke={C.transmissionDeg} strokeWidth={2.8}/><text x={Math.min(w-66,cx+r*Math.sin(t)+12)} y={cy+r*Math.cos(t)+22}>折射光</text></>}
      {tag('angleDeg',<><path d={arcPath(cx,cy,r*.42,-Math.PI/2-p.angleDeg*RAD,-Math.PI/2)} stroke="currentColor" fill="none"/>{label(cx-r*.63*Math.sin(p.angleDeg*RAD/2)-8,cy-r*.63*Math.cos(p.angleDeg*RAD/2),`θ = ${fmt(p.angleDeg)}°`)}</>)}
      {b.transmissionPct>1e-8&&b.transmissionDeg!==null&&tag('transmissionDeg',<><path d={arcPath(cx,cy,r*.35,Math.PI/2-t,Math.PI/2)} stroke="currentColor" fill="none"/>{label(cx+r*.55*Math.sin(t/2)+22,cy+r*.55*Math.cos(t/2),`θₜ = ${fmt(b.transmissionDeg)}°`)}</>)}
      {handle(incident.x,incident.y,'图中入射角','angleDeg')}
    </>:<>
      <rect data-testid="pr-crystal" x={q.left} y={q.cy-q.halfHeight} width={q.right-q.left} height={q.halfHeight*2} rx={4} fill="#eff1f9" stroke="#b6bdd5"/>
      <text x={w/2} y={q.cy-q.halfHeight-16} textAnchor="middle">单轴晶体</text>
      <line x1={q.startX} x2={q.left} y1={q.cy} y2={q.cy} stroke="#8395a9" strokeWidth={2.5}/>
      <line data-testid="pr-o-ray" x1={q.left} x2={q.endX} y1={q.cy} y2={q.cy} stroke={C.ordinaryIndex} strokeWidth={2.7}/>
      <path data-testid="pr-e-ray" d={`M${q.left} ${q.cy}L${q.right} ${q.exitY}H${q.endX}`} stroke={C.extraordinaryIndex} strokeWidth={2.7} strokeDasharray={c.tangent===0?'6 5':undefined} fill="none"/>
      <text x={q.startX} y={q.cy-15}>入射光</text>
      {tag('ordinaryIndex',label(q.right-14,q.cy-12,`o 光 · nₒ = ${numberText(p.ordinaryIndex)}`,'end'))}
      {tag('extraordinaryIndex',label(q.right-14,q.exitY+(c.tangent>0?-12:23),`e 光 · nₑ = ${numberText(p.extraordinaryIndex)}`,'end'))}
      <line x1={q.axisX-q.axisRadius*.4} x2={q.axisX+q.axisRadius+14} y1={q.axisY} y2={q.axisY} stroke="#c3ceda" strokeDasharray="3 4"/>
      <line x1={q.axisX-q.axisRadius*Math.cos(p.axisAngleDeg*RAD)} x2={axis.x} y1={q.axisY+q.axisRadius*Math.sin(p.axisAngleDeg*RAD)} y2={axis.y} stroke={C.axisAngleDeg} strokeWidth={2}/>
      {tag('axisAngleDeg',<><path d={arcPath(q.axisX,q.axisY,q.axisRadius*.65,-p.axisAngleDeg*RAD,0)} stroke="currentColor" fill="none"/>{label(q.axisX,q.axisY-q.axisRadius-17,`γ = ${fmt(p.axisAngleDeg)}°`)}</>)}
      {handle(axis.x,axis.y,'图中光轴角','axisAngleDeg')}
      {tag('thicknessMm',<><path d={`M${q.left} ${q.cy+q.halfHeight+12}v10m0 -5H${q.right}m0 -5v10`} stroke="currentColor" fill="none"/>{label(w/2,q.cy+q.halfHeight+42,`L = ${fmt(p.thicknessMm)} mm`)}</>)}
      {tag('separationMm',<><path data-testid="pr-separation-dimension" d={`M${q.endX+5} ${q.cy}h10m-5 0V${q.exitY}m-5 0h10`} stroke="currentColor" fill="none"/>{label(q.endX+14,(q.cy+q.exitY)/2-7,`d = ${fmt(c.separationMm)} mm`,'end')}</>)}
      {tag('walkoffDeg',<><path d={arcPath(q.left,q.cy,Math.min(65,(q.right-q.left)*.3),Math.min(0,-c.walkoffDeg*RAD),Math.max(0,-c.walkoffDeg*RAD))} stroke="currentColor" fill="none"/>{label(q.left+12,q.cy+(c.tangent>0?35:-30),`ρ = ${fmt(c.walkoffDeg)}°`,'start')}</>)}
    </>}
  </svg></div><div className="gs-visual-footer"><span>{p.mode===0?'拖动入射光端点调角度':'拖动光轴端点调角度'}</span><span>{p.mode===0?'角度从法线量起':'横纵比例一致 · 正入射'}</span></div></div>;
}

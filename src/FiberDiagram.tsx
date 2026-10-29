import { FIBER_COLORS, quantityStyle } from './quantityColors';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { fiberModes, type FiberParameters } from './fiberModes';
import { angleFromPoint, arcPath, diagramLayout } from './fiberDiagramGeometry';
import { numberText } from './sceneRuntime';

export type FiberAnnotation = 'coreIndex'|'claddingIndex'|'radiusUm'|'angleDeg'|'acceptanceDeg'|'criticalDeg'|'internalDeg'|'incidenceDeg';
interface Props { p: FiberParameters; annotations: FiberAnnotation[]; onStart: () => void; onChange: (field: keyof FiberParameters, value: number) => void; onFinish: () => void }
const STATUS = { guided:'全反射导光',critical:'临界掠射',escaping:'超出接收角',unguided:'无折射率导光' };
const deg = (n: number) => `${Number(n.toFixed(2))}°`;

export default function FiberDiagram({ p, annotations, onStart, onChange, onFinish }: Props) {
  const canvas=useRef<HTMLDivElement>(null), svg=useRef<SVGSVGElement>(null);
  const drag=useRef<{id:number;entryX:number;axisY:number}|null>(null);
  const [size,setSize]=useState({w:700,h:600}), [dragging,setDragging]=useState(false);
  useEffect(()=>{const el=canvas.current;if(!el)return;const ro=new ResizeObserver(([e])=>{if(e.contentRect.width&&e.contentRect.height)setSize({w:e.contentRect.width,h:e.contentRect.height});});ro.observe(el);return()=>ro.disconnect();},[]);
  const physics=fiberModes(p);
  const g=diagramLayout(size.w,size.h,{radiusUm:p.radiusUm,internalDeg:physics.internalDeg}), {w,h,left,right,cy,scale,rayLength}=g;
  const b=fiberModes(p,g.viewUm/p.radiusUm), half=p.radiusUm*scale, outer=half+32;
  const marked=(key:FiberAnnotation)=>annotations.includes(key);
  const x=(a:number)=>left+a*p.radiusUm*scale, y=(a:number)=>cy-a*half;
  const theta=p.angleDeg*Math.PI/180, alpha=b.internalDeg*Math.PI/180, accept=(b.acceptanceDeg??0)*Math.PI/180;
  const source={x:left-rayLength*Math.cos(theta),y:cy+rayLength*Math.sin(theta)};
  const point=(event:ReactPointerEvent<SVGElement>)=>{const pt=svg.current!.createSVGPoint();pt.x=event.clientX;pt.y=event.clientY;return pt.matrixTransform(svg.current!.getScreenCTM()!.inverse());};
  const begin=(event:ReactPointerEvent<SVGElement>)=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.focus();onStart();drag.current={id:event.pointerId,entryX:left,axisY:cy};setDragging(true);svg.current?.setPointerCapture(event.pointerId);};
  const move=(event:ReactPointerEvent<SVGSVGElement>)=>{const d=drag.current;if(!d||d.id!==event.pointerId)return;const pt=point(event);onChange('angleDeg',angleFromPoint(pt.x,pt.y,d.entryX,d.axisY));};
  const finish=()=>{if(!drag.current)return;drag.current=null;setDragging(false);onFinish();};
  const keyboard=(e:React.KeyboardEvent<SVGGElement>)=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();onStart();const delta=['ArrowUp','ArrowRight'].includes(e.key)?.1:-.1;onChange('angleDeg',e.key==='Home'?0:e.key==='End'?30:Number(Math.min(30,Math.max(0,p.angleDeg+delta)).toFixed(1)));onFinish();};
  const tag=(key:FiberAnnotation,content:React.ReactNode)=>marked(key)?<g className="fiber-annotation quantity-annotation" style={quantityStyle(FIBER_COLORS[key])} data-testid={'fiber-annotation-'+key}>{content}</g>:null;
  const label=(tx:number,ty:number,text:string,anchor:'start'|'middle'|'end'='start')=><text x={tx} y={ty} textAnchor={anchor} className="fiber-symbol">{text}</text>;
  const leader=(points:string,color:string)=><polyline points={points} fill="none" stroke={color} strokeWidth={1.1}/>;
  const hit=b.firstHit, hx=hit?x(hit[0]):0, hy=hit?y(hit[1]):0;

  return <div className={`gs-plot fiber-plot ${dragging?'fiber-dragging':''}`}>
    <div className={`fiber-banner ${b.rayStatus==='guided'?'is-guided':'is-leaking'}`} role="status">{STATUS[b.rayStatus]}<span>{b.rayStatus==='guided'?'θ < θₐ':b.rayStatus==='critical'?'θ = θₐ':b.guiding?'θ > θₐ':'n₁ ≤ n₂'}</span></div>
    <div ref={canvas} className="fiber-canvas"><svg ref={svg} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`光纤二维示意，${STATUS[b.rayStatus]}，${b.mode}`} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
      <defs><clipPath id="fiber-ray-window"><rect x={left} y={cy-outer} width={right-left} height={outer*2}/></clipPath></defs>
      <rect x={left} y={cy-outer} width={right-left} height={outer*2} rx={3} fill="#f2f5f9" stroke="#cbd8e5"/>
      <rect data-testid="fiber-core" x={left} y={cy-half} width={right-left} height={half*2} fill="#e4eef8" stroke={FIBER_COLORS.coreIndex} strokeWidth={1.5}/>
      <line x1={24} x2={right+12} y1={cy} y2={cy} className="gs-axis" strokeDasharray="5 5"/>
      <text x={left+10} y={cy+half+22}>包层</text>
      {tag('claddingIndex',label(right-12,cy-half-12,`n₂ = ${numberText(p.claddingIndex)}`,'end'))}
      {tag('coreIndex',label(right-100,cy+5,`n₁ = ${numberText(p.coreIndex)}`,'end'))}
      {marked('acceptanceDeg')&&b.guiding&&<g><path d={`M${left} ${cy}L${left-rayLength*Math.cos(accept)} ${cy-rayLength*Math.sin(accept)}L${left-rayLength*Math.cos(accept)} ${cy+rayLength*Math.sin(accept)}Z`} fill="#dfefe7" opacity={.6}/><path d={`M${left-rayLength*Math.cos(accept)} ${cy-rayLength*Math.sin(accept)}L${left} ${cy}L${left-rayLength*Math.cos(accept)} ${cy+rayLength*Math.sin(accept)}`} stroke={FIBER_COLORS.acceptanceDeg} strokeDasharray="5 4" fill="none"/></g>}
      <path data-testid="fiber-incident-ray" d={`M${source.x} ${source.y}L${left} ${cy}`} stroke={FIBER_COLORS.angleDeg} strokeWidth={2.3} fill="none"/>
      <g clipPath="url(#fiber-ray-window)">{b.segments.map((s,j)=><line key={j} data-testid={j===0?'fiber-first-core-ray':undefined} x1={x(s.start[0])} x2={x(s.end[0])} y1={y(s.start[1])} y2={y(s.end[1])} stroke={s.role==='escaping'?'#bc7655':'#b38c4f'} strokeWidth={2.3} strokeDasharray={s.role==='escaping'?'6 4':undefined}/>)}</g>
      <g className="fiber-control fiber-angle-control" role="slider" tabIndex={0} aria-label="图中入射角" aria-valuemin={0} aria-valuemax={30} aria-valuenow={p.angleDeg} aria-valuetext={deg(p.angleDeg)} onPointerDown={begin} onKeyDown={keyboard}>
        <title>拖动入射光源或光线，改变入射角</title><path d={`M${source.x} ${source.y}L${left} ${cy}`} stroke="transparent" strokeWidth={20}/><circle cx={source.x} cy={source.y} r={11} fill="transparent"/><circle cx={source.x} cy={source.y} r={6} fill="#fff" stroke={FIBER_COLORS.angleDeg} strokeWidth={2}/>
      </g>
      {tag('radiusUm',<><path d={`M${right+15} ${cy}V${cy-half}M${right+10} ${cy}h10M${right+10} ${cy-half}h10M${right+15} ${cy}v14`} stroke="#6287ab" strokeWidth={1.3} fill="none"/>{label(right+17,cy+28,`a = ${numberText(p.radiusUm)} μm`,'end')}</>)}
      {tag('angleDeg',<><path d={arcPath(left,cy,Math.min(65,rayLength*.55),Math.PI-theta,Math.PI)} stroke={FIBER_COLORS.angleDeg} fill="none" strokeWidth={1.8}/>{label(left-rayLength*.72,cy+rayLength*Math.sin(theta)+34,`θ = ${deg(p.angleDeg)}`,'middle')}{leader(`${left-rayLength*.72},${cy+rayLength*Math.sin(theta)+20} ${left-57},${cy+10}`,'#b38c4f')}</>)}
      {tag('acceptanceDeg',b.acceptanceDeg===null?null:<><path d={arcPath(left,cy,Math.min(93,rayLength*.82),Math.PI,Math.PI+accept)} stroke="#49886f" fill="none" strokeWidth={1.8}/>{label(left-rayLength*.72,cy-43,`θₐ = ${deg(b.acceptanceDeg)}`,'middle')}{leader(`${left-rayLength*.72},${cy-33} ${left-80},${cy-8}`,'#49886f')}</>)}
      {tag('internalDeg',<><path d={arcPath(left,cy,60,-alpha,0)} stroke="#4b83b0" fill="none" strokeWidth={1.8}/>{label(left+70,cy-45,`θ₁ = ${deg(b.internalDeg)}`,'middle')}{leader(`${left+70},${cy-35} ${left+59*Math.cos(alpha/2)},${cy-59*Math.sin(alpha/2)}`,'#4b83b0')}</>)}
      {hit&&(marked('incidenceDeg')||marked('criticalDeg'))&&<line x1={hx} x2={hx} y1={hy-20} y2={hy+50} stroke="#9aacbf" strokeDasharray="4 3"/>}
      {hit&&tag('incidenceDeg',<><path d={arcPath(hx,hy,18,Math.PI/2,Math.PI-alpha)} stroke={FIBER_COLORS.angleDeg} fill="none" strokeWidth={1.8}/>{label(hx-14,hy-28,`i = ${deg(b.incidenceDeg)}`,'end')}{leader(`${hx-22},${hy-20} ${hx-25},${hy+9}`,'#b38c4f')}</>)}
      {hit&&b.criticalDeg!==null&&tag('criticalDeg',<><path d={arcPath(hx,hy,29,Math.PI/2,Math.PI/2+b.criticalDeg*Math.PI/180)} stroke="#8c71a4" fill="none" strokeWidth={1.8}/><path d={`M${hx} ${hy}l${-45*Math.sin(b.criticalDeg*Math.PI/180)} ${45*Math.cos(b.criticalDeg*Math.PI/180)}`} stroke="#8c71a4" strokeDasharray="3 3" fill="none"/>{label(hx+15,hy-9,`θc = ${deg(b.criticalDeg)}`)}{leader(`${hx+17},${hy-5} ${hx+12},${hy+30} ${hx-18},${hy+22}`,'#8c71a4')}</>)}
    </svg></div><div className="gs-visual-footer"><span>拖动入射光线调角度{!hit&&p.angleDeg>0?' · 首次交点在视窗外':''}</span><span>等比例 · 视窗 {Math.round(g.viewUm)} μm</span></div>
  </div>;
}

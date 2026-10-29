import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { malus, type MalusParameters } from './malus';
import { arcPath } from './fiberDiagramGeometry';
import { numberText } from './sceneRuntime';
import { MALUS_COLORS, quantityStyle } from './quantityColors';

export type MalusAnnotation='inputAngleDeg'|'axisAngleDeg'|'relativeAngleDeg';
type AngleField='inputAngleDeg'|'axisAngleDeg';
interface Props {p:MalusParameters;annotations:MalusAnnotation[];onStart:()=>void;onChange:(key:keyof MalusParameters,value:number)=>void;onFinish:()=>void}
export default function MalusDiagram({p,annotations,onStart,onChange,onFinish}:Props){
  const root=useRef<HTMLDivElement>(null),svg=useRef<SVGSVGElement>(null),drag=useRef<{id:number;field:AngleField;cx:number;cy:number;radius:number}|null>(null);
  const [size,setSize]=useState({w:700,h:600});
  useEffect(()=>{if(!root.current)return;const observer=new ResizeObserver(([e])=>{if(e.contentRect.width&&e.contentRect.height)setSize({w:e.contentRect.width,h:e.contentRect.height});});observer.observe(root.current);return()=>observer.disconnect();},[]);
  const w=Math.max(360,size.w),h=Math.max(500,size.h),cx=w/2,cy=h/2+15,R=Math.min((w-90)/2,(h-155)*.43),b=malus(p),rad=Math.PI/180;
  const at=(angle:number,radius:number)=>({x:cx+radius*Math.cos(angle*rad),y:cy-radius*Math.sin(angle*rad)});
  const point=(e:PointerEvent<SVGElement>)=>{const pt=svg.current!.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;return pt.matrixTransform(svg.current!.getScreenCTM()!.inverse());};
  const start=(e:PointerEvent<SVGElement>,field:AngleField)=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.focus();onStart();drag.current={id:e.pointerId,field,cx,cy,radius:R};svg.current?.setPointerCapture(e.pointerId);};
  const move=(e:PointerEvent<SVGSVGElement>)=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;const pt=point(e);if(Math.hypot(pt.x-d.cx,pt.y-d.cy)<d.radius*.08)return;const angle=(Math.atan2(d.cy-pt.y,pt.x-d.cx)/rad+180)%180;onChange(d.field,Math.round(angle*10)/10);};
  const finish=()=>{if(!drag.current)return;drag.current=null;onFinish();};
  const key=(e:React.KeyboardEvent<SVGGElement>,field:AngleField)=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();onStart();onChange(field,e.key==='Home'?0:e.key==='End'?180:Math.round(Math.max(0,Math.min(180,p[field]+(['ArrowUp','ArrowRight'].includes(e.key)?1:-1)))*10)/10);onFinish();};
  const axis=(field:AngleField,label:string,length:number)=>{const a=at(p[field],length),z=at(p[field]+180,length),color=MALUS_COLORS[field];return <g className="malus-axis-control" role="slider" tabIndex={0} aria-label={'图中'+label} aria-valuemin={0} aria-valuemax={180} aria-valuenow={p[field]} onPointerDown={e=>start(e,field)} onKeyDown={e=>key(e,field)}>
    <title>拖动两端，旋转{label}</title><line x1={a.x} y1={a.y} x2={z.x} y2={z.y} stroke="transparent" strokeWidth={16}/><line data-testid={'malus-axis-'+field} x1={a.x} y1={a.y} x2={z.x} y2={z.y} stroke={color} strokeWidth={field==='axisAngleDeg'?3:2.5} strokeDasharray={field==='inputAngleDeg'?'7 4':undefined}/>
    {[a,z].map((pt,i)=><g key={i}><circle cx={pt.x} cy={pt.y} r={11} fill="transparent"/><circle data-testid={i===0?'malus-handle-'+field:undefined} cx={pt.x} cy={pt.y} r={6} fill="#fff" stroke={color} strokeWidth={2}/></g>)}
  </g>;};
  const mark=(field:MalusAnnotation,content:React.ReactNode)=>annotations.includes(field)?<g className="quantity-annotation" style={quantityStyle(MALUS_COLORS[field])} data-testid={'malus-annotation-'+field}>{content}</g>:null;
  const alphaLabel=at(p.inputAngleDeg,R*.78),betaLabel=at(p.axisAngleDeg,R);
  const alphaX=Math.min(w-90,Math.max(12,alphaLabel.x+12));
  const betaX=p.axisAngleDeg<90?Math.min(w-95,betaLabel.x+12):Math.max(95,betaLabel.x-12);
  const arcStart=-p.inputAngleDeg*rad,arcEnd=-(p.inputAngleDeg+b.signedAngleDeg)*rad,thetaLabel=at(p.inputAngleDeg+b.signedAngleDeg/2,R*.39);
  return <div className="gs-plot fiber-plot malus-plot"><div className="fiber-banner">{p.powerMw===0?'光源关闭':b.relativeAngleDeg===90?'正交消光':b.relativeAngleDeg===0?'平行全透':'旋转透光轴，观察透射功率'}</div>
    <div className="fiber-canvas" ref={root}><svg ref={svg} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="偏振片二维正视图" onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
      <circle data-testid="malus-disc" cx={cx} cy={cy} r={R} fill="#f3f6fb" stroke="#b6c8dc" strokeWidth={1.5}/>
      <circle cx={cx} cy={cy} r={R-3} fill="#dcebe5" opacity={.04+.18*b.fraction}/>
      <line x1={cx-R-15} x2={cx+R+15} y1={cy} y2={cy} stroke="#b6c8dc" strokeDasharray="4 5"/>
      <text x={cx} y={cy-R-25} textAnchor="middle">偏振片</text>
      {axis('axisAngleDeg','透光轴',R)}{axis('inputAngleDeg','偏振方向',R*.78)}
      {mark('inputAngleDeg',<><path d={arcPath(cx,cy,R*.57,-p.inputAngleDeg*rad,0)} fill="none" stroke="currentColor"/><text className="fiber-symbol" x={alphaX} y={alphaLabel.y+26}>α = {numberText(p.inputAngleDeg)}°</text></>)}
      {mark('axisAngleDeg',<><path d={arcPath(cx,cy,R*.8,-p.axisAngleDeg*rad,0)} fill="none" stroke="currentColor"/><text className="fiber-symbol" x={betaX} y={betaLabel.y-14} textAnchor={p.axisAngleDeg<90?'start':'end'}>β = {numberText(p.axisAngleDeg)}°</text></>)}
      {mark('relativeAngleDeg',<><path d={arcPath(cx,cy,R*.27,Math.min(arcStart,arcEnd),Math.max(arcStart,arcEnd))} fill="none" stroke="currentColor" strokeWidth={2}/><text className="fiber-symbol" x={thetaLabel.x} y={thetaLabel.y-9} textAnchor="middle">θ = {numberText(b.relativeAngleDeg)}°</text></>)}
      <circle cx={cx} cy={cy} r={3} fill="#7890a6"/>
    </svg></div><div className="gs-visual-footer"><span>拖动蓝色或紫色端点旋转方向</span><span>沿光传播方向观察</span></div>
  </div>;
}

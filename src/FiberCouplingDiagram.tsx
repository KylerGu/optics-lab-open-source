import { COUPLING_COLORS, quantityStyle } from './quantityColors';
import { useEffect, useRef, useState, type PointerEvent as Pointer } from 'react';
import { fiberCoupling, type CouplingParameters } from './fiberCoupling';
import { arcPath, clamp } from './fiberDiagramGeometry';
import { numberText } from './sceneRuntime';

export type CouplingAnnotation='beamRadiusUm'|'modeRadiusUm'|'offsetUm'|'tiltDeg';
interface Props {p:CouplingParameters;annotations:CouplingAnnotation[];onStart:()=>void;onChange:(key:keyof CouplingParameters,value:number)=>void;onFinish:()=>void}
type Drag={id:number;field:'offsetUm'|'tiltDeg'|'beamRadiusUm';facet:number;cy:number;beamY:number;scale:number};
export default function FiberCouplingDiagram({p,annotations,onStart,onChange,onFinish}:Props) {
  const root=useRef<HTMLDivElement>(null),svg=useRef<SVGSVGElement>(null),drag=useRef<Drag|null>(null);
  const [size,setSize]=useState({w:700,h:600});
  useEffect(()=>{if(!root.current)return;const ro=new ResizeObserver(([e])=>{if(e.contentRect.width&&e.contentRect.height)setSize({w:e.contentRect.width,h:e.contentRect.height});});ro.observe(root.current);return()=>ro.disconnect();},[]);
  const w=Math.max(360,size.w),h=Math.max(500,size.h),scale=Math.min((w-70)/85,(h-150)/60),facet=w/2,cy=h/2;
  const beamY=cy-p.offsetUm*scale,theta=p.tiltDeg*Math.PI/180,L=42,left=facet-L*scale,right=facet+L*scale;
  const source={x:left,y:beamY+L*scale*Math.tan(theta)},half=p.beamRadiusUm*scale,mhalf=p.modeRadiusUm*scale;
  const b=fiberCoupling(p),marked=(key:CouplingAnnotation)=>annotations.includes(key);
  const zR=Math.PI*p.beamRadiusUm**2/(p.wavelengthNm*.001);
  const beamPoint=(z:number,side:number)=>`${facet+z*scale},${beamY-z*scale*Math.tan(theta)+side*half*Math.sqrt(1+(z/zR)**2)}`;
  const envelope=(side:number)=>Array.from({length:61},(_,j)=>beamPoint(-L+L*j/60,side));
  const upper=envelope(-1),lower=envelope(1);
  const point=(e:Pointer<SVGElement>)=>{const pt=svg.current!.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;return pt.matrixTransform(svg.current!.getScreenCTM()!.inverse());};
  const begin=(e:Pointer<SVGElement>,field:Drag['field'])=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.focus();if(field==='beamRadiusUm'){const py=point(e).y;if(Math.abs(py-beamY)<Math.abs(py-(beamY-half)))field='offsetUm';}onStart();drag.current={id:e.pointerId,field,facet,cy,beamY,scale};svg.current?.setPointerCapture(e.pointerId);};
  const move=(e:Pointer<SVGSVGElement>)=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;const pt=point(e);const value=d.field==='offsetUm'?clamp((d.cy-pt.y)/d.scale,-15,15):d.field==='beamRadiusUm'?clamp(Math.abs(d.beamY-pt.y)/d.scale,1,15):clamp(Math.atan2(pt.y-d.beamY,d.facet-pt.x)*180/Math.PI,-5,5);onChange(d.field,Math.round(value*10)/10);};
  const finish=()=>{if(!drag.current)return;drag.current=null;onFinish();};
  const keyboard=(e:React.KeyboardEvent<SVGGElement>,field:Drag['field'])=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();onStart();const bounds=field==='offsetUm'?[-15,15]:field==='tiltDeg'?[-5,5]:[1,15],delta=['ArrowUp','ArrowRight'].includes(e.key)?.1:-.1;onChange(field,e.key==='Home'?bounds[0]:e.key==='End'?bounds[1]:Math.round(clamp(p[field]+delta,...bounds as [number,number])*10)/10);onFinish();};
  const control=(field:Drag['field'],label:string,content:React.ReactNode)=> <g className={`fiber-control coupling-${field}-control`} role="slider" tabIndex={0} aria-label={label} aria-valuenow={p[field]} aria-valuemin={field==='offsetUm'?-15:field==='tiltDeg'?-5:1} aria-valuemax={field==='beamRadiusUm'?15:field==='offsetUm'?15:5} onPointerDown={e=>begin(e,field)} onKeyDown={e=>keyboard(e,field)}>{content}</g>;
  const annotation=(key:CouplingAnnotation,content:React.ReactNode)=>marked(key)?<g className="quantity-annotation" style={quantityStyle(COUPLING_COLORS[key])} pointerEvents="none" data-testid={'coupling-annotation-'+key}>{content}</g>:null;
  return <div className="gs-plot fiber-plot coupling-plot"><div className="fiber-banner"><span>{p.offsetUm===0&&p.tiltDeg===0?'中心与方向已对准':'调整光束与模场对准'}</span></div>
    <div ref={root} className="fiber-canvas"><svg ref={svg} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="单模光纤耦合二维示意" onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
      <defs><linearGradient id="coupling-mode-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#a0cfc4" stopOpacity=".07"/><stop offset=".5" stopColor="#70b6a4" stopOpacity=".3"/><stop offset="1" stopColor="#a0cfc4" stopOpacity=".07"/></linearGradient></defs>
      <rect x={facet} y={cy-20*scale} width={right-facet} height={40*scale} rx={3} fill="#f2f5f9" stroke="#cbd8e5"/>
      <text x={facet+12} y={cy-20*scale-12}>单模光纤</text>
      <rect data-testid="coupling-mode" x={facet} y={cy-mhalf} width={right-facet} height={2*mhalf} fill="url(#coupling-mode-fill)" opacity={.25+.75*b.efficiency}/>
      <path d={`M${facet} ${cy-mhalf}H${right}M${facet} ${cy+mhalf}H${right}`} stroke={COUPLING_COLORS.modeRadiusUm} strokeDasharray="5 4" fill="none"/>
      <line x1={left-20} x2={right+20} y1={cy} y2={cy} stroke="#a7bbcf" strokeDasharray="5 5"/>
      <path data-testid="coupling-input-envelope" d={`M${upper.join('L')}L${[...lower].reverse().join('L')}Z`} fill="#f2e7d5" fillOpacity={.4} stroke={COUPLING_COLORS.beamRadiusUm} strokeWidth={1.7}/>
      <line data-testid="coupling-beam-axis" x1={source.x} y1={source.y} x2={facet} y2={beamY} stroke={COUPLING_COLORS.beamRadiusUm} strokeWidth={1.6}/>
      {control('tiltDeg','图中入射倾角',<><title>拖动入射光源，调整方向</title><line x1={source.x} y1={source.y} x2={facet-15} y2={beamY+15*Math.tan(theta)} stroke="transparent" strokeWidth={14}/><circle cx={source.x} cy={source.y} r={11} fill="transparent"/><circle cx={source.x} cy={source.y} r={5} fill="#fff" stroke={COUPLING_COLORS.tiltDeg} strokeWidth={1.8}/></>)}
      {control('offsetUm','图中横向偏移',<><title>上下拖动端面光斑中心</title><circle cx={facet} cy={beamY} r={10} fill="transparent"/><circle data-testid="coupling-offset-handle" cx={facet} cy={beamY} r={5} fill="#fff" stroke={COUPLING_COLORS.offsetUm} strokeWidth={1.8}/></>)}
      {control('beamRadiusUm','图中光斑半径',<><title>上下拖动光斑边缘，调整大小</title><rect x={facet-9} y={beamY-half-9} width={18} height={18} fill="transparent"/><rect data-testid="coupling-radius-handle" x={facet-3} y={beamY-half-3} width={6} height={6} fill="#fff" stroke={COUPLING_COLORS.beamRadiusUm} strokeWidth={1.5}/></>)}
      {annotation('beamRadiusUm',<><path d={`M${facet-12} ${beamY}V${beamY-half}M${facet-16} ${beamY}h8M${facet-16} ${beamY-half}h8`} fill="none" stroke={COUPLING_COLORS.beamRadiusUm}/><text x={facet-18} y={beamY-half-12} textAnchor="end" className="fiber-symbol">w = {numberText(p.beamRadiusUm)} μm</text></>)}
      {annotation('modeRadiusUm',<><path d={`M${right-12} ${cy}V${cy-mhalf}M${right-16} ${cy}h8M${right-16} ${cy-mhalf}h8`} fill="none" stroke={COUPLING_COLORS.modeRadiusUm}/><text x={right-20} y={cy-mhalf-12} textAnchor="end" className="fiber-symbol">w<tspan baselineShift="sub" fontSize={10}>f</tspan> = {numberText(p.modeRadiusUm)} μm</text></>)}
      {annotation('offsetUm',<><path d={`M${facet+26} ${cy}V${beamY}M${facet+22} ${cy}h8M${facet+22} ${beamY}h8`} fill="none" stroke="#6a91b4"/><text x={facet+34} y={Math.min(cy,beamY)-12} className="fiber-symbol">d = {numberText(p.offsetUm)} μm</text></>)}
      {annotation('tiltDeg',<><line x1={facet-72} x2={facet} y1={beamY} y2={beamY} stroke="#acb9c7" strokeDasharray="3 4"/><path d={arcPath(facet,beamY,58,Math.PI-theta,Math.PI)} stroke={COUPLING_COLORS.beamRadiusUm} strokeWidth={1.8} fill="none"/><path d={`M${facet-90} ${beamY+36}L${facet-56} ${beamY+Math.sin(theta/2)*58}`} stroke={COUPLING_COLORS.beamRadiusUm} fill="none"/><text x={facet-105} y={beamY+51} textAnchor="middle" className="fiber-symbol">θ = {numberText(p.tiltDeg)}°</text></>)}
    </svg></div><div className="gs-visual-footer"><span>拖动光斑中心、边缘或入射光源</span><span>光束与模场示意</span></div>
  </div>;
}

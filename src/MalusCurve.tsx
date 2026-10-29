import { malus, type MalusParameters } from './malus';
import { OpticsExpression } from './OpticsKnowledge';
import { OPTICS_FORMULAS } from './opticsKnowledgeModel';
import { MALUS_COLORS } from './quantityColors';
import { numberText } from './sceneRuntime';
import { useEffect, useRef, useState } from 'react';
export default function MalusCurve({p}:{p:MalusParameters}){
  const root=useRef<SVGSVGElement>(null),[width,setWidth]=useState(280);
  useEffect(()=>{if(!root.current)return;const observer=new ResizeObserver(([e])=>{if(e.contentRect.width)setWidth(Math.max(150,e.contentRect.width));});observer.observe(root.current);return()=>observer.disconnect();},[]);
  const b=malus(p),max=Math.max(1,p.powerMw),right=width-12,x=(a:number)=>36+a/90*(right-36),y=(power:number)=>144-power/max*110;
  const points=Array.from({length:181},(_,j)=>`${x(j/2)},${y(j===180?0:p.powerMw*Math.cos(j/2*Math.PI/180)**2)}`).join(' ');
  return <section className="fiber-curve malus-curve"><h3>功率与夹角</h3><svg ref={root} viewBox={`0 0 ${width} 180`} role="img" aria-label="透射功率随夹角变化曲线">
    {[0,.5,1].map(f=><g key={f}><path d={`M36 ${y(max*f)}H${right}`} stroke="#e3ebf4"/><text x={29} y={y(max*f)+4} textAnchor="end">{numberText(max*f)}</text></g>)}
    <path d={`M36 27V144H${right}`} stroke="#aec0d3" fill="none"/>{[0,45,90].map(a=><text key={a} x={x(a)} y={162} textAnchor="middle">{a}°</text>)}
    <text x={36} y={17} style={{fill:MALUS_COLORS.outputPowerMw}}>P<tspan baselineShift="sub" fontSize={8}>out</tspan> / mW</text>
    <text x={right} y={179} textAnchor="end" style={{fill:MALUS_COLORS.relativeAngleDeg}}>夹角 θ</text>
    <polyline points={points} stroke={MALUS_COLORS.outputPowerMw} strokeWidth={2} fill="none"/>
    <path d={`M${x(b.relativeAngleDeg)} 144V${y(b.outputPowerMw)}`} stroke={MALUS_COLORS.relativeAngleDeg} strokeDasharray="3 3"/>
    <circle data-testid="malus-curve-point" cx={x(b.relativeAngleDeg)} cy={y(b.outputPowerMw)} r={4} fill={MALUS_COLORS.relativeAngleDeg} stroke="#fff" strokeWidth={1.5}/>
  </svg><div className="malus-expression"><OpticsExpression formula={OPTICS_FORMULAS.find(f=>f.id==='malus-power')!}/></div></section>;
}

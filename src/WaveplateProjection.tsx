import { useMemo, useId } from 'react';
import { waveplate, fieldPoint, type WaveplateParameters } from './waveplate';
import { numberText } from './sceneRuntime';
import { WAVEPLATE_COLORS as C, quantityStyle } from './quantityColors';
import type { WaveplateAnnotation } from './Waveplate3D';
export default function WaveplateProjection({p,phase,annotations}:{p:WaveplateParameters;phase:number;annotations:WaveplateAnnotation[]}){
  const b=useMemo(()=>waveplate(p),[p]),tip=fieldPoint(b,phase),R=82,cx=110,cy=109,uid=useId().replace(/:/g,'');
  const path=useMemo(()=>Array.from({length:181},(_,j)=>{const pt=fieldPoint(b,j/180*2*Math.PI);return `${j?'L':'M'}${cx+R*pt.x} ${cy-R*pt.y}`;}).join(' ')+'Z',[b]);
  const psi=b.majorAngleDeg===null?null:b.majorAngleDeg*Math.PI/180;
  return <section className="fiber-curve waveplate-projection"><h3>偏振正视图</h3><svg viewBox="0 0 220 220" role="img" aria-label="沿光传播方向观察的输出偏振正视图">
    <defs><marker id={uid} viewBox="0 0 10 10" refX={8} refY={5} markerWidth={5} markerHeight={5} orient="auto"><path d="M0 0L10 5L0 10Z" fill={C.outputPowerMw}/></marker></defs>
    <circle cx={cx} cy={cy} r={R+7} fill="#f6f9fc" stroke="#e1e8f0"/>
    <path d={`M${cx-R-8} ${cy}H${cx+R+8}M${cx} ${cy-R-8}V${cy+R+8}`} stroke="#c4d3e1" strokeDasharray="3 4" fill="none"/>
    {p.powerMw>0&&<><path data-testid="waveplate-projection-trajectory" d={path} stroke={C.outputPowerMw} strokeWidth={2.2} fill="none"/><line x1={cx} y1={cy} x2={cx+R*tip.x} y2={cy-R*tip.y} stroke={C.outputPowerMw} strokeWidth={1.5} markerEnd={`url(#${uid})`}/><circle data-testid="waveplate-field-tip" cx={cx+R*tip.x} cy={cy-R*tip.y} r={3.5} fill={C.outputPowerMw}/></>}
    {psi!==null&&annotations.includes('majorAngleDeg')&&<g className="waveplate-projection-annotation" style={quantityStyle(C.majorAngleDeg)} data-testid="waveplate-annotation-majorAngleDeg"><line x1={cx-R*Math.cos(psi)} x2={cx+R*Math.cos(psi)} y1={cy+R*Math.sin(psi)} y2={cy-R*Math.sin(psi)} strokeDasharray="3 3"/><text x={cx} y={211} textAnchor="middle">ψ = {numberText(b.majorAngleDeg)}°</text></g>}
    {p.powerMw===0&&<text x={cx} y={cy-9} textAnchor="middle">无输出电场</text>}
  </svg><p>沿光传播方向观察 · 电场归一化</p></section>;
}

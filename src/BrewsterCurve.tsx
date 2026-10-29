import { fresnel,brewster,type PolarizationRefractionParameters } from './polarizationRefraction';
import { REFRACTION_COLORS as C } from './quantityColors';
export default function BrewsterCurve({p}:{p:PolarizationRefractionParameters}){
  const b=brewster(p),x=(a:number)=>30+a/90*222,y=(r:number)=>160-r*124;
  const path=(key:'rs'|'rp')=>Array.from({length:360},(_,i)=>`${i?'L':'M'}${x(i/4)} ${y(fresnel(p.n1,p.n2,i/4)[key])}`).join(' ');
  return <section className="fiber-curve pr-curve"><h3>反射率随入射角</h3><svg viewBox="0 0 282 205" role="img" aria-label="s与p偏振反射率曲线，虚线是当前入射角">
    {[0,.5,1].map(v=><g key={v}><path d={`M30 ${y(v)}H252`} stroke="#e3eaf2"/><text x={24} y={y(v)+4} textAnchor="end">{v*100}</text></g>)}
    <text x={9} y={22}>%</text><path d="M30 36V160H252" fill="none" stroke="#b9c8d9"/>
    <path data-testid="pr-rs-curve" d={path('rs')} stroke={C.rsPct} fill="none" strokeWidth={2}/><path data-testid="pr-rp-curve" d={path('rp')} stroke={C.rpPct} fill="none" strokeWidth={2}/>
    {b.brewsterDeg!==null&&<g><path d={`M${x(b.brewsterDeg)} 155v11`} stroke={C.brewsterDeg}/><text x={x(b.brewsterDeg)} y={190} textAnchor="middle" style={{fill:C.brewsterDeg}}>θB</text></g>}
    <path data-testid="pr-curve-cursor" d={`M${x(p.angleDeg)} 36V160`} stroke={C.angleDeg} strokeDasharray="3 4"/><circle cx={x(p.angleDeg)} cy={y(b.rs)} r={3} fill={C.rsPct}/><circle cx={x(p.angleDeg)} cy={y(b.rp)} r={3} fill={C.rpPct}/>
    {[0,30,60,90].map(v=><text key={v} x={x(v)} y={176} textAnchor="middle">{v}</text>)}<text x={256} y={177}>°</text>
    <text x={46} y={20} style={{fill:C.rsPct}}>s 偏振</text><text x={116} y={20} style={{fill:C.rpPct}}>p 偏振</text>
  </svg><p>s：电场垂直图面；p：电场在图面内。</p></section>;
}

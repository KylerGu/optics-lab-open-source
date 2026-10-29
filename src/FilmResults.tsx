import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Minus, Plus } from 'lucide-react';
import { clamp, filmFmt as fmt, newtonRings, thinFilm, type FilmParameters } from './filmInterference';
import { youngLightColor } from './youngDoubleSlit';
export default function FilmResults({p,annotations,onChange,onStart,onFinish}:{p:FilmParameters;annotations:string[];onChange:(key:keyof FilmParameters,value:number)=>void;onStart:()=>void;onFinish:()=>void}){
  const thin=p.mode===0,b=thinFilm(p),n=newtonRings(p),svg=useRef<SVGSVGElement>(null),uid=useId().replace(/:/g,''),drag=useRef<number|null>(null),marked=(k:string)=>annotations.includes(k);
  const [viewRadius,setViewRadius]=useState(1.5),[scale,setScale]=useState(1);
  useEffect(()=>{const el=svg.current;if(!el)return;const observer=new ResizeObserver(()=>setScale(el.getScreenCTM()?.a??1));observer.observe(el);return()=>observer.disconnect();},[]);
  useEffect(()=>{if(annotations.includes('firstDarkRadius')&&n.firstDarkRadiusMm!==null&&n.firstDarkRadiusMm>viewRadius)setViewRadius(Math.min(3,n.firstDarkRadiusMm*1.1));},[annotations,n.firstDarkRadiusMm]);
  const left=60,right=355,top=thin?85:405,height=115,max=thin?Math.max(.1,Math.ceil(b.max*1000)/10):1,extent=thin?1500:viewRadius;
  const x=(v:number)=>left+v/extent*(right-left),y=(v:number)=>top+height*(1-v/max);
  const val=(v:number)=>thin?b.at(v).reflectance*100:n.at(v).intensity,field=thin?'thicknessNm':'observationRadiusMm',current=p[field],value=val(current);
  const points=Array.from({length:1201},(_,i)=>`${x(extent*i/1200)},${y(val(extent*i/1200))}`).join(' '),rgb=youngLightColor(p.wavelengthNm);
  const visible=current<=extent,sampleCount=600,rings=Array.from({length:thin?0:sampleCount},(_,i)=>{let I=0;for(let j=0;j<4;j++)I+=n.at(extent*(1-(i+(j+.5)/4)/sampleCount)).intensity/4;return {r:150*(1-i/sampleCount),color:`rgb(${rgb.map(c=>Math.round(7+(c-7)*Math.sqrt(I))).join(',')})`};});
  const start=(e:PointerEvent<SVGElement>)=>{if(e.button!==0)return;e.preventDefault();onStart();drag.current=e.pointerId;svg.current!.setPointerCapture(e.pointerId);move(e);};
  const move=(e:PointerEvent<SVGElement>)=>{if(drag.current!==e.pointerId)return;const point=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());onChange(field,clamp(thin?(point.x-left)/(right-left)*1500:point.y<350?Math.abs(point.x-200)/150*extent:(point.x-left)/(right-left)*extent,0,extent));};
  const finish=()=>{if(drag.current===null)return;drag.current=null;onFinish();};
  const keys=(e:React.KeyboardEvent<SVGElement>)=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();onStart();onChange(field,clamp(current+(['ArrowUp','ArrowRight'].includes(e.key)?1:-1)*(thin?1:.01)*(e.shiftKey?10:1),0,extent));onFinish();};
  const slider={role:'slider',tabIndex:0,'aria-label':thin?'曲线上调整膜厚':'圆环和曲线观察半径','aria-valuemin':0,'aria-valuemax':extent,'aria-valuenow':current,onPointerDown:start,onKeyDown:keys};
  return <><svg ref={svg} className="film-results-svg" style={{'--film-result-font':`${Math.max(14,13/Math.max(.3,scale))}px`} as CSSProperties} viewBox={`0 0 400 ${thin?310:570}`} role="img" aria-label={thin?'膜厚与反射率曲线':'牛顿环反射条纹及径向光强曲线'} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
    <defs><clipPath id={uid}><rect x={left} y={top-5} width={right-left} height={height+10}/></clipPath></defs>
    {thin?<text x={200} y={36} textAnchor="middle" className="film-chart-title">膜厚与反射强弱</text>:<>
      <text x={200} y={25} textAnchor="middle" className="film-chart-title">反射条纹 · 牛顿环</text>
      {rings.map((r,i)=><circle key={i} cx={200} cy={190} r={r.r} fill={r.color}/>)}
      {marked('firstDarkRadius')&&n.firstDarkRadiusMm!==null&&n.firstDarkRadiusMm<=extent&&<g data-testid="film-annotation-firstDarkRadius"><circle cx={200} cy={190} r={n.firstDarkRadiusMm/extent*150} stroke="#f0fff9" fill="none" strokeWidth={1.2} strokeDasharray="4 4"/><text className="film-screen-text" x={200} y={322} textAnchor="middle">一阶暗环 r₁ = {fmt(n.firstDarkRadiusMm)} mm</text></g>}
      {marked('observationRadiusMm')&&visible&&<g data-testid="film-ring-radius"><path d={`M200 190H${200+current/extent*150} M200 185V195 M${200+current/extent*150} 185V195`} stroke="#e8fff3" fill="none"/><text className="film-screen-text" x={200} y={62} textAnchor="middle">r = {fmt(current)} mm</text></g>}
      {visible&&<g className="film-handle" {...slider}><circle cx={200+current/extent*150} cy={190} r={13} fill="transparent"/><circle data-testid="film-ring-point" cx={200+current/extent*150} cy={190} r={5} fill="#26836a" stroke="#fff" strokeWidth={1.5}/><text className="film-screen-text" x={200+current/extent*150-9} y={174} textAnchor="end">{current===0?'观察点 · 圆心':'观察点'}</text></g>}
      <path d="M50 358H350 M50 354V362 M200 354V362 M350 354V362" fill="none" stroke="#bacbdf"/><text x={50} y={380} textAnchor="middle">−{fmt(extent)}</text><text x={200} y={380} textAnchor="middle">0</text><text x={350} y={380} textAnchor="middle">{fmt(extent)} mm</text>
    </>}
    <text x={left} y={top-14}>{thin?'反射率 ℛ / %':'相对光强 I / Iₘₐₓ'}</text>
    {[0,max/2,max].map(v=><g key={v}><line x1={left} x2={right} y1={y(v)} y2={y(v)} stroke="#e8eef6"/><text x={left-8} y={y(v)+5} textAnchor="end">{fmt(v)}</text></g>)}
    <g clipPath={`url(#${uid})`}><polyline data-testid="film-result-curve" points={points} fill="none" stroke="#8a5eac" strokeWidth={2}/>{visible&&marked(thin?'reflectance':'intensity')&&<g data-testid={'film-annotation-'+(thin?'reflectance':'intensity')}><path d={`M${left} ${y(value)}H${x(current)}V${top+height}`} stroke="#8a5eac" fill="none" strokeDasharray="4 4"/></g>}</g>
    {visible&&<g className="film-handle" {...slider}><circle cx={x(current)} cy={y(value)} r={14} fill="transparent"/><circle data-testid="film-curve-point" cx={x(current)} cy={y(value)} r={5} fill="#8a5eac" stroke="#fff" strokeWidth={1.5}/></g>}
    {[0,extent/2,extent].map(v=><text key={v} x={x(v)} y={top+height+22} textAnchor="middle">{fmt(v)}</text>)}<text x={right} y={top+height+46} textAnchor="end">{thin?'膜厚 t / nm →':'观察半径 r / mm →'}</text>
    {thin&&<text x={200} y={286} textAnchor="middle" className="film-chart-hint">拖动曲线上的圆点调整膜厚</text>}
  </svg>{!thin&&<div className="film-ring-tools"><button className="icon-button" aria-label="放大圆环" disabled={viewRadius<=.5} onClick={()=>setViewRadius(v=>clamp(v/1.5,.5,3))}><Plus size={16}/></button><span>视野 ±{fmt(viewRadius)} mm</span><button className="icon-button" aria-label="缩小圆环" disabled={viewRadius>=3} onClick={()=>setViewRadius(v=>clamp(v*1.5,.5,3))}><Minus size={16}/></button>{!visible&&<button className="text-button" onClick={()=>setViewRadius(Math.max(1.5,current))}>定位观察点</button>}</div>}</>;
}

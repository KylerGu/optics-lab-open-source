import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { clamp, gapThickness, thinFilm, type FilmParameters } from './filmInterference';
const fmt=(n:number)=>Number(n.toFixed(2)).toString();
export const FILM_COLORS:Record<string,string>={filmIndex:'#357fc6',substrateIndex:'#647b96',incidentAngleDeg:'#c16b37',thicknessNm:'#8a5eac',gapIndex:'#357fc6',centralGapNm:'#c16b37',observationRadiusMm:'#26836a',localThickness:'#8a5eac',intensity:'#8a5eac',reflectance:'#8a5eac',firstDarkRadius:'#647b96'};
export const FILM_MEANINGS:Record<string,string>={filmIndex:'薄膜内部介质的折射率。',substrateIndex:'薄膜下方介质的折射率。',incidentAngleDeg:'入射光与表面法线的夹角。',thicknessNm:'上下表面之间的垂直距离。',gapIndex:'镜片与平板之间介质的折射率。',centralGapNm:'圆心处镜片与平板的间隙；零表示接触。',observationRadiusMm:'从圆心量到观察点的距离。',localThickness:'所选半径处镜片与平板之间的膜厚。',intensity:'曲线上所选观察点的光强，以最亮圆环为1。',reflectance:'反射光强占入射光强的比例。',firstDarkRadius:'光程差等于一个波长的暗环半径。'};
export default function FilmSection({p,annotations,onChange,onStart,onFinish}:{p:FilmParameters;annotations:string[];onChange:(key:keyof FilmParameters,value:number)=>void;onStart:()=>void;onFinish:()=>void}){
  const uid=useId().replace(/:/g,''),svg=useRef<SVGSVGElement>(null),drag=useRef<{id:number;field:keyof FilmParameters;scale:number;value:number;y:number;x:number}|null>(null);
  const marked=(k:string)=>annotations.includes(k),[displayScale,setDisplayScale]=useState(1);
  useEffect(()=>{const el=svg.current;if(!el)return;const observer=new ResizeObserver(()=>setDisplayScale(el.getScreenCTM()?.a??1));observer.observe(el);return()=>observer.disconnect();},[]);
  const start=(e:PointerEvent<SVGGElement>,field:keyof FilmParameters,scale:number)=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.focus();drag.current={id:e.pointerId,field,scale:scale/(svg.current!.getScreenCTM()?.a??1),value:p[field],y:e.clientY,x:e.clientX};svg.current!.setPointerCapture(e.pointerId);onStart();};
  const finish=()=>{if(!drag.current)return;drag.current=null;onFinish();};
  const handle=(field:keyof FilmParameters,scale:number,max:number,label:string)=>({role:'slider',tabIndex:0,'aria-label':label,'aria-valuemin':0,'aria-valuemax':max,'aria-valuenow':p[field],onPointerDown:(e:PointerEvent<SVGGElement>)=>start(e,field,scale),onKeyDown:(e:React.KeyboardEvent<SVGGElement>)=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();onStart();onChange(field,clamp(p[field]+(['ArrowRight','ArrowDown'].includes(e.key)?1:-1)*(field==='observationRadiusMm'?.01:10)*(e.shiftKey?10:1),0,max));onFinish();}});
  const annotation=(key:string,children:React.ReactNode)=><g data-testid={'film-annotation-'+key} fill={FILM_COLORS[key]} stroke={FILM_COLORS[key]} className="film-annotation">{children}</g>;
  const dimension=(x:number,y1:number,y2:number,text:string)=><><path d={`M${x} ${y1}V${y2} M${x-5} ${y1}H${x+5} M${x-5} ${y2}H${x+5}`} fill="none" strokeWidth={1.7}/><text x={Math.min(x+13,775)} y={y2+42} textAnchor="end">{text}</text></>;
  const b=thinFilm(p),top=275,h=p.thicknessNm/(p.thicknessNm+120)*160,bottom=top+h,shift=h*Math.tan(b.angleFilmDeg*Math.PI/180),x0=445-shift,airShift=115*Math.tan(p.incidentAngleDeg*Math.PI/180),x1=x0+2*shift;
  const plate=450,center=445,scaleX=110,scaleY=.035,lower=(r:number)=>plate-gapThickness(p,r)*scaleY,px=center+p.observationRadiusMm*scaleX,py=lower(p.observationRadiusMm);
  const boundary=Array.from({length:161},(_,i)=>{const r=(i/160*6-3);return `${center+r*scaleX},${lower(r)}`;}).join(' ');
  return <svg ref={svg} className="film-section" style={{'--film-text-size':`${16/Math.max(.1,displayScale)}px`} as CSSProperties} viewBox="0 0 900 620" role="img" aria-label={p.mode===0?'薄膜上下表面反射光路截面':'镜片与玻璃平板之间的薄膜截面'} onPointerMove={e=>{const d=drag.current;if(d?.id!==e.pointerId)return;const delta=(d.field==='observationRadiusMm'?e.clientX-d.x:e.clientY-d.y)*d.scale;let value=d.value+delta;if(d.field==='thicknessNm'){const hh=clamp(d.value/(d.value+120)*160+delta,0,1500/1620*160);value=120*hh/(160-hh);}onChange(d.field,clamp(value,0,d.field==='observationRadiusMm'?3:d.field==='centralGapNm'?1000:1500));}} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
    <defs><linearGradient id={uid+'-glass'} x2="0" y2="1"><stop stopColor="#edf5fc"/><stop offset="1" stopColor="#dae8f5"/></linearGradient>{['blue','orange','gray'].map((c,i)=><marker key={c} id={uid+c} viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L8 4L0 8Z" fill={['#357fc6','#c16b37','#7790ac'][i]}/></marker>)}</defs>
    {p.mode===0?<>
      <rect x={100} y={bottom} width={695} height={130} rx={2} fill={`url(#${uid}-glass)`}/><rect x={100} y={top} width={695} height={h} fill="#e5f2f0"/>
      <path d={`M100 ${top}H795 M100 ${bottom}H795`} stroke="#9eb8c9" strokeWidth={2} fill="none"/>
      <text className="film-medium" x={130} y={240}>空气</text>{!marked('substrateIndex')&&<text className="film-medium" x={130} y={bottom+95}>基底</text>}
      {h>25&&<text className="film-medium" x={130} y={top+h/2+6}>薄膜</text>}
      <path d={`M${x0-airShift} 160L${x0} ${top}`} stroke="#7790ac" strokeWidth={3} markerEnd={`url(#${uid}gray)`}/>
      <path d={`M${x0} ${top}L${x0+airShift} 160`} stroke="#357fc6" strokeWidth={3} strokeDasharray={p.incidentAngleDeg===0?'8 5':undefined} fill="none" markerEnd={`url(#${uid}blue)`}/>
      <path d={`M${x0} ${top}L${x0+shift} ${bottom}`} stroke="#c16b37" strokeWidth={3} fill="none"/>
      {Math.abs(b.b)>1e-12&&<><path d={`M${x0+shift} ${bottom}L${x1} ${top}L${x1+airShift} 160`} stroke="#c16b37" strokeWidth={3} fill="none" markerEnd={`url(#${uid}orange)`}/><circle cx={x0+shift} cy={bottom} r={4} fill="#c16b37"/></>}
      {p.incidentAngleDeg===0&&<path d={`M${x0} ${top}V160`} stroke="#357fc6" strokeWidth={3} strokeDasharray="8 5" markerEnd={`url(#${uid}blue)`}/>}
      <circle cx={x0} cy={top} r={4} fill="#357fc6"/>
      <g className="film-ray-legend"><path d="M145 70H175" stroke="#7790ac" strokeWidth={3}/><text x={185} y={76}>入射光</text><path d="M330 70H360" stroke="#357fc6" strokeWidth={3}/><text x={370} y={76}>上表面反射</text><path d="M620 70H640" stroke="#c16b37" strokeWidth={3}/><text x={650} y={76}>下表面反射</text></g>
      {marked('filmIndex')&&annotation('filmIndex',<text x={595} y={top+h/2+6}>{h>25?'n = '+fmt(p.filmIndex):'薄膜 n = '+fmt(p.filmIndex)}</text>)}
      {marked('substrateIndex')&&annotation('substrateIndex',<text x={130} y={bottom+95}>基底 nₛ = {fmt(p.substrateIndex)}</text>)}
      {marked('incidentAngleDeg')&&annotation('incidentAngleDeg',<><line x1={x0} x2={x0} y1={top-92} y2={bottom+25} stroke="#9bb0c5" strokeDasharray="5 5"/><path d={`M${x0} ${top-55}A55 55 0 0 0 ${x0-55*Math.sin(p.incidentAngleDeg*Math.PI/180)} ${top-55*Math.cos(p.incidentAngleDeg*Math.PI/180)}`} fill="none" strokeWidth={1.5}/><text x={x0-112} y={top-76}>θ₀ = {fmt(p.incidentAngleDeg)}°</text>{h>32&&<><text x={x0+45} y={bottom+40}>θ₂ = {fmt(b.angleFilmDeg)}°</text><path d={`M${x0} ${top+32}A32 32 0 0 0 ${x0+32*Math.sin(b.angleFilmDeg*Math.PI/180)} ${top+32*Math.cos(b.angleFilmDeg*Math.PI/180)}`} fill="none" strokeWidth={1.5}/></>}</>)}
      {marked('thicknessNm')&&annotation('thicknessNm',<><path d={`M745 ${top}V${bottom} M740 ${top}H750 M740 ${bottom}H750`} fill="none" strokeWidth={1.7}/><text x={775} y={bottom+80} textAnchor="end">t = {fmt(p.thicknessNm)} nm</text></>)}
      <g className="film-handle film-vertical-handle" {...handle('thicknessNm',1,1500,'拖动下表面调整膜厚')}><path d={`M685 ${bottom}H730`} stroke="#8a5eac" strokeWidth={4}/><rect x={675} y={bottom-14} width={65} height={28} fill="transparent"/><circle cx={705} cy={bottom} r={6} fill="#fff" stroke="#8a5eac" strokeWidth={2}/></g>
      {p.thicknessNm===0&&<text className="film-caption" x={450} y={510} textAnchor="middle">膜厚为零：上下界面重合</text>}
    </>:<>
      <polygon points={`115,${110-p.centralGapNm*scaleY} 775,${110-p.centralGapNm*scaleY} ${boundary.split(' ').reverse().join(' ')}`} fill={`url(#${uid}-glass)`} stroke="#97b4cc" strokeWidth={2}/>
      <polygon points={`${boundary} 775,${plate} 115,${plate}`} fill="#e5f2f0"/>
      <polyline points={boundary} fill="none" stroke="#97b4cc" strokeWidth={2}/>
      <rect x={100} y={plate} width={690} height={70} rx={3} fill={`url(#${uid}-glass)`} stroke="#97b4cc" strokeWidth={2}/>
      <text className="film-medium" x={155} y={155-p.centralGapNm*scaleY}>平凸镜片 · 玻璃</text><text className="film-medium" x={155} y={492}>玻璃平板</text>
      <path d="M420 35V65 M470 35V65 M520 35V65" stroke="#7790ac" strokeWidth={2} markerEnd={`url(#${uid}gray)`}/><text className="film-medium" x={295} y={55} textAnchor="end">单色光正入射</text>
      <line x1={center} x2={center} y1={110-p.centralGapNm*scaleY} y2={535} stroke="#a7bacc" strokeDasharray="5 5"/>
      <text className="film-caption" x={center} y={551} textAnchor="middle">圆心</text>
      <g className="film-handle" {...handle('observationRadiusMm',1/scaleX,3,'截面观察点半径')}><path d={`M${px} ${py}V${plate}`} stroke="#26836a" strokeWidth={2}/><circle cx={px} cy={plate} r={14} fill="transparent"/><circle data-testid="film-section-point" cx={px} cy={plate} r={6} fill="#26836a" stroke="#fff" strokeWidth={2}/><text className="film-point-label" x={px+11} y={plate+24}>观察点</text></g>
      {marked('gapIndex')&&annotation('gapIndex',<text x={140} y={414}>{p.gapIndex===1?'空气膜':'介质薄膜'} n = {fmt(p.gapIndex)}</text>)}
      {marked('observationRadiusMm')&&annotation('observationRadiusMm',<><path d={`M${center} 580H${px} M${center} 575V585 M${px} 575V585`} fill="none" strokeWidth={1.5}/><text x={(center+px)/2} y={608} textAnchor="middle">r = {fmt(p.observationRadiusMm)} mm</text></>)}
      {marked('centralGapNm')&&annotation('centralGapNm',<><path d={`M${center-15} ${lower(0)}V${plate} M${center-20} ${lower(0)}H${center-10} M${center-20} ${plate}H${center-10}`} fill="none" strokeWidth={1.6}/><path d={`M${center-17} ${(lower(0)+plate)/2}L${center-70} 365H${center-120}`} fill="none" strokeWidth={1}/><text x={center-128} y={358} textAnchor="end">t₀ = {fmt(p.centralGapNm)} nm</text></>)}
      {marked('localThickness')&&annotation('localThickness',dimension(px+30,py,plate,'t = '+fmt(gapThickness(p,p.observationRadiusMm))+' nm'))}
      <g className="film-handle film-vertical-handle" {...handle('centralGapNm',-1/scaleY,1000,'拖动镜片调整中心间隙')} transform={`translate(0,${-p.centralGapNm*scaleY})`}><rect x={620} y={85} width={140} height={50} fill="transparent"/><path d="M680 108H730" stroke="#c16b37" strokeWidth={3}/><circle cx={705} cy={108} r={6} fill="#fff" stroke="#c16b37" strokeWidth={2}/></g>
    </>}
  </svg>;
}

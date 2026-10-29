import { useRef, type PointerEvent } from 'react';
import { Minus, Plus } from 'lucide-react';
import { circularDiffraction, type CircularParameters } from './circularDiffraction';
import { youngLightColor } from './youngDoubleSlit';

type Props = { p:CircularParameters; annotations:string[]; viewRadius:number; zoom:number; onZoom:(factor:number)=>void; onFit:()=>void; onStart:()=>void; onChange:(value:number)=>void; onFinish:()=>void };
export default function CircularObservation({p,annotations,viewRadius,zoom,onZoom,onFit,onStart,onChange,onFinish}:Props) {
  const svg=useRef<SVGSVGElement>(null),drag=useRef<{id:number;x:number;value:number}|null>(null);
  const b=circularDiffraction(p),rgb=youngLightColor(p.wavelengthNm),cx=115,cy=105,R=94,rr=(r:number)=>R*r/viewRadius;
  const rings=Array.from({length:481},(_,i)=>{const radius=R*(1-i/481),intensity=b.at(viewRadius*(1-(i+.5)/481)).intensity;return {radius,color:`rgb(${rgb.map(c=>Math.round(7+(c-7)*intensity**.28)).join(',')})`};});
  const marked=(k:string)=>annotations.includes(k),visible=p.observationRadiusUm<=viewRadius;
  const begin=(e:PointerEvent<SVGGElement>)=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.focus();onStart();const q=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());drag.current={id:e.pointerId,x:q.x,value:p.observationRadiusUm};svg.current!.setPointerCapture(e.pointerId);};
  const end=()=>{if(drag.current){drag.current=null;onFinish();}};
  return <section className="gfocus-spot circular-screen" aria-label="观察屏">
    <div className="gs-spot-heading"><h2>观察屏</h2><span>焦平面</span></div>
    <svg ref={svg} className="gs-spot-image" viewBox="0 0 230 230" role="img" aria-label="焦平面上的艾里圆环，可拖动观察点" onPointerMove={e=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;const q=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());onChange(Number(Math.max(0,Math.min(500,d.value+(q.x-d.x)/R*viewRadius)).toFixed(5)));}} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
      <rect width="230" height="230" rx="12" fill="#07110a"/>
      <g data-testid="circular-rings">{rings.map((r,i)=><circle key={i} cx={cx} cy={cy} r={r.radius} fill={r.color}/>)}</g>
      {marked('firstDark')&&b.firstDarkRadiusUm<=viewRadius&&<g data-testid="circular-annotation-firstDark"><circle cx={cx} cy={cy} r={rr(b.firstDarkRadiusUm)} stroke="#a1c3df" fill="none" strokeDasharray="3 4"/><text className="circular-dark-symbol" x={cx+6} y={cy-rr(b.firstDarkRadiusUm)-7}>r₁</text></g>}
      {marked('airyDiameter')&&b.firstDarkRadiusUm<=viewRadius&&<g data-testid="circular-annotation-airyDiameter"><path d={`M${cx-rr(b.firstDarkRadiusUm)} ${cy+12}H${cx+rr(b.firstDarkRadiusUm)}`} stroke="#e6d8f3"/><text className="circular-dark-symbol" x={cx} y={cy+29} textAnchor="middle">dₐ</text></g>}
      {visible&&<g role="slider" tabIndex={0} aria-label="图中观察半径" aria-valuemin={0} aria-valuemax={500} aria-valuenow={p.observationRadiusUm} className="circular-observation-handle" data-testid="circular-observation-handle" onPointerDown={begin} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();onStart();onChange(Math.max(0,Math.min(500,p.observationRadiusUm+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?10:1))));onFinish();}}>
        <circle cx={cx+rr(p.observationRadiusUm)} cy={cy} r={12} fill="transparent"/>{marked('observationRadiusUm')&&<g data-testid="circular-annotation-observationRadiusUm"><line x1={cx} x2={cx+rr(p.observationRadiusUm)} y1={cy} y2={cy} stroke="#b9e5d6"/><text className="circular-dark-symbol" x={cx+rr(p.observationRadiusUm)/2+6} y={cy-11}>r</text></g>}<circle cx={cx+rr(p.observationRadiusUm)} cy={cy} r={3.5} fill="#26836a" stroke="#fff" strokeWidth="1.2"/>
      </g>}
      {marked('intensity')&&<text data-testid="circular-annotation-intensity" className="circular-dark-symbol" x="14" y="22">I / I₀</text>}
      <text x={cx} y="216" fill="#aac3df" fontSize="10" textAnchor="middle">横向范围 ±{Number(viewRadius.toFixed(2))} μm</text>
    </svg>
    {!visible&&<button className="text-button" onClick={onFit}>观察点在视野外 · 定位</button>}
    <div className="circular-screen-controls"><button className="text-button" onClick={onFit}>适配图样</button><div className="gs-plot-controls"><button className="icon-button" aria-label="缩小圆孔图" disabled={zoom<=.16} onClick={()=>onZoom(1/1.35)}><Minus size={14}/></button><span>{Number(zoom.toFixed(2))}×</span><button className="icon-button" aria-label="放大圆孔图" disabled={zoom>=40} onClick={()=>onZoom(1.35)}><Plus size={14}/></button></div></div>
  </section>;
}

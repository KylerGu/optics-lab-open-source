import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { FOUR_F_FIELDS, type FourFParameters } from './fourF';
import { fourierLens } from './fourierLens';
import { youngLightColor } from './youngDoubleSlit';
type Field='periodMm'|'waistMm'|'focalLengthMm'|'filterWidthUm'|'filterOffsetUm';
type Props={p:FourFParameters;annotations:string[];onStart:()=>void;onChange:(key:keyof FourFParameters,value:number)=>void;onFinish:()=>void};
export default function FourFApparatus({p,annotations,onStart,onChange,onFinish}:Props){
  const svg=useRef<SVGSVGElement>(null),drag=useRef<{id:number;field:Field;origin:number;value:number;scale:number}|null>(null);
  const [size,setSize]=useState({width:760,height:540});
  useEffect(()=>{const o=new ResizeObserver(([e])=>setSize({width:e.contentRect.width,height:e.contentRect.height}));o.observe(svg.current!);return()=>o.disconnect();},[]);
  const W=size.width,H=size.height,y=H/2,half=Math.min(H*.27,150),cx=W/2,zScale=(W-100)/520;
  const positions=[-2,-1,0,1,2].map(n=>cx+n*p.focalLengthMm*zScale),[input,l1,filter,l2,output]=positions;
  const b=fourierLens({...p,observationUm:0}),extent=Math.max(800,b.orderPositionUm*1.25,Math.abs(p.filterOffsetUm)+p.filterWidthUm/2+50),s=half/extent;
  const center=y-p.filterOffsetUm*s,top=center-p.filterWidthUm*s/2,bottom=center+p.filterWidthUm*s/2,marked=(k:string)=>annotations.includes(k);
  const color=`rgb(${youngLightColor(p.wavelengthNm).join(',')})`,inputScale=half/3;
  const point=(e:PointerEvent)=>new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
  const bound=(field:Field,value:number)=>{const f=FOUR_F_FIELDS.find(f=>f.key===field)!;return Number(Math.max(f.min,Math.min(f.max,value)).toFixed(5));};
  const end=()=>{if(drag.current){drag.current=null;onFinish();}};
  const handle=(field:Field,name:string,scale:number)=>{const f=FOUR_F_FIELDS.find(f=>f.key===field)!;return {role:'slider',tabIndex:0,'aria-label':name,'aria-valuemin':f.min,'aria-valuemax':f.max,'aria-valuenow':p[field],onPointerDown:(e:PointerEvent<SVGGElement>)=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.focus();onStart();drag.current={id:e.pointerId,field,origin:field==='focalLengthMm'?point(e).x:point(e).y,value:p[field],scale};svg.current!.setPointerCapture(e.pointerId);},onKeyDown:(e:KeyboardEvent)=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();onStart();onChange(field,bound(field,e.key==='Home'?f.min:e.key==='End'?f.max:p[field]+(['ArrowUp','ArrowRight'].includes(e.key)?1:-1)*f.step*(e.shiftKey?10:1)));},onKeyUp:onFinish,onBlur:()=>{end();onFinish();}};};
  const knob=(x:number,qy:number,color:string)=><><circle cx={x} cy={qy} r={12} fill="transparent"/><circle cx={x} cy={qy} r={4} fill="#fff" stroke={color} strokeWidth={1.6}/></>;
  return <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="4f二维光路，可拖动滤波宽度、位置、焦距和输入参数" data-testid="4f-apparatus" onPointerMove={e=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;const q=point(e);onChange(d.field,bound(d.field,d.value+((d.field==='focalLengthMm'?q.x:q.y)-d.origin)*d.scale));}} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
    <line x1={18} x2={W-18} y1={y} y2={y} className="gs-axis"/>
    {['输入','透镜 1','滤波面','透镜 2','输出'].map((title,i)=><text key={title} x={positions[i]} y={y-half-28} textAnchor="middle" className="fourier-title">{title}</text>)}
    {(p.modulation?[-1,0,1]:[0]).map(order=>{
      const fy=y-order*b.orderPositionUm*s,transmits=p.filterMode===2||((Math.abs(order*b.orderPositionUm-p.filterOffsetUm)<=p.filterWidthUm/2)===(p.filterMode===0));
      return [-1,1].map(ray=>{const a=ray*p.waistMm*inputScale*.6,atLens=y+a+(fy-y);return <g key={order+':'+ray}><path d={`M${input} ${y+a}L${l1} ${atLens}L${filter} ${fy}`} fill="none" stroke={order? '#8a5eac':color} strokeWidth={1.3} opacity={order?p.modulation*.6:.65}/><path d={`M${filter} ${fy}L${l2} ${y-a+(fy-y)}L${output} ${y-a}`} fill="none" stroke={order?'#8a5eac':color} strokeWidth={1.3} opacity={transmits?(order?p.modulation*.6:.65):.14} strokeDasharray={transmits?undefined:'4 5'}/></g>;});
    })}
    <rect x={input-5} y={y-half} width={10} height={half*2} fill="#10203a"/>
    {Array.from({length:240},(_,i)=>{const a=b.inputAmplitude(3*(1-2*(i+.5)/240)),v=Math.round(22+225*a);return <rect key={i} x={input-5} y={y-half+i*half*2/240} width={10} height={half*2/240+.2} fill={`rgb(${v},${v},${v})`}/>;})}
    {[l1,l2].map((x,i)=><path key={i} d={`M${x} ${y-half}Q${x+18} ${y} ${x} ${y+half}Q${x-18} ${y} ${x} ${y-half}Z`} fill="#d8e8f7" fillOpacity=".55" stroke="#357fc6" strokeWidth={1.7}/>)}
    <line x1={filter} x2={filter} y1={y-half} y2={y+half} stroke="#97a9be" strokeDasharray="4 4"/>
    {p.filterMode!==2&&<>
      {(p.filterMode===0?[[y-half,top],[bottom,y+half]]:[[top,bottom]]).map(([a,b],i)=><rect key={i} x={filter-5} y={Math.max(y-half,a)} width={10} height={Math.max(0,Math.min(y+half,b)-Math.max(y-half,a))} fill="#506078"/>)}
      <g {...handle('filterOffsetUm','拖动滤波片调位置',-1/s)} className="fourier-vertical-handle" data-testid="4f-offset-handle"><path d={`M${filter-13} ${center}H${filter+13}`} stroke="#26836a"/>{knob(filter,center,'#26836a')}</g>
      <g {...handle('filterWidthUm','拖动滤波边缘调全宽',-2/s)} className="fourier-vertical-handle" data-testid="4f-width-handle"><path d={`M${filter+20} ${top}V${bottom}M${filter+15} ${bottom}h10`} fill="none" stroke="#c16b37"/>{knob(filter+20,top,'#c16b37')}{marked('filterWidthUm')&&<text className="fourier-symbol" data-testid="4f-annotation-filterWidthUm" x={filter+28} y={center+6}>a</text>}</g>
    </>}
    {p.filterMode!==2&&marked('filterOffsetUm')&&<g data-testid="4f-annotation-filterOffsetUm"><path d={`M${filter-20} ${y}V${center}`} stroke="#26836a"/><text className="fourier-symbol" x={filter-32} y={center-9}>c</text></g>}
    {marked('cutoffFrequency')&&p.filterMode!==2&&<text data-testid="4f-annotation-cutoffFrequency" className="fourier-symbol" x={filter+12} y={y+half+19}>ν꜀</text>}
    <g {...handle('focalLengthMm','拖动输出面调焦距',1/(2*zScale))} className="fourier-horizontal-handle" data-testid="4f-focal-handle"><rect x={output-10} y={y-half} width={20} height={half*2} fill="transparent"/><line x1={output} x2={output} y1={y-half} y2={y+half} stroke="#26836a" strokeWidth={2}/>{knob(output,y,'#26836a')}</g>
    {p.modulation>0&&<g {...handle('periodMm','拖动输入条纹调周期',-1/inputScale)} className="fourier-vertical-handle" data-testid="4f-period-handle">{knob(input-20,y-p.periodMm*inputScale,'#c16b37')}{marked('periodMm')&&<text className="fourier-symbol" data-testid="4f-annotation-periodMm" x={input-33} y={y-p.periodMm*inputScale-7}>d</text>}</g>}
    <g {...handle('waistMm','拖动输入光束调半径',-1/inputScale)} className="fourier-vertical-handle" data-testid="4f-waist-handle"><path d={`M${input+17} ${y}V${y-p.waistMm*inputScale}`} stroke="#c16b37"/>{knob(input+17,y-p.waistMm*inputScale,'#c16b37')}{marked('waistMm')&&<text className="fourier-symbol" data-testid="4f-annotation-waistMm" x={input+26} y={y-p.waistMm*inputScale/2}>w</text>}</g>
    {marked('wavelengthNm')&&<text className="fourier-symbol" data-testid="4f-annotation-wavelengthNm" x={input+8} y={y-half-8}>λ</text>}
    {marked('modulation')&&<text className="fourier-symbol" data-testid="4f-annotation-modulation" x={input} y={y+half+18}>m</text>}
    {marked('focalLengthMm')&&<g data-testid="4f-annotation-focalLengthMm" className="fourier-dimension">{[[input,l1,'f'],[l1,l2,'2f'],[l2,output,'f']].map(([a,b,label],i)=><g key={i}><path d={`M${a} ${y+half+30}H${b}M${a} ${y+half+25}v10M${b} ${y+half+25}v10`}/><text className="fourier-symbol" x={(Number(a)+Number(b))/2} y={y+half+52} textAnchor="middle">{label}</text></g>)}</g>}
  </svg>;
}

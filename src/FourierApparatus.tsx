import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { FOURIER_FIELDS, fourierLens, type FourierParameters } from './fourierLens';
import { youngLightColor } from './youngDoubleSlit';

type Field='periodMm'|'waistMm'|'focalLengthMm'|'observationUm';
type Props={p:FourierParameters;annotations:string[];viewRadius:number;onStart:()=>void;onChange:(field:keyof FourierParameters,value:number)=>void;onFinish:()=>void};
export default function FourierApparatus({p,annotations,viewRadius,onStart,onChange,onFinish}:Props) {
  const svg=useRef<SVGSVGElement>(null),[size,setSize]=useState({width:760,height:560});
  const drag=useRef<{id:number;field:Field;origin:number;value:number;scale:number}|null>(null);
  useEffect(()=>{const observer=new ResizeObserver(([e])=>setSize({width:e.contentRect.width,height:e.contentRect.height}));observer.observe(svg.current!);return()=>observer.disconnect();},[]);
  const {width:W,height:H}=size,y=H/2,lens=W*.5,zScale=W*.35/250,input=lens-p.focalLengthMm*zScale,screen=lens+p.focalLengthMm*zScale;
  const half=Math.min(H*.29,180),inputScale=half/3,b=fourierLens(p),color=`rgb(${youngLightColor(p.wavelengthNm).join(',')})`;
  const marked=(k:string)=>annotations.includes(k),point=(x:number,y:number)=>new DOMPoint(x,y).matrixTransform(svg.current!.getScreenCTM()!.inverse());
  const bound=(field:Field,value:number)=>{const f=FOURIER_FIELDS.find(f=>f.key===field)!;return Number(Math.max(f.min,Math.min(f.max,value)).toFixed(5));};
  const end=()=>{if(drag.current){drag.current=null;onFinish();}};
  const begin=(e:PointerEvent<SVGGElement>,field:Field)=>{
    if(e.button!==0)return;e.preventDefault();e.currentTarget.focus();onStart();const q=point(e.clientX,e.clientY);
    drag.current={id:e.pointerId,field,origin:field==='focalLengthMm'?q.x:q.y,value:p[field],scale:field==='focalLengthMm'?1/zScale:field==='observationUm'?-viewRadius/half:-1/inputScale};svg.current!.setPointerCapture(e.pointerId);
  };
  const props=(field:Field,name:string)=>{const f=FOURIER_FIELDS.find(f=>f.key===field)!;return {
    role:'slider',tabIndex:0,'aria-label':name,'aria-valuemin':f.min,'aria-valuemax':f.max,'aria-valuenow':p[field],
    onPointerDown:(e:PointerEvent<SVGGElement>)=>begin(e,field),onBlur:()=>{end();onFinish();},onKeyUp:onFinish,
    onKeyDown:(e:KeyboardEvent<SVGGElement>)=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();onStart();const next=e.key==='Home'?f.min:e.key==='End'?f.max:p[field]+(['ArrowRight','ArrowUp'].includes(e.key)?1:-1)*f.step*(e.shiftKey?10:1);onChange(field,bound(field,next));},
  };};
  const orderY=Math.min(b.orderPositionUm/viewRadius,.82)*half;
  return <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="傅里叶二维光路，可拖动条纹周期、光束半径和频谱面" data-testid="fourier-apparatus"
    onPointerMove={e=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;const q=point(e.clientX,e.clientY);onChange(d.field,bound(d.field,d.value+((d.field==='focalLengthMm'?q.x:q.y)-d.origin)*d.scale));}} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
    <line className="gs-axis" x1={20} x2={W-20} y1={y} y2={y}/>
    <text className="fourier-title" x={input} y={y-half-26} textAnchor="middle">输入面</text><text className="fourier-title" x={lens} y={y-half-26} textAnchor="middle">透镜</text><text className="fourier-title" x={screen} y={y-half-26} textAnchor="middle">频谱面</text>
    {(p.modulation?[-1,0,1]:[0]).map(order=>[-1,0,1].map(ray=>{
      const offset=-order*orderY,a=ray*p.waistMm*inputScale*.55,c=a+offset;
      return <path key={order+':'+ray} d={`M${input} ${y+a}L${lens} ${y+c}L${screen} ${y+offset}`} fill="none" stroke={order===0?color:'#8a5eac'} strokeWidth={order===0?1.6:1.3} strokeOpacity={order===0?.65:p.modulation*.55}/>;
    }))}
    <rect x={input-7} y={y-half} width="14" height={half*2} rx="2" fill="#10203a"/>
    {Array.from({length:320},(_,i)=>{const x=3*(1-2*(i+.5)/320),a=b.inputAmplitude(x);const v=Math.round(22+225*a);return <rect key={i} x={input-6} y={y-half+i/320*half*2} width="12" height={half*2/320+.2} fill={`rgb(${v},${v},${v})`}/>;})}
    <path d={`M${lens} ${y-half}Q${lens+24} ${y} ${lens} ${y+half}Q${lens-24} ${y} ${lens} ${y-half}Z`} fill="#d8e8f7" fillOpacity=".55" stroke="#357fc6" strokeWidth="1.8"/>
    <g {...props('focalLengthMm','拖动频谱面调焦距')} className="fourier-horizontal-handle" data-testid="fourier-focal-handle"><rect x={screen-13} y={y-half} width="26" height={half*2} fill="transparent"/><line x1={screen} x2={screen} y1={y-half} y2={y+half} stroke="#26836a" strokeWidth="2"/><circle cx={screen} cy={y} r="4.5" fill="#fff" stroke="#26836a" strokeWidth="1.8"/></g>
    {p.modulation>0&&<g {...props('periodMm','拖动输入条纹调周期')} className="fourier-vertical-handle" data-testid="fourier-period-handle"><path d={`M${input-25} ${y}V${y-p.periodMm*inputScale}M${input-30} ${y}h10`} stroke="#c16b37" fill="none"/><circle cx={input-25} cy={y-p.periodMm*inputScale} r="13" fill="transparent"/><circle cx={input-25} cy={y-p.periodMm*inputScale} r="4.5" fill="#fff" stroke="#c16b37" strokeWidth="1.8"/>{marked('periodMm')&&<text data-testid="fourier-annotation-periodMm" className="fourier-symbol" x={input-37} y={y-p.periodMm*inputScale-6} textAnchor="end">d</text>}</g>}
    <g {...props('waistMm','拖动输入光束调半径')} className="fourier-vertical-handle" data-testid="fourier-waist-handle"><path d={`M${input+25} ${y}V${y-p.waistMm*inputScale}M${input+20} ${y}h10`} stroke="#c16b37" fill="none"/><circle cx={input+25} cy={y-p.waistMm*inputScale} r="13" fill="transparent"/><circle cx={input+25} cy={y-p.waistMm*inputScale} r="4.5" fill="#fff" stroke="#c16b37" strokeWidth="1.8"/>{marked('waistMm')&&<text data-testid="fourier-annotation-waistMm" className="fourier-symbol" x={input+35} y={y-p.waistMm*inputScale/2}>w</text>}</g>
    {marked('wavelengthNm')&&<text data-testid="fourier-annotation-wavelengthNm" className="fourier-symbol" x={Math.max(20,input-45)} y={y-90}>λ</text>}
    {marked('modulation')&&<text data-testid="fourier-annotation-modulation" className="fourier-symbol" x={input} y={y+half+23} textAnchor="middle">m</text>}
    {marked('spatialFrequency')&&<text data-testid="fourier-annotation-spatialFrequency" className="fourier-symbol" x={input} y={y-half-50} textAnchor="middle">ν₀</text>}
    {marked('focalLengthMm')&&<g data-testid="fourier-annotation-focalLengthMm" className="fourier-dimension">{[input,lens].map((x,i)=><g key={i}><path d={`M${x} ${y+half+35}H${i?screen:lens}M${x} ${y+half+30}v10M${i?screen:lens} ${y+half+30}v10`}/><text className="fourier-symbol" x={(x+(i?screen:lens))/2} y={y+half+58} textAnchor="middle">f</text></g>)}</g>}
    {marked('orderPosition')&&p.modulation>0&&<g data-testid="fourier-annotation-orderPosition" className="fourier-dimension"><path d={`M${screen+18} ${y}V${y-orderY}M${screen+13} ${y-orderY}h10M${screen+13} ${y}h10`}/><text className="fourier-symbol" x={screen+25} y={y-orderY/2}>x₁</text></g>}
    {p.observationUm!==0&&Math.abs(p.observationUm)<=viewRadius&&<circle cx={screen} cy={y-p.observationUm/viewRadius*half} r="3.5" fill="#26836a" stroke="#fff" strokeWidth="1.2" pointerEvents="none"/>}
  </svg>;
}

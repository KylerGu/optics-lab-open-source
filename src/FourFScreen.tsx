import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Minus, Plus } from 'lucide-react';
import { fourF, type FourFParameters } from './fourF';
import { youngLightColor } from './youngDoubleSlit';
type Props={p:FourFParameters;b:ReturnType<typeof fourF>;annotations:string[];viewRadius:number;zoom:number;onZoom:(factor:number)=>void;onFit:()=>void;onStart:()=>void;onChange:(v:number)=>void;onFinish:()=>void};
export default function FourFScreen({p,b,annotations,viewRadius,zoom,onZoom,onFit,onStart,onChange,onFinish}:Props){
  const [view,setView]=useState<'output'|'spectrum'|'input'>('output'),canvas=useRef<HTMLCanvasElement>(null),svg=useRef<SVGSVGElement>(null),drag=useRef<{id:number;x:number;value:number}|null>(null);
  const marked=(k:string)=>annotations.includes(k),cx=115,cy=105,R=96;
  const spectrumRadius=Math.max(600,b.orderPositionUm*1.3,Math.abs(p.filterOffsetUm)+p.filterWidthUm/2+50),extent=view==='spectrum'?spectrumRadius:viewRadius;
  const sx=(x:number)=>cx+x/extent*R;
  useEffect(()=>{
    const n=256,ctx=canvas.current!.getContext('2d')!;canvas.current!.width=n;canvas.current!.height=n;
    const image=ctx.createImageData(n,n),rgb=youngLightColor(p.wavelengthNm),base=[7,14,23];
    const horizontal=Array.from({length:n},(_,i)=>{const x=((i+.5)/n*230-cx)/R*extent;return view==='spectrum'?Math.sqrt(b.spectrum.at(x).intensity)*b.mask(x):view==='input'?Math.abs(b.input(x)):Math.sqrt(b.at(x));});
    const vertical=Array.from({length:n},(_,i)=>{const y=((i+.5)/n*230-cy)/R*extent,w=view==='spectrum'?b.spectrum.spotRadiusUm:p.waistMm;return Math.exp(-((y/w)**2));});
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){const v=Math.min(1,horizontal[x]*vertical[y]),o=(y*n+x)*4;for(let c=0;c<3;c++)image.data[o+c]=Math.round(base[c]+(rgb[c]-base[c])*v);image.data[o+3]=255;}
    ctx.putImageData(image,0,0);
  },[p,b,view,extent]);
  const point=(e:PointerEvent)=>new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
  const end=()=>{if(drag.current){drag.current=null;onFinish();}};
  const visible=Math.abs(p.observationMm)<=viewRadius;
  return <section className="gfocus-spot fourier-screen" aria-label="4f观察屏"><div className="gs-spot-heading"><h2>{view==='output'?'输出屏':view==='input'?'输入图样':'滤后频谱'}</h2><span>{view==='spectrum'?'μm':'mm'}</span></div>
    <div className="gs-presets four-f-screen-tabs">{[{key:'output',label:'输出'},{key:'spectrum',label:'频谱'},{key:'input',label:'输入'}].map(t=><button key={t.key} aria-pressed={view===t.key} onClick={()=>setView(t.key as typeof view)}>{t.label}</button>)}</div>
    <div className="fourier-screen-image"><canvas ref={canvas} aria-hidden="true"/>
      <svg ref={svg} viewBox="0 0 230 230" role="img" aria-label={view==='output'?'4f滤波后的二维输出光强':view==='input'?'滤波前的二维输入光强':'滤波片之后的二维频谱光强'} onPointerMove={e=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;onChange(Number(Math.max(-3,Math.min(3,d.value+(point(e).x-d.x)/R*viewRadius)).toFixed(5)));}} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
        {view==='output'&&visible&&<g role="slider" tabIndex={0} aria-label="拖动输出屏观察点" aria-valuemin={-3} aria-valuemax={3} aria-valuenow={p.observationMm} className="fourier-horizontal-handle" data-testid="4f-observation-handle" onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.focus();onStart();drag.current={id:e.pointerId,x:point(e).x,value:p.observationMm};svg.current!.setPointerCapture(e.pointerId);}} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();onStart();onChange(Math.max(-3,Math.min(3,p.observationMm+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?.1:.01))));onFinish();}}><circle cx={sx(p.observationMm)} cy={cy} r={12} fill="transparent"/><circle cx={sx(p.observationMm)} cy={cy} r={3.5} fill="#26836a" stroke="#fff" strokeWidth={1.2}/>{marked('observationMm')&&<g data-testid="4f-annotation-observationMm"><line x1={cx} x2={sx(p.observationMm)} y1={cy} y2={cy} stroke="#e0f0e9"/><text className="fourier-dark-symbol" x={sx(p.observationMm)+6} y={cy-12}>x′</text></g>}</g>}
        {view==='output'&&marked('intensity')&&<text data-testid="4f-annotation-intensity" className="fourier-dark-symbol" x={14} y={22}>I / Iᵢₙ(0)</text>}
        {view==='output'&&marked('transmission')&&<text data-testid="4f-annotation-transmission" className="fourier-dark-symbol" x={14} y={44}>T</text>}
        {view==='spectrum'&&p.filterMode!==2&&<><rect x={sx(p.filterOffsetUm-p.filterWidthUm/2)} y={18} width={p.filterWidthUm/extent*R} height={170} fill="none" stroke={p.filterMode===0?'#26836a':'#c16b37'} strokeDasharray="4 4"/><text x={sx(p.filterOffsetUm)} y={36} textAnchor="middle" className="fourier-dark-symbol">{p.filterMode===0?'通光':'遮光'}</text></>}
        <text x={cx} y={216} textAnchor="middle" fill="#aac3df" fontSize={10}>{view==='spectrum'?'xꜰ':'x′'}：±{Number(extent.toFixed(1))} {view==='spectrum'?'μm':'mm'}</text>
      </svg>
    </div>
    {view!=='spectrum'&&<div className="fourier-screen-controls"><button className="text-button" onClick={onFit}>适配图样</button><div className="gs-plot-controls"><button className="icon-button" aria-label="缩小输出屏" disabled={zoom<=.3} onClick={()=>onZoom(1/1.35)}><Minus size={14}/></button><span>{Number(zoom.toFixed(2))}×</span><button className="icon-button" aria-label="放大输出屏" disabled={zoom>=8} onClick={()=>onZoom(1.35)}><Plus size={14}/></button></div></div>}
    {view==='output'&&!visible&&<button className="text-button" onClick={onFit}>观察点在视野外 · 定位</button>}
  </section>;
}

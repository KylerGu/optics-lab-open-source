import { useEffect, useRef, type PointerEvent } from 'react';
import { Minus, Plus } from 'lucide-react';
import { fourierLens, type FourierParameters } from './fourierLens';
import { youngLightColor } from './youngDoubleSlit';

type Props={p:FourierParameters;annotations:string[];viewRadius:number;zoom:number;onZoom:(factor:number)=>void;onFit:()=>void;onStart:()=>void;onChange:(v:number)=>void;onFinish:()=>void};
export default function FourierScreen({p,annotations,viewRadius,zoom,onZoom,onFit,onStart,onChange,onFinish}:Props) {
  const canvas=useRef<HTMLCanvasElement>(null),svg=useRef<SVGSVGElement>(null),drag=useRef<{id:number;x:number;value:number}|null>(null);
  const b=fourierLens(p),marked=(k:string)=>annotations.includes(k),cx=115,cy=105,R=96,screenX=(x:number)=>cx+x/viewRadius*R;
  useEffect(()=>{
    const n=256,ctx=canvas.current!.getContext('2d')!;canvas.current!.width=n;canvas.current!.height=n;
    const image=ctx.createImageData(n,n),rgb=youngLightColor(p.wavelengthNm),base=[7,14,23];
    const horizontal=Array.from({length:n},(_,i)=>Math.sqrt(b.at(((i+.5)/n*230-cx)/R*viewRadius).intensity));
    const vertical=Array.from({length:n},(_,i)=>{const v=((i+.5)/n*230-cy)/R*viewRadius/b.spotRadiusUm;return Math.exp(-v*v);});
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){const value=horizontal[x]*vertical[y],offset=(y*n+x)*4;for(let c=0;c<3;c++)image.data[offset+c]=Math.round(base[c]+(rgb[c]-base[c])*value);image.data[offset+3]=255;}
    ctx.putImageData(image,0,0);
  },[p,viewRadius]);
  const visible=Math.abs(p.observationUm)<=viewRadius,ordersVisible=b.orderPositionUm<=viewRadius;
  const point=(x:number,y:number)=>new DOMPoint(x,y).matrixTransform(svg.current!.getScreenCTM()!.inverse());
  const begin=(e:PointerEvent<SVGGElement>)=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.focus();onStart();drag.current={id:e.pointerId,x:point(e.clientX,e.clientY).x,value:p.observationUm};svg.current!.setPointerCapture(e.pointerId);};
  const end=()=>{if(drag.current){drag.current=null;onFinish();}};
  return <section className="gfocus-spot fourier-screen" aria-label="频谱屏">
    <div className="gs-spot-heading"><h2>频谱屏</h2><span>后焦面</span></div>
    <div className="fourier-screen-image" data-testid="fourier-screen-image"><canvas ref={canvas} aria-hidden="true"/>
      <svg ref={svg} viewBox="0 0 230 230" role="img" aria-label="输入光场的二维傅里叶频谱，中心为零级，两侧为一级分量" onPointerMove={e=>{const d=drag.current;if(!d||e.pointerId!==d.id)return;onChange(Number(Math.max(-3000,Math.min(3000,d.value+(point(e.clientX,e.clientY).x-d.x)/R*viewRadius)).toFixed(5)));}} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
        {visible&&<g role="slider" tabIndex={0} aria-label="拖动频谱屏观察点" aria-valuemin={-3000} aria-valuemax={3000} aria-valuenow={p.observationUm} className="fourier-horizontal-handle" data-testid="fourier-screen-observation" onPointerDown={begin} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();onStart();onChange(Math.max(-3000,Math.min(3000,p.observationUm+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?10:1))));onFinish();}}>
          <circle cx={screenX(p.observationUm)} cy={cy} r="12" fill="transparent"/>{marked('observationUm')&&<g data-testid="fourier-annotation-observationUm"><line x1={cx} x2={screenX(p.observationUm)} y1={cy} y2={cy} stroke="#e0f0e9"/><text className="fourier-dark-symbol" x={screenX(p.observationUm)+6} y={cy-12}>xꜰ</text></g>}<circle cx={screenX(p.observationUm)} cy={cy} r="3.5" fill="#26836a" stroke="#fff" strokeWidth="1.2"/>
        </g>}
        {marked('spectrumWidth')&&b.spotRadiusUm<=viewRadius&&<g data-testid="fourier-annotation-spectrumWidth"><line x1={cx} x2={screenX(b.spotRadiusUm)} y1={cy+15} y2={cy+15} stroke="#e6d8f3"/><text className="fourier-dark-symbol" x={cx+12} y={cy+34}>wꜰ</text></g>}
        {marked('intensity')&&<text data-testid="fourier-annotation-intensity" className="fourier-dark-symbol" x="14" y="22">I / I₀</text>}
        {p.modulation>0&&ordersVisible&&[-1,0,1].map(order=><text key={order} x={screenX(order*b.orderPositionUm)} y="182" fontSize="10" fill="#9fb4cd" textAnchor="middle">{order===0?'0':order<0?'−1':'+1'}</text>)}
        <text x={cx} y="215" textAnchor="middle" fill="#aac3df" fontSize="10">xꜰ：±{Number(viewRadius.toFixed(1))} μm</text>
      </svg>
    </div>
    {(!visible||p.modulation>0&&!ordersVisible)&&<button className="text-button fourier-outside" onClick={onFit}>部分频谱在视野外 · 定位</button>}
    <div className="fourier-screen-controls"><button className="text-button" onClick={onFit}>适配频谱</button><div className="gs-plot-controls"><button className="icon-button" aria-label="缩小频谱屏" disabled={zoom<=.16} onClick={()=>onZoom(1/1.35)}><Minus size={14}/></button><span>{Number(zoom.toFixed(2))}×</span><button className="icon-button" aria-label="放大频谱屏" disabled={zoom>=40} onClick={()=>onZoom(1.35)}><Plus size={14}/></button></div></div>
  </section>;
}

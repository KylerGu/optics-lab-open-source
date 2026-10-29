import {useEffect,useRef} from 'react';
import type {SpatialFourFResult,SpatialFourierResult} from './builderModel';
import {youngLightColor} from './youngDoubleSlit';

export function fourFOutputCanvas(result:SpatialFourFResult|SpatialFourierResult,radius:number){
  const canvas=document.createElement('canvas'),n=256;canvas.width=canvas.height=n;
  const ctx=canvas.getContext('2d')!,pixels=ctx.createImageData(n,n),points=result.points,lo=points[0].xMm,hi=points.at(-1)!.xMm,extent=Math.max(-lo,hi),rgb=youngLightColor(result.parameters.wavelengthNm);
  const verticalRadius='spotRadiusUm' in result?result.spotRadiusUm*.001:result.parameters.waistMm;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const xx=((x+.5)/n*2-1)*extent,yy=(1-(y+.5)/n*2)*extent,index=(xx-lo)/(hi-lo)*(points.length-1),i=Math.max(0,Math.min(points.length-2,Math.floor(index))),fraction=Math.max(0,Math.min(1,index-i));
    const intensity=points[i].intensity*(1-fraction)+points[i+1].intensity*fraction,value=Math.min(1,Math.sqrt(intensity)*Math.exp(-((yy/verticalRadius)**2))),offset=(y*n+x)*4;
    for(let c=0;c<3;c++)pixels.data[offset+c]=Math.round([7,14,23][c]+(rgb[c]-[7,14,23][c])*value);
    pixels.data[offset+3]=xx*xx+yy*yy<=radius*radius?255:0;
  }
  ctx.putImageData(pixels,0,0);return canvas;
}

export default function SpatialFourFOutput({result,radius}:{result:SpatialFourFResult;radius:number}){
  const ref=useRef<HTMLCanvasElement>(null),extent=result.points.at(-1)!.xMm,probe=result.parameters.observationMm;
  useEffect(()=>{const canvas=fourFOutputCanvas(result,radius);ref.current!.width=ref.current!.height=256;ref.current!.getContext('2d')!.drawImage(canvas,0,0);},[result,radius]);
  return <article className="sb-four-f-output" aria-label="4f滤波输出"><strong>4f 输出屏</strong><div className="sb-four-f-image"><canvas ref={ref} aria-label="4f滤波后的二维输出光强"/><svg viewBox="0 0 256 256" aria-label="输出观察点"><circle cx={128+128*probe/extent} cy={128} r={3} stroke="white" fill="#26836a"/><text x={140+128*probe/extent} y={119} fill="white" fontSize={12}>x′</text></svg></div><small className="sb-four-f-extent">x′：±{Number(extent.toFixed(2))} mm</small><div className="sb-four-f-values"><span>透过功率比 T<strong>{(result.transmission*100).toFixed(2)}%</strong></span><span>观察点 I / Iᵢₙ(0)<strong>{result.pointIntensity.toFixed(4)}</strong></span></div><small className="sb-four-f-note">共用输入亮度基准<br/>图样平方根提亮</small><details><summary>光强曲线</summary><svg viewBox="0 0 280 115" role="img" aria-label="4f输出光强曲线"><path d="M20 10V95H270" stroke="#cbd5e1" fill="none"/><path d={result.points.map((p,i)=>`${i?'L':'M'}${(20+(p.xMm+extent)/(2*extent)*250).toFixed(2)},${(95-p.intensity*80).toFixed(2)}`).join(' ')} stroke="#427ad3" fill="none"/><text x="20" y="110" fontSize={10}>−{Number(extent.toFixed(2))}</text><text x="270" y="110" textAnchor="end" fontSize={10}>{Number(extent.toFixed(2))} mm</text></svg></details></article>;
}

import { useMemo } from 'react';
import { cameraContrast, cameraStripe, cameraTarget } from './cameraImage';

// One asymmetric object shared by the object-side view and its inverted image.
export function CameraSubject({height}:{height:number}) {
  return <g transform={`scale(${height/20})`} data-testid="camera-subject">
    <path d="M-8 0V-12H8V0Z" fill="#e7b581" stroke="#b77b48" strokeWidth={.6}/>
    <path d="M-10-12L0-20 10-12Z" fill="#c47748"/>
    <path d="M-4 0V-7H0V0 M3-9H6V-5H3Z" fill="#477f9c"/>
    <circle cx={-15} cy={-8} r={3.5} fill="#67a18b"/>
    <path d="M-15-5V0" stroke="#698770" strokeWidth={1}/>
  </g>;
}

function raster(width:number,height:number,intensity:(x:number,y:number)=>number,warm=false) {
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d')!,pixels=context.createImageData(width,height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const c=Math.round(255*Math.max(0,Math.min(1,intensity(x,y)))),i=(y*width+x)*4;
    pixels.data[i]=warm?25+(1-c/255)*207:c;pixels.data[i+1]=warm?55+(1-c/255)*142:c;pixels.data[i+2]=warm?84+(1-c/255)*64:c;pixels.data[i+3]=255;
  }
  context.putImageData(pixels,0,0);return canvas.toDataURL();
}

export function CameraDepthPreview({diameter}:{diameter:number}) {
  const reference=useMemo(()=>raster(240,144,(x,y)=>cameraTarget((x+.5)/240*.4-.2,(y+.5)/144*.24-.12,0,'F'),true),[]);
  const image=useMemo(()=>raster(240,144,(x,y)=>cameraTarget((x+.5)/240*.4-.2,(y+.5)/144*.24-.12,diameter,'F'),true),[diameter]);
  return <g data-testid="camera-depth-preview" data-blur={diameter}>
    <rect x={88} y={413} width={284} height={180} rx={9} fill="#10213b"/><rect x={428} y={413} width={284} height={180} rx={9} fill="#10213b"/>
    <text x={230} y={405} textAnchor="middle">对焦参考</text>
    <text x={570} y={405} textAnchor="middle">当前物距</text>
    <image href={reference} x={100} y={425} width={260} height={156}/>
    <image href={image} x={440} y={425} width={260} height={156} data-testid="camera-depth-image"/>
    <rect x={100} y={425} width={260} height={156} fill="none" stroke="#7894ad" rx={4}/>
    <rect x={440} y={425} width={260} height={156} fill="none" stroke="#7894ad" rx={4}/>
  </g>;
}

const PERIODS=[30,12,6];
export function CameraPixelPreview({pixel,cutoff,narrow=false}:{pixel:number;cutoff:number;narrow?:boolean}) {
  const optical=useMemo(()=>raster(360,150,(x,y)=>{
    const period=PERIODS[Math.min(2,Math.floor(y/50))];
    return cameraStripe((x+.5)/360*120,period,cameraContrast(1000/period,cutoff));
  },true),[cutoff]);
  const sampled=useMemo(()=>raster(360,150,(x,y)=>{
    const period=PERIODS[Math.min(2,Math.floor(y/50))],position=(Math.floor((x+.5)/360*120/pixel)+.5)*pixel;
    return cameraStripe(position,period,cameraContrast(1000/period,cutoff),pixel);
  },true),[pixel,cutoff]);
  if(narrow)return <g data-testid="camera-pixel-comparison" data-pixel={pixel}>
    <rect x={140} y={395} width={270} height={110} rx={8} fill="#10213b"/><rect x={140} y={545} width={270} height={110} rx={8} fill="#10213b"/>
    <text x={270} y={385} textAnchor="middle">到达感光面的条纹</text>
    <image href={optical} x={150} y={405} width={250} height={90} preserveAspectRatio="none"/>
    <text x={270} y={535} textAnchor="middle">像素记录的条纹</text>
    <image href={sampled} x={150} y={555} width={250} height={90} preserveAspectRatio="none" data-testid="camera-sampled-image" style={{imageRendering:'pixelated'}}/>
    {PERIODS.map((period,i)=><g key={period}>
      <text x={135} y={426+i*30} textAnchor="end">{period} μm</text>
      <text x={135} y={576+i*30} textAnchor="end">{period} μm</text>
      <text x={415} y={576+i*30} style={{fill:period/pixel<2?'#c16b37':'#26836a'}}>{period/pixel<2?'欠采样':'≥2格'}</text>
      {i>0&&<path d={`M150 ${405+i*30}H400 M150 ${555+i*30}H400`} stroke="#10213b" strokeWidth={3}/>}
    </g>)}
    <text x={250} y={685} textAnchor="middle">同一组条纹 · 周期从上到下逐渐缩小</text>
  </g>;
  return <g data-testid="camera-pixel-comparison" data-pixel={pixel}>
    <rect x={125} y={390} width={270} height={170} rx={8} fill="#10213b"/><rect x={420} y={390} width={270} height={170} rx={8} fill="#10213b"/>
    <text x={260} y={380} textAnchor="middle">到达感光面的条纹</text>
    <text x={555} y={380} textAnchor="middle">像素记录的条纹</text>
    <image href={optical} x={135} y={400} width={250} height={150} preserveAspectRatio="none"/>
    <image href={sampled} x={430} y={400} width={250} height={150} preserveAspectRatio="none" data-testid="camera-sampled-image" style={{imageRendering:'pixelated'}}/>
    {PERIODS.map((period,i)=><g key={period}>
      <text x={120} y={430+i*50} textAnchor="end">{period} μm</text>
      <text x={695} y={430+i*50} style={{fill:period/pixel<2?'#c16b37':'#26836a'}}>{period/pixel<2?'欠采样':'≥2格'}</text>
      {i>0&&<path d={`M135 ${400+i*50}H385 M430 ${400+i*50}H680`} stroke="#10213b" strokeWidth={4}/>}
    </g>)}
    <text x={400} y={585} textAnchor="middle">同一组条纹 · 周期从上到下逐渐缩小</text>
  </g>;
}

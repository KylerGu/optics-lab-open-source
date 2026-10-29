import {microscopeFocusDistance,microscopeDefocusRange} from './microscopeFocus';
import MicroscopeDetails from './MicroscopeDetails';
import {MicroscopeQuantityLabel,MicroscopeDimension} from './MicroscopeAnnotations';
import SceneValue, {displayNumber as numberText} from './SceneValue';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { MICROSCOPE_STUDIES, microscopePerformance, radialPointSpread, radialIntensity } from './microscopePerformance';
import {  type SceneResult, type SceneState } from './sceneRuntime';
import './microscope-study.css';
import type { SceneView } from './SceneDiagram';

export function MicroscopeStudyTabs({value,onChange}:{value:number;onChange:(n:number)=>void}) {
  return <div className="gs-plot-switch os-microscope-tabs" role="tablist" aria-label="显微镜显示内容">{MICROSCOPE_STUDIES.map((label,i)=><button key={label} role="tab" id={`microscope-tab-${i}`} aria-controls="microscope-study-panel" aria-selected={i===value} tabIndex={i===value?0:-1} className={i===value?'active':''} onClick={()=>onChange(i)} onKeyDown={e=>{const next=e.key==='ArrowRight'?(i+1)%4:e.key==='ArrowLeft'?(i+3)%4:e.key==='Home'?0:e.key==='End'?3:null;if(next!==null){e.preventDefault();onChange(next);document.getElementById(`microscope-tab-${next}`)?.focus();}}}>{label}</button>)}</div>;
}

function PointImage({state,depth}:{state:SceneState;depth:boolean}) {
  const canvas=useRef<HTMLCanvasElement>(null),p=state.parameters,r=microscopePerformance(state).resolution;
  const extent=Math.max(r*4,depth?0:p.separation*.8);
  const table=useMemo(()=>radialPointSpread(depth?p.defocus:0,p.NA,p.wavelength/1000,p.medium,extent*Math.SQRT2+(depth?0:p.separation/2)),[depth,p.defocus,p.NA,p.wavelength,p.medium,extent,p.separation]);
  useEffect(()=>{const ctx=canvas.current?.getContext('2d');if(!ctx)return;const side=240,img=ctx.createImageData(side,side),tableExtent=extent*Math.SQRT2+(depth?0:p.separation/2);
    for(let y=0;y<side;y++)for(let x=0;x<side;x++){
      const xx=((x+.5)/side*2-1)*extent,yy=((y+.5)/side*2-1)*extent;
      const intensity=depth?radialIntensity(table,Math.hypot(xx,yy),tableExtent):radialIntensity(table,Math.hypot(xx-p.separation/2,yy),tableExtent)+radialIntensity(table,Math.hypot(xx+p.separation/2,yy),tableExtent);
      const light=Math.sqrt(Math.max(0,Math.min(1,intensity/(depth?1:2)))),i=(y*side+x)*4;
      img.data[i]=16+light*180;img.data[i+1]=33+light*200;img.data[i+2]=59+light*196;img.data[i+3]=255;
    }ctx.putImageData(img,0,0);
  },[table,extent,depth,p.separation]);
  return <foreignObject x={depth?390:260} y={depth?135:80} width={280} height={280}><canvas ref={canvas} width={240} height={240} className="os-microscope-point-image" role="img" aria-label={depth?'单点随离焦变化的光强分布':'两个等强点源的衍射图像'} data-testid="microscope-point-image" data-extent={extent}/></foreignObject>;
}

export function MicroscopeStudyDiagram({state,view,onView,onPreview,onStart,onCommit,field}:{field?:ReactNode;state:SceneState;view:SceneView;onView:(v:SceneView)=>void;onPreview:(p:Record<string,number>)=>void;onStart:()=>void;onCommit:()=>void}) {
  const svg=useRef<SVGSVGElement>(null),p=state.parameters,depth=p.study===3,a=microscopePerformance(state);
  const focus=microscopeFocusDistance(p),defocusRange=microscopeDefocusRange(p),clampDefocus=(z:number)=>Math.max(defocusRange[0],Math.min(defocusRange[1],z));
  const scaleBar=10**Math.floor(Math.log10(a.resolution*2)),scaleBarWidth=scaleBar/(a.resolution*8)*280;
  const [size,setSize]=useState({width:800,height:600});
  useEffect(()=>{const el=svg.current!;const measure=()=>{const r=el.getBoundingClientRect();if(r.width&&r.height)setSize({width:r.width,height:r.height});};measure();const observer=new ResizeObserver(measure);observer.observe(el);return()=>observer.disconnect();},[]);
  const current=useRef(view);current.current=view;const change=useRef(onView);change.current=onView;
  const drag=useRef<{id:number;kind:'pan'|'z';x:number;y:number;view:SceneView;range:number}|null>(null);
  useEffect(()=>{const el=svg.current!;const wheel=(e:WheelEvent)=>{e.preventDefault();if(drag.current)return;const v=current.current,z=Math.max(1,Math.min(16,v.zoom*Math.exp(-e.deltaY*.0015)));change.current({...v,zoom:z,dx:v.dx*z/v.zoom,dy:v.dy*z/v.zoom});};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);},[]);
  const range=drag.current?.kind==='z'?drag.current.range:Math.max(a.depth*1.5,Math.abs(p.defocus)*1.15,1),zy=(z:number)=>300-z/range*170;
  const extent=Math.max(a.resolution*4,p.separation*.8),table=useMemo(()=>radialPointSpread(0,p.NA,p.wavelength/1000,p.medium,extent+p.separation/2),[p.NA,p.wavelength,p.medium,extent,p.separation]);
  const profile=Array.from({length:241},(_,i)=>{const x=(i/240*2-1)*extent;return radialIntensity(table,Math.abs(x-p.separation/2),extent+p.separation/2)+radialIntensity(table,Math.abs(x+p.separation/2),extent+p.separation/2);});
  const peak=Math.max(...profile);
  const coords=(e:PointerEvent)=>{const matrix=svg.current!.getScreenCTM()!.inverse();return new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix);};
  const begin=(e:PointerEvent<SVGElement>,kind:'pan'|'z')=>{if(e.button!==0)return;e.stopPropagation();const t=coords(e);drag.current={id:e.pointerId,kind,x:t.x,y:t.y,view,range};svg.current!.setPointerCapture(e.pointerId);if(kind==='z')onStart();};
  const end=(e:PointerEvent)=>{if(drag.current?.id!==e.pointerId)return;const kind=drag.current.kind;drag.current=null;if(svg.current?.hasPointerCapture(e.pointerId))svg.current.releasePointerCapture(e.pointerId);if(kind==='z')onCommit();};
  return <svg ref={svg} id={field?undefined:'microscope-performance-diagram'} className="os-microscope-study-diagram" style={{'--study-font-size':`${Math.max(14,13/Math.min(size.width/800,size.height/600))}px`} as CSSProperties} viewBox="0 0 800 600" aria-label={field?'显微镜视场示意':depth?'景深范围与离焦光强分布':'两点分辨率与光强截面'} data-testid="microscope-study-diagram" data-zoom={view.zoom} onPointerDown={e=>begin(e,'pan')} onPointerMove={e=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;const t=coords(e);if(d.kind==='pan')onView({...d.view,dx:d.view.dx+t.x-d.x,dy:d.view.dy+t.y-d.y});else {const localY=(t.y-300-view.dy)/view.zoom+300;onPreview({defocus:clampDefocus((300-localY)/170*range)});}}} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
    <g transform={`translate(${400+view.dx} ${300+view.dy}) scale(${view.zoom}) translate(-400 -300)`}>
      {field?<foreignObject x={190} y={20} width={420} height={560}>{field}</foreignObject>:<>{!depth||focus!==null&&Math.abs(p.defocus)<=50?<PointImage state={state} depth={depth}/>:<text x={530} y={260} textAnchor="middle">{focus===null?'当前镜组无可用焦平面':'超出局部离焦图范围'}</text>}
      {depth?<>
        <text x={240} y={85} textAnchor="middle">物方景深范围</text><text x={530} y={110} textAnchor="middle">离焦点像</text>
        <rect x={170} y={zy(a.depth/2)} width={140} height={zy(-a.depth/2)-zy(a.depth/2)} fill="#26836a" fillOpacity=".1" stroke="#26836a"/>
        <line x1={240} x2={240} y1={130} y2={470} stroke="#b2c6dc"/>
        {[-range,0,range].map(z=><g key={z}><line x1={235} x2={245} y1={zy(z)} y2={zy(z)} stroke="#91abc5"/><text x={225} y={zy(z)+5} textAnchor="end">{numberText(z)}</text></g>)}
        <line x1={130} x2={325} y1={300} y2={300} stroke="#357fc6" strokeDasharray="5 5"/>
        <text x={115} y={325} fill="#357fc6">焦平面</text>
        <g className="os-device-handle" visibility={focus===null?'hidden':undefined} role="slider" tabIndex={focus===null?-1:0} aria-label="移动样品改变离焦量" aria-valuemin={defocusRange[0]} aria-valuemax={defocusRange[1]} aria-valuenow={p.defocus} onPointerDown={e=>begin(e,'z')} onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();onStart();onPreview({defocus:clampDefocus(p.defocus+(e.key==='ArrowUp'?.1:-.1))});onCommit();}}}><line x1={150} x2={325} y1={zy(p.defocus)} y2={zy(p.defocus)} stroke="#c16b37" strokeWidth={2}/><circle cx={325} cy={zy(p.defocus)} r={8} fill="white" stroke="#c16b37" strokeWidth={2} data-testid="microscope-depth-handle"/></g>
        {focus!==null&&Math.abs(p.defocus)<=50&&<><line x1={410} x2={410+scaleBarWidth} y1={400} y2={400} stroke="#d7e7f2" strokeWidth={2}/><text x={410} y={385} style={{fill:'#d7e7f2'}}>{numberText(scaleBar)} µm</text></>}<text x={240} y={505} textAnchor="middle">轴向位置 z / µm</text><MicroscopeDimension quantity="depth" a={[140,zy(-a.depth/2)]} b={[140,zy(a.depth/2)]} value={a.depth} unit="µm" labelOffset={[-22,0]}/>
        <MicroscopeDimension quantity="halfDepth" a={[290,zy(0)]} b={[290,zy(a.depth/2)]} value={a.depth/2} unit="µm" labelOffset={[20,0]}/>
        {focus!==null&&<MicroscopeDimension quantity="defocus" a={[345,zy(0)]} b={[345,zy(p.defocus)]} value={p.defocus} unit="µm" labelOffset={[22,0]}/>}
      </>:<>
        <text x={400} y={55} textAnchor="middle">两点观察</text>
        <MicroscopeDimension quantity="separation" a={[400-p.separation/extent*70,382]} b={[400+p.separation/extent*70,382]} value={p.separation} unit="µm"/>
        <MicroscopeDimension quantity="resolution" a={[400-a.resolution/extent*70,415]} b={[400+a.resolution/extent*70,415]} value={a.resolution} unit="µm"/>
        <line x1={160} x2={640} y1={540} y2={540} stroke="#a6bdd5"/><line x1={160} x2={160} y1={435} y2={540} stroke="#a6bdd5"/>
        <path d={profile.map((v,i)=>`${i?'L':'M'}${160+i*2},${540-v/peak*85}`).join(' ')} stroke="#357fc6" strokeWidth={2} fill="none"/>
        {[-extent,0,extent].map((n,i)=><text key={i} x={160+i*240} y={560} textAnchor="middle">{numberText(n)}</text>)}
        <text x={400} y={585} textAnchor="middle">物方横向位置 / µm</text><text x={160} y={425}>相对光强</text>
      </>}</>}
    </g>
  </svg>;
}

export function MicroscopePerformanceResults({state}:{state:SceneState;result:SceneResult}) {
  const p=state.parameters,a=microscopePerformance(state),depth=p.study===3;
  if(!depth)return <section className="gs-readouts os-microscope-readouts os-microscope-resolution-results" aria-label="实时结果">
    <dl>{[{key:'resolution',label:'横向分辨率',value:a.resolution,color:'#357fc6'},{key:'separation',label:'两点间距',value:p.separation,color:'#c16b37'}].map(item=><div key={item.key} style={{'--quantity-color':item.color} as CSSProperties}>
      <dt><MicroscopeQuantityLabel label={item.label} quantity={item.key}/></dt><dd data-testid={item.key==='resolution'?'microscope-performance-primary':'scene-metric-separation'}><SceneValue value={item.value} unit="µm"/></dd>
    </div>)}</dl>
    <p>{p.separation>=a.resolution?'达到瑞利分辨判据':'未达到瑞利分辨判据'}</p>
    <MicroscopeDetails id="resolution-conditions" title="计算条件"><p>瑞利判据：等强、非相干点源，理想圆孔径；忽略像差，高 NA 时为近似。</p><a href="https://www.microscopyu.com/microscopy-basics/resolution" target="_blank" rel="noreferrer">计算参考 ↗</a></MicroscopeDetails>
  </section>;
  return <section className="gs-readouts os-microscope-readouts os-microscope-depth-results" aria-label="实时结果">
    <dl>{[{key:'depth',label:'景深估计',value:a.depth,color:'#26836a'},{key:'halfDepth',label:'焦平面上下',value:a.depth/2,color:'#8a5eac'},{key:'defocus',label:'样品位置',value:microscopeFocusDistance(p)===null?null:p.defocus,color:'#c16b37'}].map(item=><div key={item.key} style={{'--quantity-color':item.color} as CSSProperties}>
      <dt><MicroscopeQuantityLabel label={item.label} quantity={item.key}/></dt><dd data-testid={item.key==='depth'?'microscope-performance-primary':`scene-metric-${item.key}`}>{item.key==='halfDepth'&&'± '}<SceneValue value={item.value} unit="µm"/></dd>
    </div>)}</dl>
    <MicroscopeDetails id="depth-conditions" title="计算条件">
      <p>{p.mode===1?'离焦零点：对焦到感光面。':'离焦零点：放松眼观察。'}正值表示物距增大。</p>
      <p>{p.mode===1&&p.depthCriterion===1?'计入衍射与相机采样。':'仅计衍射。'}忽略像差，高 NA 时为近似。</p>
      <dl>{[{key:'diffractionDepth',label:'衍射项',symbol:'d',value:a.diffraction,color:'#357fc6'},{key:'geometricDepth',label:'采样项',symbol:'s',value:a.geometric,color:'#a67916'}].map(item=><div key={item.key} style={{'--quantity-color':item.color} as CSSProperties}>
        <dt>{item.label}<span className="gs-quantity-symbol">DOF<sub>{item.symbol}</sub></span></dt><dd data-testid={`scene-metric-${item.key}`}><SceneValue value={item.value} unit="µm"/></dd>
      </div>)}</dl>
      <a href="https://www.microscopyu.com/microscopy-basics/depth-of-field-and-depth-of-focus" target="_blank" rel="noreferrer">计算参考 ↗</a>
    </MicroscopeDetails>
  </section>;
}

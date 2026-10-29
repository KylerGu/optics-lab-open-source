import {TelescopeEyeResults,TelescopeEyeAnnotations} from './TelescopeEyeView';
import {TelescopeResolutionResults,TelescopeResolutionAnnotations} from './TelescopeResolutionView';
import {TelescopeFieldObservation,TelescopeFieldResults} from './TelescopeFieldView';
import MicroscopeDetails from './MicroscopeDetails';
import SceneValue, {displayNumber as numberText} from './SceneValue';
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { ARCSECONDS, TELESCOPE_STUDIES, telescopeOptics } from './telescopeModel';
import { radialPointSpread, radialIntensity } from './microscopePerformance';
import { SCENE_DEFINITIONS,  type SceneParameter, type SceneResult, type SceneState } from './sceneRuntime';
import { quantityColor } from './scenePresentation';
import { SceneCurve, type SceneView } from './SceneDiagram';
import './telescope-study.css';

export function TelescopeStudyTabs({value,onChange}:{value:number;onChange:(n:number)=>void}) {
  return <div className="gs-plot-switch os-telescope-tabs" role="tablist" aria-label="望远镜显示内容">{TELESCOPE_STUDIES.map((label,i)=><button key={label} role="tab" id={`telescope-tab-${i}`} aria-controls="telescope-study-panel" aria-selected={i===value} tabIndex={i===value?0:-1} className={i===value?'active':''} onClick={()=>onChange(i)} onKeyDown={e=>{const n=e.key==='ArrowRight'?(i+1)%4:e.key==='ArrowLeft'?(i+3)%4:e.key==='Home'?0:e.key==='End'?3:null;if(n!==null){e.preventDefault();onChange(n);document.getElementById(`telescope-tab-${n}`)?.focus();}}}>{label}</button>)}</div>;
}
export function TelescopeControls({state,onCommit,renderField}:{state:SceneState;onCommit:(p:Record<string,number>)=>void;renderField:(p:SceneParameter)=>ReactNode}) {
  const p=state.parameters,o=telescopeOptics(p),fields=SCENE_DEFINITIONS[state.sceneId].parameters;
  const get=(key:string)=>{const field=fields.find(f=>f.key===key)!;return key==='eyepieceDiameter'?{...field,label:'目镜通光口径'}:field;};
  const main=p.study===2?['aperture','wavelength','starSeparation']:p.study===3?['eyeDistance','eyeOffset','eyeDiameter','angle']:p.study===1?['f1','f2']:['f1','f2','d','angle'];
  const extra=p.study===2?[]:p.study===3?['f1','f2','d','aperture','eyepieceDiameter']:p.study===1?['aperture','wavelength','eyepieceDiameter','eyeDistance','eyeDiameter','eyeOffset']:['aperture','eyepieceDiameter'];
  const aligned=p.f1+o.fe>=20&&p.f1+o.fe<=600;
  return <>{p.study!==2&&<div className="gs-plot-switch os-telescope-types" role="group" aria-label="望远镜结构">{['开普勒','伽利略'].map((label,i)=><button key={label} className={p.k2===(i?-1:1)?'active':''} aria-pressed={p.k2===(i?-1:1)} onClick={()=>{const k2=i?-1:1,d=p.f1+k2*p.f2;onCommit({k2,...(d>=20&&d<=600?{d}:{})});}}>{label}</button>)}</div>}
    {p.study>=0&&p.study<=3?<div className="os-microscope-parameter-group"><h4>{p.study===3?'眼睛与观察方向':p.study===2?'物镜与双星':p.study===1?'镜组焦距':'镜组与远物'}</h4>{main.map(key=>renderField(get(key)))}</div>:main.map(key=>renderField(get(key)))}
    <div className="os-presets">{p.study===2?(['合在一起','瑞利间距','分开观察'] as const).map((label,i)=><button key={label} className="text-button" onClick={()=>onCommit({starSeparation:Math.max(.1,Math.min(180,o.resolution*[.65,1,1.8][i]))})}>{label}</button>):<><button className="text-button" disabled={!aligned} onClick={()=>onCommit({d:p.f1+o.fe})}>恢复平行出射</button>{p.study===3&&<button className="text-button" onClick={()=>onCommit({eyeOffset:0,eyeDistance:o.pupilPosition!==null&&o.pupilPosition>0&&o.pupilPosition<=100?o.pupilPosition:0})}>{o.pupilPosition!==null&&o.pupilPosition>0?'对准出瞳':'靠近目镜并居中'}</button>}</>}</div>
    {p.study===2&&!o.afocal&&<div className="os-presets"><button className="text-button" disabled={!aligned} onClick={()=>onCommit({d:p.f1+o.fe})}>恢复平行出射</button></div>}
    {p.study===1?<MicroscopeDetails id="telescope-field-observation-settings" title="观察设置">{extra.map(key=>renderField(get(key)))}</MicroscopeDetails>:extra.length>0&&<details key={p.study} className="os-microscope-details"><summary>{p.study===3?'镜组设置':p.study===1?'观察设置':'口径设置'}</summary>{extra.map(key=>renderField(get(key)))}</details>}
  </>;
}

function DoubleStar({state}:{state:SceneState}) {
  const canvas=useRef<HTMLCanvasElement>(null),p=state.parameters,r=telescopeOptics(p).resolution,extent=Math.max(r*4,p.starSeparation*.8),tableExtent=(extent*Math.SQRT2+p.starSeparation/2)/ARCSECONDS;
  const table=useMemo(()=>radialPointSpread(0,p.aperture/2,p.wavelength/1e6,1,tableExtent),[p.aperture,p.wavelength,tableExtent]);
  useEffect(()=>{const ctx=canvas.current?.getContext('2d');if(!ctx)return;const side=280,img=ctx.createImageData(side,side);for(let y=0;y<side;y++)for(let x=0;x<side;x++){const xx=((x+.5)/side*2-1)*extent,yy=((y+.5)/side*2-1)*extent,v=(radialIntensity(table,Math.hypot(xx-p.starSeparation/2,yy)/ARCSECONDS,tableExtent)+radialIntensity(table,Math.hypot(xx+p.starSeparation/2,yy)/ARCSECONDS,tableExtent))/2,light=Math.sqrt(Math.max(0,Math.min(1,v))),i=(y*side+x)*4;img.data[i]=16+light*180;img.data[i+1]=33+light*200;img.data[i+2]=59+light*196;img.data[i+3]=255;}ctx.putImageData(img,0,0);},[table,p.starSeparation,extent,tableExtent]);
  return <canvas ref={canvas} width={280} height={280} className="os-telescope-stars" role="img" aria-label="两个等强星点的衍射光强" data-testid="telescope-double-star" data-extent={extent}/>;
}

export function TelescopeStudyDiagram({state,view,onView,onPreview,onStart,onCommit}:{state:SceneState;view:SceneView;onView:(v:SceneView)=>void;onPreview:(p:Record<string,number>)=>void;onStart:()=>void;onCommit:()=>void}) {
  const svg=useRef<SVGSVGElement>(null),p=state.parameters,o=telescopeOptics(p),study=p.study;
  const [size,setSize]=useState({width:800,height:600});
  const fieldWidth=Math.min(420,size.width-24),fieldHeight=Math.min(560,size.height-24);
  const centerX=study===1?size.width/2:400,centerY=study===1?size.height/2:300;
  const drag=useRef<{id:number;kind:'pan'|'eye';x:number;y:number;view:SceneView;p:Record<string,number>}|null>(null),latest=useRef(view),change=useRef(onView);latest.current=view;change.current=onView;
  useEffect(()=>{const el=svg.current!;const measure=()=>{const r=el.getBoundingClientRect();if(r.width&&r.height)setSize({width:r.width,height:r.height});};measure();const obs=new ResizeObserver(measure);obs.observe(el);const wheel=(e:WheelEvent)=>{e.preventDefault();if(drag.current)return;const v=latest.current,z=Math.max(1,Math.min(16,v.zoom*Math.exp(-e.deltaY*.0015)));change.current({...v,zoom:z,dx:v.dx*z/v.zoom,dy:v.dy*z/v.zoom});};el.addEventListener('wheel',wheel,{passive:false});return()=>{obs.disconnect();el.removeEventListener('wheel',wheel);};},[]);
  const coords=(e:PointerEvent)=>new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
  const begin=(e:PointerEvent<SVGElement>,kind:'pan'|'eye')=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();const xy=coords(e);drag.current={id:e.pointerId,kind,x:xy.x,y:xy.y,view,p:{...p}};svg.current!.setPointerCapture(e.pointerId);if(kind==='eye')onStart();};
  const end=(e:PointerEvent)=>{if(drag.current?.id!==e.pointerId)return;const kind=drag.current.kind;drag.current=null;if(svg.current?.hasPointerCapture(e.pointerId))svg.current.releasePointerCapture(e.pointerId);if(kind==='eye')onCommit();};
  const clip=useId().replace(/:/g,'');
  const eyeX=270+p.eyeDistance*3,eyeY=300-p.eyeOffset*12,q=o.pupilPosition,pupilX=q===null?null:270+q*3;
  const beam=(z:number,h:number)=>((o.a+z*o.c)*h+(p.d+z*o.dd)*p.angle*Math.PI/180);
  const r=o.resolution,extent=Math.max(r*4,p.starSeparation*.8),profileExtent=(extent+p.starSeparation/2)/ARCSECONDS;
  const profileTable=useMemo(()=>radialPointSpread(0,p.aperture/2,p.wavelength/1e6,1,profileExtent),[p.aperture,p.wavelength,profileExtent]);
  const profile=Array.from({length:241},(_,i)=>{const angle=(i/240*2-1)*extent;return radialIntensity(profileTable,Math.abs(angle-p.starSeparation/2)/ARCSECONDS,profileExtent)+radialIntensity(profileTable,Math.abs(angle+p.starSeparation/2)/ARCSECONDS,profileExtent);}),peak=Math.max(...profile);
  return <svg ref={svg} id={study===2?'telescope-resolution-diagram':study===3?'telescope-eye-diagram':undefined} className="os-telescope-study-diagram" style={{'--study-font-size':`${study===1?14:Math.max(14,13/Math.min(size.width/800,size.height/600))}px`} as CSSProperties} viewBox={study===1?`0 0 ${size.width} ${size.height}`:'0 0 800 600'} data-testid="telescope-study-diagram" data-zoom={view.zoom} role="img" aria-label={TELESCOPE_STUDIES[study]} onPointerDown={e=>begin(e,'pan')} onPointerMove={e=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;const xy=coords(e),dx=xy.x-d.x,dy=xy.y-d.y;if(d.kind==='pan')onView({...d.view,dx:d.view.dx+dx,dy:d.view.dy+dy});else onPreview({eyeDistance:Math.max(0,Math.min(100,d.p.eyeDistance+dx/(3*d.view.zoom))),eyeOffset:Math.max(-10,Math.min(10,d.p.eyeOffset-dy/(12*d.view.zoom)))});}} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
    <defs><clipPath id={`${clip}-beam`}><rect x={65} y={125} width={635} height={330}/></clipPath></defs>
    <g transform={`translate(${centerX+view.dx} ${centerY+view.dy}) scale(${view.zoom}) translate(${-centerX} ${-centerY})`}>
      {study===1?<foreignObject x={centerX-fieldWidth/2} y={centerY-fieldHeight/2} width={fieldWidth} height={fieldHeight}><TelescopeFieldObservation state={state}/></foreignObject>:study===2?<>{o.afocal?<><text x={400} y={60} textAnchor="middle">双星分辨</text><foreignObject x={260} y={85} width={280} height={280}><DoubleStar state={state}/></foreignObject><TelescopeResolutionAnnotations state={state}/><path d="M160 440V540H640" stroke="#a6bdd5" fill="none"/><path d={profile.map((v,i)=>`${i?'L':'M'}${160+i*2} ${540-v/peak*85}`).join(' ')} stroke="#62748a" strokeWidth={2} fill="none"/><text x={160} y={430}>相对光强</text>{[-extent,0,extent].map((n,i)=><text key={i} x={160+i*240} y={560} textAnchor="middle">{numberText(n)}</text>)}<text x={400} y={590} textAnchor="middle">物方角位置 / 角秒</text></>:<text x={400} y={300} textAnchor="middle">请先恢复平行出射，再观察双星分辨</text>}</>:<>
        <text x={400} y={75} textAnchor="middle">目镜后的观察位置</text><line x1={65} x2={700} y1={300} y2={300} stroke="#a6bdd5" strokeDasharray="5 5"/>
        <path d={`M270 ${300-p.eyepieceDiameter*6}V${300+p.eyepieceDiameter*6}`} stroke="#357fc6" strokeWidth={4}/><text x={270} y={Math.max(130,300-p.eyepieceDiameter*6-25)} textAnchor="middle" style={{fill:'#357fc6'}}>目镜</text>
        {q!==null&&pupilX!==null&&pupilX>=65&&pupilX<=700&&o.pupilDiameter!==null&&<g data-testid="telescope-pupil"><rect x={pupilX-5} y={300-o.pupilDiameter*6} width={10} height={o.pupilDiameter*12} fill="#26836a" fillOpacity=".12" stroke="#26836a" strokeWidth={2} strokeDasharray={q<0?'5 4':undefined}/><text x={pupilX} y={465} textAnchor="middle" style={{fill:'#8a5eac'}}>{q<0?'虚出瞳':'出瞳'}</text></g>}
        <g clipPath={`url(#${clip}-beam)`}>{[-p.aperture/2,0,p.aperture/2].map((h,i)=>{const y2=beam(0,h);if(Math.abs(y2)>p.eyepieceDiameter/2)return null;const eyeRay=beam(p.eyeDistance,h),passes=Math.abs(eyeRay-p.eyeOffset)<=p.eyeDiameter/2;return <g key={i}><line x1={270} x2={eyeX} y1={300-y2*12} y2={300-eyeRay*12} stroke="#26836a" strokeWidth={2}/><line x1={eyeX} x2={660} y1={300-eyeRay*12} y2={300-beam(130,h)*12} stroke={passes?"#26836a":"#aab3be"} strokeWidth={2} strokeDasharray={passes?undefined:"5 5"} data-testid={`telescope-eye-ray-${i}`} data-passes={passes}/>{q!==null&&q<0&&pupilX!==null&&pupilX>=65&&<line x1={270} x2={pupilX} y1={300-y2*12} y2={300-beam(q,h)*12} stroke="#26836a" strokeDasharray="5 5"/>}</g>;})}</g>
        <g className="os-device-handle" role="slider" tabIndex={0} aria-label="移动眼睛改变观察位置" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.eyeDistance} onPointerDown={e=>begin(e,'eye')} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();onStart();onPreview(e.key==='ArrowLeft'||e.key==='ArrowRight'?{eyeDistance:Math.max(0,Math.min(100,p.eyeDistance+(e.key==='ArrowLeft'?-1:1)))}:{eyeOffset:Math.max(-10,Math.min(10,p.eyeOffset+(e.key==='ArrowDown'?-.25:.25)))});onCommit();}}><title>左右移动改变距目镜的距离，上下移动改变偏心量</title><path d={`M${eyeX-18} ${eyeY-36}Q${eyeX+40} ${eyeY} ${eyeX-18} ${eyeY+36}`} fill="#edf3f9" stroke="#91abc4" strokeWidth={2}/><line x1={eyeX} x2={eyeX} y1={eyeY-p.eyeDiameter*6} y2={eyeY+p.eyeDiameter*6} stroke="#147f96" strokeWidth={4}/><circle cx={eyeX} cy={eyeY} r={8} fill="white" stroke="#c16b37" strokeWidth={2} data-testid="telescope-eye-handle"/><text x={eyeX+28} y={eyeY-48} style={{fill:'#147f96'}}>眼瞳</text></g>
        <TelescopeEyeAnnotations state={state}/>
      </>}
    </g>
  </svg>;
}

export function TelescopeResults({state,result}:{state:SceneState;result:SceneResult}) {
  if(state.parameters.study===3)return <TelescopeEyeResults state={state} result={result}/>;
  if(state.parameters.study===2)return <TelescopeResolutionResults state={state}/>;
  if(state.parameters.study===1)return <TelescopeFieldResults state={state} result={result}/>;
  const p=state.parameters,o=telescopeOptics(p),metric=(key:string)=>result.metrics.find(m=>m.key===key),primary=metric(p.study===2?'resolution':p.study===3?'pupilDiameter':'angularM')!;
  const keys=p.study===2?[]:p.study===3?['pupilPosition','acceptedLight','visibleField']:['centralAngle'];
  return <div className="os-microscope-observation"><div className="gs-spot-reading os-microscope-primary"><span>{p.study===2?'物镜角分辨率':p.study===3?'出瞳直径':'放大倍数'}</span><strong style={{color:p.study===2?'#357fc6':p.study===3?'#26836a':'#8a5eac'}} data-testid="telescope-primary"><SceneValue value={primary.value===null?null:Math.abs(primary.value)} unit={primary.unit} primary/></strong>{p.study!==2&&p.study!==3&&<p>{o.afocal?(p.study===0?'成像方向：':'')+(o.M!<0?'倒像':'正像'):'请恢复平行出射'}</p>}</div>
    <dl className="os-microscope-fields">{keys.map(key=>{const m=metric(key)!;return <div key={key}><dt title={key==='centralAngle'?'主光线离开目镜后与光轴的夹角；向上为正，向下为负。':undefined}>{key==='centralAngle'?'出射角 θ′':m.label}</dt><dd style={{color:quantityColor(key)}} data-testid={`telescope-metric-${key}`}><SceneValue value={m.value} unit={m.unit}/></dd></div>;})}{p.study===0&&<div><dt>对焦状态</dt><dd style={{color:o.afocal?'#26836a':'#c16b37'}} data-testid="telescope-focus-status">{o.afocal?'已对焦':'未对焦'}</dd></div>}{p.study===2&&<div><dt>双星角间距</dt><dd style={{color:'#c16b37'}}><SceneValue value={p.starSeparation} unit="角秒"/></dd></div>}</dl>
    {p.study===0&&<p>{o.afocal?'出射光互相平行。':'出射光方向不同；可点击“恢复平行出射”。'}</p>}
    {p.study===2&&<p>{p.starSeparation>=o.resolution?'达到瑞利分辨判据':'未达到瑞利分辨判据'}</p>}
    {p.study===3&&<p>{o.pupilPosition===null?'物镜经目镜的像在无穷远':o.pupilPosition<0?'镜内虚出瞳':o.pupilPosition===0?'出瞳位于目镜平面':'目镜之后的实出瞳'}{o.eyepieceLimits?' · 目镜口径限制光束':''}</p>}
    <details key={p.study} className="os-microscope-details"><summary>计算条件</summary>{p.study===2?<p>角秒是角度单位，1° = 3600 角秒。采用理想物镜圆孔径、两个等强非相干点源的瑞利判据；未包含目镜截光、大气扰动和像差。亮度作平方根映射显示弱光环。</p>:p.study===0?<>
      <p>θ 是入射光与光轴的夹角，θ′ 是主光线离开目镜后与光轴的夹角；向上为正，向下为负。</p>
      <p>对焦后，出射光互相平行，θ′ = Mθ。开普勒的 M 为负，表示方向反转；伽利略的 M 为正。</p>
      <dl className="os-microscope-fields">{['afocalLength','angularSpread'].map(key=>{const m=metric(key)!;return <div key={key}><dt>{key==='afocalLength'?'对焦所需镜间距':'出射方向差'}</dt><dd><SceneValue value={m.value} unit={m.unit}/></dd></div>;})}</dl>
      <p>出射方向差是最上与最下方两条光线出射角的差；0 表示光线平行。mrad 是毫弧度，是角度单位。</p>
      <p>按理想薄透镜计算小角度光线，未计入透镜像差。未对焦时，θ′ 仅表示主光线方向。</p>
    </>:<><p>出瞳是光学系统从目镜后看到的孔径像。目镜通光口径较小时，以目镜作为限制孔径。</p><p>视场和入眼比例按理想薄透镜、圆形口径和眼瞳的重叠估计；只计算 ±3° 的近轴范围。入眼比例表示几何截光，未模拟视网膜亮度。</p></>}
    <a href={p.study===2?'https://labs.phys.utk.edu/mbreinig/phys136core/modules/m9/resolving_power.html':'https://www.edmundoptics.com/knowledge-center/application-notes/optics/telescope-optics-for-hobbyists/'} target="_blank" rel="noreferrer">计算参考 ↗</a></details>
  </div>;
}

export function TelescopeTrends({result}:{result:SceneResult}) {
  const study=result.input.parameters.study;
  if(study===0||study===1)return null;
  return <details key={study} className="os-microscope-details os-microscope-trend"><summary>参数趋势</summary><SceneCurve result={result}/><p>圆点表示当前参数。</p></details>;
}

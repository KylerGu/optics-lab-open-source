import {CameraRayOptics,useCameraPresentation} from './CameraRayPresentation';
import {TelescopeRayOptics,useTelescopePresentation} from './TelescopeRayPresentation';
import RefractionAnnotations from './RefractionAnnotations';
import type {RefractionQuantity} from './refractionQuantities';
import ApertureAnnotations from './ApertureAnnotations';
import type {ApertureQuantity} from './apertureQuantities';
import MirrorAnnotations from './MirrorAnnotations';
import type {MirrorQuantity} from './mirrorQuantities';
import MicroscopeApparatus,{MicroscopeEye,microscopeApparatusHalfHeight} from './MicroscopeApparatus';
import {microscopeEyePosition,microscopeRayHeight} from './microscopeEye';
import {MicroscopeRayAnnotations} from './MicroscopeAnnotations';
import {displayNumber as numberText,sceneAxisDisplay} from './SceneValue';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { quantityColor } from './scenePresentation';
import { symmetricPrismAngle } from './prismAnnotations';
import { apertureLensShift } from './apertureModel';
import {aberrationDimensions,aberrationDrag,type AberrationDrag} from './aberrationModel';
import AberrationAnnotations from './AberrationAnnotations';
import type {AberrationQuantity} from './aberrationQuantities';
import DoubleLensAnnotations from './DoubleLensAnnotations';
import ThinLensAnnotations from './ThinLensAnnotations';
import type {ThinLensQuantity} from './thinLensQuantities';
import type {DoubleLensQuantity} from './doubleLensQuantities';
import { SCENE_DEFINITIONS, type SceneResult, type SceneState } from './sceneRuntime';

const colors:Record<string,string>={incident:'#c16b37',reflected:'#8a5eac',transmitted:'#26836a',internal:'#347ac0',virtual:'#238771',blocked:'#aab3be'};
export interface SceneView {zoom:number;dx:number;dy:number;bounds?:SceneResult['bounds']}
export const initialSceneView:SceneView={zoom:1,dx:0,dy:0};
type DragKind='pan'|'angle'|'object'|'lens'|'mirror'|'focus'|'first-lens'|'second-lens'|'telescope-first'|'telescope-second'|'telescope-objective-top'|'telescope-objective-bottom'|'telescope-eyepiece-top'|'telescope-eyepiece-bottom'|'camera-lens'|'camera-sensor'|'aperture-stop'|'aperture-lens'|'aperture-stop-size'|'aperture-lens-size'|AberrationDrag;
const telescopeSizeHandle=(kind:DragKind)=>kind.startsWith('telescope-objective-')||kind.startsWith('telescope-eyepiece-');
const telescopeSizeKey=(kind:DragKind)=>kind.startsWith('telescope-objective-')?'aperture':'eyepieceDiameter';
export default function SceneDiagram({result,state,view,onView,onAnglePreview,onParametersPreview,onDeviceStart,onAngleCommit,microscopePresentation='principle',aberrationQuantity=null,doubleQuantities=new Set<DoubleLensQuantity>(),thinQuantities=new Set<ThinLensQuantity>(),mirrorQuantities=new Set<MirrorQuantity>(),apertureQuantities=new Set<ApertureQuantity>(),refractionQuantities=new Set<RefractionQuantity>()}:{result:SceneResult;state:SceneState;view:SceneView;onView:(v:SceneView)=>void;onAnglePreview:(v:number)=>void;onParametersPreview:(p:Record<string,number>)=>void;onDeviceStart:()=>void;onAngleCommit:()=>void;microscopePresentation?:'principle'|'apparatus';aberrationQuantity?:AberrationQuantity|null;doubleQuantities?:ReadonlySet<DoubleLensQuantity>;thinQuantities?:ReadonlySet<ThinLensQuantity>;mirrorQuantities?:ReadonlySet<MirrorQuantity>;apertureQuantities?:ReadonlySet<ApertureQuantity>;refractionQuantities?:ReadonlySet<RefractionQuantity>}){
  const telescopePresentation=useTelescopePresentation();
  const cameraPresentation=useCameraPresentation();
  const svg=useRef<SVGSVGElement>(null);
  const [size,setSize]=useState({width:860,height:520});
  const drag=useRef<{id:number;kind:DragKind;x:number;y:number;view:SceneView;parameters:Record<string,number>;sx:number;sy:number}|null>(null);
  const viewRef=useRef(view);viewRef.current=view;
  const changeView=useRef(onView);changeView.current=onView;
  useEffect(()=>{const el=svg.current;if(!el)return;const measure=()=>{const r=el.getBoundingClientRect();if(r.width&&r.height)setSize({width:r.width,height:r.height});};measure();const observer=new ResizeObserver(measure);observer.observe(el);const wheel=(e:WheelEvent)=>{e.preventDefault();if(drag.current)return;const r=el.getBoundingClientRect(),old=viewRef.current,z=Math.max(1,Math.min(16,old.zoom*Math.exp(-e.deltaY*.0015))),ratio=z/old.zoom,px=e.clientX-r.left-r.width/2,py=e.clientY-r.top-r.height/2;changeView.current({...old,zoom:z,dx:px-(px-old.dx)*ratio,dy:py-(py-old.dy)*ratio});};el.addEventListener('wheel',wheel,{passive:false});return()=>{observer.disconnect();el.removeEventListener('wheel',wheel);};},[]);
  const id=useId().replace(/:/g,'');
  // Keep the camera fixed while moving devices; otherwise automatic fitting moves the handle away from the pointer.
  const [xmin,baseXmax,ymin,ymax]=['lens','mirror','double-lens','microscope','telescope','camera','aperture','aberration'].includes(result.model)&&view.bounds?view.bounds:result.bounds;
  const {width,height}=size,pad=55,zoom=view.zoom;
  const geometric=['lens','mirror','double-lens','microscope','telescope','camera','aperture','aberration'].includes(result.model);
  const lens=result.model==='lens',telescope=result.model==='telescope',camera=result.model==='camera',aperture=result.model==='aperture',aberration=result.model==='aberration';
  const mirror=result.model==='mirror',movable=lens||mirror;
  const microscope=result.model==='microscope',cameraMicroscope=microscope&&state.parameters.mode===1;
  const apparatus=microscope&&state.parameters.study===0&&microscopePresentation==='apparatus';
  const eyePosition=apparatus?microscopeEyePosition(state,result):null;
  const xmax=eyePosition!==null&&!view.bounds?Math.max(baseXmax,eyePosition+(eyePosition-xmin)*.15):baseXmax;
  const doubleLens=result.model==='double-lens'||microscope,dualPrefix=microscope?'microscope':'double-lens';
  const sx=(width-2*pad)/(xmax-xmin),sy=(height-2*pad)/(ymax-ymin)*((apparatus||(telescope&&telescopePresentation?.apparatus)||(camera&&cameraPresentation?.apparatus)) ? .5 : 1);
  // Interface and prism plots have equal scales so their angles are faithful.
  const scale=Math.min(sx,sy);
  const x=(n:number)=>width/2+view.dx+(n-(xmin+xmax)/2)*(geometric?sx:scale)*zoom;
  const y=(n:number)=>height/2+view.dy-(n-(ymin+ymax)/2)*(geometric?sy:scale)*zoom;
  const activeDevice=drag.current;
  // Keep the handle's vertical position fixed until the horizontal drag ends.
  const controlSpan=doubleLens&&activeDevice&&['object','first-lens','second-lens'].includes(activeDevice.kind)?(activeDevice.parameters.u+activeDevice.parameters.d)*activeDevice.sx:Math.abs(x(state.parameters.d)-x(-state.parameters.u));
  const crowdedControls=doubleLens&&controlSpan<24;
  const tightDimensions=doubleLens&&controlSpan/2<28;
  const dualDimensionBase=crowdedControls?88:48;
  const normalLabelY=[y(0)-160,y(0)+160].find(position=>position>=45&&position<=height-40);
  const clamp=(key:string,value:number)=>{const field=SCENE_DEFINITIONS[state.sceneId].parameters.find(p=>p.key===key)!;return Math.max(field.min,Math.min(field.max,value));};
  const firstLensMove=(p:Record<string,number>,delta:number)=>{const fields=SCENE_DEFINITIONS[state.sceneId].parameters,u=fields.find(p=>p.key==='u')!,d=fields.find(p=>p.key==='d')!;return Math.max(u.min-p.u,p.d-d.max,Math.min(u.max-p.u,p.d-d.min,delta));};
  const cameraLensMove=(p:Record<string,number>,delta:number)=>Math.max(20-p.u,p.sensor-300,Math.min(5000-p.u,p.sensor-10,delta));
  const updateAperture=(kind:DragKind,dx:number,up:number,p:Record<string,number>,base:SceneView,pixelsPerMm:number)=>{
    if(kind==='aperture-lens'){const next=apertureLensShift(p,dx);onParametersPreview({u:next.u,z:next.z});onView({...base,bounds:[xmin,xmax,ymin,ymax],dx:base.dx+next.shift*pixelsPerMm});}
    else if(kind==='aperture-stop')onParametersPreview({z:clamp('z',p.z+dx)});
    else {const key=kind==='aperture-stop-size'?'stopD':'lensD';onParametersPreview({[key]:clamp(key,p[key]+2*up)});}
  };
  const begin=(event:PointerEvent<SVGElement>,kind:DragKind)=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();const camera=(kind!=='pan'&&kind!=='angle'||telescope&&kind==='angle')?{...view,bounds:[xmin,xmax,ymin,ymax] as SceneResult['bounds']}:view;drag.current={id:event.pointerId,kind,x:event.clientX,y:event.clientY,view:camera,parameters:{...state.parameters},sx:sx*zoom,sy:sy*zoom};if(camera!==view){onDeviceStart();onView(camera);}svg.current?.setPointerCapture(event.pointerId);};
  const move=(event:PointerEvent<SVGSVGElement>)=>{const d=drag.current;if(!d||d.id!==event.pointerId)return;const dx=event.clientX-d.x,dy=event.clientY-d.y;if(d.kind==='pan'){onView({...d.view,dx:d.view.dx+dx,dy:d.view.dy+dy});return;}
    if(d.kind.startsWith('aberration-')){onParametersPreview(aberrationDrag(d.parameters,d.kind as AberrationDrag,d.kind==='aberration-radius'?dx*120/180:d.kind==='aberration-aperture'?-2*dy/d.sy:dx/d.sx));return;}
    if(d.kind.startsWith('aperture-')){updateAperture(d.kind,dx/d.sx,-dy/d.sy,d.parameters,d.view,d.sx);return;}
    if(telescopeSizeHandle(d.kind)){const key=telescopeSizeKey(d.kind),direction=d.kind.endsWith('-top')?-1:1;onParametersPreview({[key]:clamp(key,d.parameters[key]+direction*2*dy/d.sy)});return;}
    if(d.kind==='object'){onParametersPreview({u:clamp('u',d.parameters.u-dx/d.sx),h:clamp('h',d.parameters.h-dy/d.sy)});return;}
    if(d.kind==='camera-sensor'){onParametersPreview({sensor:clamp('sensor',d.parameters.sensor+dx/d.sx)});return;}
    if(d.kind==='camera-lens'){const delta=cameraLensMove(d.parameters,dx/d.sx);onParametersPreview({u:d.parameters.u+delta,sensor:d.parameters.sensor-delta});onView({...d.view,dx:d.view.dx+delta*d.sx});return;}
    if(d.kind==='lens'||d.kind==='mirror'){const u=clamp('u',d.parameters.u+dx/d.sx);onParametersPreview({u});onView({...d.view,dx:d.view.dx+(u-d.parameters.u)*d.sx});return;}
    if(d.kind==='first-lens'){const delta=firstLensMove(d.parameters,dx/d.sx);onParametersPreview({u:d.parameters.u+delta,d:d.parameters.d-delta});onView({...d.view,dx:d.view.dx+delta*d.sx});return;}
    if(d.kind==='second-lens'){onParametersPreview({d:clamp('d',d.parameters.d+dx/d.sx)});return;}
    if(d.kind==='telescope-first'||d.kind==='telescope-second'){const next=clamp('d',d.parameters.d+(d.kind==='telescope-first'?-1:1)*dx/d.sx);onParametersPreview({d:next});if(d.kind==='telescope-first')onView({...d.view,dx:d.view.dx+(d.parameters.d-next)*d.sx});return;}
    if(d.kind==='focus'){onParametersPreview({f:clamp('f',d.parameters.f+d.parameters.kind*dx/d.sx)});return;}
    const rect=event.currentTarget.getBoundingClientRect(),px=event.clientX-rect.left,py=event.clientY-rect.top;let angle;if(telescope){const distance=Math.max(1,(x(0)-px)/d.sx);onAnglePreview(clamp('angle',(py-y(0))/d.sy/distance*180/Math.PI));return;}if(result.model==='interface')angle=Math.atan2(x(0)-px,y(0)-py)*180/Math.PI;else {const entry=result.segments[0].end;angle=Math.atan2(py-y(entry[1]),x(entry[0])-px)*180/Math.PI+state.parameters.apex/2;}onAnglePreview(Math.max(0,Math.min(result.model==='prism'?89:89.9,angle)));};
  const finish=(event:PointerEvent<SVGSVGElement>)=>{const d=drag.current;if(!d||d.id!==event.pointerId)return;drag.current=null;if(d.kind!=='pan')onAngleCommit();if(telescopeSizeHandle(d.kind))onView({...d.view,bounds:undefined});if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);};
  const deviceKey=(event:KeyboardEvent<SVGElement>,kind:Exclude<DragKind,'pan'|'angle'>)=>{if(telescopeSizeHandle(kind)){if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();onDeviceStart();const key=telescopeSizeKey(kind),field=SCENE_DEFINITIONS[state.sceneId].parameters.find(p=>p.key===key)!,next=event.key==='Home'?field.min:event.key==='End'?field.max:state.parameters[key]+(event.key==='ArrowUp'?1:-1)*field.step;onParametersPreview({[key]:clamp(key,next)});onAngleCommit();onView({...view,bounds:undefined});return;}if(kind.startsWith('aberration-')){const vertical=kind==='aberration-aperture',negative=vertical?'ArrowDown':'ArrowLeft',positive=vertical?'ArrowUp':'ArrowRight';if(![negative,positive,'Home','End'].includes(event.key))return;event.preventDefault();onDeviceStart();onView({...view,bounds:[xmin,xmax,ymin,ymax]});const delta=event.key==='Home'?-10000:event.key==='End'?10000:event.key===positive?1:-1;onParametersPreview(aberrationDrag(state.parameters,kind as AberrationDrag,delta));onAngleCommit();return;}if(kind.startsWith('aperture-')){const horizontal=kind==='aperture-lens'||kind==='aperture-stop',negative=horizontal?'ArrowLeft':'ArrowDown',positive=horizontal?'ArrowRight':'ArrowUp';if(event.key!==negative&&event.key!==positive)return;event.preventDefault();onDeviceStart();onView({...view,bounds:[xmin,xmax,ymin,ymax]});const step=event.key===positive?1:-1;updateAperture(kind,horizontal?step:0,horizontal?0:step/2,state.parameters,view,sx*zoom);onAngleCommit();return;}if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;const horizontal=event.key==='ArrowLeft'||event.key==='ArrowRight';if(kind!=='object'&&!horizontal)return;event.preventDefault();onDeviceStart();const direction=event.key==='ArrowLeft'||event.key==='ArrowDown'?-1:1,step=direction*(microscope?.01:1),p=state.parameters;if(kind==='camera-sensor'){onParametersPreview({sensor:clamp('sensor',p.sensor+step)});onView({...view,bounds:[xmin,xmax,ymin,ymax]});}else if(kind==='camera-lens'){const delta=cameraLensMove(p,step);onParametersPreview({u:p.u+delta,sensor:p.sensor-delta});onView({...view,bounds:[xmin,xmax,ymin,ymax],dx:view.dx+delta*sx*zoom});}else if(kind==='telescope-first'||kind==='telescope-second'){const spacing=clamp('d',p.d+(kind==='telescope-first'?-step:step));onParametersPreview({d:spacing});onView({...view,bounds:[xmin,xmax,ymin,ymax],dx:view.dx+(kind==='telescope-first'?(p.d-spacing)*sx*zoom:0)});}else if(kind==='object'){onParametersPreview(horizontal?{u:clamp('u',p.u-step)}:{h:clamp('h',p.h+direction*(microscope?.01:.5))});if(doubleLens||camera||aperture)onView({...view,bounds:[xmin,xmax,ymin,ymax]});}else if(kind==='first-lens'){const delta=firstLensMove(p,step);onParametersPreview({u:p.u+delta,d:p.d-delta});onView({...view,bounds:[xmin,xmax,ymin,ymax],dx:view.dx+delta*sx*zoom});}else if(kind==='second-lens'){onParametersPreview({d:clamp('d',p.d+step)});onView({...view,bounds:[xmin,xmax,ymin,ymax]});}else if(kind==='focus')onParametersPreview({f:clamp('f',p.f+p.kind*step)});else {const u=clamp('u',p.u+step);onParametersPreview({u});onView({...view,bounds:[xmin,xmax,ymin,ymax],dx:view.dx+(u-p.u)*sx*zoom});}onAngleCommit();};
  const distanceDimension=(key:string,a:number,b:number,position:number,vertical=false)=>{
    const color=quantityColor(key),symbol=doubleLens&&key==='v'?'v₂':key==='imageHeight'?'h′':key==='f'?'|f|':key==='sensor'?'s':key,ax=vertical?position:x(a),ay=vertical?y(a):position,bx=vertical?position:x(b),by=vertical?y(b):position;
    const value=key==='f'?state.parameters.f:['u','h','d','sensor','z'].includes(key)?state.parameters[key]:result.metrics.find(m=>m.key===key)?.value;
    const low=vertical?Math.min(ay,by):Math.min(ax,bx),high=vertical?Math.max(ay,by):Math.max(ax,bx),cx=(ax+bx)/2,cy=(ay+by)/2;
    const head=Math.min(6,(high-low)/3);
    return <g data-testid={`${result.model}-quantity-${key}`} aria-label={`${symbol} = ${numberText(value??null)} mm`}><title>{symbol} = {numberText(value??null)} mm</title><line x1={ax} y1={ay} x2={bx} y2={by} stroke={color} strokeWidth={1.4}/>{vertical?<path d={`M${position-4} ${low+head} L${position} ${low} L${position+4} ${low+head} M${position-4} ${high-head} L${position} ${high} L${position+4} ${high-head}`} fill="none" stroke={color}/>:<path d={`M${low+head} ${position-4} L${low} ${position} L${low+head} ${position+4} M${high-head} ${position-4} L${high} ${position} L${high-head} ${position+4}`} fill="none" stroke={color}/>}<text className="os-angle-label" x={vertical?Math.min(width-52,Math.max(30,cx+12)):cx} y={vertical?cy+6:cy-9} textAnchor={vertical?'start':'middle'} style={{fill:color}}>{symbol}</text></g>;
  };
  const arrow=(a:number,b:number,c:number,d:number,role:string,dashed=false,power=1,color?:string)=><line x1={x(a)} y1={y(b)} x2={x(c)} y2={y(d)} stroke={color??colors[role]??'#607d9d'} strokeWidth={role==='blocked'?1.5:2.7} strokeDasharray={dashed?'7 5':undefined} opacity={power<1e-9?0:role==='blocked'?.45:.3+.7*Math.sqrt(power)} markerEnd={color||role==='blocked'?undefined:`url(#${id}-${role})`}/>;
  const lensPath=`M${x(0)} ${y(ymax*.65)} L${x(0)} ${y(-ymax*.65)} M${x(0)-10} ${y(ymax*.65)+state.parameters.kind*10} L${x(0)} ${y(ymax*.65)} L${x(0)+10} ${y(ymax*.65)+state.parameters.kind*10} M${x(0)-10} ${y(-ymax*.65)-state.parameters.kind*10} L${x(0)} ${y(-ymax*.65)} L${x(0)+10} ${y(-ymax*.65)-state.parameters.kind*10}`;
  const mirrorPath=`M${x(0)-state.parameters.kind*15} ${y(ymax*.65)} Q${x(0)+state.parameters.kind*15} ${y(0)} ${x(0)-state.parameters.kind*15} ${y(-ymax*.65)}`;
  return <svg ref={svg} id={['interface','prism'].includes(result.model)?'refraction-ray-diagram':aperture?'aperture-ray-diagram':mirror?'mirror-ray-diagram':microscope?'microscope-ray-diagram':camera?'camera-ray-diagram':telescope?'telescope-ray-diagram':aberration?'aberration-ray-diagram':result.model==='double-lens'?'double-lens-ray-diagram':lens?'thin-lens-ray-diagram':undefined} className="os-diagram" onPointerDown={e=>begin(e,'pan')} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} data-presentation={apparatus||telescope&&telescopePresentation?.apparatus||camera&&cameraPresentation?.apparatus?'apparatus':'principle'} data-zoom={zoom} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${result.status}光路图`} data-testid="scene-diagram">
    <defs><clipPath id={`${id}-clip`}><rect x={25} y={25} width={width-50} height={height-50}/></clipPath>{Object.entries(colors).map(([role,color])=><marker key={role} id={`${id}-${role}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L7,3 L0,6" fill={color}/></marker>)}</defs>
    <rect width={width} height={height} fill="#fbfdff"/>
    <g clipPath={`url(#${id}-clip)`}>
    {!apparatus&&!(telescope&&telescopePresentation?.apparatus)&&!(camera&&cameraPresentation?.apparatus)&&Array.from({length:11},(_,i)=><g key={i}><line x1={25+i*(width-50)/10} x2={25+i*(width-50)/10} y1={25} y2={height-25} stroke="#e8eef5"/><line x1={25} x2={width-25} y1={25+i*(height-50)/10} y2={25+i*(height-50)/10} stroke="#e8eef5"/></g>)}
    {result.model==='interface'?<rect x={25} y={y(0)} width={width-50} height={Math.max(0,height-y(0)-25)} fill="#d8eaf9" fillOpacity=".5"/>:result.regions.map((r,i)=><polygon key={i} points={r.points.map(([a,b])=>`${x(a)},${y(b)}`).join(' ')} fill="#d8eaf9" fillOpacity=".5" stroke="#84abd0" strokeWidth="1.6"/>)}
    {result.model==='interface'&&<><line x1={25} x2={width-25} y1={y(0)} y2={y(0)} stroke="#8ba9c6" strokeWidth={2}/><line x1={x(0)} x2={x(0)} y1={25} y2={height-25} stroke="#8ba9c6" strokeDasharray="6 6"/>{normalLabelY!==undefined&&<text x={x(0)+12} y={normalLabelY}>法线</text>}</>}
    {['interface','prism'].includes(result.model)&&<RefractionAnnotations result={result} selected={refractionQuantities} x={x} y={y} width={width} height={height} scale={scale*zoom}/>}
    {geometric&&!lens&&<line x1={25} x2={width-25} y1={y(0)} y2={y(0)} stroke="#9bb0c5" strokeDasharray="6 6"/>}
    {apparatus&&<MicroscopeApparatus state={state} result={result} x={x} y={y} width={width} height={height}/>}
    {telescope&&<TelescopeRayOptics state={state} result={result} x={x} y={y} width={width} height={height}/>}
    {camera&&<CameraRayOptics state={state} result={result} x={x} y={y} width={width} height={height}/>}
    {result.devices?.filter(dev=>!['stop','pupil'].includes(dev.kind)&&!mirror&&!doubleLens&&!telescope&&!camera).map((dev,i)=><g key={i}>{dev.kind==='mirror'?<path d={`M${x(dev.x)-dev.sign*15} ${y(dev.height)} Q${x(dev.x)+dev.sign*15} ${y(0)} ${x(dev.x)-dev.sign*15} ${y(-dev.height)}`} fill="none" stroke="#877cb3" strokeWidth={4}/>:camera&&dev.kind==='lens'?<path d={`M${x(dev.x)} ${y(dev.height)} Q${x(dev.x)-22} ${y(0)} ${x(dev.x)} ${y(-dev.height)} Q${x(dev.x)+22} ${y(0)} ${x(dev.x)} ${y(dev.height)}Z`} fill="#b9d9ee" fillOpacity={.45} stroke="#5486b9" strokeWidth={2}/>:<path d={`M${x(dev.x)} ${y(dev.height)} L${x(dev.x)} ${y(-dev.height)} ${dev.kind==='lens'?`M${x(dev.x)-9} ${y(dev.height)+dev.sign*10} L${x(dev.x)} ${y(dev.height)} L${x(dev.x)+9} ${y(dev.height)+dev.sign*10} M${x(dev.x)-9} ${y(-dev.height)-dev.sign*10} L${x(dev.x)} ${y(-dev.height)} L${x(dev.x)+9} ${y(-dev.height)-dev.sign*10}`:''}`} fill="none" stroke={dev.kind==='screen'?(camera?quantityColor('sensor'):'#c38536'):'#5486b9'} strokeWidth={dev.kind==='screen'?4:3}/>}<text x={camera?Math.min(width-55,Math.max(55,x(dev.x))):x(dev.x)} y={camera?Math.max(42,y(dev.height)-15-(camera&&dev.kind==='screen'&&Math.abs(x(dev.x)-x(0))<100?24:0)):aberration?Math.max(98,y(dev.height)-15):aperture?Math.max(44,y(dev.height)-15-(Math.abs(x(state.parameters.z)-x(0))<90&&Math.abs(y(state.parameters.stopD/2)-y(dev.height))<30?24:0)):y(dev.height)-15} textAnchor="middle">{dev.label}</text></g>)}
    {doubleLens&&result.devices?.filter(dev=>dev.kind==='lens').map((dev,i)=>{const half=apparatus?microscopeApparatusHalfHeight(result,y,height)*.82:0,top=apparatus?y(0)-half:y(ymax*.65),bottom=apparatus?y(0)+half:y(-ymax*.65),cx=x(dev.x),close=Math.abs(x(state.parameters.d)-x(0))<90;return <g key={i}>{apparatus&&<path d={`M${cx} ${top}Q${cx-15} ${y(0)} ${cx} ${bottom}Q${cx+15} ${y(0)} ${cx} ${top}Z`} fill="#c5e2ed" fillOpacity={.6} stroke="#6695b0" strokeWidth={1.5}/>}<path opacity={apparatus?0:1} d={`M${cx} ${top} L${cx} ${bottom} M${cx-9} ${top+dev.sign*10} L${cx} ${top} L${cx+9} ${top+dev.sign*10} M${cx-9} ${bottom-dev.sign*10} L${cx} ${bottom} L${cx+9} ${bottom-dev.sign*10}`} fill="none" stroke={quantityColor(i?'f2':'f1')} strokeWidth={3}/><text x={Math.min(width-55,Math.max(55,cx))} y={Math.max(42,top-15-(close&&i?24:0))} textAnchor="middle">{dev.label}</text></g>;})}
    {cameraMicroscope&&result.devices?.filter(dev=>dev.kind==='screen').map((dev,i)=><g key={i}><title>图示为转接前光路；线段表示折算到管镜像面的感光面范围，实际相机倍率还需乘转接倍率。</title><line x1={x(dev.x)} x2={x(dev.x)} y1={y(dev.height)} y2={y(-dev.height)} stroke={quantityColor('sensorH')} strokeWidth={4}/><text x={Math.min(width-95,Math.max(95,x(dev.x)))} y={Math.max(42,y(dev.height)-15)} textAnchor="middle" style={{fill:quantityColor('sensorH')}}>{!apparatus&&dev.label}</text></g>)}
    {lens && <><line x1={25} x2={width-25} y1={y(0)} y2={y(0)} stroke="#9bb0c5" strokeDasharray="6 6"/><path d={lensPath} fill="none" stroke={quantityColor('f')} strokeWidth={3}/><text x={x(0)} y={y(ymax*.78)} textAnchor="middle" style={{fill:quantityColor('f')}}>薄透镜</text></>}
    {result.devices?.filter(dev=>['stop','pupil'].includes(dev.kind)).map((dev,i)=><g key={'aperture-'+i}>{dev.kind==='stop'?<path d={`M${x(dev.x)} 25 L${x(dev.x)} ${y(dev.height)} M${x(dev.x)} ${y(-dev.height)} L${x(dev.x)} ${height-25}`} stroke="#6c7787" strokeWidth={5}/>:<line x1={x(dev.x)+4} x2={x(dev.x)+4} y1={y(dev.height)} y2={y(-dev.height)} stroke="#a075b7" strokeWidth={2} strokeDasharray="5 4"/>}<text x={aperture?Math.min(width-35,Math.max(35,x(dev.x)+7)):x(dev.x)+7} y={aperture?Math.max(44,Math.min(height-38,dev.kind==='pupil'?y(-dev.height)+20:y(dev.height)-12)):dev.kind==='pupil'?y(-dev.height)+20:y(dev.height)-12} textAnchor={aperture&&x(dev.x)+7+dev.label.length*14>width-30?'end':'start'}>{dev.label}</text></g>)}
    {result.segments.map((s,i)=><g key={i}>{eyePosition!==null&&s.role==='transmitted'?arrow(...s.start,eyePosition,microscopeRayHeight(s,eyePosition),s.role,s.dashed,s.power,s.color):arrow(...s.start,...s.end,s.role,s.dashed,s.power,s.color)}</g>)}
    {eyePosition!==null&&<MicroscopeEye state={state} result={result} x={x} y={y}/>}
    {aberration&&<AberrationAnnotations result={result} state={state} x={x} y={y} width={width} height={height} selected={aberrationQuantity}/>}
    {result.markers.filter(m=>!['interface','prism'].includes(result.model)&&!(lens&&m.role==='annotation')&&!doubleLens&&!aberration).map((m,i)=><g key={i}>{['object','image'].includes(m.role)&&<>{arrow(m.x,0,m.x,m.y,m.role==='object'?'incident':'transmitted',m.label.includes('虚像'))}<circle cx={x(m.x)} cy={y(0)} r={3} fill="#68809d"/></>}{m.role==='focus'&&<circle cx={x(m.x)} cy={y(m.y)} r={4} fill="#5887b5"/>}<text x={aperture?Math.min(width-35,Math.max(35,x(m.x)+(x(m.x)+7+m.label.length*14>width-30?-7:7))):x(m.x)+(m.role==='annotation'?0:result.model==='aberration'&&m.label==='边缘焦点'?-7:7)} y={y(m.y)+(m.role==='focus'?(result.model==='aberration'?(m.label==='边缘焦点'?42:-18):22):m.role==='object'||m.role==='image'?-10:0)} textAnchor={aperture&&x(m.x)+7+m.label.length*14>width-30?'end':m.role==='annotation'?'middle':result.model==='aberration'&&m.label==='边缘焦点'?'end':'start'} style={{fill:m.role==='object'?quantityColor('h'):m.role==='image'?quantityColor('imageHeight'):m.role==='focus'?quantityColor('f'):undefined}}>{m.label}</text></g>)}
    {doubleLens&&(()=>{
      const occupied:{left:number;right:number;top:number;bottom:number}[]=[];
      const {u,d}=state.parameters,v=result.metrics.find(m=>m.key==='v')?.value;
      const reserve=(center:number,baseline:number,halfWidth:number)=>occupied.push({left:center-halfWidth,right:center+halfWidth,top:baseline-24,bottom:baseline+6});
      if(microscope){reserve((x(-u)+x(0))/2,y(0)+dualDimensionBase-9,8);reserve((x(0)+x(d))/2,y(0)+dualDimensionBase+(tightDimensions?26:0)-9,9);
      if(v!==null&&v!==undefined&&result.markers.some(m=>m.label.startsWith('最终')))reserve((x(d)+x(d+v))/2,y(0)+dualDimensionBase+(tightDimensions?52:34)-9,14);}
      return result.markers.map((m,i)=>{
        const labelWidth=m.label.length*14+4,end=x(m.x)+7+labelWidth>width-28,cx=x(m.x)+(end?-7:7);
        let cy=y(m.y)-10;
        for(const offset of [0,-28,-56,28,56]){
          const baseline=Math.min(height-36,Math.max(46,y(m.y)-10+offset));
          const rect={left:cx-(end?labelWidth:0),right:cx+(end?0:labelWidth),top:baseline-19,bottom:baseline+5};
          if(!occupied.some(p=>rect.left<p.right+4&&rect.right>p.left-4&&rect.top<p.bottom+4&&rect.bottom>p.top-4)){cy=baseline;occupied.push(rect);break;}
        }
        return <g key={i} data-testid={`${dualPrefix}-${m.role==='object'?'object':m.label==='中间像'?'intermediate-image':'final-image'}`}>{arrow(m.x,0,m.x,m.y,m.role==='object'?'incident':'transmitted',m.label.includes('虚像'))}<circle cx={x(m.x)} cy={y(0)} r={3} fill="#68809d"/><text x={cx} y={cy} textAnchor={end?'end':'start'} style={{fill:quantityColor(m.role==='object'?'h':'v')}}>{m.label}</text></g>;
      });
    })()}
    {mirror&&<><path d={mirrorPath} fill="none" stroke="#877cb3" strokeWidth={4}/><text x={x(0)} y={y(ymax*.65)-15} textAnchor="middle">{state.parameters.kind>0?'凹面镜':'凸面镜'}</text></>}
    {telescope&&<>

      {telescopePresentation?.selected.has('angle')&&(()=>{const ray=result.segments.find(s=>s.role==='incident'&&Math.abs(s.end[1])<1e-10)!;return <text className="os-angle-label" x={x(ray.start[0])+18} y={y(ray.start[1])-16} style={{fill:quantityColor('angle')}}>θ</text>;})()}
      {telescopePresentation?.selected.has('centralAngle')&&(()=>{
        const inside=result.segments.find(s=>s.role==='internal'&&Math.abs(s.start[1])<1e-10);
        const ray=inside&&result.segments.find(s=>s.role==='transmitted'&&Math.abs(s.start[1]-inside.end[1])<1e-10);
        if(!ray)return null;
        const ox=x(ray.start[0]),oy=y(ray.start[1]),phi=Math.atan2(y(ray.end[1])-oy,x(ray.end[0])-ox);
        const radius=Math.min(42,Math.max(12,(x(ray.end[0])-ox)*.35)),color=quantityColor('centralAngle');
        const value=result.metrics.find(m=>m.key==='centralAngle')?.value;
        return <g data-testid="telescope-exit-angle" data-angle={value} aria-label={`主光线出射角 θ′ = ${numberText(value??null)}°`}>
          <title>θ′：主光线离开目镜后与光轴的夹角；向上为正，向下为负。</title>
          <line x1={ox} y1={oy} x2={ox+radius+12} y2={oy} stroke={color} strokeWidth={1} strokeDasharray="4 4" opacity={.7}/>
          {Math.abs(phi)>1e-8&&<path d={`M${ox+radius} ${oy} A${radius} ${radius} 0 0 ${phi>0?1:0} ${ox+radius*Math.cos(phi)} ${oy+radius*Math.sin(phi)}`} fill="none" stroke={color} strokeWidth={1.5}/>}
          <text className="os-angle-label" x={Math.min(width-45,ox+radius+16)} y={Math.max(45,Math.min(height-45,oy+(phi>=0?-12:23)))} style={{fill:color}}>θ′</text>
        </g>;
      })()}
      {result.devices?.map((dev,i)=><g key={i} className="os-device-handle os-horizontal-handle" role="slider" tabIndex={0} aria-label={i?'拖动目镜改变镜间距':'拖动物镜改变镜间距'} aria-valuemin={20} aria-valuemax={600} aria-valuenow={state.parameters.d} onPointerDown={e=>begin(e,i?'telescope-second':'telescope-first')} onKeyDown={e=>deviceKey(e,i?'telescope-second':'telescope-first')}><line x1={x(dev.x)} x2={x(dev.x)} y1={y(dev.height)} y2={y(-dev.height)} stroke="transparent" strokeWidth={24}/><circle data-testid={i?'telescope-second-handle':'telescope-first-handle'} cx={x(dev.x)} cy={y(0)} r={7} fill="white" stroke={quantityColor(i?'f2':'f1','telescope')} strokeWidth={2}/></g>)}
      {(['aperture','eyepieceDiameter'] as const).map((key,i)=>{const field=SCENE_DEFINITIONS[state.sceneId].parameters.find(p=>p.key===key)!,cx=x(i?state.parameters.d:0),color=quantityColor(key,'telescope');return (['top','bottom'] as const).map(edge=>{const kind=`telescope-${i?'eyepiece':'objective'}-${edge}` as DragKind,edgeY=y((edge==='top'?1:-1)*state.parameters[key]/2),handleX=cx+(i?18:-18);return <g key={kind} className="os-device-handle os-vertical-handle" role="slider" tabIndex={0} aria-label={`拖动${i?'目镜':'物镜'}${edge==='top'?'上':'下'}边缘调整${i?'通光口径':'有效直径'}`} aria-orientation="vertical" aria-valuemin={field.min} aria-valuemax={field.max} aria-valuenow={state.parameters[key]} onPointerDown={e=>begin(e,kind)} onKeyDown={e=>deviceKey(e,kind as Exclude<DragKind,'pan'|'angle'>)}>
        <title>上下拖动改变口径，镜片中心保持不变；方向键上增大、下减小</title><path d={`M${cx} ${edgeY}H${handleX}`} stroke={color}/><circle data-testid={`telescope-${i?'eyepiece':'objective'}-${edge}-size-handle`} cx={handleX} cy={edgeY} r={7} fill="white" stroke={color} strokeWidth={2}/>
      </g>;});})}
      {(()=>{const ray=result.segments.find(s=>s.role==='incident'&&Math.abs(s.end[1])<1e-10)!;return <circle className="os-angle-handle" data-testid="telescope-angle-handle" cx={x(ray.start[0])} cy={y(ray.start[1])} r={9} fill="white" stroke={quantityColor('angle')} strokeWidth={2} role="slider" tabIndex={0} aria-label="拖动远方入射光改变方向" aria-valuemin={-3} aria-valuemax={3} aria-valuenow={state.parameters.angle} onPointerDown={e=>begin(e,'angle')} onKeyDown={e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();onAnglePreview(clamp('angle',state.parameters.angle+(e.key==='ArrowDown'?.1:-.1)));onAngleCommit();}}}/>;})()}
    </>}
    {doubleLens&&(()=>{
      const {u,h,d}=state.parameters,v=result.metrics.find(m=>m.key==='v')?.value,finalImage=result.markers.find(m=>m.label.startsWith('最终'));
      const fields=SCENE_DEFINITIONS[state.sceneId].parameters,uField=fields.find(p=>p.key==='u')!,dField=fields.find(p=>p.key==='d')!;
      return <>
        {microscope&&<MicroscopeRayAnnotations result={result} x={x} y={y} width={width} height={height}/>}
        {!microscope&&<DoubleLensAnnotations result={result} selected={doubleQuantities} x={x} y={y} width={width} height={height}/>}
        {result.devices?.filter(dev=>dev.kind==='lens').map((dev,i)=><line key={i} className="os-device-handle os-horizontal-handle" x1={x(dev.x)} x2={x(dev.x)} y1={y(ymax*.65)} y2={y(-ymax*.65)} stroke="transparent" strokeWidth={24} onPointerDown={e=>begin(e,i?'second-lens':'first-lens')}/>)}
        {result.devices?.filter(dev=>dev.kind==='lens').map((dev,i)=>{const kind=i?'second-lens':'first-lens',label=microscope?(i?(cameraMicroscope?'拖动管镜改变间距':'拖动目镜改变间距'):'拖动物镜改变物距和间距'):(i?'拖动第二片透镜改变间距':'拖动第一片透镜改变物距和间距'),field=i?dField:uField;return <g key={i} className="os-device-handle os-horizontal-handle" role="slider" tabIndex={0} aria-label={label} aria-valuemin={field.min} aria-valuemax={field.max} aria-valuenow={i?d:u} onPointerDown={e=>begin(e,kind)} onKeyDown={e=>deviceKey(e,kind)}><title>{cameraMicroscope&&i?'沿光轴移动管镜，感光面保持在管镜后焦面':i?'沿光轴移动第二片，物体与第一片保持原位':'沿光轴移动第一片，物体与第二片保持原位'}</title><circle data-testid={`${dualPrefix}-${kind}-handle`} cx={x(dev.x)} cy={y(0)+(i?(crowdedControls?48:-20):20)} r={7} fill="white" stroke={quantityColor(i?'f2':'f1')} strokeWidth={2}/></g>;})}
        <g className="os-device-handle" role="slider" tabIndex={0} aria-label="拖动物体改变物距和高度" aria-valuemin={uField.min} aria-valuemax={uField.max} aria-valuenow={u} onPointerDown={e=>begin(e,'object')} onKeyDown={e=>deviceKey(e,'object')}><title>左右移动物体改变物距，上下移动改变高度</title><line x1={x(-u)} x2={x(-u)} y1={y(0)} y2={y(h)} stroke="transparent" strokeWidth={24}/><circle data-testid={`${dualPrefix}-object-handle`} cx={x(-u)} cy={y(h)} r={8} fill="white" stroke={quantityColor('h')} strokeWidth={2}/></g>
        {v===null&&!microscope&&<text x={width-40} y={45} textAnchor="end" style={{fill:quantityColor('v')}}>最终像在无穷远</text>}
      </>;
    })()}
    {aperture&&<>
      <ApertureAnnotations result={result} selected={apertureQuantities} x={x} y={y} width={width} height={height}/>
      <g className="os-device-handle" role="slider" tabIndex={0} aria-label="拖动物点改变物距和离轴高度" aria-valuemin={160} aria-valuemax={600} aria-valuenow={state.parameters.u} onPointerDown={e=>begin(e,'object')} onKeyDown={e=>deviceKey(e,'object')}><title>左右移动改变物距，上下移动改变离轴高度</title><circle data-testid="aperture-object-handle" cx={x(-state.parameters.u)} cy={y(state.parameters.h)} r={8} fill="white" stroke={quantityColor('h')} strokeWidth={2}/></g>
      {(['lens','stop'] as const).map(kind=>{const stop=kind==='stop',key=stop?'stopD':'lensD',pos=stop?state.parameters.z:0,diam=state.parameters[key],positionKind=stop?'aperture-stop':'aperture-lens',sizeKind=stop?'aperture-stop-size':'aperture-lens-size';return <g key={kind}>
        <g className="os-device-handle os-horizontal-handle" role="slider" tabIndex={0} aria-label={stop?'拖动外置光阑改变位置':'拖动透镜改变位置'} aria-valuemin={stop?-120:160} aria-valuemax={stop?240:600} aria-valuenow={stop?pos:state.parameters.u} onPointerDown={e=>begin(e,positionKind)} onKeyDown={e=>deviceKey(e,positionKind)}>
          <title>{stop?'沿光轴移动外置光阑，物点与透镜保持原位':'沿光轴移动透镜，物点与外置光阑保持原位'}</title>
          {stop?<path d={`M${x(pos)} 25V${y(diam/2)} M${x(pos)} ${y(-diam/2)}V${height-25}`} fill="none" stroke="transparent" strokeWidth={24}/>:<line x1={x(pos)} x2={x(pos)} y1={y(diam/2)} y2={y(-diam/2)} stroke="transparent" strokeWidth={24}/>}
          <circle data-testid={`aperture-${kind}-handle`} cx={x(pos)} cy={y(0)+(stop?22:-22)} r={7} fill="white" stroke={quantityColor(stop?'z':'f')} strokeWidth={2}/>
        </g>
        <g className="os-device-handle os-vertical-handle" role="slider" tabIndex={0} aria-label={stop?'拖动光阑边缘调整直径':'拖动透镜边缘调整口径'} aria-orientation="vertical" aria-valuemin={stop?2:5} aria-valuemax={stop?60:80} aria-valuenow={diam} onPointerDown={e=>begin(e,sizeKind)} onKeyDown={e=>deviceKey(e,sizeKind)}>
          <title>上下移动边缘，中心保持在光轴上；方向键可微调</title>
          <line x1={x(pos)} x2={x(pos)+(stop?18:-18)} y1={y(diam/2)} y2={y(diam/2)} stroke={quantityColor(key)}/>
          <circle data-testid={`aperture-${kind}-size-handle`} cx={x(pos)+(stop?18:-18)} cy={y(diam/2)} r={7} fill="white" stroke={quantityColor(key)} strokeWidth={2}/>
        </g>
      </g>;})}
    </>}
    {camera&&<>
      <g className="os-device-handle" role="slider" tabIndex={0} aria-label="拖动物体改变物距和高度" aria-valuemin={20} aria-valuemax={5000} aria-valuenow={state.parameters.u} onPointerDown={e=>begin(e,'object')} onKeyDown={e=>deviceKey(e,'object')}><title>左右移动改变物距，上下移动改变物体高度</title><line x1={x(-state.parameters.u)} x2={x(-state.parameters.u)} y1={y(0)} y2={y(state.parameters.h)} stroke="transparent" strokeWidth={24}/><circle data-testid="camera-object-handle" cx={x(-state.parameters.u)} cy={y(state.parameters.h)} r={8} fill="white" stroke={quantityColor('h')} strokeWidth={2}/></g>
      {result.devices?.map((dev,i)=><g key={i} className="os-device-handle os-horizontal-handle" role="slider" tabIndex={0} aria-label={i?'拖动感光面改变位置':'拖动镜头改变物距和感光面距离'} aria-valuemin={i?10:20} aria-valuemax={i?300:5000} aria-valuenow={i?state.parameters.sensor:state.parameters.u} onPointerDown={e=>begin(e,i?'camera-sensor':'camera-lens')} onKeyDown={e=>deviceKey(e,i?'camera-sensor':'camera-lens')}><title>{i?'沿光轴移动感光面，物体和镜头保持原位':'沿光轴移动镜头，物体与感光面保持原位'}</title><line x1={x(dev.x)} x2={x(dev.x)} y1={y(dev.height)} y2={y(-dev.height)} stroke="transparent" strokeWidth={24}/><circle data-testid={i?'camera-sensor-handle':'camera-lens-handle'} cx={x(dev.x)} cy={y(0)+(i?-20:20)} r={7} fill="white" stroke={quantityColor(i?'sensor':'f')} strokeWidth={2}/></g>)}
    </>}
    {movable&&(()=>{
      const {u,h,f,kind}=state.parameters,image=result.markers.find(m=>m.role==='image'),v=result.metrics.find(m=>m.key==='v')?.value;
      const field=SCENE_DEFINITIONS[state.sceneId].parameters.find(p=>p.key==='u')!,prefix=mirror?'mirror':'lens',deviceKind=mirror?'mirror':'lens',deviceName=mirror?'球面镜':'薄透镜';
      return <>
        {mirror&&<MirrorAnnotations result={result} selected={mirrorQuantities} x={x} y={y} width={width} height={height}/>}
        {lens&&<ThinLensAnnotations result={result} selected={thinQuantities} x={x} y={y} width={width} height={height}/>}
        <g className="os-device-handle" role="slider" tabIndex={0} aria-label="拖动物体改变物距和高度" aria-valuemin={field.min} aria-valuemax={field.max} aria-valuenow={u} onPointerDown={e=>begin(e,'object')} onKeyDown={e=>deviceKey(e,'object')}><title>左右移动物体改变物距，上下移动改变高度</title><line x1={x(-u)} x2={x(-u)} y1={y(0)} y2={y(h)} stroke="transparent" strokeWidth={24}/><circle data-testid={`${prefix}-object-handle`} cx={x(-u)} cy={y(h)} r={8} fill="white" stroke={quantityColor('h')} strokeWidth={2}/></g>
        <g className="os-device-handle os-horizontal-handle" role="slider" tabIndex={0} aria-label={`拖动${deviceName}改变物距`} aria-valuemin={field.min} aria-valuemax={field.max} aria-valuenow={u} onPointerDown={e=>begin(e,deviceKind)} onKeyDown={e=>deviceKey(e,deviceKind)}><title>沿光轴移动{deviceName}，物体保持原位</title><path d={mirror?mirrorPath:lensPath} fill="none" stroke="transparent" strokeWidth={24}/><circle data-testid={`${prefix}-position-handle`} cx={x(0)} cy={y(0)} r={7} fill="white" stroke={mirror?'#877cb3':quantityColor('f')} strokeWidth={2}/></g>
        {lens&&<circle className="os-device-handle os-horizontal-handle" data-testid="lens-focus-handle" cx={x(f*kind)} cy={y(0)} r={7} fill="white" stroke={quantityColor('f')} strokeWidth={2} role="slider" tabIndex={0} aria-label="拖动焦点改变焦距大小" aria-valuemin={10} aria-valuemax={250} aria-valuenow={f} onPointerDown={e=>begin(e,'focus')} onKeyDown={e=>deviceKey(e,'focus')}><title>F′ 是像方焦点；拖动改变焦距大小 |f|</title></circle>}
        {v===null&&(!lens||!thinQuantities.has('v')&&!thinQuantities.has('imageHeight'))&&(!mirror||!mirrorQuantities.has('v')&&!mirrorQuantities.has('imageHeight'))&&<text x={width-40} y={45} textAnchor="end" style={{fill:quantityColor('v')}}>像在无穷远</text>}
      </>;
    })()}
    {aberration&&(()=>{const p=state.parameters,{aperture:ap,thickness:t}=aberrationDimensions(p),screen=result.devices?.[0];return <>
      {screen&&<g className="os-device-handle os-horizontal-handle" role="slider" tabIndex={0} aria-label="拖动观察屏改变屏距" aria-valuemin={20} aria-valuemax={500} aria-valuenow={p.screen} onPointerDown={e=>begin(e,'aberration-screen')} onKeyDown={e=>deviceKey(e,'aberration-screen')}><title>左右拖动观察屏，实时查看光线落点和光斑大小</title><line x1={x(screen.x)} x2={x(screen.x)} y1={y(screen.height)} y2={y(-screen.height)} stroke="transparent" strokeWidth={24}/><circle data-testid="aberration-screen-handle" cx={x(screen.x)} cy={y(0)-20} r={8} fill="white" stroke="#c38536" strokeWidth={2}/></g>}
      <g className="os-device-handle os-vertical-handle" role="slider" tabIndex={0} aria-label="拖动透镜边缘改变通光直径" aria-orientation="vertical" aria-valuemin={2} aria-valuemax={50} aria-valuenow={p.diameter} onPointerDown={e=>begin(e,'aberration-aperture')} onKeyDown={e=>deviceKey(e,'aberration-aperture')}><title>上下拖动透镜边缘，改变参与聚焦的光线范围</title><circle data-testid="aberration-aperture-handle" cx={x(t/2)} cy={y(ap)} r={8} fill="white" stroke={quantityColor('diameter')} strokeWidth={2}/><text x={x(t/2)+14} y={y(ap)-10} style={{fontSize:12}}>D = {numberText(p.diameter)} mm</text></g>
    </>;})()}
    {['interface','prism'].includes(result.model)&&<circle className="os-angle-handle" data-testid="incidence-angle-handle" cx={x(result.segments[0].start[0])} cy={y(result.segments[0].start[1])} r={10} fill="white" stroke={quantityColor('angle')} strokeWidth={2} tabIndex={0} role="slider" aria-label="拖动入射光改变入射角" aria-valuemin={0} aria-valuemax={result.model==='prism'?89:89.9} aria-valuenow={state.parameters.angle} onPointerDown={e=>begin(e,'angle')} onKeyDown={e=>{if(['ArrowLeft','ArrowDown','ArrowRight','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();onAnglePreview(Math.max(0,Math.min(result.model==='prism'?89:89.9,e.key==='Home'?0:e.key==='End'?(result.model==='prism'?89:89.9):state.parameters.angle+(['ArrowLeft','ArrowDown'].includes(e.key)?-1:1))));onAngleCommit();}}}><title>拖动圆点改变入射角；方向键也可调整</title></circle>}
    </g>
    {geometric&&Array.from({length:aberration?Math.max(3,Math.min(6,Math.floor(width/115))):6},(_,i)=>{const intervals=aberration?Math.max(3,Math.min(6,Math.floor(width/115)))-1:5,a=xmin+(xmax-xmin)*i/intervals;return <text key={i} x={x(a)} y={movable||doubleLens||telescope||camera||aperture||aberration?height-10:y(0)+20} textAnchor="middle">{numberText(aberration?Number(a.toFixed(1)):a)}</text>;})}
  </svg>;
}

export function SceneCurve({result,flatCentered=false}:{result:SceneResult;flatCentered?:boolean}){
  const svg=useRef<SVGSVGElement>(null);
  const [width,setWidth]=useState(240),[tickWidth,setTickWidth]=useState(75);
  const powerComparison=result.model==='interface';
  const valid=result.curve.filter(p=>p.y!==null && Number.isFinite(p.y));
  const hasCurve=valid.length>0;
  useEffect(()=>{
    const el=svg.current;if(!el)return;
    const measure=()=>setWidth(Math.max(1,el.getBoundingClientRect().width));
    measure();const observer=new ResizeObserver(measure);observer.observe(el);return()=>observer.disconnect();
  },[hasCurve]);
  const xmin=result.curve[0]?.x??0,xmax=result.curve.at(-1)?.x??1;
  const symmetricAngle=result.model==='prism'?symmetricPrismAngle(result.input):null;
  const symmetricDelta=result.metrics.find(m=>m.key==='minimumDeviation')?.value;
  const reference=symmetricAngle!==null&&symmetricAngle>=xmin&&symmetricAngle<=xmax&&symmetricDelta!==null&&symmetricDelta!==undefined?{x:symmetricAngle,y:symmetricDelta}:null;
  const values=[...valid.map(p=>p.y!),...(powerComparison?[100]:[]),...(reference?[reference.y]:[])];
  const flat=flatCentered&&values.length>0&&Math.max(...values)-Math.min(...values)<1e-10;
  const ymin=flat?values[0]-.5:result.model==='aberration'?Math.min(...values):Math.min(0,...values),ymax=flat?values[0]+.5:Math.max(...values);
  const span=Math.max(result.model==='aberration'?Math.max(1e-6,Math.abs(ymax)*1e-6):1,ymax-ymin);
  const xAxis=sceneAxisDisplay(result.chart.xLabel,Math.max(Math.abs(xmin),Math.abs(xmax))),yAxis=sceneAxisDisplay(powerComparison?'功率比例 / %':result.chart.yLabel,Math.max(Math.abs(ymin),Math.abs(ymin+span)));
  const lower=yAxis.format(ymin),upper=yAxis.format(ymin+span);
  useEffect(()=>{
    const labels=svg.current?.querySelectorAll<SVGTextElement>('.os-curve-y-tick');
    if(labels?.length)setTickWidth(Math.ceil(Math.max(...Array.from(labels,label=>label.getComputedTextLength()))));
  },[lower,upper,hasCurve]);
  if(!hasCurve)return <p>当前范围没有可显示的有效结果。</p>;
  const left=tickWidth+12,right=width-12,plotWidth=Math.max(1,right-left);
  const x=(n:number)=>left+(n-xmin)/(xmax-xmin)*plotWidth,y=(n:number)=>170-(n-ymin)/span*130;
  const series=[{key:'R',points:result.curve,color:powerComparison?quantityColor('R',result.model):result.model==='prism'?quantityColor('deviation','prism'):'#3c86ba',current:result.chart.currentY},...(powerComparison?[{key:'T',points:result.curve.map(p=>({x:p.x,y:p.y===null?null:100-p.y})),color:quantityColor('T',result.model),current:result.metrics.find(m=>m.key==='T')?.value??null}]:[])];
  const curves=series.map(line=>{
    const paths:string[]=[];let active='';
    for(const p of line.points){if(p.y===null||!Number.isFinite(p.y)){if(active)paths.push(active);active='';}else active+=`${active?'L':'M'}${x(p.x)} ${y(p.y)} `;}
    if(active)paths.push(active);
    return <g key={line.key} data-testid={powerComparison?`interface-power-curve-${line.key}`:undefined}>{paths.map((d,i)=><path key={i} d={d} fill="none" stroke={line.color} strokeWidth={2}/>)}{line.current!==null&&line.current>=ymin&&line.current<=ymax&&<circle data-value={line.current} cx={x(result.chart.currentX)} cy={y(line.current)} r={4} fill={powerComparison?line.color:'#c68134'}/>}</g>;
  });
  return <><svg ref={svg} className="os-curve" viewBox={`0 0 ${width} 225`} role="img" aria-label={yAxis.label+'随'+xAxis.label+'的变化'}><line x1={left} x2={right} y1={170} y2={170} stroke="#91a7bf"/><line x1={left} x2={left} y1={35} y2={170} stroke="#91a7bf"/>{curves}
    {reference&&<g data-testid="prism-symmetric-point" data-incidence={reference.x} data-deviation={reference.y} aria-label={`对称光路偏折 δₛ = ${numberText(reference.y)}°`}><title>入射角与出射角相等时的偏折值</title><path d={`M${x(reference.x)} ${y(reference.y)-6} l6 6 -6 6 -6 -6 Z`} fill="white" stroke={quantityColor('minimumDeviation',result.model)} strokeWidth={1.5}/><text x={Math.min(right-15,Math.max(left+15,x(reference.x)))} y={y(reference.y)+(y(reference.y)<65?20:-13)} textAnchor="middle" style={{fill:quantityColor('minimumDeviation',result.model),fontSize:18,fontFamily:'Georgia, serif',fontStyle:'italic'}}>δₛ</text></g>}
    <text x={4} y={20}>{yAxis.label}</text><text x={width/2} y={215} textAnchor="middle">{xAxis.label}</text><text x={left} y={190}>{xAxis.format(xmin)}</text><text x={right} y={190} textAnchor="end">{xAxis.format(xmax)}</text><text className="os-curve-y-tick" x={left-8} y={170} textAnchor="end">{lower}</text><text className="os-curve-y-tick" x={left-8} y={43} textAnchor="end">{upper}</text></svg>{powerComparison&&<div className="os-legend" aria-label="功率曲线图例" style={{fontSize:12}}><span><i style={{background:quantityColor('R',result.model)}}/>反射功率 R</span><span><i style={{background:quantityColor('T',result.model)}}/>透射功率 T</span></div>}</>;
}

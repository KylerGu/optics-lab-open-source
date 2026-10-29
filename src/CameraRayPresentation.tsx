import {cameraAnnotationKeys,cameraAnnotationVisible} from './cameraAnnotations';
import {CAMERA_FIELD_ANNOTATIONS} from './cameraFieldQuantities';
import {createContext,useContext,useEffect,useState,type CSSProperties,type ReactNode} from 'react';
import type {SceneResult,SceneState} from './sceneRuntime';
import {cameraOptics} from './cameraModel';
import SceneQuantityLabel from './SceneQuantityLabel';
import SceneValue,{displayNumber as numberText} from './SceneValue';
import MicroscopeDetails from './MicroscopeDetails';
import {quantityColor} from './scenePresentation';

type Controls={study:number;selected:ReadonlySet<string>;toggle:(key:string)=>void;apparatus:boolean;setApparatus:(value:boolean)=>void;fieldMode:'sample'|'sensor';setFieldMode:(value:'sample'|'sensor')=>void};
const Context=createContext<Controls|null>(null);
export const useCameraPresentation=()=>useContext(Context);
export function CameraRayProvider({enabled,study=0,children}:{enabled:boolean;study?:number;children:ReactNode}){
  const [selected,setSelected]=useState<ReadonlySet<string>>(()=>new Set());
  const [fieldMode,setFieldMode]=useState<'sample'|'sensor'>('sensor');
  const [apparatus,setApparatus]=useState(()=>{try{return localStorage.getItem('optics-camera-presentation-v1')==='apparatus';}catch{return false;}});
  useEffect(()=>{if(enabled)try{localStorage.setItem('optics-camera-presentation-v1',apparatus?'apparatus':'principle');}catch{/* Keep the view usable without storage. */}},[enabled,apparatus]);
  const toggle=(key:string)=>{
    const target=study===1&&CAMERA_FIELD_ANNOTATIONS.includes(key)?(['sensorW','sensorH'].includes(key)?'sensor':'sample'):null;
    if(target)setFieldMode(target);
    setSelected(previous=>{const next=new Set(previous);if(next.has(key)&&(!target||target===fieldMode))next.delete(key);else next.add(key);return next;});
  };
  return <Context.Provider value={enabled?{study,selected,toggle,apparatus,setApparatus,fieldMode,setFieldMode}:null}>{children}</Context.Provider>;
}
export function CameraPresentationSwitch(){
  const c=useCameraPresentation();if(!c)return null;
  return <div className="os-microscope-presentation" role="group" aria-label="光路显示方式">{['原理光路','装置示意'].map((label,i)=><button type="button" key={label} aria-pressed={c.apparatus===!!i} onClick={()=>c.setApparatus(!!i)}>{label}</button>)}</div>;
}
export function CameraQuantityLabel({quantity,label}:{quantity:string;label:string}){
  const c=useCameraPresentation(),content=<SceneQuantityLabel quantity={quantity} label={label} model="camera"/>;
  if(!c||!cameraAnnotationKeys(c.study).includes(quantity))return content;
  const visible=cameraAnnotationVisible(c.study,quantity,c.fieldMode);
  return <button type="button" className="os-quantity-toggle" aria-label={`查看${label.replace(/ [A-Za-z].*$/,'')}图示`} aria-controls={c.study!==0?'camera-study-diagram':'camera-ray-diagram'} aria-pressed={visible&&c.selected.has(quantity)} onClick={()=>c.toggle(quantity)}>{content}</button>;
}

export function CameraRayResults({result}:{result:SceneResult}){
  const p=result.input.parameters,o=cameraOptics(p),real=o.v!==null&&o.v>0,focused=real&&o.blur<1e-8;
  const row=(key:string,label:string,value:number|null,unit='')=><div key={key} style={{'--quantity-color':quantityColor(key,'camera')} as CSSProperties}><dt><CameraQuantityLabel quantity={key} label={label}/></dt><dd data-testid={key==='blurDiameter'?'camera-primary':`camera-metric-${key}`}><SceneValue value={value} unit={unit}/></dd></div>;
  return <section className="gs-readouts os-microscope-readouts os-camera-ray-results" aria-label="实时结果">
    <div className={`os-camera-focus-state ${focused?'is-focused':''}`} data-testid="camera-focus-status"><i/>{focused?'已几何对焦':real?'未几何对焦':'无有限实像'}<small>{focused?'最佳像面与感光面重合':real?'移动感光面，使光线交于同一点':'物体需移到镜头焦点之外'}</small></div>
    <dl>{row('v','最佳成像距离 v',real?o.v:null,'mm')}{row('sensor','感光面距离 s',p.sensor,'mm')}{row('blurDiameter','几何光斑直径 c',o.blur,'mm')}{row('fNumber','光圈数 N',o.fNumber)}{row('m','对焦面横向放大率 m',real?o.m:null,'倍')}</dl>
    <MicroscopeDetails id="camera-ray-explanation" title="简要说明"><p>感光面与最佳像面重合时对焦；偏离时形成光斑。放大率为负表示倒像。</p><p>绿色虚线标出最佳像面，感光面后的细虚线仅为光线延长示意。采用理想薄透镜模型。</p>{result.warnings.map(warning=><p className="os-warning" key={warning}>{warning}</p>)}</MicroscopeDetails>
  </section>;
}

export function CameraRayOptics({state,result,x,y,width,height}:{state:SceneState;result:SceneResult;x:(n:number)=>number;y:(n:number)=>number;width:number;height:number}){
  const c=useCameraPresentation(),p=state.parameters,o=cameraOptics(p),axis=y(0),left=x(0),right=x(p.sensor),apparatus=!!c?.apparatus;
  const lensHalf=Math.abs(y(result.devices?.[0]?.height??p.aperture/2)-axis),sensorHalf=Math.abs(y(p.sensorH/2)-axis),half=Math.max(lensHalf,sensorHalf)+25;
  const real=o.v!==null&&o.v>0,focused=real&&o.blur<1e-8,v=o.v??0,focusX=x(v),visibleFocus=real&&focusX>30&&focusX<width-35;
  const sensorCenter=-p.sensor*p.h/p.u,top=y(sensorCenter+o.blur/2),bottom=y(sensorCenter-o.blur/2);
  const clampX=(n:number)=>Math.max(35,Math.min(width-35,n));
  const selected=['u','f','sensor','v','h','aperture','sensorH','blurDiameter'].filter(key=>c?.selected.has(key));
  const horizontal=selected.filter(key=>['u','f','sensor','v'].includes(key));
  const firstLane=Math.min(height-55-Math.max(0,horizontal.length-1)*25,axis+half+62);
  return <g className="os-camera-ray-optics" pointerEvents="none">
    {apparatus&&<g data-testid="camera-housing"><title>相机展开剖面。外壳仅示意结构，不参与截光与成像计算。</title>
      <rect x={left+8} y={axis-half} width={Math.max(8,right-left+16)} height={2*half} rx={10} fill="#eef3f7" fillOpacity={.8} stroke="#aab8c7" strokeWidth={1.5}/>
      <path d={`M${left+14} ${axis-half+10}H${right+14} M${left+14} ${axis+half-10}H${right+14}`} stroke="#d0dbe4"/>
      <rect x={left-12} y={axis-lensHalf-14} width={24} height={2*lensHalf+28} rx={5} fill="#dce5ec" fillOpacity={.7} stroke="#91a6b9"/>
      <rect x={right+8} y={axis-18} width={8} height={36} rx={2} fill="#cad8e2"/>
    </g>}
    {apparatus?<path d={`M${left} ${axis-lensHalf}Q${left-16} ${axis} ${left} ${axis+lensHalf}Q${left+16} ${axis} ${left} ${axis-lensHalf}Z`} fill="#c5e2ed" fillOpacity={.8} stroke="#357fc6" strokeWidth={1.5}/>:<path d={`M${left} ${axis-lensHalf}V${axis+lensHalf} M${left-8} ${axis-lensHalf+9}L${left} ${axis-lensHalf}L${left+8} ${axis-lensHalf+9} M${left-8} ${axis+lensHalf-9}L${left} ${axis+lensHalf}L${left+8} ${axis+lensHalf-9}`} stroke="#357fc6" strokeWidth={2.5} fill="none"/>}
    <path d={`M${left} ${axis-lensHalf-6}V${y(p.aperture/2)} M${left} ${y(-p.aperture/2)}V${axis+lensHalf+6}`} stroke="#6b7b8c" strokeWidth={5}><title>光圈开口 a = {numberText(p.aperture)} mm</title></path>
    <line x1={right} x2={right} y1={axis-sensorHalf} y2={axis+sensorHalf} stroke="#62748a" strokeWidth={5} data-testid="camera-active-sensor"/>
    <text x={clampX(left-10)} y={Math.max(47,axis-half-16)} textAnchor="end" style={{fill:'#357fc6'}}>镜头 · 光圈</text>
    <text x={clampX(right+6)} y={Math.max(72,axis-half-16)} textAnchor="middle">感光面</text>
    {visibleFocus&&<g data-testid="camera-best-image-plane">
      {!focused&&<line x1={focusX} x2={focusX} y1={axis-half+8} y2={axis+half-8} stroke="#26836a" strokeDasharray="5 5" opacity={.65}/>}
      {!focused&&v>p.sensor&&result.segments.filter(s=>s.role==='transmitted').map((s,i)=><line key={i} x1={right} y1={y(s.end[1])} x2={focusX} y2={y(-v*p.h/p.u)} stroke="#26836a" opacity={.38} strokeDasharray="4 5"/>)}
      <circle cx={focusX} cy={y(-v*p.h/p.u)} r={3.5} fill="#26836a"/>
      <path d={`M${focusX} ${axis+half+2}V${axis+half+13}`} stroke="#26836a"/>
      <text x={Math.max(125,Math.min(width-125,focusX))} y={Math.min(height-40,axis+half+31)} textAnchor="middle" style={{fill:'#26836a'}}>{focused?'最佳像面与感光面重合':'最佳像面'}</text>
    </g>}
    {!visibleFocus&&<text x={width/2} y={45} textAnchor="middle" style={{fill:'#73879b'}}>{real?'最佳像面在画面外，可查看右侧像距':o.v===null?'物体位于焦点，出射光平行':'物体在焦距以内，镜头后无法形成实像'}</text>}
    <line x1={right} x2={right} y1={Math.max(axis-sensorHalf,top)} y2={Math.max(axis-sensorHalf,Math.min(axis+sensorHalf,bottom))} stroke="#26836a" strokeWidth={7} opacity={top>axis+sensorHalf||bottom<axis-sensorHalf?0:.75}/>
    {selected.map(key=>{
      if(key==='v'&&!real)return null;
      const vertical=['h','aperture','sensorH','blurDiameter'].includes(key),position=key==='h'?-p.u:key==='aperture'?0:p.sensor;
      const from=key==='u'?-p.u:key==='aperture'?-p.aperture/2:key==='sensorH'?-p.sensorH/2:key==='blurDiameter'?sensorCenter-o.blur/2:0;
      const to=key==='u'?0:key==='f'?p.f:key==='sensor'?p.sensor:key==='v'?v:key==='h'?p.h:key==='aperture'?p.aperture/2:key==='sensorH'?p.sensorH/2:sensorCenter+o.blur/2;
      const lane=firstLane+horizontal.indexOf(key)*25,cx=Math.min(width-55,clampX(x(position)+(key==='h'?-24:key==='aperture'?-30:key==='blurDiameter'?-22:26))),cy=(n:number)=>Math.max(40,Math.min(height-40,y(n)));
      const ax=vertical?cx:clampX(x(from)),bx=vertical?cx:clampX(x(to)),ay=vertical?cy(from):lane,by=vertical?cy(to):lane;
      const outside=vertical?cy(from)!==y(from)||cy(to)!==y(to):ax!==x(from)||bx!==x(to),color=quantityColor(key,'camera'),symbol:Record<string,string>={sensor:'s',aperture:'a',blurDiameter:'c',sensorH:'Hₛ'};
      return <g key={key} data-testid={`camera-quantity-${key}`}><title>{symbol[key]??key} = {numberText(Math.abs(to-from))} mm{outside?'；端点在图外':''}</title><path d={`M${ax} ${ay}L${bx} ${by} ${vertical?`M${ax-4} ${ay}H${ax+4} M${bx-4} ${by}H${bx+4}`:`M${ax} ${ay-4}V${ay+4} M${bx} ${by-4}V${by+4}`}`} fill="none" stroke={color} strokeWidth={1.4} strokeDasharray={outside?'4 3':undefined}/><text x={(ax+bx)/2+(vertical?12:0)} y={(ay+by)/2+(vertical?4:-8)} textAnchor={vertical?'start':'middle'} style={{fill:color}}>{symbol[key]??key}{outside?'（图外）':''}</text></g>;
    })}
  </g>;
}

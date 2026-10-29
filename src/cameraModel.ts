import { SCENE_DEFINITIONS, sceneKey, type SceneResult, type SceneState } from './sceneRuntime';

export const CAMERA_STUDIES=['成像光路','视场与取景','景深与清晰度','分辨率与像素'];
export function cameraOptics(p:Record<string,number>) {
  const q=1/p.f-1/p.sensor,den=1/p.f-1/p.u;
  const v=Math.abs(den)>1e-12?1/den:null,focus=q>1e-12?1/q:null;
  const blur=p.aperture*Math.abs(1-p.sensor*den),tolerance=p.coc/(p.aperture*p.sensor);
  const near=focus===null?null:1/(q+tolerance),far=focus===null||q-tolerance<=1e-12?null:1/(q-tolerance);
  const real=v!==null&&v>0,workingN=real?v/p.aperture:null;
  return {v,focus,near,far,blur:blur<1e-12?0:blur,m:v===null?null:-v/p.u,
    fieldWidth:p.sensorW*p.u/p.sensor,fieldHeight:p.sensorH*p.u/p.sensor,
    fNumber:p.f/p.aperture,workingN,airy:workingN===null?null:2.44*p.wavelength/1000*workingN,
    cutoff:workingN===null?null:1/(p.wavelength/1e6*workingN),nyquist:500/p.pixel,
    objectPixel:p.pixel*p.u/p.sensor,acceptable:blur<=p.coc+1e-10};
}
export function immediateCamera(state:SceneState):SceneResult {
  const p=state.parameters,o=cameraOptics(p),definition=SCENE_DEFINITIONS[state.sceneId];
  const ymax=Math.max(25,p.h*1.35,p.aperture*.9,p.sensorH*.8,Math.abs(-p.sensor*p.h/p.u)*1.3);
  const bounds:SceneResult['bounds']=[-p.u*1.15,Math.max(p.sensor*1.3,p.f*1.5),-ymax,ymax];
  const metric=(key:string,label:string,value:number|null,unit='',note='')=>({key,label,value,unit,note});
  const warnings:string[]=[];
  if(o.v===null||o.v<=0)warnings.push('当前物距不能在镜头后形成有限实像。');
  if(Math.max(p.h/p.u,p.aperture/(2*p.f),p.sensorH/(2*p.sensor))>.15)warnings.push('部分光线倾角较大，近轴模型仅供趋势参考。');
  const blurAt=(u:number)=>p.aperture*Math.abs(1-p.sensor*(1/p.f-1/u));
  let curve:SceneResult['curve']=Array.from({length:181},(_,i)=>{const s=10+i*290/180;return {x:s,y:p.aperture*Math.abs(1-s*(1/p.f-1/p.u))};});
  let chart={xLabel:'感光面距离 s / mm',yLabel:'几何光斑直径 c / mm',currentX:p.sensor,currentY:o.blur as number|null};
  if(p.study===1){curve=Array.from({length:181},(_,i)=>{const u=20+i*4980/180;return {x:u,y:o.blur<1e-8?(u>p.f?p.sensorW*(u/p.f-1):null):p.sensorW*u/p.sensor};});chart={xLabel:'物距 u / mm',yLabel:'物方取景宽度 W / mm',currentX:p.u,currentY:o.fieldWidth};}
  if(p.study===2){curve=Array.from({length:181},(_,i)=>{const u=20+i*4980/180;return {x:u,y:blurAt(u)};});chart={xLabel:'物距 u / mm',yLabel:'几何光斑直径 c / mm',currentX:p.u,currentY:o.blur};}
  if(p.study===3){curve=Array.from({length:181},(_,i)=>{const a=1+i*49/180;return {x:p.f/a,y:o.v!==null&&o.v>0?2.44*p.wavelength/1000*o.v/a:NaN};}).filter(point=>Number.isFinite(point.y)).sort((a,b)=>a.x-b.x);chart={xLabel:'光圈数 N',yLabel:'艾里斑直径 / μm',currentX:o.fNumber,currentY:o.airy};}
  return {revision:sceneKey(state),input:state,modelVersion:'scene-camera-1',model:'camera',scope:definition.scope,
    status:o.blur<1e-8&&o.v!==null&&o.v>0?'理想几何对焦':'感光面离焦',warnings,bounds,regions:[],
    segments:[-p.aperture/2,0,p.aperture/2].flatMap(y=>[{start:[-p.u,p.h] as [number,number],end:[0,y] as [number,number],role:'incident',dashed:false,power:1},{start:[0,y] as [number,number],end:[p.sensor,y+p.sensor*((y-p.h)/p.u-y/p.f)] as [number,number],role:'transmitted',dashed:false,power:1}]),
    markers:[{x:-p.u,y:p.h,label:'物体',role:'object'}],
    devices:[{kind:'lens',x:0,height:Math.max(p.aperture/2,ymax*.4),label:'镜头',sign:1},{kind:'screen',x:p.sensor,height:Math.max(p.sensorH/2,ymax*.4),label:'感光面',sign:1}],
    metrics:[metric('v','最佳成像距离 v',o.v,'mm'),metric('blurDiameter','几何光斑直径 c',o.blur,'mm'),metric('fNumber','光圈数 N',o.fNumber),metric('sensorHeight','像点中心',-p.sensor*p.h/p.u,'mm'),metric('m','对焦面横向放大率',o.m),metric('fieldWidth','物方取景宽度 W',o.fieldWidth,'mm'),metric('fieldHeight','物方取景高度 H',o.fieldHeight,'mm'),metric('focusDistance','当前对焦物距',o.focus,'mm'),metric('nearDepth','景深近界',o.near,'mm'),metric('farDepth','景深远界',o.far,'mm'),metric('depth','几何景深',o.near!==null&&o.far!==null?o.far-o.near:null,'mm'),metric('airyDiameter','对焦艾里斑直径',o.airy,'μm'),metric('diffractionCutoff','像方衍射截止频率',o.cutoff,'lp/mm'),metric('nyquist','像素采样上限',o.nyquist,'lp/mm'),metric('objectPixel','物方单像素尺寸',o.objectPixel,'μm')],curve,chart,imagePreview:null};
}

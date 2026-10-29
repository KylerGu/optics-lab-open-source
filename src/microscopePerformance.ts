import { sceneKey, type SceneState, type SceneResult } from './sceneRuntime';
import {microscopeFocusDistance} from './microscopeFocus';

export const MICROSCOPE_STUDIES=['成像光路','分辨率','视场','景深'] as const;
// study 1 = resolution, 2 = field, 3 = depth. Wavelength is converted nm -> µm.
export function microscopePerformance(state:SceneState) {
  const p=state.parameters,lambda=p.wavelength/1000;
  const resolution=.61*lambda/p.NA;
  const diffraction=p.medium*lambda/(p.NA*p.NA);
  const magnification=p.tubeF/p.f1*p.adapter;
  const geometric=p.mode===1&&p.depthCriterion===1?p.medium*p.pixel/(magnification*p.NA):0;
  return {resolution,diffraction,geometric,depth:diffraction+geometric,magnification};
}

export function immediateMicroscopePerformance(state:SceneState):SceneResult {
  const p=state.parameters,a=microscopePerformance(state),depth=p.study===3;
  const metric=(key:string,label:string,value:number|null,unit='µm')=>({key,label,value,unit,note:''});
  const metrics=depth?[metric('depth','景深估计',a.depth),metric('halfDepth','焦平面上下范围',a.depth/2),metric('diffractionDepth','衍射项',a.diffraction),metric('geometricDepth','采样项',a.geometric)]:[metric('resolution','横向分辨率',a.resolution),metric('separation','两点间距',p.separation)];
  if(depth)metrics.push(metric('defocus','样品离焦量 z',microscopeFocusDistance(p)===null?null:p.defocus));
  const max=Math.min(p.medium,1.4);
  return {revision:sceneKey(state),input:state,modelVersion:'microscope-performance-1',model:'microscope',scope:depth?'物方景深估计；非相干成像，按所选清晰度判据':'瑞利判据；等强、非相干点源，理想圆孔径',status:'',warnings:[],metrics,
    bounds:[-1,1,-1,1],segments:[],markers:[],regions:[],devices:[],
    curve:Array.from({length:101},(_,i)=>{const na=.1+(max-.1)*i/100;return {x:na,y:depth?p.medium*(p.wavelength/1000)/(na*na)+(p.mode===1&&p.depthCriterion===1?p.medium*p.pixel/(a.magnification*na):0):.61*(p.wavelength/1000)/na};}),
    chart:{xLabel:'数值孔径 NA',yLabel:depth?'景深 DOF / µm':'分辨率 rₓᵧ / µm',currentX:p.NA,currentY:depth?a.depth:a.resolution}};
}

// J0 via its angular integral, then a uniform circular pupil's radial integral.
// Defocus is an optical phase, not a cosmetic blur filter. Intensities of two
// mutually incoherent points add. Normalization is fixed to the in-focus peak.
function j0(x:number) {
  let sum=0;
  const angles=Math.max(64,Math.ceil(Math.abs(x)*2));
  for(let i=0;i<angles;i++)sum+=Math.cos(x*Math.cos(Math.PI*(i+.5)/angles));
  return sum/angles;
}
export function pointSpread(radius:number,z:number,na:number,lambdaUm:number,n:number) {
  const v=2*Math.PI*na*radius/lambdaUm,w=Math.PI*na*na*z/(n*lambdaUm);
  let re=0,im=0;
  const steps=Math.max(80,Math.ceil(Math.abs(w)*2));
  for(let i=0;i<steps;i++){const t=(i+.5)/steps,b=j0(v*Math.sqrt(t)),phase=w*t;re+=b*Math.cos(phase)/steps;im+=b*Math.sin(phase)/steps;}
  return re*re+im*im;
}
const pupilKernels=new Map<string,Float64Array>();
export function radialPointSpread(z:number,na:number,lambda:number,n:number,extent:number) {
  const phase=Math.PI*na*na*z/(n*lambda);
  const steps=2**Math.ceil(Math.log2(Math.max(80,Math.abs(phase)*2)));
  const v=2*Math.PI*na*extent/lambda,key=`${v.toFixed(10)}:${steps}`;
  let kernel=pupilKernels.get(key);
  if(!kernel){
    kernel=new Float64Array(241*steps);
    for(let r=0;r<=240;r++)for(let i=0;i<steps;i++)kernel[r*steps+i]=j0(v*r/240*Math.sqrt((i+.5)/steps));
    if(pupilKernels.size>=4)pupilKernels.delete(pupilKernels.keys().next().value!);
    pupilKernels.set(key,kernel);
  }
  const cos=Array.from({length:steps},(_,i)=>Math.cos(phase*(i+.5)/steps)/steps),sin=Array.from({length:steps},(_,i)=>Math.sin(phase*(i+.5)/steps)/steps);
  return Array.from({length:241},(_,r)=>{let re=0,im=0;for(let i=0;i<steps;i++){const b=kernel[r*steps+i];re+=b*cos[i];im+=b*sin[i];}return re*re+im*im;});
}
export function radialIntensity(table:number[],radius:number,extent:number) {
  const f=radius/extent*(table.length-1),i=Math.floor(f);
  return i>=table.length-1?0:table[i]+(table[i+1]-table[i])*(f-i);
}

export function microscopeFieldResult(result:SceneResult):SceneResult {
  const p=result.input.parameters,m=Math.abs(result.metrics.find(m=>m.key==='objectiveM')?.value??NaN),value=result.metrics.find(m=>m.key==='fieldDiameter')?.value??null;
  return {...result,curve:Array.from({length:101},(_,i)=>({x:8+i*22/100,y:value===null?null:(8+i*22/100)/m})),chart:{xLabel:'目镜视场数 / mm',yLabel:'目视视野直径 D / mm',currentX:p.fieldNumber,currentY:value}};
}

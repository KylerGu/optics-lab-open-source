import { defaultScene, parseScene, SCENE_DEFINITIONS, type SceneState } from './sceneRuntime';
import { makeSpatialElement, parseSpatial, type SpatialExperiment } from './builderModel';

export const CIRCULAR_ID = 'diffraction-1';
export const AIRY_ZERO = 3.8317059702075125;
export const AIRY_FACTOR = AIRY_ZERO / Math.PI;
export interface CircularParameters { wavelengthNm:number; apertureDiameterMm:number; focalLengthMm:number; observationRadiusUm:number }
export const DEFAULT_CIRCULAR = defaultScene(CIRCULAR_ID).parameters as unknown as CircularParameters;
export const CIRCULAR_DRAFT_KEY = 'optics-scene-draft-v1-' + CIRCULAR_ID;
const symbols={wavelengthNm:'λ',apertureDiameterMm:'D',focalLengthMm:'f',observationRadiusUm:'r'};
const tones={wavelengthNm:'wavelength',apertureDiameterMm:'distance',focalLengthMm:'angle',observationRadiusUm:'screen'};
export const CIRCULAR_FIELDS=SCENE_DEFINITIONS[CIRCULAR_ID].parameters.map(f=>({...f,key:f.key as keyof CircularParameters,symbol:symbols[f.key as keyof CircularParameters],tone:tones[f.key as keyof CircularParameters]}));
export const circularState=(p:CircularParameters):SceneState=>({version:1,sceneId:CIRCULAR_ID,parameters:{...p}});
export const parseCircular=(p:unknown)=>parseScene({version:1,sceneId:CIRCULAR_ID,parameters:p},CIRCULAR_ID).parameters as unknown as CircularParameters;

// DLMF 10.9.2: the angular integral of J1, with its cancelling odd part removed.
// Power-of-two midpoint sampling resolves even the largest allowed argument.
const kernels=new Map<number,Float64Array>();
export function besselJ1(x:number):number {
  if(Math.abs(x)<1e-4)return x/2-x*x*x/16+x**5/384;
  const n=2**Math.ceil(Math.log2(Math.max(64,2*Math.abs(x)+32)));
  let kernel=kernels.get(n);
  if(!kernel){kernel=Float64Array.from({length:n},(_,i)=>Math.sin(Math.PI*(i+.5)/n));kernels.set(n,kernel);}
  let sum=0;for(const s of kernel)sum+=Math.sin(x*s)*s;
  return sum/n;
}
export function circularDiffraction(p:CircularParameters) {
  const lambda=p.wavelengthNm*1e-6,D=p.apertureDiameterMm,f=p.focalLengthMm;
  const at=(rUm:number)=>{
    const u=Math.PI*D*(rUm*.001)/(lambda*f);
    const raw=Math.abs(u)<1e-8?1:(2*besselJ1(u)/u)**2;
    return {intensity:raw<1e-14?0:Math.min(1,raw),thetaDeg:Math.atan2(rUm*.001,f)*180/Math.PI,u};
  };
  const firstDarkRadiusUm=AIRY_FACTOR*lambda*f/D*1000,observation=at(p.observationRadiusUm);
  return {at,observation,firstDarkRadiusUm,airyDiameterUm:2*firstDarkRadiusUm,firstDarkAngleMrad:firstDarkRadiusUm/f,
    status:p.observationRadiusUm===0?'中央最亮':observation.intensity===0?'暗环':p.observationRadiusUm<firstDarkRadiusUm?'中央亮斑内':'旁侧圆环'};
}
export interface CircularHistory {past:CircularParameters[];present:CircularParameters;future:CircularParameters[]}
export function circularHistory(h:CircularHistory,a:{type:'commit';parameters:CircularParameters}|{type:'undo'|'redo'}):CircularHistory {
  if(a.type==='commit'){const next=parseCircular(a.parameters);if(CIRCULAR_FIELDS.every(f=>next[f.key]===h.present[f.key]))return h;return {past:[...h.past,h.present].slice(-80),present:next,future:[]};}
  if(a.type==='undo'&&h.past.length)return {past:h.past.slice(0,-1),present:h.past.at(-1)!,future:[h.present,...h.future]};
  if(a.type==='redo'&&h.future.length)return {past:[...h.past,h.present],present:h.future[0],future:h.future.slice(1)};
  return h;
}
export function circularBuilderCopy(p:CircularParameters):SpatialExperiment {
  parseCircular(p);
  return parseSpatial({schemaVersion:2,name:'圆孔衍射 · 焦平面装置',elements:[
    makeSpatialElement('laser',[20,60,0],{id:'circular-source',name:'均匀平行光源',wavelengthNm:p.wavelengthNm,beamModel:'parallel',beamRadiusMm:6,divergenceMrad:0,rayCount:201}),
    makeSpatialElement('aperture',[100,60,0],{id:'circular-aperture',name:'圆孔',diameterMm:p.apertureDiameterMm}),
    makeSpatialElement('lens',[120,60,0],{id:'circular-lens',name:'观察透镜',focalLengthMm:p.focalLengthMm,diameterMm:40}),
    makeSpatialElement('screen',[120+p.focalLengthMm,60,0],{id:'circular-screen',name:'焦平面观察屏',diameterMm:40}),
  ]});
}

import { defaultScene, parseScene, SCENE_DEFINITIONS, type SceneState } from './sceneRuntime';
import { fourierLens } from './fourierLens';
import { makeSpatialElement, parseSpatial, type SpatialExperiment } from './builderModel';

export const FOUR_F_ID='spatial-spectrum-1';
export interface FourFParameters {wavelengthNm:number;periodMm:number;waistMm:number;modulation:number;focalLengthMm:number;filterWidthUm:number;filterOffsetUm:number;filterMode:number;observationMm:number}
export const DEFAULT_FOUR_F=defaultScene(FOUR_F_ID).parameters as unknown as FourFParameters;
export const FOUR_F_DRAFT_KEY='optics-scene-draft-v1-'+FOUR_F_ID;
const symbols:Record<string,string>={wavelengthNm:'λ',periodMm:'d',waistMm:'w',modulation:'m',focalLengthMm:'f',filterWidthUm:'a',filterOffsetUm:'c',filterMode:'H',observationMm:'x′'};
const tones:Record<string,string>={wavelengthNm:'wavelength',periodMm:'distance',waistMm:'waist',modulation:'distance',focalLengthMm:'angle',filterWidthUm:'waist',filterOffsetUm:'screen',filterMode:'distance',observationMm:'screen'};
export const FOUR_F_FIELDS=SCENE_DEFINITIONS[FOUR_F_ID].parameters.map(f=>({...f,key:f.key as keyof FourFParameters,symbol:symbols[f.key],tone:tones[f.key]}));
export const fourFState=(p:FourFParameters):SceneState=>({version:1,sceneId:FOUR_F_ID,parameters:{...p}});
export const parseFourF=(p:unknown)=>parseScene({version:1,sceneId:FOUR_F_ID,parameters:p},FOUR_F_ID).parameters as unknown as FourFParameters;

// Gaussian components are integrated separately so a wide mask cannot skip narrow peaks.
export function fourF(p:FourFParameters) {
  const scale=p.wavelengthNm*1e-6*p.focalLengthMm,alpha=Math.PI*p.waistMm;
  const components:[number,number][]=[[0,1],[1/p.periodMm,p.modulation/2],[-1/p.periodMm,p.modulation/2]];
  const lo=(p.filterOffsetUm-p.filterWidthUm/2)*.001/scale,hi=(p.filterOffsetUm+p.filterWidthUm/2)*.001/scale;
  const nodes:{frequency:number;weight:number}[]=[];
  if(p.filterMode!==2)for(const [center,weight] of components){
    if(!weight)continue;
    const left=Math.max(-8,alpha*(lo-center)),right=Math.min(8,alpha*(hi-center));
    if(right<=left)continue;
    const n=384,step=(right-left)/n;
    for(let i=0;i<=n;i++){const t=left+i*step;nodes.push({frequency:center+t/alpha,weight:weight/(Math.sqrt(Math.PI)*(1+p.modulation))*Math.exp(-t*t)*step/3*(i===0||i===n?1:i%2?4:2)});}
  }
  const input=(x:number,y=0)=>Math.exp(-(x*x+y*y)/(p.waistMm*p.waistMm))*(1+p.modulation*Math.cos(2*Math.PI*x/p.periodMm))/(1+p.modulation);
  const amplitude=(x:number):[number,number]=>{
    if(p.filterMode===2)return [input(-x),0];
    let real=0,imaginary=0;
    for(const q of nodes){const phase=-2*Math.PI*q.frequency*x;real+=q.weight*Math.cos(phase);imaginary+=q.weight*Math.sin(phase);}
    return p.filterMode===0?[real,imaginary]:[input(-x)-real,-imaginary];
  };
  const at=(x:number,y=0)=>{const [r,i]=amplitude(x),value=(r*r+i*i)*Math.exp(-2*(y/p.waistMm)**2);return value<1e-15?0:value;};
  const spectrum=fourierLens({...p,observationUm:0});
  const mask=(xUm:number)=>p.filterMode===2?1:((Math.abs(xUm-p.filterOffsetUm)<=p.filterWidthUm/2)===(p.filterMode===0)?1:0);
  // Integral of |A|²: pairwise products of Gaussian components, including cross terms.
  const powerInterval=(left:number,right:number)=>{
    let sum=0;
    for(const [u,a] of components)for(const [v,b] of components){
      if(!a||!b)continue;
      const center=(u+v)/2,L=Math.max(-8,Math.SQRT2*alpha*(left-center)),R=Math.min(8,Math.SQRT2*alpha*(right-center));
      if(R<=L)continue;
      const n=384,h=(R-L)/n;let integral=0;
      for(let k=0;k<=n;k++){const t=L+k*h;integral+=(k===0||k===n?1:k%2?4:2)*Math.exp(-t*t);}
      sum+=a*b*Math.exp(-alpha*alpha*(u-v)**2/2)*integral*h/3;
    }
    return sum;
  };
  const passed=powerInterval(lo,hi)/powerInterval(-Infinity,Infinity);
  const transmission=p.filterMode===2?1:Math.max(0,Math.min(1,p.filterMode===0?passed:1-passed));
  return {input,amplitude,at,mask,spectrum,transmission,cutoffFrequency:p.filterWidthUm*.001/(2*scale),orderPositionUm:spectrum.orderPositionUm,observation:at(p.observationMm)};
}
export interface FourFHistory {past:FourFParameters[];present:FourFParameters;future:FourFParameters[]}
export function fourFHistory(h:FourFHistory,a:{type:'commit';parameters:FourFParameters}|{type:'undo'|'redo'}):FourFHistory {
  if(a.type==='commit'){const next=parseFourF(a.parameters);if(FOUR_F_FIELDS.every(f=>next[f.key]===h.present[f.key]))return h;return {past:[...h.past,h.present].slice(-80),present:next,future:[]};}
  if(a.type==='undo'&&h.past.length)return {past:h.past.slice(0,-1),present:h.past.at(-1)!,future:[h.present,...h.future]};
  if(a.type==='redo'&&h.future.length)return {past:[...h.past,h.present],present:h.future[0],future:h.future.slice(1)};
  return h;
}
export function fourFTarget(p:FourFParameters,target:string):Partial<FourFParameters>{
  if(target==='all_pass')return {filterMode:2};
  if(target==='low_pass'||target==='high_pass')return {filterMode:target==='low_pass'?0:1,filterWidthUm:Math.max(10,Math.min(5000,fourF(p).orderPositionUm*.6)),filterOffsetUm:0};
  if(target==='positive_order'){
    if(!p.modulation)throw new Error('无条纹时没有一级频谱。');
    return {filterMode:0,filterOffsetUm:fourF(p).orderPositionUm,filterWidthUm:Math.max(10,fourF(p).orderPositionUm*.6)};
  }
  throw new Error('未知的滤波目标。');
}
export function fourFBuilderCopy(p:FourFParameters):SpatialExperiment{
  parseFourF(p);
  const f=p.focalLengthMm;
  return parseSpatial({schemaVersion:2,name:'4f 空间滤波',elements:[
    makeSpatialElement('laser',[10,60,0],{id:'4f-input',name:'高斯光源',beamModel:'gaussian',beamRadiusMm:p.waistMm,wavelengthNm:p.wavelengthNm,waistOffsetMm:30,rayCount:101}),
    makeSpatialElement('amplitude-grating',[40,60,0],{id:'4f-grating',name:'余弦振幅条纹',gratingProfile:'sinusoidal',gratingModulation:p.modulation,gratingPeriodUm:p.periodMm*1000,gratingWidthMm:12*p.waistMm,gratingHeightMm:12*p.waistMm}),
    makeSpatialElement('lens',[40+f,60,0],{id:'4f-lens1',name:'第一透镜',focalLengthMm:f,diameterMm:60}),
    ...(p.filterMode===2?[]:[makeSpatialElement('slit',[40+2*f,60,p.filterOffsetUm*.001],{id:'4f-mask',name:p.filterMode===0?'通光狭缝':'遮光挡片',slitMode:p.filterMode===0?'pass':'stop',slitWidthMm:p.filterWidthUm*.001,slitHeightMm:30})]),
    makeSpatialElement('lens',[40+3*f,60,0],{id:'4f-lens2',name:'第二透镜',focalLengthMm:f,diameterMm:60}),
    makeSpatialElement('screen',[40+4*f,60,0],{id:'4f-screen',name:'输出屏',diameterMm:40,probeOffsetMm:p.observationMm})]});
}

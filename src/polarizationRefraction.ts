import { defaultScene, parseScene, SCENE_DEFINITIONS, type SceneState } from './sceneRuntime';
export const POLARIZATION_REFRACTION_ID='polarization-2';
export interface PolarizationRefractionParameters {mode:number;n1:number;n2:number;angleDeg:number;polarization:number;ordinaryIndex:number;extraordinaryIndex:number;axisAngleDeg:number;thicknessMm:number}
export const DEFAULT_POLARIZATION_REFRACTION=defaultScene(POLARIZATION_REFRACTION_ID).parameters as unknown as PolarizationRefractionParameters;
const SYMBOLS:Record<string,string>={n1:'n₁',n2:'n₂',angleDeg:'θ',ordinaryIndex:'nₒ',extraordinaryIndex:'nₑ',axisAngleDeg:'γ',thicknessMm:'L',mode:'',polarization:''};
export const POLARIZATION_REFRACTION_FIELDS=SCENE_DEFINITIONS[POLARIZATION_REFRACTION_ID].parameters.map(f=>({...f,key:f.key as keyof PolarizationRefractionParameters,symbol:SYMBOLS[f.key]}));
export const polarizationRefractionState=(p:PolarizationRefractionParameters):SceneState=>({version:1,sceneId:POLARIZATION_REFRACTION_ID,parameters:{...p}});
export const parsePolarizationRefraction=(p:unknown)=>parseScene({version:1,sceneId:POLARIZATION_REFRACTION_ID,parameters:p},POLARIZATION_REFRACTION_ID).parameters as unknown as PolarizationRefractionParameters;
const tidy=(n:number)=>Math.abs(n)<1e-12?0:Math.abs(n-1)<1e-12?1:n;
export function fresnel(n1:number,n2:number,angleDeg:number){
  const i=angleDeg*Math.PI/180,s=n1/n2*Math.sin(i),equal=Math.abs(n1-n2)<1e-12;
  if(equal)return {rs:0,rp:0,transmissionDeg:angleDeg,tir:false,critical:false};
  if(s>=1-1e-12)return {rs:1,rp:1,transmissionDeg:s<=1+1e-12?90:null,tir:s>1+1e-12,critical:s<=1+1e-12};
  const ct=Math.sqrt(1-s*s),ci=Math.cos(i);
  return {rs:tidy(((n1*ci-n2*ct)/(n1*ci+n2*ct))**2),rp:tidy(((n2*ci-n1*ct)/(n2*ci+n1*ct))**2),transmissionDeg:Math.asin(s)*180/Math.PI,tir:false,critical:false};
}
export function brewster(p:PolarizationRefractionParameters){
  const f=fresnel(p.n1,p.n2,p.angleDeg),equal=Math.abs(p.n1-p.n2)<1e-12;
  const brewsterDeg=equal?null:Math.atan(p.n2/p.n1)*180/Math.PI,criticalDeg=p.n1>p.n2?Math.asin(p.n2/p.n1)*180/Math.PI:null;
  const r=p.polarization===1?f.rs:p.polarization===2?f.rp:(f.rs+f.rp)/2;
  const atBrewster=brewsterDeg!==null&&Math.abs(p.angleDeg-brewsterDeg)<1e-6;
  return {...f,brewsterDeg,criticalDeg,rsPct:100*f.rs,rpPct:100*f.rp,reflectancePct:100*r,transmissionPct:100*(1-r),atBrewster,
    status:equal?'无折射率差':f.tir?'全反射':f.critical?'临界掠射':atBrewster?'p 光不反射':'反射与折射'};
}
export function birefringence(p:PolarizationRefractionParameters){
  const a=p.axisAngleDeg*Math.PI/180,c=Math.cos(a),s=Math.sin(a),no2=p.ordinaryIndex**2,ne2=p.extraordinaryIndex**2;
  const tangent=tidy((ne2-no2)*s*c/(ne2*c*c+no2*s*s)),walkoffDeg=Math.atan(tangent)*180/Math.PI;
  return {effectiveIndex:1/Math.sqrt(c*c/no2+s*s/ne2),tangent,walkoffDeg,signedSeparationMm:p.thicknessMm*tangent,separationMm:Math.abs(p.thicknessMm*tangent),
    status:Math.abs(p.ordinaryIndex-p.extraordinaryIndex)<1e-12?'无双折射':tangent===0?'两束同轴':'两束分开'};
}
export function polarizationRefraction(p:PolarizationRefractionParameters){
  const b=brewster(p),c=birefringence(p);return {...b,...c,status:p.mode===0?b.status:c.status};
}
export function polarizationAngleFromPoint(x:number,y:number,cx:number,cy:number,mode:number){
  const angle=mode===0?Math.atan2(cx-x,cy-y)*180/Math.PI:Math.atan2(cy-y,x-cx)*180/Math.PI;
  return Math.round(Math.max(0,Math.min(mode===0?89.9:90,angle))*10)/10;
}
export interface PolarizationRefractionHistory {past:PolarizationRefractionParameters[];present:PolarizationRefractionParameters;future:PolarizationRefractionParameters[]}
export function polarizationRefractionHistory(h:PolarizationRefractionHistory,a:{type:'commit';parameters:PolarizationRefractionParameters}|{type:'undo'|'redo'}):PolarizationRefractionHistory{
  if(a.type==='commit'){const next=parsePolarizationRefraction(a.parameters);if(POLARIZATION_REFRACTION_FIELDS.every(f=>next[f.key]===h.present[f.key]))return h;return {past:[...h.past,h.present].slice(-80),present:next,future:[]};}
  if(a.type==='undo'&&h.past.length)return {past:h.past.slice(0,-1),present:h.past.at(-1)!,future:[h.present,...h.future]};
  if(a.type==='redo'&&h.future.length)return {past:[...h.past,h.present],present:h.future[0],future:h.future.slice(1)};return h;
}

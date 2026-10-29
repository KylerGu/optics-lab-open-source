import { defaultScene, parseScene, SCENE_DEFINITIONS, type SceneState } from './sceneRuntime';
import { makeSpatialElement, parseSpatial, type SpatialExperiment } from './builderModel';

export const WAVEPLATE_ID='polarization-1';
export interface WaveplateParameters {powerMw:number;inputAngleDeg:number;axisAngleDeg:number;plateType:number}
export const DEFAULT_WAVEPLATE=defaultScene(WAVEPLATE_ID).parameters as unknown as WaveplateParameters;
const SYMBOLS={powerMw:'Pᵢₙ',inputAngleDeg:'α',axisAngleDeg:'β',plateType:''};
export const WAVEPLATE_FIELDS=SCENE_DEFINITIONS[WAVEPLATE_ID].parameters.map(f=>({...f,key:f.key as keyof WaveplateParameters,symbol:SYMBOLS[f.key as keyof WaveplateParameters]}));
export const waveplateState=(p:WaveplateParameters):SceneState=>({version:1,sceneId:WAVEPLATE_ID,parameters:{...p}});
export const parseWaveplate=(p:unknown)=>parseScene({version:1,sceneId:WAVEPLATE_ID,parameters:p},WAVEPLATE_ID).parameters as unknown as WaveplateParameters;
const tidy=(n:number)=>Math.abs(n)<1e-12?0:Math.abs(n-1)<1e-12?1:Math.abs(n+1)<1e-12?-1:n;
export function waveplate(p:WaveplateParameters){
  const rad=Math.PI/180,a=p.inputAngleDeg*rad,b=p.axisAngleDeg*rad;
  const phaseDeg=p.plateType===0?90:180,delta=phaseDeg*rad;
  const fast=Math.cos(a-b),slow=Math.sin(a-b),cd=tidy(Math.cos(delta)),sd=tidy(Math.sin(delta));
  // Eout = f cos(alpha-beta) + s sin(alpha-beta) exp(i delta).
  // Time convention exp(-i omega t); detector convention S3=2 Im(Ex conj(Ey)).
  const ex={re:tidy(fast*Math.cos(b)-slow*cd*Math.sin(b)),im:tidy(-slow*sd*Math.sin(b))};
  const ey={re:tidy(fast*Math.sin(b)+slow*cd*Math.cos(b)),im:tidy(slow*sd*Math.cos(b))};
  const s1=tidy(ex.re**2+ex.im**2-ey.re**2-ey.im**2),s2=tidy(2*(ex.re*ey.re+ex.im*ey.im)),s3=tidy(2*(ex.im*ey.re-ex.re*ey.im));
  const linear=Math.min(1,Math.hypot(s1,s2));
  // For a pure state, |S3|/(1+sqrt(S1²+S2²)) equals b/a and stays stable near a line.
  const axisRatio=tidy(Math.abs(s3)/(1+linear));
  const rawAngle=((Math.atan2(s2,s1)/rad/2)%180+180)%180;
  const majorAngleDeg=linear<1e-10?null:Math.abs(rawAngle-180)<1e-10?0:tidy(rawAngle);
  const polarization=p.powerMw===0?'光源关闭':axisRatio<1e-10?'线偏振':1-axisRatio<1e-10?'圆偏振':'椭圆偏振';
  const rotation=p.powerMw===0?'—':s3===0?'往复':s3>0?'顺时针':'逆时针';
  return {ex,ey,phaseDeg,outputPowerMw:p.powerMw,majorAngleDeg:p.powerMw===0?null:majorAngleDeg,axisRatio:p.powerMw===0?null:axisRatio,
    s1:p.powerMw===0?null:s1,s2:p.powerMw===0?null:s2,s3:p.powerMw===0?null:s3,polarization,rotation};
}
export function fieldPoint(b:ReturnType<typeof waveplate>,phase:number){
  return {x:b.ex.re*Math.cos(phase)+b.ex.im*Math.sin(phase),y:b.ey.re*Math.cos(phase)+b.ey.im*Math.sin(phase)};
}
export function waveplateBuilderCopy(p:WaveplateParameters):SpatialExperiment{
  return parseSpatial({schemaVersion:2,name:'波片与偏振态 · 器件副本',elements:[
    makeSpatialElement('laser',[-180,60,0],{name:'线偏振光源',powerMw:p.powerMw,polarization:'linear',polarizationDeg:p.inputAngleDeg,beamModel:'parallel',beamRadiusMm:4,rayCount:9,wavelengthNm:532}),
    makeSpatialElement(p.plateType===0?'quarter-wave-plate':'half-wave-plate',[0,60,0],{name:p.plateType===0?'四分之一波片':'半波片',rollDeg:p.axisAngleDeg,transmission:1,diameterMm:40,designWavelengthNm:532}),
    makeSpatialElement('power-meter',[180,60,0],{name:'输出功率计',diameterMm:60,meterRangeMw:100}),
  ]});
}
export interface WaveplateHistory {past:WaveplateParameters[];present:WaveplateParameters;future:WaveplateParameters[]}
export function waveplateHistory(h:WaveplateHistory,a:{type:'commit';parameters:WaveplateParameters}|{type:'undo'|'redo'}):WaveplateHistory{
  if(a.type==='commit'){const next=parseWaveplate(a.parameters);if(WAVEPLATE_FIELDS.every(f=>next[f.key]===h.present[f.key]))return h;return {past:[...h.past,h.present].slice(-80),present:next,future:[]};}
  if(a.type==='undo'&&h.past.length)return {past:h.past.slice(0,-1),present:h.past.at(-1)!,future:[h.present,...h.future]};
  if(a.type==='redo'&&h.future.length)return {past:[...h.past,h.present],present:h.future[0],future:h.future.slice(1)};
  return h;
}

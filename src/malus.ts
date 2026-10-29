import { defaultScene, parseScene, SCENE_DEFINITIONS, type SceneState } from './sceneRuntime';
import { makeSpatialElement, parseSpatial, type SpatialExperiment } from './builderModel';

export const MALUS_ID='polarization-0';
export interface MalusParameters {powerMw:number;inputAngleDeg:number;axisAngleDeg:number}
export const DEFAULT_MALUS=defaultScene(MALUS_ID).parameters as unknown as MalusParameters;
const SYMBOLS={powerMw:'Pᵢₙ',inputAngleDeg:'α',axisAngleDeg:'β'};
export const MALUS_FIELDS=SCENE_DEFINITIONS[MALUS_ID].parameters.map(f=>({...f,key:f.key as keyof MalusParameters,symbol:SYMBOLS[f.key as keyof MalusParameters]}));
export const malusState=(p:MalusParameters):SceneState=>({version:1,sceneId:MALUS_ID,parameters:{...p}});
export const parseMalus=(p:unknown)=>parseScene({version:1,sceneId:MALUS_ID,parameters:p},MALUS_ID).parameters as unknown as MalusParameters;
export function malus(p:MalusParameters) {
  const signedAngleDeg=((p.axisAngleDeg-p.inputAngleDeg+90)%180+180)%180-90;
  const relativeAngleDeg=Math.abs(signedAngleDeg);
  const fraction=relativeAngleDeg===90?0:Math.cos(relativeAngleDeg*Math.PI/180)**2;
  return {signedAngleDeg,relativeAngleDeg,fraction,transmissionPct:100*fraction,outputPowerMw:p.powerMw*fraction};
}
export function malusBuilderCopy(p:MalusParameters):SpatialExperiment {
  return parseSpatial({schemaVersion:2,name:'偏振片与马吕斯定律 · 器件副本',elements:[
    makeSpatialElement('laser',[-180,60,0],{name:'线偏振光源',powerMw:p.powerMw,polarization:'linear',polarizationDeg:p.inputAngleDeg,beamModel:'parallel',beamRadiusMm:4,rayCount:9,wavelengthNm:532}),
    makeSpatialElement('polarizer',[0,60,0],{name:'偏振片',rollDeg:p.axisAngleDeg,transmission:1,diameterMm:40}),
    makeSpatialElement('power-meter',[180,60,0],{name:'透射功率计',diameterMm:60,meterRangeMw:100}),
  ]});
}
export interface MalusHistory {past:MalusParameters[];present:MalusParameters;future:MalusParameters[]}
export function malusHistory(h:MalusHistory,a:{type:'commit';parameters:MalusParameters}|{type:'undo'|'redo'}):MalusHistory {
  if(a.type==='commit'){const next=parseMalus(a.parameters);if(MALUS_FIELDS.every(f=>next[f.key]===h.present[f.key]))return h;return {past:[...h.past,h.present].slice(-80),present:next,future:[]};}
  if(a.type==='undo'&&h.past.length)return {past:h.past.slice(0,-1),present:h.past.at(-1)!,future:[h.present,...h.future]};
  if(a.type==='redo'&&h.future.length)return {past:[...h.past,h.present],present:h.future[0],future:h.future.slice(1)};
  return h;
}

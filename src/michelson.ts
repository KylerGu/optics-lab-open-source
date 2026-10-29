import { defaultScene, parseScene, SCENE_DEFINITIONS, type SceneState } from './sceneRuntime';
export const MICHELSON_SCENE_ID = 'interference-2';
export interface MichelsonParameters { wavelengthNm:number; baseDifferenceUm:number; mirrorMoveUm:number; mirror1MoveUm:number; sourceDistanceMm:number; lensDistanceMm:number; focalLengthMm:number; observationRadiusMm:number }
export const DEFAULT_MICHELSON = defaultScene(MICHELSON_SCENE_ID).parameters as unknown as MichelsonParameters;
export const MICHELSON_DRAFT_KEY = 'optics-scene-draft-v1-' + MICHELSON_SCENE_ID;
const symbols = {wavelengthNm:'λ',baseDifferenceUm:'ΔL₀',mirrorMoveUm:'s₂',mirror1MoveUm:'s₁',sourceDistanceMm:'',lensDistanceMm:'',focalLengthMm:'f',observationRadiusMm:'r'};
const tones = {wavelengthNm:'wavelength',baseDifferenceUm:'distance',mirrorMoveUm:'angle',mirror1MoveUm:'distance',sourceDistanceMm:'distance',lensDistanceMm:'distance',focalLengthMm:'distance',observationRadiusMm:'screen'};
export const MICHELSON_FIELDS = SCENE_DEFINITIONS[MICHELSON_SCENE_ID].parameters.map(f=>({...f,key:f.key as keyof MichelsonParameters,symbol:symbols[f.key as keyof MichelsonParameters],tone:tones[f.key as keyof MichelsonParameters]}));
export function michelsonState(p:MichelsonParameters):SceneState { return {version:1,sceneId:MICHELSON_SCENE_ID,parameters:{...p}}; }
export function parseMichelson(p:unknown):MichelsonParameters { return parseScene({version:1,sceneId:MICHELSON_SCENE_ID,parameters:p},MICHELSON_SCENE_ID).parameters as unknown as MichelsonParameters; }
export function michelson(p:MichelsonParameters) {
  const netMoveUm=p.mirrorMoveUm-p.mirror1MoveUm,differenceUm=p.baseDifferenceUm+netMoveUm,lambdaUm=p.wavelengthNm/1000;
  const at=(radiusMm:number)=>{
    const cosine=p.focalLengthMm/Math.hypot(p.focalLengthMm,radiusMm),deltaUm=2*differenceUm*cosine,cycles=deltaUm/lambdaUm;
    const raw=Math.cos(Math.PI*(cycles%1))**2,intensity=raw<1e-12?0:1-raw<1e-12?1:raw;
    return {cosine,deltaUm,cycles,intensity,angleDeg:Math.atan(Math.abs(radiusMm)/p.focalLengthMm)*180/Math.PI};
  };
  const observation=at(p.observationRadiusMm),axis=at(0);
  return {at,observation,axis,differenceUm,netMoveUm,arm1Mm:100+p.mirror1MoveUm/1000,arm2Mm:100+(p.baseDifferenceUm+p.mirrorMoveUm)/1000,fringeShift:2*netMoveUm/lambdaUm,oneFringeMoveUm:lambdaUm/2,
    status:observation.intensity===1?'亮环 · 相长干涉':observation.intensity===0?'暗环 · 相消干涉':'明暗之间'};
}
export function michelsonTarget(p:MichelsonParameters,target:'bright'|'dark') {
  const b=michelson(p),offset=target==='dark'?.5:0,lambdaUm=p.wavelengthNm/1000;
  const factor=2*b.observation.cosine/lambdaUm;
  const reference=p.baseDifferenceUm-p.mirror1MoveUm;
  const minOrder=Math.ceil((reference-1)*factor-offset-1e-10),maxOrder=Math.floor((reference+1)*factor-offset+1e-10);
  const order=Math.min(maxOrder,Math.max(minOrder,Math.round(b.observation.cycles-offset)))+offset;
  const move=order*lambdaUm/(2*b.observation.cosine)-reference;
  if(move< -1-1e-10||move>1+1e-10)throw new Error('目标超出移镜范围。');
  return Math.min(1,Math.max(-1,move));
}
export interface MichelsonHistory {past:MichelsonParameters[];present:MichelsonParameters;future:MichelsonParameters[]}
export function michelsonHistory(h:MichelsonHistory,action:{type:'commit';parameters:MichelsonParameters}|{type:'undo'|'redo'}):MichelsonHistory {
  if(action.type==='commit') {const next=parseMichelson(action.parameters);if(MICHELSON_FIELDS.every(f=>next[f.key]===h.present[f.key]))return h;return {past:[...h.past,h.present].slice(-80),present:next,future:[]};}
  if(action.type==='undo'&&h.past.length)return {past:h.past.slice(0,-1),present:h.past.at(-1)!,future:[h.present,...h.future]};
  if(action.type==='redo'&&h.future.length)return {past:[...h.past,h.present],present:h.future[0],future:h.future.slice(1)};
  return h;
}

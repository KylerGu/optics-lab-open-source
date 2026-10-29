import { defaultScene, parseScene, SCENE_DEFINITIONS, type SceneState } from './sceneRuntime';

export const COUPLING_ID='fiber-modes-1';
export interface CouplingParameters { wavelengthNm:number; beamRadiusUm:number; modeRadiusUm:number; offsetUm:number; tiltDeg:number; powerMw:number }
export const DEFAULT_COUPLING=defaultScene(COUPLING_ID).parameters as unknown as CouplingParameters;
const SYMBOLS={wavelengthNm:'λ',beamRadiusUm:'w',modeRadiusUm:'w_f',offsetUm:'d',tiltDeg:'θ',powerMw:'Pᵢₙ'};
export const COUPLING_FIELDS=SCENE_DEFINITIONS[COUPLING_ID].parameters.map(f=>({...f,key:f.key as keyof CouplingParameters,symbol:SYMBOLS[f.key as keyof CouplingParameters]}));
export const couplingState=(p:CouplingParameters):SceneState=>({version:1,sceneId:COUPLING_ID,parameters:{...p}});
export const parseCoupling=(p:unknown)=>parseScene({version:1,sceneId:COUPLING_ID,parameters:p},COUPLING_ID).parameters as unknown as CouplingParameters;
export function fiberCoupling(p:CouplingParameters) {
  const w=p.beamRadiusUm, f=p.modeRadiusUm, s=w*w+f*f, k=2*Math.PI/(p.wavelengthNm*.001);
  const sizeFactor=(2*w*f/s)**2, positionExponent=2*p.offsetUm**2/s;
  const angleExponent=(k*Math.sin(p.tiltDeg*Math.PI/180))**2*w*w*f*f/(2*s);
  const logEta=Math.log(sizeFactor)-positionExponent-angleExponent, efficiency=Math.exp(logEta);
  return {efficiency,efficiencyPct:100*efficiency,coupledPowerMw:p.powerMw*efficiency,lossDb:-10*logEta/Math.LN10,sizePct:100*sizeFactor,positionPct:100*Math.exp(-positionExponent),anglePct:100*Math.exp(-angleExponent)};
}
export interface CouplingHistory {past:CouplingParameters[];present:CouplingParameters;future:CouplingParameters[]}
export function couplingHistory(h:CouplingHistory,a:{type:'commit';parameters:CouplingParameters}|{type:'undo'|'redo'}):CouplingHistory {
  if(a.type==='commit'){const next=parseCoupling(a.parameters);if(COUPLING_FIELDS.every(f=>next[f.key]===h.present[f.key]))return h;return {past:[...h.past,h.present].slice(-80),present:next,future:[]};}
  if(a.type==='undo'&&h.past.length)return {past:h.past.slice(0,-1),present:h.past.at(-1)!,future:[h.present,...h.future]};
  if(a.type==='redo'&&h.future.length)return {past:[...h.past,h.present],present:h.future[0],future:h.future.slice(1)};
  return h;
}

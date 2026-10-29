import {ABERRATION_COLORS,aberrationDimensions,aberrationFocal} from './aberrationModel';
import type {SceneResult} from './sceneRuntime';

export const ABERRATION_SYMBOLS:Record<string,{base:string;sub?:string;color:string}>={
  index:{base:'n',color:'#357fc6'},thickness:{base:'t',color:'#62748a'},effectiveFocal:{base:'F',color:'#7955ad'},
  backFocal:{base:'BFL',color:'#147f96'},marginalFocus:{base:'L',sub:'m',color:'#b8792e'},
  longitudinalSA:{base:'Δz',sub:'SA',color:'#b14c72'},chromaticShift:{base:'Δz',sub:'RB',color:'#8b5b99'},rmsRadius:{base:'r',sub:'RMS',color:'#26836a'},
  backFocal450:{base:'BFL',sub:'450',color:ABERRATION_COLORS[450]},backFocal550:{base:'BFL',sub:'550',color:ABERRATION_COLORS[550]},backFocal650:{base:'BFL',sub:'650',color:ABERRATION_COLORS[650]},
  R:{base:'R',color:'#357fc6'},diameter:{base:'D',color:'#c16b37'},edge:{base:'t',sub:'e',color:'#62748a'},
  A:{base:'A',color:'#357fc6'},B:{base:'B',color:'#357fc6'},wavelength:{base:'λ',color:'#357fc6'},screen:{base:'s',color:'#c38536'},
};
export const ABERRATION_RESULTS=['index','thickness','effectiveFocal','backFocal','marginalFocus','longitudinalSA','chromaticShift','rmsRadius'] as const;
export type AberrationQuantity=typeof ABERRATION_RESULTS[number]|'backFocal450'|'backFocal550'|'backFocal650';
export function aberrationMeasure(result:SceneResult,key:AberrationQuantity){
  const p=result.input.parameters,t=aberrationDimensions(p).thickness,metric=result.metrics.find(m=>m.key===key),near=aberrationFocal(p,p.wavelength),focus=t+near.back;
  const wave=key.match(/^backFocal(450|550|650)$/),value=wave?aberrationFocal(p,Number(wave[1])).back:metric?.value??null;
  let start:number|null=null,end:number|null=null;
  if(key==='thickness'){start=0;end=t;}
  if(key==='effectiveFocal'){start=focus-near.effective;end=focus;}
  if(key==='backFocal'){start=t;end=focus;}
  if(key==='marginalFocus'){start=t;end=value===null?null:t+value;}
  if(key==='longitudinalSA'){start=result.metrics.find(m=>m.key==='marginalFocus')?.value??null;if(start!==null)start+=t;end=focus;}
  if(key==='chromaticShift'){start=t+aberrationFocal(p,450).back;end=t+aberrationFocal(p,650).back;}
  if(wave){start=t;end=t+value!;}
  return {key,value,start,end,color:ABERRATION_SYMBOLS[key].color};
}

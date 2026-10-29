import type {SceneResult} from './sceneRuntime';
import {apertureGeometry} from './apertureModel';

export const APERTURE_QUANTITIES={
  f:{symbol:'f',color:'#357fc6'},u:{symbol:'u',color:'#c16b37'},lensD:{symbol:'Dₗ',color:'#a67916'},stopD:{symbol:'Dₛ',color:'#be5057'},z:{symbol:'zₛ',color:'#62748a'},h:{symbol:'h',color:'#ad4c87'},
  v:{symbol:'v',color:'#26836a'},entrancePosition:{symbol:'zₚ',color:'#7955ad'},entranceDiameter:{symbol:'Dₚ',color:'#14878b'},exitPosition:{symbol:'zₚ′',color:'#535cb5'},exitDiameter:{symbol:'Dₚ′',color:'#b65f75'},acceptedWidth:{symbol:'W',color:'#728025'},throughput:{symbol:'η',color:'#38758c'},
} as const;
export type ApertureQuantity=Exclude<keyof typeof APERTURE_QUANTITIES,'throughput'>;
export const apertureDrawable=(key:string):key is ApertureQuantity=>key in APERTURE_QUANTITIES&&key!=='throughput';
export function apertureMeasure(result:SceneResult,key:ApertureQuantity){
  const p=result.input.parameters,metric=(name:string)=>result.metrics.find(m=>m.key===name)?.value??null;
  const value=key in p?p[key]:metric(key);
  if(key==='h')return {value,vertical:true,position:-p.u,start:0,end:value};
  if(['lensD','stopD','entranceDiameter','exitDiameter'].includes(key)){
    const position=key==='lensD'?0:key==='stopD'?p.z:metric(key==='entranceDiameter'?'entrancePosition':'exitPosition');
    return {value,vertical:true,position,start:value===null?null:-value/2,end:value===null?null:value/2};
  }
  if(key==='acceptedWidth'){const g=apertureGeometry(p);return {value,vertical:true,position:0,start:g.lo,end:g.hi};}
  return {value,vertical:false,position:0,start:key==='u'?-p.u:0,end:key==='u'?0:value};
}

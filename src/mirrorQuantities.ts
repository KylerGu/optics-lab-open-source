import type {SceneResult} from './sceneRuntime';

export const MIRROR_QUANTITIES={R:{symbol:'|R|',color:'#357fc6'},f:{symbol:'f',color:'#6855ad'},u:{symbol:'u',color:'#c16b37'},v:{symbol:'v',color:'#26836a'},h:{symbol:'h',color:'#a67916'},imageHeight:{symbol:'h′',color:'#147f96'}} as const;
export type MirrorQuantity=keyof typeof MIRROR_QUANTITIES;
export function mirrorMeasure(result:SceneResult,key:MirrorQuantity){
  const p=result.input.parameters,metric=(name:string)=>result.metrics.find(m=>m.key===name)?.value??null;
  const value=['R','u','h'].includes(key)?p[key]:metric(key),image=metric('v');
  const start=key==='u'?-p.u:0,end=key==='u'?0:key==='R'?-p.kind*p.R:key==='f'||key==='v'?value===null?null:-value:value;
  return {value,start,end,vertical:key==='h'||key==='imageHeight',position:key==='h'?-p.u:key==='imageHeight'?image===null?null:-image:0};
}

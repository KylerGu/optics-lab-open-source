import type {SceneResult} from './sceneRuntime';

export const THIN_LENS_SYMBOLS={f:'f',u:'u',h:'h',v:'v',imageHeight:'h′'} as const;
export type ThinLensQuantity=keyof typeof THIN_LENS_SYMBOLS;
export function thinLensMeasure(result:SceneResult,key:ThinLensQuantity){
  const p=result.input.parameters,metric=(name:string)=>result.metrics.find(m=>m.key===name)?.value??null;
  const value=key==='u'||key==='h'?p[key]:metric(key),start=key==='u'?-p.u:0;
  const end=key==='u'?0:value,vertical=key==='h'||key==='imageHeight',position=key==='h'?-p.u:key==='imageHeight'?metric('v'):0;
  return {key,symbol:THIN_LENS_SYMBOLS[key],value,start,end,vertical,position};
}

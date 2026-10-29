import type {SceneResult} from './sceneRuntime';

export const DOUBLE_LENS_SYMBOLS={f1:'|f₁|',f2:'|f₂|',u:'u₁',d:'d',h:'h',v1:'v₁',v:'v₂',equivalentFocal:'F'} as const;
export type DoubleLensQuantity=keyof typeof DOUBLE_LENS_SYMBOLS;
export function doubleLensMeasure(result:SceneResult,key:DoubleLensQuantity){
  const p=result.input.parameters,value=['f1','f2','u','d','h'].includes(key)?p[key]:result.metrics.find(m=>m.key===key)?.value??null;
  let start=0,end:number|null=value,reference:string|null=null;
  if(key==='u'){start=-p.u;end=0;}
  if(key==='f1')end=p.f1*p.k1;
  if(key==='f2'){start=p.d;end=p.d+p.f2*p.k2;}
  if(key==='v'){start=p.d;end=value===null?null:p.d+value;}
  // The equivalent focal length starts at the rear principal plane, not lens 2.
  if(key==='equivalentFocal'&&value!==null){start=p.d-value*p.d/(p.f1*p.k1);end=start+value;reference='H′';}
  return {key,symbol:DOUBLE_LENS_SYMBOLS[key],value,start,end,reference,vertical:key==='h'};
}

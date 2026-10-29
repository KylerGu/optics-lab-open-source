import type {SceneResult} from './sceneRuntime';

export const REFRACTION_QUANTITIES={
  angle:{symbol:'θᵢ',color:'#c16b37'},n1:{symbol:'n₁',color:'#357fc6'},n2:{symbol:'n₂',color:'#147f96'},
  reflectedAngle:{symbol:'θᵣ',color:'#7955ad'},transmittedAngle:{symbol:'θₜ',color:'#26836a'},criticalAngle:{symbol:'θc',color:'#a67916'},R:{symbol:'R',color:'#a55b82'},T:{symbol:'T',color:'#2b91a3'},
  n:{symbol:'n',color:'#357fc6'},outside:{symbol:'n₀',color:'#62748a'},apex:{symbol:'A',color:'#a67916'},r1:{symbol:'r₁',color:'#147f96'},r2:{symbol:'r₂',color:'#7955ad'},exitAngle:{symbol:'e',color:'#26836a'},deviation:{symbol:'δ',color:'#b14c72'},minimumDeviation:{symbol:'δₛ',color:'#667b94'},
} as const;
export type RefractionQuantity=Exclude<keyof typeof REFRACTION_QUANTITIES,'R'|'T'|'minimumDeviation'>;
export const refractionSymbol=(key:keyof typeof REFRACTION_QUANTITIES,model:string)=>key==='angle'&&model==='prism'?'i':REFRACTION_QUANTITIES[key].symbol;
const drawable:Record<string,readonly string[]>={interface:['angle','n1','n2','reflectedAngle','transmittedAngle','criticalAngle'],prism:['angle','n','outside','apex','r1','r2','exitAngle','deviation']};
export const refractionDrawable=(model:string,key:string):key is RefractionQuantity=>drawable[model]?.includes(key)??false;
const RAD=Math.PI/180;
export function refractionArc(result:SceneResult,key:RefractionQuantity):{center:[number,number];from:number;to:number;value:number|null;reference?:boolean;reason?:string}|null{
  const p=result.input.parameters,metric=(key:string)=>result.metrics.find(m=>m.key===key)?.value??null;
  if(result.model==='interface'){
    const value=key==='angle'?p.angle:metric(key),center:[number,number]=[0,0];
    if(key==='angle')return {center,from:Math.PI/2,to:Math.PI/2+p.angle*RAD,value};
    if(key==='reflectedAngle')return {center,from:Math.PI/2,to:Math.PI/2-p.angle*RAD,value,reason:metric('R')!<=1e-10?'无反射光':undefined};
    if(key==='transmittedAngle')return {center,from:-Math.PI/2,to:-Math.PI/2+(value??0)*RAD,value,reason:value===null?'无传播折射光':undefined,reference:value!==null&&metric('T')!<=1e-10};
    if(key==='criticalAngle')return {center,from:Math.PI/2,to:Math.PI/2+(value??0)*RAD,value,reference:true,reason:value===null?'无全反射临界角':undefined};
    return null;
  }
  const A=p.apex*RAD,entry=result.segments[0].end,norm=-A/2,inside=result.segments.find(s=>s.role==='internal'),out=result.segments.find(s=>s.role==='transmitted');
  const direction=(s:typeof result.segments[number])=>Math.atan2(s.end[1]-s.start[1],s.end[0]-s.start[0]);
  const second=inside&&inside.end[1]>=0&&inside.end[1]<=1&&Math.abs(inside.end[0]-Math.tan(A/2)*(1-inside.end[1]))<1e-8;
  if(key==='angle')return {center:entry,from:norm+Math.PI,to:norm+p.angle*RAD+Math.PI,value:p.angle};
  if(key==='apex')return {center:[0,1],from:-Math.PI/2-A/2,to:-Math.PI/2+A/2,value:p.apex};
  if(key==='r1')return {center:entry,from:norm,to:inside?direction(inside):norm,value:metric(key),reason:inside?undefined:'光未进入棱镜'};
  if(key==='r2')return {center:inside?.end??entry,from:A/2+Math.PI,to:inside?direction(inside)+Math.PI:A/2+Math.PI,value:metric(key),reason:second?undefined:'光未到达第二斜面'};
  if(key==='exitAngle')return {center:out?.start??inside?.end??entry,from:A/2,to:out?direction(out):A/2,value:metric(key),reason:out?undefined:'无第二面出射光'};
  if(key==='deviation')return {center:out?.start??inside?.end??entry,from:norm+p.angle*RAD,to:out?direction(out):norm+p.angle*RAD,value:metric(key),reason:out?undefined:'无第二面出射光'};
  return null;
}

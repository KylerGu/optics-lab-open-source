import type {SceneResult,SceneState} from './sceneRuntime';

export const MICROSCOPE_QUANTITIES={
  f1:{symbol:'fₒ',color:'#357fc6'},f2:{symbol:'fₑ',color:'#8a5eac'},tubeF:{symbol:'fₜ',color:'#147f96'},
  u:{symbol:'u',color:'#c16b37'},d:{symbol:'d',color:'#62748a'},h:{symbol:'h',color:'#a67916'},
  v1:{symbol:'v₁',color:'#198e98'},v:{symbol:'v₂',color:'#26836a'},focusOffset:{symbol:'Δu',color:'#bb526a'},
  fieldWidth:{symbol:'W',color:'#26836a'},fieldHeight:{symbol:'H',color:'#357fc6'},fieldDiagonal:{symbol:'L',color:'#8a5eac'},fieldDiameter:{symbol:'D',color:'#26836a'},
  separation:{symbol:'s',color:'#c16b37'},resolution:{symbol:'rₓᵧ',color:'#357fc6'},depth:{symbol:'DOF',color:'#26836a'},halfDepth:{symbol:'Δz',color:'#8a5eac'},defocus:{symbol:'z',color:'#c16b37'},
} as const;
export type MicroscopeQuantity=keyof typeof MICROSCOPE_QUANTITIES;

export function canAnnotateMicroscope(state:SceneState,result:SceneResult|null,key:string):key is MicroscopeQuantity {
  if(!result||result.model!=='microscope'||!(key in MICROSCOPE_QUANTITIES))return false;
  const p=state.parameters,metric=(name:string)=>result.metrics.find(m=>m.key===name)?.value??null;
  if(p.study===1)return key==='separation'||key==='resolution';
  if(p.study===3)return ['depth','halfDepth','defocus'].includes(key)&&metric(key)!==null;
  if(p.study===2){
    const valid=p.mode===1?Math.abs(p.u-p.f1)<=1e-9*Math.max(1,p.f1):metric('angularM')!==null;
    return valid&&(p.mode===1?['fieldWidth','fieldHeight','fieldDiagonal']:['fieldDiameter']).includes(key)&&metric(key)!==null;
  }
  if(['f1','u','d','h'].includes(key))return true;
  if(key===(p.mode===1?'tubeF':'f2'))return true;
  if(key==='focusOffset')return p.mode===1;
  return (key==='v'||key==='v1'&&p.mode===0)&&metric(key)!==null;
}

export function microscopeRayMeasure(result:SceneResult,key:MicroscopeQuantity){
  const p=result.input.parameters,metric=(name:string)=>result.metrics.find(m=>m.key===name)?.value??null;
  const value=['f1','f2','tubeF','u','d','h'].includes(key)?p[key]:metric(key);
  let start=0,end=value;
  if(key==='u'){start=-p.u;end=0;}
  if(key==='f2'||key==='tubeF'||key==='v'){start=p.d;end=value===null?null:p.d+value;}
  if(key==='focusOffset'){start=-p.u;end=-p.f1;}
  return {start,end,value,vertical:key==='h',position:key==='h'?-p.u:0};
}

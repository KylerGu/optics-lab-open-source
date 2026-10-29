import {cameraAnnotationKeys,cameraStudyQuantities} from './cameraAnnotations';
import {CAMERA_FIELD_QUANTITIES} from './cameraFieldQuantities';
import {CAMERA_PIXEL_QUANTITIES} from './cameraPixelQuantities';
import {CAMERA_DEPTH_QUANTITIES} from './cameraDepthQuantities';
import type {AnswerQuantity} from './answerQuantityLinks';
import {SCENE_DEFINITIONS, type SceneState, type SceneResult} from './sceneRuntime';
import {quantityColor} from './scenePresentation';
import {THIN_LENS_SYMBOLS,thinLensMeasure,type ThinLensQuantity} from './thinLensQuantities';
import {DOUBLE_LENS_SYMBOLS,doubleLensMeasure,type DoubleLensQuantity} from './doubleLensQuantities';
import {MIRROR_QUANTITIES,mirrorMeasure,type MirrorQuantity} from './mirrorQuantities';
import {APERTURE_QUANTITIES,apertureDrawable,apertureMeasure} from './apertureQuantities';
import {REFRACTION_QUANTITIES,refractionDrawable,refractionArc,refractionSymbol} from './refractionQuantities';
import {ABERRATION_SYMBOLS,ABERRATION_RESULTS,aberrationMeasure,type AberrationQuantity} from './aberrationQuantities';
import {TELESCOPE_EYE_QUANTITIES} from './telescopeEyeQuantities';

export const supportsGeometricalInteraction=(id:string)=>/^(reflection-refraction|paraxial|instruments|aberrations)-/.test(id)&&!!SCENE_DEFINITIONS[id];
export type QuantitySelection={selected:ReadonlySet<string>;toggle:(key:string)=>void;canMark?:(key:string)=>boolean};
export type DiagramQuantity={key:string;label:string;symbol:string;controls:string};
const cleanLabel=(label:string)=>label.replace(/\s+[|A-Za-zλθΔβη].*$/u,'');
const extraSymbols:Record<string,Record<string,string>>={
  camera:{f:'f',u:'u',h:'h',sensor:'s',aperture:'a',v:'v',blurDiameter:'c',fNumber:'N',m:'m',objectPixel:'pₒ',...Object.fromEntries(Object.entries({...CAMERA_FIELD_QUANTITIES,...CAMERA_DEPTH_QUANTITIES,...CAMERA_PIXEL_QUANTITIES}).map(([k,q])=>[k,q.symbol]))},
  telescope:{f1:'fₒ',f2:'|fₑ|',d:'d',angle:'θ',centralAngle:'θ′',aperture:'Dₒ',eyepieceDiameter:'Dₑ',afocalLength:'d₀',angularSpread:'Δθ′',resolution:'θᵣ',starSeparation:'Δθ',angularM:'M',skyAngle:'β',...Object.fromEntries(Object.entries(TELESCOPE_EYE_QUANTITIES).map(([k,q])=>[k,q.symbol]))},
};
export function geometricalSymbol(model:string,key:string){
  if(model==='lens')return (THIN_LENS_SYMBOLS as Record<string,string>)[key]??(key==='m'?'m':undefined);
  if(model==='double-lens')return (DOUBLE_LENS_SYMBOLS as Record<string,string>)[key]??(key==='m'?'m':undefined);
  if(model==='mirror')return (MIRROR_QUANTITIES as Record<string,{symbol:string}>)[key]?.symbol??(key==='m'?'m':undefined);
  if(model==='aperture')return (APERTURE_QUANTITIES as Record<string,{symbol:string}>)[key]?.symbol;
  if(model==='interface'||model==='prism')return key in REFRACTION_QUANTITIES?refractionSymbol(key as keyof typeof REFRACTION_QUANTITIES,model):undefined;
  if(model==='aberration'){const q=ABERRATION_SYMBOLS[key];return q?`${q.base}${q.sub?'_'+q.sub:''}`:undefined;}
  return extraSymbols[model]?.[key];
}

// Describe only quantities that already have a meaningful mark in the current view.
export function geometricalDiagramQuantities(result:SceneResult):DiagramQuantity[]{
  const {model,input}=result,p=input.parameters,definition=SCENE_DEFINITIONS[input.sceneId];
  let keys:string[]=[],controls='';
  if(model==='lens'){keys=Object.keys(THIN_LENS_SYMBOLS).filter(k=>thinLensMeasure(result,k as ThinLensQuantity).value!==null);controls='thin-lens-ray-diagram';}
  if(model==='double-lens'){keys=Object.keys(DOUBLE_LENS_SYMBOLS).filter(k=>doubleLensMeasure(result,k as DoubleLensQuantity).value!==null);controls='double-lens-ray-diagram';}
  if(model==='mirror'){keys=Object.keys(MIRROR_QUANTITIES).filter(k=>mirrorMeasure(result,k as MirrorQuantity).value!==null);controls='mirror-ray-diagram';}
  if(model==='aperture'){keys=Object.keys(APERTURE_QUANTITIES).filter(k=>apertureDrawable(k)&&apertureMeasure(result,k).value!==null&&apertureMeasure(result,k).position!==null);controls='aperture-ray-diagram';}
  if(model==='interface'||model==='prism'){keys=Object.keys(REFRACTION_QUANTITIES).filter(k=>refractionDrawable(model,k)&&!refractionArc(result,k)?.reason);controls='refraction-ray-diagram';}
  if(model==='aberration'){keys=[...ABERRATION_RESULTS,...(p.mode===1?['backFocal450','backFocal550','backFocal650']:[])].filter(k=>(k!=='chromaticShift'||p.mode===1)&&aberrationMeasure(result,k as AberrationQuantity).value!==null);controls='aberration-ray-diagram';}
  if(model==='camera'){
    keys=[...cameraAnnotationKeys(p.study)];
    const v=result.metrics.find(m=>m.key==='v')?.value;
    keys=keys.filter(k=>k!=='v'||v!==null&&v!==undefined&&v>0).filter(k=>!['airyDiameter','pixel'].includes(k)||v!==null&&v!==undefined&&v>0).filter(k=>!['depth','nearDepth','farDepth','focusDistance'].includes(k)||result.metrics.find(m=>m.key==='nearDepth')?.value!=null);
    controls=p.study===0?'camera-ray-diagram':'camera-study-diagram';
  }
  if(model==='telescope'){
    keys=p.study===0?['f1','f2','d','angle','centralAngle','aperture','eyepieceDiameter','afocalLength','angularSpread']:p.study===1?['skyAngle','visibleField']:p.study===2?['resolution','starSeparation']:['pupilDiameter','pupilPosition','eyeDistance','eyeOffset','eyeDiameter'];
    controls=['telescope-ray-diagram','telescope-field-diagram','telescope-resolution-diagram','telescope-eye-diagram'][p.study];
  }
  const labels:Record<string,string>={f:'焦距',imageHeight:'像高',equivalentFocal:'系统等效焦距',skyAngle:'图中观察角宽',visibleField:'模型内可见角宽',centralAngle:'主光线出射角',angularSpread:'出射方向差',backFocal450:'蓝光近轴后焦距',backFocal550:'绿光近轴后焦距',backFocal650:'红光近轴后焦距'};
  return keys.map(key=>({key,label:(model==='camera'?cameraStudyQuantities(p.study)[key]?.label:undefined)??labels[key]??cleanLabel(result.metrics.find(m=>m.key===key)?.label??definition.parameters.find(f=>f.key===key)?.label??key),symbol:geometricalSymbol(model,key)??key,controls:key==='rmsRadius'?'aberration-spot-diagram':controls}));
}

const aliases:Record<string,string[]>={u:['物距'],h:['物高'],v:['像距'],f:['有向焦距','焦距大小'],v1:['中间像距'],f1:['物镜焦距'],f2:['目镜焦距'],d:['镜间距'],imageHeight:['像的高度'],resolution:['角分辨率'],deviation:['偏折角'],angularSpread:['出射角全宽'],centralAngle:['中心光线出射方向'],visibleField:['近轴内可见视场'],depth:['景深'],airyDiameter:['艾里斑直径'],rmsRadius:['均方根半径']};
const subscript:Record<string,string>={'₀':'0','₁':'1','₂':'2','ₒ':'o','ₑ':'e','ₚ':'p','ₛ':'s','ₗ':'l','ᵣ':'r','ᵢ':'i','ₜ':'t','ᵥ':'v','ₙ':'n','ₐ':'a','𝒻':'f'};
function symbolAliases(symbol:string){
  const latex=symbol.replace(/[₀₁₂ₒₑₚₛₗᵣᵢₜᵥₙₐ𝒻]/gu,c=>'_'+subscript[c]).replace(/θ/g,'\\theta ').replace(/δ/g,'\\delta ').replace(/Δ/g,'\\Delta ').replace(/β/g,'\\beta ').replace(/η/g,'\\eta ').replace(/ν/g,'\\nu ').replace(/′/g,"'");
  return [...new Set([symbol,latex])];
}
export function geometricalAnswerQuantities(source:SceneState,current:SceneState,result:SceneResult|null,selection:QuantitySelection|null):AnswerQuantity[]{
  if(!result||!selection||source.sceneId!==current.sceneId||source.parameters.study!==current.parameters.study||source.parameters.mode!==current.parameters.mode)return [];
  return geometricalDiagramQuantities(result).filter(q=>selection.canMark?.(q.key)??true).map(q=>({id:q.key,label:q.label,terms:[q.label,...(result.model==='camera'?[cleanLabel(result.metrics.find(m=>m.key===q.key)?.label??q.label)]:[]),...(aliases[q.key]??[]).filter(term=>!(current.sceneId==='paraxial-2'&&['物镜焦距','目镜焦距'].includes(term)))],symbols:symbolAliases(q.symbol),color:quantityColor(q.key,result.model),controls:q.controls,selected:selection.selected.has(q.key),onToggle:()=>selection.toggle(q.key)}));
}

import teachingPresets from './lensTeachingPresets.json';
import {makeSpatialElement,parseSpatial,type SpatialElement,type SpatialKind,type CatalogItem} from './builderModel';
import {isPhysicalLens,isProfileLens,isSolidCylinder,physicalFocalLengths,validatePhysicalLens} from './physicalLensGeometry';
import {glassIndex} from './spatialGeometry';
import {lensRadii} from './sphericalLensGeometry';

export const MY_LENSES_KEY='optics-spatial-my-lenses-v1';
export interface LensPreset {id:string;name:string;element:SpatialElement;focalMm:number}
export interface SavedLens {id:string;name:string;element:SpatialElement}
/** Fixed material, thickness, conic/polynomial terms and R2/R1; scale radii only. */
export function designLensFocal(e:SpatialElement,target:number,wavelength=587.56):Partial<SpatialElement>{
  if(!isPhysicalLens(e.kind)||!Number.isFinite(target)||Math.abs(target)<1||Math.abs(target)>5000)throw new Error('目标焦距绝对值须在1至5000 mm之间。');
  const n=glassIndex(e,wavelength),[r1,r2]=isProfileLens(e.kind)?[(e.kind.includes('convex')?1:-1)*e.frontRadiusMm,0]:lensRadii(e);
  const p1=(n-1)/r1,p2=r2?(1-n)/r2:0,a=p1+p2,b=e.centerThicknessMm/n*p1*p2,p=1/target,disc=a*a-4*p*b;
  const candidates=disc<0?[]:[(a+Math.sqrt(disc))/(2*p),(a-Math.sqrt(disc))/(2*p)];
  const valid=candidates.filter(s=>Number.isFinite(s)&&s>0).map(s=>({s,frontRadiusMm:e.frontRadiusMm*s,backRadiusMm:e.backRadiusMm*s})).filter(patch=>{
    if(patch.frontRadiusMm<.5||patch.frontRadiusMm>5000||r2&&(patch.backRadiusMm<.5||patch.backRadiusMm>5000))return false;
    try{const next={...e,...patch};validatePhysicalLens(next);return Math.abs(physicalFocalLengths(next,wavelength).effective!-target)<1e-5;}catch{return false;}
  }).sort((a,b)=>Math.abs(Math.log(a.s))-Math.abs(Math.log(b.s)));
  if(!valid.length)throw new Error('固定当前材料、厚度和曲面比例时，无法得到有效镜片；请调整目标焦距或镜片参数。');
  const chosen=valid[0];return {frontRadiusMm:chosen.frontRadiusMm,...(r2?{backRadiusMm:chosen.backRadiusMm}:{})};
}
const opticalKeys: (keyof SpatialElement)[]=['kind','diameterMm','glass','refractiveIndex','abbeNumber','frontRadiusMm','centerThicknessMm','clearApertureMm','clearWidthMm','clearHeightMm','cylinderWidthMm','cylinderHeightMm','backRadiusMm','conicConstant','asphericA4','asphericA6'];
export function lensFingerprint(e:SpatialElement){
  const keys=opticalKeys.filter(k=>isSolidCylinder(e.kind)?!['diameterMm','clearApertureMm','conicConstant','asphericA4','asphericA6','backRadiusMm'].includes(k):!['clearWidthMm','clearHeightMm','cylinderWidthMm','cylinderHeightMm'].includes(k)&&(!isProfileLens(e.kind)||!['backRadiusMm'].includes(k))&&(e.kind.startsWith('plano')?k!=='backRadiusMm':true));
  return JSON.stringify(keys.map(k=>[k,e[k]]));
}
// These are generated teaching specifications, not manufacturer product numbers.
export const TEACHING_LENSES:LensPreset[]=teachingPresets.presets.map(p=>{const {id,name,focalMm,kind,...defaults}=p;const element=makeSpatialElement(kind as SpatialKind,[0,60,0],{...defaults,glass:defaults.glass as SpatialElement['glass'],id});validatePhysicalLens(element);return {id,name,focalMm,element};});
export function lensCatalogItem(preset:SavedLens|LensPreset):CatalogItem{
  const defaults:Partial<SpatialElement>={...preset.element};for(const key of ['id','position','yawDeg','pitchDeg','rollDeg'] as const)delete defaults[key];
  return {id:preset.id,name:preset.name,category:'lens',kind:preset.element.kind,defaults:{...defaults,name:preset.name.slice(0,40)},hint:'镜片规格'};
}
export function lensSpecification(e:SpatialElement,saved:SavedLens[]=[]){const signature=lensFingerprint(e),mine=saved.find(p=>lensFingerprint(p.element)===signature),teaching=TEACHING_LENSES.find(p=>lensFingerprint(p.element)===signature);return mine?{label:'我的镜片',name:mine.name}:teaching?{label:'教学预设',name:teaching.name}:null;}
export function readMyLenses():SavedLens[]{
  const raw=localStorage.getItem(MY_LENSES_KEY);if(!raw)return [];
  const rows:unknown=JSON.parse(raw);if(!Array.isArray(rows)||rows.length>40)throw new Error('我的镜片存档格式无效，请先导出备份。');
  const ids=new Set<string>();return rows.map(row=>{
    if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id)||typeof row.name!=='string'||!row.name.trim()||row.name.length>40)throw new Error('我的镜片存档格式无效。');ids.add(row.id);
    const element=parseSpatial({schemaVersion:2,name:'镜片规格',elements:[row.element]}).elements[0];if(!isPhysicalLens(element.kind))throw new Error('存档中包含不支持的镜片。');return {id:row.id,name:row.name,element};
  });
}
export function saveMyLens(e:SpatialElement):SavedLens[]{
  const existing=readMyLenses(),element=parseSpatial({schemaVersion:2,name:'镜片规格',elements:[e]}).elements[0];
  if(!isPhysicalLens(element.kind))throw new Error('只能保存实体镜片规格。');
  const matching=existing.find(row=>row.name===e.name),id=matching?.id??crypto.randomUUID();
  if(!matching&&existing.length>=40)throw new Error('最多保存40种镜片，请先整理我的镜片。');
  const rows=[{id,name:e.name,element:{...element,id,position:[0,60,0] as [number,number,number],yawDeg:0,pitchDeg:0,rollDeg:0}},...existing.filter(row=>row.id!==id)];localStorage.setItem(MY_LENSES_KEY,JSON.stringify(rows));return rows;
}
export function resizeLens(e:SpatialElement,patch:Partial<SpatialElement>):Partial<SpatialElement>{
  const next={...patch};for(const [outer,clear] of [['diameterMm','clearApertureMm'],['cylinderWidthMm','clearWidthMm'],['cylinderHeightMm','clearHeightMm']] as const){if(patch[outer]!==undefined&&patch[clear]===undefined)next[clear]=e[clear]===e[outer]?patch[outer]:Math.min(e[clear],patch[outer]);}return next;
}
export function deleteMyLens(id:string){const rows=readMyLenses().filter(row=>row.id!==id);localStorage.setItem(MY_LENSES_KEY,JSON.stringify(rows));return rows;}

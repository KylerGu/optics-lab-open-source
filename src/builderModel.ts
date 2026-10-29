import {validateImaging} from './spatialImaging';
import {validateGrating,gratingOrderDirections} from './amplitudeGrating';
import {spatialFourFParameters} from './spatialFourF';
import {spatialFourierParameters} from './spatialFourier';
import { parseExperiment, type Experiment } from './model';
import { defaultLensRadii } from './sphericalLensGeometry';
import { isPhysicalLens, validatePhysicalLens } from './physicalLensGeometry';

export type SpatialKind = 'object' | 'eye' | 'sensor' | 'laser' | 'lens' | 'plano-convex-lens' | 'biconvex-lens' | 'plano-concave-lens' | 'biconcave-lens' | 'positive-meniscus-lens' | 'negative-meniscus-lens' | 'aspheric-convex-lens' | 'aspheric-concave-lens' | 'plano-convex-cylinder-lens' | 'plano-concave-cylinder-lens' | 'cylindrical-lens' | 'half-wave-plate' | 'quarter-wave-plate' | 'mirror' | 'splitter' | 'polarizing-splitter' | 'screen' | 'aperture' | 'filter' | 'right-prism' | 'dispersion-prism' | 'polarizer' | 'slit' | 'amplitude-grating' | 'power-meter';
export type Vec3 = [number, number, number];
export interface SpatialElement {
  objectMode:'finite'|'distant'; angularHeightDeg:number; incidentAngleDeg:number;
  objectPattern:'F'|'arrow'; objectHeightMm:number; objectWidthMm:number;
  sensorWidthMm:number; sensorHeightMm:number; adapterMagnification:number; nearDistanceMm:number; fieldNumberMm:number;
  id: string; name: string; kind: SpatialKind; position: Vec3; yawDeg: number; pitchDeg: number;
  diameterMm: number; focalLengthMm: number; beamRadiusMm: number; wavelengthNm: number; transmission: number;
  beamModel:'parallel'|'gaussian';
  waistOffsetMm:number; probeOffsetMm:number; slitMode:'pass'|'stop';
  gratingProfile:'binary'|'sinusoidal'; gratingModulation:number;
  powerMw:number; divergenceMrad:number; rayCount:number;
  rollDeg:number; polarization:'linear'|'unpolarized'; polarizationDeg:number;
  glass:'bk7'|'custom'; refractiveIndex:number; abbeNumber:number; apexAngleDeg:number; prismHeightMm:number;
  slitWidthMm:number; slitHeightMm:number; meterRangeMw:number; designWavelengthNm:number; pTransmission:number; sTransmission:number;
  frontRadiusMm:number; backRadiusMm:number; centerThicknessMm:number;
  clearApertureMm:number; clearWidthMm:number; clearHeightMm:number;
  gratingPeriodUm:number; gratingSlitUm:number; gratingWidthMm:number; gratingHeightMm:number;
  conicConstant:number; asphericA4:number; asphericA6:number; cylinderWidthMm:number; cylinderHeightMm:number;
}
export interface SlitDiffractionProfile {slitId:string;screenId:string;sourceId:string;center:Vec3;axis:Vec3;distanceMm:number;firstMinimumMm:number;centralMaximumWidthMm:number;points:{xMm:number;intensity:number}[];model:string}
export interface GratingDiffractionProfile {kind:'amplitude-grating';gratingId:string;screenId:string;sourceId:string;center:Vec3;axis:Vec3;distanceMm:number;periodCount:number;points:{xMm:number;intensity:number}[];model:string}
export type DiffractionProfile=SlitDiffractionProfile|GratingDiffractionProfile;
export interface GratingOrderResult {gratingId:string;sourceId:string;incident:Vec3;orders:ReturnType<typeof gratingOrderDirections>}
export interface MicroscopePresentation {kind:'microscope';objectId:string;objectiveId:string;relayId:string;observerId:string}
export interface SpatialExperiment { schemaVersion: 2; name: string; elements: SpatialElement[]; presentation?:MicroscopePresentation }
export interface SpatialResult {
  imaging?: import('./spatialImaging').ObjectImageResult[];
  revision: number; inputSnapshot: SpatialExperiment; model: string;
  segments: {start: Vec3; end: Vec3; power: number; powerMw:number; sourceId: string; chief: boolean; hitId: string | null}[];
  beams: {start:Vec3;end:Vec3;radiiMm:number[];sourceId:string;powerMw:number}[];
  screens: {elementId: string; name: string; hits: number; sampledPowerFraction: number; sampledPowerMw:number; centroid: Vec3 | null; footprintRadiusMm: number | null;gaussianRadiusMm:number|null;polarizationStokes?:{s1:number;s2:number;s3:number}|null;sampledRadiusUMm?:number|null;sampledRadiusVMm?:number|null;detectorKind?:'power-meter';readingMw?:number|null;overRange?:boolean}[];
  diffraction?:DiffractionProfile[];
  gratingOrders?:GratingOrderResult[];
  fourF?:SpatialFourFResult|null;
  fourier?:SpatialFourierResult|null;
  warnings: string[]; assumptions: string[]; chiefHitIds: string[];
}
export interface SpatialFourFResult {screenId:string;sourceId:string;gratingId:string;filterId:string|null;parameters:{wavelengthNm:number;periodMm:number;waistMm:number;modulation:number;focalLengthMm:number;filterWidthUm:number;filterOffsetUm:number;filterMode:number;observationMm:number};transmission:number;pointIntensity:number;inputPowerMw:number;outputPowerMw:number;capturedPowerMw:number;points:{xMm:number;intensity:number}[]}
export interface SpatialFourierResult {screenId:string;sourceId:string;gratingId:string;parameters:{wavelengthNm:number;periodMm:number;waistMm:number;modulation:number;focalLengthMm:number;observationUm:number};spatialFrequency:number;orderPositionUm:number;spotRadiusUm:number;pointIntensity:number;inputPowerMw:number;capturedPowerMw:number;points:{xMm:number;intensity:number}[]}
export const BUILDER_DRAFT = 'optics-spatial-draft-v2';
export const BUILDER_SAVED = 'optics-spatial-saved-v2';
export const KIND_NAMES: Record<SpatialKind, string> = {
  object:'物体／样品', eye:'目视观察', sensor:'相机感光面', laser: '激光光源', lens: '透镜', mirror: '平面反射镜', splitter: '分光镜', screen: '观察屏', aperture: '可调光阑', filter: '中性滤光片',
  'right-prism':'直角棱镜', 'dispersion-prism':'三棱镜', polarizer:'偏振片', slit:'狭缝', 'amplitude-grating':'一维透射振幅光栅', 'power-meter':'功率计',
  'aspheric-convex-lens':'平凸非球面透镜', 'aspheric-concave-lens':'平凹非球面透镜', 'plano-convex-cylinder-lens':'平凸柱面透镜', 'plano-concave-cylinder-lens':'平凹柱面透镜',
  'cylindrical-lens':'柱面透镜', 'polarizing-splitter':'偏振分光镜', 'half-wave-plate':'半波片', 'quarter-wave-plate':'四分之一波片',
  'plano-convex-lens':'平凸透镜', 'biconvex-lens':'双凸透镜', 'plano-concave-lens':'平凹透镜', 'biconcave-lens':'双凹透镜', 'positive-meniscus-lens':'正弯月透镜', 'negative-meniscus-lens':'负弯月透镜',
};
export const CATEGORIES = [
  {id:'all', name:'全部'}, {id:'source', name:'光源与物体'}, {id:'lens', name:'透镜'},
  {id:'reflection', name:'反射与分光'}, {id:'prism', name:'棱镜'}, {id:'filter', name:'滤光'}, {id:'polarization', name:'偏振控制'},
  {id:'aperture', name:'光阑与狭缝'}, {id:'diffraction',name:'衍射'}, {id:'detector', name:'观察与探测'}, {id:'mount', name:'支架与平台'},
];
export const LENS_GROUPS=[{id:'all',name:'全部透镜'},{id:'spherical',name:'球面透镜'},{id:'aspheric',name:'非球面透镜'},{id:'cylindrical',name:'柱面透镜'},{id:'ideal',name:'教学理想模型'}];
export interface CatalogItem { id: string; name: string; category: string; lensGroup?:'spherical'|'aspheric'|'cylindrical'|'ideal'; kind?: SpatialKind; hint: string; defaults?: Partial<SpatialElement> }
export const CATALOG: CatalogItem[] = [
  {id:'laser-green',name:'绿光激光器',category:'source',kind:'laser',hint:'532 nm · 平行光束'},
  {id:'laser-red',name:'红光激光器',category:'source',kind:'laser',hint:'650 nm · 平行光束',defaults:{wavelengthNm:650}},
  {id:'distant-object',name:'远处样品 F',category:'source',kind:'object',hint:'实际远处物体 · 从 F 发出光线',defaults:{objectMode:'distant',objectPattern:'F',angularHeightDeg:.6,wavelengthNm:550,position:[-1000,60,0]}},
  {id:'object',name:'物体／样品',category:'source',kind:'object',hint:'已照亮 · F / 箭头图案'},
  {id:'eye',name:'目视观察',category:'detector',kind:'eye',hint:'观察虚像或无穷远像'},
  {id:'sensor',name:'相机感光面',category:'detector',kind:'sensor',hint:'接收实像 · 可设理想转接倍率'},
  {id:'plano-convex-lens',name:'平凸透镜',category:'lens',lensGroup:'spherical',kind:'plano-convex-lens',hint:'球面透镜 · 一面凸一面平 · 会聚'},
  {id:'biconvex-lens',name:'双凸透镜',category:'lens',lensGroup:'spherical',kind:'biconvex-lens',hint:'球面透镜 · 两面凸 · 会聚'},
  {id:'plano-concave-lens',name:'平凹透镜',category:'lens',lensGroup:'spherical',kind:'plano-concave-lens',hint:'球面透镜 · 一面凹一面平 · 发散'},
  {id:'biconcave-lens',name:'双凹透镜',category:'lens',lensGroup:'spherical',kind:'biconcave-lens',hint:'球面透镜 · 两面凹 · 发散'},
  {id:'positive-meniscus-lens',name:'正弯月透镜',category:'lens',lensGroup:'spherical',kind:'positive-meniscus-lens',hint:'球面透镜 · 一凸一凹 · 会聚'},
  {id:'negative-meniscus-lens',name:'负弯月透镜',category:'lens',lensGroup:'spherical',kind:'negative-meniscus-lens',hint:'球面透镜 · 一凸一凹 · 发散'},
  {id:'aspheric-convex-lens',name:'平凸非球面透镜',category:'lens',lensGroup:'aspheric',kind:'aspheric-convex-lens',hint:'非球面 · 可调曲面形状 · 会聚'},
  {id:'aspheric-concave-lens',name:'平凹非球面透镜',category:'lens',lensGroup:'aspheric',kind:'aspheric-concave-lens',hint:'非球面 · 可调曲面形状 · 发散'},
  {id:'plano-convex-cylinder-lens',name:'平凸柱面透镜',category:'lens',lensGroup:'cylindrical',kind:'plano-convex-cylinder-lens',hint:'实体柱面 · 单方向会聚成线'},
  {id:'plano-concave-cylinder-lens',name:'平凹柱面透镜',category:'lens',lensGroup:'cylindrical',kind:'plano-concave-cylinder-lens',hint:'实体柱面 · 单方向发散'},
  {id:'positive-lens',name:'理想会聚薄透镜',category:'lens',lensGroup:'ideal',kind:'lens',hint:'教学理想模型 · 将平行光汇聚',defaults:{focalLengthMm:100}},
  {id:'negative-lens',name:'理想发散薄透镜',category:'lens',lensGroup:'ideal',kind:'lens',hint:'教学理想模型 · 让光束向外发散',defaults:{focalLengthMm:-100}},
  {id:'cylindrical-lens',name:'理想柱面薄透镜',category:'lens',lensGroup:'ideal',kind:'cylindrical-lens',hint:'教学理想模型 · 单方向聚焦 · 转动聚焦方向'},
  {id:'mirror',name:'平面反射镜',category:'reflection',kind:'mirror',hint:'改变光的传播方向',defaults:{yawDeg:-45}},
  {id:'splitter',name:'分光镜',category:'reflection',kind:'splitter',hint:'透射与反射两条光路',defaults:{yawDeg:-45,transmission:.5}},
  {id:'polarizing-splitter',name:'偏振分光镜',category:'reflection',kind:'polarizing-splitter',hint:'偏振 PBS · p透射 / s反射',defaults:{yawDeg:-45,pTransmission:1,sTransmission:0}},
  {id:'right-prism',name:'直角棱镜',category:'prism',kind:'right-prism',hint:'实体折射 · 全反射折转'},
  {id:'dispersion-prism',name:'三棱镜',category:'prism',kind:'dispersion-prism',hint:'折射与波长色散',defaults:{yawDeg:-20}},
  {id:'nd-filter',name:'中性滤光片',category:'filter',kind:'filter',hint:'调整光束透过率',defaults:{transmission:.5}},
  {id:'polarizer',name:'偏振片',category:'polarization',kind:'polarizer',hint:'转动透光轴 · 比较透射功率',defaults:{transmission:1}},
  {id:'half-wave-plate',name:'半波片',category:'polarization',kind:'half-wave-plate',hint:'偏振控制 HWP · 旋转线偏振',defaults:{transmission:1}},
  {id:'quarter-wave-plate',name:'四分之一波片',category:'polarization',kind:'quarter-wave-plate',hint:'偏振控制 QWP · 线偏振与圆偏振转换',defaults:{transmission:1,rollDeg:45}},
  {id:'iris',name:'可调光阑',category:'aperture',kind:'aperture',hint:'限制光束通过范围',defaults:{diameterMm:8}},
  {id:'slit',name:'狭缝',category:'aperture',kind:'slit',hint:'矩形截光 · 单狭缝远场条纹'},
  {id:'amplitude-grating',name:'一维透射振幅光栅',category:'diffraction',kind:'amplitude-grating',hint:'周期透光条纹 · 多级衍射 · 屏上光强'},
  {id:'screen',name:'观察屏',category:'detector',kind:'screen',hint:'查看光线落点',defaults:{diameterMm:60}},
  {id:'power-meter',name:'功率计',category:'detector',kind:'power-meter',hint:'测量收集功率 · 量程提示',defaults:{diameterMm:20}},
  {id:'mount',name:'器件支架',category:'mount',hint:'在光路渲染中自动显示'},
  {id:'table',name:'光学平台',category:'mount',hint:'在光路渲染中自动显示'},
];
export function makeSpatialElement(kind: SpatialKind, position: Vec3 = [250,60,0], defaults: Partial<SpatialElement> = {}): SpatialElement {
  return {objectMode:'finite',angularHeightDeg:.6,incidentAngleDeg:0,objectPattern:'F',objectHeightMm:10,objectWidthMm:6,sensorWidthMm:8.8,sensorHeightMm:6.6,adapterMagnification:1,nearDistanceMm:250,fieldNumberMm:18,id:crypto.randomUUID(),name:KIND_NAMES[kind],kind,position,yawDeg:kind==='polarizing-splitter'?-45:0,pitchDeg:0,diameterMm:isPhysicalLens(kind)?25:40,
    focalLengthMm:100,beamRadiusMm:4,wavelengthNm:532,transmission:['polarizer','half-wave-plate','quarter-wave-plate','amplitude-grating'].includes(kind)?1:.5,beamModel:'parallel',powerMw:10,divergenceMrad:0,rayCount:9,
    gratingPeriodUm:10,gratingSlitUm:5,gratingWidthMm:1,gratingHeightMm:20,gratingProfile:'binary',gratingModulation:1,slitMode:'pass',waistOffsetMm:0,probeOffsetMm:0,
    rollDeg:kind==='quarter-wave-plate'?45:0,polarization:'linear',polarizationDeg:0,glass:'bk7',refractiveIndex:1.5168,abbeNumber:64.17,apexAngleDeg:60,prismHeightMm:40,slitWidthMm:.1,slitHeightMm:20,meterRangeMw:100,designWavelengthNm:532,pTransmission:1,sTransmission:0,frontRadiusMm:defaultLensRadii(kind)[0],backRadiusMm:defaultLensRadii(kind)[1],centerThicknessMm:5,clearApertureMm:defaults.diameterMm??(isPhysicalLens(kind)?25:40),clearWidthMm:defaults.cylinderWidthMm??25,clearHeightMm:defaults.cylinderHeightMm??25,conicConstant:-1,asphericA4:0,asphericA6:0,cylinderWidthMm:25,cylinderHeightMm:25,...defaults};
}
export function sourceDivergenceMrad(element:SpatialElement):number {
  return element.beamModel==='gaussian'?element.wavelengthNm*1e-3/(Math.PI*element.beamRadiusMm):element.divergenceMrad;
}
export function fromLegacy(input: Experiment): SpatialExperiment {
  const original = parseExperiment(input);
  return {schemaVersion:2,name:original.name,elements:original.elements.map(e=>makeSpatialElement(e.kind,[e.positionMm,60,0],{
    id:e.id,name:e.name,
    ...(e.kind==='laser'?{wavelengthNm:e.wavelengthNm,beamRadiusMm:e.waistMm,beamModel:'gaussian' as const}:e.kind==='lens'?{focalLengthMm:e.focalLengthMm,diameterMm:e.diameterMm}:{diameterMm:e.sizeMm}),
  }))};
}
// The existing assistant may operate only on an exactly compatible straight optical rail.
export function toLegacy(input: SpatialExperiment): Experiment | null {
  if(input.elements.filter(e=>e.kind==='laser').length!==1 || input.elements.some(e=>!['laser','lens','screen'].includes(e.kind)||e.kind==='laser'&&(e.beamModel!=='gaussian'||e.waistOffsetMm!==0)||e.position[1]!==60||e.position[2]!==0||e.yawDeg!==0||e.pitchDeg!==0||e.position[0]<0||e.position[0]>600||e.diameterMm>100))return null;
  try{return parseExperiment({schemaVersion:1,name:input.name,railLengthMm:600,elements:input.elements.map(e=>({id:e.id,name:e.name,kind:e.kind,positionMm:e.position[0],
    ...(e.kind==='laser'?{wavelengthNm:e.wavelengthNm,waistMm:e.beamRadiusMm}:e.kind==='lens'?{focalLengthMm:e.focalLengthMm,diameterMm:e.diameterMm}:{sizeMm:e.diameterMm}),
  }))});}catch{return null;}
}
const record = (v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const number = (v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const text = (v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const vector = (v:unknown):v is Vec3=>Array.isArray(v)&&v.length===3&&v.every(x=>number(x,-1000,1000));
export function parseSpatial(value:unknown):SpatialExperiment {
  if(!record(value)||value.schemaVersion!==2||!text(value.name,80)||!Array.isArray(value.elements)||value.elements.length>50)throw new Error('装置文件格式无效。');
  const ids=new Set<string>();let lasers=0;
  const elements=value.elements.map((e):SpatialElement=>{
    if(!record(e)||!text(e.id,100)||ids.has(e.id)||!text(e.name,40)||typeof e.kind!=='string'||!Object.hasOwn(KIND_NAMES,e.kind)||!vector(e.position))throw new Error('器件类型、名称或位置无效。');
    ids.add(e.id);if(e.kind==='laser'&&++lasers>3)throw new Error('最多支持三个光源。');
    for(const [key,min,max] of [['yawDeg',-180,180],['pitchDeg',-90,90],['diameterMm',1,200],['focalLengthMm',-5000,5000],['beamRadiusMm',.01,20],['wavelengthNm',380,1100],['transmission',0,1]] as const){
      if(!number(e[key],min,max))throw new Error('器件参数超出支持范围。');
    }
    if(['lens','cylindrical-lens'].includes(e.kind)&&Math.abs(e.focalLengthMm as number)<1)throw new Error('透镜焦距不能为零。');
    if(e.beamModel!==undefined&&!['parallel','gaussian'].includes(e.beamModel as string))throw new Error('光束类型无效。');
    for(const [key,min,max] of [['powerMw',0,1000],['divergenceMrad',0,100],['rayCount',1,201]] as const){
      if(e[key]!==undefined&&!number(e[key],min,max))throw new Error('光源参数超出支持范围。');
    }
    if(e.rayCount!==undefined&&!Number.isInteger(e.rayCount))throw new Error('光线数量必须是整数。');
    for(const key of ['clearApertureMm','clearWidthMm','clearHeightMm'] as const){if(e[key]!==undefined&&!number(e[key],.1,200))throw new Error('有效通光尺寸超出支持范围。');}
    for(const [key,min,max] of [['conicConstant',-10,10],['asphericA4',-.001,.001],['asphericA6',-.00001,.00001],['cylinderWidthMm',1,200],['cylinderHeightMm',1,200]] as const){if(e[key]!==undefined&&!number(e[key],min,max))throw new Error('曲面或柱面尺寸参数超出支持范围。');}
    for(const [key,min,max] of [['frontRadiusMm',.5,5000],['backRadiusMm',.5,5000],['centerThicknessMm',.1,200]] as const){if(e[key]!==undefined&&!number(e[key],min,max))throw new Error('实体透镜参数超出支持范围。');}
    for(const [key,min,max] of [['pTransmission',0,1],['sTransmission',0,1],['designWavelengthNm',380,1100],['rollDeg',-180,180],['polarizationDeg',-180,180],['refractiveIndex',1,2.5],['abbeNumber',10,1000],['apexAngleDeg',20,100],['prismHeightMm',1,200],['slitWidthMm',.001,20],['slitHeightMm',.01,200],['meterRangeMw',.001,3000]] as const){if(e[key]!==undefined&&!number(e[key],min,max))throw new Error('器材参数超出支持范围。');}
    if(e.gratingProfile!==undefined&&!['binary','sinusoidal'].includes(e.gratingProfile as string)||e.slitMode!==undefined&&!['pass','stop'].includes(e.slitMode as string))throw new Error('条纹或滤波类型无效。');
    for(const [key,min,max] of [['waistOffsetMm',-2000,2000],['probeOffsetMm',-100,100],['gratingModulation',0,1],['gratingPeriodUm',1000/1200,e.gratingProfile==='sinusoidal'?400:50],['gratingSlitUm',.01,50],['gratingWidthMm',.01,50],['gratingHeightMm',.01,200]] as const){if(e[key]!==undefined&&!number(e[key],min,max))throw new Error('光栅或观察参数超出支持范围。');}
    if(e.polarization!==undefined&&!['linear','unpolarized'].includes(e.polarization as string)||e.glass!==undefined&&!['bk7','custom'].includes(e.glass as string))throw new Error('偏振状态或棱镜材料无效。');
    if(e.objectMode==='distant'&&e.objectPattern!==undefined&&e.objectPattern!=='F')throw new Error('远处样品目前使用 F 图案。');
    if(e.objectMode!==undefined&&!['finite','distant'].includes(e.objectMode as string))throw new Error('物体距离类型无效。');
    if(e.angularHeightDeg!==undefined&&!number(e.angularHeightDeg,.01,3)||e.incidentAngleDeg!==undefined&&!number(e.incidentAngleDeg,-3,3))throw new Error('远处样品角度超出范围。');
    if(e.objectPattern!==undefined&&!['F','arrow'].includes(e.objectPattern as string))throw new Error('物体图案无效。');
    for(const [key,min,max] of [['objectHeightMm',.001,200],['objectWidthMm',.001,200],['sensorWidthMm',.1,200],['sensorHeightMm',.1,200],['adapterMagnification',.1,10],['nearDistanceMm',100,1000],['fieldNumberMm',1,100]] as const){if(e[key]!==undefined&&!number(e[key],min,max))throw new Error('物体或观察参数超出范围。');}
    const parsed:SpatialElement={objectMode:(e.objectMode??'finite') as 'finite'|'distant',angularHeightDeg:(e.angularHeightDeg??.6) as number,incidentAngleDeg:(e.incidentAngleDeg??0) as number,objectPattern:(e.objectPattern??'F') as 'F'|'arrow',objectHeightMm:(e.objectHeightMm??10) as number,objectWidthMm:(e.objectWidthMm??6) as number,sensorWidthMm:(e.sensorWidthMm??8.8) as number,sensorHeightMm:(e.sensorHeightMm??6.6) as number,adapterMagnification:(e.adapterMagnification??1) as number,nearDistanceMm:(e.nearDistanceMm??250) as number,fieldNumberMm:(e.fieldNumberMm??18) as number,id:e.id,name:e.name,kind:e.kind as SpatialKind,position:[...e.position],yawDeg:e.yawDeg as number,pitchDeg:e.pitchDeg as number,
      diameterMm:e.diameterMm as number,focalLengthMm:e.focalLengthMm as number,beamRadiusMm:e.beamRadiusMm as number,wavelengthNm:e.wavelengthNm as number,transmission:e.transmission as number,beamModel:(e.beamModel??'parallel') as 'parallel'|'gaussian',powerMw:(e.powerMw??10) as number,divergenceMrad:(e.divergenceMrad??0) as number,rayCount:(e.rayCount??9) as number,
      gratingPeriodUm:(e.gratingPeriodUm??10) as number,gratingSlitUm:(e.gratingSlitUm??5) as number,gratingWidthMm:(e.gratingWidthMm??1) as number,gratingHeightMm:(e.gratingHeightMm??20) as number,gratingProfile:(e.gratingProfile??'binary') as 'binary'|'sinusoidal',gratingModulation:(e.gratingModulation??1) as number,slitMode:(e.slitMode??'pass') as 'pass'|'stop',waistOffsetMm:(e.waistOffsetMm??0) as number,probeOffsetMm:(e.probeOffsetMm??0) as number,
      rollDeg:(e.rollDeg??0) as number,polarization:(e.polarization??'linear') as 'linear'|'unpolarized',polarizationDeg:(e.polarizationDeg??0) as number,glass:(e.glass??'bk7') as 'bk7'|'custom',refractiveIndex:(e.refractiveIndex??1.5168) as number,abbeNumber:(e.abbeNumber??64.17) as number,apexAngleDeg:(e.apexAngleDeg??60) as number,prismHeightMm:(e.prismHeightMm??40) as number,slitWidthMm:(e.slitWidthMm??.1) as number,slitHeightMm:(e.slitHeightMm??20) as number,meterRangeMw:(e.meterRangeMw??100) as number,designWavelengthNm:(e.designWavelengthNm??532) as number,pTransmission:(e.pTransmission??1) as number,sTransmission:(e.sTransmission??0) as number,frontRadiusMm:(e.frontRadiusMm??defaultLensRadii(e.kind)[0]) as number,backRadiusMm:(e.backRadiusMm??defaultLensRadii(e.kind)[1]) as number,centerThicknessMm:(e.centerThicknessMm??5) as number,clearApertureMm:(e.clearApertureMm??e.diameterMm) as number,clearWidthMm:(e.clearWidthMm??e.cylinderWidthMm??25) as number,clearHeightMm:(e.clearHeightMm??e.cylinderHeightMm??25) as number,conicConstant:(e.conicConstant??-1) as number,asphericA4:(e.asphericA4??0) as number,asphericA6:(e.asphericA6??0) as number,cylinderWidthMm:(e.cylinderWidthMm??25) as number,cylinderHeightMm:(e.cylinderHeightMm??25) as number};
    validateGrating(parsed);validatePhysicalLens(parsed);return parsed;
  });
  let presentation:MicroscopePresentation|undefined;
  if(value.presentation!=null){
    const p=value.presentation;
    if(!record(p)||p.kind!=='microscope'||!['objectId','objectiveId','relayId','observerId'].every(key=>text(p[key],100)))throw new Error('装置外观信息无效。');
    presentation={kind:'microscope',objectId:p.objectId as string,objectiveId:p.objectiveId as string,relayId:p.relayId as string,observerId:p.observerId as string};
  }
  return {schemaVersion:2,name:value.name,elements,...(presentation?{presentation}:{})};
}
export function spatialTemplate(kind:'empty'|'focus'|'fold'|'split'|'imaging'):SpatialExperiment {
  if(kind==='imaging')return {schemaVersion:2,name:'物体成像',elements:[makeSpatialElement('object',[60,60,0]),makeSpatialElement('lens',[260,60,0]),makeSpatialElement('screen',[460,60,0],{diameterMm:60})]};
  if(kind==='empty')return {schemaVersion:2,name:'未命名光路',elements:[]};
  if(kind==='focus')return {schemaVersion:2,name:'单透镜聚焦',elements:[makeSpatialElement('laser',[70,60,0],{beamModel:'gaussian'}),makeSpatialElement('lens',[280,60,0]),makeSpatialElement('screen',[380,60,0],{diameterMm:60})]};
  if(kind==='fold')return {schemaVersion:2,name:'立体折转光路',elements:[makeSpatialElement('laser',[70,60,-70]),
    makeSpatialElement('mirror',[280,60,-70],{name:'水平折转镜',yawDeg:-45}),
    makeSpatialElement('mirror',[280,60,90],{name:'向上折转镜',yawDeg:90,pitchDeg:-45}),
    makeSpatialElement('screen',[280,235,90],{pitchDeg:90,diameterMm:70})]};
  return {schemaVersion:2,name:'双路分光',elements:[makeSpatialElement('laser',[70,60,0]),makeSpatialElement('splitter',[260,60,0],{yawDeg:-45}),
    makeSpatialElement('screen',[460,60,0],{name:'透射观察屏',diameterMm:60}),makeSpatialElement('screen',[260,60,160],{name:'反射观察屏',yawDeg:90,diameterMm:60})]};
}
export function validateSpatialResult(value:unknown,revision:number,input:SpatialExperiment):SpatialResult {
  if(!record(value)||value.revision!==revision||JSON.stringify(parseSpatial(value.inputSnapshot))!==JSON.stringify(input)||typeof value.model!=='string'||!Array.isArray(value.segments)||value.segments.length>3000||!Array.isArray(value.screens)||value.screens.length>50)throw new Error('仿真结果与当前装置不一致。');
  const rayVector=(v:unknown)=>Array.isArray(v)&&v.length===3&&v.every(x=>number(x,-20000,20000));
  // A hit is on the detector surface, which may extend past its centre's placement limits.
  const hitVector=(v:unknown)=>Array.isArray(v)&&v.length===3&&v.every(x=>number(x,-1100.000001,1100.000001));
  if(!value.segments.every(s=>record(s)&&rayVector(s.start)&&rayVector(s.end)&&number(s.power,0,1)&&number(s.powerMw,0,3000)&&typeof s.sourceId==='string'&&typeof s.chief==='boolean'&&(s.hitId===null||typeof s.hitId==='string')))throw new Error('光线数据无效。');
  if(!Array.isArray(value.beams)||value.beams.length>3000||!value.beams.every(b=>record(b)&&rayVector(b.start)&&rayVector(b.end)&&typeof b.sourceId==='string'&&number(b.powerMw,0,3000)&&Array.isArray(b.radiiMm)&&b.radiiMm.length===33&&b.radiiMm.every(r=>number(r,0,1000000))))throw new Error('高斯光束数据无效。');
  if(!value.screens.every(s=>record(s)&&typeof s.elementId==='string'&&typeof s.name==='string'&&number(s.hits,0,3000)&&number(s.sampledPowerFraction,0,1.000001)&&number(s.sampledPowerMw,0,3000.000001)&&(s.centroid===null||hitVector(s.centroid))&&(s.footprintRadiusMm===null||number(s.footprintRadiusMm,0,500.000001))&&(s.gaussianRadiusMm===null||number(s.gaussianRadiusMm,0,1000000))))throw new Error('观察屏数据无效。');
  for(const s of value.screens as Record<string,unknown>[]){
    const pol=s.polarizationStokes;
    if(pol!==undefined&&pol!==null&&(!record(pol)||!['s1','s2','s3'].every(k=>number(pol[k],-1.000001,1.000001))||['s1','s2','s3'].reduce((sum,k)=>sum+(pol[k] as number)**2,0)>1.00001||s.hits===0))throw new Error('偏振读数无效。');
    for(const key of ['sampledRadiusUMm','sampledRadiusVMm'])if(s[key]!==undefined&&s[key]!==null&&!number(s[key],0,500.000001))throw new Error('屏上方向半径无效。');
    const detector=input.elements.find(e=>e.id===s.elementId);
    if(!detector||!['screen','power-meter'].includes(detector.kind))throw new Error('探测器与装置不一致。');
    if(detector.kind==='power-meter'&&(s.detectorKind!=='power-meter'||typeof s.overRange!=='boolean'||s.overRange!==((s.sampledPowerMw as number)>detector.meterRangeMw+1e-8)||(s.overRange?s.readingMw!==null:!number(s.readingMw,0,3000)||Math.abs((s.readingMw as number)-(s.sampledPowerMw as number))>1e-7)))throw new Error('功率计读数无效。');
  }
  if(value.diffraction!==undefined){
    if(!Array.isArray(value.diffraction)||value.diffraction.length>150)throw new Error('衍射数据无效。');
    for(const p of value.diffraction){
      if(!record(p)||!input.elements.some(e=>e.id===p.screenId&&e.kind==='screen')||!input.elements.some(e=>e.id===p.sourceId&&e.kind==='laser')||!rayVector(p.center)||!rayVector(p.axis)||Math.abs(Math.hypot(...p.axis as number[])-1)>1e-7||!number(p.distanceMm,0,4000)||!Array.isArray(p.points)||typeof p.model!=='string')throw new Error('衍射剖面无效。');
      const grating=p.kind==='amplitude-grating'?input.elements.find(e=>e.id===p.gratingId&&e.kind==='amplitude-grating'):null;
      if(grating){if(p.periodCount!==Math.max(1,Math.floor(grating.gratingWidthMm/(grating.gratingPeriodUm*.001)+1e-9))||p.points.length<401||p.points.length>12001)throw new Error('光栅剖面无效。');}
      else if(p.kind==='amplitude-grating'||!input.elements.some(e=>e.id===p.slitId&&e.kind==='slit')||!number(p.firstMinimumMm,0,1000000)||!number(p.centralMaximumWidthMm,0,2000000)||Math.abs(p.centralMaximumWidthMm-2*p.firstMinimumMm)>1e-7||p.points.length!==401)throw new Error('狭缝剖面无效。');
      let previous=-Infinity;
      for(const point of p.points){if(!record(point)||!number(point.xMm,-2000,2000)||point.xMm<=previous||!number(point.intensity,0,grating?1000000:1.000001))throw new Error('衍射光强无效。');previous=point.xMm;}
    }
  }
  if(value.gratingOrders!==undefined){
    if(!Array.isArray(value.gratingOrders)||value.gratingOrders.length>150)throw new Error('光栅级次无效。');
    const seen=new Set<string>();
    for(const entry of value.gratingOrders){
      if(!record(entry)||!rayVector(entry.incident)||Math.abs(Math.hypot(...entry.incident as number[])-1)>1e-7||!Array.isArray(entry.orders))throw new Error('光栅入射方向无效。');
      const grating=input.elements.find(e=>e.id===entry.gratingId&&e.kind==='amplitude-grating'),source=input.elements.find(e=>e.id===entry.sourceId&&e.kind==='laser'),key=String(entry.gratingId)+':'+String(entry.sourceId);
      if(!grating||!source||seen.has(key))throw new Error('光栅级次与装置不一致。');seen.add(key);
      const orders=entry.orders;
      const expected=gratingOrderDirections(grating,entry.incident as Vec3,source.wavelengthNm);
      if(expected.length!==orders.length||expected.some((order,i)=>{const actual=orders[i];return !record(actual)||actual.m!==order.m||!rayVector(actual.direction)||!number(actual.efficiency,0,1)||Math.abs(actual.efficiency-order.efficiency)>1e-9||!number(actual.angleDeg,-90,90)||Math.abs(actual.angleDeg-order.angleDeg)>1e-7||order.direction.some((v,j)=>Math.abs(v-(actual.direction as number[])[j])>1e-7);}))throw new Error('光栅级次计算不一致。');
    }
  }
  for(const key of ['warnings','assumptions','chiefHitIds'])if(!Array.isArray(value[key])||!(value[key] as unknown[]).every(x=>typeof x==='string'))throw new Error('计算说明无效。');
  const expectedFourF=spatialFourFParameters(input),wave=value.fourF;
  if(expectedFourF){
    if(!record(wave)||!record(wave.parameters)||Object.entries(expectedFourF).some(([key,v])=>!number((wave.parameters as Record<string,unknown>)[key],-10000,10000)||Math.abs(((wave.parameters as Record<string,unknown>)[key] as number)-v)>1e-7)||wave.screenId!==input.elements.find(e=>e.kind==='screen')?.id||wave.sourceId!==input.elements.find(e=>e.kind==='laser')?.id||wave.gratingId!==input.elements.find(e=>e.kind==='amplitude-grating')?.id||wave.filterId!==(input.elements.find(e=>e.kind==='slit')?.id??null)||!number(wave.transmission,0,1)||!number(wave.pointIntensity,0,2.250001)||!['inputPowerMw','outputPowerMw','capturedPowerMw'].every(k=>number(wave[k],0,1000.000001))||(wave.capturedPowerMw as number)>(wave.outputPowerMw as number)+1e-6||Math.abs((wave.outputPowerMw as number)-(wave.inputPowerMw as number)*(wave.transmission as number))>1e-6||!Array.isArray(wave.points)||wave.points.length<801||wave.points.length>12001)throw new Error('4f 波动结果与当前器件不一致。');
    let previous=-Infinity;
    for(const point of wave.points){if(!record(point)||!number(point.xMm,-100,100)||point.xMm<=previous||!number(point.intensity,0,2.250001))throw new Error('4f 输出光强无效。');previous=point.xMm;}
  }else if(wave!=null)throw new Error('当前装置不满足4f波动计算条件。');
  const expectedFourier=spatialFourierParameters(input),spectrum=value.fourier;
  if(expectedFourier){
    if(!record(spectrum)||!record(spectrum.parameters)||Object.entries(expectedFourier).some(([key,v])=>!number((spectrum.parameters as Record<string,unknown>)[key],-10000,10000)||Math.abs(((spectrum.parameters as Record<string,unknown>)[key] as number)-v)>1e-7)||spectrum.screenId!==input.elements.find(e=>e.kind==='screen')?.id||spectrum.sourceId!==input.elements.find(e=>e.kind==='laser')?.id||spectrum.gratingId!==input.elements.find(e=>e.kind==='amplitude-grating')?.id||!number(spectrum.pointIntensity,0,1)||!number(spectrum.spatialFrequency,0,100)||!number(spectrum.orderPositionUm,0,3000)||!number(spectrum.spotRadiusUm,0,200)||!number(spectrum.inputPowerMw,0,1000.000001)||!number(spectrum.capturedPowerMw,0,1000.000001)||(spectrum.capturedPowerMw as number)>(spectrum.inputPowerMw as number)+1e-6||!Array.isArray(spectrum.points)||spectrum.points.length<801||spectrum.points.length>12001)throw new Error('傅里叶频谱与当前器件不一致。');
    const scale=expectedFourier.wavelengthNm*1e-6*expectedFourier.focalLengthMm;
    if(Math.abs((spectrum.spatialFrequency as number)-1/expectedFourier.periodMm)>1e-7||Math.abs((spectrum.orderPositionUm as number)-scale/expectedFourier.periodMm*1000)>1e-7||Math.abs((spectrum.spotRadiusUm as number)-scale/(Math.PI*expectedFourier.waistMm)*1000)>1e-7)throw new Error('傅里叶频谱位置或宽度无效。');
    let previous=-Infinity;for(const point of spectrum.points){if(!record(point)||!number(point.xMm,-100,100)||point.xMm<=previous||!number(point.intensity,0,1))throw new Error('傅里叶频谱光强无效。');previous=point.xMm;}
  }else if(spectrum!=null)throw new Error('当前装置不满足前后焦面傅里叶计算条件。');
  const objects=input.elements.filter(e=>e.kind==='object').map(e=>e.id);
  if(objects.length||value.imaging!==undefined)validateImaging(value.imaging,objects,input.elements.map(e=>e.id));
  return value as unknown as SpatialResult;
}

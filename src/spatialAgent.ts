import { parseSpatial, validateSpatialResult, type SpatialExperiment, type SpatialResult } from './builderModel';
import { isPhysicalLens, physicalFocalLengths } from './physicalLensGeometry';
import {resizeLens} from './lensPresets';

export const SPATIAL_CHAT_KEY = 'optics-spatial-agent-chat-v1';
export interface SpatialChatMessage {role:'user'|'assistant';content:string}
export interface AgentStep {name:string;status:'ok'|'error';summary:string}
export interface GoalCheck {criterion:{label:string;metric:string;elementId:string;otherId?:string|null;operator:'ge'|'le'|'eq';value:number;tolerance:number;radiusModel:'gaussian'|'sampled';comparisonId?:string|null;measurement?:'screen_hits'|'screen_power_mw'|'screen_radius_mm'|'meter_reading_mw'|'diffraction_width_mm'|'diffraction_first_minimum_mm'};actual:number|null;passed:boolean}
export interface SpatialComparison {comparisonId:string;inputSnapshot:SpatialExperiment;elementId:string;field:string;rows:{value:number;screens:SpatialResult['screens'];diffraction?:SpatialResult['diffraction'];fourF?:SpatialResult['fourF'];fourier?:SpatialResult['fourier'];warnings:string[];error:string|null}[]}
export interface SpatialAgentReply {
  requestId:string;inputSnapshot:SpatialExperiment;experiment:SpatialExperiment;changed:boolean;applyAllowed:boolean;
  answer:string;trace:AgentStep[];checks:GoalCheck[];comparisons:SpatialComparison[];evidence:SpatialResult|null;
}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const comparisonFields=['x','y','z','yawDeg','pitchDeg','diameterMm','focalLengthMm','beamRadiusMm','wavelengthNm','transmission','powerMw','divergenceMrad','rayCount','rollDeg','polarizationDeg','refractiveIndex','abbeNumber','apexAngleDeg','prismHeightMm','slitWidthMm','slitHeightMm','meterRangeMw','designWavelengthNm','pTransmission','sTransmission','frontRadiusMm','backRadiusMm','centerThicknessMm','conicConstant','asphericA4','asphericA6','cylinderWidthMm','cylinderHeightMm','clearApertureMm','clearWidthMm','clearHeightMm','gratingPeriodUm','gratingSlitUm','gratingWidthMm','gratingHeightMm','gratingModulation','waistOffsetMm','probeOffsetMm'];
export const COMPARISON_LABELS:Record<string,string>={x:'X位置（mm）',y:'Y位置（mm）',z:'Z位置（mm）',yawDeg:'水平转角（°）',pitchDeg:'俯仰角（°）',diameterMm:'口径（mm）',focalLengthMm:'焦距（mm）',beamRadiusMm:'输入半径（mm）',wavelengthNm:'波长（nm）',transmission:'透过率',powerMw:'发射功率（mW）',divergenceMrad:'发散半角（mrad）',rayCount:'光线数',rollDeg:'轴向转角（°）',polarizationDeg:'偏振角（°）',refractiveIndex:'参考折射率',abbeNumber:'阿贝数',apexAngleDeg:'棱镜顶角（°）',prismHeightMm:'棱镜厚度（mm）',slitWidthMm:'狭缝宽度（mm）',slitHeightMm:'狭缝高度（mm）',meterRangeMw:'功率计量程（mW）',designWavelengthNm:'设计波长（nm）',pTransmission:'p偏振透过率',sTransmission:'s偏振透过率',frontRadiusMm:'前表面曲率半径（mm）',backRadiusMm:'后表面曲率半径（mm）',centerThicknessMm:'中心厚度（mm）',conicConstant:'圆锥常数 k',asphericA4:'四阶系数 A4（mm⁻³）',asphericA6:'六阶系数 A6（mm⁻⁵）',cylinderWidthMm:'柱面宽度（mm）',cylinderHeightMm:'柱面高度（mm）',clearApertureMm:'有效通光口径（mm）',clearWidthMm:'有效通光宽度（mm）',clearHeightMm:'有效通光高度（mm）',gratingPeriodUm:'光栅周期 d（μm）',gratingSlitUm:'透光条纹宽度 a（μm）',gratingWidthMm:'光栅通光宽度 W（mm）',gratingHeightMm:'光栅通光高度 H（mm）',gratingModulation:'调制度 m',waistOffsetMm:'束腰距光源（mm）',probeOffsetMm:'屏上取样点位置（mm）'};
function validateComparison(v:unknown):SpatialComparison {
  if(!record(v)||typeof v.comparisonId!=='string'||!/^comparison-[1-3]$/.test(v.comparisonId)||typeof v.elementId!=='string'||typeof v.field!=='string'||!comparisonFields.includes(v.field)||!Array.isArray(v.rows)||v.rows.length<3||v.rows.length>21)throw new Error('参数比较记录无效。');
  const input=parseSpatial(v.inputSnapshot),element=input.elements.find(e=>e.id===v.elementId);
  if(!element)throw new Error('比较器件不存在。');
  let previous=-Infinity;
  const rows=v.rows.map(row=>{
    if(!record(row)||!finite(row.value)||row.value<=previous||!(row.error===null||typeof row.error==='string')||!Array.isArray(row.screens)||!Array.isArray(row.warnings)||!row.warnings.every(w=>typeof w==='string'))throw new Error('参数比较数据无效。');
    previous=row.value;
    const candidate=structuredClone(input),target=candidate.elements.find(e=>e.id===element.id)!;
    if(['x','y','z'].includes(v.field as string))target.position[{x:0,y:1,z:2}[v.field as 'x'|'y'|'z']]=row.value;
    else {const patch={[v.field as string]:row.value};Object.assign(target,isPhysicalLens(target.kind)?resizeLens(target,patch):patch);}
    if(row.error!==null){if(row.screens.length)throw new Error('失败的比较点不应包含读数。');}
    else {const valid=parseSpatial(candidate);validateSpatialResult({revision:0,inputSnapshot:valid,model:'comparison',segments:[],beams:[],screens:row.screens,diffraction:row.diffraction??[],fourF:row.fourF,fourier:row.fourier,warnings:row.warnings,assumptions:[],chiefHitIds:[]},0,valid);if(row.screens.length!==valid.elements.filter(e=>['screen','power-meter'].includes(e.kind)).length||row.screens.some(s=>!record(s)||!valid.elements.some(e=>['screen','power-meter'].includes(e.kind)&&e.id===s.elementId)))throw new Error('比较探测器与装置不一致。');}
    return row as unknown as SpatialComparison['rows'][number];
  });
  return {comparisonId:v.comparisonId,inputSnapshot:input,elementId:element.id,field:v.field,rows};
}
export function validateStep(v:unknown):AgentStep {
  if(!record(v)||typeof v.name!=='string'||v.name.length>80||!['ok','error'].includes(v.status as string)||typeof v.summary!=='string'||v.summary.length>300)throw new Error('AI进度数据无效。');
  return v as unknown as AgentStep;
}
export function validateSpatialAgentReply(v:unknown,id:string,input:SpatialExperiment):SpatialAgentReply {
  if(!record(v)||v.requestId!==id||typeof v.answer!=='string'||!v.answer.trim()||v.answer.length>12000||typeof v.changed!=='boolean'||typeof v.applyAllowed!=='boolean')throw new Error('AI未返回完整方案。');
  const snapshot=parseSpatial(v.inputSnapshot), experiment=parseSpatial(v.experiment);
  if(JSON.stringify(snapshot)!==JSON.stringify(input)||v.changed!==(JSON.stringify(experiment)!==JSON.stringify(input)))throw new Error('AI方案与本轮装置不一致。');
  if(!Array.isArray(v.trace)||v.trace.length>48||!Array.isArray(v.checks)||v.checks.length>20)throw new Error('AI核对记录无效。');
  const steps=v.trace.map(validateStep);
  const rawComparisons=v.comparisons??[];
  if(!Array.isArray(rawComparisons)||rawComparisons.length>3)throw new Error('参数比较记录无效。');
  const comparisons=rawComparisons.map(validateComparison);
  if(new Set(comparisons.map(c=>c.comparisonId)).size!==comparisons.length)throw new Error('参数比较记录重复。');
  const checks=v.checks.map((c):GoalCheck=>{
    if(!record(c)||!record(c.criterion)||typeof c.criterion.label!=='string'||c.criterion.label.length>100||typeof c.criterion.elementId!=='string'||!['image_focused','image_defocus_mm','image_magnification','image_hits','screen_hits','screen_power_mw','screen_radius_mm','screen_power_ratio','centroid_distance_mm','chief_hit','element_field','comparison_span','comparison_nondecreasing','comparison_nonincreasing','meter_reading_mw','diffraction_width_mm','diffraction_first_minimum_mm','deflection_deg','screen_radius_u_mm','screen_radius_v_mm','polarization_s1','polarization_s2','polarization_s3','lens_focal_mm','lens_back_focal_mm','four_f_transmission','four_f_intensity','four_f_power_mw','fourier_order_um','fourier_radius_um','fourier_intensity','fourier_power_mw'].includes(c.criterion.metric as string)||!['ge','le','eq'].includes(c.criterion.operator as string)||!finite(c.criterion.value)||!finite(c.criterion.tolerance)||c.criterion.tolerance<0||!['sampled','gaussian'].includes(c.criterion.radiusModel as string)||typeof c.passed!=='boolean'||!(c.actual===null||finite(c.actual)))throw new Error('实验目标核对无效。');
    if(['lens_focal_mm','lens_back_focal_mm'].includes(c.criterion.metric as string)){
      const elementId=c.criterion.elementId,lens=experiment.elements.find(e=>e.id===elementId);
      const focal=lens&&['lens','cylindrical-lens'].includes(lens.kind)?{effective:lens.focalLengthMm,back:lens.focalLengthMm}:lens&&isPhysicalLens(lens.kind)?physicalFocalLengths(lens):null;
      const actual=focal?(c.criterion.metric==='lens_focal_mm'?focal.effective:focal.back):null;
      if(actual===null?c.actual!==null:c.actual===null||Math.abs(actual-c.actual)>1e-7)throw new Error('透镜参考焦距与形状参数不一致。');
    }
    // Recheck the numeric comparison, independently of the server's status flag.
    const criterion=c.criterion as unknown as GoalCheck['criterion'];
    const {value,tolerance,operator}=criterion;
    const passed=c.actual!==null&&(operator==='ge'?c.actual>=value-tolerance:operator==='le'?c.actual<=value+tolerance:Math.abs(c.actual-value)<=tolerance+1e-8);
    if(passed!==c.passed)throw new Error('实验目标与计算结论不一致。');
    if((c.criterion.metric as string).startsWith('comparison_')){
      if(typeof c.criterion.comparisonId!=='string'||!['screen_hits','screen_power_mw','screen_radius_mm','meter_reading_mw','diffraction_width_mm','diffraction_first_minimum_mm'].includes(c.criterion.measurement as string))throw new Error('比较目标无效。');
      const comparison=comparisons.find(s=>s.comparisonId===criterion.comparisonId);
      if(c.actual!==null){
        if(!comparison)throw new Error('比较核对缺少原始数据。');
        const values=comparison.rows.map(row=>{if(row.error)return null;if(criterion.measurement?.startsWith('diffraction_')){const profiles=(row.diffraction??[]).filter(p=>'slitId' in p).filter(p=>p.screenId===criterion.elementId);return profiles.length!==1?null:criterion.measurement==='diffraction_width_mm'?profiles[0].centralMaximumWidthMm:profiles[0].firstMinimumMm;}const s=row.screens.find(s=>s.elementId===criterion.elementId);return !s?null:criterion.measurement==='screen_hits'?s.hits:criterion.measurement==='screen_power_mw'?s.sampledPowerMw:criterion.measurement==='meter_reading_mw'?s.readingMw??null:criterion.radiusModel==='gaussian'?s.gaussianRadiusMm:s.footprintRadiusMm;});
        if(values.some(x=>x===null))throw new Error('比较核对包含无效点。');
        const numbers=values as number[],actual=c.criterion.metric==='comparison_span'?Math.max(...numbers)-Math.min(...numbers):c.criterion.metric==='comparison_nonincreasing'?Number(numbers.every((n,i)=>i===0||numbers[i-1]>=n-1e-8)):Number(numbers.every((n,i)=>i===0||numbers[i-1]<=n+1e-8));
        if(Math.abs(actual-c.actual)>1e-7)throw new Error('比较结论与逐点数据不一致。');
      }
    }
    return c as unknown as GoalCheck;
  });
  const evidence=v.evidence===null?null:validateSpatialResult(v.evidence,0,experiment);
  for(const check of checks){
    const metric=check.criterion.metric;
    if(metric.startsWith('image_')){
      const observations=(evidence?.imaging??[]).filter(image=>!check.criterion.otherId||image.objectId===check.criterion.otherId).flatMap(image=>image.observations.filter(o=>o.elementId===check.criterion.elementId).map(o=>({image,o})));
      const match=observations.length===1?observations[0]:null;
      const actual=!match?null:metric==='image_focused'?Number(match.o.focused&&match.o.hits.length>0&&match.image.warnings.length===0):metric==='image_hits'?match.o.hits.length:metric==='image_defocus_mm'?match.o.defocusMm:match.o.magnification;
      if(actual===null?check.actual!==null:check.actual===null||Math.abs(actual-check.actual)>1e-7)throw new Error('成像核对与实际成像结果不一致。');
    }
    if(!['screen_radius_u_mm','screen_radius_v_mm','polarization_s1','polarization_s2','polarization_s3'].includes(metric))continue;
    const screen=evidence?.screens.find(s=>s.elementId===check.criterion.elementId);
    const measured=metric==='screen_radius_u_mm'?screen?.sampledRadiusUMm:metric==='screen_radius_v_mm'?screen?.sampledRadiusVMm:screen?.polarizationStokes?.[metric.slice(-2) as 's1'|'s2'|'s3'];
    if(measured==null?check.actual!==null:check.actual===null||Math.abs(measured-check.actual)>1e-7)throw new Error('目标核对与方向光斑或偏振计算不一致。');
  }
  if(v.changed&&v.applyAllowed&&(!evidence||checks.some(c=>!experiment.elements.some(e=>e.id===c.criterion.elementId))))throw new Error('方案缺少有效的计算结果。');
  return {requestId:id,inputSnapshot:snapshot,experiment,changed:v.changed,applyAllowed:v.applyAllowed,answer:v.answer,trace:steps,checks,comparisons,evidence};
}
export function readSpatialChat():SpatialChatMessage[] {
  try{
    const value:unknown=JSON.parse(localStorage.getItem(SPATIAL_CHAT_KEY)??'[]');
    if(!Array.isArray(value)||value.length>12||!value.every(m=>record(m)&&['user','assistant'].includes(m.role as string)&&typeof m.content==='string'&&m.content.length>0&&m.content.length<=12000))return [];
    const messages=value as SpatialChatMessage[];
    return messages.reduce((n,m)=>n+m.content.length,0)<=24000?messages:[];
  }catch{return [];}
}
export async function requestSpatialAgent(id:string,input:SpatialExperiment,message:string,history:SpatialChatMessage[],signal:AbortSignal,onStep:(step:AgentStep)=>void):Promise<SpatialAgentReply> {
  const response=await fetch('/api/spatial/agent/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:id,experiment:input,message,history}),signal});
  if(!response.ok){const body=await response.json().catch(()=>null) as {detail?:unknown}|null;throw new Error(typeof body?.detail==='string'?body.detail:'光路设计暂时不可用，请重试。');}
  if(!response.body)throw new Error('AI连接中断，请重试。');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',bytes=0,reply:SpatialAgentReply|null=null;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(value){bytes+=value.byteLength;if(bytes>8_000_000)throw new Error('AI方案数据过大。');}
      buffer+=decoder.decode(value,{stream:!done});
      const lines=buffer.split('\n');buffer=lines.pop()??'';
      for(const line of lines){
        if(!line.trim())continue;
        const event:unknown=JSON.parse(line);
        if(!record(event))throw new Error('AI返回数据无效。');
        if(event.type==='progress')onStep(validateStep(event.step));
        else if(event.type==='reply'){if(reply)throw new Error('AI返回了重复方案。');reply=validateSpatialAgentReply(event.reply,id,input);}
        else if(event.type==='error')throw new Error(typeof event.message==='string'?event.message:'本轮设计未完成。');
        else throw new Error('AI返回数据无效。');
      }
      if(done)break;
    }
    if(buffer.trim()||!reply)throw new Error('AI方案未完整接收，装置未修改。');
    return reply;
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

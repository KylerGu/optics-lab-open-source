import { parseExperiment, type Experiment } from './model';
import { experimentKey } from './simulation';
import type { FocusGoal } from './research';

export interface Tolerance {lensId: string; screenId: string; positionErrorMm: number; focalErrorPercent: number}
export interface ErrorPoint {
  positionMm: number; focalLengthMm: number; positionErrorMm: number; focalErrorPercent: number;
  radiusMm: number|null; capturedFraction: number|null; quality: 'within-model'|'reference-only'|null;
  warnings: string[]; error: string|null;
}
export interface EvaluationSummary {
  positionMm: number; focalLengthMm: number; nominal: ErrorPoint;
  counts: {total: number; withinModel: number; referenceOnly: number; invalid: number}; eligible: boolean;
  minRadiusMm: number|null; maxRadiusMm: number|null; maxRelativeIncrease: number|null; worstSample: ErrorPoint|null;
}
export interface ErrorEvaluation extends EvaluationSummary {positionOffsetsMm: number[]; focalOffsetsPercent: number[]; rows: ErrorPoint[]}
export interface StabilityStudy {
  id: string; createdAt: string; analysisVersion: string; modelVersion: string; inputSnapshot: Experiment;
  tolerance: Tolerance; mode: 'analysis'|'robust-search'; goal: FocusGoal|null; screenPositionMm: number;
  objective: string; method: string; limitations: string[]; baseline: ErrorEvaluation;
  grids: {phase:'coarse'|'refined'; positionsMm:number[]; focalsMm:number[]}[];
  candidates: (EvaluationSummary & {phase:'coarse'|'refined'})[];
  counts: {nominalCases:number; scenarioCases:number; eligibleCases:number}; nominalBest: ErrorEvaluation|null;
  recommendation: (ErrorEvaluation & {experiment:Experiment; verified:true; boundaryParameters:string[]; maxRadiusImprovement:number|null; maxRadiusImprovementPercent:number|null; maxRadiusDifferenceMm:number|null})|null;
  noRecommendationReason: string|null;
}
const record=(value: unknown):value is Record<string,unknown>=>!!value && typeof value==='object' && !Array.isArray(value);
const finite=(value:unknown):value is number=>typeof value==='number' && Number.isFinite(value);
const strings=(value:unknown):value is string[]=>Array.isArray(value) && value.every(item=>typeof item==='string');
function fail():never{throw new Error('误差分析记录未通过数据核对，请重新计算。');}
const close=(a:number,b:number)=>Math.abs(a-b)<=1e-11*Math.max(1,Math.abs(a),Math.abs(b));
const offsets=(value:number)=>value===0?[0]:Array.from({length:9},(_,i)=>-value+2*value*i/8);

export function stabilityExperiment(study:StabilityStudy,value:EvaluationSummary):Experiment {
  return parseExperiment({...study.inputSnapshot,elements:study.inputSnapshot.elements.map(item=>item.id===study.tolerance.lensId?{...item,positionMm:value.positionMm,focalLengthMm:value.focalLengthMm}:item.id===study.tolerance.screenId?{...item,positionMm:study.screenPositionMm}:item)});
}

export function validateStabilityStudy(value:unknown,snapshotKey?:string):StabilityStudy {
  if(!record(value) || typeof value.id!=='string' || !value.id || typeof value.createdAt!=='string' || !Number.isFinite(Date.parse(value.createdAt)) || value.analysisVersion!=='single-lens-error-grid/1.0' || typeof value.modelVersion!=='string' || !['analysis','robust-search'].includes(value.mode as string) || typeof value.method!=='string' || !strings(value.limitations) || !finite(value.screenPositionMm) || value.screenPositionMm<0 || value.screenPositionMm>600)fail();
  const original=parseExperiment(value.inputSnapshot), tol=value.tolerance;
  if(snapshotKey && snapshotKey!==experimentKey(original))fail();
  if(!record(tol) || typeof tol.lensId!=='string' || typeof tol.screenId!=='string' || !finite(tol.positionErrorMm) || tol.positionErrorMm<0 || tol.positionErrorMm>20 || !finite(tol.focalErrorPercent) || tol.focalErrorPercent<0 || tol.focalErrorPercent>20 || tol.positionErrorMm+tol.focalErrorPercent===0)fail();
  const lenses=original.elements.filter(item=>item.kind==='lens'),screen=original.elements.find(item=>item.kind==='screen' && item.id===tol.screenId),source=original.elements.find(item=>item.kind==='laser');
  if(lenses.length!==1 || lenses[0].id!==tol.lensId || lenses[0].kind!=='lens' || lenses[0].focalLengthMm<1 || !screen || !source)fail();
  const expectedPositions=offsets(tol.positionErrorMm),expectedFocals=offsets(tol.focalErrorPercent),scenarioCount=expectedPositions.length*expectedFocals.length;
  function point(raw:unknown):asserts raw is ErrorPoint {
    if(!record(raw) || !['positionMm','focalLengthMm','positionErrorMm','focalErrorPercent'].every(key=>finite(raw[key])) || !strings(raw.warnings))fail();
    if(raw.error===null){if(!finite(raw.radiusMm) || raw.radiusMm<=0 || !finite(raw.capturedFraction) || raw.capturedFraction<0 || raw.capturedFraction>1 || !['within-model','reference-only'].includes(raw.quality as string) || (raw.quality==='within-model' && raw.warnings.length))fail();}
    else if(typeof raw.error!=='string' || raw.radiusMm!==null || raw.capturedFraction!==null || raw.quality!==null)fail();
  }
  function summary(raw:unknown):asserts raw is EvaluationSummary {
    if(!record(raw) || !finite(raw.positionMm) || !finite(raw.focalLengthMm) || typeof raw.eligible!=='boolean' || !record(raw.counts))fail();
    point(raw.nominal);
    if(raw.nominal.positionMm!==raw.positionMm || raw.nominal.focalLengthMm!==raw.focalLengthMm || raw.nominal.positionErrorMm!==0 || raw.nominal.focalErrorPercent!==0)fail();
    const counts=raw.counts;
    if(!['total','withinModel','referenceOnly','invalid'].every(key=>Number.isInteger(counts[key]) && (counts[key] as number)>=0) || counts.total!==scenarioCount || (counts.withinModel as number)+(counts.referenceOnly as number)+(counts.invalid as number)!==counts.total || raw.eligible!==(raw.nominal.quality==='within-model' && counts.withinModel===counts.total))fail();
    if(raw.maxRadiusMm===null){if(raw.minRadiusMm!==null || raw.worstSample!==null || raw.maxRelativeIncrease!==null || counts.invalid!==counts.total)fail();}
    else {
      if(!finite(raw.maxRadiusMm) || raw.maxRadiusMm<=0 || !finite(raw.minRadiusMm) || raw.minRadiusMm<=0 || raw.minRadiusMm>raw.maxRadiusMm)fail();
      point(raw.worstSample);
      const worst=raw.worstSample;
      if(worst.radiusMm!==raw.maxRadiusMm || !expectedPositions.some(dp=>close(dp,worst.positionErrorMm)) || !expectedFocals.some(df=>close(df,worst.focalErrorPercent)) || !close(worst.positionMm,raw.positionMm+worst.positionErrorMm) || !close(worst.focalLengthMm,raw.focalLengthMm*(1+worst.focalErrorPercent/100)))fail();
      const expected=raw.nominal.radiusMm===null?null:raw.maxRadiusMm/raw.nominal.radiusMm-1;
      if(expected===null?raw.maxRelativeIncrease!==null:!finite(raw.maxRelativeIncrease) || !close(raw.maxRelativeIncrease,expected))fail();
    }
  }
  function evaluation(raw:unknown):asserts raw is ErrorEvaluation {
    summary(raw);
    const extra=raw as unknown as Record<string,unknown>;
    if(!Array.isArray(extra.positionOffsetsMm) || !Array.isArray(extra.focalOffsetsPercent) || JSON.stringify(extra.positionOffsetsMm)!==JSON.stringify(expectedPositions) || JSON.stringify(extra.focalOffsetsPercent)!==JSON.stringify(expectedFocals) || !Array.isArray(extra.rows) || extra.rows.length!==scenarioCount)fail();
    let index=0;
    for(const df of expectedFocals)for(const dp of expectedPositions){const row=extra.rows[index++];point(row);if(row.positionErrorMm!==dp || row.focalErrorPercent!==df || !close(row.positionMm,raw.positionMm+dp) || !close(row.focalLengthMm,raw.focalLengthMm*(1+df/100)))fail();}
    const rows=extra.rows as ErrorPoint[],radii=rows.filter(row=>row.radiusMm!==null).map(row=>row.radiusMm!);
    if(raw.counts.withinModel!==rows.filter(row=>row.quality==='within-model').length || raw.counts.referenceOnly!==rows.filter(row=>row.quality==='reference-only').length || raw.counts.invalid!==rows.filter(row=>row.error!==null).length || raw.maxRadiusMm!==(radii.length?Math.max(...radii):null) || raw.minRadiusMm!==(radii.length?Math.min(...radii):null) || (raw.worstSample!==null && !rows.some(row=>JSON.stringify(row)===JSON.stringify(raw.worstSample))))fail();
  }
  evaluation(value.baseline);
  if(value.baseline.positionMm!==lenses[0].positionMm || value.baseline.focalLengthMm!==lenses[0].focalLengthMm || !Array.isArray(value.grids) || !Array.isArray(value.candidates) || !record(value.counts))fail();
  const study={...value,inputSnapshot:original} as unknown as StabilityStudy;
  if(value.mode==='analysis'){
    if(value.goal!==null || value.objective!=='evaluate_parameter_deviations' || value.screenPositionMm!==screen.positionMm || value.grids.length || value.candidates.length || value.nominalBest!==null || value.recommendation!==null || value.noRecommendationReason!==null)fail();
  }else {
    const goal=value.goal;
    if(!record(goal) || goal.lensId!==tol.lensId || goal.screenId!==tol.screenId || goal.screenPositionMm!==value.screenPositionMm || !record(goal.positionRange) || !record(goal.focalRange) || value.objective!=='minimize_sampled_max_screen_radius' || value.grids.length<1 || value.grids.length>2 || value.candidates.length!==441*value.grids.length)fail();
    for(const bounds of [goal.positionRange,goal.focalRange])if(!finite(bounds.start) || !finite(bounds.stop) || bounds.start>=bounds.stop)fail();
    if((goal.positionRange.start as number)<=source.positionMm || (goal.positionRange.stop as number)>=value.screenPositionMm || (goal.focalRange.start as number)<1 || (goal.focalRange.stop as number)>5000)fail();
    let index=0;
    for(const [i,grid] of value.grids.entries()){
      if(!record(grid) || grid.phase!==(i===0?'coarse':'refined'))fail();
      for(const [axis,bounds] of [[grid.positionsMm,goal.positionRange],[grid.focalsMm,goal.focalRange]] as const){if(!Array.isArray(axis) || axis.length!==21 || !axis.every(finite) || axis.some((x,j)=>x<(bounds.start as number) || x>(bounds.stop as number) || (j>0 && x<=axis[j-1])) || (i===0 && (axis[0]!==bounds.start || axis[20]!==bounds.stop)))fail();}
      for(const f of grid.focalsMm as number[])for(const p of grid.positionsMm as number[]){const row=value.candidates[index++],phase=row.phase;summary(row);if(row.positionMm!==p || row.focalLengthMm!==f || phase!==grid.phase)fail();}
    }
    const candidates=value.candidates as EvaluationSummary[],valid=candidates.filter(item=>item.eligible);
    for(const key of ['nominalBest','recommendation'])if(value[key]!==null){evaluation(value[key]);const best=value[key] as ErrorEvaluation;if(!best.eligible || !valid.some(item=>item.positionMm===best.positionMm && item.focalLengthMm===best.focalLengthMm && item.maxRadiusMm===best.maxRadiusMm && item.nominal.radiusMm===best.nominal.radiusMm))fail();}
    if(value.recommendation===null){if(valid.length || value.nominalBest!==null || typeof value.noRecommendationReason!=='string')fail();}
    else {
      const best=value.recommendation; if(!record(best) || best.verified!==true || !strings(best.boundaryParameters) || value.nominalBest===null || value.noRecommendationReason!==null || valid.some(item=>item.maxRadiusMm!<(best.maxRadiusMm as number)))fail();
      if(experimentKey(parseExperiment(best.experiment))!==experimentKey(stabilityExperiment(study,best as unknown as EvaluationSummary)))fail();
      if(valid.some(item=>item.nominal.radiusMm!<(value.nominalBest as ErrorEvaluation).nominal.radiusMm!))fail();
      const expected=study.baseline.eligible?1-(best.maxRadiusMm as number)/study.baseline.maxRadiusMm!:null;
      if(expected===null?best.maxRadiusImprovement!==null:!finite(best.maxRadiusImprovement) || !close(expected,best.maxRadiusImprovement))fail();
      const difference=study.baseline.eligible?study.baseline.maxRadiusMm!-(best.maxRadiusMm as number):null;
      if(expected===null?best.maxRadiusImprovementPercent!==null || best.maxRadiusDifferenceMm!==null:!finite(best.maxRadiusImprovementPercent) || !close(expected*100,best.maxRadiusImprovementPercent) || !finite(best.maxRadiusDifferenceMm) || !close(difference!,best.maxRadiusDifferenceMm))fail();
    }
  }
  if(value.counts.nominalCases!==value.candidates.length || value.counts.scenarioCases!==value.candidates.length*scenarioCount || value.counts.eligibleCases!==(value.candidates as EvaluationSummary[]).filter(item=>item.eligible).length)fail();
  return study;
}

export function studyCSV(study:StabilityStudy):string {
  const safe=(value:string)=>/^[=+\-@\t\r]/.test(value)?`'${value}`:value;
  const cell=(value:string|number)=>`"${String(value).replace(/"/g,'""')}"`;
  const rows:(string|number)[][]=[['study_id',study.id],['analysis_version',study.analysisVersion],['model_version',study.modelVersion],['mode',study.mode],['radius_definition','1/e^2 intensity radius'],['position_unit','mm'],['focal_error_unit','percent of nominal focal length'],['screen_position_mm',study.screenPositionMm],['method',safe(study.method)],['limitations',safe(study.limitations.join(' | '))],['input_snapshot_json',JSON.stringify(study.inputSnapshot)],['tolerance_json',JSON.stringify(study.tolerance)],['goal_json',JSON.stringify(study.goal)],['recommendation_json',JSON.stringify(study.recommendation)],['evaluation','position_error_mm','focal_error_percent','actual_position_mm','actual_focal_mm','screen_radius_mm','quality','warnings','error']];
  for(const [name,value] of [['baseline',study.baseline],['nominal_best',study.nominalBest],['recommendation',study.recommendation]] as const)if(value)for(const point of value.rows)rows.push([name,point.positionErrorMm,point.focalErrorPercent,point.positionMm,point.focalLengthMm,point.radiusMm??'',point.quality??'',safe(point.warnings.join(' | ')),safe(point.error??'')]);
  rows.push(['candidate_phase','nominal_position_mm','nominal_focal_mm','nominal_radius_mm','sampled_max_radius_mm','eligible','within_model_count','reference_count','invalid_count']);
  for(const row of study.candidates)rows.push([row.phase,row.positionMm,row.focalLengthMm,row.nominal.radiusMm??'',row.maxRadiusMm??'',String(row.eligible),row.counts.withinModel,row.counts.referenceOnly,row.counts.invalid]);
  return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}
export function downloadStudy(study:StabilityStudy,format:'json'|'csv') {
  const url=URL.createObjectURL(new Blob([format==='json'?JSON.stringify(study,null,2):studyCSV(study)],{type:format==='json'?'application/json':'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=`光学误差分析.${format}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

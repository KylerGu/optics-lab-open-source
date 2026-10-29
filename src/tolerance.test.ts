import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTemplate } from './model';
import { experimentKey } from './simulation';
import { studyCSV, validateStabilityStudy, stabilityExperiment, type ErrorEvaluation, type StabilityStudy } from './tolerance';

function evaluation(p:number,f:number,nominalRadius=1):ErrorEvaluation {
  const axis=Array.from({length:9},(_,i)=>-1+i/4);
  const point=(dp:number,df:number)=>({positionMm:p+dp,focalLengthMm:f*(1+df/100),positionErrorMm:dp,focalErrorPercent:df,radiusMm:nominalRadius+(Math.abs(dp)+Math.abs(df))/10,capturedFraction:1,quality:'within-model' as const,warnings:[],error:null});
  const rows=axis.flatMap(df=>axis.map(dp=>point(dp,df))),maxRadiusMm=Math.max(...rows.map(row=>row.radiusMm));
  return {positionMm:p,focalLengthMm:f,nominal:point(0,0),positionOffsetsMm:axis,focalOffsetsPercent:axis,rows,counts:{total:81,withinModel:81,referenceOnly:0,invalid:0},eligible:true,minRadiusMm:nominalRadius,maxRadiusMm,maxRelativeIncrease:maxRadiusMm/nominalRadius-1,worstSample:rows.find(row=>row.radiusMm===maxRadiusMm)!};
}
function fixture():StabilityStudy {
  const inputSnapshot=makeTemplate('focus');for(const element of inputSnapshot.elements)if(element.kind==='lens')element.focalLengthMm=120;
  const lens=inputSnapshot.elements.find(item=>item.kind==='lens')!,screen=inputSnapshot.elements.find(item=>item.kind==='screen')!;
  return {id:'fixture',createdAt:'2026-10-02T00:00:00Z',analysisVersion:'single-lens-error-grid/1.0',modelVersion:'contract-fixture',inputSnapshot,tolerance:{lensId:lens.id,screenId:screen.id,positionErrorMm:1,focalErrorPercent:1},mode:'analysis',goal:null,screenPositionMm:screen.positionMm,objective:'evaluate_parameter_deviations',method:'fixture',limitations:['fixture'],baseline:evaluation(lens.positionMm,120,2),grids:[],candidates:[],counts:{nominalCases:0,scenarioCases:0,eligibleCases:0},nominalBest:null,recommendation:null,noRecommendationReason:null};
}
function robustFixture():StabilityStudy {
  const study=fixture(),positionsMm=Array.from({length:21},(_,i)=>200+i*5),focalsMm=Array.from({length:21},(_,i)=>80+i*4);
  study.mode='robust-search';study.goal={lensId:study.tolerance.lensId,screenId:study.tolerance.screenId,screenPositionMm:350,positionRange:{start:200,stop:300},focalRange:{start:80,stop:160}};study.objective='minimize_sampled_max_screen_radius';
  study.grids=[{phase:'coarse',positionsMm,focalsMm}];
  study.candidates=focalsMm.flatMap((f,i)=>positionsMm.map((p,j)=>{const {rows,positionOffsetsMm,focalOffsetsPercent,...summary}=evaluation(p,f,1+(i+j)/10);return {...summary,phase:'coarse' as const};}));
  study.counts={nominalCases:441,scenarioCases:35721,eligibleCases:441};study.nominalBest=evaluation(200,80);
  const improvement=1-study.nominalBest.maxRadiusMm!/study.baseline.maxRadiusMm!;
  study.recommendation={...study.nominalBest,experiment:stabilityExperiment(study,study.nominalBest),verified:true,boundaryParameters:['透镜位置','焦距'],maxRadiusImprovement:improvement,maxRadiusImprovementPercent:improvement*100,maxRadiusDifferenceMm:study.baseline.maxRadiusMm!-study.nominalBest.maxRadiusMm!};
  return study;
}
test('误差记录保留毫米和焦距百分比，并拒绝旧装置快照',()=>{
  const study=fixture();assert.equal(validateStabilityStudy(study,experimentKey(study.inputSnapshot)).baseline.rows.length,81);
  assert.throws(()=>validateStabilityStudy(study,experimentKey({...study.inputSnapshot,name:'another'})));
  const csv=studyCSV(study);for(const text of ['input_snapshot_json','tolerance_json','goal_json','percent of nominal','screen_radius_mm','analysis_version','limitations'])assert.ok(csv.includes(text));
});
test('百分比换算、最大值和模型检查统计必须与实际行一致',()=>{
  let study=fixture();study.baseline.rows[0].focalLengthMm=study.baseline.focalLengthMm-1;assert.throws(()=>validateStabilityStudy(study));
  study=fixture();study.baseline.maxRadiusMm=NaN;assert.throws(()=>validateStabilityStudy(study));
  study=fixture();study.baseline.counts.withinModel=80;assert.throws(()=>validateStabilityStudy(study));
  study=fixture();study.baseline.rows.reverse();assert.throws(()=>validateStabilityStudy(study));
});
test('稳定推荐按最大采样半径核对，不能改变光源或给出更差推荐',()=>{
  let study=robustFixture();assert.equal(validateStabilityStudy(study).candidates.length,441);
  study.recommendation!.experiment.name='tampered';assert.throws(()=>validateStabilityStudy(study));
  study=robustFixture();study.candidates[3].maxRadiusMm=0.5;study.candidates[3].minRadiusMm=0.4;assert.throws(()=>validateStabilityStudy(study));
  study=robustFixture();study.recommendation!.verified=false as true;assert.throws(()=>validateStabilityStudy(study));
  study=robustFixture();study.recommendation!.maxRadiusImprovementPercent=16;assert.throws(()=>validateStabilityStudy(study));
});
test('有模型警告的分析可以查看，但不能标记为全部通过',()=>{
  const study=fixture();study.baseline.rows=study.baseline.rows.map(row=>({...row,quality:'reference-only',warnings:['截光']}));study.baseline.worstSample=study.baseline.rows[0];study.baseline.counts={total:81,withinModel:0,referenceOnly:81,invalid:0};study.baseline.eligible=false;
  assert.equal(validateStabilityStudy(study).baseline.eligible,false);
  study.baseline.eligible=true;assert.throws(()=>validateStabilityStudy(study));
});

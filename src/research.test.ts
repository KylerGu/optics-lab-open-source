import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designCSV, validateFocusDesign, type FocusDesign } from './research';
import { makeTemplate } from './model';
import { experimentKey } from './simulation';

function fixture(): FocusDesign {
  const inputSnapshot=makeTemplate('focus'), lens=inputSnapshot.elements.find(item=>item.kind==='lens')!,screen=inputSnapshot.elements.find(item=>item.kind==='screen')!;
  const positionsMm=Array.from({length:21},(_,i)=>200+i*5),focalsMm=Array.from({length:21},(_,i)=>80+i*4);
  const rows=focalsMm.flatMap((f,i)=>positionsMm.map((p,j)=>({phase:'coarse' as const,positionMm:p,focalLengthMm:f,radiusMm:1+i+j,capturedFraction:1,quality:'within-model' as const,warnings:[],error:null})));
  return {id:'fixture',createdAt:'2026-10-01T00:00:00Z',searchVersion:'single-lens-screen-grid/1.0',modelVersion:'contract-fixture',inputSnapshot,goal:{lensId:lens.id,screenId:screen.id,screenPositionMm:350,positionRange:{start:200,stop:300},focalRange:{start:80,stop:160}},objective:'minimize_screen_1e2_radius',units:{length:'mm',radius:'mm'},method:'fixture',limitations:['fixture'],grids:[{phase:'coarse',positionsMm,focalsMm}],rows,counts:{total:441,withinModel:441,referenceOnly:0,invalid:0},baseline:{...rows[0],phase:'baseline',positionMm:lens.positionMm,focalLengthMm:lens.kind==='lens'?lens.focalLengthMm:100,radiusMm:2},recommendation:{...rows[0],experiment:{...inputSnapshot,elements:inputSnapshot.elements.map(item=>item.id===lens.id?{...item,positionMm:200,focalLengthMm:80}:item.id===screen.id?{...item,positionMm:350}:item)},verified:true,boundaryParameters:['透镜位置','焦距'],improvementFraction:0.5},noRecommendationReason:null};
}

test('设计记录保留单位、约束和原参数，拒绝过期快照',()=>{
  const design=fixture();assert.equal(validateFocusDesign(design,experimentKey(design.inputSnapshot)).rows.length,441);
  assert.throws(()=>validateFocusDesign(design,experimentKey({...design.inputSnapshot,name:'new'})));
  const csv=designCSV(design);
  for(const marker of ['goal_json','input_snapshot_json','baseline_json','recommendation_json','screen_radius_mm','search_version','length_unit','1/e^2'])assert.ok(csv.includes(marker));
  assert.equal(csv.split('\r\n').length,455);
});
test('比较图的行列、非有限值和数量错误被拒绝',()=>{
  let design=fixture();design.rows.reverse();assert.throws(()=>validateFocusDesign(design));
  design=fixture();design.rows[12].radiusMm=NaN;assert.throws(()=>validateFocusDesign(design));
  design=fixture();design.counts.total=1;assert.throws(()=>validateFocusDesign(design));
});
test('推荐不能悄悄修改光源或推荐比已算组合更差的结果',()=>{
  let design=fixture();design.recommendation!.experiment.name='tampered';assert.throws(()=>validateFocusDesign(design));
  design=fixture();design.recommendation!.radiusMm=2;assert.throws(()=>validateFocusDesign(design));
  design=fixture();design.recommendation!.verified=false as true;assert.throws(()=>validateFocusDesign(design));
});
test('只有模型警告的设计可以查看和导出，但没有推荐',()=>{
  const design=fixture();design.rows=design.rows.map(row=>({...row,quality:'reference-only',warnings:['截光']}));design.counts.withinModel=0;design.counts.referenceOnly=441;design.recommendation=null;design.noRecommendationReason='模型条件不满足';
  assert.equal(validateFocusDesign(design).recommendation,null);
  design.method='=untrusted';assert.ok(designCSV(design).includes("'=untrusted"));
});

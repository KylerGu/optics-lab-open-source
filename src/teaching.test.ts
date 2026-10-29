import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import type { Experiment } from './model';
import { experimentKey, validateResult, type SimulationResult } from './simulation';
import { validateFocusDesign, type FocusDesign } from './research';
import { validateStabilityStudy, type StabilityStudy } from './tolerance';
import { capture, lessonComplete, lessonExperiment, LESSONS, newLearning, parseLearning, type LessonId } from './teaching';
import { learningReport } from './learningReport';

// Exercise the course with the same physical calculator used by the live website.
function physics(experiment:Experiment, operation='simulate'):unknown {
  const source=`import json,sys\nfrom backend.models import Experiment\nfrom backend.optics import simulate\nfrom backend.research import search_focus,FocusGoal\nfrom backend.tolerance import run_tolerance,Tolerance\ne=Experiment.model_validate(json.load(sys.stdin))\nl=next((x for x in e.elements if x.kind=='lens'),None)\ns=next(x for x in e.elements if x.kind=='screen')\nif sys.argv[1]=='design':\n r=search_focus(e,FocusGoal(lensId=l.id,screenId=s.id,screenPositionMm=350,positionRange={'start':200,'stop':300},focalRange={'start':80,'stop':160}))\nelif sys.argv[1]=='study':\n r=run_tolerance(e,Tolerance(lensId=l.id,screenId=s.id,positionErrorMm=1,focalErrorPercent=1))\nelse:\n r=simulate(e,7)\nprint(json.dumps(r,allow_nan=False))`;
  return JSON.parse(execFileSync(process.env.OPTICS_PYTHON||'python',['-X','utf8','-c',source,operation],{input:JSON.stringify(experiment),encoding:'utf8',maxBuffer:8*1024*1024}));
}
const calculate=(experiment:Experiment):SimulationResult=>validateResult(physics(experiment),7,experimentKey(experiment));
function predicted(id:LessonId) {const session=newLearning();session.lessonId=id;session.records[id].prediction=LESSONS.find(item=>item.id===id)!.options[1];return session;}

test('五节装置均可计算，预期的传播、焦距与移屏变化有真实数值支持',()=>{
  for(const lesson of LESSONS)assert.equal(calculate(lessonExperiment(lesson.id)).quality,'within-model');
  const propagation=lessonExperiment('propagation'),start=calculate(propagation);
  const moved={...propagation,elements:propagation.elements.map(item=>item.kind==='screen'?{...item,positionMm:350}:item)};
  const end=calculate(moved);assert.ok(end.screens[0].radiusMm>start.screens[0].radiusMm);
  const focus=calculate(lessonExperiment('focus')),shorter=calculate(lessonExperiment('screen'));
  assert.ok(shorter.screens[0].radiusMm>focus.screens[0].radiusMm);
  const shifted=calculate({...shorter.inputSnapshot,elements:shorter.inputSnapshot.elements.map(item=>item.kind==='screen'?{...item,positionMm:330}:item)});
  assert.equal(shifted.minimum.positionMm,shorter.minimum.positionMm);
  assert.ok(shifted.screens[0].radiusMm<shorter.screens[0].radiusMm);
});

test('未预测、未计算、旧响应和与课节结构不同的装置不能记录',()=>{
  const experiment=lessonExperiment('propagation'),result=calculate(experiment),session=newLearning();
  assert.throws(()=>capture(session,experiment,result,'initial',null,null),/先选择/);
  session.records.propagation.prediction='变大';
  assert.throws(()=>capture(session,experiment,result,'observed',null,null),/先记录初始/);
  assert.throws(()=>capture(session,experiment,null,'initial',null,null),/等待/);
  assert.throws(()=>capture(session,{...experiment,name:'已改动'},result,'initial',null,null),/等待/);
  const wrong=lessonExperiment('focus');assert.throws(()=>capture(session,wrong,calculate(wrong),'initial',null,null),/结构不同/);
});

test('观察记录保持计算时参数，改名称不能冒充改变实验条件',()=>{
  const experiment=lessonExperiment('focus'),result=calculate(experiment);
  let session=capture(predicted('focus'),experiment,result,'initial',null,null);
  assert.equal(session.records.focus.observations.length,1);
  const renamed={...experiment,name:'只有名称变更'};
  session=capture(session,renamed,calculate(renamed),'observed',null,null);
  session.records.focus.reflection='先看屏与最细位置的关系。';
  assert.equal(lessonComplete(session.records.focus,'focus'),false);
  const changed={...experiment,elements:experiment.elements.map(item=>item.kind==='lens'?{...item,focalLengthMm:80}:item)};
  session=capture(session,changed,calculate(changed),'observed',null,null);
  assert.equal(lessonComplete(session.records.focus,'focus'),true);
  assert.equal(session.records.focus.observations[0].result.inputSnapshot.elements.find(item=>item.kind==='lens')?.focalLengthMm,100);
  assert.equal(parseLearning(JSON.parse(JSON.stringify(session))).records.focus.observations.length,3);
});

test('每节最多八条记录，不能静默丢弃旧数据',()=>{
  const experiment=lessonExperiment('propagation'),result=calculate(experiment);let session=predicted('propagation');
  session=capture(session,experiment,result,'initial',null,null);
  for(let i=1;i<8;i++)session=capture(session,experiment,result,'observed',null,null);
  assert.throws(()=>capture(session,experiment,result,'observed',null,null),/8条/);
  assert.equal(session.records.propagation.observations.length,8);
});

test('学习记录导入拒绝未知课程、非有限数值、重复记录及伪造日期',()=>{
  const experiment=lessonExperiment('propagation'),session=capture(predicted('propagation'),experiment,calculate(experiment),'initial',null,null);
  const copy=()=>structuredClone(session);
  let invalid=copy();invalid.courseId='unknown' as typeof invalid.courseId;assert.throws(()=>parseLearning(invalid));
  invalid=copy();invalid.records.propagation.observations[0].result.minimum.radiusMm=NaN;assert.throws(()=>parseLearning(invalid));
  invalid=copy();invalid.records.propagation.observations.push(invalid.records.propagation.observations[0]);assert.throws(()=>parseLearning(invalid));
  invalid=copy();invalid.startedAt=42 as unknown as string;assert.throws(()=>parseLearning(invalid));
  invalid=copy();invalid.records.propagation.observations[0].result.revision=-1;assert.throws(()=>parseLearning(invalid));
});

test('设计与误差依据仅附到其原装置或推荐装置，导出后可恢复',()=>{
  const experiment=lessonExperiment('design');const design:FocusDesign=validateFocusDesign(physics(experiment,'design'));
  let session=capture(predicted('design'),experiment,calculate(experiment),'initial',design,null);
  const recommended=design.recommendation!.experiment;
  session=capture(session,recommended,calculate(recommended),'observed',design,null);
  session.records.design.reflection='在指定范围联合比较，最优只限本次采样。';
  assert.equal(lessonComplete(session.records.design,'design'),true);
  assert.equal(parseLearning(session).records.design.observations[1].design?.counts.total,882);
  const changed={...recommended,elements:recommended.elements.map(item=>item.kind==='lens'?{...item,positionMm:item.positionMm+1}:item)};
  const withoutEvidence=capture(session,changed,calculate(changed),'observed',design,null);
  assert.equal(withoutEvidence.records.design.observations.at(-1)?.design,null);
  const tolerance=lessonExperiment('tolerance'),study:StabilityStudy=validateStabilityStudy(physics(tolerance,'study'));
  let last=capture(predicted('tolerance'),tolerance,calculate(tolerance),'initial',null,null);
  last=capture(last,tolerance,calculate(tolerance),'observed',null,study);last.records.tolerance.reflection='最大值只覆盖有限采样点。';
  assert.equal(lessonComplete(last.records.tolerance,'tolerance'),true);
  assert.equal(parseLearning(last).records.tolerance.observations[1].study?.baseline.rows.length,81);
  assert.ok(learningReport(last).includes('81 个偏差组合'));
  assert.ok(learningReport(last).includes('分析时原方案'));
  const tampered=structuredClone(last);tampered.records.tolerance.observations[1].study!.inputSnapshot.name='其他装置';assert.throws(()=>parseLearning(tampered));
});

test('报告如实呈现部分进度、原参数、半径定义与学生文本，文本不能执行脚本',()=>{
  const experiment=lessonExperiment('focus');experiment.name='<img src=x onerror="alert(1)">';
  let session=capture(predicted('focus'),experiment,calculate(experiment),'initial',null,null);
  session.records.focus.reflection='<script>alert(1)</script>\n我的观察';
  const report=learningReport(session);
  for(const marker of ['0/5节完成记录','尚未完成本节记录','未填写','100 mm','1/e²','不是实验测量','&lt;script&gt;','&lt;img'])assert.ok(report.includes(marker),marker);
  assert.ok(!report.includes('<script>'));assert.ok(!report.includes('<img'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assistantErrorMessage, isAssistantConnectionError, validateAgentReply, scanCSV, type AgentReply, type Evidence } from './agent';
import { makeTemplate } from './model';
import { experimentKey } from './simulation';
import { makeGaussianScene } from './gaussianBeam';
import { loadConversation, parseConversation, saveConversation } from './assistantHistory';

// Contract fixtures are deliberately independent of physics verification.
const experiment = makeTemplate('focus');
const evidence: Evidence = {modelVersion:'contract-fixture',quality:'within-model',minimum:{positionMm:350,radiusMm:0.02},warnings:[],assumptions:['fixture'],screens:[]};
function reply(): AgentReply {return {requestId:'turn',model:'deepseek-flash',inputSnapshot:experiment,experiment,changed:false,answer:'契约验证',trace:[],evidence,scans:[],designs:[],studies:[]};}

test('网络断开给出中文提示，恢复旧记录时仍保留问题和草稿',()=>{
  for (const error of [new TypeError('Failed to fetch'), new Error('NetworkError when attempting to fetch resource.'), new TypeError('Load failed')]) {
    assert.equal(isAssistantConnectionError(error),true);
    assert.match(assistantErrorMessage(error),/连接中断/);
    assert.doesNotMatch(assistantErrorMessage(error),/本地服务/);
  }
  const detail = '模型服务暂时不可用，请稍后重试。';
  assert.equal(isAssistantConnectionError(new Error(detail)),false);
  assert.equal(assistantErrorMessage(new Error(detail)),detail);
  const restored=parseConversation({version:1,draft:'继续验证',turns:[{id:'failed',prompt:'远场关系对吗？',reply:null,error:'Failed to fetch',application:''}]});
  assert.equal(restored.draft,'继续验证');
  assert.equal(restored.turns[0].prompt,'远场关系对吗？');
  assert.match(restored.turns[0].error!,/连接中断/);
});

test('助手过期响应、参数错配和缺少核对的方案被拒绝',()=>{
  assert.throws(()=>validateAgentReply(reply(),'another',experimentKey(experiment)));
  assert.throws(()=>validateAgentReply(reply(),'turn',experimentKey({...experiment,name:'another'})));
  const changed = {...reply(),experiment:{...experiment,name:'新装置'},changed:true,evidence:null};
  assert.throws(()=>validateAgentReply(changed,'turn',experimentKey(experiment)));
  assert.throws(()=>validateAgentReply({...changed,evidence,changed:false},'turn',experimentKey(experiment)));
});
test('助手计算依据不能包含无效半径或非有限扫描值',()=>{
  assert.throws(()=>validateAgentReply({...reply(),evidence:{...evidence,minimum:{positionMm:1,radiusMm:NaN}}},'turn',experimentKey(experiment)));
  const scan={id:'scan',elementId:experiment.elements[1].id,elementName:'透镜',field:'focalLengthMm',fieldLabel:'焦距',unit:'mm',inputSnapshot:experiment,rows:[80,100,NaN].map(value=>({value,result:evidence,error:null}))};
  assert.throws(()=>validateAgentReply({...reply(),scans:[scan]},'turn',experimentKey(experiment)));
});
test('扫描CSV包含原装置、单位和真实数据位置，并保护名称文本',()=>{
  const scan={id:'scan',elementId:experiment.elements[1].id,elementName:'=text',field:'focalLengthMm',fieldLabel:'焦距',unit:'mm' as const,inputSnapshot:experiment,rows:[80,100,120].map(value=>({value,result:evidence,error:null}))};
  const csv=scanCSV(scan);
  assert.ok(csv.includes('input_snapshot_json'));
  assert.ok(csv.includes('minimum_radius_mm'));
  assert.ok(csv.includes('parameter_unit'));
  assert.ok(csv.includes('model_version'));
  assert.ok(csv.includes('assumptions'));
  assert.ok(csv.includes("'=text"));
  assert.equal(validateAgentReply({...reply(),scans:[scan]},'turn',experimentKey(experiment)).scans[0].rows.length,3);
});

test('高斯场景保留独立计算读数，拒绝损坏的传播数据',()=>{
  const scene = makeGaussianScene();
  const beam = { wavelengthNm: 532, waistMm: 0.2, waistPositionMm: 30, observationPositionMm: 350,
    distanceMm: 320, radiusMm: 0.33677, rayleighMm: 236.21, divergenceMrad: 0.8467,
    wavefrontRadiusMm: 494.36, peakRelativeToWaist: 0.3527, region: 'transition' as const };
  const value = {...reply(), inputSnapshot: scene, experiment: scene, evidence: {...evidence, gaussian: beam}};
  assert.deepEqual(validateAgentReply(value, 'turn', experimentKey(scene)).evidence?.gaussian, beam);
  for (const invalid of [{distanceMm: 0}, {wavefrontRadiusMm: Infinity}, {rayleighMm: -1}, {region: 'unknown'}]) {
    assert.throws(()=>validateAgentReply({...value, evidence: {...value.evidence, gaussian: {...beam, ...invalid}}}, 'turn', experimentKey(scene)));
  }
});

test('关闭助手后可恢复对话和草稿，各场景互不串话',()=>{
  const turn = {id:'turn',prompt:'瑞利长度是什么？',reply:reply(),error:null,application:''};
  saveConversation('history-test-gaussian', {draft:'还想问波长',turns:[turn]});
  assert.deepEqual(loadConversation('history-test-gaussian'), {draft:'还想问波长',turns:[turn]});
  assert.deepEqual(loadConversation('history-test-builder'), {draft:'',turns:[]});
  saveConversation('history-test-gaussian', {draft:'',turns:[]});
  assert.deepEqual(loadConversation('history-test-gaussian'), {draft:'',turns:[]});
});

test('恢复中断的问题并保留其他对话，损坏的回复不会应用',()=>{
  const valid={id:'turn',prompt:'解释',reply:reply(),error:null,application:''};
  const interrupted={id:'unfinished',prompt:'计算',reply:null,error:null,application:''};
  const damaged={...valid,id:'wrong-request'};
  const restored=parseConversation({version:1,draft:'输入草稿',turns:[valid,interrupted,damaged]});
  assert.equal(restored.turns.length,2);
  assert.equal(restored.turns[0].reply?.answer,'契约验证');
  assert.ok(restored.turns[1].error?.includes('未完成'));
  assert.equal(restored.draft,'输入草稿');
});

test('刷新后保留AI修改的撤销状态，不把已撤销的回复重新当作已应用',()=>{
  const turn={id:'turn',prompt:'调参',reply:reply(),error:null,application:'已撤销此次调参。',applied:false};
  const restored=parseConversation(JSON.parse(JSON.stringify({version:1,draft:'',turns:[turn]})));
  assert.equal(restored.turns[0].applied,false);
  assert.equal(restored.turns[0].application,'已撤销此次调参。');
  assert.equal(parseConversation({version:1,draft:'',turns:[{...turn,applied:true}]}).turns[0].applied,true);
});

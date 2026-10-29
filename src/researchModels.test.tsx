import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {renderToStaticMarkup} from 'react-dom/server';
import {validateResearchReply,newResearchProject,parseResearchStorage,requestResearchAgent,researchReport} from './researchSession';
import {validateResearchModels,researchModelInputs} from './researchModels';
import {hasResearchEvidence,validatePlanEvidence} from './researchPlan';
import {collectResearchArtifacts,groupResearchArtifacts} from './researchResultRecords';
import ResearchRecordResults from './ResearchRecordResults';
import { microscopePerformance } from './microscopePerformance';
import { immediateScene } from './sceneImmediate';

const python=process.env.OPTICS_PYTHON??'D:/Python313/python.exe';
const raw=JSON.parse(execFileSync(python,['-c','import json; from backend.tests.test_research_models import agent_reply; print(json.dumps(agent_reply()))'],{encoding:'utf8'}));
const reply=validateResearchReply(raw,raw.requestId,null,[],null);

test('camera and telescope results match live scene readouts and survive display and storage',()=>{
  const raw=JSON.parse(execFileSync(python,['-c','import json; from backend.tests.test_research_models import instruments_reply; print(json.dumps(instruments_reply()))'],{encoding:'utf8'}));
  const reply=validateResearchReply(raw,raw.requestId,null,[],null);
  assert.equal(reply.modelResults?.length,2);
  for(const model of reply.modelResults!) for(const scan of model.scans) for(const row of scan.rows){
    const scene=immediateScene(row.result.input)!;
    for(const metric of row.result.metrics){
      const expected=scene.metrics.find(m=>m.key===metric.key)!;
      assert.ok(expected,metric.key);
      assert.equal(metric.unit,expected.unit);
      if(metric.value===null||expected.value===null)assert.equal(metric.value,expected.value);
      else assert.ok(Math.abs(metric.value-expected.value)<1e-9*Math.max(1,Math.abs(expected.value)),metric.key);
    }
  }
  const project={...newResearchProject(),turns:[{id:reply.requestId,prompt:'比较相机光圈和望远镜口径',createdAt:new Date().toISOString(),reply,error:null}]};
  const artifacts=collectResearchArtifacts(project),record=groupResearchArtifacts(artifacts)[0];
  assert.match(artifacts[0].title,/相机成像 · 景深与清晰度/);
  assert.match(artifacts[1].title,/望远镜成像 · 分辨率/);
  for(const artifact of artifacts){
    const html=renderToStaticMarkup(<ResearchRecordResults record={record} selectedArtifactId={artifact.id} onSelectArtifact={()=>{}} onOpenBuilder={()=>{throw new Error('independent model');}}/>);
    assert.ok(html.includes(artifact.title));
  }
  const restored=parseResearchStorage({schemaVersion:2,selectedId:project.id,projects:[project]});
  assert.deepEqual(restored.projects[0].turns[0].reply?.modelResults,reply.modelResults);
  assert.equal(researchModelInputs(restored.projects[0].turns).length,2);
});

test('microscope records match scene readouts, display separate studies and survive storage',()=>{
  const raw=JSON.parse(execFileSync(python,['-c','import json; from backend.tests.test_research_models import microscope_reply; print(json.dumps(microscope_reply()))'],{encoding:'utf8'}));
  const reply=validateResearchReply(raw,raw.requestId,null,[],null);
  assert.equal(reply.modelResults?.length,3);
  for(const model of reply.modelResults!) for(const scan of model.scans) for(const row of scan.rows){
    const key=model.state.parameters.study===1?'resolution':'depth';
    const value=row.result.metrics.find(m=>m.key===key)!.value!;
    assert.ok(Math.abs(value-microscopePerformance(row.result.input)[key])<1e-10);
  }
  const project={...newResearchProject(),turns:[{id:reply.requestId,prompt:'增大数值孔径后，分辨率和景深如何变化',createdAt:new Date().toISOString(),reply,error:null}]};
  const artifacts=collectResearchArtifacts(project),record=groupResearchArtifacts(artifacts)[0];
  assert.match(artifacts[0].title,/分辨率/);
  assert.match(artifacts[1].title,/景深/);
  for(const artifact of artifacts){
    const html=renderToStaticMarkup(<ResearchRecordResults record={record} selectedArtifactId={artifact.id} onSelectArtifact={()=>{}} onOpenBuilder={()=>{throw new Error('independent model');}}/>);
    assert.match(html,/µm/);
    assert.match(html,/物方全景深/);
  }
  const restored=parseResearchStorage({schemaVersion:2,selectedId:project.id,projects:[project]});
  assert.deepEqual(restored.projects[0].turns[0].reply?.modelResults,reply.modelResults);
  assert.equal(researchModelInputs(restored.projects[0].turns).length,3);
});

test('native interference evidence is displayed and retained independently of three-dimensional apparatus',()=>{
  assert.equal(reply.modelResults?.length,1);
  assert.equal(reply.inputSnapshot,null);
  assert.equal(reply.evidence,null);
  assert.equal(reply.apparatusBuilds?.length,0);
  const project={...newResearchProject(),turns:[{id:reply.requestId,prompt:'研究相消',createdAt:new Date().toISOString(),reply,error:null}]};
  const artifacts=collectResearchArtifacts(project),record=groupResearchArtifacts(artifacts)[0];
  assert.equal(artifacts.length,1);
  assert.equal(artifacts[0].kind,'model');
  const html=renderToStaticMarkup(<ResearchRecordResults record={record} selectedArtifactId={record.primaryId} onSelectArtifact={()=>{}} onOpenBuilder={()=>{throw new Error('native model cannot be opened as a ray apparatus');}}/>);
  assert.match(html,/光波叠加 · 相位差比较/);
  assert.match(html,/已算点最小读数/);
  assert.match(html,/0 相对单位/);
  assert.match(html,/4 相对单位/);
  assert.doesNotMatch(html,/几何覆盖半径/);
  assert.doesNotMatch(html,/<details[^>]*\bopen[= >]/);
  const restored=parseResearchStorage({schemaVersion:2,selectedId:project.id,projects:[project]});
  assert.deepEqual(restored.projects[0].turns[0].reply?.modelResults,reply.modelResults);
  assert.deepEqual(researchModelInputs(restored.projects[0].turns),[{id:reply.modelResults![0].id,state:reply.modelResults![0].state}]);
  validatePlanEvidence(reply,[]);
  assert.ok(hasResearchEvidence(reply,reply.planProgress![0].evidence[0]));
  assert.match(researchReport(project),/模型实验：光波叠加/);
  assert.match(researchReport(project),/扫描：相位差/);
});

test('follow-up requests retain the computed model parameters while old replies remain immutable',async()=>{
  const original=JSON.stringify(reply);
  const turn={id:reply.requestId,prompt:'研究相消',createdAt:new Date().toISOString(),reply,error:null};
  const next={...structuredClone(raw),requestId:'model-followup'};
  let sent:Record<string,unknown>|undefined;
  const previousFetch=globalThis.fetch;
  globalThis.fetch=async(_input,init)=>{sent=JSON.parse(init!.body as string);return new Response(JSON.stringify({type:'reply',reply:next})+'\n',{status:200});};
  try {
    const returned=await requestResearchAgent('model-followup',null,'继续研究振幅不等时的相消',[],new AbortController().signal,()=>{},[],null,false,[turn]);
    assert.deepEqual(sent?.modelExperiments,[{id:reply.modelResults![0].id,state:reply.modelResults![0].state}]);
    assert.equal(returned.modelResults![0].state.parameters.phaseDeg,180);
    assert.equal(JSON.stringify(reply),original);
  } finally {globalThis.fetch=previousFetch;}
});

test('model scans reject foreign snapshots, out-of-range parameters and duplicate identities',()=>{
  const original=structuredClone(raw.modelResults);
  const foreign=structuredClone(original);
  foreign[0].scans[0].rows[1].result.input.parameters.amplitude2=.5;
  assert.throws(()=>validateResearchModels(foreign),/计算条件/);
  const invalid=structuredClone(original);
  invalid[0].state.parameters.phaseDeg=900;
  assert.throws(()=>validateResearchModels(invalid),/范围/);
  assert.throws(()=>validateResearchModels([original[0],original[0]]),/重复/);
  assert.deepEqual(raw.modelResults,original);
  assert.equal(hasResearchEvidence(reply,{...reply.planProgress![0].evidence[0],recordId:'missing'}),false);
});

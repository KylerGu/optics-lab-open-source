import test from 'node:test';
import assert from 'node:assert/strict';
import { spatialTemplate } from './builderModel';
import { builderConversationId, initialBuilderTabs, parseBuilderTabs, serializeBuilderTabs, saveBuilderTabSnapshot, newBuilderTab } from './builderTabs';
import { openResearchBuilderTab } from './researchBuilderLink';
import { newResearchProject, parseResearchStorage } from './researchSession';
import { builderConversation, promoteBuilderConversation, updateConversationObject } from './researchConversation';

test('first-message promotion retains history and archive identity; copies remain independent',()=>{
  const tab=initialBuilderTabs(spatialTemplate('focus')).tabs[0];
  const p={...newResearchProject(),id:'builder:'+builderConversationId(tab),objects:[{id:'apparatus',source:'draft' as const,sourceId:tab.id,label:'光路',experiment:tab.history.present,snapshotAt:new Date().toISOString()}],activeObjectId:'apparatus',turns:[{id:'old',prompt:'旧问题',createdAt:new Date().toISOString(),reply:null,error:'已停止'}]};
  assert.equal(builderConversation(tab,[]).selected,undefined);
  const promoted=promoteBuilderConversation(p,tab);
  assert.equal(promoted.id,p.id);assert.deepEqual(promoted.turns,p.turns);
  const saved=saveBuilderTabSnapshot([],tab);
  const archive=saved.saved[0];
  const reopened=newBuilderTab(archive.experiment,archive.id,archive.conversationId);
  const restored=parseResearchStorage({schemaVersion:2,selectedId:promoted.id,projects:[promoted]}).projects;
  assert.equal(builderConversation(reopened,restored).selected?.project.id,p.id);
  const copy=saveBuilderTabSnapshot(saved.saved,saved.tab,true);
  assert.equal(builderConversation(copy.tab,restored).selected,undefined);
  const changed={...reopened,history:{...reopened.history,present:{...reopened.history.present,name:'不同版本'}}};
  assert.equal(builderConversation(changed,restored).conflict,true);
});

function fixture() {
  const experiment=spatialTemplate('focus');
  const p={...newResearchProject(),id:'p',objects:[{id:'o',source:'draft' as const,sourceId:'draft',label:'光路',experiment,snapshotAt:new Date().toISOString()}],activeObjectId:'o'};
  const origin={projectId:p.id,objectId:'o',savedId:null};
  const state=openResearchBuilderTab(initialBuilderTabs(spatialTemplate('empty')),experiment,origin,[]).workspace;
  return {p,origin,state,tab:state.tabs.at(-1)!};
}

test('linked conversation identity and sync baseline survive refresh; manual changes update only current parameters',()=>{
  const {p,state}=fixture();
  const restored=parseBuilderTabs(serializeBuilderTabs(state),[]), tab=restored.tabs.at(-1)!;
  const before=JSON.stringify(p);
  tab.history.present={...tab.history.present,elements:tab.history.present.elements.map(e=>e.kind==='lens'?{...e,focalLengthMm:130}:e)};
  const binding=builderConversation(tab,[p]);
  assert.equal(binding.selected?.project.id,p.id);assert.equal(binding.conflict,false);
  const next=updateConversationObject(p,'o',tab.history.present);
  assert.equal(next.objects[0].experiment.elements.find(e=>e.kind==='lens')!.focalLengthMm,130);
  assert.equal(JSON.stringify(p),before);
  assert.deepEqual(parseResearchStorage({schemaVersion:2,projects:[next],selectedId:p.id}).projects[0],next);
});

test('independent tabs never select the most recent research; removed and ambiguous links require a choice',()=>{
  const {p,tab}=fixture();
  const independent=initialBuilderTabs(p.objects[0].experiment).tabs[0];
  assert.equal(builderConversation(independent,[p]).selected,undefined);
  assert.equal(builderConversation(tab,[]).missing,true);
  const q={...p,id:'q'};
  const shared={...tab,researchContext:undefined,researchKeys:[...tab.researchKeys!,JSON.stringify(['q','o'])]};
  assert.equal(builderConversation(shared,[p,q]).ambiguous,true);
  assert.equal(builderConversation({...shared,researchContext:{key:JSON.stringify(['q','o']),baseline:q.objects[0].experiment}},[p,q]).selected?.project.id,'q');
});

test('different versions and old links without a baseline are never silently overwritten',()=>{
  const {p,tab}=fixture();
  const changed={...p.objects[0].experiment,name:'另一版'};
  assert.equal(builderConversation({...tab,history:{...tab.history,present:changed},researchContext:undefined},[p]).conflict,true);
  const changedProject=updateConversationObject(p,'o',changed);
  assert.equal(builderConversation(tab,[changedProject]).conflict,true);
  assert.equal(builderConversation({...tab,history:{...tab.history,present:changed}},[changedProject]).conflict,false);
});

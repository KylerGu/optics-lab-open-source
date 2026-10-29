import test from 'node:test';
import assert from 'node:assert/strict';
import {spatialTemplate} from './builderModel';
import {saveSpatialSnapshot,readSavedSpatial} from './spatialStorage';
import {initialBuilderTabs,openBuilderTab,closeBuilderTab,builderTabDirty,serializeBuilderTabs,parseBuilderTabs,builderConversationId,saveBuilderTabSnapshot,rememberBuilderConversations} from './builderTabs';

test('reset baseline survives edits, refresh, saving and reopening without absorbing later edits',()=>{
  const original=spatialTemplate('imaging'),state=initialBuilderTabs(original),tab=state.tabs[0];
  tab.history.present={...original,elements:original.elements.slice(1).map(e=>({...e,position:[e.position[0]+20,e.position[1],e.position[2]]}))};
  assert.deepEqual(tab.resetBaseline,original);
  const restored=parseBuilderTabs(serializeBuilderTabs(state),[]).tabs[0];
  assert.deepEqual(restored.resetBaseline,original);assert.deepEqual(restored.history.present,tab.history.present);
  const saved=saveBuilderTabSnapshot([],restored);
  const reopened=openBuilderTab(initialBuilderTabs(spatialTemplate('empty')),saved.saved[0].experiment,saved.saved[0].id,saved.saved[0].conversationId,saved.saved[0].resetBaseline).tabs.at(-1)!;
  assert.deepEqual(reopened.resetBaseline,original);
  const resaved=saveSpatialSnapshot(saved.saved,saved.saved[0].id,spatialTemplate('fold'));
  assert.deepEqual(resaved[0].resetBaseline,original);
  const copy=saveBuilderTabSnapshot(saved.saved,saved.tab,true);
  assert.deepEqual(copy.saved[0].resetBaseline,original);
});

test('legacy tabs use their known saved or loaded state as reset baseline; corrupt baselines are rejected',()=>{
  const original=spatialTemplate('focus'),changed=spatialTemplate('split'),saved=saveSpatialSnapshot([],null,original);
  const wire={version:1,activeId:'legacy',tabs:[{id:'legacy',savedId:saved[0].id,experiment:changed}]};
  assert.deepEqual(parseBuilderTabs(JSON.stringify(wire),saved).tabs[0].resetBaseline,original);
  assert.deepEqual(parseBuilderTabs(JSON.stringify(wire),[]).tabs[0].resetBaseline,changed);
  assert.throws(()=>parseBuilderTabs(JSON.stringify({...wire,tabs:[{...wire.tabs[0],resetBaseline:{elements:'bad'}}]}),[]));
});

test('opening another apparatus keeps independent edits and undo histories',()=>{
  const state=initialBuilderTabs(spatialTemplate('focus'),'focus-save'),first=state.tabs[0];
  const before=first.history.present,changed={...before,name:'已调整聚焦',elements:before.elements.map((e,index)=>index===1?{...e,focalLengthMm:145}:e)};
  first.history={past:[before],present:changed,future:[]};
  const opened=openBuilderTab(state,spatialTemplate('fold'),'fold-save');
  assert.equal(opened.tabs.length,2);assert.equal(opened.activeId,opened.tabs[1].id);
  const returning=openBuilderTab(opened,spatialTemplate('focus'),'focus-save');
  assert.equal(returning.tabs.length,2);assert.equal(returning.activeId,first.id);
  assert.equal(returning.tabs[0].history.present.elements[1].focalLengthMm,145);
  assert.equal(returning.tabs[0].history.past[0],before);assert.equal(returning.tabs[1].history.past.length,0);
});

test('a background tab is saved to its own archive and does not alter the active tab',()=>{
  const focus=spatialTemplate('focus'),fold=spatialTemplate('fold');
  const rows=saveSpatialSnapshot(saveSpatialSnapshot([],null,focus),null,fold);
  let state=initialBuilderTabs(focus,rows[1].id);state=openBuilderTab(state,fold,rows[0].id);
  const background=state.tabs[0],active=state.tabs[1];
  background.history.present={...background.history.present,elements:background.history.present.elements.map((e,index)=>index===1?{...e,focalLengthMm:180}:e)};
  assert.equal(builderTabDirty(background,rows),true);assert.equal(builderTabDirty(active,rows),false);
  const saved=saveSpatialSnapshot(rows,background.savedId,background.history.present);
  assert.equal(saved.length,2);assert.equal(saved[0].id,background.savedId);assert.equal(saved[0].experiment.elements[1].focalLengthMm,180);
  assert.equal(builderTabDirty(background,saved),false);assert.equal(builderTabDirty(active,saved),false);
  const closed=closeBuilderTab(state,background.id);assert.equal(closed.activeId,active.id);assert.equal(closed.tabs[0].history.present,active.history.present);
});

test('draft recovery keeps all unsaved apparatus and the active tab without treating them as archives',()=>{
  const state=openBuilderTab(initialBuilderTabs(spatialTemplate('focus')),spatialTemplate('fold'));
  state.tabs[0].history.present.name='聚焦草稿';state.tabs[1].history.present.elements[0].powerMw=24;
  const restored=parseBuilderTabs(serializeBuilderTabs(state),[]);
  assert.equal(restored.activeId,state.activeId);assert.equal(restored.tabs[0].history.present.name,'聚焦草稿');
  assert.equal(restored.tabs[1].history.present.elements[0].powerMw,24);
  assert.ok(restored.tabs.every(tab=>builderTabDirty(tab,[])));assert.ok(restored.tabs.every(tab=>tab.savedId===null));
});

test('close selects a neighbor, never discards other apparatus, and leaves an empty tab after the last close',()=>{
  let state=initialBuilderTabs(spatialTemplate('focus'));state=openBuilderTab(state,spatialTemplate('fold'));state=openBuilderTab(state,spatialTemplate('split'));
  const first=state.tabs[0],second=state.tabs[1];
  state=closeBuilderTab(state,state.activeId);assert.equal(state.activeId,second.id);assert.equal(state.tabs.length,2);
  state=closeBuilderTab(state,second.id);assert.equal(state.activeId,first.id);
  state=closeBuilderTab(state,first.id);assert.equal(state.tabs.length,1);assert.equal(state.tabs[0].history.present.elements.length,0);
  assert.equal(builderTabDirty(state.tabs[0],[]),false);
  state.tabs[0].history.present.name='新实验';assert.equal(builderTabDirty(state.tabs[0],[]),true);
});

test('restoration tolerates removed archives but rejects duplicate or invalid tab data',()=>{
  const archived=saveSpatialSnapshot([],null,spatialTemplate('focus'));
  const state=initialBuilderTabs(archived[0].experiment,archived[0].id);
  assert.equal(parseBuilderTabs(serializeBuilderTabs(state),[]).tabs[0].savedId,null);
  const wire=JSON.parse(serializeBuilderTabs(state));wire.tabs.push({...wire.tabs[0]});
  assert.throws(()=>parseBuilderTabs(JSON.stringify(wire),archived));
  wire.tabs[1].id='another-tab';assert.throws(()=>parseBuilderTabs(JSON.stringify(wire),archived));
  wire.tabs.pop();wire.tabs[0].experiment.elements[0].position=[Number.NaN,60,0];
  assert.throws(()=>parseBuilderTabs(JSON.stringify(wire),archived));
});

test('first save, rename, close and reopen keep one independent conversation identity',()=>{
  let state=initialBuilderTabs(spatialTemplate('focus'));
  const original=state.tabs[0],conversationId=builderConversationId(original);
  let saved=saveBuilderTabSnapshot([],original);
  assert.equal(saved.saved[0].conversationId,conversationId);
  saved=saveBuilderTabSnapshot(saved.saved,{...saved.tab,history:{...saved.tab.history,present:{...saved.tab.history.present,name:'改名后的装置'}}});
  assert.equal(saved.saved.length,1);assert.equal(saved.tab.conversationId,conversationId);
  state={activeId:saved.tab.id,tabs:[saved.tab]};
  state=closeBuilderTab(state,saved.tab.id);
  const archive=saved.saved[0];
  state=openBuilderTab(state,archive.experiment,archive.id,archive.conversationId);
  const reopened=state.tabs.at(-1)!;
  assert.notEqual(reopened.id,original.id);
  assert.equal(builderConversationId(reopened),conversationId);
  assert.equal(reopened.researchKeys,undefined);
  assert.equal(parseBuilderTabs(serializeBuilderTabs(state),saved.saved).tabs.at(-1)!.conversationId,conversationId);
});

test('save as copy gives the same-named copy a separate conversation and preserves the original',()=>{
  const tab=initialBuilderTabs(spatialTemplate('focus')).tabs[0];
  const original=saveBuilderTabSnapshot([],tab);
  const copy=saveBuilderTabSnapshot(original.saved,{...original.tab,researchKeys:['["p","o"]'],researchContext:{key:'["p","o"]',baseline:tab.history.present}},true);
  assert.equal(copy.saved.length,2);
  assert.equal(copy.saved[0].experiment.name,copy.saved[1].experiment.name);
  assert.notEqual(copy.tab.conversationId,original.tab.conversationId);
  assert.equal(copy.saved.find(s=>s.id===original.tab.savedId)!.conversationId,original.tab.conversationId);
  assert.equal(copy.tab.researchKeys,undefined);assert.equal(copy.tab.researchContext,undefined);
  assert.equal(copy.saved[0].researchKeys,undefined);
  const secondSave=saveBuilderTabSnapshot(copy.saved,copy.tab);
  assert.equal(secondSave.tab.conversationId,copy.tab.conversationId);
  const unsavedCopy=saveBuilderTabSnapshot([], {...tab,researchKeys:['["p","o"]']},true);
  assert.notEqual(unsavedCopy.tab.conversationId,tab.conversationId);
  assert.equal(unsavedCopy.tab.researchKeys,undefined);
});

test('legacy open saved tabs retain their original tab-based chat without rewriting apparatus or save time',()=>{
  const saved=saveSpatialSnapshot([],null,spatialTemplate('focus'));
  const legacy={version:1,activeId:'old-tab',tabs:[{id:'old-tab',savedId:saved[0].id,experiment:saved[0].experiment}]};
  const restored=parseBuilderTabs(JSON.stringify(legacy),saved);
  assert.equal(builderConversationId(restored.tabs[0]),'old-tab');
  const upgraded=rememberBuilderConversations(restored.tabs,saved);
  assert.equal(upgraded[0].conversationId,'old-tab');
  assert.equal(upgraded[0].experiment,saved[0].experiment);assert.equal(upgraded[0].savedAt,saved[0].savedAt);
  assert.equal(rememberBuilderConversations(restored.tabs,upgraded),upgraded);
  assert.throws(()=>rememberBuilderConversations(restored.tabs,[{...saved[0],conversationId:'another'}]),/关联不同/);
  const reopened=openBuilderTab(closeBuilderTab(restored,'old-tab'),upgraded[0].experiment,upgraded[0].id,upgraded[0].conversationId);
  assert.equal(builderConversationId(reopened.tabs.at(-1)!),'old-tab');
});

test('archive storage restores conversation metadata and rejects malformed or shared conversation identities',()=>{
  const prior=globalThis.localStorage;
  let rows=saveBuilderTabSnapshot([],initialBuilderTabs(spatialTemplate('focus')).tabs[0]).saved;
  try{
    globalThis.localStorage={getItem:()=>JSON.stringify(rows)} as unknown as Storage;
    assert.equal(readSavedSpatial()[0].conversationId,rows[0].conversationId);
    const ordinary=saveSpatialSnapshot(rows,rows[0].id,rows[0].experiment);
    assert.equal(ordinary[0].conversationId,rows[0].conversationId);
    assert.throws(()=>saveSpatialSnapshot(rows,null,rows[0].experiment,undefined,rows[0].conversationId),/另一份装置/);
    rows=[{...rows[0],conversationId:''}];assert.throws(()=>readSavedSpatial(),/关联无效/);
    rows=[{...ordinary[0],id:'one'},{...ordinary[0],id:'two'}];assert.throws(()=>readSavedSpatial(),/共用了/);
  }finally{if(prior)globalThis.localStorage=prior;else Reflect.deleteProperty(globalThis,'localStorage');}
});

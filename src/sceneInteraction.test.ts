import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScene, type SceneState } from './sceneRuntime';
import { emptySceneInteraction, recordSceneChange, inspectSceneComparison, restoreSceneComparison, changeForSnapshot } from './sceneInteraction';

const patch=(s:SceneState,p:Record<string,number>)=>({...s,parameters:{...s.parameters,...p}});
test('committed changes are detached snapshots, and request context matches the sent state',()=>{
  const before=defaultScene('instruments-0'),after=patch(before,{NA:.8});
  const log=recordSceneChange(emptySceneInteraction(),before,after,'user');
  const sent=changeForSnapshot(log.recentChange,after)!;
  after.parameters.NA=.6;
  assert.equal(sent.after.parameters.NA,.8);
  assert.equal(log.recentChange!.before.parameters.NA,.4);
  assert.equal(changeForSnapshot(log.recentChange,after),null);
});
test('all microscope pages preview exact comparison snapshots and restore the first baseline',()=>{
  for(const study of [0,1,2,3]){
    const original=patch(defaultScene('instruments-0'),{study});
    const first=patch(original,{NA:.2}),second=patch(original,{NA:.8});
    let interaction=inspectSceneComparison(emptySceneInteraction(),original,first,'a');
    interaction=inspectSceneComparison(interaction,original,second,'b');
    assert.deepEqual(interaction.comparison?.baseline,original);
    assert.deepEqual(interaction.comparison?.shown,second);
    assert.deepEqual(interaction.recentChange?.before,first);
    interaction=restoreSceneComparison(interaction);
    assert.equal(interaction.comparison,null);
    assert.deepEqual(interaction.recentChange?.after,original);
    assert.equal(interaction.recentChange?.source,'restore');
  }
});
test('editing a comparison ends preview; restoring cannot overwrite subsequent edits',()=>{
  const original=defaultScene('instruments-0'),shown=patch(original,{study:3,NA:.8});
  let interaction=inspectSceneComparison(emptySceneInteraction(),original,shown,'a');
  interaction=recordSceneChange(interaction,shown,patch(shown,{wavelength:600}),'user');
  assert.equal(interaction.comparison,null);
  assert.equal(restoreSceneComparison(interaction),interaction);
  assert.equal(interaction.recentChange!.after.parameters.wavelength,600);
});
test('shared mechanism supports other scenes while refusing foreign or invalid snapshots',()=>{
  const original=defaultScene('paraxial-0'),shown=patch(original,{u:300});
  const preview=inspectSceneComparison(emptySceneInteraction(),original,shown,'lens');
  assert.deepEqual(restoreSceneComparison(preview).recentChange?.after,original);
  assert.throws(()=>inspectSceneComparison(preview,original,defaultScene('instruments-0'),'foreign'));
  assert.throws(()=>inspectSceneComparison(preview,original,patch(original,{u:-1}),'invalid'));
});

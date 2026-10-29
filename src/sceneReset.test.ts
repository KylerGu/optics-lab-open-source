import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScene, SCENE_DEFINITIONS, parseScene } from './sceneRuntime';
import { resetSceneParameters } from './sceneReset';

test('reset restores quantities while preserving every topic and observation mode',()=>{
  for(const id of Object.keys(SCENE_DEFINITIONS)){
    const defaults=defaultScene(id);
    const definition=SCENE_DEFINITIONS[id];
    const studies=definition.parameters.find(p=>p.key==='study')?.options?.map(o=>o.value)??[undefined];
    const modes=definition.parameters.find(p=>p.key==='mode')?.options?.map(o=>o.value)??[undefined];
    for(const study of studies)for(const mode of modes){
      const current={...defaults,parameters:{...defaults.parameters}};
      if(study!==undefined)current.parameters.study=study;
      if(mode!==undefined)current.parameters.mode=mode;
      const quantity=definition.parameters.find(p=>!['study','mode','NA','medium'].includes(p.key)&&!p.options);
      if(quantity)current.parameters[quantity.key]=quantity.max;
      const snapshot=JSON.stringify(current);
      const reset=resetSceneParameters(current);
      assert.equal(reset.sceneId,id);
      for(const [key,value] of Object.entries(reset.parameters))assert.equal(value,['study','mode'].includes(key)?current.parameters[key]:defaults.parameters[key],`${id}: ${key}`);
      assert.equal(JSON.stringify(current),snapshot);
      assert.doesNotThrow(()=>parseScene(reset));
    }
  }
});

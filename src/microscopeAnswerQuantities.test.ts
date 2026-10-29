import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultScene, sceneKey } from './sceneRuntime';
import { immediateScene } from './sceneImmediate';
import { microscopeAnswerQuantities } from './microscopeAnswerQuantities';
import type { MicroscopeQuantity } from './microscopeQuantities';

test('all microscope pages connect answer terms to existing annotations without changing the scene',()=>{
  for(const [study,mode,key,controls] of [
    [0,0,'v1','microscope-ray-diagram'],[0,1,'tubeF','microscope-ray-diagram'],
    [1,0,'separation','microscope-performance-diagram'],[2,0,'fieldDiameter','microscope-field-diagram'],
    [2,1,'fieldWidth','microscope-field-diagram'],[3,0,'depth','microscope-performance-diagram'],
  ] as const){
    const state=defaultScene('instruments-0');Object.assign(state.parameters,{study,mode,...(mode===1?{u:10}:{})});
    const before=sceneKey(state),selected=new Set<MicroscopeQuantity>();
    const resolve=()=>microscopeAnswerQuantities(state,immediateScene(state),state,selected,k=>{if(selected.has(k))selected.delete(k);else selected.add(k);});
    const target=resolve().find(q=>q.id===key)!;
    assert.ok(target);assert.equal(target.controls,controls);assert.equal(target.selected,false);
    target.onToggle();assert.ok(selected.has(key));assert.equal(resolve().find(q=>q.id===key)!.selected,true);
    resolve().find(q=>q.id===key)!.onToggle();assert.equal(selected.size,0);assert.equal(sceneKey(state),before);
  }
});

test('unavailable diagrams, foreign pages and non-geometric quantities do not offer misleading links',()=>{
  const state=defaultScene('instruments-0'),source=structuredClone(state);
  let links=microscopeAnswerQuantities(state,immediateScene(state),source,new Set(),()=>{});
  assert.ok(!links.some(q=>['v','angularM','NA'].includes(q.id)));
  source.parameters.study=3;
  assert.equal(microscopeAnswerQuantities(state,immediateScene(state),source,new Set(),()=>{}).length,0);
  Object.assign(state.parameters,{study:2,mode:1,u:11});
  links=microscopeAnswerQuantities(state,immediateScene(state),state,new Set(),()=>{});
  assert.equal(links.length,0);
  assert.equal(microscopeAnswerQuantities(state,immediateScene(state),defaultScene('paraxial-0'),new Set(),()=>{}).length,0);
});

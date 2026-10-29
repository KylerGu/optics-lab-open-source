import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScene } from './sceneRuntime';
import { immediateScene } from './sceneImmediate';
import { symmetricPrismAngle } from './prismAnnotations';

test('symmetric incidence gives equal face angles and the predicted signed deviation',()=>{
  for(const [n,outside] of [[1.5,1],[1,1.5],[1,1],[2.5,1],[1,2.5]])for(const apex of [10,30,60,80]){
    const state={...defaultScene('reflection-refraction-2'),parameters:{n,outside,apex,angle:0}};
    const angle=symmetricPrismAngle(state);
    if(angle===null)continue;
    state.parameters.angle=angle;
    const result=immediateScene(state)!;
    const value=(key:string)=>result.metrics.find(m=>m.key===key)!.value!;
    assert.ok(Math.abs(value('r1')-apex/2)<1e-9);
    assert.ok(Math.abs(value('exitAngle')-angle)<1e-9);
    assert.ok(Math.abs(value('deviation')-value('minimumDeviation'))<1e-9);
    const inside=result.segments.find(s=>s.role==='internal')!;
    assert.ok(Math.abs(inside.start[1]-inside.end[1])<1e-9);
  }
});

test('no symmetric transmission is offered beyond the refraction limit',()=>{
  const state=defaultScene('reflection-refraction-2');
  state.parameters.n=2.5;state.parameters.apex=80;
  assert.equal(symmetricPrismAngle(state),null);
});

test('diagram direction comparison preserves signed deviation for arbitrary outgoing rays',()=>{
  for(const [n,outside] of [[1.5,1],[1,1.5],[1,1]])for(const angle of [0,10,25,45,65,89]){
    const state={...defaultScene('reflection-refraction-2'),parameters:{n,outside,apex:60,angle}};
    const result=immediateScene(state)!,incident=result.segments[0],out=result.segments.find(s=>s.role==='transmitted');
    const deviation=result.metrics.find(m=>m.key==='deviation')!.value;
    if(!out){assert.equal(deviation,null);continue;}
    const direction=(s:typeof incident)=>Math.atan2(s.end[1]-s.start[1],s.end[0]-s.start[0]);
    assert.ok(Math.abs((direction(incident)-direction(out))*180/Math.PI-deviation!)<1e-9);
  }
});

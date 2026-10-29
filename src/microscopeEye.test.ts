import assert from 'node:assert/strict';
import test from 'node:test';
import {defaultScene} from './sceneRuntime';
import {immediateScene} from './sceneImmediate';
import {microscopeEyePosition,microscopeRayHeight} from './microscopeEye';

test('eye receives the unchanged ray bundle at the eyepiece exit pupil',()=>{
  for(const d of [125,130]){
    const state=defaultScene('instruments-0');state.parameters.d=d;
    const result=immediateScene(state)!,before=JSON.stringify(result);
    const position=microscopeEyePosition(state,result)!;
    assert.ok(position>d);
    assert.ok(Math.abs(1/d+1/(position-d)-1/state.parameters.f2)<1e-10);
    const outgoing=result.segments.filter(s=>s.role==='transmitted');
    const heights=outgoing.map(s=>microscopeRayHeight(s,position));
    // The ray through the objective centre arrives at the centre of its pupil image.
    assert.ok(Math.abs(heights[1])<1e-10);
    assert.ok(heights.every(Number.isFinite));
    const final=result.metrics.find(m=>m.key==='v')!.value;
    if(d===130){
      assert.equal(final,null);
      const slopes=outgoing.map(s=>(s.end[1]-s.start[1])/(s.end[0]-s.start[0]));
      assert.ok(Math.abs(slopes[0]-slopes[1])<1e-10);
    }else{
      assert.ok(final!<0);
      const intersections=outgoing.map(s=>microscopeRayHeight(s,d+final!));
      assert.ok(Math.abs(intersections[0]-intersections[1])<1e-10);
    }
    assert.equal(JSON.stringify(result),before);
  }
});

test('eye overlay does not replace projection, camera or other microscope pages',()=>{
  for(const values of [{mode:1},{study:1},{study:2},{study:3},{u:12}]){
    const state=defaultScene('instruments-0');Object.assign(state.parameters,values);
    assert.equal(microscopeEyePosition(state,immediateScene(state)!),null);
  }
});

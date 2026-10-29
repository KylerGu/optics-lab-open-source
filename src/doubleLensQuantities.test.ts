import assert from 'node:assert/strict';
import test from 'node:test';
import {doubleLensMeasure} from './doubleLensQuantities';
import {immediateScene} from './sceneImmediate';
import {defaultScene} from './sceneRuntime';

const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8*Math.max(1,Math.abs(b)),`${a} ≠ ${b}`);
test('double-lens equivalent focal annotation uses the principal plane and the parallel-ray focus',()=>{
  for(const k1 of [-1,1])for(const k2 of [-1,1])for(const d of [40,200,350]){
    const state=defaultScene('paraxial-2');Object.assign(state.parameters,{f1:100,f2:70,k1,k2,d});
    const result=immediateScene(state)!,m=doubleLensMeasure(result,'equivalentFocal');
    const slope1=-1/(100*k1),height2=1+d*slope1,slope2=slope1-height2/(70*k2),focus=d-height2/slope2;
    assert.notEqual(m.end,null);close(m.end!,focus);close(m.end!-m.start,m.value!);
    // A focal distance measured from lens 2 would incorrectly use the back focal length.
    assert.notEqual(m.start,d);assert.equal(m.reference,'H′');
  }
});
test('first and final image measurements keep distinct origins for real, virtual and infinite images',()=>{
  for(const u of [60,100,200])for(const d of [70,300,350]){
    const state=defaultScene('paraxial-2');Object.assign(state.parameters,{u,d});
    const result=immediateScene(state)!,first=doubleLensMeasure(result,'v1'),final=doubleLensMeasure(result,'v');
    assert.equal(first.start,0);assert.equal(final.start,d);
    if(u===100)assert.equal(first.end,null);else close(1/u+1/first.end!,1/100);
    if(final.end!==null){const rays=result.segments.filter(s=>s.role==='transmitted');const heights=rays.map(ray=>ray.start[1]+(final.end!-ray.start[0])*(ray.end[1]-ray.start[1])/(ray.end[0]-ray.start[0]));close(heights[0],heights[1]);}
    else assert.equal(result.metrics.find(m=>m.key==='matrixD')!.value,0);
  }
});
test('focal magnitude controls retain signed focal locations and distinguish B and D units',()=>{
  const state=defaultScene('paraxial-2');Object.assign(state.parameters,{k1:-1,k2:-1});const result=immediateScene(state)!;
  const first=doubleLensMeasure(result,'f1'),second=doubleLensMeasure(result,'f2');
  assert.equal(first.value,100);assert.equal(first.end,-100);assert.equal(second.end,state.parameters.d-100);
  assert.equal(result.metrics.find(m=>m.key==='matrixB')!.unit,'mm');assert.equal(result.metrics.find(m=>m.key==='matrixD')!.unit,'无量纲');
});

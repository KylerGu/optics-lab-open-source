import assert from 'node:assert/strict';
import test from 'node:test';
import {MIRROR_QUANTITIES,mirrorMeasure} from './mirrorQuantities';
import {immediateScene} from './sceneImmediate';
import {defaultScene} from './sceneRuntime';
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8*Math.max(1,Math.abs(b)),`${a} ≠ ${b}`);
test('mirror dimensions agree with reflected-ray intersection on both sides of the mirror',()=>{
  for(const kind of [-1,1])for(const u of [60,200,450]){
    const state=defaultScene('paraxial-1');Object.assign(state.parameters,{R:200,kind,u,h:10});
    const result=immediateScene(state)!,image=mirrorMeasure(result,'v'),height=mirrorMeasure(result,'imageHeight');
    close(1/u-1/image.end!,1/(100*kind));
    const rays=result.segments.filter(s=>s.role==='reflected');assert.ok(rays.length>=2);
    const heights=rays.map(ray=>ray.start[1]+(image.end!-ray.start[0])*(ray.end[1]-ray.start[1])/(ray.end[0]-ray.start[0]));
    close(heights[0],heights[1]);close(height.end!,heights[0]);assert.equal(height.position,image.end);
    assert.equal(mirrorMeasure(result,'u').start,-u);assert.equal(mirrorMeasure(result,'u').end,0);
    assert.equal(mirrorMeasure(result,'h').position,-u);assert.equal(mirrorMeasure(result,'h').end,10);
    assert.equal(mirrorMeasure(result,'f').end,-100*kind);assert.equal(mirrorMeasure(result,'R').end,-200*kind);
    close(height.end!/10,result.metrics.find(m=>m.key==='m')!.value!);
  }
});
test('focal-plane object has parallel reflected rays and no finite image dimensions',()=>{
  const state=defaultScene('paraxial-1');state.parameters.u=100;
  const result=immediateScene(state)!,rays=result.segments.filter(s=>s.role==='reflected');
  const slopes=rays.map(r=>(r.end[1]-r.start[1])/(r.end[0]-r.start[0]));close(slopes[0],slopes[1]);
  assert.equal(mirrorMeasure(result,'v').end,null);assert.equal(mirrorMeasure(result,'imageHeight').end,null);assert.equal(mirrorMeasure(result,'imageHeight').position,null);
});
test('each drawable mirror quantity has its own color',()=>{
  assert.equal(new Set(Object.values(MIRROR_QUANTITIES).map(q=>q.color)).size,6);
});

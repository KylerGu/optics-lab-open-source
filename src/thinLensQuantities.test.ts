import assert from 'node:assert/strict';
import test from 'node:test';
import {thinLensMeasure} from './thinLensQuantities';
import {immediateScene} from './sceneImmediate';
import {defaultScene} from './sceneRuntime';

const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8*Math.max(1,Math.abs(b)),`${a} ≠ ${b}`);
test('thin-lens distances and signed heights agree with the ray intersection for real and virtual images',()=>{
  for(const kind of [-1,1])for(const u of [60,200,450]){
    const state=defaultScene('paraxial-0');Object.assign(state.parameters,{f:100,kind,u,h:10});
    const result=immediateScene(state)!,object=thinLensMeasure(result,'u'),image=thinLensMeasure(result,'v'),height=thinLensMeasure(result,'imageHeight');
    assert.equal(object.start,-u);assert.equal(object.end,0);assert.equal(image.start,0);
    close(1/u+1/image.end!,1/(100*kind));
    const rays=result.segments.filter(s=>s.role==='transmitted');
    const rayHeights=rays.map(ray=>ray.start[1]+image.end!*(ray.end[1]-ray.start[1])/(ray.end[0]-ray.start[0]));
    close(rayHeights[0],rayHeights[1]);close(height.end!,rayHeights[0]);assert.equal(height.position,image.end);
    const objectHeight=thinLensMeasure(result,'h');assert.equal(objectHeight.position,-u);assert.equal(objectHeight.start,0);assert.equal(objectHeight.end,10);
    close(height.end!/10,result.metrics.find(m=>m.key==='m')!.value!);
  }
});
test('thin-lens focal annotation locates the signed image-side focus for converging and diverging lenses',()=>{
  for(const kind of [-1,1]){
    const state=defaultScene('paraxial-0');state.parameters.kind=kind;
    const result=immediateScene(state)!,focal=thinLensMeasure(result,'f'),ray=result.segments.find(s=>s.role==='transmitted')!;
    assert.equal(focal.start,0);assert.equal(focal.end,100*kind);assert.equal(focal.value,focal.end);
    close(ray.start[1]+focal.end!*(ray.end[1]-ray.start[1])/(ray.end[0]-ray.start[0]),0);
    assert.equal(focal.end,result.markers.find(m=>m.label==='F′')!.x);
  }
});
test('focal-plane object has parallel outgoing rays and no finite image distance or image height annotation',()=>{
  const state=defaultScene('paraxial-0');state.parameters.u=100;
  const result=immediateScene(state)!,rays=result.segments.filter(s=>s.role==='transmitted');
  const slopes=rays.map(ray=>(ray.end[1]-ray.start[1])/(ray.end[0]-ray.start[0]));close(slopes[0],slopes[1]);
  assert.equal(thinLensMeasure(result,'v').end,null);assert.equal(thinLensMeasure(result,'imageHeight').end,null);assert.equal(thinLensMeasure(result,'imageHeight').position,null);
  assert.equal(result.metrics.find(m=>m.key==='m')!.value,null);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {defaultScene} from './sceneRuntime';
import {immediateScene} from './sceneImmediate';
import {canAnnotateMicroscope,microscopeRayMeasure,MICROSCOPE_QUANTITIES} from './microscopeQuantities';
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8*Math.max(1,Math.abs(b)));

test('microscope switches only exist for quantities represented in the current diagram',()=>{
 const state=defaultScene('instruments-0');let result=immediateScene(state)!;
 for(const key of ['f1','f2','u','d','h','v1'])assert.ok(canAnnotateMicroscope(state,result,key),key);
 for(const key of ['m','objectiveM','angularM','equivalentFocal','matrixB','matrixD','NA','wavelength','near','fieldNumber','tubeF','fieldDiameter'])assert.ok(!canAnnotateMicroscope(state,result,key),key);
 assert.ok(!canAnnotateMicroscope(state,result,'v'),'infinite final image has no finite dimension');
 state.parameters.study=1;result=immediateScene(state)!;for(const key of ['resolution','separation'])assert.ok(canAnnotateMicroscope(state,result,key));assert.ok(!canAnnotateMicroscope(state,result,'f1'));
 state.parameters.study=3;result=immediateScene(state)!;for(const key of ['depth','halfDepth','defocus'])assert.ok(canAnnotateMicroscope(state,result,key));assert.ok(!canAnnotateMicroscope(state,result,'resolution'));
 state.parameters.study=2;result=immediateScene(state)!;assert.ok(canAnnotateMicroscope(state,result,'fieldDiameter'));assert.ok(!canAnnotateMicroscope(state,result,'fieldWidth'));
 Object.assign(state.parameters,{mode:1,u:state.parameters.f1});result=immediateScene(state)!;for(const key of ['fieldWidth','fieldHeight','fieldDiagonal'])assert.ok(canAnnotateMicroscope(state,result,key));assert.ok(!canAnnotateMicroscope(state,result,'fieldDiameter'));
 state.parameters.u+=1;result=immediateScene(state)!;assert.ok(!canAnnotateMicroscope(state,result,'fieldWidth'),'no boundary on absent unfocused preview');
});
test('microscope image dimensions use the correct lens origin and the actual outgoing-ray intersection',()=>{
 for(const mode of [0,1])for(const u of [10,11,14]){
  const state=defaultScene('instruments-0');Object.assign(state.parameters,{mode,u});const result=immediateScene(state)!;
  const first=microscopeRayMeasure(result,'v1'),final=microscopeRayMeasure(result,'v');assert.equal(final.start,state.parameters.d);
  if(mode===0&&first.end!==null)close(1/u+1/first.end,1/state.parameters.f1);
  if(final.end!==null){const heights=result.segments.filter(s=>s.role==='transmitted').map(s=>s.start[1]+(final.end!-s.start[0])*(s.end[1]-s.start[1])/(s.end[0]-s.start[0]));close(heights[0],heights[1]);}
  const object=microscopeRayMeasure(result,'u');assert.equal(object.start,-u);assert.equal(object.end,0);
  const height=microscopeRayMeasure(result,'h');assert.equal(height.position,-u);assert.equal(height.end,state.parameters.h);
  if(mode===1){const focus=microscopeRayMeasure(result,'focusOffset');close(focus.end!-focus.start,u-state.parameters.f1);assert.equal(microscopeRayMeasure(result,'tubeF').end,state.parameters.d+state.parameters.tubeF);}
 }
});
test('concurrently drawable ray quantities use distinct colors',()=>{
 const keys=['f1','f2','u','d','h','v1','v','focusOffset'] as const;
 assert.equal(new Set(keys.map(key=>MICROSCOPE_QUANTITIES[key].color)).size,keys.length);
});

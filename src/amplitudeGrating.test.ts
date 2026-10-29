import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {makeSpatialElement,parseSpatial,validateSpatialResult,type SpatialExperiment} from './builderModel';
import {gratingOrderDirections} from './amplitudeGrating';
import {alignmentAxes} from './spatialAlignment';
import {geometryFrame,dot3} from './spatialGeometry';

const make=():SpatialExperiment=>({schemaVersion:2,name:'光栅核对',elements:[makeSpatialElement('laser',[0,60,0],{rayCount:1}),makeSpatialElement('amplitude-grating',[100,60,0]),makeSpatialElement('screen',[400,60,0],{diameterMm:60})]});
const simulate=(input:SpatialExperiment)=>JSON.parse(execFileSync('python',['-X','utf8','-c','import json,sys;from backend.spatial import SpatialExperiment,trace;print(json.dumps(trace(SpatialExperiment.model_validate(json.load(sys.stdin)),7)))'],{input:JSON.stringify(input),encoding:'utf-8'}));

test('grating units, finite parameters and old drafts survive persistence without changing other optics',()=>{
  const input=make();input.elements[1].rollDeg=43;
  assert.deepEqual(parseSpatial(JSON.parse(JSON.stringify(input))),input);
  for(const patch of [{gratingSlitUm:11},{gratingPeriodUm:.5},{gratingWidthMm:.01},{gratingHeightMm:0}]){
    assert.throws(()=>parseSpatial({...input,elements:input.elements.map(e=>e.kind==='amplitude-grating'?{...e,...patch}:e)}));
  }
  const old=input.elements[0],{gratingPeriodUm,gratingSlitUm,gratingWidthMm,gratingHeightMm,...legacy}=old;
  assert.deepEqual(parseSpatial({...input,elements:[legacy]}).elements[0],old);
});

test('grating centre guides contain only propagating nonzero orders and rotate with stripe direction',()=>{
  const input=make(),g=input.elements[1];
  const orders=gratingOrderDirections(g,[1,0,0],532),first=orders.find(o=>o.m===1)!;
  assert.ok(Math.abs(first.angleDeg-Math.asin(.0532)*180/Math.PI)<1e-10);
  assert.equal(orders.find(o=>o.m===2)!.efficiency,0);
  const axes=alignmentAxes(input,null).filter(a=>a.previousId===g.id);
  assert.equal(axes.length,orders.filter(o=>o.efficiency>0).length);
  g.rollDeg=90;const frame=geometryFrame(g),rotated=gratingOrderDirections(g,[1,0,0],532).find(o=>o.m===1)!;
  assert.ok(Math.abs(dot3(rotated.direction,frame.u)-.0532)<1e-12);
  assert.ok(Math.abs(rotated.direction[2])<1e-12);assert.ok(Math.abs(rotated.direction[1])>.05);
  input.elements[0].position[2]=3;g.rollDeg=0;
  assert.equal(alignmentAxes(input,null).length,1); // opaque mount outside the clear rectangle
});

test('backend grating results pass frontend validation and reject forged order efficiencies and profile identities',()=>{
  const input=make(),result=simulate(input);
  assert.doesNotThrow(()=>validateSpatialResult(result,7,input));
  const bad=structuredClone(result);bad.gratingOrders[0].orders[1].efficiency=.4;
  assert.throws(()=>validateSpatialResult(bad,7,input),/级次/);
  const duplicate=structuredClone(result);duplicate.gratingOrders.push(duplicate.gratingOrders[0]);
  assert.throws(()=>validateSpatialResult(duplicate,7,input));
  const wrong=structuredClone(result);wrong.diffraction[0].gratingId=input.elements[0].id;
  assert.throws(()=>validateSpatialResult(wrong,7,input));
  const finite=structuredClone(result);finite.diffraction[0].points[0].intensity=Infinity;
  assert.throws(()=>validateSpatialResult(finite,7,input));
});

test('near field intensity uses incident light baseline and can exceed one without frontend clipping',()=>{
  const input=make();Object.assign(input.elements[1],{gratingWidthMm:.1,gratingSlitUm:10});input.elements[2].position[0]=101;input.elements[2].diameterMm=1;
  const result=simulate(input);assert.ok(Math.max(...result.diffraction[0].points.map((p:{intensity:number})=>p.intensity))>1);
  assert.doesNotThrow(()=>validateSpatialResult(result,7,input));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { apertureGeometry, apertureLensShift } from './apertureModel';
import { immediateScene } from './sceneImmediate';
import { defaultScene, type SceneState, type SceneResult } from './sceneRuntime';

function equal(actual:unknown,expected:unknown) {
  if(typeof actual==='number'&&typeof expected==='number'){assert.ok(Math.abs(actual-expected)<1e-8*Math.max(1,Math.abs(expected)),`${actual} != ${expected}`);return;}
  if(Array.isArray(actual)&&Array.isArray(expected)){assert.equal(actual.length,expected.length);actual.forEach((v,i)=>equal(v,expected[i]));return;}
  if(actual&&expected&&typeof actual==='object'&&typeof expected==='object'){assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort());for(const key of Object.keys(actual))equal((actual as Record<string,unknown>)[key],(expected as Record<string,unknown>)[key]);return;}
  assert.equal(actual,expected);
}
test('instant aperture drawings and readings match the independent Python model including pupil singularities',()=>{
  const base=defaultScene('aberrations-0'),states:SceneState[]=[];
  for(const z of [-120,-100,-50,0,50,100,100.0001,200,240])for(const h of [0,20,80])for(const stopD of [2,12,60])states.push({...base,parameters:{...base.parameters,z,h,stopD}});
  let seed=711;
  const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
  for(let i=0;i<60;i++)states.push({...base,parameters:{f:40+80*random(),u:160+440*random(),z:-120+360*random(),lensD:5+75*random(),stopD:2+58*random(),h:80*random()}});
  const reference=spawnSync('python',['-c','import json,sys;from backend.scene_physics import calculate;print(json.dumps([calculate(s) for s in json.load(sys.stdin)],allow_nan=False))'],{input:JSON.stringify(states),encoding:'utf8',maxBuffer:32*1024*1024});
  assert.equal(reference.status,0,reference.stderr);
  const truth=JSON.parse(reference.stdout) as SceneResult[];
  states.forEach((s,i)=>equal({...immediateScene(s),revision:''},truth[i]));
});
test('lens dragging preserves object-to-stop separation and clamps both relative distances',()=>{
  for(const u of [160,200,600])for(const z of [-120,50,240])for(const delta of [-1000,-20,0,20,1000]) {
    const move=apertureLensShift({u,z},delta);
    assert.ok(move.u>=160&&move.u<=600);assert.ok(move.z>=-120&&move.z<=240);
    assert.ok(Math.abs(move.u+move.z-u-z)<1e-12);
    assert.equal(move.shift,move.u-u);
  }
});
test('dragged apertures change throughput while their computed pupils retain the optical meaning',()=>{
  const p=defaultScene('aberrations-0').parameters;
  assert.equal(apertureGeometry(p).fraction,.16);
  assert.equal(apertureGeometry({...p,stopD:6}).fraction,.04);
  assert.deepEqual(apertureGeometry({...p,z:100,stopD:6}).entrance,[null,null]);
  const g=apertureGeometry({...p,z:200,h:80});
  assert.equal(g.fraction,0);assert.equal(g.active,'lens');
});

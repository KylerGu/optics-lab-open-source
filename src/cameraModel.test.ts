import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cameraOptics, immediateCamera } from './cameraModel';
import { defaultScene, readScene, type SceneResult, type SceneState } from './sceneRuntime';
import { OPTICS_FORMULAS, opticsValues } from './opticsKnowledgeModel';

const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(b)),`${a} != ${b}`);
function equal(a:unknown,b:unknown) {
  if(typeof a==='number'&&typeof b==='number'){close(a,b);return;}
  if(Array.isArray(a)&&Array.isArray(b)){assert.equal(a.length,b.length);a.forEach((v,i)=>equal(v,b[i]));return;}
  if(a&&b&&typeof a==='object'&&typeof b==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort());Object.keys(a).forEach(k=>equal((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]));return;}
  assert.equal(a,b);
}
test('four camera views match independent Python calculations over focus, virtual image and infinite depth boundaries',()=>{
  const base=defaultScene('instruments-2'),states:SceneState[]=[];
  for(const study of [0,1,2,3])for(const u of [20,50,50.0001,400,5000])for(const sensor of [10,50,50.001,400/7,300])for(const aperture of [1,50])states.push({...base,parameters:{...base.parameters,study,u,sensor,aperture}});
  const run=spawnSync('python',['-c','import json,sys;from backend.scene_physics import calculate;print(json.dumps([calculate(s) for s in json.load(sys.stdin)],allow_nan=False))'],{input:JSON.stringify(states),encoding:'utf8',maxBuffer:32*1024*1024});
  assert.equal(run.status,0,run.stderr);const truth=JSON.parse(run.stdout) as SceneResult[];
  states.forEach((s,i)=>{const actual=immediateCamera(s);equal({...actual,revision:''},truth[i]);});
});
test('depth boundaries solve ray bundle blur and distinguish shrinking aperture from diffraction',()=>{
  const p=defaultScene('instruments-2').parameters,o=cameraOptics(p);
  close(o.v!,400/7);close(o.focus!,400);close(o.blur,0);
  for(const u of [o.near!,o.far!])close(cameraOptics({...p,u}).blur,p.coc);
  assert.ok(cameraOptics({...p,u:o.near!-.1}).blur>p.coc);
  assert.ok(cameraOptics({...p,u:o.far!+.1}).blur>p.coc);
  const smaller=cameraOptics({...p,aperture:p.aperture/2});
  assert.ok(smaller.near!<o.near!&&smaller.far!>o.far!);close(smaller.airy!,o.airy!*2);
  close(cameraOptics({...p,sensor:65}).blur,1.71875);
  assert.equal(cameraOptics({...p,u:50}).airy,null);
  assert.equal(cameraOptics({...p,sensor:50}).focus,null);
  assert.equal(cameraOptics({...p,sensor:50.001}).far,null);
  close(o.fieldWidth,61.6);close(o.fieldHeight,46.2);close(o.objectPixel,24.15);close(o.nyquist,500/3.45);
});
test('camera formulas import current physical values and old drafts preserve their apparatus',()=>{
  const s=defaultScene('instruments-2'),r=immediateCamera(s);
  for(const id of ['camera-field','camera-depth','camera-diffraction','camera-sampling']) {
    const f=OPTICS_FORMULAS.find(f=>f.id===id)!,values=opticsValues(f,s,r);
    for(const [key,value] of Object.entries(values))close(value,f.fields.find(f=>f.key===key)!.default);
  }
  const old={version:1,sceneId:s.sceneId,parameters:{f:60,u:500,h:30,sensor:70,aperture:8}};
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  try{Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>JSON.stringify(old)}});assert.deepEqual(readScene(s.sceneId).parameters,{...s.parameters,...old.parameters});}
  finally{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else Reflect.deleteProperty(globalThis,'localStorage');}
});

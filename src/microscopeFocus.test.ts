import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {defaultScene,parseScene} from './sceneRuntime';
import {immediateScene} from './sceneImmediate';
import {microscopeFocusDistance,normalizeMicroscope,patchSceneParameters} from './microscopeFocus';

const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8*Math.max(1,Math.abs(b)),`${a} != ${b}`);
test('sample defocus and object distance round-trip through all microscope pages',()=>{
  for(const mode of [0,1]){
    const base=patchSceneParameters(defaultScene('instruments-0'),{mode,u:mode?10:11});
    const moved=patchSceneParameters(base,{defocus:10,study:3});
    close(moved.parameters.u,mode?10.01:11.01);close(moved.parameters.defocus,10);
    assert.equal(moved.parameters.NA,base.parameters.NA);
    for(const study of [0,1,2,3]){
      const viewed=patchSceneParameters(moved,{study});
      close(viewed.parameters.defocus,10);close(viewed.parameters.u,moved.parameters.u);
    }
    const ray=immediateScene(patchSceneParameters(moved,{study:0}))!;
    assert.notEqual(ray.metrics.find(m=>m.key==='v')!.value,mode?200:null);
    const reset=patchSceneParameters(moved,{defocus:0});
    close(reset.parameters.u,base.parameters.u);assert.equal(reset.parameters.defocus,0);
    const far=patchSceneParameters(base,{u:40});
    close(far.parameters.defocus,(40-base.parameters.u)*1000);
    assert.deepEqual(parseScene(far),far);
  }
});

test('saved geometry wins over stale defocus; camera sampling is mode-specific',()=>{
  const base=defaultScene('instruments-0');
  const eye=normalizeMicroscope({...base,parameters:{...base.parameters,u:11.02,defocus:0,depthCriterion:1}});
  close(eye.parameters.defocus,20);assert.equal(eye.parameters.depthCriterion,0);
  const camera=patchSceneParameters(eye,{mode:1,u:10,depthCriterion:1,study:3});
  close(immediateScene(camera)!.metrics.find(m=>m.key==='depth')!.value!,4.3);
  const returned=patchSceneParameters(camera,{mode:0,u:11});
  close(immediateScene(returned)!.metrics.find(m=>m.key==='depth')!.value!,3.4375);
  assert.equal(microscopeFocusDistance({...base.parameters,d:40,f2:40}),null);
  assert.throws(()=>patchSceneParameters({...base,parameters:{...base.parameters,d:40,f2:40}},{defocus:1}));
  assert.throws(()=>patchSceneParameters(camera,{defocus:-90000}));
});

test('browser and assistant use the same focus reference, linked patches and depth results',()=>{
  const base=defaultScene('instruments-0');
  const patches:Record<string,number>[]=[{defocus:10},{u:12},{d:125},{f2:25},{mode:1,u:10,depthCriterion:1},{defocus:-20},{mode:0,u:11,depthCriterion:1},{d:40,f2:40}];
  const run=spawnSync('python',['-c','import json,sys; from backend.scene_microscope_focus import patch_scene_parameters; from backend.scene_physics import calculate; data=json.load(sys.stdin); states=[patch_scene_parameters(data["state"],p) for p in data["patches"]]; print(json.dumps([{"state":s,"metrics":calculate(s)["metrics"]} for s in states]))'],{input:JSON.stringify({state:{...base,parameters:{...base.parameters,study:3}},patches}),encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const truth=JSON.parse(run.stdout);
  patches.forEach((patch,i)=>{
    const state=patchSceneParameters({...base,parameters:{...base.parameters,study:3}},patch);
    for(const key of ['u','defocus','depthCriterion'])close(state.parameters[key],truth[i].state.parameters[key]);
    const metrics=immediateScene(state)!.metrics;
    for(const m of metrics){const expected=truth[i].metrics.find((n:{key:string})=>n.key===m.key).value;if(m.value===null)assert.equal(expected,null);else close(m.value,expected);}
  });
});

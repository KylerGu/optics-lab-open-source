import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScene, parseScene, sceneKey, draftKey, readScene, SCENE_DEFINITIONS } from './sceneRuntime';
import { validateSceneReply } from './sceneAssistantModel';
import { opticsValues, OPTICS_FORMULAS } from './opticsKnowledgeModel';

test('catalog states are isolated and files cannot migrate into another scene',()=>{
  const ids=Object.keys(SCENE_DEFINITIONS);
  assert.equal(new Set(ids.map(draftKey)).size,ids.length);
  for(const id of ids){const s=defaultScene(id);assert.deepEqual(parseScene(JSON.parse(JSON.stringify(s)),id),s);assert.throws(()=>parseScene(s,ids.find(other=>other!==id)));const field=SCENE_DEFINITIONS[id].parameters[0];for(const invalid of [NaN,Infinity,true,'1',field.max+1])assert.throws(()=>parseScene({...s,parameters:{...s.parameters,[field.key]:invalid}}));}
  const a=defaultScene(ids[0]),b=parseScene(a);b.parameters.angle=60;assert.notEqual(sceneKey(a),sceneKey(b));assert.equal(a.parameters.angle,45);
});
test('AI edits require matching source state and matching numerical evidence',()=>{
  const before=defaultScene('paraxial-0'),after={...before,parameters:{...before.parameters,u:150}};
  const evidence={input:after,metrics:[{key:'v',label:'像距',unit:'mm',value:300,note:''}],scope:'理想薄透镜',status:'倒立实像',warnings:[]};
  const reply={requestId:'r',inputSnapshot:before,state:after,changed:true,answer:'物距已调到150 mm。',evidence,scans:[]};
  assert.equal(validateSceneReply(reply,'r',before).state.parameters.u,150);
  assert.throws(()=>validateSceneReply(reply,'stale',before));
  assert.throws(()=>validateSceneReply({...reply,evidence:null},'r',before));
  assert.throws(()=>validateSceneReply({...reply,evidence:{...evidence,input:before}},'r',before));
  assert.throws(()=>validateSceneReply({...reply,changed:false},'r',before));
});
test('prism refraction card correctly uses first interface indices and current incident angle',()=>{
  const values=opticsValues(OPTICS_FORMULAS.find(f=>f.id==='snell-law')!,defaultScene('reflection-refraction-2'));
  assert.equal(values.n1,1);assert.equal(values.n2,1.5);assert.ok(Math.abs(values.i-48.59037789072914)<1e-8);
});

test('existing microscope drafts keep their six physical parameters when new modes are added',()=>{
  const old={version:1,sceneId:'instruments-0',parameters:{f1:12,f2:25,d:145,u:13,h:.2,near:260}};
  const storage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  try {
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>JSON.stringify(old)}});
    const loaded=readScene(old.sceneId);
    for(const [key,value] of Object.entries(old.parameters))assert.equal(loaded.parameters[key],value);
    assert.ok(Math.abs(loaded.parameters.defocus+1000/3)<1e-8);
  } finally {if(storage)Object.defineProperty(globalThis,'localStorage',storage);else Reflect.deleteProperty(globalThis,'localStorage');}
});

test('microscope formula inputs distinguish the first image plane and camera field from final visual magnification',()=>{
  const state=defaultScene('instruments-0');
  const lens=opticsValues(OPTICS_FORMULAS.find(f=>f.id==='thin-lens')!,state);
  assert.ok(Math.abs(lens.v-110)<1e-9);
  const camera={...state,parameters:{...state.parameters,mode:1,u:10}};
  const field=opticsValues(OPTICS_FORMULAS.find(f=>f.id==='microscope-camera-field')!,camera);
  assert.equal(field.M,10);assert.ok(Math.abs(field.L-.88)<1e-9);
});


test('microscope numerical aperture cannot exceed the front medium index',()=>{
 const s=defaultScene('instruments-0');assert.throws(()=>parseScene({...s,parameters:{...s.parameters,NA:1.4,medium:1}}));
 assert.doesNotThrow(()=>parseScene({...s,parameters:{...s.parameters,NA:1.4,medium:1.515}}));
 const depth=OPTICS_FORMULAS.find(f=>f.id==='microscope-depth')!;
 const values=opticsValues(depth,s);assert.equal(values.e,0);assert.ok(Math.abs(values.D-3.4375)<1e-12);
});

test('existing telescope drafts preserve the optical arrangement when study settings are added',()=>{
  const old={version:1,sceneId:'instruments-1',parameters:{f1:250,f2:50,k2:-1,d:200,angle:-.7,aperture:35}};
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>JSON.stringify(old)}});
  try{const restored=readScene('instruments-1');for(const [key,value] of Object.entries(old.parameters))assert.equal(restored.parameters[key],value);assert.equal(restored.parameters.study,0);assert.equal(restored.parameters.eyeDiameter,4);}
  finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else Reflect.deleteProperty(globalThis,'localStorage');}
});

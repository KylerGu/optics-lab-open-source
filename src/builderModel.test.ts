import test from 'node:test';
import './lensPresets.test';
import './amplitudeGrating.test';
import assert from 'node:assert/strict';
import { CATALOG, fromLegacy, makeSpatialElement, parseSpatial, sourceDivergenceMrad, spatialTemplate, toLegacy, validateSpatialResult } from './builderModel';
import { glassIndex, prismIntersection, prismExit, geometryFrame } from './spatialGeometry';
import { makeTemplate } from './model';
import { alignmentAxes, alignedPose, opticalDirection, snapPose } from './spatialAlignment';
import { saveSpatialSnapshot } from './spatialStorage';
import { Box3, Group } from 'three';
import { benchFloorHeight, createSpatialOptic, createSpatialSupport } from './SpatialBench';

test('grid and bench stay below the complete apparatus without moving its optics',()=>{
  for(const rendered of [false,true])for(const y of [0,-80,60]){
    const elements=[makeSpatialElement('laser',[0,y,0]),makeSpatialElement('mirror',[-100,y,200],{diameterMm:100,pitchDeg:35}),makeSpatialElement('screen',[200,y,200])];
    const before=JSON.stringify(elements),devices=new Group();
    elements.forEach(e=>devices.add(createSpatialOptic(e,rendered)));
    const floorY=benchFloorHeight(devices),bounds=new Box3().setFromObject(devices);
    assert.ok(floorY<=bounds.min.y-10);
    assert.ok(floorY<=0);
    assert.equal(JSON.stringify(elements),before);
    for(const element of elements){
      const base=createSpatialSupport(element,floorY).children[0];
      assert.equal(new Box3().setFromObject(base).min.y,floorY);
    }
    if(y===60)assert.equal(floorY,0);
  }
  assert.equal(benchFloorHeight(new Group()),0);
});

test('apparatus share the grid coordinate frame without changing saved positions',()=>{
  for(const item of CATALOG){
    if(!item.kind)continue;
    for(const rendered of [false,true])for(const position of [[0,0,0],[-120,60,300],[850,90,-450]] as const){
      const element=makeSpatialElement(item.kind,[...position]),before=JSON.stringify(element);
      assert.deepEqual(createSpatialOptic(element,rendered).position.toArray(),[...position],item.kind);
      assert.equal(JSON.stringify(element),before);
    }
  }
  const screen=makeSpatialElement('screen',[-120,60,300]),base=createSpatialSupport(screen).children[0];
  assert.equal(base.position.x,screen.position[0]);
  assert.equal(base.position.z,screen.position[2]);
});

test('specimen and sensor holders stay attached through size, relay and orientation changes',()=>{
  for(const kind of ['object','sensor'] as const)for(const angle of [0,35,90])for(const size of [.1,30]){
    const element=makeSpatialElement(kind,[40,100,10],{rollDeg:angle,pitchDeg:angle/2,objectHeightMm:size,objectWidthMm:size*.65,adapterMagnification:size<1?.5:2});
    const before=JSON.stringify(element),optic=createSpatialOptic(element,true),support=createSpatialSupport(element);
    optic.updateMatrixWorld(true);
    const frame=optic.getObjectByName('imaging-holder')!,contact=support.getObjectByName('holder-contact')!;
    const bounds=new Box3().setFromObject(frame);
    assert.ok(bounds.distanceToPoint(contact.position)<1e-6,`${kind} holder has a gap`);
    assert.ok(Math.abs(bounds.min.y-contact.position.y)<2,`${kind} post must reach the lower frame`);
    assert.equal(new Box3().setFromObject(support.getObjectByName('base')!).min.y,0);
    assert.equal(JSON.stringify(element),before);
  }
});

test('every optical catalog entry is supported and extended apparatus parameters survive save and restore',()=>{
  const optical=CATALOG.filter(e=>e.category!=='mount');assert.equal(optical.length,33);assert.ok(optical.every(e=>e.kind));
  const items=optical.filter(e=>e.kind!=='laser').map(item=>makeSpatialElement(item.kind!,[200,60,0],{...item.defaults,rollDeg:30,slitWidthMm:.05,meterRangeMw:12}));
  const input={schemaVersion:2 as const,name:'新器材',elements:items};assert.deepEqual(parseSpatial(JSON.parse(JSON.stringify(input))),input);
  const saved=saveSpatialSnapshot([],null,input);assert.deepEqual(parseSpatial(saved[0].experiment),input);
  for(const patch of [{slitWidthMm:0},{apexAngleDeg:180},{polarization:'circular'},{glass:'unknown'},{meterRangeMw:0}])assert.throws(()=>parseSpatial({...input,elements:[{...items[0],...patch}]}));
});
test('old spatial files migrate new component defaults without changing the existing apparatus',()=>{
  const original=spatialTemplate('focus');const old={...original,elements:original.elements.map(({rollDeg,polarization,polarizationDeg,glass,refractiveIndex,abbeNumber,apexAngleDeg,prismHeightMm,slitWidthMm,slitHeightMm,meterRangeMw,...e})=>e)};
  assert.deepEqual(parseSpatial(old),original);
});
test('3D prism alignment guides follow real entry, internal reflection and exit faces',()=>{
  const laser=makeSpatialElement('laser',[0,60,0]),prism=makeSpatialElement('right-prism',[150,60,0]),screen=makeSpatialElement('screen',[163.3333333333,60,-180],{yawDeg:-90});
  const input={schemaVersion:2 as const,name:'棱镜',elements:[laser,prism,screen]},axes=alignmentAxes(input,screen.id);
  assert.equal(axes.length,4);assert.ok(Math.abs(axes.at(-1)!.direction[2]+1)<1e-9);
  const frame=geometryFrame(prism);assert.deepEqual(frame.n,[1,0,0]);assert.ok(Math.abs(glassIndex(prism,587.6)-1.5168)<.00001);
  const entry=prismIntersection(prism,laser.position,[1,0,0])!;const exit=prismExit(prism,entry,[1,0,0],532)!;assert.equal(exit.path.length,2);
  const pose=alignedPose(input,prism.id)!;assert.equal(pose.yawDeg,undefined); // aligning position must preserve intentional prism angle
  const meter=makeSpatialElement('power-meter',[150,60,0]);assert.equal(alignmentAxes({...input,elements:[laser,meter]},null).length,1);
});
test('cylindrical lens guide changes only the rotated focusing direction and preserves roll on alignment',()=>{
  const source=makeSpatialElement('laser',[0,60,3]),lens=makeSpatialElement('cylindrical-lens',[100,60,0]),screen=makeSpatialElement('screen',[200,60,0]);
  const input={schemaVersion:2 as const,name:'柱面聚焦',elements:[source,lens,screen]};
  const axis=alignmentAxes(input,screen.id).at(-1)!;assert.ok(Math.abs(axis.direction[2])>.02);assert.equal(axis.direction[1],0);
  lens.rollDeg=90;assert.ok(Math.abs(alignmentAxes(input,screen.id).at(-1)!.direction[2])<1e-10);
  assert.equal(alignedPose(input,lens.id)?.rollDeg,undefined);
  assert.equal(toLegacy(input),null);
});
test('PBS appears once in reflection category, with polarization search, and guides both branches',()=>{
  const entries=CATALOG.filter(e=>e.kind==='polarizing-splitter');assert.equal(entries.length,1);assert.equal(entries[0].category,'reflection');assert.ok(entries[0].hint.includes('偏振'));
  const input=spatialTemplate('split');input.elements[1]=makeSpatialElement('polarizing-splitter',input.elements[1].position,{yawDeg:-45});
  const axes=alignmentAxes(input,null);assert.equal(axes.length,3);assert.ok(axes.some(a=>a.direction[2]>.99));
  assert.ok(alignedPose(input,input.elements[1].id)?.yawDeg!==undefined);
  input.elements[1].pTransmission=0;input.elements[1].sTransmission=0;assert.equal(alignmentAxes(input,null).length,2);
});
test('meter evidence cannot show an invented reading or conceal overload',()=>{
  const meter=makeSpatialElement('power-meter',[150,60,0],{meterRangeMw:1}),input={schemaVersion:2 as const,name:'读数',elements:[meter]};
  const screen={elementId:meter.id,name:meter.name,hits:1,sampledPowerFraction:1,sampledPowerMw:10,centroid:meter.position,footprintRadiusMm:0,gaussianRadiusMm:null,detectorKind:'power-meter' as const,readingMw:null,overRange:true};
  const result={revision:0,inputSnapshot:input,model:'test',segments:[],beams:[],screens:[screen],warnings:[],assumptions:[],chiefHitIds:[]};
  assert.doesNotThrow(()=>validateSpatialResult(result,0,input));assert.throws(()=>validateSpatialResult({...result,screens:[{...screen,readingMw:10,overRange:false}]},0,input));
});

test('old scene copies preserve positions and optical parameters in a separate spatial document',()=>{
  const original=makeTemplate('focus'),copy=fromLegacy(original);
  assert.deepEqual(toLegacy(copy),original);
  copy.elements[1].position[1]=100;
  assert.equal(toLegacy(copy),null);
  assert.equal(original.elements[1].positionMm,250);
  assert.deepEqual(parseSpatial(copy),copy);
});
test('spatial documents preserve mirrors, splitting and full poses during export/import',()=>{
  for(const kind of ['empty','focus','fold','split'] as const){
    const original=spatialTemplate(kind);
    assert.deepEqual(parseSpatial(JSON.parse(JSON.stringify(original))),original);
  }
  assert.equal(toLegacy(spatialTemplate('fold')),null);
  assert.equal(toLegacy(spatialTemplate('split')),null);
});
test('invalid positions, duplicate ids, zero focal length and excess sources are rejected',()=>{
  const input=spatialTemplate('focus');
  assert.throws(()=>parseSpatial({...input,elements:[...input.elements,input.elements[0]]}));
  assert.throws(()=>parseSpatial({...input,elements:input.elements.map(e=>({...e,position:[NaN,60,0]}))}));
  assert.throws(()=>parseSpatial({...input,elements:input.elements.map(e=>({...e,focalLengthMm:0}))}));
  const source=input.elements[0];
  assert.throws(()=>parseSpatial({...input,elements:Array.from({length:4},(_,i)=>({...source,id:String(i)}))}));
});
test('existing spatial drafts get source defaults, while custom source settings survive import',()=>{
  const current=spatialTemplate('fold');
  const old={...current,elements:current.elements.map(({powerMw,divergenceMrad,rayCount,...rest})=>rest)};
  assert.deepEqual(parseSpatial(old),current);
  Object.assign(current.elements[0],{powerMw:78,divergenceMrad:12.5,rayCount:31});
  assert.deepEqual(parseSpatial(JSON.parse(JSON.stringify(current))),current);
  for(const patch of [{powerMw:-1},{divergenceMrad:101},{rayCount:1.2},{rayCount:202}]){
    assert.throws(()=>parseSpatial({...current,elements:[{...current.elements[0],...patch}]}));
  }
});
test('ideal Gaussian divergence follows wavelength and waist instead of the geometric control',()=>{
  const source=spatialTemplate('focus').elements[0];
  Object.assign(source,{wavelengthNm:532,beamRadiusMm:.2,divergenceMrad:10});
  assert.equal(sourceDivergenceMrad(source),.532/(Math.PI*.2));
  source.beamRadiusMm=.4;
  assert.equal(sourceDivergenceMrad(source),.532/(Math.PI*.4));
  source.beamModel='parallel';
  assert.equal(sourceDivergenceMrad(source),10);
});
test('saving an opened apparatus updates the same entry and copies the latest values',()=>{
  const apparatus=spatialTemplate('focus'),first=saveSpatialSnapshot([],null,apparatus);
  const id=first[0].id;
  apparatus.elements[1].position[1]=68;
  apparatus.elements[1].focalLengthMm=125;
  const updated=saveSpatialSnapshot(first,id,apparatus);
  assert.equal(updated.length,1);assert.equal(updated[0].id,id);
  assert.equal(updated[0].experiment.elements[1].position[1],68);
  assert.equal(updated[0].experiment.elements[1].focalLengthMm,125);
  assert.equal(first[0].experiment.elements[1].position[1],60);
  apparatus.elements[1].position[1]=90;
  assert.equal(updated[0].experiment.elements[1].position[1],68);
  const copy=saveSpatialSnapshot(updated,null,apparatus);
  assert.equal(copy.length,2);assert.notEqual(copy[0].id,id);
});
test('a full archive can still update an existing apparatus without replacing others',()=>{
  const base=spatialTemplate('fold'),rows=Array.from({length:40},(_,i)=>({id:String(i),savedAt:new Date().toISOString(),experiment:base}));
  assert.equal(saveSpatialSnapshot(rows,'20',base).length,40);
  assert.throws(()=>saveSpatialSnapshot(rows,null,base));
});
test('optical alignment projects onto the incoming ray while preserving axial spacing',()=>{
  const apparatus=spatialTemplate('focus'),lens=apparatus.elements[1];
  Object.assign(lens,{position:[300,69,7],yawDeg:18,pitchDeg:14});
  const pose=alignedPose(apparatus,lens.id)!;
  assert.deepEqual(pose.position,[300,60,0]);
  assert.equal(pose.yawDeg,0);assert.equal(pose.pitchDeg,0);
  const tilted=spatialTemplate('empty');
  const source={...apparatus.elements[0],yawDeg:35,pitchDeg:25};
  const direction=opticalDirection(source);
  const screen={...apparatus.elements[2],position:source.position.map((x,i)=>x+200*direction[i]+(i===1?4:0)) as [number,number,number]};
  tilted.elements=[source,screen];
  const aligned=alignedPose(tilted,screen.id)!;
  assert.ok(Math.abs(aligned.yawDeg!-35)<1e-9);assert.ok(Math.abs(aligned.pitchDeg!-25)<1e-9);
});
test('folded and split guides keep their 3D branches when aligning apparatus',()=>{
  const fold=spatialTemplate('fold'),screen=fold.elements[3];
  Object.assign(screen,{position:[285,250,94],yawDeg:35,pitchDeg:12});
  const pose=alignedPose(fold,screen.id)!;
  assert.ok(Math.abs(pose.position![0]-280)<1e-9);
  assert.ok(Math.abs(pose.position![2]-90)<1e-9);
  assert.ok(Math.abs(pose.position![1]-250)<1e-9);
  assert.ok(Math.abs(pose.pitchDeg!-90)<1e-9);
  const fold2=spatialTemplate('fold'),mirror=fold2.elements[2];
  Object.assign(mirror,{position:[283,66,90],yawDeg:40,pitchDeg:20});
  const restored=alignedPose(fold2,mirror.id)!;
  assert.ok(Math.abs(restored.position![0]-280)<1e-9);
  assert.ok(Math.abs(restored.position![1]-60)<1e-9);
  assert.ok(Math.abs(restored.yawDeg!-90)<1e-9);assert.ok(Math.abs(restored.pitchDeg!+45)<1e-9);
  const split=spatialTemplate('split'),branch=split.elements[3];
  Object.assign(branch,{position:[265,63,175]});
  const branchPose=alignedPose(split,branch.id)!;
  assert.ok(Math.abs(branchPose.position![0]-260)<1e-9);
  assert.ok(Math.abs(branchPose.position![1]-60)<1e-9);
  assert.ok(Math.abs(branchPose.position![2]-175)<1e-9);
});
test('drag snapping affects nearby poses only and guides do not follow the selected device',()=>{
  const apparatus=spatialTemplate('focus'),lens=apparatus.elements[1],axes=alignmentAxes(apparatus,lens.id);
  assert.deepEqual(snapPose(apparatus,lens.id,{position:[280,65,0]},'translate',axes).position,[280,60,0]);
  assert.deepEqual(snapPose(apparatus,lens.id,{position:[280,67,0]},'translate',axes).position,[280,67,0]);
  assert.equal(snapPose(apparatus,lens.id,{yawDeg:1,pitchDeg:0},'rotate',axes).yawDeg,0);
  assert.equal(snapPose(apparatus,lens.id,{yawDeg:4,pitchDeg:0},'rotate',axes).yawDeg,4);
  lens.position=[290,80,10];
  assert.deepEqual(alignmentAxes(apparatus,lens.id),axes);
});
test('a source can aim at the nearest apparatus and guide reflection loops are bounded',()=>{
  const apparatus=spatialTemplate('focus'),source=apparatus.elements[0];
  Object.assign(source,{yawDeg:70,pitchDeg:-20});
  assert.deepEqual(alignedPose(apparatus,source.id),{yawDeg:0,pitchDeg:0});
  const isolated={...apparatus,elements:[source]};
  assert.equal(alignedPose(isolated,source.id),null);
  const loop=spatialTemplate('fold');
  loop.elements[0].position=[150,60,0];loop.elements[0].yawDeg=0;
  Object.assign(loop.elements[1],{position:[280,60,0],yawDeg:0});
  Object.assign(loop.elements[2],{position:[70,60,0],yawDeg:0,pitchDeg:0});
  assert.ok(alignmentAxes(loop,null).length<=16);
});

test('detector hit coordinates tolerate rounding and the surface beyond placement bounds',()=>{
  const device=spatialTemplate('focus'),screen=device.elements.find(e=>e.kind==='screen')!;
  screen.position=[1000,1000,0];
  const result={revision:0,inputSnapshot:device,model:'test',segments:[],beams:[],screens:[{elementId:screen.id,name:screen.name,hits:1,sampledPowerFraction:1,sampledPowerMw:1,centroid:[1000.0000000000001,1005,0],footprintRadiusMm:0,gaussianRadiusMm:2}],warnings:[],assumptions:[],chiefHitIds:[]};
  assert.doesNotThrow(()=>validateSpatialResult(result,0,device));
  for(const x of [NaN,Infinity,1200]){
    const invalid=structuredClone(result);invalid.screens[0].centroid[0]=x;
    assert.throws(()=>validateSpatialResult(invalid,0,device),/观察屏数据无效/);
  }
  const invalidDevice=structuredClone(device);invalidDevice.elements.find(e=>e.kind==='screen')!.position[0]=1001;
  assert.throws(()=>parseSpatial(invalidDevice));
});

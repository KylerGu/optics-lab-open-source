import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSpatialElement, parseSpatial, CATALOG, fromLegacy, toLegacy, validateSpatialResult, type Vec3 } from './builderModel';
import { makeTemplate } from './model';
import { SPHERICAL_KINDS, lensProfile, lensSurfaces, lensFocalLengths, lensIntersection, lensExit } from './sphericalLensGeometry';
import { geometryFrame, add3, mul3, sub3, dot3 } from './spatialGeometry';
import { alignmentAxes, alignedPose } from './spatialAlignment';
import { saveSpatialSnapshot } from './spatialStorage';
import { validateSpatialAgentReply } from './spatialAgent';

test('six real spherical shapes have consistent surfaces, independent thick lens focal lengths and serialization',()=>{
  for(const kind of SPHERICAL_KINDS){
    const e=makeSpatialElement(kind,[100,60,0],{glass:'custom',refractiveIndex:1.5}),[front,back]=lensSurfaces(e,10),profile=lensProfile(e);
    assert.equal(profile[0][1],-2.5);assert.equal(profile.at(-1)![1],2.5);
    assert.ok(kind.includes('convex')||kind==='positive-meniscus-lens'?back-front<5:back-front>5);
    const focal=lensFocalLengths(e);
    const expected=kind.endsWith('meniscus-lens')?1/((kind==='positive-meniscus-lens'?.005:-.005)+5/1.5*.00005):kind.startsWith('plano')?(kind.includes('convex')?100:-100):1/((kind.includes('convex')?.01:-.01)-5/1.5*.000025);
    assert.ok(Math.abs(focal.effective!-expected)<1e-8);
    const input={schemaVersion:2 as const,name:kind,elements:[e]};assert.deepEqual(parseSpatial(JSON.parse(JSON.stringify(input))),input);
    assert.deepEqual(parseSpatial(saveSpatialSnapshot([],null,input)[0].experiment),input);assert.equal(toLegacy(input),null);
    assert.equal(CATALOG.find(item=>item.kind===kind)?.lensGroup,'spherical');
  }
});

test('meniscus shape and power cannot silently switch type; missing fields use matching defaults',()=>{
  for(const kind of ['positive-meniscus-lens','negative-meniscus-lens'] as const){
    const lens=makeSpatialElement(kind),input={schemaVersion:2 as const,name:'弯月',elements:[lens]};
    assert.equal(lens.frontRadiusMm,kind==='positive-meniscus-lens'?50:100);assert.equal(lens.backRadiusMm,kind==='positive-meniscus-lens'?100:50);
    const {frontRadiusMm,backRadiusMm,centerThicknessMm,...old}=lens;
    assert.deepEqual(parseSpatial({...input,elements:[old]}),input);
    assert.throws(()=>parseSpatial({...input,elements:[{...lens,frontRadiusMm:backRadiusMm,backRadiusMm:frontRadiusMm}]}));
    assert.throws(()=>parseSpatial({...input,elements:[{...lens,backRadiusMm:12.5}]}));
  }
  const lens=makeSpatialElement('negative-meniscus-lens',undefined,{frontRadiusMm:100,backRadiusMm:95,centerThicknessMm:20});
  assert.throws(()=>parseSpatial({schemaVersion:2,name:'负弯月变正',elements:[lens]}));
});

test('curved surface guide focus agrees with analytic rear focal length in arbitrary 3D pose',()=>{
  for(const kind of SPHERICAL_KINDS){
    const lens=makeSpatialElement(kind,[20,120,-80],{yawDeg:43,pitchDeg:27,rollDeg:61}),{n,u}=geometryFrame(lens);
    const start=add3(add3(lens.position,mul3(n,-100)),mul3(u,.001));
    const entry=lensIntersection(lens,start,n)!;assert.equal(entry.face,'front');
    const exit=lensExit(lens,entry,n,587.56)!;assert.equal(exit.path.length,1);
    const actual=-dot3(sub3(exit.origin,lens.position),u)/dot3(exit.direction,u)*dot3(exit.direction,n);
    assert.ok(Math.abs(actual-lensFocalLengths(lens).back!)<1e-5);
    const source=makeSpatialElement('laser',start,{yawDeg:43,pitchDeg:27,wavelengthNm:587.56});
    const screen=makeSpatialElement('screen',add3(lens.position,mul3(n,200)),{yawDeg:43,pitchDeg:27});
    const input={schemaVersion:2 as const,name:'偏轴三维',elements:[source,lens,screen]},axes=alignmentAxes(input,screen.id);
    assert.equal(axes.length,3);assert.ok(Math.hypot(...sub3(axes[1].end,exit.origin))<1e-8);
    assert.ok(Math.hypot(...sub3(axes[2].direction,exit.direction))<1e-8);
    const pose=alignedPose(input,lens.id)!;assert.equal(pose.frontRadiusMm,undefined);assert.equal(pose.centerThicknessMm,undefined);
  }
});

test('invalid radii and crossing surfaces are rejected; rim absorbs; flipping changes marginal focus',()=>{
  const lens=makeSpatialElement('plano-convex-lens',[100,60,0]);
  for(const patch of [{frontRadiusMm:12.5},{frontRadiusMm:NaN},{centerThicknessMm:1},{glass:'custom',refractiveIndex:1}])assert.throws(()=>parseSpatial({schemaVersion:2,name:'坏透镜',elements:[{...lens,...patch}]}));
  const rim=lensIntersection(lens,[100,60,-30],[0,0,1])!;assert.equal(rim.face,'edge');assert.equal(lensExit(lens,rim,[0,0,1],532),null);
  const focus=(e:typeof lens)=>{const start:Vec3=[0,60,8],incoming:Vec3=[1,0,0],entry=lensIntersection(e,start,incoming)!;const exit=lensExit(e,entry,incoming,532)!;return exit.origin[0]-exit.origin[2]/exit.direction[2]*exit.direction[0];};
  assert.ok(Math.abs(focus(lens)-focus({...lens,yawDeg:180}))>.5);
});

test('old saved apparatus gains harmless defaults and keeps the old lens and Gaussian inputs',()=>{
  const legacy=makeTemplate('focus'),copy=fromLegacy(legacy);
  const old={...copy,elements:copy.elements.map(({frontRadiusMm,backRadiusMm,centerThicknessMm,...e})=>e)};
  assert.deepEqual(parseSpatial(old),copy);assert.deepEqual(toLegacy(copy),legacy);
});

test('Agent focal evidence is recomputed from shape, and curvature scan survives client validation',()=>{
  const lens=makeSpatialElement('plano-convex-lens',[100,60,0]),source=makeSpatialElement('laser',[0,60,0]),screen=makeSpatialElement('screen',[200,60,0]);
  const input={schemaVersion:2 as const,name:'焦距',elements:[source,lens,screen]};
  const read={elementId:screen.id,name:screen.name,hits:1,sampledPowerFraction:.92,sampledPowerMw:9.2,centroid:screen.position,footprintRadiusMm:0,gaussianRadiusMm:null};
  const evidence={revision:0,inputSnapshot:input,model:'球面透镜',segments:[],beams:[],screens:[read],warnings:[],assumptions:[],chiefHitIds:[lens.id,screen.id]};
  assert.doesNotThrow(()=>validateSpatialResult(evidence,0,input));
  const criterion={label:'参考焦距',metric:'lens_focal_mm',elementId:lens.id,operator:'eq',value:lensFocalLengths(lens).effective!,tolerance:.001,radiusModel:'sampled'};
  const reply={requestId:'sphere',inputSnapshot:input,experiment:input,changed:false,applyAllowed:false,answer:'实际曲面',trace:[],checks:[{criterion,actual:criterion.value,passed:true}],comparisons:[{comparisonId:'comparison-1',inputSnapshot:input,elementId:lens.id,field:'frontRadiusMm',rows:[50,75,100].map(value=>({value,screens:[read],warnings:[],error:null}))}],evidence};
  assert.doesNotThrow(()=>validateSpatialAgentReply(reply,'sphere',input));
  const forged=structuredClone(reply);forged.checks[0].actual=100;forged.checks[0].criterion.value=100;
  assert.throws(()=>validateSpatialAgentReply(forged,'sphere',input));
});

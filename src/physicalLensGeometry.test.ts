import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG,makeSpatialElement,parseSpatial,fromLegacy,toLegacy,type Vec3 } from './builderModel';
import { makeTemplate } from './model';
import { ASPHERIC_KINDS,CYLINDER_KINDS,physicalLensIntersection,physicalLensExit,physicalFocalLengths,physicalLensSurfaces } from './physicalLensGeometry';
import { geometryFrame,add3,mul3,sub3,dot3 } from './spatialGeometry';
import { alignmentAxes } from './spatialAlignment';
import { saveSpatialSnapshot } from './spatialStorage';
import { validateSpatialAgentReply } from './spatialAgent';

test('four real profile lens cards, parameters and old documents round trip independently',()=>{
  for(const kind of [...ASPHERIC_KINDS,...CYLINDER_KINDS]){
    const lens=makeSpatialElement(kind,[100,60,0],{conicConstant:-2,asphericA4:1e-7,asphericA6:1e-9,cylinderWidthMm:20,cylinderHeightMm:18,rollDeg:30});
    const input={schemaVersion:2 as const,name:kind,elements:[lens]};assert.deepEqual(parseSpatial(JSON.parse(JSON.stringify(input))),input);
    assert.deepEqual(parseSpatial(saveSpatialSnapshot([],null,input)[0].experiment),input);assert.equal(toLegacy(input),null);
    assert.equal(CATALOG.find(item=>item.kind===kind)?.lensGroup,kind.startsWith('aspheric')?'aspheric':'cylindrical');
  }
  const legacy=makeTemplate('focus'),copy=fromLegacy(legacy),old={...copy,elements:copy.elements.map(({conicConstant,asphericA4,asphericA6,cylinderWidthMm,cylinderHeightMm,...e})=>e)};
  assert.deepEqual(parseSpatial(old),copy);assert.deepEqual(toLegacy(copy),legacy);
});

test('hyperbolic asphere focuses all heights at the independent Fermat focus',()=>{
  const lens=makeSpatialElement('aspheric-convex-lens',[100,60,0],{yawDeg:180,glass:'custom',refractiveIndex:1.5,conicConstant:-2.25});
  for(const r of [0,.1,2,8,12]){
    const incoming:Vec3=[1,0,0],entry=physicalLensIntersection(lens,[0,60,r],incoming)!,exit=physicalLensExit(lens,entry,incoming,587.56)!;
    const focus=add3(exit.origin,mul3(exit.direction,(202.5-exit.origin[0])/exit.direction[0]));
    assert.ok(Math.hypot(...sub3(focus,[202.5,60,0]))<1e-8);
  }
});

test('polynomial ray normal and reciprocal path use the actual profile',()=>{
  const lens=makeSpatialElement('aspheric-convex-lens',[100,60,0],{conicConstant:-1,asphericA4:1e-6,asphericA6:1e-9}),incoming:Vec3=[1,0,0];
  const entry=physicalLensIntersection(lens,[0,60,6],incoming)!;
  assert.ok(Math.abs(entry.hit[0]-(97.5+36/100+1e-6*6**4+1e-9*6**6))<1e-8);
  assert.ok(Math.abs(entry.normal[2]/-entry.normal[0]-(6/50+4e-6*6**3+6e-9*6**5))<1e-10);
  const exit=physicalLensExit(lens,entry,incoming,587.56)!,reverseIncoming=mul3(exit.direction,-1),reverseEntry=physicalLensIntersection(lens,add3(exit.origin,mul3(exit.direction,30)),reverseIncoming)!,reverse=physicalLensExit(lens,reverseEntry,reverseIncoming,587.56)!;
  assert.ok(Math.hypot(...sub3(reverse.origin,entry.hit))<1e-7);assert.ok(Math.hypot(...sub3(reverse.direction,[-1,0,0]))<1e-8);
  const grazing=physicalLensIntersection(lens,[98,60,-20],[0,0,1])!;assert.equal(grazing.face,'front');
});

test('cylindrical guides bend only the rotated curvature axis and respect finite rectangles',()=>{
  for(const kind of CYLINDER_KINDS)for(const roll of [0,45,90]){
    const lens=makeSpatialElement(kind,[100,60,0],{rollDeg:roll,glass:'custom',refractiveIndex:1.5}),{n,u,v}=geometryFrame(lens),start=add3(add3(lens.position,mul3(n,-100)),add3(mul3(u,.001),mul3(v,3)));
    const entry=physicalLensIntersection(lens,start,n)!,exit=physicalLensExit(lens,entry,n,587.56)!;
    assert.ok(Math.abs(dot3(sub3(exit.origin,lens.position),v)-3)<1e-8);assert.ok(Math.abs(dot3(exit.direction,v))<1e-10);
    const focus=-dot3(sub3(exit.origin,lens.position),u)/dot3(exit.direction,u)*dot3(exit.direction,n);
    assert.ok(Math.abs(focus-physicalFocalLengths(lens).back!)<1e-5);
    const source=makeSpatialElement('laser',start,{wavelengthNm:587.56}),screen=makeSpatialElement('screen',[300,60,0]),input={schemaVersion:2 as const,name:'柱面辅助线',elements:[source,lens,screen]};
    const axes=alignmentAxes(input,screen.id);assert.equal(axes.length,3);assert.ok(Math.hypot(...sub3(axes[2].direction,exit.direction))<1e-8);
  }
  const narrow=makeSpatialElement('plano-convex-cylinder-lens',[100,60,0],{cylinderWidthMm:8,cylinderHeightMm:6});
  assert.equal(physicalLensIntersection(narrow,[0,64,0],[1,0,0]),null);
  const rim=physicalLensIntersection(narrow,[100,70,0],[0,-1,0])!;assert.equal(rim.face,'edge');assert.equal(physicalLensExit(narrow,rim,[0,-1,0],532),null);
});

test('invalid conic domains, surface reversals and intersecting solids are rejected',()=>{
  for(const patch of [{conicConstant:10,frontRadiusMm:20},{asphericA4:-.001},{asphericA6:NaN},{centerThicknessMm:1}])assert.throws(()=>parseSpatial({schemaVersion:2,name:'坏曲面',elements:[makeSpatialElement('aspheric-convex-lens',undefined,patch)]}));
  assert.throws(()=>parseSpatial({schemaVersion:2,name:'坏柱面',elements:[makeSpatialElement('plano-convex-cylinder-lens',undefined,{frontRadiusMm:12})]}));
  assert.deepEqual(physicalLensSurfaces(makeSpatialElement('aspheric-convex-lens'),0),[-2.5,2.5]);
});

test('Agent scans of small polynomial coefficients keep precision and focal verification',()=>{
  const lens=makeSpatialElement('aspheric-convex-lens',[100,60,0]),input={schemaVersion:2 as const,name:'曲面扫描',elements:[lens]},f=physicalFocalLengths(lens).effective!;
  const criterion={label:'参考焦距',metric:'lens_focal_mm',elementId:lens.id,operator:'eq',value:f,tolerance:.001,radiusModel:'sampled'};
  const reply={requestId:'profile',inputSnapshot:input,experiment:input,changed:false,applyAllowed:false,answer:'实际曲面',trace:[],checks:[{criterion,actual:f,passed:true}],comparisons:[{comparisonId:'comparison-1',inputSnapshot:input,elementId:lens.id,field:'asphericA6',rows:[0,1e-10,2e-10].map(value=>({value,screens:[],warnings:[],error:null}))}],evidence:null};
  assert.doesNotThrow(()=>validateSpatialAgentReply(reply,'profile',input));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {TEACHING_LENSES,designLensFocal,lensCatalogItem,lensSpecification,resizeLens,readMyLenses,saveMyLens,MY_LENSES_KEY} from './lensPresets';
import {makeSpatialElement,parseSpatial,type SpatialExperiment} from './builderModel';
import {physicalFocalLengths,physicalLensIntersection,physicalLensExit,isSolidCylinder} from './physicalLensGeometry';
import {glassIndex} from './spatialGeometry';
import {lensRadii} from './sphericalLensGeometry';
import {validateSpatialAgentReply} from './spatialAgent';

test('thirty teaching specifications have independent focal lengths and preserve real geometry',()=>{
  assert.equal(TEACHING_LENSES.length,30);const counts=new Map<string,number>();
  for(const p of TEACHING_LENSES){const item=lensCatalogItem(p),e=makeSpatialElement(item.kind!,[80,70,20],item.defaults),doc={schemaVersion:2 as const,name:'预设',elements:[e]};
    assert.deepEqual(parseSpatial(JSON.parse(JSON.stringify(doc))),doc);assert.ok(e.id&&e.id!==p.id);assert.deepEqual(e.position,[80,70,20]);
    const n=glassIndex(e,587.56),[r1,r2]=e.kind.includes('aspheric')||isSolidCylinder(e.kind)?[(e.kind.includes('convex')?1:-1)*e.frontRadiusMm,0]:lensRadii(e),power=(n-1)/r1+(r2?(1-n)/r2:0)-e.centerThicknessMm/n*((n-1)/r1)*(r2?(1-n)/r2:0);
    assert.ok(Math.abs(1/power-p.focalMm)<1e-7);assert.equal(lensSpecification(e)?.label,'教学预设');assert.equal(lensSpecification({...e,position:[500,80,40],yawDeg:180})?.label,'教学预设');assert.equal(lensSpecification({...e,frontRadiusMm:e.frontRadiusMm+1}),null);
    counts.set(e.kind,(counts.get(e.kind)??0)+1);
  }assert.equal(counts.size,10);assert.ok([...counts.values()].every(n=>n===3));
});
test('target focal design locks thickness, glass, curve ratio and wavelength, rejecting impossible requests',()=>{
  for(const p of TEACHING_LENSES){const e=p.element,target=p.focalMm*1.2,patch=designLensFocal(e,target,650),next={...e,...patch};assert.ok(Math.abs(physicalFocalLengths(next,650).effective!-target)<1e-7);assert.equal(next.centerThicknessMm,e.centerThicknessMm);assert.equal(next.glass,e.glass);if(patch.backRadiusMm)assert.ok(Math.abs(next.backRadiusMm/next.frontRadiusMm-e.backRadiusMm/e.frontRadiusMm)<1e-10);assert.ok(Math.abs(physicalFocalLengths(next,532).effective!-target)>.01);}
  const e=makeSpatialElement('plano-convex-lens');assert.throws(()=>designLensFocal(e,-100));assert.throws(()=>designLensFocal(e,1));assert.throws(()=>designLensFocal(e,NaN));assert.throws(()=>designLensFocal(e,0));
});
test('old documents keep full aperture; resize tracks full openings and clamps custom openings',()=>{
  const e=makeSpatialElement('plano-convex-lens',undefined,{diameterMm:35}),{clearApertureMm,clearWidthMm,clearHeightMm,...old}=e;
  const restored=parseSpatial({schemaVersion:2,name:'旧装置',elements:[old]}).elements[0];assert.equal(restored.clearApertureMm,35);
  assert.deepEqual(resizeLens(e,{diameterMm:40}),{diameterMm:40,clearApertureMm:40});assert.deepEqual(resizeLens({...e,clearApertureMm:20},{diameterMm:18}),{diameterMm:18,clearApertureMm:18});assert.deepEqual(resizeLens({...e,clearApertureMm:20},{diameterMm:40}),{diameterMm:40,clearApertureMm:20});
  assert.throws(()=>parseSpatial({schemaVersion:2,name:'越界',elements:[{...e,clearApertureMm:36}]}));
  const cylinder=makeSpatialElement('plano-convex-cylinder-lens',undefined,{cylinderWidthMm:18,cylinderHeightMm:12});assert.equal(cylinder.clearWidthMm,18);assert.equal(cylinder.clearHeightMm,12);
});
test('construction guides stop at blocked entry or exit rather than passing through masked glass',()=>{
  const e=makeSpatialElement('plano-concave-lens',[100,60,0],{clearApertureMm:2,centerThicknessMm:20});
  const entry=physicalLensIntersection(e,[0,60,.99],[1,0,0])!;assert.ok(entry);assert.equal(physicalLensExit(e,entry,[1,0,0],587.56),null);
  const blocked=physicalLensIntersection(e,[0,60,3],[1,0,0])!;assert.equal(physicalLensExit(e,blocked,[1,0,0],587.56),null);
  const open={...e,clearApertureMm:25};assert.ok(physicalLensExit(open,blocked,[1,0,0],587.56));
});
test('my lenses persist only valid optical specifications and do not reuse device identity or pose',()=>{
  const map=new Map<string,string>(),previous=globalThis.localStorage;Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v)}});
  try{const e=makeSpatialElement('aspheric-convex-lens',[800,100,20],{name:'我的非球面',yawDeg:180,clearApertureMm:20,asphericA6:1e-9});const rows=saveMyLens(e);assert.equal(rows.length,1);assert.deepEqual(rows[0].element.position,[0,60,0]);assert.equal(rows[0].element.yawDeg,0);assert.equal(readMyLenses()[0].element.asphericA6,1e-9);assert.equal(lensSpecification(e,rows)?.label,'我的镜片');assert.equal(saveMyLens({...e,centerThicknessMm:6}).length,1);map.set(MY_LENSES_KEY,'broken');assert.throws(()=>saveMyLens(e));assert.equal(map.get(MY_LENSES_KEY),'broken');}
  finally{Object.defineProperty(globalThis,'localStorage',{configurable:true,value:previous});}
});
test('Agent aperture evidence and automatic resize scans survive independent client validation',()=>{
  const e=makeSpatialElement('plano-convex-lens',[100,60,0]),input:SpatialExperiment={schemaVersion:2,name:'扫描',elements:[e]},comparison={comparisonId:'comparison-1',elementId:e.id,field:'diameterMm',inputSnapshot:input,rows:[18,20,25].map(value=>({value,error:null,screens:[],warnings:[]}))};
  const reply={requestId:'aperture',inputSnapshot:input,experiment:input,evidence:{revision:0,inputSnapshot:input,model:'test',segments:[],beams:[],screens:[],warnings:[],assumptions:[],chiefHitIds:[]},checks:[],comparisons:[comparison],changed:false,applyAllowed:false,answer:'扫描完成',trace:[]};
  assert.equal(validateSpatialAgentReply(reply,'aperture',input).comparisons.length,1);
  for(const field of ['clearApertureMm','clearWidthMm','clearHeightMm']){const scan={...comparison,field,rows:[1,2,3].map(value=>({value,error:null,screens:[],warnings:[]}))};assert.equal(validateSpatialAgentReply({...reply,comparisons:[scan]},'aperture',input).comparisons.length,1);}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import { DEFAULT_FOUR_F, fourF, fourFState, fourFHistory, parseFourF, fourFTarget, fourFBuilderCopy } from './fourF';
import {parseSpatial,validateSpatialResult} from './builderModel';
import {spatialFourFParameters} from './spatialFourF';
import { OPTICS_FORMULAS,opticsValues } from './opticsKnowledgeModel';
const close=(a:number,b:number,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance,`${a} differs from ${b}`);
test('4f full-pass field, complement masks, common intensity scale and whole-plane transmission',()=>{
  const p=DEFAULT_FOUR_F,low=fourF(p),high=fourF({...p,filterMode:1}),all=fourF({...p,filterMode:2});
  close(low.transmission,2/3);close(high.transmission,1/3);close(low.observation,.25);close(all.observation,1);
  for(const x of [0,.03,.2,1,3]){const a=low.amplitude(x),b=high.amplitude(x);close(a[0]+b[0],all.input(-x),1e-12);close(a[1]+b[1],0,1e-12);close(all.at(x),all.input(-x)**2,1e-12);close(low.at(x,.3),low.at(x)*Math.exp(-2*(.3/p.waistMm)**2),1e-12);}
  for(const filterOffsetUm of [-2200,0,399,2200])for(const filterWidthUm of [10,200,5000])for(const waistMm of [.5,2]){
    const q={...p,filterOffsetUm,filterWidthUm,waistMm},a=fourF(q),b=fourF({...q,filterMode:1});close(a.transmission+b.transmission,1,1e-12);assert.ok(a.transmission>=0&&a.transmission<=1);
  }
  assert.equal(fourF({...p,modulation:0}).at(.3),fourF({...p,modulation:0,periodMm:.4}).at(.3));
});
test('4f copied devices run through the real builder API model and reject stale wave evidence',()=>{
  for(const filterMode of [0,1,2]){
    const p={...DEFAULT_FOUR_F,filterMode,observationMm:.21},input=fourFBuilderCopy(p);
    const result=JSON.parse(execFileSync('python',['-X','utf8','-c','import json,sys;from backend.spatial import SpatialExperiment,trace;print(json.dumps(trace(SpatialExperiment.model_validate(json.load(sys.stdin)),7)))'],{input:JSON.stringify(input),encoding:'utf-8'}));
    assert.doesNotThrow(()=>validateSpatialResult(result,7,input));close(result.fourF.transmission,fourF(p).transmission);close(result.fourF.pointIntensity,fourF(p).observation);
    const forged=structuredClone(result);forged.fourF.parameters.modulation=0;assert.throws(()=>validateSpatialResult(forged,7,input));
    const missing=structuredClone(result);delete missing.fourF;assert.throws(()=>validateSpatialResult(missing,7,input));
    const stale=structuredClone(input);stale.elements[2].position[0]++;result.inputSnapshot=stale;assert.throws(()=>validateSpatialResult(result,7,stale));
  }
});
test('4f masks map the full width and selected first-order frequency correctly',()=>{
  const p=DEFAULT_FOUR_F,b=fourF(p);close(b.cutoffFrequency,200/(2*532*.001*120));
  assert.equal(b.mask(99),1);assert.equal(b.mask(101),0);assert.equal(fourF({...p,filterMode:1}).mask(0),0);
  const patch=fourFTarget(p,'positive_order');close(patch.filterOffsetUm!,399);assert.equal(patch.filterMode,0);
  const order=fourF({...p,...patch});close(order.transmission,1/6);close(order.at(0),.0625);
  assert.throws(()=>fourFTarget({...p,modulation:0},'positive_order'));
});
test('4f edits, formulas, bounds and builder device guard',()=>{
  const p={...DEFAULT_FOUR_F,filterOffsetUm:300},h={past:[],present:DEFAULT_FOUR_F,future:[]};
  const next=fourFHistory(h,{type:'commit',parameters:p});assert.deepEqual(fourFHistory(next,{type:'undo'}).present,DEFAULT_FOUR_F);assert.deepEqual(fourFHistory(fourFHistory(next,{type:'undo'}),{type:'redo'}).present,p);
  assert.throws(()=>parseFourF({...p,filterWidthUm:0}));assert.throws(()=>parseFourF({...p,filterMode:.5}));
  for(const card of OPTICS_FORMULAS.filter(f=>f.diagram==='four-f')){const v=opticsValues(card,fourFState(p));assert.equal(v.c,300);assert.equal(v.L,480);close(v.J,fourF(p).observation,1e-12);}
  for(const filterMode of [0,1,2])for(const focalLengthMm of [80,120,130]){
    const p={...DEFAULT_FOUR_F,filterMode,focalLengthMm,filterOffsetUm:399,observationMm:.2},copy=fourFBuilderCopy(p),source=copy.elements[0],grating=copy.elements[1],l1=copy.elements[2],l2=copy.elements.at(-2)!,screen=copy.elements.at(-1)!;
    assert.equal(copy.elements.length,filterMode===2?5:6);assert.equal(l1.position[0]-grating.position[0],focalLengthMm);assert.equal(l2.position[0]-l1.position[0],2*focalLengthMm);assert.equal(screen.position[0]-l2.position[0],focalLengthMm);assert.equal(source.beamRadiusMm,.8);assert.equal(source.waistOffsetMm,grating.position[0]-source.position[0]);assert.equal(grating.gratingProfile,'sinusoidal');assert.equal(grating.gratingPeriodUm,160);assert.equal(grating.gratingModulation,1);assert.equal(screen.probeOffsetMm,.2);
    if(filterMode!==2){const mask=copy.elements[3];assert.equal(mask.position[0]-l1.position[0],focalLengthMm);close(mask.position[2],.399);assert.equal(mask.slitWidthMm,.2);assert.equal(mask.slitMode,filterMode===0?'pass':'stop');}
    assert.deepEqual(parseSpatial(copy),copy);
    const actual=spatialFourFParameters(copy)!;for(const field of ['wavelengthNm','periodMm','waistMm','modulation','focalLengthMm','filterMode','observationMm'] as const)close(actual[field],p[field]);
    if(filterMode!==2){close(actual.filterWidthUm,p.filterWidthUm);close(actual.filterOffsetUm,p.filterOffsetUm);}
    const moved=structuredClone(copy);moved.elements[2].position[0]+=1;assert.equal(spatialFourFParameters(moved),null);
  }
});

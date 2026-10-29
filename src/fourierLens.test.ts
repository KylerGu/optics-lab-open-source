import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {parseSpatial,validateSpatialResult} from './builderModel';
import {spatialFourierParameters} from './spatialFourier';
import assert from 'node:assert/strict';
import { DEFAULT_FOURIER, fourierLens, fourierHistory, fourierState, fourierBuilderCopy, parseFourier } from './fourierLens';
import { OPTICS_FORMULAS, opticsValues } from './opticsKnowledgeModel';

test('Fourier frequency mapping, reciprocal width, no-stripe limit and two-dimensional symmetry',()=>{
  const b=fourierLens(DEFAULT_FOURIER);
  assert.equal(b.orderPositionUm,399);assert.equal(b.spatialFrequency,6.25);assert.equal(b.at(0).intensity,1);
  assert.ok(Math.abs(b.at(b.orderPositionUm).intensity-.25)<1e-10);
  assert.equal(fourierLens({...DEFAULT_FOURIER,periodMm:.08}).orderPositionUm,2*b.orderPositionUm);
  assert.equal(fourierLens({...DEFAULT_FOURIER,waistMm:1.6}).spotRadiusUm,b.spotRadiusUm/2);
  assert.equal(fourierLens({...DEFAULT_FOURIER,focalLengthMm:240}).spotRadiusUm,2*b.spotRadiusUm);
  for(const wavelengthNm of [380,780])for(const periodMm of [.08,.4])for(const waistMm of [.5,2])for(const focalLengthMm of [80,250])for(const modulation of [0,1]){
    const p={...DEFAULT_FOURIER,wavelengthNm,periodMm,waistMm,focalLengthMm,modulation},v=fourierLens(p);
    assert.equal(v.at(0).intensity,1);assert.equal(v.at(37,19).intensity,v.at(-37,-19).intensity);
    assert.ok(v.orderPositionUm<3000);assert.ok(v.spotRadiusUm<200);
    for(const x of [-3000,0,37,v.orderPositionUm,3000])assert.ok(v.at(x).intensity>=0&&v.at(x).intensity<=1);
    if(modulation===0){assert.ok(Math.abs(v.at(v.spotRadiusUm).intensity-Math.exp(-2))<1e-13);assert.equal(v.at(37).intensity,fourierLens({...p,periodMm:.16}).at(37).intensity);}
  }
});
test('Fourier formulas track current parameters and edits remain reversible',()=>{
  const p={...DEFAULT_FOURIER,periodMm:.2,observationUm:319.2},h={past:[],present:DEFAULT_FOURIER,future:[]};
  const next=fourierHistory(h,{type:'commit',parameters:p});assert.deepEqual(fourierHistory(next,{type:'undo'}).present,DEFAULT_FOURIER);
  assert.deepEqual(fourierHistory(fourierHistory(next,{type:'undo'}),{type:'redo'}).present,p);
  assert.throws(()=>parseFourier({...p,periodMm:0}));assert.throws(()=>parseFourier({...p,modulation:1.1}));
  for(const card of OPTICS_FORMULAS.filter(f=>f.diagram==='fourier-lens')){const v=opticsValues(card,fourierState(p));assert.equal(v.d,p.periodMm);assert.equal(v.xF,p.observationUm);assert.equal(v.x1,fourierLens(p).orderPositionUm);assert.equal(v.J,fourierLens(p).observation.intensity);}
});
test('complete Fourier copy preserves input, observer and focal geometry',()=>{
  for(const modulation of [0,.4,1])for(const focalLengthMm of [80,250])for(const waistMm of [.5,2]){
    const p={...DEFAULT_FOURIER,modulation,focalLengthMm,waistMm,observationUm:399},copy=fourierBuilderCopy(p),[source,grating,lens,screen]=copy.elements;
    assert.equal(copy.elements.length,4);assert.deepEqual(parseSpatial(copy),copy);
    assert.equal(source.beamRadiusMm,waistMm);assert.equal(source.waistOffsetMm,grating.position[0]-source.position[0]);assert.equal(source.wavelengthNm,p.wavelengthNm);
    assert.equal(grating.gratingProfile,'sinusoidal');assert.equal(grating.gratingModulation,modulation);assert.equal(grating.gratingPeriodUm,160);
    assert.equal(lens.position[0]-grating.position[0],focalLengthMm);assert.equal(screen.position[0]-lens.position[0],focalLengthMm);assert.equal(screen.probeOffsetMm,.399);
    assert.deepEqual(spatialFourierParameters(copy),p);
    const moved=structuredClone(copy);moved.elements[2].position[0]++;assert.equal(spatialFourierParameters(moved),null);
  }
});
test('copied Fourier apparatus matches real backend and rejects missing or stale evidence',()=>{
  for(const p of [DEFAULT_FOURIER,{...DEFAULT_FOURIER,modulation:0,observationUm:40},{...DEFAULT_FOURIER,observationUm:399},{...DEFAULT_FOURIER,wavelengthNm:780,periodMm:.08,focalLengthMm:250,waistMm:.5,modulation:.4,observationUm:-2437.5}]){
    const input=fourierBuilderCopy(p),result=JSON.parse(execFileSync('python',['-X','utf8','-c','import json,sys;from backend.spatial import SpatialExperiment,trace;print(json.dumps(trace(SpatialExperiment.model_validate(json.load(sys.stdin)),7)))'],{input:JSON.stringify(input),encoding:'utf-8'}));
    assert.doesNotThrow(()=>validateSpatialResult(result,7,input));const b=fourierLens(p);for(const field of ['orderPositionUm','spotRadiusUm'] as const)assert.ok(Math.abs(result.fourier[field]-b[field])<1e-7);assert.ok(Math.abs(result.fourier.pointIntensity-b.observation.intensity)<1e-7);
    const forged=structuredClone(result);forged.fourier.orderPositionUm++;assert.throws(()=>validateSpatialResult(forged,7,input));
    const missing=structuredClone(result);delete missing.fourier;assert.throws(()=>validateSpatialResult(missing,7,input));
    const stale=structuredClone(input);stale.elements[2].position[0]++;result.inputSnapshot=stale;assert.throws(()=>validateSpatialResult(result,7,stale));
  }
});

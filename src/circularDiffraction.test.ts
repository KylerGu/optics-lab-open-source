import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CIRCULAR,circularDiffraction,circularBuilderCopy,circularHistory,parseCircular,besselJ1,circularState} from './circularDiffraction';
import {OPTICS_FORMULAS,opticsValues} from './opticsKnowledgeModel';

test('central limit and first dark ring across wavelength, diameter and focal length corners',()=>{
  for(const wavelengthNm of [380,532,780])for(const apertureDiameterMm of [1,2,8])for(const focalLengthMm of [80,120,250]){
    const b=circularDiffraction({...DEFAULT_CIRCULAR,wavelengthNm,apertureDiameterMm,focalLengthMm});
    assert.equal(b.at(0).intensity,1);assert.equal(b.at(b.firstDarkRadiusUm).intensity,0);assert.ok(b.firstDarkRadiusUm<500);
    assert.equal(b.airyDiameterUm,2*b.firstDarkRadiusUm);assert.equal(b.at(37).intensity,b.at(-37).intensity);
  }
  assert.ok(Math.abs(besselJ1(1)-.4400505857449335)<1e-13);
  assert.ok(Math.abs(besselJ1(2)-.5767248077568734)<1e-13);
  const base=circularDiffraction(DEFAULT_CIRCULAR),small=circularDiffraction({...DEFAULT_CIRCULAR,apertureDiameterMm:1}),long=circularDiffraction({...DEFAULT_CIRCULAR,focalLengthMm:240});
  assert.equal(small.airyDiameterUm,2*base.airyDiameterUm);assert.equal(long.airyDiameterUm,2*base.airyDiameterUm);assert.equal(long.firstDarkAngleMrad,base.firstDarkAngleMrad);
});
test('builder copy preserves units and keeps the screen on the focal plane at all corners',()=>{
  for(const apertureDiameterMm of [1,8])for(const focalLengthMm of [80,250]){
    const p={...DEFAULT_CIRCULAR,apertureDiameterMm,focalLengthMm,wavelengthNm:780},copy=circularBuilderCopy(p),[source,aperture,lens,screen]=copy.elements;
    assert.equal(source.wavelengthNm,p.wavelengthNm);assert.equal(source.beamModel,'parallel');assert.equal(source.divergenceMrad,0);
    assert.equal(aperture.diameterMm,p.apertureDiameterMm);assert.ok(source.beamRadiusMm>aperture.diameterMm/2);
    assert.equal(lens.focalLengthMm,p.focalLengthMm);assert.equal(screen.position[0]-lens.position[0],p.focalLengthMm);
  }
});
test('formula inputs follow live scene; history is reversible and invalid values are rejected',()=>{
  const p={...DEFAULT_CIRCULAR,observationRadiusUm:39.123456789},h={past:[],present:DEFAULT_CIRCULAR,future:[]};
  const next=circularHistory(h,{type:'commit',parameters:p});assert.deepEqual(circularHistory(next,{type:'undo'}).present,DEFAULT_CIRCULAR);
  assert.deepEqual(circularHistory(circularHistory(next,{type:'undo'}),{type:'redo'}).present,p);
  assert.throws(()=>parseCircular({...p,apertureDiameterMm:0}));assert.throws(()=>parseCircular({...p,observationRadiusUm:NaN}));
  for(const card of OPTICS_FORMULAS.filter(f=>f.diagram==='circular-diffraction')){
    const v=opticsValues(card,circularState(p));assert.equal(v.r,p.observationRadiusUm);assert.equal(v.D,p.apertureDiameterMm);
    assert.equal(v.dA,circularDiffraction(p).airyDiameterUm);assert.equal(v.J,circularDiffraction(p).observation.intensity);
  }
});

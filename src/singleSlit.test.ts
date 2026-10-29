import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SLIT, singleSlit, slitBuilderCopy, slitHistory, parseSlit } from './singleSlit';

test('central maximum, both minima and far-field bounds across all corners', () => {
  for(const wavelengthNm of [380,532,780]) for(const slitWidthMm of [.02,.05,.08]) for(const screenDistanceM of [.3,.5,.8]) {
    const p={...DEFAULT_SLIT,wavelengthNm,slitWidthMm,screenDistanceM},b=singleSlit(p);
    assert.equal(b.at(0).intensity,1); assert.equal(b.at(b.firstMinimumMm).intensity,0); assert.equal(b.at(-b.firstMinimumMm).intensity,0);
    assert.ok(b.fresnelNumber<=.1); assert.ok(b.firstMinimumMm<40);
  }
});
test('copy preserves physical distances and guarantees supported diffraction geometry', () => {
  for(const wavelengthNm of [380,780]) for(const slitWidthMm of [.02,.08]) for(const screenDistanceM of [.3,.8]) {
    const p={...DEFAULT_SLIT,wavelengthNm,slitWidthMm,screenDistanceM},copy=slitBuilderCopy(p);
    const [source,slit,screen]=copy.elements;
    assert.equal(source.wavelengthNm,wavelengthNm);assert.equal(slit.slitWidthMm,slitWidthMm);
    assert.equal(screen.position[0]-slit.position[0],screenDistanceM*1000);
    assert.ok(slitWidthMm<=source.beamRadiusMm*.2);assert.ok(slit.slitHeightMm>=10*slitWidthMm);
    assert.equal(source.beamModel,'parallel');assert.equal(source.divergenceMrad,0);
    assert.equal(slit.rollDeg,90);assert.ok(copy.elements.every(e=>e.position.every(n=>Math.abs(n)<=1000)));
  }
});
test('history, scene parsing and invalid input preserve scene isolation', () => {
  const h={past:[],present:{...DEFAULT_SLIT},future:[]};
  const next=slitHistory(h,{type:'commit',parameters:{...DEFAULT_SLIT,slitWidthMm:.025}});
  assert.equal(slitHistory(next,{type:'undo'}).present.slitWidthMm,DEFAULT_SLIT.slitWidthMm);
  assert.equal(slitHistory(slitHistory(next,{type:'undo'}),{type:'redo'}).present.slitWidthMm,.025);
  assert.throws(()=>parseSlit({...DEFAULT_SLIT,slitWidthMm:.2}));assert.throws(()=>parseSlit({...DEFAULT_SLIT,observationMm:NaN}));
});

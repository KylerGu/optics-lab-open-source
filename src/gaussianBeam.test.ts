import assert from 'node:assert/strict';
import test from 'node:test';
import { gaussianBeam, gaussianElements, makeGaussianScene } from './gaussianBeam';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < Math.max(1, Math.abs(expected)) * 1e-12, `${actual} differs from ${expected}`);

test('free-space beam preserves waist and reaches sqrt(2) radius at one Rayleigh length', () => {
  const { laser, screen } = gaussianElements(makeGaussianScene());
  const beam = gaussianBeam(laser, screen);
  close(beam.radiusAt(laser.positionMm), laser.waistMm);
  close(beam.radiusAt(laser.positionMm + beam.rayleighMm), Math.SQRT2 * laser.waistMm);
  close(beam.relativeIntensityAt(beam.screenRadiusMm), Math.exp(-2));
  close(beam.relativeIntensityAt(0), 1);
});

test('wavelength and waist changes obey Gaussian propagation scaling', () => {
  const { laser, screen } = gaussianElements(makeGaussianScene());
  const base = gaussianBeam(laser, screen);
  const longer = gaussianBeam({ ...laser, wavelengthNm: laser.wavelengthNm * 2 }, screen);
  const wider = gaussianBeam({ ...laser, waistMm: laser.waistMm * 2 }, screen);
  close(longer.rayleighMm, base.rayleighMm / 2);
  close(longer.divergenceMrad, base.divergenceMrad * 2);
  close(wider.rayleighMm, base.rayleighMm * 4);
  close(wider.divergenceMrad, base.divergenceMrad / 2);
  assert.ok(longer.screenRadiusMm > base.screenRadiusMm);
});

test('moving the sampling plane does not change the beam itself', () => {
  const { laser, screen } = gaussianElements(makeGaussianScene());
  const base = gaussianBeam(laser, screen);
  const moved = gaussianBeam(laser, { ...screen, positionMm: 600 });
  close(base.radiusAt(200), moved.radiusAt(200));
  assert.ok(moved.screenRadiusMm > base.screenRadiusMm);
});

test('scene rejects lenses and sampling planes before the waist', () => {
  const experiment = makeGaussianScene();
  assert.throws(() => gaussianElements({ ...experiment, elements: [...experiment.elements, { id: 'lens', kind: 'lens', name: 'lens', positionMm: 200, focalLengthMm: 100, diameterMm: 25 }] }));
  assert.throws(() => gaussianElements({ ...experiment, elements: experiment.elements.map(item => item.kind === 'screen' ? { ...item, positionMm: 10 } : item) }));
});

test('wavefront is flat at the waist and has minimum curvature radius at one Rayleigh length', () => {
  const { laser, screen } = gaussianElements(makeGaussianScene());
  const beam = gaussianBeam(laser, screen);
  assert.equal(beam.wavefrontRadiusAt(laser.positionMm), Infinity);
  close(beam.wavefrontRadiusAt(laser.positionMm + beam.rayleighMm), 2 * beam.rayleighMm);
  assert.ok(beam.wavefrontRadiusAt(laser.positionMm + beam.rayleighMm / 2) > 2 * beam.rayleighMm);
  assert.ok(beam.wavefrontRadiusAt(laser.positionMm + 2 * beam.rayleighMm) > 2 * beam.rayleighMm);
  close(beam.screenWavefrontRadiusMm, beam.distanceMm + beam.rayleighMm ** 2 / beam.distanceMm);
});

test('teaching regions use distance from the waist and far-field radius error stays near five percent', () => {
  const { laser, screen } = gaussianElements(makeGaussianScene());
  const base = gaussianBeam(laser, screen);
  const at = (ratio: number) => gaussianBeam(laser, { ...screen, positionMm: laser.positionMm + ratio * base.rayleighMm });
  assert.equal(at(.5).region, 'near');
  assert.equal(at(1).region, 'near');
  assert.equal(at(1.01).region, 'transition');
  assert.equal(at(2.99).region, 'transition');
  assert.equal(at(3).region, 'far');
  const boundary = at(3);
  const approximateRadius = 3 * laser.waistMm;
  close((boundary.screenRadiusMm - approximateRadius) / boundary.screenRadiusMm, 1 - 3 / Math.sqrt(10));
  const translated = gaussianBeam({ ...laser, positionMm: laser.positionMm + 100 }, { ...screen, positionMm: screen.positionMm + 100 });
  assert.equal(translated.region, base.region);
  close(translated.screenWavefrontRadiusMm, base.screenWavefrontRadiusMm);
});

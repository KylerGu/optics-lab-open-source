import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeStokesState,
  infernoColor,
  listProfilerDetectors,
  sampleDetectorField,
  selectProfilerDetector,
  wavelengthColorLut,
} from './spatialBeamProfiler';
import type { SpatialExperiment, SpatialResult } from './builderModel';

function makeExperiment(elements: SpatialExperiment['elements']): SpatialExperiment {
  return {
    id: 'exp-test',
    name: 'Test',
    elements,
  } as unknown as SpatialExperiment;
}

test('infernoColor and wavelengthColorLut map normalized intensities safely', () => {
  assert.deepEqual(infernoColor(0), [0, 0, 4]);
  assert.deepEqual(infernoColor(1), [252, 255, 164]);
  assert.deepEqual(infernoColor(-5), [0, 0, 4]);
  assert.deepEqual(infernoColor(Number.NaN), [0, 0, 4]);

  const greenLow = wavelengthColorLut(0, 532);
  const greenHigh = wavelengthColorLut(1, 532);
  assert.deepEqual(greenLow, [0, 0, 0]);
  assert.ok(greenHigh[1] > greenHigh[0] && greenHigh[1] >= 200);
});

test('selectProfilerDetector prioritizes selected detector, then preferred, then active signal', () => {
  const experiment = makeExperiment([
    { id: 'src-1', kind: 'laser', name: '激光器', wavelengthNm: 532 } as never,
    { id: 'scr-1', kind: 'screen', name: '屏幕 1', position: [100, 0, 0], normal: [-1, 0, 0], diameterMm: 40 } as never,
    { id: 'pm-1', kind: 'power-meter', name: '功率计', position: [200, 0, 0], normal: [-1, 0, 0], diameterMm: 20 } as never,
  ]);
  const result = {
    screens: [
      { elementId: 'scr-1', name: '屏幕 1', hits: 0, sampledPowerFraction: 0, sampledPowerMw: 0, centroid: null, footprintRadiusMm: null, gaussianRadiusMm: null },
      { elementId: 'pm-1', name: '功率计', hits: 10, sampledPowerFraction: 0.8, sampledPowerMw: 8, centroid: [200, 0, 0], footprintRadiusMm: 1.5, gaussianRadiusMm: 1.2 },
    ],
  } as unknown as SpatialResult;

  const list = listProfilerDetectors(experiment, result);
  assert.equal(list.length, 2);
  assert.equal(list[0].hasSignal, false);
  assert.equal(list[1].hasSignal, true);

  assert.equal(selectProfilerDetector(experiment, result, 'scr-1')?.elementId, 'scr-1');
  assert.equal(selectProfilerDetector(experiment, result, null)?.elementId, 'pm-1');
  assert.equal(selectProfilerDetector(experiment, result, null, 'scr-1')?.elementId, 'scr-1');
});

test('sampleDetectorField handles Gaussian, anisotropic, diffraction, and zero-signal cases', () => {
  const experiment = makeExperiment([
    { id: 'src-1', kind: 'laser', wavelengthNm: 632.8 } as never,
    { id: 'scr-1', kind: 'screen', name: '屏幕 1', position: [100, 0, 0], normal: [-1, 0, 0], diameterMm: 40 } as never,
  ]);

  // Zero signal
  const emptyField = sampleDetectorField(
    { elementId: 'scr-1', name: '屏幕 1', kind: 'screen', hasSignal: false, powerMw: 0 },
    experiment,
    null,
    24,
  );
  assert.equal(emptyField.gridSize, 24);
  assert.equal(emptyField.powerMw, 0);
  assert.equal(Math.max(...emptyField.matrix), 0);

  // Anisotropic Gaussian spot
  const anisoResult = {
    screens: [
      {
        elementId: 'scr-1',
        name: '屏幕 1',
        hits: 20,
        sampledPowerFraction: 1,
        sampledPowerMw: 10,
        centroid: [100, 0, 0],
        footprintRadiusMm: 3,
        gaussianRadiusMm: 2,
        sampledRadiusUMm: 4,
        sampledRadiusVMm: 1,
      },
    ],
  } as unknown as SpatialResult;
  const anisoField = sampleDetectorField(
    { elementId: 'scr-1', name: '屏幕 1', kind: 'screen', hasSignal: true, powerMw: 10 },
    experiment,
    anisoResult,
    25,
  );
  assert.equal(anisoField.modeLabel, '高斯光斑');
  assert.equal(anisoField.radiusUMm, 4);
  assert.equal(anisoField.radiusVMm, 1);
  // Center pixel should be ~1.0
  const mid = 12;
  assert.ok(anisoField.matrix[mid * 25 + mid] > 0.95);
  // U profile should be wider than V profile
  assert.ok(anisoField.uProfile[mid + 4] > anisoField.vProfile[mid + 4]);

  // Diffraction 1D wave mapping
  const diffResult = {
    screens: [],
    diffraction: [
      {
        screenId: 'scr-1',
        points: [
          { xMm: -5, intensity: 0.1 },
          { xMm: 0, intensity: 1.0 },
          { xMm: 5, intensity: 0.1 },
        ],
      },
    ],
  } as unknown as SpatialResult;
  const diffField = sampleDetectorField(
    { elementId: 'scr-1', name: '屏幕 1', kind: 'screen', hasSignal: true, powerMw: 5 },
    experiment,
    diffResult,
    25,
  );
  assert.equal(diffField.modeLabel, '衍射条纹');
  assert.ok(diffField.matrix[mid * 25 + mid] > 0.9);
});

test('describeStokesState classifies polarization states', () => {
  assert.equal(describeStokesState({ s1: 0, s2: 0, s3: 0 }).label, '未偏振');
  assert.equal(describeStokesState({ s1: 1, s2: 0, s3: 0 }).label, '线偏振');
  assert.equal(describeStokesState({ s1: 0, s2: 0, s3: 1 }).label, '右旋圆偏振');
  assert.equal(describeStokesState({ s1: 0, s2: 0, s3: -1 }).label, '左旋圆偏振');
  assert.equal(describeStokesState({ s1: 0.6, s2: 0, s3: 0.5 }).label, '椭圆偏振');
});

test('sampleDetectorField supports Auto-Zoom ROI and full-screen toggle', () => {
  const experiment = makeExperiment([
    { id: 'src-1', kind: 'laser', wavelengthNm: 532 } as never,
    { id: 'scr-1', kind: 'screen', name: '屏幕 1', position: [100, 0, 0], normal: [-1, 0, 0], diameterMm: 40 } as never,
  ]);
  const focusedResult = {
    screens: [
      {
        elementId: 'scr-1',
        name: '屏幕 1',
        hits: 20,
        sampledPowerFraction: 1,
        sampledPowerMw: 10,
        centroid: [100, 0, 0],
        footprintRadiusMm: 0.34,
        gaussianRadiusMm: 0.34,
      },
    ],
  } as unknown as SpatialResult;

  const autoField = sampleDetectorField(
    { elementId: 'scr-1', name: '屏幕 1', kind: 'screen', hasSignal: true, powerMw: 10 },
    experiment,
    focusedResult,
    25,
    'auto',
  );
  assert.ok(Math.abs(autoField.extentMm - 1.53) < 1e-6);

  const fullField = sampleDetectorField(
    { elementId: 'scr-1', name: '屏幕 1', kind: 'screen', hasSignal: true, powerMw: 10 },
    experiment,
    focusedResult,
    25,
    'full',
  );
  assert.equal(fullField.extentMm, 20);
});

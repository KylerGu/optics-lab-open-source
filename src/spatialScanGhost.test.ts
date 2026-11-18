import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSpatialElement, type SpatialExperiment } from './builderModel';
import type { SpatialComparison } from './spatialAgent';
import {
  applyComparisonValue,
  buildScanGhostScene,
  matchTableRowToComparison,
  traceQuickGaussianEnvelope,
} from './spatialScanGhost';

function makeGaussianBenchComparison(): SpatialComparison {
  const laser = makeSpatialElement('laser', [0, 60, 0], {
    id: 'laser-1',
    name: '532nm 激光器',
    beamModel: 'gaussian',
    beamRadiusMm: 0.5,
    wavelengthNm: 532,
  });
  const lens = makeSpatialElement('lens', [150, 60, 0], {
    id: 'lens-1',
    name: '会聚透镜 f=100mm',
    focalLengthMm: 100,
    diameterMm: 40,
  });
  const screen = makeSpatialElement('screen', [250, 60, 0], {
    id: 'screen-1',
    name: '探测屏',
    diameterMm: 40,
  });
  const inputSnapshot: SpatialExperiment = {
    schemaVersion: 2,
    name: '高斯光束单透镜聚焦',
    elements: [laser, lens, screen],
  };

  // Match the 12-point scan over z/x from 20..250 mm like the user screenshot
  const values = Array.from({ length: 12 }, (_, i) => 20 + (230 * i) / 11);
  return {
    comparisonId: 'comparison-1',
    inputSnapshot,
    elementId: 'screen-1',
    field: 'x',
    rows: values.map(v => {
      const radius = v <= 150 ? 0.5 : Math.max(0.0339, 0.5 * Math.abs(1 - (v - 150) / 100));
      return {
        value: v,
        screens: [
          {
            elementId: 'screen-1',
            name: '探测屏',
            hits: 9,
            sampledPowerFraction: 1,
            sampledPowerMw: 10,
            centroid: [v, 60, 0],
            footprintRadiusMm: radius,
            gaussianRadiusMm: radius,
          },
        ],
        warnings: [],
        error: null,
      };
    }),
  };
}

test('applyComparisonValue updates position, rotation, and optical parameters cleanly', () => {
  const comp = makeGaussianBenchComparison();
  const moved = applyComparisonValue(comp.inputSnapshot, 'screen-1', 'x', 187.3);
  assert.equal(moved.elements.find(e => e.id === 'screen-1')?.position[0], 187.3);
  // Original snapshot remains immutable
  assert.equal(comp.inputSnapshot.elements.find(e => e.id === 'screen-1')?.position[0], 250);

  const focalChanged = applyComparisonValue(comp.inputSnapshot, 'lens-1', 'focalLengthMm', 75);
  assert.equal(focalChanged.elements.find(e => e.id === 'lens-1')?.focalLengthMm, 75);

  const rotated = applyComparisonValue(comp.inputSnapshot, 'lens-1', 'yawDeg', 12);
  assert.equal(rotated.elements.find(e => e.id === 'lens-1')?.yawDeg, 12);
});

test('matchTableRowToComparison matches rounded AI Markdown table values cleanly and rejects unrelated numbers', () => {
  const comp = makeGaussianBenchComparison();

  const hit166 = matchTableRowToComparison(['166.4 mm', '16.4 mm', '0.421 mm'], [comp]);
  assert.ok(hit166);
  assert.equal(hit166.comparison.comparisonId, 'comparison-1');
  assert.equal(hit166.rowIndex, 7);

  const hit187 = matchTableRowToComparison(['187.3 mm', '37.3 mm', '0.317 mm'], [comp]);
  assert.ok(hit187);
  assert.equal(hit187.rowIndex, 8);

  const hit250 = matchTableRowToComparison(['250.0 mm', '100 mm', '0.034 mm'], [comp]);
  assert.ok(hit250);
  assert.equal(hit250.rowIndex, 11);

  assert.equal(matchTableRowToComparison(['表头文本', '无数字'], [comp]), null);
  assert.equal(matchTableRowToComparison(['999 mm', '1.0 mm'], [comp]), null);
});

test('buildScanGhostScene identifies optimal minimum spot, active sample, downsampled trail, and trajectory', () => {
  const comp = makeGaussianBenchComparison();
  const activeVal = comp.rows[8].value; // ~187.27 mm
  const scene = buildScanGhostScene(comp, activeVal, comp.inputSnapshot, 7);

  assert.ok(scene);
  assert.equal(scene.elementId, 'screen-1');
  assert.equal(scene.isSpatialMove, true);
  assert.equal(scene.trajectoryPoints.length, 12);
  assert.equal(scene.bestSample?.rowIndex, 11);
  assert.equal(scene.activeSample?.rowIndex, 8);
  assert.ok(scene.samples.length <= 7);
  assert.ok(scene.samples.some(s => s.rowIndex === 0));
  assert.ok(scene.samples.some(s => s.rowIndex === 8 && s.role === 'active'));
  assert.ok(scene.samples.some(s => s.rowIndex === 11 && s.role === 'best'));
});

test('traceQuickGaussianEnvelope produces focusing beam segments when scanning a lens parameter', () => {
  const comp = makeGaussianBenchComparison();
  const lensScan: SpatialComparison = {
    ...comp,
    comparisonId: 'comparison-2',
    elementId: 'lens-1',
    field: 'x',
    rows: [80, 120, 150, 180].map(v => ({
      value: v,
      screens: comp.rows[11].screens,
      warnings: [],
      error: null,
    })),
  };

  const scene = buildScanGhostScene(lensScan, 120, lensScan.inputSnapshot);
  assert.ok(scene);
  assert.ok(scene.activeSample);
  assert.ok(scene.activeSample.rayEnvelope.length >= 2);

  const quick = traceQuickGaussianEnvelope(lensScan.inputSnapshot);
  assert.ok(quick.length >= 2);
});

test('buildScanGhostScene surfaces differing reference optics and ray envelope when viewing an earlier apparatus scan', () => {
  const comp = makeGaussianBenchComparison();
  const movedLive = applyComparisonValue(comp.inputSnapshot, 'lens-1', 'x', 220);
  const scene = buildScanGhostScene(comp, comp.rows[8].value, movedLive);
  assert.ok(scene);
  assert.equal(scene.contextOptics.length, 1);
  assert.equal(scene.contextOptics[0].id, 'lens-1');
  assert.ok(scene.activeSample && scene.activeSample.rayEnvelope.length >= 2);
});

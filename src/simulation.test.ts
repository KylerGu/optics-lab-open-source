import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTemplate } from './model';
import { experimentKey, simulationCSV, validateResult, type SimulationResult } from './simulation';

function response(): SimulationResult {
  const document = makeTemplate('empty');
  return {
    revision: 4, modelVersion: 'test-fixture', inputSnapshot: document, quality: 'within-model', warnings: [], assumptions: ['contract-only test'], sourcePositionMm: 0, rayleighRangeMm: 100,
    minimum: { positionMm: 0, radiusMm: 1 }, samples: [{ positionMm: 0, radiusMm: 1 }, { positionMm: 600, radiusMm: 6 }],
    rayPaths: Array.from({ length: 9 }, () => ({ initialHeightMm: 0, points: [{ positionMm: 0, heightMm: 0 }, { positionMm: 600, heightMm: 0 }], blockedBy: null })),
    screens: [], apertureChecks: [], endMatrix: { A: 1, B: 600, C: 0, D: 1 },
  };
}

test('过期响应与其他装置的响应不能进入画面', () => {
  const data = response();
  assert.throws(() => validateResult(data, 5, experimentKey(data.inputSnapshot)));
  assert.throws(() => validateResult(data, 4, experimentKey({ ...data.inputSnapshot, name: '不同的实验' })));
  assert.equal(validateResult(data, 4, experimentKey(data.inputSnapshot)).revision, 4);
});

test('非有限半径和倒序采样被拒绝', () => {
  const data = response();
  assert.throws(() => validateResult({ ...data, samples: [{ positionMm: 0, radiusMm: NaN }, data.samples[1]] }, 4, experimentKey(data.inputSnapshot)));
  assert.throws(() => validateResult({ ...data, samples: [...data.samples].reverse() }, 4, experimentKey(data.inputSnapshot)));
});

test('CSV包含模型说明、单位、结果，并将公式形名称作为文本导出', () => {
  const data = response();
  data.inputSnapshot.name = '=危险公式';
  const csv = simulationCSV(data);
  assert.match(csv, /position_mm.*beam_radius_mm/);
  assert.match(csv, /contract-only test/);
  assert.match(csv, /'=危险公式/);
  assert.match(csv, /"600","6"/);
});

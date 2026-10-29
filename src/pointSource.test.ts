import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POINT, illuminance, parsePoint, pointHistory, pointState } from './pointSource';
import { opticsValues, OPTICS_FORMULAS } from './opticsKnowledgeModel';

test('point source: inverse square, source off and current formula inputs', () => {
  assert.equal(illuminance(DEFAULT_POINT), 25);
  for (const distance of [.2, 1, 3, 5]) {
    const p = { intensityCd: 100, distanceM: distance };
    assert.equal(illuminance(p, 2 * distance), illuminance(p) / 4);
  }
  assert.equal(illuminance({ intensityCd: 0, distanceM: .2 }), 0);
  const formula = OPTICS_FORMULAS.find(f => f.id === 'point-source-illuminance')!;
  assert.deepEqual(opticsValues(formula, pointState({ intensityCd: 80, distanceM: 4 })), { E: 5, I: 80, r: 4 });
  for (const distanceM of [0, -.2, 11, NaN, true]) assert.throws(() => parsePoint({ intensityCd: 100, distanceM }));
});

test('point source: one completed gesture is one undo step and a new edit clears redo', () => {
  const initial = { past: [], present: { ...DEFAULT_POINT }, future: [] };
  const changed = pointHistory(initial, { type: 'commit', parameters: { ...DEFAULT_POINT, distanceM: 4 } });
  const undone = pointHistory(changed, { type: 'undo' });
  assert.deepEqual(undone.present, DEFAULT_POINT);
  assert.deepEqual(pointHistory(undone, { type: 'redo' }), changed);
  const newEdit = pointHistory(undone, { type: 'commit', parameters: { ...DEFAULT_POINT, intensityCd: 50 } });
  assert.equal(newEdit.future.length, 0);
  assert.deepEqual(initial.present, DEFAULT_POINT);
});

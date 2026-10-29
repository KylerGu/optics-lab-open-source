import test from 'node:test';
import assert from 'node:assert/strict';
import { historyReducer, makeTemplate, parseExperiment, parseLibrary, type History } from './model';

test('保存和重新加载保留元件位置、焦距和实验名称', () => {
  const experiment = makeTemplate();
  experiment.name = '透镜间距对比';
  experiment.elements[1].positionMm = 192.5;
  const restored = parseExperiment(JSON.parse(JSON.stringify(experiment)));
  assert.deepEqual(restored, experiment);
  assert.notEqual(restored.elements[1], experiment.elements[1]);
});

test('撤销删除恢复完整元件，重做再次删除', () => {
  const original = makeTemplate();
  let state: History = { past: [], present: original, future: [] };
  state = historyReducer(state, { type: 'commit', experiment: { ...original, elements: original.elements.slice(1) } });
  state = historyReducer(state, { type: 'undo' });
  assert.deepEqual(state.present, original);
  state = historyReducer(state, { type: 'redo' });
  assert.equal(state.present.elements.length, 3);
  assert.equal(original.elements.length, 4);
});

test('撤销后新编辑使旧的重做分支失效', () => {
  const original = makeTemplate();
  let state: History = { past: [], present: original, future: [] };
  state = historyReducer(state, { type: 'commit', experiment: { ...original, name: '旧编辑' } });
  state = historyReducer(state, { type: 'undo' });
  state = historyReducer(state, { type: 'commit', experiment: { ...original, name: '新编辑' } });
  assert.equal(state.future.length, 0);
  assert.equal(historyReducer(state, { type: 'redo' }).present.name, '新编辑');
});

test('导入拒绝无效数值、重复元件和不兼容版本', () => {
  const original = makeTemplate();
  assert.throws(() => parseExperiment({ ...original, schemaVersion: 2 }));
  assert.throws(() => parseExperiment({ ...original, elements: [original.elements[0], original.elements[0]] }));
  for (const positionMm of [NaN, Infinity, -1, 601, '20']) {
    assert.throws(() => parseExperiment({ ...original, elements: [{ ...original.elements[0], positionMm }] }));
  }
  const lens = original.elements[1];
  assert.throws(() => parseExperiment({ ...original, elements: [{ ...lens, focalLengthMm: 0 }] }));
});

test('实验库重新加载后仍可编辑，损坏记录被拒绝', () => {
  const saved = [{ id: 'saved-1', savedAt: new Date().toISOString(), experiment: makeTemplate('focus') }];
  assert.deepEqual(parseLibrary(JSON.parse(JSON.stringify(saved))), saved);
  assert.throws(() => parseLibrary([{ ...saved[0], savedAt: 'invalid' }]));
  assert.throws(() => parseLibrary([...saved, ...saved]));
});

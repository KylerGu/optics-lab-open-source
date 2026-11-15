import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { builderCanvasStatus } from './builderCanvasStatus';

describe('builder canvas status', () => {
  it('hides a finished calculation and still announces it', () => {
    assert.deepEqual(builderCanvasStatus(true, false, 'ready', false), { visible: null, live: '光路已更新' });
  });

  it('waits to show a computation that may finish quickly', () => {
    assert.deepEqual(builderCanvasStatus(true, false, 'pending', false), { visible: null, live: '' });
    assert.deepEqual(builderCanvasStatus(true, false, 'pending', true), { visible: '计算中…', live: '计算中…' });
  });

  it('keeps dragging, missing-source, and failure messages visible', () => {
    assert.equal(builderCanvasStatus(true, true, 'ready', false).visible, '松开后更新');
    assert.equal(builderCanvasStatus(true, false, 'idle', false).visible, '请添加光源');
    assert.equal(builderCanvasStatus(true, false, 'error', false).visible, '计算未完成');
  });

  it('says nothing before a simulation has been started', () => {
    assert.deepEqual(builderCanvasStatus(false, false, 'ready', true), { visible: null, live: '' });
  });
});

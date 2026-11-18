import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SPLIT_RATIO,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  STUDIO_SPLIT_RATIO_KEY,
  STUDIO_VIEW_MODE_KEY,
  clampSplitRatio,
  readSplitRatio,
  readStudioViewMode,
  resolveLabLayout,
  saveSplitRatio,
  saveStudioViewMode,
} from './studioSplit';

function withMockStorage(
  initial: Record<string, string>,
  fn: (values: Map<string, string>) => void,
) {
  const values = new Map(Object.entries(initial));
  const prior = globalThis.localStorage;
  try {
    globalThis.localStorage = {
      get length() {
        return values.size;
      },
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
      clear: () => {
        values.clear();
      },
      key: (index: number) => [...values.keys()][index] ?? null,
    } as Storage;
    fn(values);
  } finally {
    if (prior) globalThis.localStorage = prior;
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

test('clampSplitRatio constrains ratios to [0.28, 0.68] and falls back to 0.44 for non-finite input', () => {
  assert.equal(clampSplitRatio(0.44), DEFAULT_SPLIT_RATIO);
  assert.equal(clampSplitRatio(0.55), 0.55);
  assert.equal(clampSplitRatio(0.28), MIN_SPLIT_RATIO);
  assert.equal(clampSplitRatio(0.68), MAX_SPLIT_RATIO);
  assert.equal(clampSplitRatio(0.1), MIN_SPLIT_RATIO);
  assert.equal(clampSplitRatio(-1), MIN_SPLIT_RATIO);
  assert.equal(clampSplitRatio(0.95), MAX_SPLIT_RATIO);
  assert.equal(clampSplitRatio(3), MAX_SPLIT_RATIO);
  assert.equal(clampSplitRatio(Number.NaN), DEFAULT_SPLIT_RATIO);
  assert.equal(clampSplitRatio(Number.POSITIVE_INFINITY), DEFAULT_SPLIT_RATIO);
  assert.equal(clampSplitRatio(Number.NEGATIVE_INFINITY), DEFAULT_SPLIT_RATIO);
});

test('readStudioViewMode and saveStudioViewMode persist valid modes and default to split', () => {
  withMockStorage({}, values => {
    assert.equal(readStudioViewMode(), 'split');
    saveStudioViewMode('builder');
    assert.equal(values.get(STUDIO_VIEW_MODE_KEY), 'builder');
    assert.equal(readStudioViewMode(), 'builder');
    saveStudioViewMode('research');
    assert.equal(readStudioViewMode(), 'research');
    saveStudioViewMode('split');
    assert.equal(readStudioViewMode(), 'split');
  });

  withMockStorage({ [STUDIO_VIEW_MODE_KEY]: 'unexpected-mode' }, () => {
    assert.equal(readStudioViewMode(), 'split');
  });
});

test('readSplitRatio and saveSplitRatio clamp values and handle missing or malformed storage', () => {
  withMockStorage({}, values => {
    assert.equal(readSplitRatio(), DEFAULT_SPLIT_RATIO);
    saveSplitRatio(0.52);
    assert.equal(values.get(STUDIO_SPLIT_RATIO_KEY), '0.52');
    assert.equal(readSplitRatio(), 0.52);

    saveSplitRatio(0.05);
    assert.equal(values.get(STUDIO_SPLIT_RATIO_KEY), String(MIN_SPLIT_RATIO));
    assert.equal(readSplitRatio(), MIN_SPLIT_RATIO);

    saveSplitRatio(0.99);
    assert.equal(values.get(STUDIO_SPLIT_RATIO_KEY), String(MAX_SPLIT_RATIO));
    assert.equal(readSplitRatio(), MAX_SPLIT_RATIO);
  });

  withMockStorage({ [STUDIO_SPLIT_RATIO_KEY]: '' }, () => {
    assert.equal(readSplitRatio(), DEFAULT_SPLIT_RATIO);
  });
  withMockStorage({ [STUDIO_SPLIT_RATIO_KEY]: '   ' }, () => {
    assert.equal(readSplitRatio(), DEFAULT_SPLIT_RATIO);
  });
  withMockStorage({ [STUDIO_SPLIT_RATIO_KEY]: 'not-a-number' }, () => {
    assert.equal(readSplitRatio(), DEFAULT_SPLIT_RATIO);
  });
  withMockStorage({ [STUDIO_SPLIT_RATIO_KEY]: '0.9' }, () => {
    assert.equal(readSplitRatio(), MAX_SPLIT_RATIO);
  });
  withMockStorage({ [STUDIO_SPLIT_RATIO_KEY]: '0.1' }, () => {
    assert.equal(readSplitRatio(), MIN_SPLIT_RATIO);
  });
});

test('storage helpers recover safely when localStorage throws', () => {
  const prior = globalThis.localStorage;
  try {
    globalThis.localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    } as unknown as Storage;
    assert.equal(readStudioViewMode(), 'split');
    assert.equal(readSplitRatio(), DEFAULT_SPLIT_RATIO);
    assert.doesNotThrow(() => saveStudioViewMode('builder'));
    assert.doesNotThrow(() => saveSplitRatio(0.5));
  } finally {
    if (prior) globalThis.localStorage = prior;
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('resolveLabLayout maps lab and non-lab routes across all studio view modes', () => {
  for (const area of ['builder', 'research'] as const) {
    assert.deepEqual(resolveLabLayout(area, 'split'), {
      split: true,
      showResearch: true,
      showBuilder: true,
    });
    assert.deepEqual(resolveLabLayout(area, 'builder'), {
      split: false,
      showResearch: false,
      showBuilder: true,
    });
    assert.deepEqual(resolveLabLayout(area, 'research'), {
      split: false,
      showResearch: true,
      showBuilder: false,
    });
  }

  for (const area of ['scenes', 'formulas', 'scene', 'gaussian', 'gaussian-focus'] as const) {
    for (const mode of ['split', 'builder', 'research'] as const) {
      assert.deepEqual(resolveLabLayout(area, mode), {
        split: false,
        showResearch: false,
        showBuilder: false,
      });
    }
  }
});

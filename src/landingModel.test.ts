import test from 'node:test';
import assert from 'node:assert/strict';
import { isLandingHash, markLandingSeen, readLandingSeen, shouldShowLanding, slopeAfterLens, thinLensImage } from './landingModel';

test('首次访问根地址显示引导页，之后直接进入工作台', () => {
  assert.equal(shouldShowLanding('', false), true);
  assert.equal(shouldShowLanding('#/', false), true);
  assert.equal(shouldShowLanding('', true), false);
  assert.equal(shouldShowLanding('#/scenes', false), false);
  assert.equal(shouldShowLanding('#/home', true), true);
  assert.equal(isLandingHash('#/home/'), true);
});

test('访问标记读写，存储不可用时不抛错', () => {
  const map = new Map<string, string>();
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  assert.equal(readLandingSeen(storage), false);
  markLandingSeen(storage);
  assert.equal(readLandingSeen(storage), true);
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(readLandingSeen(broken), false);
  assert.doesNotThrow(() => markLandingSeen(broken));
});

test('薄透镜：二倍焦距成等大倒立实像，焦距内成放大虚像', () => {
  const f = 100;
  const twoF = thinLensImage(200, f);
  assert.equal(twoF.kind, 'real');
  assert.ok(Math.abs(twoF.v - 200) < 1e-9);
  assert.ok(Math.abs(twoF.magnification + 1) < 1e-9);
  const inside = thinLensImage(50, f);
  assert.equal(inside.kind, 'virtual');
  assert.ok(Math.abs(inside.v + 100) < 1e-9);
  assert.ok(Math.abs(inside.magnification - 2) < 1e-9);
  assert.equal(thinLensImage(100, f).kind, 'infinite');
});

test('不同高度的光线在像点汇聚', () => {
  const f = 100, u = 300, s = 12;
  const { v, magnification } = thinLensImage(u, f);
  const imageHeight = s * magnification;
  for (const h of [-40, -10, 0, 25, 60]) {
    const y = h + slopeAfterLens(s, u, h, f) * v;
    assert.ok(Math.abs(y - imageHeight) < 1e-9, `h=${h} 未汇聚`);
  }
});

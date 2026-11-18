import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowLanding, slopeAfterLens, thinLensImage } from './landingModel';

test('每次访问首页都显示启动页，其他地址直接进入工作台', () => {
  for (const hash of ['', '#', '#/', '#/home', '#/home/']) assert.equal(shouldShowLanding(hash), true, hash);
  for (const hash of ['#/scenes', '#/scene/interference-0', '#/research']) assert.equal(shouldShowLanding(hash), false, hash);
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

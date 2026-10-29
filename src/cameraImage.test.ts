import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cameraContrast, cameraStripe, cameraTarget } from './cameraImage';

test('circular-pupil contrast falls continuously to zero at the cutoff',()=>{
  assert.equal(cameraContrast(0,100),1);
  assert.equal(cameraContrast(100,100),0);
  assert.equal(cameraContrast(120,100),0);
  assert.ok(cameraContrast(20,100)>cameraContrast(60,100));
  assert.ok(Math.abs(cameraContrast(50,100)-.3910022189557707)<1e-12);
});
test('square-pixel stripe average agrees with numerical area integration',()=>{
  for(const period of [6,12,30])for(const pitch of [1,3.45,20]) {
    const center=8.23,steps=10000;
    let integrated=0;
    for(let i=0;i<steps;i++)integrated+=cameraStripe(center-pitch/2+pitch*(i+.5)/steps,period,.73)/steps;
    assert.ok(Math.abs(integrated-cameraStripe(center,period,.73,pitch))<1e-8);
  }
  assert.ok(Math.abs(cameraStripe(0,6,1,6)-.5)<1e-12);
});
test('geometric defocus preserves uniform backgrounds and spreads target edges',()=>{
  assert.ok(Math.abs(cameraTarget(1,1,.1)-.94)<1e-12);
  assert.equal(cameraTarget(-.095,0,0),.12);
  assert.equal(cameraTarget(.1,0,0),.94);
  assert.ok(cameraTarget(-.095,0,.1)>.12);
  assert.ok(cameraTarget(.1,0,.1)<.94);
  assert.ok(Math.abs(cameraTarget(-.11,.04,.01)-(.12+.94)/2)<1e-12);
  assert.ok(Math.abs(cameraTarget(-.11,-.09,.01)-(.94-.82/4))<1e-12);
});

test('F target omits the bottom bar while retaining the same geometric blur',()=>{
  assert.equal(cameraTarget(0,.075,0,'F'),.94);
  assert.equal(cameraTarget(0,-.075,0,'F'),.12);
  assert.ok(Math.abs(cameraTarget(0,.075,.01,'F')-.94)<1e-12);
  assert.ok(Math.abs(cameraTarget(-.11,.04,.01,'F')-(.12+.94)/2)<1e-12);
});

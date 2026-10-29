import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultScene} from './sceneRuntime';
import {immediateTelescope,telescopeOptics} from './telescopeModel';
import {telescopeParameterChange,telescopeSampleResolution} from './telescopeFieldPresentation';
const base=defaultScene('instruments-1');

test('all four studies share optical results and focal edits preserve existing focus',()=>{
 for(const k2 of [-1,1])for(const study of [0,1,2,3]){
  const p={...base.parameters,k2,study,d:200+k2*30};
  const next=telescopeParameterChange(p,'f1',300);
  assert.equal(next.d,300+k2*30);
  assert.equal(telescopeOptics(next).afocal,true);
  const metrics=immediateTelescope({...base,parameters:next}).metrics;
  const reference=immediateTelescope({...base,parameters:{...next,study:0}}).metrics;
  assert.deepEqual(metrics,reference);
  assert.equal(telescopeParameterChange({...p,d:250},'f1',300).d,250);
  assert.equal(telescopeParameterChange(p,'d',250).d,250);
 }
});
test('sample clarity follows resolution while magnification only changes displayed blur size',()=>{
 const p=base.parameters,normal=telescopeSampleResolution(p);
 const larger=telescopeSampleResolution({...p,aperture:p.aperture*2});
 const redder=telescopeSampleResolution({...p,wavelength:p.wavelength*1.2});
 assert.equal(larger.resolution,normal.resolution/2);
 assert.equal(larger.sigmaDegrees,normal.sigmaDegrees/2);
 assert.ok(Math.abs(redder.sigmaDegrees/normal.sigmaDegrees-1.2)<1e-12);
 const magnified=telescopeSampleResolution(telescopeParameterChange(p,'f1',p.f1*2));
 assert.equal(magnified.resolution,normal.resolution);
 assert.equal(magnified.sigmaPixels,normal.sigmaPixels!*2);
 assert.equal(telescopeSampleResolution({...p,d:250}).sigmaPixels,null);
});

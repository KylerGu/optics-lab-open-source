import assert from 'node:assert/strict';
import test from 'node:test';
import {APERTURE_QUANTITIES,apertureDrawable,apertureMeasure} from './apertureQuantities';
import {immediateAperture} from './apertureModel';
import {defaultScene} from './sceneRuntime';
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8*Math.max(1,Math.abs(b)),`${a} != ${b}`);
test('pupil dimensions use full diameter and the signed conjugate position, including lens-limited apertures',()=>{
  for(const z of [-120,-50,0,50,95,105,200,240])for(const stopD of [6,60]){
    const state=defaultScene('aberrations-0');Object.assign(state.parameters,{z,stopD});const result=immediateAperture(state);
    const lensLimited=result.metrics.find(m=>m.key==='apertureStop')!.value===0;
    for(const prefix of ['entrance','exit'] as const){
      const imaged=!lensLimited&&(prefix==='entrance'?z>0:z<0),v=1/(1/100-1/Math.abs(z));
      const pos=lensLimited?0:imaged?(z>0?-v:v):z,diam=lensLimited?40:imaged?Math.abs(v/z)*stopD:stopD;
      const position=apertureMeasure(result,`${prefix}Position`),diameter=apertureMeasure(result,`${prefix}Diameter`);
      close(position.end!,pos);close(diameter.position!,pos);close(diameter.end!-diameter.start!,diam);close(diameter.start!,-diam/2);assert.equal(diameter.vertical,true);
    }
  }
});
test('singular pupils have no finite position or diameter; throughput is not a length toggle',()=>{
  for(const z of [-100,100]){
    const state=defaultScene('aberrations-0');Object.assign(state.parameters,{z,stopD:6});const result=immediateAperture(state),prefix=z>0?'entrance':'exit';
    assert.equal(apertureMeasure(result,`${prefix}Position`).end,null);assert.equal(apertureMeasure(result,`${prefix}Diameter`).start,null);assert.equal(apertureMeasure(result,`${prefix}Diameter`).position,null);
  }
  assert.equal(apertureDrawable('throughput'),false);assert.equal(apertureDrawable('apertureStop'),false);
  assert.equal(new Set(Object.values(APERTURE_QUANTITIES).map(q=>q.color)).size,Object.keys(APERTURE_QUANTITIES).length);
});
test('object, stop, focus and accepted-width dimensions retain their actual endpoints when the beam is clipped or blocked',()=>{
  for(const h of [0,20,60,80])for(const z of [-50,50,200]){
    const state=defaultScene('aberrations-0');Object.assign(state.parameters,{h,z});const result=immediateAperture(state);
    const width=apertureMeasure(result,'acceptedWidth');close(width.end!-width.start!,width.value!);assert.equal(width.position,0);assert.ok(width.start!>=-20&&width.end!<=20);
    const admitted=result.segments.filter(s=>s.role==='transmitted').map(s=>s.start);
    if(width.value!>0)assert.ok(admitted.length>0);
    assert.equal(apertureMeasure(result,'h').position,-200);assert.equal(apertureMeasure(result,'h').end,h);
    assert.equal(apertureMeasure(result,'u').start,-200);assert.equal(apertureMeasure(result,'z').end,z);assert.equal(apertureMeasure(result,'f').end,100);assert.equal(apertureMeasure(result,'v').end,200);
  }
});

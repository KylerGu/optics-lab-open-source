import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WAVE, waveSuperposition, waveHistory, parseWave, waveState } from './waveSuperposition';
import { OPTICS_FORMULAS, opticsValues } from './opticsKnowledgeModel';
const close = (a: number, b: number) => assert.ok(Math.abs(a-b) < 1e-10, `${a} != ${b}`);

test('equal-amplitude coherent limits, unequal cancellation, and absent fields', () => {
  for (const [phaseDeg, amplitude, intensity] of [[0,2,4],[90,Math.SQRT2,2],[180,0,0],[270,Math.SQRT2,2],[360,2,4]]) {
    const b=waveSuperposition({...DEFAULT_WAVE,phaseDeg}); close(b.amplitude,amplitude); close(b.intensity,intensity);
  }
  const cancelled=waveSuperposition({...DEFAULT_WAVE,phaseDeg:180});
  assert.equal(cancelled.resultantPhase,null);
  for(let i=0;i<100;i++) assert.equal(cancelled.fieldsAt(i*.031).sum,0);
  close(waveSuperposition({...DEFAULT_WAVE,amplitude2:.5,phaseDeg:180}).amplitude,.5);
  const single=waveSuperposition({...DEFAULT_WAVE,amplitude1:0,amplitude2:2,phaseDeg:126});close(single.intensity,4);
  assert.equal(waveSuperposition({...DEFAULT_WAVE,amplitude1:0,amplitude2:0}).resultantPhase,null);
  assert.equal(waveSuperposition({...DEFAULT_WAVE,amplitude1:1e-13,amplitude2:0}).amplitude,1e-13);
});

test('period integration independently recovers average intensity and proves position invariance', () => {
  for(let i=0;i<50;i++) {
    const p={...DEFAULT_WAVE,amplitude1:(i%13)/7,amplitude2:(i%11)/6,phaseDeg:i*7.1,wavelengthNm:380+i*7};
    const b=waveSuperposition(p);let mean=0;
    for(let j=0;j<512;j++) {mean+=b.fieldsAt(p.observationUm+j*p.wavelengthNm/1000/512).sum**2/512;}
    close(2*mean,b.intensity);
    const q=waveSuperposition({...p,observationUm:7.7});close(q.intensity,b.intensity);
    close(b.fieldsAt(.23).sum,b.fieldsAt(.23+p.wavelengthNm/1000).sum);
  }
});

test('scene history and formula initial values retain the current optical snapshot', () => {
  const edited={...DEFAULT_WAVE,phaseDeg:180,amplitude2:.5,observationUm:1.317};
  const h=waveHistory({past:[],present:{...DEFAULT_WAVE},future:[]},{type:'commit',parameters:edited});
  assert.deepEqual(waveHistory(h,{type:'undo'}).present,DEFAULT_WAVE);
  assert.deepEqual(waveHistory(waveHistory(h,{type:'undo'}),{type:'redo'}).present,edited);
  for(const f of OPTICS_FORMULAS.filter(f=>f.diagram==='wave-superposition')) {
    const v=opticsValues(f,waveState(edited));close(v.A,.5);close(v.I,.25);assert.equal(v.phi,180);assert.equal(v.tau,undefined);assert.equal(v.z,1.317);
  }
  assert.deepEqual(parseWave({...edited,timePhaseDeg:37.6}),edited);
  assert.throws(()=>parseWave({...edited,timePhaseDeg:true}));
  assert.throws(()=>parseWave({...edited,amplitude1:true}));
  assert.throws(()=>parseWave({...edited,phaseDeg:361}));
});


test('selected-position signed addition enhances or cancels on the shared electric-field scale', () => {
  for (const phaseDeg of [0,90,180,270]) for (const observationUm of [0,.15,.3,1.1,10]) {
    const p={...DEFAULT_WAVE,phaseDeg,observationUm};const q=waveSuperposition(p);
    close(q.observation.sum,q.observation.first+q.observation.second);
    close(q.observation.first,Math.cos(2*Math.PI*observationUm/(p.wavelengthNm/1000)));
  }
  const reinforced=waveSuperposition({...DEFAULT_WAVE,phaseDeg:0,observationUm:0});
  assert.equal(reinforced.observation.sum,2);
  const cancelled=waveSuperposition({...DEFAULT_WAVE,phaseDeg:180,observationUm:0});
  assert.equal(cancelled.observation.first,1);assert.equal(cancelled.observation.second,-1);assert.equal(cancelled.observation.sum,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_YOUNG, youngDoubleSlit, youngHistory, youngState, parseYoung } from './youngDoubleSlit';
import { opticsValues, OPTICS_FORMULAS } from './opticsKnowledgeModel';
const close = (a:number,b:number,tolerance=1e-9) => assert.ok(Math.abs(a-b)<tolerance, `${a} != ${b}`);

test('exact geometry and independently averaged electric fields give the same fringes', () => {
  for(let i=0;i<40;i++) {
    const p={...DEFAULT_YOUNG,wavelengthNm:380+i*10,slitDistanceMm:.1+(i%10)*.1,screenDistanceM:.5+(i%7)*.2,observationMm:i-20};
    const b=youngDoubleSlit(p),q=b.observation;
    close(q.deltaMm,Math.hypot(p.screenDistanceM*1000,p.observationMm+p.slitDistanceMm/2)-Math.hypot(p.screenDistanceM*1000,p.observationMm-p.slitDistanceMm/2));
    let mean=0;
    for(let j=0;j<256;j++) { const phase=j/256*Math.PI*2; mean+=(Math.cos(phase)+Math.cos(phase+Math.PI*2*q.cycles))**2/512; }
    close(mean,q.intensity);
    close(b.at(-p.observationMm).intensity,q.intensity);
    close(b.at(-p.observationMm).deltaMm,-q.deltaMm);
  }
});
test('exact fringe targets remain bright or dark across all parameter corners',()=>{
  for(const wavelengthNm of [380,600,780]) for(const slitDistanceMm of [.1,.5,1]) for(const screenDistanceM of [.5,1,2]) {
    const b=youngDoubleSlit({...DEFAULT_YOUNG,wavelengthNm,slitDistanceMm,screenDistanceM});
    assert.equal(b.at(0).intensity,1);
    assert.equal(b.at(b.firstBrightMm).intensity,1);close(b.at(b.firstBrightMm).cycles,1);
    assert.equal(b.at(b.firstDarkMm).intensity,0);close(b.at(b.firstDarkMm).cycles,.5);
    assert.ok(b.firstBrightMm<=20 && b.firstDarkMm>0);
    close(b.position(-1),-b.firstBrightMm);
  }
});
test('spacing responds to wavelength, distance, and inverse slit separation',()=>{
  const spacing=(patch:Partial<typeof DEFAULT_YOUNG>)=>youngDoubleSlit({...DEFAULT_YOUNG,...patch}).spacingApproxMm;
  close(spacing({}),1.2);close(spacing({screenDistanceM:2}),2.4);close(spacing({slitDistanceMm:1}),.6);close(spacing({wavelengthNm:780}),1.56);
});
test('history and all formula cards retain the current physical snapshot',()=>{
  const p={...DEFAULT_YOUNG,observationMm:youngDoubleSlit(DEFAULT_YOUNG).firstDarkMm};
  const h=youngHistory({past:[],present:{...DEFAULT_YOUNG},future:[]},{type:'commit',parameters:p});
  assert.deepEqual(youngHistory(h,{type:'undo'}).present,DEFAULT_YOUNG);
  assert.deepEqual(youngHistory(youngHistory(h,{type:'undo'}),{type:'redo'}).present,p);
  for(const f of OPTICS_FORMULAS.filter(f=>f.diagram==='young-double-slit')) { const v=opticsValues(f,youngState(p));close(v.delta,.3);assert.equal(v.J,0);close(v.s,1.2);assert.equal(v.y,p.observationMm); }
  for(const invalid of [true,NaN,21]) assert.throws(()=>parseYoung({...p,observationMm:invalid}));
});

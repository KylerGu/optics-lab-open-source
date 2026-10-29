import test from 'node:test';
import assert from 'node:assert/strict';
import {ABERRATION_RESULTS,ABERRATION_SYMBOLS,aberrationMeasure} from './aberrationQuantities';
import {aberrationDimensions,aberrationFocal} from './aberrationModel';
import {immediateScene} from './sceneImmediate';
import {defaultScene,type SceneState} from './sceneRuntime';

function near(a:number,b:number){assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);}
test('effective focal measurement starts at the rear principal plane while BFL starts at the rear vertex',()=>{
  const base=defaultScene('aberrations-1');
  for(const diameter of [2,30,50]){
    const state:SceneState={...base,parameters:{...base.parameters,diameter}},result=immediateScene(state)!;
    const p=state.parameters,t=aberrationDimensions(p).thickness,n=p.A+p.B/(p.wavelength/1000)**2,F=aberrationFocal(p,p.wavelength).effective;
    const effective=aberrationMeasure(result,'effectiveFocal'),back=aberrationMeasure(result,'backFocal');
    near(effective.start!,t-F*t*(n-1)/(n*p.R));
    near(back.start!,t);near(effective.end!,back.end!);
    near(effective.end!-effective.start!,effective.value!);near(back.end!-back.start!,back.value!);
    assert.notEqual(effective.start,back.start);
    const thickness=aberrationMeasure(result,'thickness');near(thickness.start!,0);near(thickness.end!,t);
  }
});
test('spherical and red-blue aberration annotations retain physical endpoints including zero dispersion',()=>{
  const base=defaultScene('aberrations-1');
  for(const B of [0,.004,.012]){
    const state={...base,parameters:{...base.parameters,B}},result=immediateScene(state)!;
    const marginal=aberrationMeasure(result,'marginalFocus'),back=aberrationMeasure(result,'backFocal'),sa=aberrationMeasure(result,'longitudinalSA'),color=aberrationMeasure(result,'chromaticShift');
    near(sa.start!,marginal.end!);near(sa.end!,back.end!);near(sa.end!-sa.start!,sa.value!);
    near(color.end!-color.start!,color.value!);if(B===0)near(color.end!,color.start!);
  }
});
test('annotated RMS radius equals the spread of actual equal-weight screen points',()=>{
  const base=defaultScene('aberrations-1');
  for(const mode of [0,1])for(const screen of [20,60,200]){
    const result=immediateScene({...base,parameters:{...base.parameters,mode,screen}})!,points=result.imagePreview!.points!;
    const cx=points.reduce((s,p)=>s+p.x,0)/points.length,cy=points.reduce((s,p)=>s+p.y,0)/points.length;
    const rms=Math.sqrt(points.reduce((s,p)=>s+(p.x-cx)**2+(p.y-cy)**2,0)/points.length);
    near(aberrationMeasure(result,'rmsRadius').value!,rms);
  }
});

test('each result has a distinct annotation color, and wavelength-specific focal dimensions end at the corresponding focus',()=>{
  assert.equal(new Set(ABERRATION_RESULTS.map(key=>ABERRATION_SYMBOLS[key].color)).size,ABERRATION_RESULTS.length);
  for(const R of [40,100,160])for(const B of [0,.004,.012]){
    const state=defaultScene('aberrations-1');Object.assign(state.parameters,{R,B,mode:1});const result=immediateScene(state)!,t=aberrationDimensions(state.parameters).thickness;
    for(const wave of [450,550,650] as const){
      const key=`backFocal${wave}` as const,measure=aberrationMeasure(result,key),value=aberrationFocal(state.parameters,wave).back;
      near(measure.start!,t);near(measure.end!,t+value);near(measure.value!,value);near(measure.end!-measure.start!,value);
      assert.equal(measure.color,ABERRATION_SYMBOLS[key].color);
    }
  }
});

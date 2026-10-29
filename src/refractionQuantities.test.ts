import assert from 'node:assert/strict';
import test from 'node:test';
import {immediateScene} from './sceneImmediate';
import {defaultScene} from './sceneRuntime';
import {REFRACTION_QUANTITIES,refractionArc,refractionDrawable,type RefractionQuantity} from './refractionQuantities';
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`),DEG=180/Math.PI;
test('interface angles match actual ray directions and the critical-angle reference stays independent of incidence',()=>{
  for(const [n1,n2] of [[1,1.5],[1.5,1],[1.5,1.5]])for(const angle of [0,35,50,89.9]){
    const state=defaultScene('reflection-refraction-0');Object.assign(state.parameters,{n1,n2,angle});const result=immediateScene(state)!;
    for(const key of ['angle','reflectedAngle','transmittedAngle','criticalAngle'] as const){
      const arc=refractionArc(result,key)!;if(arc.reason||arc.value===null)continue;
      near(Math.abs(arc.to-arc.from)*DEG,arc.value);
      if(key==='criticalAngle'){near(arc.value,Math.asin(n2/n1)*DEG);assert.equal(arc.reference,true);continue;}
      const ray=result.segments.find(s=>s.role===(key==='angle'?'incident':key==='reflectedAngle'?'reflected':'transmitted'))!;
      const endpoint=key==='angle'?ray.start:ray.end,phi=Math.atan2(endpoint[1],endpoint[0]);near(Math.cos(arc.to),Math.cos(phi));near(Math.sin(arc.to),Math.sin(phi));
    }
  }
});
test('prism face angles and signed deviation are measured at the actual intersections across positive and negative deviation',()=>{
  for(const [n,outside] of [[1.5,1],[1,1.5],[1,1],[2.5,1]])for(const apex of [10,60,80])for(const angle of [0,10,48.59,89]){
    const state=defaultScene('reflection-refraction-2');Object.assign(state.parameters,{n,outside,apex,angle});const result=immediateScene(state)!;
    for(const key of ['angle','apex','r1','r2','exitAngle','deviation'] as const){
      const arc=refractionArc(result,key)!;if(arc.reason||arc.value===null)continue;
      near(key==='deviation'?(arc.from-arc.to)*DEG:Math.abs(arc.from-arc.to)*DEG,arc.value);
      if(key==='deviation'||key==='exitAngle')assert.deepEqual(arc.center,result.segments.find(s=>s.role==='transmitted')!.start);
    }
  }
});
test('absent refraction, missing critical angles, and blocked prism exits have no fictitious current-light angle',()=>{
  const tir=immediateScene(defaultScene('reflection-refraction-1'))!;assert.equal(refractionArc(tir,'transmittedAngle')!.reason,'无传播折射光');
  const ordinary=immediateScene(defaultScene('reflection-refraction-0'))!;assert.equal(refractionArc(ordinary,'criticalAngle')!.reason,'无全反射临界角');
  const prism=defaultScene('reflection-refraction-2');prism.parameters.angle=10;const result=immediateScene(prism)!;
  assert.equal(refractionArc(result,'exitAngle')!.reason,'无第二面出射光');assert.equal(refractionArc(result,'deviation')!.reason,'无第二面出射光');
  for(const model of ['interface','prism'])for(const key of ['R','T','minimumDeviation'])assert.equal(refractionDrawable(model,key),false);
});
test('each scene uses distinct result colors and only physical diagram quantities toggle',()=>{
  for(const keys of [['reflectedAngle','transmittedAngle','criticalAngle','R','T'],['r1','r2','exitAngle','deviation','minimumDeviation']])assert.equal(new Set(keys.map(k=>REFRACTION_QUANTITIES[k as keyof typeof REFRACTION_QUANTITIES].color)).size,keys.length);
  assert.equal(refractionDrawable('lens','angle'),false);assert.equal(refractionDrawable('interface','apex'),false);assert.equal(refractionArc(immediateScene(defaultScene('reflection-refraction-2'))!,'n' as RefractionQuantity),null);
});

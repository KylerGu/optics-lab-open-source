import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {DEFAULT_COUPLING,fiberCoupling,couplingHistory,parseCoupling} from './fiberCoupling';
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-10*Math.max(1,Math.abs(b)),`${a} != ${b}`);
test('Gaussian coupling reference limits, symmetry and power conservation',()=>{
  const p={...DEFAULT_COUPLING,beamRadiusUm:5,modeRadiusUm:5,offsetUm:0,tiltDeg:0};
  close(fiberCoupling(p).efficiency,1);close(fiberCoupling(p).lossDb,0);
  close(fiberCoupling({...p,offsetUm:5}).efficiency,Math.exp(-1));
  close(fiberCoupling({...p,beamRadiusUm:10}).efficiency,.64);
  const tilted={...p,tiltDeg:2};close(fiberCoupling(tilted).efficiency,Math.exp(-((Math.PI*5*Math.sin(2*Math.PI/180)/1.55)**2)));
  const a=fiberCoupling(DEFAULT_COUPLING),b=fiberCoupling({...DEFAULT_COUPLING,offsetUm:-DEFAULT_COUPLING.offsetUm,tiltDeg:-DEFAULT_COUPLING.tiltDeg,powerMw:2});
  close(a.efficiency,b.efficiency);close(b.coupledPowerMw,2*a.coupledPowerMw);
  close(a.efficiency,a.sizePct*a.positionPct*a.anglePct/1e6);
});
test('overlap agrees with independent complex Gaussian field integration',()=>{
  const integrate=(f:(x:number)=>number,R:number)=>{const N=4000,step=2*R/N;let sum=f(-R)+f(R);for(let j=1;j<N;j++)sum+=(j%2?4:2)*f(-R+j*step);return sum*step/3;};
  for(const [w,f,d,t] of [[3,5,2,2],[5,5,-3,-1],[4,7,0,0]]){
    const R=8*Math.max(w,f)+Math.abs(d),q=2*Math.PI/1.55*Math.sin(t*Math.PI/180);
    const Ix=integrate(x=>Math.exp(-x*x/(w*w)-x*x/(f*f)),R);
    const IyReal=integrate(y=>Math.exp(-((y-d)**2)/(w*w)-y*y/(f*f))*Math.cos(q*y),R);
    const IyImag=integrate(y=>Math.exp(-((y-d)**2)/(w*w)-y*y/(f*f))*Math.sin(q*y),R);
    const eta=(2*Ix/(Math.PI*w*f))**2*(IyReal**2+IyImag**2);
    close(fiberCoupling({...DEFAULT_COUPLING,beamRadiusUm:w,modeRadiusUm:f,offsetUm:d,tiltDeg:t}).efficiency,eta);
  }
});
test('frontend matches backend across parameter extremes and history preserves snapshots',()=>{
  const states=[];for(const beamRadiusUm of [1,4,15])for(const modeRadiusUm of [1,5.2,10])for(const wavelengthNm of [400,1550,1700])for(const offsetUm of [-15,0,15])for(const tiltDeg of [-5,0,5])states.push({...DEFAULT_COUPLING,beamRadiusUm,modeRadiusUm,wavelengthNm,offsetUm,tiltDeg});
  const raw=execFileSync('python',['-c','import json,sys;from backend.scene_fiber_coupling import coupling_values;print(json.dumps([coupling_values(p) for p in json.load(sys.stdin)]))'],{input:JSON.stringify(states),encoding:'utf8'});const results=JSON.parse(raw);
  states.forEach((p,j)=>{const b=fiberCoupling(p);for(const key of Object.keys(b) as (keyof typeof b)[])close(b[key],results[j][key]);assert.ok(b.efficiency>=0&&b.efficiency<=1);assert.ok(b.coupledPowerMw<=p.powerMw);assert.ok(Number.isFinite(b.lossDb));});
  const original={past:[],present:DEFAULT_COUPLING,future:[]},edited=couplingHistory(original,{type:'commit',parameters:{...DEFAULT_COUPLING,offsetUm:4}});
  assert.equal(couplingHistory(edited,{type:'undo'}).present.offsetUm,1.5);assert.equal(couplingHistory(couplingHistory(edited,{type:'undo'}),{type:'redo'}).present.offsetUm,4);assert.throws(()=>parseCoupling({...DEFAULT_COUPLING,modeRadiusUm:0}));assert.throws(()=>parseCoupling({...DEFAULT_COUPLING,tiltDeg:true}));
});

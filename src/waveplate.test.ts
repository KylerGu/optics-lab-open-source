import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { DEFAULT_WAVEPLATE, waveplate, fieldPoint, waveplateBuilderCopy, waveplateHistory, parseWaveplate, waveplateState } from './waveplate';
import { opticsValues, OPTICS_FORMULAS } from './opticsKnowledgeModel';
import { waveplateSpatialField, waveplateAngleFromPlane, WAVEPLATE_OUTPUT_X, WAVEPLATE_SPATIAL_K } from './waveplateGeometry';
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-9*Math.max(1,Math.abs(b)),`${a} ≠ ${b}`);

test('spatial electric field travels forward and matches the simultaneous front projection',()=>{
  for(const plateType of [0,1])for(const inputAngleDeg of [0,17,90])for(const axisAngleDeg of [0,22.5,45,135]){
    const p={...DEFAULT_WAVEPLATE,plateType,inputAngleDeg,axisAngleDeg},b=waveplate(p);
    for(const phase of [0,.83,2.17]){
      const output=waveplateSpatialField(p,WAVEPLATE_OUTPUT_X,phase),front=fieldPoint(b,phase);
      close(output.x,front.x);close(output.y,front.y);
      for(const x of [-2,1]){const before=waveplateSpatialField(p,x,phase),after=waveplateSpatialField(p,x+.1,phase+WAVEPLATE_SPATIAL_K*.1);close(before.x,after.x);close(before.y,after.y);}
      const input=waveplateSpatialField(p,-1,phase),alpha=inputAngleDeg*Math.PI/180;
      close(input.x*Math.sin(alpha)-input.y*Math.cos(alpha),0);
      const beta=axisAngleDeg*Math.PI/180,local=phase+WAVEPLATE_SPATIAL_K*WAVEPLATE_OUTPUT_X;
      const atPlate=waveplateSpatialField(p,0,phase);
      close(atPlate.x*Math.cos(beta)+atPlate.y*Math.sin(beta),Math.cos(alpha-beta)*Math.cos(local));
    }
  }
  assert.deepEqual(waveplateSpatialField({...DEFAULT_WAVEPLATE,powerMw:0},2,1),{x:0,y:0});
  for(const angle of [0,17,45,90,135,179]){const r=angle*Math.PI/180;assert.equal(waveplateAngleFromPlane(Math.sin(r),-Math.cos(r)),angle);assert.equal(waveplateAngleFromPlane(-Math.sin(r),Math.cos(r)),angle);}
});
test('independent half-wave rotation, quarter-wave ellipse and field-time convention',()=>{
  for(const inputAngleDeg of [0,17,45,90,180])for(const axisAngleDeg of [0,22.5,45,90,180]){
    const p={...DEFAULT_WAVEPLATE,inputAngleDeg,axisAngleDeg};
    const half=waveplate({...p,plateType:1}),expected=(2*axisAngleDeg-inputAngleDeg)*Math.PI/180;
    assert.equal(half.polarization,'线偏振');close(half.s1!,Math.cos(2*expected));close(half.s2!,Math.sin(2*expected));assert.equal(half.s3,0);assert.equal(half.axisRatio,0);
    const quarter=waveplate({...p,plateType:0}),theta=(inputAngleDeg-axisAngleDeg)*Math.PI/180;
    close(quarter.s3!,-Math.sin(2*theta));close(quarter.axisRatio!,Math.min(Math.abs(Math.tan(theta)),1/Math.abs(Math.tan(theta))));
    close(quarter.s1!**2+quarter.s2!**2+quarter.s3!**2,1);
    close(quarter.ex.re**2+quarter.ex.im**2+quarter.ey.re**2+quarter.ey.im**2,1);
    const f0=fieldPoint(quarter,0),f90=fieldPoint(quarter,Math.PI/2);
    close(f0.x*f90.y-f0.y*f90.x,-quarter.s3!/2);
    const projectedAt=fieldPoint(quarter,.73),beta=axisAngleDeg*Math.PI/180;
    close(projectedAt.x*Math.cos(beta)+projectedAt.y*Math.sin(beta),Math.cos(theta)*Math.cos(.73));
    close(-projectedAt.x*Math.sin(beta)+projectedAt.y*Math.cos(beta),Math.sin(theta)*Math.sin(.73));
  }
  const circular=waveplate(DEFAULT_WAVEPLATE);assert.equal(circular.polarization,'圆偏振');assert.equal(circular.majorAngleDeg,null);assert.equal(circular.rotation,'顺时针');
  assert.equal(waveplate({...DEFAULT_WAVEPLATE,axisAngleDeg:135}).rotation,'逆时针');
  const off=waveplate({...DEFAULT_WAVEPLATE,powerMw:0});assert.equal(off.polarization,'光源关闭');assert.equal(off.s3,null);assert.equal(off.axisRatio,null);
});
test('frontend, backend and complete builder copies agree on power and polarization',()=>{
  const states=[];for(const powerMw of [0,.1,10,20])for(const plateType of [0,1])for(const inputAngleDeg of [0,17,90,180])for(const axisAngleDeg of [0,22.5,45,135,180])states.push({...DEFAULT_WAVEPLATE,powerMw,plateType,inputAngleDeg,axisAngleDeg});
  const rows=states.map(p=>({p,copy:waveplateBuilderCopy(p)}));
  const results=JSON.parse(execFileSync('python',['-c','import json,sys;from backend.scene_waveplate import waveplate_values;from backend.spatial import trace,SpatialExperiment;print(json.dumps([dict(scene=waveplate_values(r["p"]),detector=trace(SpatialExperiment.model_validate(r["copy"]))["screens"][0]) for r in json.load(sys.stdin)]))'],{input:JSON.stringify(rows),encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'},maxBuffer:4*1024*1024}));
  states.forEach((p,i)=>{const b=waveplate(p),r=results[i];for(const key of ['phaseDeg','outputPowerMw','majorAngleDeg','axisRatio','s1','s2','s3'] as const){if(b[key]===null)assert.equal(r.scene[key],null);else close(b[key]!,r.scene[key]);}assert.equal(b.polarization,r.scene.polarization);assert.equal(b.rotation,r.scene.rotation);close(b.outputPowerMw,r.detector.readingMw);
    if(p.powerMw===0)assert.equal(r.detector.polarizationStokes,null);else for(const k of ['s1','s2','s3'] as const)close(b[k]!,r.detector.polarizationStokes[k]);
    const [source,plate,meter]=rows[i].copy.elements;assert.equal(source.polarizationDeg,p.inputAngleDeg);assert.equal(plate.rollDeg,p.axisAngleDeg);assert.equal(plate.kind,p.plateType===0?'quarter-wave-plate':'half-wave-plate');assert.equal(plate.designWavelengthNm,source.wavelengthNm);assert.equal(meter.kind,'power-meter');
  });
});
test('validation, formula linkage and history keep independent controls',()=>{
  const h={past:[],present:DEFAULT_WAVEPLATE,future:[]},edited=waveplateHistory(h,{type:'commit',parameters:{...DEFAULT_WAVEPLATE,axisAngleDeg:90}});
  assert.equal(edited.present.powerMw,h.present.powerMw);assert.equal(waveplateHistory(edited,{type:'undo'}).present.axisAngleDeg,45);assert.equal(waveplateHistory(waveplateHistory(edited,{type:'undo'}),{type:'redo'}).present.axisAngleDeg,90);
  for(const patch of [{powerMw:-1},{plateType:.5},{inputAngleDeg:true},{axisAngleDeg:181}])assert.throws(()=>parseWaveplate({...DEFAULT_WAVEPLATE,...patch}));
  const f=OPTICS_FORMULAS.find(f=>f.id==='waveplate-s3')!,v=opticsValues(f,waveplateState(DEFAULT_WAVEPLATE));assert.equal(v.S3,1);assert.equal(v.delta,90);assert.equal(v.beta,45);
});

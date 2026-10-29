import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { DEFAULT_MALUS, malus, malusBuilderCopy, malusHistory, parseMalus } from './malus';
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-9*Math.max(1,Math.abs(b)),`${a} != ${b}`);
test('Malus power agrees with independent vector projection and direction equivalence',()=>{
  for(const inputAngleDeg of [0,17,45,90,135,180])for(const axisAngleDeg of [0,30,45,90,150,180]){
    const a=inputAngleDeg*Math.PI/180,b=axisAngleDeg*Math.PI/180,dot=Math.cos(a)*Math.cos(b)+Math.sin(a)*Math.sin(b);
    const result=malus({...DEFAULT_MALUS,inputAngleDeg,axisAngleDeg});close(result.outputPowerMw,10*dot*dot);
    assert.ok(result.relativeAngleDeg>=0&&result.relativeAngleDeg<=90);assert.ok(result.transmissionPct>=0&&result.transmissionPct<=100);
  }
  assert.equal(malus({...DEFAULT_MALUS,axisAngleDeg:90}).outputPowerMw,0);
  assert.equal(malus({...DEFAULT_MALUS,axisAngleDeg:180}).transmissionPct,100);
  assert.equal(malus({...DEFAULT_MALUS,powerMw:0}).outputPowerMw,0);
  close(malus(DEFAULT_MALUS).transmissionPct,50);
});
test('scene, backend and complete apparatus copies agree for powers and axis extremes',()=>{
  const states=[];for(const powerMw of [0,.1,10,20])for(const inputAngleDeg of [0,17,90,180])for(const axisAngleDeg of [0,45,90,180])states.push({...DEFAULT_MALUS,powerMw,inputAngleDeg,axisAngleDeg});
  const rows=states.map(p=>({p,copy:malusBuilderCopy(p)}));
  const results=JSON.parse(execFileSync('python',['-c','import json,sys;from backend.scene_malus import malus_values;from backend.spatial import trace,SpatialExperiment;print(json.dumps([dict(scene=malus_values(r["p"]),meter=trace(SpatialExperiment.model_validate(r["copy"]))["screens"][0]["readingMw"]) for r in json.load(sys.stdin)]))'],{input:JSON.stringify(rows),encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'},maxBuffer:4*1024*1024}));
  states.forEach((p,i)=>{const b=malus(p);for(const key of Object.keys(b) as (keyof typeof b)[])close(b[key],results[i].scene[key]);close(b.outputPowerMw,results[i].meter);const [source,polarizer,meter]=rows[i].copy.elements;assert.equal(source.powerMw,p.powerMw);assert.equal(source.polarizationDeg,p.inputAngleDeg);assert.equal(polarizer.rollDeg,p.axisAngleDeg);assert.equal(polarizer.transmission,1);assert.equal(meter.kind,'power-meter');});
});
test('history, validation and saved scene parameters preserve independent quantities',()=>{
  const original={past:[],present:DEFAULT_MALUS,future:[]};const changed=malusHistory(original,{type:'commit',parameters:{...DEFAULT_MALUS,axisAngleDeg:90}});
  assert.equal(changed.present.powerMw,original.present.powerMw);assert.equal(malusHistory(changed,{type:'undo'}).present.axisAngleDeg,45);
  assert.equal(malusHistory(malusHistory(changed,{type:'undo'}),{type:'redo'}).present.axisAngleDeg,90);
  assert.throws(()=>parseMalus({...DEFAULT_MALUS,powerMw:-1}));assert.throws(()=>parseMalus({...DEFAULT_MALUS,axisAngleDeg:181}));assert.throws(()=>parseMalus({...DEFAULT_MALUS,inputAngleDeg:true}));
});

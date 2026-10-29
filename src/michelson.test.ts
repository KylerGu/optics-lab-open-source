import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {DEFAULT_MICHELSON,michelson,michelsonTarget,michelsonHistory,michelsonState,parseMichelson} from './michelson';
import {OPTICS_FORMULAS,opticsValues} from './opticsKnowledgeModel';
import {michelsonBuilderCopy} from './michelsonBuilderCopy';
import {parseSpatial} from './builderModel';
import * as THREE from 'three';
import {createMichelsonHardware} from './Michelson3D';
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('3D optics and support bases remain on the beam coordinates through movement and reset',()=>{
  const copy=michelsonBuilderCopy(DEFAULT_MICHELSON);
  for(const element of copy.elements){
    const initial=new THREE.Vector3(...element.position).sub(new THREE.Vector3(260,0,0));
    const {group,optic}=createMichelsonHardware(element,initial);
    const base=group.children[1].getObjectByName('base')!;
    const anchor=new THREE.Vector3(),foot=new THREE.Vector3();
    for(const offset of [new THREE.Vector3(),new THREE.Vector3(-28,0,15),new THREE.Vector3()]){
      group.position.copy(offset);group.updateMatrixWorld(true);
      const expected=initial.clone().add(offset);
      optic.getWorldPosition(anchor);base.getWorldPosition(foot);
      assert.ok(anchor.distanceTo(expected)<1e-9,`${element.id} detached from its beam`);
      // The laser stand is centered under its body, 19 mm behind the emitting plane.
      close(foot.x,expected.x-(element.kind==='laser'?19:0));close(foot.z,expected.z);close(foot.y,2.5);
      assert.equal(optic.getObjectByName('selection')?.visible,false);
    }
    if(element.kind==='laser')assert.ok(optic.getObjectByName('laser-aperture'));
    group.traverse(object=>{
      const mesh=object as THREE.Mesh;mesh.geometry?.dispose();
      if(mesh.material)for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])material.dispose();
    });
  }
});
test('equal arms produce a uniform bright port, independent field averaging recovers intensity',()=>{
  for(const radius of [0,2,5,12])assert.equal(michelson({...DEFAULT_MICHELSON,baseDifferenceUm:0}).at(radius).intensity,1);
  for(let i=0;i<25;i++){
    const p={...DEFAULT_MICHELSON,baseDifferenceUm:i*19-230,mirrorMoveUm:(i%7)/4-1,observationRadiusMm:i/2,focalLengthMm:75+i*5};
    const q=michelson(p).observation;let mean=0;
    for(let j=0;j<256;j++){const t=j*Math.PI*2/256;mean+=(Math.cos(t)+Math.cos(t+2*Math.PI*q.cycles))**2/512;}
    close(mean,q.intensity);close(q.deltaUm,2*(p.baseDifferenceUm+p.mirrorMoveUm)*Math.cos(Math.atan(p.observationRadiusMm/p.focalLengthMm)));
    close(michelson(p).at(-p.observationRadiusMm).intensity,q.intensity);
  }
});
test('quarter and half wavelength steps flip and repeat axial brightness, off axis has cosine factor',()=>{
  for(const wavelengthNm of [380,600,780]){
    const p={...DEFAULT_MICHELSON,wavelengthNm,observationRadiusMm:0};const b=michelson(p);
    close(michelson({...p,mirrorMoveUm:wavelengthNm/4000}).axis.intensity,1-b.axis.intensity);
    close(michelson({...p,mirrorMoveUm:wavelengthNm/2000}).axis.intensity,b.axis.intensity);
    const move=michelson({...p,mirrorMoveUm:wavelengthNm/2000});close(move.fringeShift,1);close(move.observation.deltaUm-b.observation.deltaUm,wavelengthNm/1000);
  }
});
test('exact bright and dark targets preserve the apparatus and handle signed large path differences',()=>{
  for(const baseDifferenceUm of [-500,-120,0,120,500])for(const mirrorMoveUm of [-1,0,1])for(const observationRadiusMm of [0,5,12])for(const kind of ['bright','dark'] as const){
    const p={...DEFAULT_MICHELSON,baseDifferenceUm,mirrorMoveUm,observationRadiusMm};const move=michelsonTarget(p,kind);
    assert.ok(move>=-1&&move<=1);assert.equal(michelson({...p,mirrorMoveUm:move}).observation.intensity,kind==='bright'?1:0);
  }
});
test('history, valid inputs and formula snapshots preserve exact mirror position',()=>{
  const p={...DEFAULT_MICHELSON,mirrorMoveUm:michelsonTarget(DEFAULT_MICHELSON,'dark')};
  const h=michelsonHistory({past:[],present:{...DEFAULT_MICHELSON},future:[]},{type:'commit',parameters:p});
  assert.deepEqual(michelsonHistory(h,{type:'undo'}).present,DEFAULT_MICHELSON);assert.deepEqual(michelsonHistory(michelsonHistory(h,{type:'undo'}),{type:'redo'}).present,p);
  for(const f of OPTICS_FORMULAS.filter(f=>f.diagram==='michelson')){const v=opticsValues(f,michelsonState(p));close(v.s,p.mirrorMoveUm);assert.equal(v.J,0);close(v.delta,michelson(p).observation.deltaUm);close(v.N,2*p.mirrorMoveUm/.6);}
  for(const invalid of [true,NaN,1.01])assert.throws(()=>parseMichelson({...p,mirrorMoveUm:invalid}));
});
test('browser computations match authoritative scene evidence at parameter corners',()=>{
  const states=[];for(let i=0;i<60;i++)states.push(michelsonState({...DEFAULT_MICHELSON,wavelengthNm:[380,600,780][i%3],baseDifferenceUm:[-500,-120,0,120,500][i%5],mirrorMoveUm:[-1,-.15,0,.15,1][i%5],mirror1MoveUm:[-1,.123456789,1][i%3],sourceDistanceMm:[65,100,150][i%3],lensDistanceMm:[35,50,80][i%3],focalLengthMm:[75,100,200][i%3],observationRadiusMm:[0,5,12][i%3]}));
  const result=spawnSync('python',['-c','import json,sys;from backend.scene_physics import calculate;print(json.dumps([calculate(s) for s in json.load(sys.stdin)]))'],{input:JSON.stringify(states),encoding:'utf8',maxBuffer:16*1024*1024});
  assert.equal(result.status,0,result.stderr);const evidence=JSON.parse(result.stdout);
  states.forEach((state,i)=>{const b=michelson(state.parameters as unknown as typeof DEFAULT_MICHELSON),r=evidence[i],values={differenceUm:b.differenceUm,axisDeltaUm:b.axis.deltaUm,deltaUm:b.observation.deltaUm,intensity:b.observation.intensity,cycles:b.observation.cycles,fringeShift:b.fringeShift,oneFringeMoveUm:b.oneFringeMoveUm,arm1Mm:b.arm1Mm,arm2Mm:b.arm2Mm,angleDeg:b.observation.angleDeg};assert.deepEqual(r.input,state);assert.equal(r.status,b.status);for(const [key,value] of Object.entries(values))close(r.metrics.find((m:{key:string})=>m.key===key).value,value);for(const q of r.curve)close(q.y,b.at(q.x).intensity);});
});
test('both mirrors change the physical arm difference with opposite signs; common motion cancels',()=>{
  const p={...DEFAULT_MICHELSON,mirror1MoveUm:.37,mirrorMoveUm:.52};const b=michelson(p);
  close(b.arm1Mm,100.00037);close(b.arm2Mm,100.12052);close(b.axis.deltaUm,240.3);assert.equal(b.axis.intensity,0);
  close(michelson({...p,mirror1MoveUm:.52}).axis.deltaUm,240);assert.equal(michelson({...p,mirror1MoveUm:.52}).axis.intensity,1);
  for(const mirror1MoveUm of [-1,-.123456789,1])for(const observationRadiusMm of [0,12])for(const target of ['bright','dark'] as const){const q={...p,mirror1MoveUm,observationRadiusMm};assert.equal(michelson({...q,mirrorMoveUm:michelsonTarget(q,target)}).observation.intensity,target==='bright'?1:0);}
  const values=opticsValues(OPTICS_FORMULAS.find(f=>f.id==='michelson-path')!,michelsonState(p));close(values.s,.15);close(values.delta,b.observation.deltaUm);
  assert.equal(michelson({...p,sourceDistanceMm:150,lensDistanceMm:80}).axis.intensity,b.axis.intensity);
});
test('spatial copies preserve exact independent mirror, source, lens and focal-plane poses',()=>{
  const p={...DEFAULT_MICHELSON,mirror1MoveUm:.123456789,mirrorMoveUm:-.987654321,sourceDistanceMm:137.3,lensDistanceMm:72.4,focalLengthMm:150,wavelengthNm:650};
  const snapshot={...p},copy=michelsonBuilderCopy(p),element=(id:string)=>copy.elements.find(e=>e.id==='michelson-'+id)!;
  assert.equal(copy.elements.length,7);assert.deepEqual(parseSpatial(JSON.parse(JSON.stringify(copy))),copy);assert.deepEqual(p,snapshot);
  const bs=element('splitter').position;close(element('mirror1').position[0]-bs[0],michelson(p).arm1Mm);close(element('mirror2').position[2]-bs[2],michelson(p).arm2Mm);
  close(bs[0]-element('source').position[0],137.3);close(bs[2]-element('lens').position[2],72.4);close(element('lens').position[2]-element('screen').position[2],150);
  assert.equal(element('source').wavelengthNm,650);assert.equal(element('splitter').transmission,.5);assert.equal(element('lens').focalLengthMm,150);
  copy.elements[2].position[0]+=10;assert.deepEqual(p,snapshot);assert.notEqual(michelsonBuilderCopy(p).elements[2].position[0],copy.elements[2].position[0]);
});
test('copied chief beams each make one mirror round trip and reunite at the detector',()=>{
  const copy=michelsonBuilderCopy(DEFAULT_MICHELSON);
  const r=spawnSync('python',['-c','import json,sys;from backend.spatial import SpatialExperiment,trace;print(json.dumps(trace(SpatialExperiment.model_validate(json.loads(sys.stdin.buffer.read().decode("utf-8"))))))'],{input:JSON.stringify(copy),encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);const evidence=JSON.parse(r.stdout),chief=evidence.segments.filter((s:{chief:boolean})=>s.chief);
  for(const id of ['mirror1','mirror2','lens','screen'])assert.ok(chief.some((s:{hitId:string})=>s.hitId==='michelson-'+id),'Missing copied ray at '+id);
  const hits=chief.filter((s:{hitId:string})=>s.hitId==='michelson-screen');assert.equal(hits.length,2);
  close(hits.reduce((s:number,q:{powerMw:number})=>s+q.powerMw,0),5/9); // One chief sample among nine equal-power rays.
  close(evidence.screens.find((s:{elementId:string})=>s.elementId==='michelson-screen').sampledPowerMw,5); // Powers add without coherent interference in the builder.
  for(const mirror of ['mirror1','mirror2']){const position=copy.elements.find(e=>e.id==='michelson-'+mirror)!.position;assert.ok(chief.some((s:{start:number[];hitId:string})=>s.start.every((v,i)=>Math.abs(v-position[i])<1e-5)&&s.hitId==='michelson-'+(mirror==='mirror1'?'compensator':'splitter')),'Return missing at '+mirror);}
});

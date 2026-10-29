import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { DEFAULT_POLARIZATION_REFRACTION as D,brewster,birefringence,fresnel,polarizationRefractionHistory,parsePolarizationRefraction,polarizationRefractionState,polarizationAngleFromPoint } from './polarizationRefraction';
import { crystalLayout,refractionLayout } from './polarizationDiagramGeometry';
import { OPTICS_FORMULAS,opticsValues } from './opticsKnowledgeModel';
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-9*Math.max(1,Math.abs(b)),`${a} != ${b}`);
test('Brewster null is p only, single-interface power is conserved, critical and matched media are defined',()=>{
  for(const n1 of [1,1.5,2.4])for(const n2 of [1,1.5,2.4]){
    const normal=fresnel(n1,n2,0),expected=((n1-n2)/(n1+n2))**2;close(normal.rs,expected);close(normal.rp,expected);
    const angle=Math.atan(n2/n1)*180/Math.PI,b=brewster({...D,n1,n2,angleDeg:angle});close(b.rp,0);
    if(n1!==n2){close(b.transmissionDeg!+angle,90);assert.ok(b.rs>0);assert.equal(b.status,'p 光不反射');}
    else{assert.equal(b.brewsterDeg,null);assert.equal(b.status,'无折射率差');}
    for(const polarization of [0,1,2])for(const angleDeg of [0,20,50,70,89.9]){const b=brewster({...D,n1,n2,angleDeg,polarization});close(b.reflectancePct+b.transmissionPct,100);assert.ok(b.reflectancePct>=0&&b.reflectancePct<=100);}
    if(n1>n2){const angleDeg=Math.asin(n2/n1)*180/Math.PI,c=brewster({...D,n1,n2,angleDeg});assert.equal(c.critical,true);assert.equal(c.transmissionDeg,90);assert.equal(c.transmissionPct,0);assert.equal(c.tir,false);assert.equal(brewster({...D,n1,n2,angleDeg:angleDeg+.1}).tir,true);}
  }
});
test('crystal energy-flow gradient sets signed walkoff, equal and principal axes do not split',()=>{
  for(const ordinaryIndex of [1,1.486,1.658,2.4])for(const extraordinaryIndex of [1,1.486,1.658,2.4])for(const axisAngleDeg of [0,17,45,90]){
    const p={...D,ordinaryIndex,extraordinaryIndex,axisAngleDeg},b=birefringence(p),g=axisAngleDeg*Math.PI/180,c=Math.cos(g),s=Math.sin(g);
    // Normal to the phase-index ellipse, independently differentiated in lab axes.
    const gx=c*c/ordinaryIndex**2+s*s/extraordinaryIndex**2,gy=c*s*(1/ordinaryIndex**2-1/extraordinaryIndex**2);
    close(b.tangent,gy/gx);close(b.effectiveIndex,1/Math.sqrt(gx));close(b.signedSeparationMm,D.thicknessMm*gy/gx);
    close(b.separationMm,Math.abs(b.signedSeparationMm));close(birefringence({...p,thicknessMm:20}).separationMm,2*b.separationMm);
    if(ordinaryIndex===extraordinaryIndex||axisAngleDeg===0||axisAngleDeg===90)assert.equal(b.separationMm,0);
  }
  assert.ok(birefringence(D).walkoffDeg<0);assert.ok(birefringence({...D,ordinaryIndex:D.extraordinaryIndex,extraordinaryIndex:D.ordinaryIndex}).walkoffDeg>0);
});
test('frontend and backend agree over both model grids',()=>{
  const states=[];
  for(const n1 of [1,1.5,2.4])for(const n2 of [1,1.5,2.4])for(const angleDeg of [0,30,55,70,89.9])for(const polarization of [0,1,2])states.push({...D,n1,n2,angleDeg,polarization});
  for(const ordinaryIndex of [1,1.486,1.658,2.4])for(const extraordinaryIndex of [1,1.486,1.658,2.4])for(const axisAngleDeg of [0,17,45,90])for(const thicknessMm of [1,10,20])states.push({...D,mode:1,ordinaryIndex,extraordinaryIndex,axisAngleDeg,thicknessMm});
  const rows=JSON.parse(execFileSync('python',['-c','import json,sys;from backend.scene_polarization_refraction import brewster_values,crystal_values;print(json.dumps([(brewster_values(p) if p["mode"]==0 else crystal_values(p)) for p in json.load(sys.stdin)]))'],{input:JSON.stringify(states),encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'}}));
  states.forEach((p,i)=>{const b=p.mode===0?brewster(p):birefringence(p);for(const [k,v] of Object.entries(b)){const other=rows[i][k];if(typeof v==='number')close(v,other);else assert.equal(v,other);}});
});
test('direct geometry preserves physical angles and millimeter separation, history and formula link correctly',()=>{
  for(const width of [390,486,774,1374])for(const thicknessMm of [1,10,20])for(const ordinaryIndex of [1,1.658,2.4])for(const extraordinaryIndex of [1,1.486,2.4]){
    const p={...D,ordinaryIndex,extraordinaryIndex,thicknessMm},q=crystalLayout(width,629,p);close((q.right-q.left)/q.scale,thicknessMm);close(Math.abs(q.exitY-q.cy)/q.scale,birefringence(p).separationMm);close((q.left+q.right)/2,q.w/2);assert.ok(q.exitY>q.cy-q.halfHeight&&q.exitY<q.cy+q.halfHeight);
  }
  const g=refractionLayout(774,629);close(g.cx,g.w/2);
  for(const angle of [0,17,45,89]){const a=angle*Math.PI/180;close(polarizationAngleFromPoint(-100*Math.sin(a),-100*Math.cos(a),0,0,0),angle);close(polarizationAngleFromPoint(100*Math.cos(a),-100*Math.sin(a),0,0,1),angle);}
  const h={past:[],present:D,future:[]},changed=polarizationRefractionHistory(h,{type:'commit',parameters:{...D,angleDeg:35}});assert.deepEqual(polarizationRefractionHistory(changed,{type:'undo'}).present,D);
  for(const patch of [{n1:0},{mode:.5},{axisAngleDeg:91},{polarization:true},{thicknessMm:0}])assert.throws(()=>parsePolarizationRefraction({...D,...patch}));
  const f=OPTICS_FORMULAS.find(f=>f.id==='brewster-angle')!,v=opticsValues(f,polarizationRefractionState(D));close(v.thetaB,brewster(D).brewsterDeg!);
  const c=OPTICS_FORMULAS.find(f=>f.id==='crystal-separation')!,u=opticsValues(c,polarizationRefractionState({...D,mode:1}));close(u.d,birefringence(D).separationMm);
});

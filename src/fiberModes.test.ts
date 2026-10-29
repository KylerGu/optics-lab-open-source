import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { DEFAULT_FIBER, FIBER_CUTOFF, FIBER_ID, fiberModes, fiberHistory, fiberState, parseFiber } from './fiberModes';
import { opticsValues, OPTICS_FORMULAS } from './opticsKnowledgeModel';
import { angleFromPoint, diagramLayout } from './fiberDiagramGeometry';

const close = (a: number, b: number) => assert.ok(Math.abs(a-b) < 1e-9*Math.max(1,Math.abs(b)),`${a} ≠ ${b}`);
test('diagram directions use equal axis scales and angle dragging agrees with the ray direction', () => {
  for (const [width,height] of [[360,500],[774,650],[1780,1000]]) {
    const g=diagramLayout(width,height), p=DEFAULT_FIBER, b=fiberModes(p,g.viewUm/p.radiusUm), s=b.segments[0];
    const dx=(s.end[0]-s.start[0])*p.radiusUm*g.scale, dy=(s.end[1]-s.start[1])*p.radiusUm*g.scale;
    close(Math.atan2(dy,dx)*180/Math.PI,b.internalDeg);
    const angle=15*Math.PI/180;
    assert.equal(angleFromPoint(g.left-100*Math.cos(angle),g.cy+100*Math.sin(angle),g.left,g.cy),15);
    assert.equal(angleFromPoint(g.left-100,g.cy-20,g.left,g.cy),0);
    close(b.segments.at(-1)!.end[0]*p.radiusUm,g.viewUm);
  }
  assert.equal(angleFromPoint(0,100,100,0),30);
});
test('independent Snell and TIR relations, dimension conversions and scaling', () => {
  const p = { ...DEFAULT_FIBER, coreIndex:1.45, claddingIndex:1.44, radiusUm:5, wavelengthNm:1000, angleDeg:5 }, b=fiberModes(p);
  close(b.na!,Math.sqrt(1.45**2-1.44**2)); close(b.v!,10*Math.PI*b.na!);
  close(Math.sin(b.acceptanceDeg!*Math.PI/180),b.na!);
  close(Math.sin(b.internalDeg*Math.PI/180)*p.coreIndex,Math.sin(p.angleDeg*Math.PI/180));
  close(Math.sin(b.criticalDeg!*Math.PI/180)*p.coreIndex,p.claddingIndex);
  close(fiberModes({...p,radiusUm:10}).v!,2*b.v!);
  close(fiberModes({...p,wavelengthNm:500}).v!,2*b.v!);
  assert.equal(fiberModes({...p,angleDeg:30}).v,b.v);
});
test('multimode screenshot shows the real first reflection without distorting the angle', () => {
  const p={...DEFAULT_FIBER,radiusUm:12.5,wavelengthNm:850,angleDeg:5};
  const values=fiberModes(p), sinInput=Math.sin(p.angleDeg*Math.PI/180);
  const expectedHit=p.radiusUm*Math.sqrt(p.coreIndex**2-sinInput**2)/sinInput;
  assert.ok(Math.abs(expectedHit-209.02)<.01);
  assert.equal(fiberModes(p,100/p.radiusUm).firstHit,null);
  assert.ok(values.incidenceDeg>values.criticalDeg!);
  assert.equal(values.mode,'多模');
  for(const [width,height] of [[360,500],[774,650],[1440,800]]){
    const g=diagramLayout(width,height,{radiusUm:p.radiusUm,internalDeg:values.internalDeg});
    const b=fiberModes(p,g.viewUm/p.radiusUm);
    assert.ok(b.firstHit,'The real interface intersection must be visible');
    close(b.firstHit[0]*p.radiusUm,expectedHit);
    assert.ok(b.firstHit[0]*p.radiusUm/g.viewUm<=.6+1e-12);
    assert.ok(b.segments.length>=2);
    const incoming=b.segments[0],reflected=b.segments[1];
    const slope=(s:typeof incoming)=>(s.end[1]-s.start[1])/(s.end[0]-s.start[0]);
    close(slope(incoming),-slope(reflected));
    close(Math.atan2((incoming.end[1]-incoming.start[1])*p.radiusUm*g.scale,(incoming.end[0]-incoming.start[0])*p.radiusUm*g.scale)*180/Math.PI,values.internalDeg);
    assert.equal(reflected.role,'core');
    assert.ok(reflected.end[0]>reflected.start[0]);
  }
  // An axial ray must remain straight; shallow rays are not given fake bounces.
  for(const angleDeg of [0,.1]){
    const p2={...p,angleDeg},v=fiberModes(p2),g=diagramLayout(774,650,{radiusUm:p2.radiusUm,internalDeg:v.internalDeg});
    const b=fiberModes(p2,g.viewUm/p2.radiusUm);
    assert.equal(b.firstHit,null);
    assert.equal(b.segments.length,1);
    assert.ok(p2.radiusUm*g.scale>=Math.min(18,(g.right-g.left)*.03)-1e-12);
  }
  const leaking={...p,angleDeg:15},v=fiberModes(leaking),g=diagramLayout(774,650,{radiusUm:leaking.radiusUm,internalDeg:v.internalDeg});
  assert.ok(fiberModes(leaking,g.viewUm/leaking.radiusUm).segments.some(s=>s.role==='escaping'));
});
test('cutoff and acceptance boundaries are distinct from ray and mode count', () => {
  const b=fiberModes(DEFAULT_FIBER);
  assert.equal(b.mode,'单模'); assert.equal(b.rayStatus,'guided');
  assert.equal(fiberModes({...DEFAULT_FIBER,angleDeg:15}).rayStatus,'escaping');
  assert.equal(fiberModes({...DEFAULT_FIBER,angleDeg:15}).mode,'单模');
  assert.equal(fiberModes({...DEFAULT_FIBER,angleDeg:b.acceptanceDeg!}).rayStatus,'critical');
  assert.equal(fiberModes({...DEFAULT_FIBER,wavelengthNm:b.cutoffNm!}).mode,'截止边界');
  assert.equal(fiberModes({...DEFAULT_FIBER,wavelengthNm:b.cutoffNm!*.99}).mode,'多模');
  assert.equal(fiberModes({...DEFAULT_FIBER,wavelengthNm:b.cutoffNm!*1.01}).mode,'单模');
  for(const claddingIndex of [1.46,1.47]){const n=fiberModes({...DEFAULT_FIBER,claddingIndex});assert.equal(n.na,null);assert.equal(n.v,null);assert.equal(n.cutoffNm,null);assert.equal(n.rayStatus,'unguided');}
});
test('ray intersections obey physical core slope and reflection, including axial ray', () => {
  for(const angleDeg of [0,.01,5,15,30]){
    const b=fiberModes({...DEFAULT_FIBER,angleDeg});
    close((b.segments[0].end[1]-b.segments[0].start[1])/(b.segments[0].end[0]-b.segments[0].start[0]),Math.tan(b.internalDeg*Math.PI/180));
    for(const s of b.segments){assert.ok(s.end[0]>=s.start[0]);for(const v of [...s.start,...s.end])assert.ok(Number.isFinite(v));if(s.role==='core'){assert.ok(Math.abs(s.start[1])<=1+1e-12);assert.ok(Math.abs(s.end[1])<=1+1e-12);}}
    if(b.rayStatus==='guided')assert.ok(b.segments.every(s=>s.role==='core'));else assert.ok(b.segments.some(s=>s.role==='escaping'));
  }
  assert.deepEqual(fiberModes({...DEFAULT_FIBER,angleDeg:0}).segments,[{start:[0,0],end:[80,0],role:'core'}]);
});
test('frontend matches authoritative backend over grid and cutoff, and history preserves snapshots', () => {
  const states=[];
  for(const coreIndex of [1.44,1.46,1.47])for(const claddingIndex of [1.44,1.455,1.47])for(const radiusUm of [1,4.1,25])for(const wavelengthNm of [400,1550,1700])for(const angleDeg of [0,5,30])states.push({...DEFAULT_FIBER,coreIndex,claddingIndex,radiusUm,wavelengthNm,angleDeg});
  const b=fiberModes(DEFAULT_FIBER);states.push({...DEFAULT_FIBER,angleDeg:b.acceptanceDeg!},{...DEFAULT_FIBER,wavelengthNm:b.cutoffNm!});
  const raw=execFileSync('python',['-c',"import json,sys;from backend.scene_fiber_modes import fiber_values;print(json.dumps([fiber_values(p) for p in json.load(sys.stdin)]))"],{input:JSON.stringify(states),encoding:'utf8'});
  const results=JSON.parse(raw);
  states.forEach((p,j)=>{const f=fiberModes(p),r=results[j];for(const k of ['na','acceptanceDeg','criticalDeg','internalDeg','incidenceDeg','v','cutoffNm'] as const){if(f[k]===null)assert.equal(r[k],null);else close(f[k]!,r[k]);}assert.equal(f.mode,r.mode);assert.equal(f.rayStatus,r.rayStatus);});
  const h={past:[],present:DEFAULT_FIBER,future:[]};const edited=fiberHistory(h,{type:'commit',parameters:{...DEFAULT_FIBER,radiusUm:10}});
  assert.equal(fiberHistory(edited,{type:'undo'}).present.radiusUm,4.1);assert.equal(fiberHistory(fiberHistory(edited,{type:'undo'}),{type:'redo'}).present.radiusUm,10);
  assert.equal(h.present.radiusUm,4.1);assert.throws(()=>parseFiber({...DEFAULT_FIBER,angleDeg:true}));assert.equal(fiberState(DEFAULT_FIBER).sceneId,FIBER_ID);
  const formula=OPTICS_FORMULAS.find(f=>f.id==='fiber-v')!;const values=opticsValues(formula,fiberState(DEFAULT_FIBER));close(values.V,b.v!);close(values.NA,b.na!);assert.equal(FIBER_CUTOFF,2.404825557695773);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { DEFAULT_FILM, filmHistory, filmState, filmTarget, gapThickness, newtonRings, parseFilm, thinFilm, type FilmParameters } from './filmInterference';
import { opticsValues, OPTICS_FORMULAS } from './opticsKnowledgeModel';
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-9*Math.max(1,Math.abs(b)),`${a} != ${b}`);
test('quarter-wave films, phase reversals and vanished film reproduce physical limits',()=>{
  const p={...DEFAULT_FILM,incidentAngleDeg:0,thicknessNm:0};close(thinFilm(p).current.reflectance,((1-1.52)/(1+1.52))**2);
  const ideal={...p,filmIndex:Math.sqrt(1.52),thicknessNm:600/(4*Math.sqrt(1.52))};close(thinFilm(ideal).current.reflectance,0);
  const soap={...p,filmIndex:1.333,substrateIndex:1};close(thinFilm(soap).current.reflectance,0);close(thinFilm({...soap,thicknessNm:600/(4*1.333)}).current.reflectance,thinFilm(soap).max);
  assert.throws(()=>filmTarget({...p,substrateIndex:p.filmIndex},'dark'));
});
test('Newton contact, lifted center and exact sphere distinguish absent one-order rings',()=>{
  const p={...DEFAULT_FILM,mode:1},b=newtonRings(p);assert.equal(b.current.intensity,0);close(b.firstDarkRadiusMm!,Math.sqrt(.6-.0003**2));assert.equal(b.at(b.firstDarkRadiusMm!).intensity,0);
  assert.equal(newtonRings({...p,centralGapNm:150}).current.intensity,1);assert.equal(newtonRings({...p,centralGapNm:301}).firstDarkRadiusMm,null);close(gapThickness(p,1),500.0001250000625);
});
test('mode-aware targets change only the corresponding field and reach extrema',()=>{
  for(const mode of [0,1])for(let i=0;i<20;i++)for(const target of ['bright','dark'] as const){const p={...DEFAULT_FILM,mode,wavelengthNm:380+i*20,centralGapNm:i*50,thicknessNm:i*75,incidentAngleDeg:i*3,observationRadiusMm:i*3/19},patch=filmTarget(p,target);assert.deepEqual(Object.keys(patch),[mode===0?'thicknessNm':'observationRadiusMm']);const next={...p,...patch};parseFilm(next);if(mode===0)close(thinFilm(next).current.reflectance,thinFilm(next)[target==='bright'?'max':'min']);else assert.equal(newtonRings(next).current.intensity,target==='bright'?1:0);}
});
test('complete live curves and readings agree with backend over 40 boundary configurations',()=>{
  const configs:FilmParameters[]=Array.from({length:40},(_,i)=>({...DEFAULT_FILM,mode:i%2,wavelengthNm:380+(i%5)*100,filmIndex:[1.05,1.38,2.1][i%3],substrateIndex:[1,1.38,2.2][i%3],incidentAngleDeg:i%3*30,thicknessNm:i%3*750,curvatureRadiusMm:i%3*1250+500,gapIndex:1+(i%4)*.15,centralGapNm:i%3*500,observationRadiusMm:i%3*1.5}));
  const script='import json,sys\nfrom backend.scene_physics import calculate\nprint(json.dumps([calculate(s) for s in json.load(sys.stdin)]))';
  const r=spawnSync('python',['-c',script],{input:JSON.stringify(configs.map(filmState)),encoding:'utf8',maxBuffer:20*1024*1024});assert.equal(r.status,0,r.stderr);const data=JSON.parse(r.stdout);
  configs.forEach((p,i)=>{const b=p.mode===0?thinFilm(p):newtonRings(p),current=b.current;const metrics=Object.fromEntries(data[i].metrics.map((m:{key:string;value:number|null})=>[m.key,m.value]));close(metrics.reflectancePct,current.reflectance*100);close(metrics.deltaNm,current.deltaNm);for(const point of data[i].curve)close(point.y,p.mode===0?thinFilm(p).at(point.x).reflectance*100:newtonRings(p).at(point.x).intensity);});
});
test('state validation, undo and mode-specific formula values preserve full precision',()=>{
  const p={...DEFAULT_FILM,thicknessNm:143.123456789},h={past:[],present:p,future:[]};const next=filmHistory(h,{type:'commit',parameters:{...p,mode:1}});assert.deepEqual(filmHistory(next,{type:'undo'}).present,p);assert.deepEqual(filmHistory(filmHistory(next,{type:'undo'}),{type:'redo'}),next);
  assert.throws(()=>parseFilm({...p,mode:2}));assert.throws(()=>parseFilm({...p,gapIndex:1.52}));
  for(const f of OPTICS_FORMULAS.filter(f=>f.sceneId==='interference-1')){const values=opticsValues(f,filmState(p));assert.equal(values.t,f.diagram==='thin-film'?p.thicknessNm:newtonRings(p).current.thicknessNm);}
});

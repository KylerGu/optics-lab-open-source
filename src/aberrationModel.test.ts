import test from 'node:test';
import './aberrationQuantities.test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {aberrationDrag,aberrationRay,aberrationFocal,aberrationDimensions,aberrationFocusGuides} from './aberrationModel';
import {immediateScene} from './sceneImmediate';
import {defaultScene,type SceneState} from './sceneRuntime';

function close(actual:unknown,expected:unknown,path='result'){
  if(typeof actual==='number'&&typeof expected==='number'){assert.ok(Math.abs(actual-expected)<2e-8*Math.max(1,Math.abs(expected)),`${path}: ${actual} != ${expected}`);return;}
  if(Array.isArray(actual)&&Array.isArray(expected)){assert.equal(actual.length,expected.length,path);actual.forEach((v,i)=>close(v,expected[i],`${path}[${i}]`));return;}
  if(actual&&expected&&typeof actual==='object'&&typeof expected==='object'){assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort(),path);for(const key of Object.keys(actual))close((actual as Record<string,unknown>)[key],(expected as Record<string,unknown>)[key],`${path}.${key}`);return;}
  assert.equal(actual,expected,path);
}
test('live aberration light paths, colored screen spots and metrics match independent Python at boundaries and random states',()=>{
  const base=defaultScene('aberrations-1'),states:SceneState[]=[base];
  for(const R of [40,160])for(const diameter of [2,50])for(const mode of [0,1])for(const screen of [20,500])states.push({...base,parameters:{...base.parameters,R,diameter,mode,screen,B:R===40?.012:0,edge:8}});
  let seed=1015;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
  for(let i=0;i<24;i++)states.push({...base,parameters:{R:40+120*random(),diameter:2+48*random(),edge:1+7*random(),A:1.4+.25*random(),B:.012*random(),wavelength:400+300*random(),screen:20+480*random(),mode:i%2}});
  const result=spawnSync('python',['-c','import sys,json;from backend.scene_physics import calculate;print(json.dumps([calculate(s) for s in json.load(sys.stdin)],allow_nan=False))'],{input:JSON.stringify(states),encoding:'utf8',maxBuffer:32*1024*1024});
  assert.equal(result.status,0,result.stderr);const reference=JSON.parse(result.stdout);
  states.forEach((s,i)=>close({...immediateScene(s),revision:''},reference[i]));
});
test('live dragged optics preserve sphere intersections, Snell angles, symmetry and the paraxial limit',()=>{
  const p=defaultScene('aberrations-1').parameters,{radius:r,thickness:t}=aberrationDimensions(p);
  for(const wave of [450,550,650])for(const h of [.005,3,15]){
    const ray=aberrationRay(p,h,wave)!,negative=aberrationRay(p,-h,wave)!;
    assert.ok(Math.abs((ray.front[0]-r)**2+ray.front[1]**2-r*r)<1e-9);
    assert.ok(Math.abs((ray.back[0]-(t-r))**2+ray.back[1]**2-r*r)<1e-9);
    const normal=[(ray.front[0]-r)/r,ray.front[1]/r],cross=(a:number[],b:number[])=>Math.abs(a[0]*b[1]-a[1]*b[0]),n=p.A+p.B/(wave/1000)**2;
    assert.ok(Math.abs(cross([1,0],normal)-n*cross(ray.inside,normal))<1e-12);
    assert.ok(Math.abs(ray.focus!-negative.focus!)<1e-10);
    if(h===.005)assert.ok(Math.abs(ray.focus!-aberrationFocal(p,wave).back)<.00001);
  }
});
test('screen, aperture and radius drags respect field limits; aperture and dispersion produce real optical changes',()=>{
  const p=defaultScene('aberrations-1').parameters;
  assert.deepEqual(aberrationDrag(p,'aberration-screen',10000),{screen:500});
  assert.deepEqual(aberrationDrag(p,'aberration-aperture',-10000),{diameter:2});
  assert.deepEqual(aberrationDrag(p,'aberration-radius',-10000),{R:40});
  assert.deepEqual(aberrationDrag(p,'aberration-screen',7.25),{screen:67.25});
  const sa=(diameter:number)=>{const next={...p,diameter};return aberrationFocal(next,550).back-aberrationRay(next,diameter/2,550)!.focus!;};
  assert.ok(sa(10)<sa(30));assert.ok(aberrationFocal(p,650).back>aberrationFocal(p,450).back);
  assert.equal(aberrationFocal({...p,B:0},650).back,aberrationFocal({...p,B:0},450).back);
  const s=defaultScene('aberrations-1'),a=immediateScene(s)!,b=immediateScene({...s,parameters:{...p,screen:80}})!;
  assert.equal(a.metrics.find(m=>m.key==='longitudinalSA')!.value,b.metrics.find(m=>m.key==='longitudinalSA')!.value);
  assert.notEqual(a.metrics.find(m=>m.key==='rmsRadius')!.value,b.metrics.find(m=>m.key==='rmsRadius')!.value);
  assert.notEqual(a.segments.at(-1)!.end[1],b.segments.at(-1)!.end[1]);
});
test('behind-screen focus guides follow exact outgoing directions without changing measured light or swapping focus labels',()=>{
  const base=defaultScene('aberrations-1');
  for(const mode of [0,1]){
    const state={...base,parameters:{...base.parameters,mode,screen:46}},result=immediateScene(state)!,before=JSON.stringify(result),guides=aberrationFocusGuides(result);
    assert.equal(guides.length,mode===0?6:18);assert.equal(JSON.stringify(result),before);
    const transmitted=result.segments.filter(segment=>segment.role==='transmitted');
    guides.forEach((guide,i)=>{
      assert.deepEqual(guide.start,transmitted[i].end);
      const realSlope=(transmitted[i].end[1]-transmitted[i].start[1])/(transmitted[i].end[0]-transmitted[i].start[0]);
      const referenceSlope=(guide.end[1]-guide.start[1])/(guide.end[0]-guide.start[0]);assert.ok(Math.abs(realSlope-referenceSlope)<1e-12);
      assert.ok(guide.end[0]>guide.start[0]);
      if(i%6===0||i%6===5){const crossing=guide.start[0]-guide.start[1]/referenceSlope,focus=aberrationRay(state.parameters,15,mode===0?550:[450,550,650][Math.floor(i/6)])!.focus!+aberrationDimensions(state.parameters).thickness;assert.ok(Math.abs(crossing-focus)<1e-9);}
    });
    const marginal=result.markers.find(m=>m.label==='边缘焦点')!,paraxial=result.markers.find(m=>m.label==='近轴焦点')!;assert.ok(marginal.x<paraxial.x);
    assert.equal(aberrationFocusGuides(immediateScene({...state,parameters:{...state.parameters,screen:80}})!).length,0);
  }
});

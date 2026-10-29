import test from 'node:test';
import './aberrationModel.test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { defaultScene, type SceneResult, type SceneState } from './sceneRuntime';
import { immediateScene } from './sceneImmediate';

function close(a:unknown,b:unknown,path:string) {
  if(typeof a==='number'&&typeof b==='number'){assert.ok(Math.abs(a-b)<1e-9*Math.max(1,Math.abs(b)),`${path}: ${a} != ${b}`);return;}
  if(Array.isArray(a)&&Array.isArray(b)){assert.equal(a.length,b.length,path);a.forEach((v,i)=>close(v,b[i],`${path}[${i}]`));return;}
  if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const k of Object.keys(a))close((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k],`${path}.${k}`);return;}
  assert.equal(a,b,path);
}

test('telescope modules match independent ray, pupil and angular calculations',async()=>{
  const {telescopeOptics,telescopeThroughput,telescopeField}=await import('./telescopeModel');
  const base=defaultScene('instruments-1'),states:SceneState[]=[];
  for(const study of [0,1,2,3])for(const k2 of [-1,1])for(const d of [30,170,230,600])for(const eyeOffset of [0,2])states.push({...base,parameters:{...base.parameters,study,k2,d,eyeOffset,eyepieceDiameter:40}});
  const run=spawnSync('python',['-c','import json,sys; from backend.scene_physics import calculate; print(json.dumps([calculate(s) for s in json.load(sys.stdin)]))'],{input:JSON.stringify(states),encoding:'utf8',maxBuffer:16*1024*1024});
  assert.equal(run.status,0,run.stderr);const truth=JSON.parse(run.stdout) as SceneResult[];
  states.forEach((s,i)=>{const result=immediateScene(s)!;for(const key of ['metrics','curve','chart','segments','devices','markers','bounds','warnings','status'] as const)close(result[key],truth[i][key],`telescope ${i} ${key}`);});
  const p=base.parameters,o=telescopeOptics(p);
  assert.equal(o.M,-200/30);assert.equal(o.pupilPosition,34.5);assert.equal(o.pupilDiameter,3);
  assert.equal(telescopeThroughput(p,0),1);
  const gal={...p,k2:-1,d:170};assert.equal(telescopeOptics(gal).pupilPosition,-25.5);assert.ok(telescopeOptics(gal).M!>0);
  assert.ok(telescopeField({...gal,eyeDistance:0})![1]>telescopeField({...gal,eyeDistance:70})![1]);
  const width=telescopeField(p)!;assert.ok(telescopeThroughput(p,(width[1]+.01)*Math.PI/180)<1e-9);assert.ok(telescopeThroughput(p,(width[1]-.1)*Math.PI/180)>0);
  assert.ok(Math.abs(telescopeOptics({...p,aperture:40}).resolution-o.resolution/2)<1e-12);
  assert.equal(telescopeOptics({...p,eyepieceDiameter:2}).pupilPosition,0);
  assert.equal(telescopeOptics({...p,d:30,eyepieceDiameter:40}).pupilPosition,null);
  assert.equal(telescopeField({...p,d:250}),null);
  // Independently evaluate the overlap of a 1.5 mm beam and 2 mm eye pupil.
  const R=1.5,r=2,d=1,area=R*R*Math.acos((d*d+R*R-r*r)/(2*d*R))+r*r*Math.acos((d*d+r*r-R*R)/(2*d*r))-.5*Math.sqrt((-d+R+r)*(d+R-r)*(d-R+r)*(d+R+r));
  assert.ok(Math.abs(telescopeThroughput({...p,eyeOffset:1},0)-area/(Math.PI*R*R))<.001);
});

test('telescope comparison keeps angular scale, corresponding stars and image orientation distinct from optical field',async()=>{
  const {telescopeComparison,telescopeStarPosition,TELESCOPE_TARGETS}=await import('./telescopeFieldPresentation');
  const p=defaultScene('instruments-1').parameters;
  for(const [f1,f2,k2] of [[200,30,1],[200,30,-1],[400,10,1],[50,100,1]]) {
    const comparison=telescopeComparison({...p,f1,f2,k2,d:f1+k2*f2})!;
    assert.ok(Math.abs(comparison.skyAngle*Math.abs(comparison.M)-6)<1e-12);
    assert.ok(Math.abs(comparison.selectionRadius*comparison.skyAngle**-1-130/6)<1e-12);
    for(const star of TELESCOPE_TARGETS) {
      const reference=telescopeStarPosition(star.x,star.y,1),image=telescopeStarPosition(star.x,star.y,comparison.M);
      assert.ok(Math.abs(image.x-140-(reference.x-140)*comparison.M)<1e-10);
      assert.ok(Math.abs(image.y-140-(reference.y-140)*comparison.M)<1e-10);
    }
  }
  assert.equal(telescopeComparison({...p,d:250}),null);
  assert.ok(Math.abs(telescopeComparison(p)!.skyAngle-.9)<1e-12);
});

test('telescope angle relation distinguishes signed magnification from the focus analysis',async()=>{
  const {telescopeAngularTrend}=await import('./telescopeFieldPresentation');
  const base=defaultScene('instruments-1');
  for(const k2 of [-1,1]) {
    const state={...base,parameters:{...base.parameters,k2,d:200+k2*30,angle:-1}};
    const result=immediateScene(state)!,relation=telescopeAngularTrend(result),M=-200/(k2*30);
    assert.ok(Math.abs(relation.curve[0].y!-M*relation.curve[0].x)<1e-10);
    assert.ok(Math.abs(relation.curve.at(-1)!.y!-M*relation.curve.at(-1)!.x)<1e-10);
    assert.equal(relation.chart.currentX,-1);
    assert.ok(Math.abs(relation.chart.currentY!-result.metrics.find(m=>m.key==='centralAngle')!.value!)<1e-10);
    assert.ok(result.curve.every(point=>Math.abs(point.y!-result.curve[0].y!)<1e-10));
    assert.notEqual(result.chart.xLabel,relation.chart.xLabel);
  }
  const defocused=immediateScene({...base,parameters:{...base.parameters,d:250}})!;
  assert.ok(Math.abs(defocused.curve[0].y!-defocused.curve.at(-1)!.y!)>1);
  assert.equal(telescopeAngularTrend(defocused).chart.currentY,defocused.metrics.find(m=>m.key==='centralAngle')!.value);
  const large=immediateScene({...base,parameters:{...base.parameters,f1:400,f2:10,d:410,angle:1}})!;
  const local=telescopeAngularTrend(large);
  assert.equal(local.chart.currentY,null);
  assert.ok(local.curve.every(point=>Math.abs(point.y!)<=.15*180/Math.PI+1e-10));
});

test('a telescope apparatus copy centers F independently of the teaching ray angle and retains lens apertures',async()=>{
  const {sceneBuilderCopy}=await import('./sceneBuilderCopy');
  const base=defaultScene('instruments-1'),state={...base,parameters:{...base.parameters,k2:-1,d:170,angle:-2,eyepieceDiameter:8}};
  const copy=sceneBuilderCopy(state,immediateScene(state)!);assert.ok(copy.experiment);
  const [source,objective,eyepiece]=copy.experiment.elements;
  assert.equal(source.kind,'object');assert.equal(source.objectMode,'distant');
  assert.equal(source.position[1],objective.position[1]);assert.equal(source.position[2],objective.position[2]);assert.equal(eyepiece.focalLengthMm,-30);
  assert.equal(objective.diameterMm,20);assert.equal(eyepiece.diameterMm,8);
  assert.equal(eyepiece.position[0]-objective.position[0],220);
  assert.equal(sceneBuilderCopy({...state,parameters:{...state.parameters,aperture:80}},immediateScene(state)!).experiment!.elements[1].diameterMm,80);
});
test('instant optical scenes including both microscope modes agree with independent Python reference, including limiting cases',()=>{
  const states:SceneState[]=[];
  for(const [n1,n2] of [[1,1.5],[1.5,1],[2.5,1],[1,1],[2.3,2.4]]) {
    const c=n1>n2?Math.asin(n2/n1)*180/Math.PI:45;
    for(const angle of [0,20,45,89.9,c,c-1e-8,c+1e-8])states.push({...defaultScene('reflection-refraction-0'),parameters:{n1,n2,angle}});
  }
  for(const [n,outside] of [[1.5,1],[1,1.5],[2.5,1],[1,2.5]])for(const apex of [10,60,80])for(const angle of [0,15,45,80,89])states.push({...defaultScene('reflection-refraction-2'),parameters:{n,outside,apex,angle}});
  for(const kind of [-1,1])for(const f of [10,100,250])for(const u of [10,60,100,200,600,f-1e-6,f,f+1e-6].filter(value=>value>=10&&value<=600))for(const h of [1,10,40])states.push({...defaultScene('paraxial-0'),parameters:{kind,f,u,h}});
  for(const kind of [-1,1])for(const R of [20,200,500])for(const u of [10,60,100,200,800,R/2-1e-6,R/2,R/2+1e-6].filter(value=>value>=10&&value<=800))for(const h of [1,10,40])states.push({...defaultScene('paraxial-1'),parameters:{kind,R,u,h}});
  for(const k1 of [-1,1])for(const k2 of [-1,1])for(const [f1,f2] of [[10,250],[100,100],[250,10]])for(const u of [10,200,600,f1-1e-6,f1,f1+1e-6].filter(n=>n>=10&&n<=600)){
    const den=1/(f1*k1)-1/u,v1=Math.abs(den)>1e-12?1/den:null,parallel=v1===null?null:v1+f2*k2;
    for(const d of [10,100,350,600,f1*k1+f2*k2,...(parallel===null?[]:[parallel-1e-6,parallel,parallel+1e-6])].filter(n=>n>=10&&n<=600))for(const h of [.1,5,20])states.push({...defaultScene('paraxial-2'),parameters:{f1,k1,f2,k2,d,u,h}});
  }
  for(const f1 of [5,10,50])for(const f2 of [10,20,80])for(const u of [5,11,100,f1,f1-1e-6,f1+1e-6].filter(n=>n>=5&&n<=100)){
    const den=1/f1-1/u,v1=Math.abs(den)>1e-12?1/den:null;
    for(const d of [40,125,130,150,300,...(v1===null?[]:[v1+f2-1e-6,v1+f2,v1+f2+1e-6])].filter(n=>n>=40&&n<=300))for(const h of [.01,.1,1])states.push({...defaultScene('instruments-0'),parameters:{...defaultScene('instruments-0').parameters,f1,f2,u,d,h}});
  }
  for(const f1 of [5,10,50])for(const tubeF of [40,200,300])for(const d of [40,300])for(const adapter of [.25,.5,2])for(const u of [f1,Math.max(5,f1-1),Math.min(100,f1+1)])states.push({...defaultScene('instruments-0'),parameters:{...defaultScene('instruments-0').parameters,mode:1,f1,tubeF,d,adapter,u,h:.1,sensorW:36,sensorH:24}});
  const run=spawnSync('python',['-c','import json,sys; from backend.scene_physics import calculate; print(json.dumps([calculate(s) for s in json.load(sys.stdin)],ensure_ascii=True))'],{input:JSON.stringify(states),encoding:'utf8',maxBuffer:64*1024*1024});
  assert.equal(run.status,0,run.stderr);
  const truth=JSON.parse(run.stdout) as SceneResult[];
  states.forEach((state,i)=>{const result=immediateScene(state)!;assert.ok(result);for(const key of ['metrics','segments','curve','chart','status','warnings','bounds'] as const)close(result[key],truth[i][key],`${JSON.stringify(state)}.${key}`);if(['lens','mirror','double-lens','microscope'].includes(result.model))close(result.markers,truth[i].markers,`${JSON.stringify(state)}.markers`);if(['mirror','double-lens','microscope'].includes(result.model))close(result.devices,truth[i].devices,`${JSON.stringify(state)}.devices`);});
});


test('microscope performance agrees with independent server calculations and physical scaling',()=>{
  const states:SceneState[]=[];
  for(const study of [1,3])for(const NA of [.1,.4,1.3])for(const medium of [1,1.515].filter(n=>n>=NA))for(const wavelength of [380,550,780])for(const depthCriterion of [0,1])for(const adapter of [.25,2])states.push({...defaultScene('instruments-0'),parameters:{...defaultScene('instruments-0').parameters,study,NA,medium,wavelength,depthCriterion,adapter}});
  for(const mode of [0,1])for(const u of [10,11,60])for(const fieldNumber of [8,18,30])states.push({...defaultScene('instruments-0'),parameters:{...defaultScene('instruments-0').parameters,study:2,mode,u,fieldNumber}});
  const run=spawnSync('python',['-c','import json,sys; from backend.scene_physics import calculate; print(json.dumps([calculate(s) for s in json.load(sys.stdin)]))'],{input:JSON.stringify(states),encoding:'utf8',maxBuffer:16*1024*1024});
  assert.equal(run.status,0,run.stderr);const truth=JSON.parse(run.stdout) as SceneResult[];
  states.forEach((state,i)=>{const result=immediateScene(state)!;for(const key of ['metrics','curve','chart','scope'] as const)close(result[key],truth[i][key],`performance.${key}`);});
  const s=defaultScene('instruments-0');s.parameters.study=3;
  const value=(state:SceneState)=>immediateScene(state)!.metrics.find(m=>m.key==='depth')!.value!;
  const baseline=value(s);assert.ok(Math.abs(baseline-3.4375)<1e-10);
  assert.ok(Math.abs(value({...s,parameters:{...s.parameters,NA:.8}})-baseline/4)<1e-10);
  assert.ok(Math.abs(value({...s,parameters:{...s.parameters,depthCriterion:1}})-baseline)<1e-10);
  assert.ok(Math.abs(value({...s,parameters:{...s.parameters,mode:1,depthCriterion:1}})-(baseline+.8625))<1e-10);
});

test('circular pupil diffraction obeys focus, Airy first zero and symmetric defocus',async()=>{
  const {pointSpread,radialPointSpread}=await import('./microscopePerformance');
  const na=.4,lambda=.55,n=1;
  assert.ok(Math.abs(pointSpread(0,0,na,lambda,n)-1)<1e-12);
  assert.ok(pointSpread(3.8317059702075125*lambda/(2*Math.PI*na),0,na,lambda,n)<1e-8);
  for(const z of [.1,2,10]){
    const phase=Math.PI*na*na*z/(n*lambda),exact=(Math.sin(phase/2)/(phase/2))**2;
    assert.ok(Math.abs(pointSpread(0,z,na,lambda,n)-exact)<.0002);
    assert.equal(pointSpread(.3,z,na,lambda,n),pointSpread(.3,-z,na,lambda,n));
    const radial=radialPointSpread(z,na,lambda,n,3);
    assert.ok(Math.abs(radial[0]-exact)<.0002);
    assert.ok(Math.abs(radial[120]-pointSpread(1.5,z,na,lambda,n))<.0002);
  }
});

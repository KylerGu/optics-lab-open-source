import {imageView,nearViewBox,raySections} from './spatialImageView';
import {microscopeLayout,createMicroscopeHousing,focusMicroscope,microscopeFocusBounds,microscopeResetBaseline} from './spatialMicroscope';
import {Vector3,Box3} from 'three';
import SpatialObjectPreview from './SpatialObjectPreview';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {renderToStaticMarkup} from 'react-dom/server';
import {makeSpatialElement as element,parseSpatial,validateSpatialResult,type SpatialExperiment} from './builderModel';
import {defaultScene} from './sceneRuntime';
import {immediateScene} from './sceneImmediate';
import {sceneBuilderCopy} from './sceneBuilderCopy';
import SpatialImagingResults from './SpatialImagingResults';

const bench=(...elements:SpatialExperiment['elements']):SpatialExperiment=>({schemaVersion:2,name:'成像验证',elements});
const close=(a:number|null,b:number|null)=>b===null?assert.equal(a,null):assert.ok(a!==null&&Math.abs(a-b)<1e-7*Math.max(1,Math.abs(b)),`${a} != ${b}`);
function simulate(experiments:SpatialExperiment[]){
  const child=spawnSync('python',['-X','utf8','-c',`import json,sys
from backend.spatial import SpatialExperiment,trace
print(json.dumps([trace(SpatialExperiment.model_validate(e),i) for i,e in enumerate(json.load(sys.stdin))]))`],{input:JSON.stringify(experiments),encoding:'utf-8',maxBuffer:30*1024*1024});
  assert.equal(child.status,0,child.stderr);
  return (JSON.parse(child.stdout) as unknown[]).map((r,i)=>validateSpatialResult(r,i,experiments[i]));
}
test('real, virtual, infinity and defocus agree with actual multi-point ray intersections; persistence retains object pose',()=>{
  const experiments=[200,50,100].map(u=>bench(element('object',[-u,60,0],{objectHeightMm:5,objectWidthMm:3}),element('lens',[0,60,0]),element('screen',[200,60,0])));
  experiments.push({...experiments[0],elements:experiments[0].elements.map(e=>e.kind==='screen'?{...e,position:[220,60,0]}:e)});
  const rotated=bench(element('object',[0,60,-200],{yawDeg:90,rollDeg:30,objectPattern:'arrow'}),element('lens',[0,60,0],{yawDeg:90}),element('screen',[0,60,200],{yawDeg:90}));
  assert.deepEqual(parseSpatial(JSON.parse(JSON.stringify(rotated))),rotated);
  experiments.push(rotated);
  const results=simulate(experiments),images=results.map(r=>r.imaging![0]);
  assert.deepEqual(images.slice(0,3).map(r=>r.stages[0].kind),['real','virtual','infinity']);
  close(images[0].stages[0].distanceMm,200);close(images[0].stages[0].magnification,-1);
  close(images[1].stages[0].distanceMm,-100);close(images[1].stages[0].magnification,2);
  close(images[2].stages[0].distanceMm,null);
  assert.deepEqual(images.map(r=>r.observations[0].focused),[true,false,false,false,true]);
  for(const index of [0,4]){
    const hits=images[index].observations[0].hits;
    assert.ok(new Set(hits.map(h=>h.point)).size>3);
    for(const h of hits){const first=hits.find(p=>p.point===h.point)!;close(h.x,first.x);close(h.y,first.y);}
  }
  const blur=images[3].observations[0].hits.filter(h=>h.point===0);
  assert.ok(Math.max(...blur.map(h=>h.y))-Math.min(...blur.map(h=>h.y))>.1);
  assert.ok(images[1].segments.some(s=>s.dashed));
  const html=renderToStaticMarkup(<SpatialImagingResults result={results[0]}/>);
  assert.match(html,/倒立实像/);assert.match(html,/已对焦/);
});
test('microscope copies preserve conjugates, visual sign, camera adapter, sensor and defocus',()=>{
  const base=defaultScene('instruments-0');
  const cases:Record<string,number>[]=[{}, {u:11.05}, {mode:1,u:10,adapter:.5}, {mode:1,u:10,adapter:2}, {mode:1,u:10.1}];
  const states=cases.map(p=>({...base,parameters:{...base.parameters,...p}}));
  const scenes=states.map(s=>immediateScene(s)!);
  const copies=states.map((s,i)=>sceneBuilderCopy(s,scenes[i]).experiment!);
  const results=simulate(copies);
  results.forEach((r,i)=>{
    const image=r.imaging![0],final=image.stages.at(-1)!,observation=image.observations[0];
    const metric=(key:string)=>scenes[i].metrics.find(m=>m.key===key)?.value??null;
    close(final.distanceMm,metric('v'));
    assert.equal(copies[i].elements.filter(e=>e.kind==='laser').length,0);
    assert.equal(copies[i].elements[0].objectHeightMm,states[i].parameters.h);
    assert.equal(copies[i].elements[0].objectPattern,'F');
    assert.ok(observation.hits.length>0);
    if(i<2){close(observation.angularMagnification,metric('angularM'));close(observation.fieldDiameterMm,metric('fieldDiameter'));assert.equal(observation.kind,'eye');}
    else if(i<4){assert.equal(observation.focused,true);close(observation.magnification,metric('cameraM'));close(observation.widthMm/Math.abs(observation.magnification!),metric('fieldWidth'));}
    else assert.equal(observation.focused,false);
  });
  const point=(i:number)=>results[i].imaging![0].observations[0].hits.find(h=>h.point===1)!;
  close(point(3).y,point(2).y*4);
  assert.ok(!results[3].imaging![0].observations[0].hits.some(h=>h.point===2));
  const unsupported={...base,parameters:{...base.parameters,study:2}};
  assert.equal(sceneBuilderCopy(unsupported,immediateScene(unsupported)!).experiment,null);
});

test('camera copies retain an F object, lens aperture and actual rectangular sensor instead of a laser',()=>{
  const base=defaultScene('instruments-2');
  const focused=1/(1/base.parameters.f-1/base.parameters.u);
  const states:ReturnType<typeof defaultScene>[]=[focused,focused+8].map(sensor=>({...base,parameters:{...base.parameters,study:0,sensor}}));
  const copies=states.map(s=>sceneBuilderCopy(s,immediateScene(s)!).experiment!);
  for(const [i,copy] of copies.entries()){
    assert.ok(copy);
    assert.deepEqual(copy.elements.map(e=>e.kind),['object','lens','sensor']);
    const [object,lens,sensor]=copy.elements,p=states[i].parameters;
    assert.equal(object.objectPattern,'F');assert.equal(object.objectMode,'finite');
    assert.equal(object.position[0],-p.u);assert.equal(object.objectHeightMm,p.h);
    assert.equal(object.wavelengthNm,p.wavelength);
    assert.equal(lens.focalLengthMm,p.f);assert.equal(lens.diameterMm,p.aperture);
    assert.equal(sensor.position[0],p.sensor);assert.equal(sensor.sensorWidthMm,p.sensorW);assert.equal(sensor.sensorHeightMm,p.sensorH);
    assert.equal(sensor.adapterMagnification,1);
    assert.deepEqual(parseSpatial(JSON.parse(JSON.stringify(copy))),copy);
  }
  const images=simulate(copies).map(r=>r.imaging![0]);
  assert.deepEqual(images.map(i=>i.observations[0].focused),[true,false]);
  close(images[0].stages[0].distanceMm,focused);
  close(images[0].stages[0].magnification,-focused/base.parameters.u);
  assert.ok(images.every(i=>i.observations[0].hits.length>0));
  close(images[1].observations[0].defocusMm,8);
});
test('unsupported optics and blocking screens never claim an image; original laser trace remains separate',()=>{
  const obj=element('object',[-200,60,0]),lens=element('lens',[0,60,0]);
  const results=simulate([
    bench(obj,element('biconvex-lens',[0,60,0])),
    bench(obj,lens,element('screen',[-100,60,0])),
    bench(obj,lens,element('laser',[-250,60,0]),element('screen',[200,60,0])),
  ]);
  assert.equal(results[0].imaging![0].stages.length,0);assert.ok(results[0].imaging![0].warnings.length);
  assert.equal(results[1].imaging![0].stages.length,0);
  assert.ok(results[2].segments.length);assert.ok(results[2].imaging![0].segments.length);
  assert.ok(results[2].segments.every(s=>s.sourceId!==obj.id));
});

test('microscopic samples have a readable inspection view without changing physical size; oversized objects do not draw invalid images',()=>{
  const scene=defaultScene('instruments-0');
  const copy=sceneBuilderCopy(scene,immediateScene(scene)!).experiment!;
  const object=copy.elements[0],before=JSON.stringify(copy);
  const html=renderToStaticMarkup(<SpatialObjectPreview object={object}/>);
  assert.match(html,/局部查看/);assert.doesNotMatch(html,/实际高度|仅放大显示/);
  assert.equal(JSON.stringify(copy),before);
  const large={...copy,elements:copy.elements.map(e=>e.kind==='object'?{...e,objectHeightMm:50}:e)};
  const [normal,invalid]=simulate([copy,large]);
  assert.ok(normal.imaging![0].stages.length);
  assert.equal(invalid.imaging![0].stages.length,0);
  assert.equal(invalid.imaging![0].segments.length,0);
  assert.match(invalid.imaging![0].warnings.join(' '),/超出小角度成像范围/);
});

test('detector image uses actual conjugates and relay scale; near view is only a crop and defocus never draws a sharp outline',()=>{
  const scene=defaultScene('instruments-0');scene.parameters.mode=1;scene.parameters.u=10;
  const copy=sceneBuilderCopy(scene,immediateScene(scene)!).experiment!;
  const defocus={...copy,elements:copy.elements.map(e=>e.kind==='sensor'?{...e,position:[e.position[0]+10,60,0] as [number,number,number]}:e)};
  const [focused,blurred]=simulate([copy,defocus]);
  const view=imageView(copy,focused.imaging![0])!,blur=imageView(defocus,blurred.imaging![0])!;
  assert.ok(view.paths.length);close(view.paths[0][1][1],-1);
  assert.ok(view.paths[0][2][0]<0);assert.equal(blur.paths.length,0);assert.ok(blur.hits.length>40);
  const before=JSON.stringify(view),box=nearViewBox(view);
  assert.ok(box[2]<view.width);assert.ok(box[3]<view.height);assert.equal(JSON.stringify(view),before);
  const sections=raySections(focused.imaging![0].segments,[1,0,0]);
  assert.ok(sections.length>=6);assert.ok(sections.every(s=>s.length===5&&s.every(ray=>[0,2].includes(ray.point))));
});

test('microscope cutaway persists across rename and save, and is a rigid presentation of unchanged optics',()=>{
  for(const mode of [0,1]){
    const scene=defaultScene('instruments-0');scene.parameters.mode=mode;
    const copy=sceneBuilderCopy(scene,immediateScene(scene)!).experiment!,before=JSON.stringify(copy);
    const renamed=parseSpatial({...copy,name:'我的实验',elements:copy.elements.map((e,i)=>({...e,name:'器件 '+i}))});
    const layout=microscopeLayout(renamed)!;assert.ok(layout);assert.equal(layout.camera,mode===1);
    for(const a of copy.elements)for(const b of copy.elements)close(layout.at(a.position).distanceTo(layout.at(b.position)),new Vector3(...a.position).distanceTo(new Vector3(...b.position)));
    const housing=createMicroscopeHousing(layout);assert.ok(!new Box3().setFromObject(housing).isEmpty());
    assert.equal(!!housing.getObjectByName('camera-body'),mode===1);
    assert.equal(JSON.stringify(copy),before);
    const plain={schemaVersion:2 as const,name:copy.name,elements:copy.elements};
    const [withHousing,without]=simulate([copy,plain]);assert.deepEqual(withHousing.imaging,without.imaging);assert.deepEqual(withHousing.segments,without.segments);
    assert.ok(microscopeLayout(plain),'existing microscope copies remain supported');
    assert.equal(microscopeLayout({...plain,name:'普通光路'}),null);
    assert.equal(microscopeLayout({...copy,elements:copy.elements.slice(1)}),null);
    assert.equal(microscopeLayout({...copy,elements:copy.elements.map(e=>e.kind==='lens'?{...e,position:[e.position[0],e.position[1]+10,e.position[2]]}:e)}),null);
  }
});

test('3D focusing moves only the specimen, keeps the stand fixed, and reuses camera and visual imaging',()=>{
  for(const mode of [0,1]){
    const scene=defaultScene('instruments-0');scene.parameters.mode=mode;scene.parameters.u=mode?10:11;
    const copy=sceneBuilderCopy(scene,immediateScene(scene)!).experiment!,before=JSON.stringify(copy),layout=microscopeLayout(copy)!;
    const delta=mode?.02:-.02,changed=focusMicroscope(copy,layout.objectDistance+delta),moved=microscopeLayout(changed)!;
    close(moved.objectDistance,layout.objectDistance+delta);close(moved.stageY,layout.stageY-delta);
    assert.deepEqual(moved.position,layout.position);assert.deepEqual(moved.rotation,layout.rotation);
    assert.deepEqual(changed.elements.slice(1),copy.elements.slice(1));
    assert.deepEqual({...changed.elements[0],position:copy.elements[0].position},copy.elements[0]);
    assert.equal(JSON.stringify(copy),before);assert.deepEqual(parseSpatial(changed),changed);
    const {min,max}=microscopeFocusBounds(layout);
    close(microscopeLayout(focusMicroscope(copy,-10000))!.objectDistance,min);
    close(microscopeLayout(focusMicroscope(copy,10000))!.objectDistance,max);
    assert.equal(focusMicroscope(copy,NaN),copy);
    const restored=focusMicroscope(changed,layout.objectDistance);
    assert.deepEqual(restored,copy);
    const results=simulate([copy,changed,restored]),original=results[0].imaging![0],adjusted=results[1].imaging![0];
    assert.deepEqual(results[0].imaging,results[2].imaging);
    assert.notDeepEqual(original.segments,adjusted.segments);
    if(mode){assert.equal(original.observations[0].focused,true);assert.equal(adjusted.observations[0].focused,false);assert.notDeepEqual(original.observations[0].hits,adjusted.observations[0].hits);}
    else{
      assert.notEqual(original.observations[0].angularMagnification,adjusted.observations[0].angularMagnification);
      const a=imageView(copy,original,undefined,true)!,b=imageView(changed,adjusted,undefined,true)!;
      assert.notDeepEqual(a.paths,b.paths);assert.match(a.caption!,/像/);
    }
    const housing=createMicroscopeHousing(layout);
    assert.equal(housing.getObjectByName('specimen-stage')!.userData.focusControl,'stage');
    assert.equal(housing.getObjectByName('fine-focus-knob')!.userData.focusControl,'fine');
    assert.equal(housing.getObjectByName('focus-knob')!.userData.focusControl,'coarse');
  }
});

test('reset repairs legacy 0.5 mm microscope focus baselines without changing samples, lenses or adapters',()=>{
  for(const mode of [0,1]){
    const scene=defaultScene('instruments-0');scene.parameters.mode=mode;scene.parameters.u=mode?10:11;
    const original=sceneBuilderCopy(scene,immediateScene(scene)!).experiment!;
    const broken={...original,elements:original.elements.map(e=>e.kind==='object'?{...e,position:[-.5,60,0] as [number,number,number]}:e)};
    const restored=microscopeResetBaseline(broken);
    assert.deepEqual(restored,original);
    assert.equal(microscopeResetBaseline(original),original);
    const validDefocus=focusMicroscope(original,mode?10.02:10.98);
    assert.equal(microscopeResetBaseline(validDefocus),validDefocus);
    assert.ok(microscopeLayout(focusMicroscope(original,-100))!.objectDistance>=5);
    const [bad,good]=simulate([broken,restored]);
    assert.match(bad.imaging![0].warnings.join(' '),/超出小角度成像范围/);
    assert.equal(good.imaging![0].warnings.length,0);
    assert.ok(imageView(restored,good.imaging![0]));
    if(mode)assert.equal(good.imaging![0].observations[0].focused,true);
  }
});

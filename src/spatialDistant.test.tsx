import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {renderToStaticMarkup} from 'react-dom/server';
import {defaultScene} from './sceneRuntime';
import {sceneBuilderCopy} from './sceneBuilderCopy';
import {immediateTelescope} from './telescopeModel';
import {parseSpatial,validateSpatialResult,type SpatialExperiment} from './builderModel';
import SpatialDistantPreview from './SpatialDistantPreview';
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8*Math.max(1,Math.abs(b)),`${a} != ${b}`);
function simulate(experiments:SpatialExperiment[]){
 const run=spawnSync('python',['-X','utf8','-c',`import json,sys
from backend.spatial import SpatialExperiment,trace
print(json.dumps([trace(SpatialExperiment.model_validate(e),i) for i,e in enumerate(json.load(sys.stdin))]))`],{input:JSON.stringify(experiments),encoding:'utf8',maxBuffer:40*1024*1024});
 assert.equal(run.status,0,run.stderr);
 return (JSON.parse(run.stdout) as unknown[]).map((r,i)=>validateSpatialResult(r,i,experiments[i]));
}
const copied=()=>{const state=defaultScene('instruments-1');state.parameters.angle=0;return sceneBuilderCopy(state,immediateTelescope(state)).experiment!;};

test('finite distant F rays start on the real object and focus at the lens-equation conjugate',()=>{
 const copy=copied(),image=simulate([copy])[0].imaging![0],view=image.distantView!;
 assert.deepEqual(parseSpatial(JSON.parse(JSON.stringify(copy))),copy);
 assert.equal(copy.elements.some(e=>e.kind==='laser'),false);
 const [source,objective,eyepiece]=copy.elements,u=objective.position[0]-source.position[0],v=1/(1/objective.focalLengthMm-1/u);
 close(image.stages[0].distanceMm!,v);close(eyepiece.position[0],v+eyepiece.focalLengthMm);
 assert.equal(view.focused,true);close(view.objectDistanceMm,u);
 close(view.magnification,-v/eyepiece.focalLengthMm);
 const rays=image.segments.filter(s=>s.start[0]===source.position[0]&&s.point===0);
 assert.equal(rays.length,5);
 for(const ray of rays)assert.deepEqual(ray.start,image.objectPaths[0][0]);
 const slopes=rays.map(s=>(s.end[1]-s.start[1])/(s.end[0]-s.start[0]));
 assert.ok(Math.max(...slopes)-Math.min(...slopes)>0,'rays diverge from the object, not parallel pencils');
 const outgoing=image.segments.filter(s=>s.start[0]===eyepiece.position[0]&&s.point===0&&!s.dashed);
 const expected=(outgoing[0].end[1]-outgoing[0].start[1])/(outgoing[0].end[0]-outgoing[0].start[0]);
 outgoing.forEach(s=>close((s.end[1]-s.start[1])/(s.end[0]-s.start[0]),expected));
 assert.ok(view.paths.length>0);
 const html=renderToStaticMarkup(<SpatialDistantPreview object={source} result={image}/>);
 assert.match(html,/物像对照/);assert.doesNotMatch(html,/示意卡|分辨角|倒像/);
});

test('moving real F changes focus and angular image; moving eyepiece to its new conjugate restores focus',()=>{
 const copy=copied(),moved=structuredClone(copy);moved.elements[0].position[0]=-800;
 const focused=structuredClone(moved),v=1/(1/focused.elements[1].focalLengthMm-1/800);
 const shift=v+focused.elements[2].focalLengthMm-focused.elements[2].position[0];
 focused.elements[2].position[0]+=shift;focused.elements[3].position[0]+=shift;
 const results=simulate([copy,moved,focused]).map(r=>r.imaging![0]);
 assert.equal(results[1].distantView!.focused,false);assert.equal(results[2].distantView!.focused,true);
 assert.notEqual(results[0].stages[0].distanceMm,results[1].stages[0].distanceMm);
 assert.notDeepEqual(results[0].distantView!.paths,results[1].distantView!.paths);
 // Each admitted pupil ray sees the same point at focus; at defocus they spread.
 const spread=(image:typeof results[number])=>{const hits=image.observations[0].hits.filter(h=>h.point===0) as (typeof image.observations[0]['hits'][number]&{angleY:number})[];return Math.max(...hits.map(h=>h.angleY))-Math.min(...hits.map(h=>h.angleY));};
 close(spread(results[0]),0);assert.ok(spread(results[1])>.01);close(spread(results[2]),0);
});

test('pupil acceptance, wavelength, Galileo orientation and unsupported geometry use live apparatus',()=>{
 const copy=copied(),blocked=structuredClone(copy),red=structuredClone(copy),tilted=structuredClone(copy);
 blocked.elements[3].position[1]+=50;red.elements[0].wavelengthNm=780;tilted.elements[1].pitchDeg=10;
 const state=defaultScene('instruments-1');state.parameters={...state.parameters,k2:-1,d:170};
 const gal=sceneBuilderCopy(state,immediateTelescope(state)).experiment!;
 const result=simulate([copy,blocked,red,tilted,gal]).map(r=>r.imaging![0]);
 assert.equal(result[1].distantView!.paths.length,0);
 close(result[2].distantView!.sigmaDegrees/result[0].distantView!.sigmaDegrees,780/550);
 assert.equal(result[3].distantView,undefined);assert.ok(result[3].warnings.length);
 assert.equal(result[4].distantView!.focused,true);assert.ok(result[4].distantView!.magnification>0);
 assert.equal(gal.elements[0].position[1],gal.elements[1].position[1]);
 assert.ok(result[4].distantView!.paths.length>0,'default Galileo eye position must receive the centered F, independent of the guide ray angle');
});

test('telescope cutaway uses live lens positions; focusing extends the tube and preserves eye relief',async()=>{
 const {telescopeLayout,createTelescopeHousing,focusTelescope}=await import('./spatialTelescope');
 const THREE=await import('three');
 const original=copied(),snapshot=JSON.stringify(original),layout=telescopeLayout(original)!;
 assert.ok(layout);const housing=createTelescopeHousing(layout);
 assert.equal(JSON.stringify(original),snapshot,'rendering must not mutate optical apparatus');
 assert.ok(housing.getObjectByName('telescope-main-tube'));assert.ok(housing.getObjectByName('telescope-drawtube'));
 const changed=focusTelescope(original,layout.length+15),next=telescopeLayout(changed)!;
 assert.deepEqual(changed.elements[0],original.elements[0]);assert.deepEqual(changed.elements[1],original.elements[1]);
 close(next.length,layout.length+15);close(next.gap,layout.gap);close(next.mainLength,layout.mainLength);
 const newer=createTelescopeHousing(next);
 const first=new THREE.Box3().setFromObject(housing.getObjectByName('telescope-drawtube')!);
 const second=new THREE.Box3().setFromObject(newer.getObjectByName('telescope-drawtube')!);
 close(second.max.x-first.max.x,15);close(first.min.x,second.min.x);
 const results=simulate([original,changed]);assert.equal(results[0].imaging![0].distantView!.focused,true);assert.equal(results[1].imaging![0].distantView!.focused,false);
 const clamped=focusTelescope(original,10000);assert.ok(clamped.elements.every(e=>e.position.every(x=>Math.abs(x)<=1000)));
 const tilted=structuredClone(original);tilted.elements[2].position[2]+=2;assert.equal(telescopeLayout(tilted),null);
 const extra=structuredClone(original);extra.elements.push({...extra.elements[2],id:'extra'});assert.equal(telescopeLayout(extra),null);
 const gal=structuredClone(original);gal.elements[2].focalLengthMm=-30;gal.elements[2].position[0]-=60;gal.elements[3].position[0]-=60;
 assert.ok(telescopeLayout({...gal,name:'重命名装置'}));
 for(const root of [housing,newer])root.traverse(child=>{if(child instanceof THREE.Mesh){child.geometry.dispose();for(const material of Array.isArray(child.material)?child.material:[child.material])material.dispose();}});
});

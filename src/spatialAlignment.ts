import type { SpatialElement, SpatialExperiment, Vec3 } from './builderModel';
import { geometryFrame, prismIntersection, prismExit, dot3, sub3 } from './spatialGeometry';
import { isPhysicalLens, physicalLensIntersection, physicalLensExit } from './physicalLensGeometry';
import {gratingOrderDirections,gratingMountRadius} from './amplitudeGrating';

export interface OpticalAxis { start:Vec3; end:Vec3; direction:Vec3; sourceId:string; previousId:string }
const add=(a:Vec3,b:Vec3):Vec3=>a.map((x,i)=>x+b[i]) as Vec3;
const sub=(a:Vec3,b:Vec3):Vec3=>a.map((x,i)=>x-b[i]) as Vec3;
const mul=(a:Vec3,k:number):Vec3=>a.map(x=>x*k) as Vec3;
const dot=(a:Vec3,b:Vec3)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
const length=(a:Vec3)=>Math.sqrt(dot(a,a));
const unit=(a:Vec3):Vec3=>mul(a,1/Math.max(length(a),1e-12));
export function opticalDirection(e:Pick<SpatialElement,'yawDeg'|'pitchDeg'>):Vec3 {
  const yaw=e.yawDeg*Math.PI/180,pitch=e.pitchDeg*Math.PI/180;
  return [Math.cos(pitch)*Math.cos(yaw),Math.sin(pitch),Math.cos(pitch)*Math.sin(yaw)];
}
function angles(d:Vec3){return {yawDeg:Math.atan2(d[2],d[0])*180/Math.PI,pitchDeg:Math.asin(Math.max(-1,Math.min(1,d[1])))*180/Math.PI};}
const reflect=(d:Vec3,n:Vec3)=>unit(sub(d,mul(n,2*dot(d,n))));

// Construction guides exclude the selected device so moving it cannot move its reference axis.
// They trace ideal centre rays only; simulated light and power still come from the backend.
export function alignmentAxes(experiment:SpatialExperiment,selectedId:string|null):OpticalAxis[] {
  const axes:OpticalAxis[]=[],targets=experiment.elements.filter(e=>e.kind!=='laser'&&e.id!==selectedId);
  const selected=experiment.elements.find(e=>e.id===selectedId);
  const queue=experiment.elements.filter(e=>e.kind==='laser').map(source=>({start:source.position,direction:opticalDirection(source),sourceId:source.id,previousId:source.id,steps:0}));
  if(selected?.kind==='laser'){
    const target=targets.filter(e=>length(sub(e.position,selected.position))>1).sort((a,b)=>length(sub(a.position,selected.position))-length(sub(b.position,selected.position)))[0];
    if(!target)return [];
    const direction=unit(sub(target.position,selected.position));
    return [{start:selected.position,end:add(selected.position,mul(direction,Math.min(2000,length(sub(target.position,selected.position))+180))),direction,sourceId:selected.id,previousId:selected.id}];
  }
  while(queue.length&&axes.length<128){
    const ray=queue.shift()!;if(ray.steps>=16)continue;
    let nearest:{distance:number;element:SpatialElement;hit:Vec3;normal:Vec3;local:Vec3}|null=null;
    for(const element of targets){
      if(element.id===ray.previousId)continue;
      if(isPhysicalLens(element.kind)){
        const hit=physicalLensIntersection(element,ray.start,ray.direction);
        if(hit&&(!nearest||hit.distance<nearest.distance))nearest={...hit,element,local:sub(hit.hit,element.position)};
        continue;
      }
      if(element.kind.endsWith('prism')){
        const hit=prismIntersection(element,ray.start,ray.direction);
        if(hit&&(!nearest||hit.distance<nearest.distance))nearest={distance:hit.distance,element,hit:hit.hit,normal:hit.normal,local:sub(hit.hit,element.position)};
        continue;
      }
      const normal=opticalDirection(element),denominator=dot(ray.direction,normal);
      if(Math.abs(denominator)<1e-8)continue;
      const distance=dot(sub(element.position,ray.start),normal)/denominator;
      if(distance<1e-5||distance>2000)continue;
      const hit=add(ray.start,mul(ray.direction,distance)),local=sub(hit,element.position);
      const radius=element.kind==='amplitude-grating'?gratingMountRadius(element):element.kind==='aperture'?Math.max(30,element.diameterMm/2+10):element.kind==='slit'?Math.max(30,element.slitHeightMm/2+10,element.slitWidthMm/2+10):element.diameterMm/2;
      if(length(local)>radius+1e-7)continue;
      if(!nearest||distance<nearest.distance)nearest={distance,element,hit,normal,local};
    }
    const end=nearest?.hit??add(ray.start,mul(ray.direction,2000));
    axes.push({start:ray.start,end,direction:ray.direction,sourceId:ray.sourceId,previousId:ray.previousId});
    if(!nearest)continue;
    const {element,hit,normal,local}=nearest;
    if(isPhysicalLens(element.kind)){
      const source=experiment.elements.find(e=>e.id===ray.sourceId)!;
      const entry=physicalLensIntersection(element,ray.start,ray.direction)!;
      const exit=physicalLensExit(element,entry,ray.direction,source.wavelengthNm);
      if(exit){for(const path of exit.path)axes.push({...path,sourceId:ray.sourceId,previousId:element.id});queue.push({...ray,start:exit.origin,direction:exit.direction,previousId:element.id,steps:ray.steps+exit.path.length+1});}continue;
    }
    if(['screen','power-meter'].includes(element.kind)||element.kind==='aperture'&&length(local)>element.diameterMm/2)continue;
    if(element.kind==='slit'){const {u,v}=geometryFrame(element),inside=Math.abs(dot3(sub3(hit,element.position),u))<=element.slitWidthMm/2+1e-9&&Math.abs(dot3(sub3(hit,element.position),v))<=element.slitHeightMm/2+1e-9;if(element.slitMode==='stop'?inside:!inside)continue;}
    if(element.kind.endsWith('prism')){
      const source=experiment.elements.find(e=>e.id===ray.sourceId)!;
      const exit=prismExit(element,{hit,normal},ray.direction,source.wavelengthNm);
      if(exit){for(const path of exit.path)axes.push({...path,sourceId:ray.sourceId,previousId:element.id});queue.push({...ray,start:exit.origin,direction:exit.direction,previousId:element.id,steps:ray.steps+exit.path.length+1});}continue;
    }
    let directions=[ray.direction];
    if(element.kind==='amplitude-grating'){
      const {u,v}=geometryFrame(element),period=element.gratingPeriodUm*.001,activeWidth=Math.floor(element.gratingWidthMm/period+1e-9)*period;
      directions=Math.abs(dot(local,u))>activeWidth/2+1e-9||Math.abs(dot(local,v))>element.gratingHeightMm/2+1e-9?[]:gratingOrderDirections(element,ray.direction,experiment.elements.find(e=>e.id===ray.sourceId)!.wavelengthNm).filter(o=>o.efficiency>0).map(o=>o.direction);
    }
    if(element.kind==='mirror')directions=[reflect(ray.direction,normal)];
    if(element.kind==='polarizing-splitter')directions=[...((element.pTransmission>0||element.sTransmission>0)?[ray.direction]:[]),...((element.pTransmission<1||element.sTransmission<1)?[reflect(ray.direction,normal)]:[])];
    if(element.kind==='splitter')directions=[...(element.transmission>0?[ray.direction]:[]),...(element.transmission<1?[reflect(ray.direction,normal)]:[])];
    if(['filter','polarizer','half-wave-plate','quarter-wave-plate'].includes(element.kind)&&element.transmission===0)directions=[];
    if(element.kind==='lens'||element.kind==='cylindrical-lens'){
      const axial=dot(ray.direction,normal),forward=mul(normal,axial>0?1:-1);
      const {u}=geometryFrame(element),offset=element.kind==='cylindrical-lens'?mul(u,dot(local,u)):local;
      directions=[unit(add(forward,sub(mul(sub(ray.direction,mul(forward,Math.abs(axial))),1/Math.abs(axial)),mul(offset,1/element.focalLengthMm))))];
    }
    for(const direction of directions)queue.push({...ray,start:hit,direction,previousId:element.id,steps:ray.steps+1});
  }
  return axes;
}
export function closestAxis(position:Vec3,axes:OpticalAxis[]){
  let best:{axis:OpticalAxis;position:Vec3;distance:number}|null=null;
  for(const axis of axes){
    const t=dot(sub(position,axis.start),axis.direction),span=length(sub(axis.end,axis.start));
    if(t<1||t>span+1e-6)continue;
    const projected=add(axis.start,mul(axis.direction,t)),distance=length(sub(position,projected));
    if(!best||distance<best.distance)best={axis,position:projected,distance};
  }
  return best;
}
export function alignedPose(experiment:SpatialExperiment,id:string,axes=alignmentAxes(experiment,id)):Partial<SpatialElement>|null {
  const selected=experiment.elements.find(e=>e.id===id);if(!selected)return null;
  if(selected.kind==='laser')return axes.length?angles(axes[0].direction):null;
  const nearest=closestAxis(selected.position,axes);if(!nearest)return null;
  if(nearest.position.some(x=>x < -1000||x > 1000))return null;
  let normal=nearest.axis.direction;
  if(selected.kind.endsWith('prism'))return {position:nearest.position};
  if(selected.kind==='mirror'||selected.kind==='splitter'||selected.kind==='polarizing-splitter'){
    // Keep an intentional fold: aim the reflected branch toward the next apparatus centre.
    const index=experiment.elements.findIndex(e=>e.id===id);
    const downstream=experiment.elements.slice(index+1).filter(e=>e.kind!=='laser'&&e.id!==nearest.axis.previousId&&length(sub(e.position,nearest.position))>1);
    const target=downstream.filter(e=>Math.abs(dot(unit(sub(e.position,nearest.position)),normal))<.985).sort((a,b)=>length(sub(a.position,nearest.position))-length(sub(b.position,nearest.position)))[0];
    if(!target)return {position:nearest.position};
    const outgoing=unit(sub(target.position,nearest.position));
    normal=unit(sub(nearest.axis.direction,outgoing));
    // The two signs describe the same mirror plane; preserve the closest convention.
    if(dot(normal,opticalDirection(selected))<0)normal=mul(normal,-1);
  }
  return {position:nearest.position,...angles(normal)};
}
export function snapPose(experiment:SpatialExperiment,id:string,patch:Partial<SpatialElement>,tool:'translate'|'rotate',axes=alignmentAxes(experiment,id)):Partial<SpatialElement> {
  const current=experiment.elements.find(e=>e.id===id);if(!current)return patch;
  const candidate={...current,...patch},aligned=alignedPose({...experiment,elements:experiment.elements.map(e=>e.id===id?candidate:e)},id,axes);
  if(!aligned)return patch;
  if(tool==='translate'&&current.kind!=='laser'&&aligned.position&&length(sub(candidate.position,aligned.position))<=6)return {...patch,position:aligned.position};
  if(tool==='rotate'&&aligned.yawDeg!==undefined&&aligned.pitchDeg!==undefined){
    const angle=Math.acos(Math.max(-1,Math.min(1,dot(opticalDirection(candidate),opticalDirection(aligned as SpatialElement)))))*180/Math.PI;
    if(angle<=2)return {...patch,yawDeg:aligned.yawDeg,pitchDeg:aligned.pitchDeg};
  }
  return patch;
}

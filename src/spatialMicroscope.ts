import {instrumentMaterials,instrumentBlock,instrumentScrew} from './spatialAppearance';
import * as THREE from 'three';
import type {SpatialExperiment,MicroscopePresentation} from './builderModel';
import {geometryFrame,dot3,sub3} from './spatialGeometry';

/** Presentation only: a rigid transform preserves all physical distances and ray intersections. */
export function microscopeLayout(experiment:SpatialExperiment){
  let p:MicroscopePresentation|undefined=experiment.presentation;
  if(!p&&experiment.name.startsWith('显微镜成像 · 器件副本')&&experiment.elements.length===4){
    const [object,objective,relay,observer]=experiment.elements;
    if(object.name==='样品'&&objective.name==='物镜'&&['目镜','管镜'].includes(relay.name))p={kind:'microscope',objectId:object.id,objectiveId:objective.id,relayId:relay.id,observerId:observer.id};
  }
  if(!p||experiment.elements.length!==4)return null;
  const object=experiment.elements.find(e=>e.id===p.objectId),objective=experiment.elements.find(e=>e.id===p.objectiveId),relay=experiment.elements.find(e=>e.id===p.relayId),observer=experiment.elements.find(e=>e.id===p.observerId);
  if(!object||object.kind!=='object'||!objective||objective.kind!=='lens'||!relay||relay.kind!=='lens'||!observer||!['eye','sensor'].includes(observer.kind))return null;
  const {n,u,v}=geometryFrame(object),axis=new THREE.Vector3(...n),origin=new THREE.Vector3(...object.position);
  for(const e of [objective,relay,observer]){
    const delta=new THREE.Vector3(...e.position).sub(origin),t=delta.dot(axis);
    if(delta.addScaledVector(axis,-t).length()>1e-5||Math.abs(dot3(geometryFrame(e).n,n)-1)>1e-6)return null;
  }
  const objectDistance=dot3(sub3(objective.position,object.position),n),separation=dot3(sub3(relay.position,objective.position),n),detectorGap=dot3(sub3(observer.position,relay.position),n);
  if(objectDistance<=0||separation<=0||detectorGap<0||observer.kind==='eye'&&detectorGap>1e-5)return null;
  const sourceRotation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(axis,new THREE.Vector3(...v).negate(),new THREE.Vector3(...u)));
  const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2).multiply(sourceRotation.invert());
  // Anchor the objective to the stand. Focusing moves only the stage, never the tube.
  const objectiveY=Math.max(90,Math.abs(objective.focalLengthMm)*4+50);
  const position=new THREE.Vector3(0,objectiveY,0).sub(new THREE.Vector3(...objective.position).applyQuaternion(rotation));
  const at=(point:readonly number[])=>new THREE.Vector3(...point).applyQuaternion(rotation).add(position);
  return {object,objective,relay,observer,rotation,position,at,objectDistance,camera:observer.kind==='sensor',stageY:objectiveY-objectDistance,objectiveY,relayY:objectiveY+separation,observerY:objectiveY+separation+detectorGap};
}
export type MicroscopeLayout=NonNullable<ReturnType<typeof microscopeLayout>>;

export type FocusPhase='start'|'change'|'end'|'cancel';
export function microscopeFocusBounds(layout:MicroscopeLayout){
  // Match the microscope scene's focus travel; a drag must not collapse u to 0.5 mm.
  let min=5,max=Math.min(100,layout.objectiveY-28);
  const {n}=geometryFrame(layout.object);
  n.forEach((axis,i)=>{if(Math.abs(axis)<1e-10)return;const a=(layout.objective.position[i]-1000)/axis,b=(layout.objective.position[i]+1000)/axis;min=Math.max(min,Math.min(a,b));max=Math.min(max,Math.max(a,b));});
  return {min,max};
}
/** A focus operation changes only the object's axial position, in physical millimetres. */
export function focusMicroscope(experiment:SpatialExperiment,distance:number):SpatialExperiment{
  const layout=microscopeLayout(experiment);if(!layout||!Number.isFinite(distance))return experiment;
  const {min,max}=microscopeFocusBounds(layout);if(min>max)return experiment;
  const u=THREE.MathUtils.clamp(distance,min,max),{n}=geometryFrame(layout.object);
  const position=layout.objective.position.map((value,i)=>value-n[i]*u) as [number,number,number];
  return {...experiment,elements:experiment.elements.map(e=>e.id===layout.object.id?{...e,position}:e)};
}

/** Older drafts could capture the drag limit as their reset baseline. Repair only that
 * invalid focus travel, on an explicit reset; valid copied defocus and all optics survive. */
export function microscopeResetBaseline(experiment:SpatialExperiment):SpatialExperiment{
  const layout=microscopeLayout(experiment);
  if(!layout||layout.objectDistance>=5&&layout.objectDistance<=100)return experiment;
  // The scene camera uses the tube lens's back focal plane, including ideal adapter scaling.
  if(layout.camera&&Math.abs(layout.observerY-layout.relayY-layout.relay.focalLengthMm)>1e-6)return experiment;
  const f=layout.objective.focalLengthMm,v=layout.relayY-layout.objectiveY-layout.relay.focalLengthMm;
  const distance=layout.camera?f:v>f?f*v/(v-f):NaN;
  return Number.isFinite(distance)&&distance>=5&&distance<=100?focusMicroscope(experiment,distance):experiment;
}

function roundedBlock(width:number,height:number,depth:number,radius:number){
  const x=-width/2,y=-height/2,r=Math.min(radius,width/3,height/3),s=new THREE.Shape();
  s.moveTo(x+r,y);s.lineTo(x+width-r,y);s.quadraticCurveTo(x+width,y,x+width,y+r);s.lineTo(x+width,y+height-r);s.quadraticCurveTo(x+width,y+height,x+width-r,y+height);s.lineTo(x+r,y+height);s.quadraticCurveTo(x,y+height,x,y+height-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);
  const geometry=new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:true,bevelSize:.5,bevelThickness:.5,bevelSegments:2,curveSegments:10});geometry.translate(0,0,-depth/2);return geometry;
}

/** Mechanical envelope only; no light source, added lens or hidden optical fold. */
export function createMicroscopeHousing(layout:MicroscopeLayout){
  const root=new THREE.Group();root.name='microscope-housing';
  const {ivory,dark,steel,teal,rubber,brass}=instrumentMaterials();
  const mesh=(geometry:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number,name='')=>{const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.name=name;m.castShadow=true;m.receiveShadow=true;root.add(m);return m;};
  const block=(w:number,h:number,d:number,x:number,y:number,z:number,mat:THREE.Material=ivory,r=3,name='')=>mesh(roundedBlock(w,h,d,r),mat,x,y,z,name);
  const cylinder=(radius:number,height:number,x:number,y:number,z:number,mat:THREE.Material=dark)=>mesh(new THREE.CylinderGeometry(radius,radius,height,64),mat,x,y,z);
  // Keep the front-right sector open, with solid wall thickness and finished cut edges.
  const shell=(radius:number,start:number,end:number,mat:THREE.Material=ivory)=>{
    if(end-start<=.05)return;
    const a=25*Math.PI/180,b=245*Math.PI/180,inner=radius-2,shape=new THREE.Shape();
    shape.absarc(0,0,radius,a,b,false);shape.lineTo(inner*Math.cos(b),inner*Math.sin(b));shape.absarc(0,0,inner,b,a,true);shape.closePath();
    const g=new THREE.ExtrudeGeometry(shape,{depth:end-start,bevelEnabled:true,bevelSize:.22,bevelThickness:Math.min(.15,(end-start)/4),bevelSegments:2,curveSegments:48});g.rotateX(-Math.PI/2);
    mesh(g,mat,0,start,0,'cutaway-shell');
  };
  const objectiveRadius=layout.objective.diameterMm/2+5,relayRadius=layout.relay.diameterMm/2+5;
  const tubeRadius=Math.max(objectiveRadius,relayRadius)+2;
  const rear=-tubeRadius-27,armTop=layout.relayY+8;
  // One continuous stand rather than four independent optical posts.
  block(138,13,120,0,7,-19,ivory,8,'microscope-base');
  block(115,4,98,0,15,-23,ivory,9);
  mesh(instrumentBlock(80,.8,35,1),rubber,0,17.8,-28,'microscope-base-inset');
  block(29,.6,10,38,14.5,13,dark,1,'microscope-nameplate');
  block(18,.3,1.1,38,15,13,steel,.2);
  for(const x of [-52,52]){const screw=instrumentScrew(1.4);screw.position.set(x,14.2,22);root.add(screw);}
  block(66,1,7,0,14,31,dark,2);
  block(19,1.2,2,-20,14.6,31,teal,1);
  block(118,3,104,0,1,-19,rubber,5);
  for(const x of [-45,45])for(const z of [-56,20])cylinder(5,3,x,-1,z,rubber);
  // Tapered rear spine and a separate sliding carriage give the stand a continuous silhouette.
  const spine=new THREE.Shape();spine.moveTo(-22,17);spine.lineTo(22,17);spine.quadraticCurveTo(20,45,16,62);spine.lineTo(13,armTop-10);spine.quadraticCurveTo(12,armTop+5,0,armTop+5);spine.quadraticCurveTo(-12,armTop+5,-13,armTop-10);spine.lineTo(-16,62);spine.quadraticCurveTo(-20,45,-22,17);
  const spineGeometry=new THREE.ExtrudeGeometry(spine,{depth:22,bevelEnabled:true,bevelSize:2,bevelThickness:2,bevelSegments:3,curveSegments:16});
  mesh(spineGeometry,ivory,0,0,rear-11,'microscope-arm');
  block(32,15,Math.abs(rear)-tubeRadius+10,0,armTop-5,(rear-tubeRadius+4)/2,ivory,5);
  // The spine's bevel ends at rear-13. Keep the trim's visible face outside it;
  // coincident faces flicker as the orbit camera moves.
  block(18,Math.max(20,armTop-48),3,0,(armTop+26)/2,rear-14,dark,3,'microscope-back-trim');
  block(19,43,3,0,layout.objectiveY-35,rear+13,steel,2);
  // Stage aperture remains centred on the true object plane. The slide rests on its rim.
  const h=layout.object.objectHeightMm,w=layout.object.objectWidthMm;
  const cx=-h/2,cz=layout.object.objectPattern==='F'?w/2:0;
  const apertureX=Math.max(6,h+1),apertureZ=Math.max(6,w+1),stageWidth=Math.max(94,h+30),stageDepth=Math.max(72,w+30),top=layout.stageY-.7;
  const side=(stageWidth-apertureX)/2,front=(stageDepth-apertureZ)/2;
  const stage=new THREE.Group();stage.name='specimen-stage';stage.userData.focusControl='stage';root.add(stage);
  const stagePart=(part:THREE.Object3D)=>{stage.add(part);return part;};
  stagePart(block(side,3.4,stageDepth,cx-(stageWidth+apertureX)/4,top-1.7,cz,dark,1));
  stagePart(block(side,3.4,stageDepth,cx+(stageWidth+apertureX)/4,top-1.7,cz,dark,1));
  stagePart(block(apertureX,3.4,front,cx,top-1.7,cz-(stageDepth+apertureZ)/4,dark,1));
  stagePart(block(apertureX,3.4,front,cx,top-1.7,cz+(stageDepth+apertureZ)/4,dark,1));
  stagePart(block(stageWidth-4,1.5,2,cx,top-3.7,cz+stageDepth/2-2,steel,.4));
  for(let i=0;i<15;i++)stagePart(block(.4,.15,i%5===0?4:2,cx-28+i*4,top+.55,cz+stageDepth/2-5,steel,.1));
  block(34,10,Math.abs(rear),0,top-7,rear/2,ivory,3);
  for(const x of [cx-stageWidth*.34,cx+stageWidth*.34]){
    stagePart(block(3,1,24,x,top+.8,cz,steel,1));
    stagePart(cylinder(2,2,x,top+1,cz-11,steel));
  }
  for(const x of [cx-stageWidth*.42,cx+stageWidth*.42])for(const z of [cz-stageDepth*.36,cz+stageDepth*.36]){
    const screw=instrumentScrew(1.1);screw.position.set(x,top+.65,z);stagePart(screw);
  }
  block(26,18,9,0,top-12,rear+15,dark,3);
  for(const sign of [-1,1]){
    const knobY=layout.objectiveY-35,knobZ=rear+5;
    for(const fine of [false,true]){
      const x=sign*(fine?37:26),radius=fine?6:12,depth=fine?6:12;
      const knob=new THREE.Group();knob.name=fine?'fine-focus-knob':'focus-knob';knob.userData.focusControl=fine?'fine':'coarse';knob.position.set(x,knobY,knobZ);knob.rotation.x=-layout.objectDistance*(fine?8:2);root.add(knob);
      const profile=new THREE.Shape();for(let i=0;i<128;i++){const a=i/128*Math.PI*2,r=radius-(i%4<2?.55:0);i?profile.lineTo(Math.cos(a)*r,Math.sin(a)*r):profile.moveTo(r,0);}profile.closePath();
      const geometry=new THREE.ExtrudeGeometry(profile,{depth,bevelEnabled:true,bevelSize:.25,bevelThickness:.25,bevelSegments:2});geometry.translate(0,0,-depth/2);geometry.rotateY(Math.PI/2);
      const grip=new THREE.Mesh(geometry,fine?steel:dark);knob.add(grip);
      const cap=new THREE.Mesh(new THREE.CylinderGeometry(radius-1,radius-1,.8,64),fine?dark:steel);cap.rotation.z=Math.PI/2;cap.position.x=sign*(depth/2+.3);knob.add(cap);
      const inset=new THREE.Mesh(new THREE.CylinderGeometry(radius-2,radius-2,1,64),dark);inset.rotation.z=Math.PI/2;inset.position.x=sign*(depth/2+.6);knob.add(inset);
      const tick=new THREE.Mesh(new THREE.BoxGeometry(.3,3,.9),teal);tick.position.set(sign*(depth/2+1.2),radius-4,0);knob.add(tick);
    }
  }
  // Open objective nose, barrel and tube: the computed lens planes remain visible inside.
  const noseStart=Math.max(layout.stageY+1,layout.objectiveY-5);
  shell(objectiveRadius,noseStart,layout.objectiveY+13,dark);
  shell(objectiveRadius+.7,layout.objectiveY+8,layout.objectiveY+11,teal);
  shell(objectiveRadius+.8,layout.objectiveY+7,layout.objectiveY+7.6,brass);
  shell(tubeRadius,layout.objectiveY+13,layout.relayY-9);
  shell(tubeRadius+1,layout.objectiveY+13,layout.objectiveY+17,dark);
  shell(tubeRadius+.4,layout.objectiveY+18,layout.objectiveY+20,steel);
  shell(relayRadius+1,layout.relayY-9,layout.relayY+7,dark);
  shell(relayRadius+1.3,layout.relayY-8,layout.relayY-6,steel);
  for(let y=layout.relayY-4;y<layout.relayY+4;y+=1.8)shell(relayRadius+1.35,y,y+.6,dark);
  if(layout.camera){
    // The tube ends at the actual pre-adapter equivalent sensor plane.
    shell(tubeRadius,layout.relayY+7,layout.observerY-14);
    const cameraWidth=Math.max(58,layout.observer.sensorHeightMm/layout.observer.adapterMagnification+14),cameraDepth=Math.max(52,layout.observer.sensorWidthMm/layout.observer.adapterMagnification+14),y=layout.observerY;
    // Three-sided camera housing leaves the active sensor visible from the cutaway.
    block(cameraWidth,27,5,0,y+3,-cameraDepth/2,dark,3,'camera-body');
    block(5,27,cameraDepth,-cameraWidth/2,y+3,0,dark,3);
    block(cameraWidth,5,cameraDepth,0,y+18,0,dark,3);
    block(cameraWidth-10,1,8,0,y+21,-cameraDepth*.2,steel,1);
    for(let i=0;i<6;i++)block(1,12,1,-cameraWidth/2-3,y+3,-cameraDepth/2+7+i*5,steel,.3);
    block(14,6,4,-cameraWidth/2+12,y-2,-cameraDepth/2-3,rubber,1);
    shell(tubeRadius+1,y-15,y-11,steel);
    const light=mesh(new THREE.SphereGeometry(1.2,16,8),new THREE.MeshBasicMaterial({color:'#56c8b5'}),cameraWidth/2-6,y+8,-cameraDepth/2-3);light.castShadow=false;
  }else{
    shell(relayRadius+1,layout.relayY+7,layout.relayY+20,dark);
    shell(relayRadius+3,layout.relayY+19,layout.relayY+24,rubber);
    shell(relayRadius+.5,layout.relayY+6,layout.relayY+9,steel);
  }
  return root;
}

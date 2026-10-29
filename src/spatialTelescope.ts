import {instrumentMaterials,instrumentBlock,instrumentScrew} from './spatialAppearance';
import * as THREE from 'three';
import type {SpatialExperiment,Vec3} from './builderModel';
import {geometryFrame,dot3,sub3} from './spatialGeometry';

/** Recognize the live two-lens telescope, independently of its saved name. */
export function telescopeLayout(experiment:SpatialExperiment){
 if(experiment.elements.length!==4)return null;
 const object=experiment.elements.find(e=>e.kind==='object'&&e.objectMode==='distant'),eye=experiment.elements.find(e=>e.kind==='eye');
 if(!object||!eye)return null;
 const {n,u,v}=geometryFrame(object),lenses=experiment.elements.filter(e=>e.kind==='lens').sort((a,b)=>dot3(sub3(a.position,b.position),n));
 if(lenses.length!==2||lenses[0].focalLengthMm<=0)return null;
 const [objective,eyepiece]=lenses,length=dot3(sub3(eyepiece.position,objective.position),n),gap=dot3(sub3(eye.position,eyepiece.position),n);
 if(length<10||gap<0||dot3(sub3(objective.position,object.position),n)<=0)return null;
 if([objective,eyepiece,eye].some(e=>Math.abs(Math.abs(dot3(geometryFrame(e).n,n))-1)>1e-6))return null;
 const off=new THREE.Vector3(...sub3(eyepiece.position,objective.position)).addScaledVector(new THREE.Vector3(...n),-length);
 if(off.length()>1e-5)return null;
 const rotation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...n),new THREE.Vector3(...v).negate(),new THREE.Vector3(...u)));
 return {object,objective,eyepiece,eye,length,gap,axis:n,rotation,mainLength:Math.max(8,Math.min(objective.focalLengthMm*.9,length-8))};
}
export type TelescopeLayout=NonNullable<ReturnType<typeof telescopeLayout>>;
export function telescopeFocusBounds(layout:TelescopeLayout){
 let min=10,max=1000;
 for(const e of [layout.eyepiece,layout.eye])layout.axis.forEach((axis,i)=>{
  if(Math.abs(axis)<1e-10)return;
  const a=layout.length+(-1000-e.position[i])/axis,b=layout.length+(1000-e.position[i])/axis;
  min=Math.max(min,Math.min(a,b));max=Math.min(max,Math.max(a,b));
 });
 return {min,max};
}
/** One undoable focus movement: eyepiece and eye translate together; objective and F stay put. */
export function focusTelescope(experiment:SpatialExperiment,distance:number):SpatialExperiment{
 const layout=telescopeLayout(experiment);if(!layout||!Number.isFinite(distance))return experiment;
 const {min,max}=telescopeFocusBounds(layout);if(min>max)return experiment;
 const delta=THREE.MathUtils.clamp(distance,min,max)-layout.length;
 return {...experiment,elements:experiment.elements.map(e=>[layout.eyepiece.id,layout.eye.id].includes(e.id)?{...e,position:e.position.map((x,i)=>x+delta*layout.axis[i]) as Vec3}:e)};
}

/** Mechanical cutaway only. It introduces no optical surface and never transforms the ray data. */
export function createTelescopeHousing(layout:TelescopeLayout){
 const root=new THREE.Group();root.name='telescope-housing';
 const barrel=new THREE.Group();barrel.position.set(...layout.objective.position);barrel.quaternion.copy(layout.rotation);root.add(barrel);
 const {ivory,dark,steel,teal,rubber,brass}=instrumentMaterials();
 const radius=Math.max(layout.objective.diameterMm,layout.eyepiece.diameterMm)/2+6;
 const shell=(start:number,end:number,outer:number,thickness:number,material:THREE.Material,name:string)=>{
  if(end<=start)return;
  const inner=outer-thickness,a=150*Math.PI/180,b=350*Math.PI/180,shape=new THREE.Shape();
  shape.absarc(0,0,outer,a,b,false);shape.lineTo(inner*Math.cos(b),inner*Math.sin(b));shape.absarc(0,0,inner,b,a,true);shape.closePath();
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:end-start,bevelEnabled:true,bevelSize:Math.min(.2,thickness/5),bevelThickness:.12,bevelSegments:2,curveSegments:48});
  // Extrusion z becomes optical x; the cross-section x/y become world-local y/z.
  geometry.applyMatrix4(new THREE.Matrix4().set(0,0,1,0,1,0,0,0,0,1,0,0,0,0,0,1));
  const mesh=new THREE.Mesh(geometry,material);mesh.position.x=start;mesh.name=name;
  if(['telescope-drawtube','telescope-eyecup','telescope-eyepiece-cell'].includes(name))mesh.userData.focusControl='telescope-tube';
  if(['telescope-focus-collar','focus-grip'].includes(name))mesh.userData.focusControl='telescope-ring';
  barrel.add(mesh);return mesh;
 };
 shell(-8,layout.mainLength,radius,2,ivory,'telescope-main-tube');
 shell(-16,-7,radius+1.5,2,dark,'telescope-front-hood');
 shell(-16.2,-15.4,radius+1.8,.7,steel,'telescope-hood-lip');
 shell(-7.5,-6.5,radius+.4,.7,brass,'telescope-objective-inlay');
 shell(-2,2,radius-2,Math.max(1,radius-2-layout.objective.diameterMm/2),steel,'telescope-objective-cell');
 const draw=shell(Math.max(2,layout.mainLength-24),layout.length+Math.min(6,layout.gap/3),radius-2.5,1.3,dark,'telescope-drawtube');
 if(draw)draw.userData.extension=layout.length-layout.mainLength;
 shell(layout.mainLength-7,layout.mainLength+3,radius+1,2.5,teal,'telescope-focus-collar');
 for(let x=layout.mainLength-6;x<layout.mainLength+3;x+=2)shell(x,x+.55,radius+1.4,.6,dark,'focus-grip');
 shell(layout.length-3,layout.length+Math.min(3,layout.gap/3),radius-3,Math.max(1,radius-3-layout.eyepiece.diameterMm/2),steel,'telescope-eyepiece-cell');
 shell(layout.length,layout.length+Math.min(14,layout.gap*.7),radius-2,2,rubber,'telescope-eyecup');
 // Longitudinal ribs and a fixed index clarify which tube slides when focusing.
 for(const angle of [170,210,250,290,330]){
   const a=angle*Math.PI/180;
   const rail=new THREE.Mesh(instrumentBlock(Math.max(2,layout.mainLength-20),.7,.7,.2),steel);
   rail.position.set(layout.mainLength/2,(radius+.1)*Math.cos(a),(radius+.1)*Math.sin(a));barrel.add(rail);
 }
 const index=new THREE.Mesh(instrumentBlock(4,.8,2,.2),brass);index.position.set(layout.mainLength-12,-radius-.4,0);barrel.add(index);
 const mountBand=shell(layout.mainLength*.43-5,layout.mainLength*.43+5,radius+1,1.1,dark,'telescope-mount-band');
 if(mountBand)mountBand.userData.mechanical=true;
 const mount=new THREE.Vector3(layout.mainLength*.43,-radius-3,0).applyQuaternion(layout.rotation).add(barrel.position);
 const rod=(a:THREE.Vector3,b:THREE.Vector3,r:number,mat:THREE.Material)=>{
  const delta=b.clone().sub(a),mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,delta.length(),24),mat);mesh.position.copy(a).lerp(b,.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());root.add(mesh);
 };
 const joint=new THREE.Mesh(new THREE.SphereGeometry(6,24,16),dark);joint.position.copy(mount);root.add(joint);
 const saddle=new THREE.Mesh(instrumentBlock(25,5,16,1),dark);saddle.position.copy(mount).add(new THREE.Vector3(0,-4,0));root.add(saddle);
 const lock=instrumentScrew(2.5);lock.rotation.x=Math.PI/2;lock.position.copy(mount).add(new THREE.Vector3(0,-2,8.5));root.add(lock);
 const foot=new THREE.Vector3(mount.x,Math.min(0,mount.y-20),mount.z),hub=foot.clone().add(new THREE.Vector3(0,10,0));
 rod(hub,mount,3.5,steel);
 for(let i=0;i<3;i++){const angle=i*Math.PI*2/3,tip=foot.clone().add(new THREE.Vector3(Math.cos(angle)*34,2,Math.sin(angle)*34));rod(hub,tip,2.6,dark);const pad=new THREE.Mesh(instrumentBlock(9,3,9,1),rubber);pad.position.copy(tip).add(new THREE.Vector3(0,-1,0));root.add(pad);}
 root.traverse(child=>{if(child instanceof THREE.Mesh){child.castShadow=true;child.receiveShadow=true;}});
 return root;
}

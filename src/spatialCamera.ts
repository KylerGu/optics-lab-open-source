import {instrumentMaterials,instrumentBlock,instrumentScrew} from './spatialAppearance';
import * as THREE from 'three';
import type {SpatialExperiment} from './builderModel';
import {geometryFrame,dot3,sub3} from './spatialGeometry';

/** Recognize an actual object/lens/sensor arrangement; never reposition its optics. */
export function cameraLayout(experiment:SpatialExperiment){
  if(experiment.elements.length!==3)return null;
  const object=experiment.elements.find(e=>e.kind==='object'&&e.objectMode==='finite'),lens=experiment.elements.find(e=>e.kind==='lens'),sensor=experiment.elements.find(e=>e.kind==='sensor');
  if(!object||!lens||!sensor||lens.focalLengthMm<=0)return null;
  const {n,u,v}=geometryFrame(lens),delta=sub3(sensor.position,lens.position),distance=dot3(delta,n);
  if(distance<5||dot3(sub3(lens.position,object.position),n)<=0)return null;
  if(new THREE.Vector3(...delta).addScaledVector(new THREE.Vector3(...n),-distance).length()>1e-5||Math.abs(dot3(geometryFrame(sensor).n,n)-1)>1e-6)return null;
  const rotation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...n),new THREE.Vector3(...v).negate(),new THREE.Vector3(...u)));
  return {object,lens,sensor,distance,rotation};
}
export type CameraLayout=NonNullable<ReturnType<typeof cameraLayout>>;
export type CameraDragPart='lens'|'sensor';
export function cameraMoveBounds(layout:CameraLayout,part:CameraDragPart){
  const {n}=geometryFrame(layout.lens),anchor=part==='lens'?layout.sensor:layout.lens,sign=part==='lens'?-1:1;
  let min=5,max=part==='lens'?Math.min(300,dot3(sub3(layout.sensor.position,layout.object.position),n)-1):300;
  n.forEach((axis,i)=>{const direction=axis*sign;if(Math.abs(direction)<1e-10)return;const a=(-1000-anchor.position[i])/direction,b=(1000-anchor.position[i])/direction;min=Math.max(min,Math.min(a,b));max=Math.min(max,Math.max(a,b));});
  return {min,max};
}
export function moveCameraPart(experiment:SpatialExperiment,distance:number,part:CameraDragPart):SpatialExperiment{
  const layout=cameraLayout(experiment);if(!layout||!Number.isFinite(distance))return experiment;
  const {min,max}=cameraMoveBounds(layout,part);if(min>max)return experiment;
  const value=THREE.MathUtils.clamp(distance,min,max),{n}=geometryFrame(layout.lens),anchor=part==='lens'?layout.sensor:layout.lens,moving=part==='lens'?layout.lens:layout.sensor;
  return {...experiment,elements:experiment.elements.map(e=>e.id===moving.id?{...e,position:anchor.position.map((x,i)=>x+n[i]*value*(part==='lens'?-1:1)) as [number,number,number]}:e)};
}

/** Open mechanical casing only. These meshes do not enter the optical calculation. */
export function createCameraHousing(layout:CameraLayout,bodyDistance=layout.distance){
  const root=new THREE.Group();root.name='camera-housing';root.position.set(...layout.lens.position);root.quaternion.copy(layout.rotation);
  const {dark,steel,teal,rubber,brass}=instrumentMaterials();
  const mesh=(geometry:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number,name:string)=>{const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.name=name;root.add(m);return m;};
  const block=(x:number,y:number,z:number,dx:number,dy:number,dz:number,mat:THREE.Material,name:string)=>{
    return mesh(instrumentBlock(dx,dy,dz,1),mat,x,y,z,name);
  };
  const radius=Math.max(15,layout.lens.diameterMm/2+5),height=Math.max(48,layout.sensor.sensorHeightMm+18,radius*2+12),width=Math.max(72,layout.sensor.sensorWidthMm+28,radius*2+26);
  const back=bodyDistance+8,front=Math.max(3,bodyDistance-25),length=Math.max(4,back-front);
  const shell=(start:number,end:number,r:number,thickness:number,mat:THREE.Material,name:string)=>{
    if(end<=start)return;
    // Leave the upper near-side sector open for the lens, rays and sensor.
    const a=150*Math.PI/180,b=350*Math.PI/180,inner=r-thickness,s=new THREE.Shape();
    s.absarc(0,0,r,a,b,false);s.lineTo(inner*Math.cos(b),inner*Math.sin(b));s.absarc(0,0,inner,b,a,true);s.closePath();
    const g=new THREE.ExtrudeGeometry(s,{depth:end-start,bevelEnabled:true,bevelSize:Math.min(.22,thickness/5),bevelThickness:.15,bevelSegments:2,curveSegments:48});
    g.applyMatrix4(new THREE.Matrix4().set(0,0,1,0,1,0,0,0,0,1,0,0,0,0,0,1));
    mesh(g,mat,start,0,0,name);
  };
  shell(-7,front+2,radius,2,dark,'camera-lens-barrel');
  shell(-8,-5,radius+.7,2.5,steel,'camera-front-rim');
  shell(-1,1,radius-2,Math.max(1,radius-3-layout.lens.diameterMm/2),steel,'camera-lens-cell');
  const gripEnd=Math.max(0,front*.7);
  shell(2,gripEnd,radius+1,2.5,rubber,'camera-focus-ring');
  for(let x=3;x<gripEnd;x+=1.7)shell(x,x+.65,radius+1.4,.7,dark,'camera-focus-ridge');
  shell(front-2,front+2,radius+1,2.5,teal,'camera-mount-ring');
  shell(-7.7,-7,radius+1.1,.7,brass,'camera-rim-inlay');
  block((front+back)/2,-height/2,0,length,3,width,dark,'camera-body-bottom');
  block((front+back)/2,0,-width/2,length,height,3,dark,'camera-body-side');
  block(back,0,0,3,height,width,dark,'camera-body-back');
  block((front+back)/2,height/2,-width*.32,length,3,width*.36,dark,'camera-top-shoulder');
  // Finished cut edges make the missing wall read as a deliberate cutaway.
  block(back-2,0,width/2,1,height,1,steel,'camera-cut-edge');
  block((front+back)/2,-height/2+2,width/2,length,1,1,steel,'camera-cut-edge');
  // Separate the inner light chamber from the milled outer casing.
  block(back-1.7,0,-width*.28,.4,height-7,width*.36,rubber,'camera-inner-liner');
  block((front+back)/2,-height/2+1.8,-width*.18,length-1,.4,width*.55,rubber,'camera-floor-liner');
  const grip=mesh(new THREE.CylinderGeometry(10,11,height-5,48),rubber,front+length*.45,-1,-width/2-7,'camera-hand-grip');grip.scale.x=Math.max(.55,length/24);
  for(let y=-height/2+6;y<height/2-5;y+=3)block(front+length*.42,y,-width/2-17,Math.max(7,length*.5),.5,.5,dark,'camera-grip-texture');
  mesh(new THREE.CylinderGeometry(4,4,2,32),steel,front+length*.4,height/2+2,-width/2-7,'camera-shutter-button');
  mesh(new THREE.CylinderGeometry(6,6,3,48),rubber,back-6,height/2+2,-width*.25,'camera-control-dial');
  for(let i=0;i<24;i++){
    const a=i*Math.PI/12;
    mesh(new THREE.CylinderGeometry(.28,.28,2,6),dark,back-6+Math.cos(a)*6,height/2+2,-width*.25+Math.sin(a)*6,'camera-dial-knurl');
  }
  block(back+1.7,0,0,.6,height*.6,width*.65,rubber,'camera-rear-display-frame');
  block(back+2.1,0,0,.3,height*.5,width*.55,new THREE.MeshStandardMaterial({color:'#24424d',metalness:.2,roughness:.2}),'camera-rear-display');
  block(layout.distance+2,0,0,1,layout.sensor.sensorHeightMm+7,layout.sensor.sensorWidthMm+7,teal,'camera-sensor-board');
  const sensorH=layout.sensor.sensorHeightMm,sensorW=layout.sensor.sensorWidthMm;
  for(const y of [-1,1])for(const z of [-1,1]){
    const screw=instrumentScrew(.85);screw.userData.focusControl='camera-sensor';screw.rotation.z=Math.PI/2;screw.position.set(layout.distance+1.3,y*(sensorH/2+2),z*(sensorW/2+2));root.add(screw);
  }
  for(let i=0;i<6;i++)block(layout.distance+1.35,-sensorH/2-2.2,-sensorW/2+(i+.5)*sensorW/6,.15,.8,Math.max(.4,sensorW/10),brass,'camera-sensor-contacts');
  // Guide rods sit outside the optical aperture and follow the real detector plane.
  for(const z of [-1,1]){
    const rail=mesh(new THREE.CylinderGeometry(.7,.7,Math.max(1,Math.abs(layout.distance-front)+2),16),steel,(front+layout.distance)/2,-sensorH/2-5,z*(sensorW/2+5),'camera-sensor-guide');rail.rotation.z=Math.PI/2;
  }
  root.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;if(['camera-lens-barrel','camera-front-rim','camera-lens-cell','camera-focus-ring','camera-focus-ridge','camera-rim-inlay'].includes(o.name))o.userData.focusControl='camera-lens';if(['camera-sensor-board','camera-sensor-contacts'].includes(o.name))o.userData.focusControl='camera-sensor';}});
  return root;
}

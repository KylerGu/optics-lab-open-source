import {cameraLayout,createCameraHousing,type CameraDragPart} from './spatialCamera';
import {instrumentMaterials,instrumentBlock,instrumentScrew} from './spatialAppearance';
import SpatialDistantPreview from './SpatialDistantPreview';
import {telescopeLayout,createTelescopeHousing} from './spatialTelescope';
import {imageView,imageCanvas,raySections,imageRayColor} from './spatialImageView';
import {imagingBeam} from './spatialImagingBeam';
import {microscopeLayout,createMicroscopeHousing,type FocusPhase} from './spatialMicroscope';
import {installMicroscopeControls} from './spatialMicroscopeControls';
import MicroscopeFocusReadout from './MicroscopeFocusReadout';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import SpatialObjectPreview from './SpatialObjectPreview';
import {objectPatternLines} from './spatialImaging';
import {gratingMountRadius} from './amplitudeGrating';
import {fourFOutputCanvas} from './SpatialFourFOutput';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { SpatialElement, SpatialExperiment, SpatialResult } from './builderModel';
import { closestAxis, snapPose, type OpticalAxis } from './spatialAlignment';
import { geometryFrame, prismVertices } from './spatialGeometry';
import { isPhysicalLens, isSolidCylinder, physicalLensProfile, physicalLensSurfaces } from './physicalLensGeometry';
import { createInfiniteGrid } from './spatialGrid';

export type SpatialView = 'perspective'|'top'|'side';
interface Props {
  visible?:boolean;
  experiment:SpatialExperiment; selectedId:string|null; rendered:boolean; result:SpatialResult|null;
  view:SpatialView; reset:number; tool:'translate'|'rotate'; showGrid:boolean; showBeam:boolean;
  axes:OpticalAxis[];showAxes:boolean;snapEnabled:boolean;
  onSelect:(id:string|null)=>void; onEditing:(value:boolean)=>void;
  onTransform:(id:string,patch:Partial<SpatialElement>)=>void;
  onFocus?:(phase:FocusPhase,distance?:number,part?:CameraDragPart)=>void;
}
interface State {
  scene:THREE.Scene; camera:THREE.PerspectiveCamera; renderer:THREE.WebGLRenderer;
  orbit:OrbitControls; transform:TransformControls; devices:THREE.Group; supports:THREE.Group; rays:THREE.Group; guides:THREE.Group;
  rig:THREE.Group;housing:THREE.Group;environment:THREE.Texture;focus:ReturnType<typeof installMicroscopeControls>;
  grid:ReturnType<typeof createInfiniteGrid>; floor:THREE.Mesh; resize:()=>void;
}
const world=(p:readonly number[])=>new THREE.Vector3(p[0],p[1],p[2]);
function orientation(e:SpatialElement) {
  const {n,u,v}=geometryFrame(e);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...n),new THREE.Vector3(...v).negate(),new THREE.Vector3(...u)));
}
function wavelengthColor(nm:number){return nm<470?'#4855ce':nm<500?'#008aa6':nm<570?'#00845d':nm<600?'#9b7900':'#d94235';}
function dispose(object:THREE.Object3D){
  object.traverse(child=>{
    const mesh=child as THREE.Mesh;mesh.geometry?.dispose();
    if(mesh.material)for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
      const mapped=material as THREE.MeshBasicMaterial;mapped.map?.dispose();material.dispose();
    }
  });
}
function clear(group:THREE.Group){for(const child of [...group.children]){group.remove(child);dispose(child);}}
// Display-only holders. The illuminated pattern and active sensor keep their real dimensions.
export function imagingHolder(e:SpatialElement){
  if(e.kind==='object')return {width:Math.max(18,e.objectWidthMm+4),height:Math.max(14,e.objectHeightMm+4),center:e.objectMode==='distant'?new THREE.Vector3():new THREE.Vector3(0,e.objectHeightMm/2,e.objectPattern==='F'?e.objectWidthMm/2:0)};
  if(e.kind==='sensor')return {width:Math.max(22,e.sensorWidthMm/e.adapterMagnification+4),height:Math.max(18,e.sensorHeightMm/e.adapterMagnification+4),center:new THREE.Vector3()};
  return null;
}
export function createSpatialOptic(e:SpatialElement,rendered:boolean) {
  const group=new THREE.Group();group.position.copy(world(e.position));group.quaternion.copy(orientation(e));group.userData.elementId=e.id;
  const radius=e.kind==='amplitude-grating'?gratingMountRadius(e):isSolidCylinder(e.kind)?Math.max(e.cylinderWidthMm,e.cylinderHeightMm)/2:e.diameterMm/2;
  // Construction emphasizes optical surfaces; instrument materials belong to the rendered view.
  const material=(color:string,transparent=false)=>new THREE.MeshPhysicalMaterial({
    color,metalness:transparent?0:rendered?.68:.12,roughness:transparent?(rendered?.12:.3):rendered?.3:.55,
    clearcoat:rendered?(transparent?.8:.25):.12,clearcoatRoughness:.16,envMapIntensity:rendered?(transparent?.85:1):.3,
    iridescence:rendered&&transparent?.18:0,iridescenceIOR:1.3,iridescenceThicknessRange:[180,300],
    transparent,opacity:transparent?(rendered?.28:.38):1,depthWrite:!transparent,side:THREE.DoubleSide,
  });
  const disk=(r:number,depth:number,color:string,transparent=false)=>{
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,depth,48),material(color,transparent));mesh.rotation.z=-Math.PI/2;group.add(mesh);return mesh;
  };
  const ring=(r:number,color:string,thickness=1.2)=>{
    const mesh=new THREE.Mesh(new THREE.TorusGeometry(r,thickness,10,64),material(color));mesh.rotation.y=Math.PI/2;group.add(mesh);return mesh;
  };
  const holder=imagingHolder(e);
  const frame=(width:number,height:number,innerWidth:number,innerHeight:number,depth:number,center:THREE.Vector3)=>{
    const bezel=new THREE.Group();bezel.name='imaging-holder';bezel.position.copy(center);
    const add=(w:number,h:number,y:number,z:number)=>{const bar=new THREE.Mesh(new THREE.BoxGeometry(depth,h,w),material('#465365'));bar.position.set(0,y,z);bezel.add(bar);};
    add(width,(height-innerHeight)/2,-(height+innerHeight)/4,0);add(width,(height-innerHeight)/2,(height+innerHeight)/4,0);
    add((width-innerWidth)/2,innerHeight,0,-(width+innerWidth)/4);add((width-innerWidth)/2,innerHeight,0,(width+innerWidth)/4);
    for(const y of [-1,1])for(const z of [-1,1]){
      const screw=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,depth+.15,12),material('#b1bbc5'));screw.rotation.z=Math.PI/2;screw.position.set(0,y*(height/2-.9),z*(width/2-.9));bezel.add(screw);
    }
    group.add(bezel);
  };
  if(e.kind==='object'){
    for(const line of objectPatternLines(e.objectPattern,e.objectMode==='distant'))group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(line.map(([x,y])=>new THREE.Vector3(0,y*e.objectHeightMm,x*e.objectWidthMm))),new THREE.LineBasicMaterial({color:'#278d78'})));
    if(e.objectMode==='distant')for(const [point,y] of [[0,-.5],[16,.5]]){
      const dot=new THREE.Mesh(new THREE.SphereGeometry(Math.max(.15,e.objectHeightMm*.025),12,8),new THREE.MeshBasicMaterial({color:imageRayColor(point===0?0:2)}));dot.position.set(0,y*e.objectHeightMm,-e.objectWidthMm/2);group.add(dot);
    }
    const plate=new THREE.Mesh(new THREE.BoxGeometry(.3,rendered?holder!.height-2:Math.max(2,e.objectHeightMm),rendered?holder!.width-2:Math.max(2,e.objectWidthMm)),material('#c6e5de',true));plate.position.copy(holder!.center);group.add(plate);
    if(rendered)frame(holder!.width,holder!.height,holder!.width-2,holder!.height-2,1.4,holder!.center);
  }else if(e.kind==='eye'){
    if(rendered){ring(6,'#8f73b5',1);disk(2,1,'#8f73b5');}
    else{
      const points=Array.from({length:65},(_,i)=>{const t=i/64*Math.PI*2;return new THREE.Vector3(0,5*Math.sin(t),9*Math.cos(t));});
      group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:'#8165a5'})));
      ring(2.6,'#8165a5',.45);disk(1,.4,'#8165a5');
    }
  }else if(e.kind==='sensor'){
    const w=e.sensorWidthMm/e.adapterMagnification,h=e.sensorHeightMm/e.adapterMagnification;
    const shape=new THREE.BoxGeometry(1,h,w);group.add(new THREE.Mesh(shape,material('#142d3b')));
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(shape),new THREE.LineBasicMaterial({color:'#38887d'})));
    if(rendered)frame(holder!.width,holder!.height,w,h,3.2,holder!.center);
  }else if(e.kind==='laser'){
    const body=disk(rendered?11:8,rendered?42:24,rendered?'#334155':'#4e6981');body.position.x=rendered?-19:-11;
    if(rendered)for(const x of [-36,-30,-24,-18,-12]){const rib=ring(11,'#52657c',.55);rib.position.x=x;}
    const bezel=disk(rendered?9:7,rendered?3:1.2,'#9caebf');bezel.position.x=2;
    const front=disk(5.5,1.2,e.wavelengthNm>600?'#df6552':'#249c80');front.position.x=4;front.name='laser-aperture';
    const aperture=front.material as THREE.MeshPhysicalMaterial;aperture.emissive.copy(aperture.color);aperture.emissiveIntensity=.3;
    if(!rendered){const arrow=new THREE.ArrowHelper(new THREE.Vector3(1,0,0),new THREE.Vector3(7,0,0),30,0x427ad3,6,4);group.add(arrow);}
  }else if(isSolidCylinder(e.kind)){
    const a=e.cylinderWidthMm/2,h=e.cylinderHeightMm/2,shape=new THREE.Shape();
    for(let i=0;i<=64;i++){const u=-a+2*a*i/64,x=physicalLensSurfaces(e,Math.abs(u))[0];i?shape.lineTo(x,u):shape.moveTo(x,u);}
    shape.lineTo(e.centerThicknessMm/2,a);shape.lineTo(e.centerThicknessMm/2,-a);shape.closePath();
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:e.cylinderHeightMm,bevelEnabled:false});geometry.rotateX(Math.PI/2);geometry.translate(0,h,0);
    group.add(new THREE.Mesh(geometry,material('#a9dbea',true)));
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry,30),new THREE.LineBasicMaterial({color:'#6294c4'})));
    group.add(new THREE.ArrowHelper(new THREE.Vector3(0,0,1),new THREE.Vector3(-e.centerThicknessMm/2-2,0,-a*.7),a*1.4,0x408adc,3,2));
  }else if(isPhysicalLens(e.kind)){
    const profile=physicalLensProfile(e).map(p=>new THREE.Vector2(...p));
    const geometry=new THREE.LatheGeometry(profile,64);geometry.rotateZ(-Math.PI/2);
    group.add(new THREE.Mesh(geometry,material('#a9dbea',true)));
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry,30),new THREE.LineBasicMaterial({color:'#6294c4',transparent:true,opacity:.65})));
    const [front,back]=physicalLensSurfaces(e,radius),mount=ring(radius+(rendered?2:0),rendered?'#52657c':'#437f9d',rendered?1.3:.35);mount.position.x=(front+back)/2;
  }else if(e.kind==='cylindrical-lens'){
    if(rendered){
      // Extruded cylindrical curvature: thickness varies along local U only.
      const shape=new THREE.Shape(),thickness=(z:number)=>e.focalLengthMm>0?2+4*(1-z*z/(radius*radius)):2+4*z*z/(radius*radius);
      for(let i=0;i<=32;i++){const z=-radius+2*radius*i/32;i?shape.lineTo(-thickness(z)/2,z):shape.moveTo(-thickness(z)/2,z);}
      for(let i=32;i>=0;i--){const z=-radius+2*radius*i/32;shape.lineTo(thickness(z)/2,z);}shape.closePath();
      const geometry=new THREE.ExtrudeGeometry(shape,{depth:radius*1.4,bevelEnabled:false});geometry.rotateX(Math.PI/2);geometry.translate(0,radius*.7,0);
      group.add(new THREE.Mesh(geometry,material('#9ccfe8',true)));
    }else disk(radius,2,'#59a9ea',true);
    ring(radius+2,'#408adc');group.add(new THREE.ArrowHelper(new THREE.Vector3(0,0,1),new THREE.Vector3(-5,0,-radius*.65),radius*1.3,0x408adc,3,2));
  }else if(e.kind==='lens'){
    {
      const profile=(e.focalLengthMm>0?[[0,-5],[radius*.45,-4.2],[radius*.8,-2.7],[radius,-1.5],[radius,1.5],[radius*.8,2.7],[radius*.45,4.2],[0,5]]:[[0,-1.2],[radius*.45,-1.8],[radius*.8,-3.2],[radius,-5],[radius,5],[radius*.8,3.2],[radius*.45,1.8],[0,1.2]]).map(p=>new THREE.Vector2(...p as [number,number]));
      const lens=new THREE.Mesh(new THREE.LatheGeometry(profile,64),material(rendered?'#a9dbea':'#9ccfdf',true));lens.rotation.z=-Math.PI/2;group.add(lens);
      if(rendered){
        ring(radius+2,'#344451',1.8);
        for(const x of [-1.35,1.35]){const lip=ring(radius+2,'#b8c8d1',.35);lip.position.x=x;}
        const retaining=ring(radius+.5,'#729ea8',.25);retaining.position.x=-1.7;
      }
      else{
        // The thin-lens surface is a visual symbol; its optical plane remains x = 0.
        for(const x of [-1.5,1.5]){const edge=ring(radius,'#437f9d',.32);edge.position.x=x;}
        const meridian=profile.map(p=>new THREE.Vector3(-p.y,p.x,0));
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(meridian),new THREE.LineBasicMaterial({color:'#629bb3',transparent:true,opacity:.5})));
      }
    }
  }else if(e.kind==='mirror'||e.kind==='splitter'||e.kind==='polarizing-splitter'){
    disk(radius,rendered?3:1.5,e.kind==='mirror'?'#94adc4':'#b497e8',e.kind!=='mirror');ring(radius,rendered?'#52657c':e.kind==='mirror'?'#6b869f':'#9c77cf');
    if(e.kind==='polarizing-splitter'){group.add(new THREE.ArrowHelper(new THREE.Vector3(1,0,0),new THREE.Vector3(3,0,0),radius*.8,0x409f93,4,2));group.add(new THREE.ArrowHelper(new THREE.Vector3(0,0,1),new THREE.Vector3(3,0,0),radius*.8,0xb497e8,4,2));}
    if(rendered&&e.kind==='mirror'){const back=disk(radius+2,2,'#465970');back.position.x=2.5;}
  }else if(e.kind.endsWith('prism')){
    const points=prismVertices(e),positions:number[]=[],indices:number[]=[];
    for(const y of [-e.prismHeightMm/2,e.prismHeightMm/2])for(const [x,z] of points)positions.push(x,y,z);
    indices.push(0,2,1,3,4,5);for(let i=0;i<3;i++){const j=(i+1)%3;indices.push(i,j,i+3,j,j+3,i+3);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    group.add(new THREE.Mesh(geometry,material('#88c5e9',true)));group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color:'#6294c4'})));
  }else if(e.kind==='amplitude-grating'){
    const w=e.gratingWidthMm,h=e.gratingHeightMm,geometry=new THREE.BoxGeometry(.25,h,w);
    const shape=new THREE.Shape();shape.absarc(0,0,radius,0,Math.PI*2,false);
    const hole=new THREE.Path();hole.moveTo(-w/2,-h/2);hole.lineTo(-w/2,h/2);hole.lineTo(w/2,h/2);hole.lineTo(w/2,-h/2);hole.closePath();shape.holes.push(hole);
    const frameGeometry=new THREE.ShapeGeometry(shape,64),pos=frameGeometry.getAttribute('position');
    for(let i=0;i<pos.count;i++){const u=pos.getX(i),v=pos.getY(i);pos.setXYZ(i,0,-v,u);}frameGeometry.computeVertexNormals();
    group.add(new THREE.Mesh(frameGeometry,material(rendered?'#394b62':'#8291a7')));
    group.add(new THREE.Mesh(geometry,material('#a9dbea',true)));
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color:'#6294c4'})));
    // Symbolic stripe marks only; the diffraction calculation uses the actual period.
    const count=Math.min(24,Math.floor(w/(e.gratingPeriodUm*.001)+1e-9)),duty=e.gratingProfile==='sinusoidal'?1-e.gratingModulation*.5:e.gratingSlitUm/e.gratingPeriodUm;
    for(let i=0;i<count;i++){
      if(duty>=1)break;
      const stripe=new THREE.Mesh(new THREE.BoxGeometry(.28,h,w/count*(1-duty)),material('#52657c'));
      stripe.position.z=-w/2+(i+(1-duty)/2)*w/count;group.add(stripe);
    }
  }else if(e.kind==='slit'){
    const r=Math.max(30,e.slitHeightMm/2+10,e.slitWidthMm/2+10),shape=new THREE.Shape();shape.absarc(0,0,r,0,Math.PI*2,false);
    const hole=new THREE.Path(),w=e.slitWidthMm/2,h=e.slitHeightMm/2;hole.moveTo(-w,-h);hole.lineTo(-w,h);hole.lineTo(w,h);hole.lineTo(w,-h);hole.closePath();shape.holes.push(hole);
    if(e.slitMode==='stop')group.add(new THREE.Mesh(new THREE.BoxGeometry(.25,e.slitHeightMm,e.slitWidthMm),material(rendered?'#394b62':'#8291a7')));
    else{const geometry=new THREE.ShapeGeometry(shape,64),pos=geometry.getAttribute('position');for(let i=0;i<pos.count;i++){const u=pos.getX(i),v=pos.getY(i);pos.setXYZ(i,0,-v,u);}geometry.computeVertexNormals();group.add(new THREE.Mesh(geometry,material(rendered?'#394b62':'#8291a7')));}
    // The real gap may be subpixel. Fine outline marks its position without widening the physical aperture.
    const marks=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(.2,-h,-w),new THREE.Vector3(.2,h,-w),new THREE.Vector3(.2,-h,w),new THREE.Vector3(.2,h,w)]);group.add(new THREE.LineSegments(marks,new THREE.LineBasicMaterial({color:'#dae7f6'})));
  }else if(e.kind==='polarizer'||e.kind==='half-wave-plate'||e.kind==='quarter-wave-plate'){
    disk(radius,2,e.kind==='polarizer'?'#9384bf':e.kind==='half-wave-plate'?'#e6bc74':'#72c7ba',true);ring(radius,rendered?'#52657c':'#9280b7');
    const arrow=new THREE.ArrowHelper(new THREE.Vector3(0,0,1),new THREE.Vector3(2,0,-radius*.65),radius*1.3,0x8067b0,3,2);group.add(arrow);
  }else if(e.kind==='power-meter'){
    const body=new THREE.Mesh(new THREE.BoxGeometry(10,e.diameterMm+8,e.diameterMm+8),material(rendered?'#3b4d64':'#5b83b4'));body.position.x=6;group.add(body);const surface=disk(radius,1.2,'#22374f');surface.position.x=-.7;
  }else if(e.kind==='screen'){
    disk(radius,2,'#f8fafc');ring(radius,rendered?'#536780':'#879bb4',1.3);
    const crossGeometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.2,-radius,0),new THREE.Vector3(-1.2,radius,0),new THREE.Vector3(-1.2,0,-radius),new THREE.Vector3(-1.2,0,radius)]);
    group.add(new THREE.LineSegments(crossGeometry,new THREE.LineBasicMaterial({color:'#cad5e1',transparent:true,opacity:.6})));
  }else if(e.kind==='aperture'){
    const aperture=new THREE.Mesh(new THREE.RingGeometry(radius,Math.max(30,radius+10),64),material(rendered?'#3e4f65':'#8091a8'));aperture.rotation.y=Math.PI/2;group.add(aperture);ring(radius,'#bac5d4',.7);
  }else{disk(radius,2,'#638a96',true);ring(radius,rendered?'#4b5b70':'#608997');}
  if(isPhysicalLens(e.kind)){
    const cylinder=isSolidCylinder(e.kind),a=(cylinder?e.clearWidthMm:e.clearApertureMm)/2,h=e.clearHeightMm/2;
    if(cylinder?(a<e.cylinderWidthMm/2||h<e.cylinderHeightMm/2):a<radius){
      for(const face of [0,1]){
        const points:THREE.Vector3[]=[];
        if(cylinder){for(let i=0;i<=32;i++){const u=-a+2*a*i/32;points.push(new THREE.Vector3(physicalLensSurfaces(e,Math.abs(u))[face]+(face? .04:-.04),h,u));}for(let i=32;i>=0;i--){const u=-a+2*a*i/32;points.push(new THREE.Vector3(physicalLensSurfaces(e,Math.abs(u))[face]+(face? .04:-.04),-h,u));}}
        else {const x=physicalLensSurfaces(e,a)[face]+(face? .04:-.04);for(let i=0;i<=64;i++){const angle=2*Math.PI*i/64;points.push(new THREE.Vector3(x,a*Math.cos(angle),a*Math.sin(angle)));}}
        group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:'#339e87'})));
      }
    }
  }
  if(rendered){const selectedRing=ring(Math.max(radius+5,e.kind==='laser'?19:0),'#3b82f6',1.7);selectedRing.name='selection';selectedRing.visible=false;}
  else{
    const extent=e.kind==='object'?Math.max(4,e.objectWidthMm/2,e.objectHeightMm):e.kind==='eye'?10:radius;
    group.userData.labelRadius=extent;
    const r=Math.max(7,extent+4),arm=Math.min(6,r*.3),points:THREE.Vector3[]=[];
    for(const y of [-1,1])for(const z of [-1,1])points.push(new THREE.Vector3(0,y*(r-arm),z*r),new THREE.Vector3(0,y*r,z*r),new THREE.Vector3(0,y*r,z*r),new THREE.Vector3(0,y*r,z*(r-arm)));
    const selection=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:'#2563eb',depthTest:false,toneMapped:false}));
    selection.name='selection';selection.visible=false;selection.renderOrder=4;selection.raycast=()=>{};group.add(selection);
  }
  return group;
}
export function benchFloorHeight(devices:THREE.Object3D){
  const bounds=new THREE.Box3().setFromObject(devices);
  return bounds.isEmpty()?0:Math.min(0,Math.floor((bounds.min.y-10)/10)*10);
}

export function createSpatialSupport(e:SpatialElement,floorY=0){
  const group=new THREE.Group(),n=new THREE.Vector3(1,0,0).applyQuaternion(orientation(e));
  const down=new THREE.Vector3(0,-1,0).addScaledVector(n,n.y);
  const horizontal=down.length()<.01;
  const radius=isSolidCylinder(e.kind)?e.cylinderHeightMm/2:e.kind==='laser'?11:e.kind==='aperture'?Math.max(30,e.diameterMm/2+10):e.kind==='amplitude-grating'?gratingMountRadius(e):e.kind==='slit'?Math.max(30,e.slitHeightMm/2+10):e.kind.endsWith('prism')?e.prismHeightMm/2:e.diameterMm/2;
  const offset=horizontal?new THREE.Vector3(0,0,radius+10):down.normalize().multiplyScalar(radius+2);
  const holder=imagingHolder(e),rotation=orientation(e);
  let anchor=world(e.position).add(offset);
  if(holder){
    const localDown=new THREE.Vector3(0,-1,0).applyQuaternion(rotation.clone().invert());
    const y=Math.abs(localDown.y)<1e-6?0:Math.sign(localDown.y)*holder.height/2;
    const z=Math.abs(localDown.z)<1e-6?0:Math.sign(localDown.z)*holder.width/2;
    const edge=new THREE.Vector3(0,y||(!z?-holder.height/2:0),z);
    anchor=edge.add(holder.center).applyQuaternion(rotation).add(world(e.position));
  }
  if(e.kind==='laser')anchor.addScaledVector(n,-19);
  const postTop=anchor.clone();
  // Move the specimen base away from the nearby objective, with a connected arm.
  if(e.kind==='object')postTop.addScaledVector(new THREE.Vector3(n.x,0,n.z).normalize(),-26);
  const height=Math.max(0,postTop.y-floorY-5);
  const {dark:metal,steel,rubber,teal}=instrumentMaterials();
  const baseWidth=holder?26:36,baseDepth=holder?28:32;
  const base=new THREE.Mesh(instrumentBlock(baseWidth,5,baseDepth,1),metal);base.name='base';base.position.set(postTop.x,floorY+2.5,postTop.z);group.add(base);
  const foot=new THREE.Mesh(instrumentBlock(baseWidth-3,.8,baseDepth-3,.2),rubber);foot.position.set(postTop.x,floorY+.35,postTop.z);group.add(foot);
  for(const sign of [-1,1]){const screw=instrumentScrew(1.2);screw.position.set(postTop.x+sign*(baseWidth/2-5),floorY+5.25,postTop.z);group.add(screw);}
  const badge=new THREE.Mesh(instrumentBlock(7,.7,1,.2),teal);badge.position.set(postTop.x,floorY+4.7,postTop.z+baseDepth/2-.5);group.add(badge);
  const rod=(start:THREE.Vector3,end:THREE.Vector3,r:number,mat:THREE.Material,name:string)=>{
    const delta=end.clone().sub(start);if(delta.length()<1e-6)return;
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,delta.length(),24),mat);mesh.name=name;mesh.position.copy(start).lerp(end,.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());group.add(mesh);
  };
  if(height>0){
    rod(new THREE.Vector3(postTop.x,floorY+5,postTop.z),postTop,1.9,steel,'post');
    rod(new THREE.Vector3(postTop.x,floorY+5,postTop.z),new THREE.Vector3(postTop.x,floorY+5+height*.52,postTop.z),3.1,metal,'post-sleeve');
    rod(new THREE.Vector3(postTop.x,floorY+5+height*.52,postTop.z),new THREE.Vector3(postTop.x,floorY+6+height*.52,postTop.z),3.3,steel,'post-collar');
    const knob=new THREE.Mesh(new THREE.CylinderGeometry(2.2,2.2,4,20),metal);knob.rotation.x=Math.PI/2;knob.position.set(postTop.x,floorY+5+height*.43,postTop.z+4);group.add(knob);
  }
  rod(postTop,anchor,1.8,metal,'holder-arm');
  const contact=new THREE.Mesh(new THREE.SphereGeometry(holder?1.2:2,16,10),metal);contact.name='holder-contact';contact.position.copy(anchor);group.add(contact);
  if(horizontal&&!holder){const arm=new THREE.Mesh(new THREE.BoxGeometry(8,4,14),metal);arm.position.set(anchor.x,anchor.y,anchor.z-5);group.add(arm);}
  return group;
}

export default function SpatialBench(props:Props){
  const host=useRef<HTMLDivElement>(null),state=useRef<State|null>(null),latest=useRef(props);latest.current=props;
  const directionWidget=useRef<SVGSVGElement>(null),axisLabels=useRef<HTMLDivElement>(null);
  const componentLabels=useRef<HTMLDivElement>(null);
  const objects=props.experiment.elements.filter(e=>e.kind==='object');
  const previewObject=objects.find(e=>e.id===props.selectedId)??objects[0];
  const microscopeCopy=props.experiment.presentation?.kind==='microscope'||props.experiment.name.startsWith('显微镜成像 · 器件副本');
  const observerKind=microscopeCopy?props.experiment.elements.find(e=>e.kind==='eye'||e.kind==='sensor')?.kind:undefined;
  const [ready,setReady]=useState(false),[failed,setFailed]=useState(false);
  const cutaway=props.rendered?microscopeLayout(props.experiment):null;
  const cameraBody=props.rendered?cameraLayout(props.experiment):null;
  const cameraCasing=useRef<{id:string;plane:THREE.Vector3}|null>(null);
  const telescope=props.rendered?telescopeLayout(props.experiment):null;
  const buildPose=useRef<{position:THREE.Vector3;target:THREE.Vector3;up:THREE.Vector3}|null>(null),lastRendered=useRef(false);
  useEffect(()=>{
    const container=host.current!;let renderer:THREE.WebGLRenderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true});}catch{setFailed(true);return;}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor('#f6f8fb');
    renderer.domElement.setAttribute('aria-label','三维光路画布：点击选择器件，左键拖动旋转视角，右键拖动平移，滚轮围绕鼠标位置缩放');renderer.domElement.setAttribute('role','img');container.appendChild(renderer.domElement);
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,1,20000);camera.position.set(600,460,680);
    const orbit=new OrbitControls(camera,renderer.domElement);orbit.target.set(0,80,0);orbit.enableDamping=true;orbit.minDistance=120;orbit.maxDistance=15000;
    // Both construction and rendered views zoom along the pointer ray, rather
    // than pulling every wheel gesture towards the apparatus centre.
    orbit.zoomToCursor=true;orbit.screenSpacePanning=true;
    scene.add(new THREE.HemisphereLight('#ffffff','#cbd5e1',2.5));const light=new THREE.DirectionalLight('#ffffff',3);light.name='key-light';light.position.set(200,600,350);light.castShadow=true;light.shadow.mapSize.set(2048,2048);light.shadow.bias=-.0003;light.shadow.normalBias=.15;light.shadow.radius=3;scene.add(light,light.target);
    const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer),environmentTarget=pmrem.fromScene(room,.025),environment=environmentTarget.texture;room.dispose();pmrem.dispose();
    const fill=new THREE.DirectionalLight('#c7dcec',.75);fill.name='microscope-fill';fill.position.set(-350,250,100);fill.visible=false;scene.add(fill,fill.target);
    const rim=new THREE.DirectionalLight('#fff1dc',1.1);rim.name='instrument-rim';rim.visible=false;scene.add(rim,rim.target);
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    const grid=createInfiniteGrid();scene.add(grid);
    // Upward-facing floor only: retain shadows above, leave underside views unobstructed.
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(820,580).rotateX(-Math.PI/2),new THREE.MeshStandardMaterial({color:'#e5ebf2',roughness:.8,side:THREE.FrontSide}));floor.receiveShadow=true;scene.add(floor);
    const devices=new THREE.Group(),supports=new THREE.Group(),rays=new THREE.Group(),guides=new THREE.Group(),rig=new THREE.Group(),housing=new THREE.Group();rig.add(devices,supports,rays,guides);scene.add(rig,housing);
    const transform=new TransformControls(camera,renderer.domElement);transform.setSize(.8);transform.setTranslationSnap(1);transform.setRotationSnap(Math.PI/180);scene.add(transform.getHelper());
    const resize=()=>{const rect=container.getBoundingClientRect();renderer.setSize(Math.max(rect.width,1),Math.max(rect.height,1));camera.aspect=Math.max(rect.width,1)/Math.max(rect.height,1);camera.zoom=THREE.MathUtils.clamp(camera.aspect*.8,.6,1.65);camera.updateProjectionMatrix();rays.traverse(child=>{if(child instanceof Line2)child.material.resolution.set(Math.max(rect.width,1),Math.max(rect.height,1));});};
    const observer=new ResizeObserver(resize);observer.observe(container);resize();
    const focus=installMicroscopeControls(renderer.domElement,camera,housing,orbit,()=>latest.current);
    state.current={scene,camera,renderer,orbit,transform,devices,supports,rays,guides,rig,housing,grid,floor,resize,environment,focus};
    let cancelling=false,gizmoUsed=false;
    transform.addEventListener('dragging-changed',event=>{if(event.value)gizmoUsed=true;orbit.enabled=!event.value;latest.current.onEditing(!!event.value);});
    const pose=()=>{
      const object=transform.object;if(!object)return;
      const p=object.position,d=new THREE.Vector3(1,0,0).applyQuaternion(object.quaternion).normalize();
      const position:[number,number,number]=[p.x,p.y,p.z].map(v=>Math.round(THREE.MathUtils.clamp(v,-1000,1000)*10)/10) as [number,number,number];
      const patch={position,yawDeg:Math.round(THREE.MathUtils.radToDeg(Math.atan2(d.z,d.x))*10)/10,pitchDeg:Math.round(THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(d.y,-1,1)))*10)/10};
      const basis=geometryFrame({...patch,rollDeg:0}),actualU=new THREE.Vector3(0,0,1).applyQuaternion(object.quaternion);
      Object.assign(patch,{rollDeg:Math.round(THREE.MathUtils.radToDeg(Math.atan2(actualU.dot(new THREE.Vector3(...basis.v)),actualU.dot(new THREE.Vector3(...basis.u))))*10)/10});
      return latest.current.snapEnabled?snapPose(latest.current.experiment,object.userData.elementId,patch,latest.current.tool,latest.current.axes):patch;
    };
    transform.addEventListener('objectChange',()=>{
      if(cancelling||!transform.dragging||!latest.current.snapEnabled)return;
      const patch=pose(),object=transform.object;if(!patch||!object)return;
      if(patch.position)object.position.copy(world(patch.position));
      if(patch.yawDeg!==undefined&&patch.pitchDeg!==undefined)object.quaternion.copy(orientation(patch as SpatialElement));
    });
    transform.addEventListener('mouseUp',()=>{
      const object=transform.object,patch=pose();if(!object||!patch)return;
      latest.current.onTransform(object.userData.elementId,patch);
    });
    const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let start=[0,0];
    const down=(event:PointerEvent)=>{start=[event.clientX,event.clientY];gizmoUsed=false;};
    const up=(event:PointerEvent)=>{
      if(event.button!==0||gizmoUsed||Math.hypot(event.clientX-start[0],event.clientY-start[1])>4||transform.axis||transform.dragging)return;
      const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);
      const hit=raycaster.intersectObjects(devices.children,true).find(entry=>entry.object.name!=='selection');let object:THREE.Object3D|null=hit?.object??null;
      while(object&&!object.userData.elementId)object=object.parent;latest.current.onSelect(object?.userData.elementId??null);
    };
    const cancel=()=>{cancelling=true;if(transform.dragging)transform.reset();transform.dragging=false;transform.axis=null;cancelling=false;latest.current.onEditing(false);orbit.enabled=true;};
    renderer.domElement.addEventListener('pointerdown',down,true);renderer.domElement.addEventListener('pointerup',up);renderer.domElement.addEventListener('pointercancel',cancel);
    const directions=[new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1)],projected=new THREE.Vector3(),inverseCamera=new THREE.Quaternion(),eye=new THREE.Vector3(),labelCenter=new THREE.Vector3(),labelTop=new THREE.Vector3();
    const widgetAxes=Array.from(directionWidget.current?.querySelectorAll<SVGGElement>('g[data-axis]')??[]),labels=Array.from(axisLabels.current?.children??[]) as HTMLElement[];
    renderer.setAnimationLoop(()=>{
      if(latest.current.visible===false)return;
      orbit.update();renderer.render(scene,camera);inverseCamera.copy(camera.quaternion).invert();
      if(!latest.current.rendered&&componentLabels.current){
        const width=container.clientWidth,height=container.clientHeight,occupied:{x:number;y:number;w:number}[]=[];
        const anchors=new Map<string,{x:number;y:number;top:number;bottom:number;z:number}>();
        for(const object of devices.children){
          object.getWorldPosition(labelCenter);labelTop.copy(labelCenter).add(new THREE.Vector3(0,object.userData.labelRadius??15,0)).project(camera);labelCenter.project(camera);
          const x=(labelCenter.x+1)*width/2,y=(1-labelCenter.y)*height/2,r=Math.max(10,Math.abs(y-(1-labelTop.y)*height/2));
          anchors.set(object.userData.elementId,{x,y,top:y-r,bottom:y+r,z:labelCenter.z});
        }
        const buttons=Array.from(componentLabels.current.children) as HTMLButtonElement[];
        // Place the selected label first, then stack overlapping labels without altering optical coordinates.
        buttons.sort((a,b)=>Number(b.dataset.element===latest.current.selectedId)-Number(a.dataset.element===latest.current.selectedId));
        for(const label of buttons){
          const anchor=anchors.get(label.dataset.element!);
          if(!anchor){label.style.visibility='hidden';continue;}
          const {x,y:anchorY}=anchor,below=label.dataset.below==='true';
          // Tiny samples/observers use a lower label lane so names never cover neighboring glass.
          const neighbors=[...anchors.values()].filter(p=>Math.abs(p.x-x)<100&&Math.abs(p.y-anchorY)<140);
          let y=below?Math.max(...neighbors.map(p=>p.bottom))+16:anchor.top-38;
          const w=label.offsetWidth||110;
          if(anchor.z<-1||anchor.z>1||x<w/2+12||x>width-w/2-12||anchorY<60||anchorY>height-25){label.style.visibility='hidden';continue;}
          for(let attempt=0;attempt<5&&occupied.some(p=>Math.abs(x-p.x)<(w+p.w)/2+10&&Math.abs(y-p.y)<38);attempt++)y+=below?38:-38;
          if(y<58||y>height-72){label.style.visibility='hidden';continue;}
          occupied.push({x,y,w});label.style.visibility='visible';label.style.left=x+'px';label.style.top=y+'px';
          label.style.setProperty('--leader-height',Math.max(12,below?y-anchorY:anchorY-y-32)+'px');
        }
      }
      directions.forEach((direction,index)=>{
        projected.copy(direction).applyQuaternion(inverseCamera);const x=54+projected.x*33,y=49-projected.y*33,group=widgetAxes[index];
        const line=group?.querySelector('line'),text=group?.querySelector('text'),dot=group?.querySelector('circle');
        line?.setAttribute('x2',String(x));line?.setAttribute('y2',String(y));
        const facing=Math.hypot(projected.x,projected.y)<.15;
        text?.setAttribute('x',String(facing?x+10:54+projected.x*44));text?.setAttribute('y',String(facing?y-9:49-projected.y*44));
        dot?.setAttribute('cx',String(x));dot?.setAttribute('cy',String(y));dot?.setAttribute('visibility',facing?'visible':'hidden');
        group?.setAttribute('opacity',projected.z>0?'1':'.75');
        const object=transform.object,label=labels[index];if(!label)return;
        const visible=object&&!latest.current.rendered&&latest.current.tool==='translate'&&[transform.showX,transform.showY,transform.showZ][index];
        if(!visible){label.style.display='none';return;}
        eye.copy(camera.position).sub(object.position).normalize();if(Math.abs(direction.dot(eye))>.99){label.style.display='none';return;}
        const scale=object.position.distanceTo(camera.position)*Math.min(1.9*Math.tan(Math.PI*camera.fov/360)/camera.zoom,7)*transform.size/4;
        // Translation arrows end at 0.6 of the control scale; place the label just beyond them.
        projected.copy(object.position).addScaledVector(direction,scale*.75).project(camera);
        const width=container.clientWidth,height=container.clientHeight,xPx=(projected.x+1)*width/2,yPx=(1-projected.y)*height/2;
        label.style.display=projected.z>-1&&projected.z<1&&xPx>12&&xPx<width-12&&yPx>12&&yPx<height-12?'block':'none';
        label.style.left=xPx+'px';label.style.top=yPx+'px';
      });
    });setReady(true);
    return ()=>{focus.dispose();state.current=null;observer.disconnect();renderer.setAnimationLoop(null);renderer.domElement.removeEventListener('pointerdown',down,true);renderer.domElement.removeEventListener('pointerup',up);renderer.domElement.removeEventListener('pointercancel',cancel);transform.dispose();orbit.dispose();dispose(scene);environmentTarget.dispose();renderer.dispose();renderer.domElement.remove();};
  },[]);
  useEffect(()=>{if(!props.rendered||props.visible===false)state.current?.focus.cancel();},[props.rendered,props.visible]);
  useEffect(()=>{
    const s=state.current;if(!s)return;s.transform.detach();clear(s.devices);clear(s.supports);clear(s.housing);
    const layout=props.rendered?microscopeLayout(props.experiment):null;
    const telescope=props.rendered?telescopeLayout(props.experiment):null;
    const cameraBody=props.rendered?cameraLayout(props.experiment):null;
    if(!layout)s.scene.fog=null;
    s.scene.environment=s.environment;s.scene.environmentIntensity=props.rendered?.75:.65;
    s.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    s.renderer.toneMappingExposure=props.rendered?1:1.1;
    s.renderer.setClearColor(props.rendered?'#edf2f6':'#f6f8fb');
    (s.scene.children.find(c=>c instanceof THREE.HemisphereLight) as THREE.HemisphereLight).intensity=props.rendered?.6:1.25;
    (s.scene.getObjectByName('key-light') as THREE.DirectionalLight).intensity=props.rendered?2.4:2.6;
    s.scene.getObjectByName('microscope-fill')!.visible=props.rendered;
    s.scene.getObjectByName('instrument-rim')!.visible=props.rendered;
    (s.floor.material as THREE.MeshStandardMaterial).color.set('#dfe7ee');
    s.rig.position.set(0,0,0);s.rig.quaternion.identity();
    for(const element of props.experiment.elements){if(layout&&element.kind==='eye')continue;s.devices.add(createSpatialOptic(element,props.rendered));}
    if(layout){s.rig.position.copy(layout.position);s.rig.quaternion.copy(layout.rotation);s.housing.add(createMicroscopeHousing(layout));}
    if(telescope)s.housing.add(createTelescopeHousing(telescope));
    if(cameraBody){
      const id=[cameraBody.object.id,cameraBody.lens.id,cameraBody.sensor.id].join(':');
      if(cameraCasing.current?.id!==id)cameraCasing.current={id,plane:world(cameraBody.sensor.position)};
      const axis=new THREE.Vector3(1,0,0).applyQuaternion(cameraBody.rotation),bodyDistance=cameraCasing.current.plane.clone().sub(world(cameraBody.lens.position)).dot(axis);
      s.housing.add(createCameraHousing(cameraBody,bodyDistance));
    }
    s.rig.updateMatrixWorld(true);s.housing.updateMatrixWorld(true);
    const floorY=layout?Math.min(0,new THREE.Box3().setFromObject(s.housing).min.y):cameraBody?new THREE.Box3().setFromObject(s.housing).min.y:benchFloorHeight(s.devices);s.grid.position.y=floorY+.03;s.floor.position.y=floorY;
    if(props.rendered&&!layout)for(const element of props.experiment.elements)if((!telescope&&!cameraBody)||element.kind==='object')s.supports.add(createSpatialSupport(element,floorY));
    for(const root of [s.devices,s.supports,s.housing])root.traverse(child=>{
      if(child instanceof THREE.Mesh){child.castShadow=!(child.material instanceof THREE.Material&&child.material.transparent);child.receiveShadow=child.name!=='cutaway-shell';}
    });
    s.renderer.shadowMap.enabled=props.rendered;
    const bounds=new THREE.Box3().setFromObject(s.devices).union(new THREE.Box3().setFromObject(s.supports)).union(new THREE.Box3().setFromObject(s.housing));
    if(!bounds.isEmpty()){
      const lightingBounds=(layout||telescope||cameraBody)?new THREE.Box3().setFromObject(s.housing):bounds;
      const center=lightingBounds.getCenter(new THREE.Vector3()),size=lightingBounds.getSize(new THREE.Vector3()),radius=Math.max(90,size.length()*.65);
      s.floor.position.x=center.x;s.floor.position.z=center.z;s.floor.scale.set(Math.max(820,size.x+180)/820,1,Math.max(580,size.z+180)/580);
      if(props.rendered)s.floor.scale.set(100,1,100);
      const key=s.scene.getObjectByName('key-light') as THREE.DirectionalLight;
      key.position.copy(center).add((props.rendered?new THREE.Vector3(-.6,1,.8):new THREE.Vector3(.4,1,.6)).normalize().multiplyScalar(radius*2));key.target.position.copy(center);
      const fill=s.scene.getObjectByName('microscope-fill') as THREE.DirectionalLight,rim=s.scene.getObjectByName('instrument-rim') as THREE.DirectionalLight;
      fill.position.copy(center).add(new THREE.Vector3(1,.35,.1).multiplyScalar(radius*2));fill.target.position.copy(center);
      rim.position.copy(center).add(new THREE.Vector3(.4,.9,-1).multiplyScalar(radius*2));rim.target.position.copy(center);
      key.shadow.normalBias=props.rendered?.08:.15;key.shadow.bias=-.00015;
      Object.assign(key.shadow.camera,{left:-radius,right:radius,top:radius,bottom:-radius,near:1,far:radius*4});key.shadow.camera.updateProjectionMatrix();
    }
    s.grid.material.uniforms.strength.value=props.rendered?.045:.3;
    s.floor.visible=props.rendered;s.grid.visible=props.showGrid;
  },[props.experiment,props.rendered,props.showGrid,ready]);
  useEffect(()=>{
    const s=state.current;if(!s)return;
    const object=s.devices.children.find(child=>child.userData.elementId===props.selectedId);
    for(const child of s.devices.children){const selection=child.getObjectByName('selection');if(selection)selection.visible=!props.rendered&&child===object;}
    if(object&&!props.rendered){s.transform.attach(object);s.transform.setMode(props.tool);s.transform.showX=props.tool==='translate';s.transform.showY=true;s.transform.showZ=true;}else s.transform.detach();
  },[props.selectedId,props.experiment,props.rendered,props.tool,props.showGrid,ready]);
  useEffect(()=>{
    const s=state.current;if(!s)return;clear(s.guides);if(!props.showAxes||props.rendered)return;
    for(const axis of props.axes){
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([world(axis.start),world(axis.end)]),new THREE.LineDashedMaterial({color:'#689cec',dashSize:7,gapSize:5,transparent:true,opacity:.65,depthTest:false}));
      line.computeLineDistances();line.renderOrder=3;s.guides.add(line);
    }
    const selected=props.experiment.elements.find(e=>e.id===props.selectedId),nearest=selected&&closestAxis(selected.position,props.axes);
    if(nearest&&nearest.distance>.1){
      const connector=new THREE.Line(new THREE.BufferGeometry().setFromPoints([world(selected!.position),world(nearest.position)]),new THREE.LineDashedMaterial({color:'#d9a44b',dashSize:3,gapSize:2,depthTest:false}));connector.computeLineDistances();s.guides.add(connector);
    }
  },[props.axes,props.showAxes,props.selectedId,props.experiment,props.rendered,ready]);
  useEffect(()=>{
    const s=state.current;if(!s)return;clear(s.rays);if(!props.result||!props.showBeam)return;
    const layout=props.rendered?microscopeLayout(props.experiment):null;
    for(const imaging of props.result.imaging??[]){
      const source=props.experiment.elements.find(e=>e.id===imaging.objectId);
      if(!source)continue;
      const rayPoints=source.objectMode==='distant'?[0,16]:[0,2];
      const rayColor=imageRayColor;
      // Eye rays continue beyond the eyepiece; limit only their drawn length in the instrument view.
      const segments=layout?imaging.segments.filter(segment=>!segment.dashed).map(segment=>{
        if(layout.camera)return segment;
        const endY=layout.at(segment.end).y,startY=layout.at(segment.start).y,limit=layout.observerY+38;
        if(endY<=limit||endY<=startY)return segment;
        return {...segment,end:world(segment.start).lerp(world(segment.end),Math.max(0,(limit-startY)/(endY-startY))).toArray() as [number,number,number]};
      }):imaging.segments;
      const visibleRays=new Set(segments);
      const chiefRays=new Set<typeof segments[number]>();
      for(const section of raySections(segments,geometryFrame(source).n,rayPoints)){
        chiefRays.add(section[0]);
        if(props.rendered)s.rays.add(imagingBeam(section,rayColor(section[0].point),true));
        for(const i of props.rendered?[1,2,3,4]:[1,2])visibleRays.delete(section[i]);
      }
      for(const segment of segments){
        if(!rayPoints.includes(segment.point))continue;
        if(!segment.dashed&&!visibleRays.has(segment))continue;
        const chief=chiefRays.has(segment);
        const material=new LineMaterial({color:rayColor(segment.point),linewidth:segment.dashed?1:telescope?1.4:props.rendered?.85:chief?2:1.15,transparent:true,opacity:segment.dashed?.3:telescope?.85:props.rendered?.48:chief?.9:.46,depthWrite:false,dashed:segment.dashed,dashSize:3,gapSize:2,toneMapped:props.rendered});
        material.resolution.copy(s.renderer.getSize(new THREE.Vector2()));
        const line=new Line2(new LineGeometry().setPositions([...segment.start,...segment.end]),material);line.computeLineDistances();s.rays.add(line);
      }
      const view=imageView(props.experiment,imaging);
      if(view&&view.kind!=='eye'){
        const detector=props.experiment.elements.find(e=>e.id===view.elementId)!;
        const relay=detector.kind==='sensor'?detector.adapterMagnification:1;
        const {n,u,v}=geometryFrame(detector),texture=new THREE.CanvasTexture(imageCanvas(view));texture.colorSpace=THREE.SRGBColorSpace;
        const rotation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(world(u),world(v).negate(),world(n).negate()));
        const geometry=detector.kind==='screen'?new THREE.CircleGeometry(view.width/2,64):new THREE.PlaneGeometry(view.width/relay,view.height/relay);
        for(const side of [-1,1]){
          // Draw only the outward face. Bias its depth ahead of the solid detector
          // so distant/oblique views cannot alternate between the image and screen.
          const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:texture,side:side<0?THREE.FrontSide:THREE.BackSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4}));
          mesh.renderOrder=1;
          mesh.quaternion.copy(rotation);mesh.position.copy(world(detector.position)).addScaledVector(world(n),side*(detector.kind==='screen'?1.5:.8));s.rays.add(mesh);
        }
      }
      for(const stage of imaging.stages){
        if(layout)continue;
        if(view?.focused&&view.kind!=='eye'&&stage===imaging.stages.at(-1))continue;
        if(!stage.visible||!stage.position||stage.paths.some(path=>path.some(p=>p.some(x=>Math.abs(x)>2000))))continue;
        for(const path of stage.paths){
          const material=stage.kind==='virtual'?new THREE.LineDashedMaterial({color:'#ac67b5',dashSize:2,gapSize:1}):new THREE.LineBasicMaterial({color:'#ac67b5'});
          const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(path.map(world)),material);line.computeLineDistances();s.rays.add(line);
        }
      }
    }
    let directionMarks=0;
    for(const segment of props.result.segments){
      const source=props.experiment.elements.find(e=>e.id===segment.sourceId),color=wavelengthColor(source?.wavelengthNm??532);
      if(source?.beamModel==='gaussian'&&!segment.chief)continue;
      if(segment.powerMw<=0)continue;
      const start=world(segment.start),end=world(segment.end);
      const branchPower=segment.powerMw*(source?.rayCount??1),brightness=Math.sqrt(branchPower/(branchPower+10));
      // Screen-space widths stay readable when zooming out and on high-DPI displays.
      const material=new LineMaterial({color,linewidth:segment.chief?2.5:1.4,transparent:true,opacity:segment.chief?.8+.18*brightness:.36+.25*brightness,depthWrite:false});
      material.resolution.copy(s.renderer.getSize(new THREE.Vector2()));
      s.rays.add(new Line2(new LineGeometry().setPositions([...start.toArray(),...end.toArray()]),material));
      if(segment.chief&&directionMarks<6&&start.distanceTo(end)>70){
        const direction=end.clone().sub(start).normalize(),length=Math.min(7,start.distanceTo(end)*.06);
        const arrow=new THREE.ArrowHelper(direction,start.clone().lerp(end,.58),length,color,length,length*.65);
        arrow.line.visible=false;s.rays.add(arrow);directionMarks++;
      }
      if(segment.chief&&props.rendered&&start.distanceTo(end)>.001){
        const curve=new THREE.LineCurve3(start,end);
        s.rays.add(new THREE.Mesh(new THREE.TubeGeometry(curve,1,.6,8,false),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.85*brightness})));
        s.rays.add(new THREE.Mesh(new THREE.TubeGeometry(curve,1,2.4,8,false),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.07*brightness,depthWrite:false})));
      }
      if(segment.hitId&&props.experiment.elements.find(e=>e.id===segment.hitId)?.kind==='screen'){
        const hitElement=props.experiment.elements.find(e=>e.id===segment.hitId)!;
        for(const side of [-1,1]){const spot=new THREE.Mesh(new THREE.CircleGeometry(segment.chief?1.4:.8,16),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,opacity:.85*brightness}));spot.quaternion.copy(orientation(hitElement)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2));const n=new THREE.Vector3(1,0,0).applyQuaternion(orientation(hitElement));spot.position.copy(end).addScaledVector(n,side*1.3);s.rays.add(spot);}
      }
    }
    for(const beam of props.result.beams){
      const start=world(beam.start),end=world(beam.end),direction=end.clone().sub(start).normalize();
      const u=new THREE.Vector3().crossVectors(direction,Math.abs(direction.y)<.9?new THREE.Vector3(0,1,0):new THREE.Vector3(0,0,1)).normalize(),v=new THREE.Vector3().crossVectors(direction,u);
      const vertices:number[]=[],indices:number[]=[],sides=20;
      for(let row=0;row<beam.radiiMm.length;row++)for(let side=0;side<sides;side++){
        const angle=side/sides*Math.PI*2,point=start.clone().lerp(end,row/(beam.radiiMm.length-1)).addScaledVector(u,Math.cos(angle)*beam.radiiMm[row]).addScaledVector(v,Math.sin(angle)*beam.radiiMm[row]);
        vertices.push(point.x,point.y,point.z);
        if(row<beam.radiiMm.length-1){const a=row*sides+side,b=row*sides+(side+1)%sides;indices.push(a,a+sides,b,b,a+sides,b+sides);}
      }
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);
      const source=props.experiment.elements.find(e=>e.id===beam.sourceId),color=wavelengthColor(source?.wavelengthNm??532);
      const brightness=Math.sqrt(beam.powerMw/(beam.powerMw+10));
      s.rays.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,transparent:true,opacity:(props.rendered?.2:.15)*brightness,side:THREE.DoubleSide,depthWrite:false})));
    }
    if(props.result.fourF||props.result.fourier){
      const wave=(props.result.fourF??props.result.fourier)!,screen=props.experiment.elements.find(e=>e.id===wave.screenId)!,grating=props.experiment.elements.find(e=>e.id===wave.gratingId)!,{n}=geometryFrame(screen),{u,v}=geometryFrame(grating),extent=wave.points.at(-1)!.xMm;
      const texture=new THREE.CanvasTexture(fourFOutputCanvas(wave,screen.diameterMm/2));texture.colorSpace=THREE.SRGBColorSpace;
      const geometry=new THREE.PlaneGeometry(extent*2,extent*2),material=new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,transparent:true,depthWrite:false}),rotation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...u),new THREE.Vector3(...v),new THREE.Vector3(...n)));
      for(const side of [-1,1]){const mesh=new THREE.Mesh(geometry,material);mesh.quaternion.copy(rotation);mesh.position.copy(world(screen.position)).addScaledVector(new THREE.Vector3(...n),side*1.6);s.rays.add(mesh);}
    }
    for(const profile of props.result.diffraction??[]){
      const screen=props.experiment.elements.find(e=>e.id===profile.screenId);if(!screen)continue;
      const source=props.experiment.elements.find(e=>e.id===profile.sourceId),color=new THREE.Color(wavelengthColor(source?.wavelengthNm??532));
      const {n}=geometryFrame(screen),axis=new THREE.Vector3(...profile.axis),normal=new THREE.Vector3(...n),vertical=new THREE.Vector3().crossVectors(normal,axis).normalize(),centre=world(profile.center),radius=screen.diameterMm/2,screenCentre=world(screen.position);
      const facing=new THREE.Vector3(...profile.center).sub(new THREE.Vector3(...(props.experiment.elements.find(e=>e.id===('gratingId' in profile?profile.gratingId:profile.slitId))?.position??profile.center))).dot(normal)>=0?-1:1;
      const peak=Math.max(1,...profile.points.map(p=>p.intensity)),geometry=new THREE.BufferGeometry(),vertices:number[]=[],colors:number[]=[];
      for(let i=0;i<profile.points.length-1;i++){
        const a=profile.points[i],b=profile.points[i+1],atA=centre.clone().addScaledVector(axis,a.xMm),atB=centre.clone().addScaledVector(axis,b.xMm),half=Math.min(5,radius*.2,Math.sqrt(Math.max(0,radius*radius-atA.distanceToSquared(screenCentre))),Math.sqrt(Math.max(0,radius*radius-atB.distanceToSquared(screenCentre))));
        const positions=[atA.clone().addScaledVector(vertical,-half),atB.clone().addScaledVector(vertical,-half),atB.clone().addScaledVector(vertical,half),atA.clone().addScaledVector(vertical,half)];
        const intensity=(a.intensity+b.intensity)/2;
        for(const j of [0,1,2,0,2,3]){const p=positions[j].clone().addScaledVector(normal,facing*1.5);vertices.push(p.x,p.y,p.z);colors.push(color.r,color.g,color.b,Math.sqrt(intensity/peak)*.95);}
      }
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,4));
      const stripeMaterial=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,side:THREE.DoubleSide,depthWrite:false});s.rays.add(new THREE.Mesh(geometry,stripeMaterial));
      const back=new THREE.Mesh(geometry.clone(),stripeMaterial.clone());back.position.addScaledVector(normal,-3*facing);s.rays.add(back);
    }
  },[props.result,props.rendered,props.showBeam,props.experiment,ready]);
  useEffect(()=>{
    const s=state.current;if(!s)return;s.resize();
    if(props.rendered&&!lastRendered.current)buildPose.current={position:s.camera.position.clone(),target:s.orbit.target.clone(),up:s.camera.up.clone()};
    if(!props.rendered&&lastRendered.current&&buildPose.current){
      lastRendered.current=false;s.camera.position.copy(buildPose.current.position);s.camera.up.copy(buildPose.current.up);s.orbit.target.copy(buildPose.current.target);s.orbit.enableRotate=props.view==='perspective';s.orbit.update();return;
    }
    lastRendered.current=props.rendered;
    s.camera.up.set(0,1,0);
    const layout=props.rendered?microscopeLayout(props.experiment):null;
    const box=cameraBody?new THREE.Box3().setFromObject(s.housing).expandByPoint(world(cameraBody.lens.position).add(new THREE.Vector3(-35,0,0).applyQuaternion(cameraBody.rotation))):telescope?new THREE.Box3().setFromObject(s.housing).expandByPoint(world(telescope.eye.position)).expandByPoint(world(telescope.objective.position).addScaledVector(world(telescope.axis),-60)):new THREE.Box3().setFromObject(s.devices).union(new THREE.Box3().setFromObject(s.housing)).union(new THREE.Box3().setFromObject(s.supports));
    const sphere=box.isEmpty()?null:box.getBoundingSphere(new THREE.Sphere());
    const centre=sphere?.center??new THREE.Vector3(0,90,0),tan=Math.tan(THREE.MathUtils.degToRad(s.camera.fov)/2)/s.camera.zoom;
    let distance=sphere?Math.max(220,sphere.radius*1.1/Math.sin(Math.atan(Math.min(tan,tan*s.camera.aspect)))):1000;
    s.scene.fog=layout?new THREE.Fog('#f6f8fb',distance*1.5,distance*4):null;
    const direction=props.view==='top'?new THREE.Vector3(0,1,.00001):props.view==='side'?new THREE.Vector3(0,0,1):layout?new THREE.Vector3(.8,.27,1).normalize():telescope?new THREE.Vector3(.4,.35,1).normalize():cameraBody?new THREE.Vector3(-.35,.35,1).normalize():props.rendered?new THREE.Vector3(.6,.38,1).normalize():new THREE.Vector3(.55,.32,1).normalize();
    if(sphere){
      // Fit the actual long apparatus rather than a large enclosing sphere.
      // This changes only the camera, never distances, object size or rays.
      const up=props.view==='top'?new THREE.Vector3(0,0,-1):new THREE.Vector3(0,1,0),right=new THREE.Vector3().crossVectors(up,direction).normalize(),vertical=new THREE.Vector3().crossVectors(direction,right);
      distance=160;
      for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
        const delta=new THREE.Vector3(x,y,z).sub(centre),depth=delta.dot(direction);
        distance=Math.max(distance,depth+1.35*Math.abs(delta.dot(right))/(tan*s.camera.aspect*(telescope?.72:1)),depth+1.35*Math.abs(delta.dot(vertical))/tan);
      }
    }
    if(telescope){const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize();centre.addScaledVector(right,-distance*tan*s.camera.aspect*.18);}
    s.orbit.target.copy(centre);s.camera.position.copy(centre).addScaledVector(direction,Math.min(12000,distance));
    if(props.view==='top')s.camera.up.set(0,0,-1);
    s.orbit.enableRotate=props.view==='perspective';s.orbit.update();
  },[props.view,props.reset,props.rendered,!!cutaway,!!telescope,!!cameraBody,ready]);
  return <div className={`spatial-canvas ${props.rendered?'':'sb-principle-canvas'}`} ref={host} data-testid="spatial-bench" data-camera-housing={!!cameraBody}>{!props.rendered&&<><div className="sb-build-labels" ref={componentLabels} aria-label="光学元件定位">{props.experiment.elements.map((element,index)=><button key={element.id} data-element={element.id} data-below={element.kind==='object'||element.kind==='eye'} className={element.id===props.selectedId?'selected':''} aria-label={`选择${element.name}`} aria-pressed={element.id===props.selectedId} onClick={()=>props.onSelect(element.id)}><span>{String(index+1).padStart(2,'0')}</span><strong>{element.name}</strong></button>)}</div></>}{cutaway&&props.onFocus&&<MicroscopeFocusReadout layout={cutaway} onChange={distance=>props.onFocus?.('end',distance)}/>} {previewObject?.objectMode==='distant'?<SpatialDistantPreview object={previewObject} result={props.result?.imaging?.find(r=>r.objectId===previewObject.id)}/>:previewObject&&<SpatialObjectPreview observerKind={observerKind==='eye'||observerKind==='sensor'?observerKind:undefined} steady={!!cutaway} object={previewObject} image={props.result?.imaging?.find(r=>r.objectId===previewObject.id)?imageView(props.experiment,props.result.imaging.find(r=>r.objectId===previewObject.id)!,undefined,!!cutaway):null} warning={props.result?.imaging?.find(r=>r.objectId===previewObject.id)?.warnings[0]}/>}<div className="sb-coordinate-widget" hidden={!!cutaway} role="img" aria-label="世界坐标方向：红色 X 前后，绿色 Y 高度，蓝色 Z 左右；方向随视角转动" title="X · 前后　Y · 高度　Z · 左右"><span>坐标方向</span><svg ref={directionWidget} viewBox="0 0 108 98" aria-hidden="true">{(['X','Y','Z'] as const).map((axis,index)=><g key={axis} data-axis={axis} className={'sb-axis-'+axis.toLowerCase()}><line x1="54" y1="49" x2={index===0?87:54} y2={index===1?16:49}/><circle r="3" cx="54" cy="49" visibility="hidden"/><text x={index===0?98:54} y={index===1?5:49}>{axis}</text></g>)}</svg></div><div ref={axisLabels} className="sb-gizmo-labels" aria-hidden="true"><span className="sb-axis-x">X</span><span className="sb-axis-y">Y</span><span className="sb-axis-z">Z</span></div>{failed&&<div className="sb-webgl-error">浏览器无法显示三维画面，请开启硬件加速。装置仍可编辑和保存。</div>}</div>;
}

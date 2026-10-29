import {cameraLayout,cameraMoveBounds,type CameraDragPart} from './spatialCamera';
import {geometryFrame} from './spatialGeometry';
import * as THREE from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {microscopeLayout,microscopeFocusBounds,type FocusPhase} from './spatialMicroscope';
import {telescopeLayout,telescopeFocusBounds} from './spatialTelescope';
import type {SpatialExperiment} from './builderModel';

/** Pointer capture belongs to one focus gesture; orbit controls keep all other gestures. */
export function installMicroscopeControls(canvas:HTMLCanvasElement,camera:THREE.PerspectiveCamera,housing:THREE.Group,orbit:OrbitControls,get:()=>{experiment:SpatialExperiment;rendered:boolean;visible?:boolean;onFocus?:(phase:FocusPhase,distance?:number,part?:CameraDragPart)=>void}){
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  let drag:{id:number;x:number;y:number;u:number;dx:number;dy:number;min:number;max:number;value:number;last:number;part?:CameraDragPart}|null=null;
  const pick=(event:PointerEvent)=>{
    const props=get();if(!props.rendered||props.visible===false||!props.onFocus)return null;
    const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);raycaster.setFromCamera(pointer,camera);
    let node:THREE.Object3D|null=raycaster.intersectObject(housing,true)[0]?.object??null;
    while(node&&!node.userData.focusControl)node=node.parent;
    return node?.userData.focusControl as 'stage'|'coarse'|'fine'|'telescope-tube'|'telescope-ring'|'camera-lens'|'camera-sensor'|undefined;
  };
  const stop=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();};
  const finish=(cancel=false)=>{
    if(!drag)return;const previous=drag;drag=null;
    orbit.enabled=true;canvas.style.cursor='';
    get().onFocus?.(cancel?'cancel':'end',previous.value,previous.part);
    if(canvas.hasPointerCapture(previous.id))canvas.releasePointerCapture(previous.id);
  };
  const down=(event:PointerEvent)=>{
    if(event.button!==0||!event.isPrimary||drag)return;
    const control=pick(event),layout=microscopeLayout(get().experiment),telescope=telescopeLayout(get().experiment);
    const cameraBody=cameraLayout(get().experiment),part:CameraDragPart|undefined=control==='camera-lens'?'lens':control==='camera-sensor'?'sensor':undefined;
    const telescopeControl=control==='telescope-tube'||control==='telescope-ring';
    if(!control||!(part?cameraBody:telescopeControl?telescope:layout))return;
    stop(event);orbit.enabled=false;orbit.update();
    let dx=0,dy=control==='fine'?.0005:.005;
    if(control==='stage'&&layout){
      const rect=canvas.getBoundingClientRect(),p=new THREE.Vector3(0,layout.stageY,0).project(camera),q=new THREE.Vector3(0,layout.stageY+1,0).project(camera);
      const sx=(q.x-p.x)*rect.width/2,sy=-(q.y-p.y)*rect.height/2,length=sx*sx+sy*sy;
      if(length>.01){dx=-sx/length;dy=-sy/length;}else dy=.02;
      if(event.shiftKey){dx*=.01;dy*=.01;}
    }
    if(telescopeControl&&telescope){
      dy=.1;
      if(control==='telescope-tube'){
        const rect=canvas.getBoundingClientRect(),origin=new THREE.Vector3(...telescope.eyepiece.position),p=origin.clone().project(camera),q=origin.add(new THREE.Vector3(...telescope.axis)).project(camera);
        const sx=(q.x-p.x)*rect.width/2,sy=-(q.y-p.y)*rect.height/2,length=sx*sx+sy*sy;
        if(length>.01){dx=sx/length;dy=sy/length;}
      }
      if(event.shiftKey){dx*=.1;dy*=.1;}
    }
    if(part&&cameraBody){
      const rect=canvas.getBoundingClientRect(),origin=new THREE.Vector3(...cameraBody[part].position),axis=new THREE.Vector3(...geometryFrame(cameraBody.lens).n),p=origin.clone().project(camera),q=origin.add(axis).project(camera);
      const sx=(q.x-p.x)*rect.width/2,sy=-(q.y-p.y)*rect.height/2,length=sx*sx+sy*sy,sign=part==='lens'?-1:1;
      if(length>.01){dx=sign*sx/length;dy=sign*sy/length;}else{dx=0;dy=sign*.02;}
      if(event.shiftKey){dx*=.1;dy*=.1;}
    }
    const value=part?cameraBody!.distance:telescopeControl?telescope!.length:layout!.objectDistance,bounds=part?cameraMoveBounds(cameraBody!,part):telescopeControl?telescopeFocusBounds(telescope!):microscopeFocusBounds(layout!);
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,u:value,dx,dy,...bounds,value,last:0,part};
    canvas.setPointerCapture(event.pointerId);canvas.style.cursor='grabbing';get().onFocus?.('start',value,part);
  };
  const move=(event:PointerEvent)=>{
    if(!drag){const control=pick(event);canvas.style.cursor=control?'grab':'';canvas.title=control==='camera-lens'?'沿镜筒方向拖动调焦 · 按住 Shift 微调':control==='camera-sensor'?'前后拖动感光面观察清晰度 · 按住 Shift 微调':control==='telescope-tube'?'沿镜筒方向拖动调焦 · 按住 Shift 微调':control==='telescope-ring'?'上下拖动调焦环 · 按住 Shift 微调':control==='stage'?'拖动载物台调焦 · 按住 Shift 微调':control==='fine'?'上下拖动：微调':control==='coarse'?'上下拖动：调焦':'';return;}
    if(event.pointerId!==drag.id)return;stop(event);
    const delta=(event.clientX-drag.x)*drag.dx+(event.clientY-drag.y)*drag.dy;
    drag.value=Math.round(THREE.MathUtils.clamp(drag.u+delta,drag.min,drag.max)*1e5)/1e5;
    if(performance.now()-drag.last>=100){drag.last=performance.now();get().onFocus?.('change',drag.value,drag.part);}
  };
  const up=(event:PointerEvent)=>{if(event.pointerId!==drag?.id)return;move(event);stop(event);finish();};
  const cancel=()=>finish(true);
  const key=(event:KeyboardEvent)=>{if(drag&&event.key==='Escape'){stop(event);cancel();}};
  const leave=()=>{if(!drag){canvas.style.cursor='';canvas.title='';}};
  canvas.addEventListener('pointerdown',down,true);canvas.addEventListener('pointermove',move,true);canvas.addEventListener('pointerup',up,true);
  canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('lostpointercapture',cancel);canvas.addEventListener('pointerleave',leave);
  window.addEventListener('keydown',key,true);window.addEventListener('blur',cancel);
  return {cancel,dispose:()=>{
    cancel();canvas.removeEventListener('pointerdown',down,true);canvas.removeEventListener('pointermove',move,true);canvas.removeEventListener('pointerup',up,true);
    canvas.removeEventListener('pointercancel',cancel);canvas.removeEventListener('lostpointercapture',cancel);canvas.removeEventListener('pointerleave',leave);
    window.removeEventListener('keydown',key,true);window.removeEventListener('blur',cancel);
  }};
}

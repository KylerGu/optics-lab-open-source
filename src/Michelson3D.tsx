import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createSpatialOptic, createSpatialSupport } from './SpatialBench';
import { michelsonBuilderCopy } from './michelsonBuilderCopy';
import { michelson, MICHELSON_FIELDS, type MichelsonParameters } from './michelson';
import { MICHELSON_DEVICE_FIELDS, MICHELSON_DEVICE_NAMES, type MichelsonDevice, type MichelsonPath } from './MichelsonApparatus';
import { MICHELSON_QUANTITIES, type MichelsonAnnotation } from './michelsonAnnotations';
import type { SpatialElement } from './builderModel';

// Meshes and supports use the same world coordinates as the beams and labels.
export function createMichelsonHardware(element:SpatialElement,position:THREE.Vector3){
  const illustrated={...element,position:position.toArray() as [number,number,number]};
  const optic=createSpatialOptic(illustrated,true),support=createSpatialSupport(illustrated),group=new THREE.Group();
  group.add(optic,support);
  return {group,optic};
}

interface Props {
  p:MichelsonParameters; view:'perspective'|'top'; reset:number; path:MichelsonPath;
  selected:MichelsonDevice; annotations:MichelsonAnnotation[];
  onSelect:(device:MichelsonDevice)=>void; onStart:()=>void;
  onChange:(field:keyof MichelsonParameters,value:number)=>void; onFinish:()=>void;
}
const V=(x:number,y=60,z=0)=>new THREE.Vector3(x,y,z);
const number=(n:number)=>Number(n.toFixed(4)).toString();
const LABELS:Partial<Record<MichelsonAnnotation,string>>={arm1Mm:'第一臂 L₁',arm2Mm:'第二臂 L₂',mirror1MoveUm:'第一镜微调 s₁',mirrorMoveUm:'第二镜微调 s₂',sourceDistanceMm:'光源距离',lensDistanceMm:'透镜位置',focalLengthMm:'焦距 f',differenceUm:'两臂长度差 ΔL'};
function release(object:THREE.Object3D){
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
  object.traverse(o=>{const m=o as THREE.Mesh;if(m.geometry)geometries.add(m.geometry);if(m.material)(Array.isArray(m.material)?m.material:[m.material]).forEach(a=>materials.add(a));});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
}
/** Reuses the builder's real optical meshes. Only illustration displacement is magnified. */
export default function Michelson3D(props:Props){
  const host=useRef<HTMLDivElement>(null),latest=useRef(props);latest.current=props;
  const nodes=useRef(new Map<string,HTMLElement>()),leaders=useRef(new Map<string,SVGLineElement>()),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const bind=(key:string)=>(node:HTMLElement|null)=>{if(node)nodes.current.set(key,node);else nodes.current.delete(key);};
  const runtime=useRef<{begin:(id:MichelsonDevice,x:number,y:number,pointerId:number)=>void;move:(x:number,y:number)=>void;finish:()=>void;render:()=>void}|null>(null);
  useEffect(()=>{
    const el=host.current!;let renderer:THREE.WebGLRenderer;
    setError('');try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});}catch{setError('无法显示 3D 装置，请重试。');return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.setClearColor('#f8fbfe',1);renderer.domElement.dataset.testid='michelson-3d-canvas';
    renderer.domElement.setAttribute('aria-label','迈克耳孙三维装置，拖动空白旋转视角');el.appendChild(renderer.domElement);
    const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-250,250,250,-250,1,2000);
    scene.add(new THREE.HemisphereLight('#ffffff','#9aacbf',2.3));
    const light=new THREE.DirectionalLight('#ffffff',3);light.position.set(100,350,-180);scene.add(light);
    const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.enablePan=false;
    controls.minZoom=.6;controls.maxZoom=2.5;controls.minPolarAngle=.04;controls.maxPolarAngle=Math.PI/2-.08;
    const devices=new THREE.Group(),drawing=new THREE.Group();scene.add(devices,drawing);
    const board=new THREE.Mesh(new THREE.BoxGeometry(330,8,360),new THREE.MeshStandardMaterial({color:'#cdd9e5',roughness:.68,metalness:.18}));
    board.position.set(-20,-5,-55);scene.add(board);
    const edge=new THREE.LineSegments(new THREE.EdgesGeometry(board.geometry),new THREE.LineBasicMaterial({color:'#b7c7d8'}));edge.position.copy(board.position);scene.add(edge);
    const holes=new THREE.InstancedMesh(new THREE.CircleGeometry(1.4,8),new THREE.MeshBasicMaterial({color:'#a8bacd'}),24*24);
    const matrix=new THREE.Matrix4(),q=new THREE.Quaternion().setFromAxisAngle(V(1,0,0),-Math.PI/2);scene.add(holes);
    let width=1,height=1,disposed=false,oldProps:Props|null=null,oldView='',oldReset=-1;
    let drag:{id:number;field:keyof MichelsonParameters;value:number;x:number;y:number;dx:number;dy:number;scale:number}|null=null;
    const positions=new Map<string,THREE.Vector3>(),anchors=new Map<string,THREE.Vector3>(),hitGroups:THREE.Group[]=[];
    const hardware=new Map<MichelsonDevice,{group:THREE.Group;origin:THREE.Vector3;optic:THREE.Group}>();
    const project=(p:THREE.Vector3)=>{const q=p.clone().project(camera);return {x:(q.x+1)*width/2,y:(1-q.y)*height/2};};
    const placeLabels=()=>{
      const occupied:{x:number;y:number;w:number;h:number}[]=[];
      positions.forEach((p,key)=>{
        const node=nodes.current.get(key);if(!node)return;const a=project(p),w=node.offsetWidth,h=node.offsetHeight;
        let x=a.x,y=a.y;
        const candidates=[[0,0],[0,-26],[0,26],[-45,-26],[45,-26],[-45,26],[45,26],[0,-52],[0,52],[-70,-52],[70,-52],[0,-78],[0,78]];
        for(let step=4;step<15;step++)for(const dx of [0,-60,60,-120,120])for(const sign of [-1,1])candidates.push([dx,sign*26*step]);
        for(const [dx,dy] of candidates){
          x=Math.max(w/2+8,Math.min(width-w/2-8,a.x+dx));y=Math.max(h/2+65,Math.min(height-h/2-16,a.y+dy));
          if(!occupied.some(b=>Math.abs(x-b.x)<(w+b.w)/2+7&&Math.abs(y-b.y)<(h+b.h)/2+5))break;
        }
        node.style.left=`${x}px`;node.style.top=`${y}px`;occupied.push({x,y,w,h});
        const leader=leaders.current.get(key);const anchor=anchors.get(key);
        if(leader&&anchor){const at=project(anchor);leader.setAttribute('x1',String(at.x));leader.setAttribute('y1',String(at.y));leader.setAttribute('x2',String(x));leader.setAttribute('y2',String(y+h/2));}
      });
    };
    const line=(points:THREE.Vector3[],color:string,dashed=false)=>{
      const o=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),dashed?new THREE.LineDashedMaterial({color,dashSize:3,gapSize:2}):new THREE.LineBasicMaterial({color}));o.computeLineDistances();drawing.add(o);return o;
    };
    const dimension=(key:MichelsonAnnotation,a:THREE.Vector3,b:THREE.Vector3,offset:THREE.Vector3)=>{
      if(!latest.current.annotations.includes(key))return;
      const c=MICHELSON_QUANTITIES[key].color,aa=a.clone().add(offset),bb=b.clone().add(offset);
      line([a,aa],c,true);line([b,bb],c,true);line([aa,bb],c);
      for(const point of [aa,bb])line([point.clone().add(V(0,-3,0)),point.clone().add(V(0,3,0))],c);
      const mid=aa.clone().lerp(bb,.5);anchors.set(key,mid);positions.set(key,mid.clone().add(V(0,7,0)));
    };
    const beam=(points:THREE.Vector3[],color:string,opacity=1)=>{
      for(let i=1;i<points.length;i++){
        const curve=new THREE.LineCurve3(points[i-1],points[i]);
        drawing.add(new THREE.Mesh(new THREE.TubeGeometry(curve,1,.7,8,false),new THREE.MeshBasicMaterial({color,transparent:true,opacity})));
        drawing.add(new THREE.Mesh(new THREE.TubeGeometry(curve,1,2,8,false),new THREE.MeshBasicMaterial({color,transparent:true,opacity:opacity*.09,depthWrite:false})));
      }
    };
    const rebuild=()=>{
      release(drawing);drawing.clear();positions.clear();anchors.clear();
      const {p,selected,path,annotations}=latest.current,b=michelson(p);
      const m1=100+p.mirror1MoveUm*28,m2=100+p.baseDifferenceUm*.018+p.mirrorMoveUm*28;
      const coordinates:Record<MichelsonDevice,THREE.Vector3>={source:V(-p.sourceDistanceMm),splitter:V(0),mirror1:V(m1),mirror2:V(0,60,m2),compensator:V(m1*.55),lens:V(0,60,-p.lensDistanceMm),screen:V(0,60,-p.lensDistanceMm-p.focalLengthMm)};
      const minX=-p.sourceDistanceMm-50,maxX=Math.max(135,m1+35),minZ=coordinates.screen.z-35,maxZ=Math.max(135,m2+35);
      const boardWidth=maxX-minX,boardDepth=maxZ-minZ;board.scale.set(boardWidth/330,1,boardDepth/360);board.position.set((minX+maxX)/2,-5,(minZ+maxZ)/2);edge.scale.copy(board.scale);edge.position.copy(board.position);
      let holeCount=0;for(let x=minX+15;x<maxX-10;x+=25)for(let z=minZ+15;z<maxZ-10;z+=25){matrix.compose(V(x,-.8,z),q,V(1,1,1));holes.setMatrixAt(holeCount++,matrix);}holes.count=holeCount;holes.instanceMatrix.needsUpdate=true;holes.computeBoundingSphere();
      for(const e of michelsonBuilderCopy(p).elements){
        const id=e.id.replace('michelson-','') as MichelsonDevice,a=coordinates[id];
        let item=hardware.get(id);
        if(!item){
          const {optic,group}=createMichelsonHardware(e,a);
          group.userData.device=id;devices.add(group);hitGroups.push(group);
          if(id==='mirror1'||id==='mirror2'){
            const rail=new THREE.Mesh(new THREE.BoxGeometry(id==='mirror1'?64:22,4,id==='mirror1'?22:64),new THREE.MeshStandardMaterial({color:'#a5b5c7',metalness:.5,roughness:.45}));
            rail.position.set(a.x,1,a.z);group.add(rail);
          }
          item={group,optic,origin:a.clone()};hardware.set(id,item);
        }
        item.group.position.copy(a).sub(item.origin);item.optic.getObjectByName('selection')!.visible=id===selected;
        if(id==='source'){
          const aperture=item.optic.getObjectByName('laser-aperture') as THREE.Mesh|undefined;
          const material=aperture?.material as THREE.MeshPhysicalMaterial|undefined;
          if(material){material.color.set(p.wavelengthNm>600?'#ef6a5a':'#31ae89');material.emissive.copy(material.color);}
        }
        // Raised labels stay legible while the camera rotates; optical labels sit above the hardware.
        positions.set(id,a.clone().add(V(id==='compensator'?0:id==='splitter'?-12:0,id==='compensator'?62:id==='splitter'?34:38,0)));
        anchors.set(id,a);
      }
      beam([coordinates.source,V(0)],'#78a2b9');
      const blueOpacity=path==='arm2'?.15:1,orangeOpacity=path==='arm1'?.15:1;
      beam([V(0),coordinates.mirror1,V(0,61.5),coordinates.screen.clone().add(V(0,1.5,0))],'#357fc6',blueOpacity);
      beam([V(0),coordinates.mirror2,V(1.5),coordinates.screen.clone().add(V(1.5,0,0))],'#bf703f',orangeOpacity);
      drawing.add(new THREE.ArrowHelper(V(1,0,0),V(m1*.8),13,'#357fc6',4,2));
      drawing.add(new THREE.ArrowHelper(V(0,0,1),V(0,60,m2*.8),13,'#bf703f',4,2));
      dimension('arm1Mm',V(0),coordinates.mirror1,V(0,-35,-30));
      dimension('arm2Mm',V(0),coordinates.mirror2,V(45,-35,0));
      dimension('sourceDistanceMm',coordinates.source,V(0),V(0,-35,-35));
      dimension('lensDistanceMm',V(0),coordinates.lens,V(-45,-35,0));
      dimension('focalLengthMm',coordinates.lens,coordinates.screen,V(-45,-35,0));
      for(const [key,a,initial,offset] of [
        ['mirror1MoveUm',coordinates.mirror1,V(100),V(0,20,-32)],
        ['mirrorMoveUm',coordinates.mirror2,V(0,60,100+p.baseDifferenceUm*.018),V(32,20,0)],
      ] as const){
        if(!annotations.includes(key))continue;
        dimension(key,initial,a,offset);line([initial.clone().add(offset).add(V(0,-8,0)),initial.clone().add(offset).add(V(0,8,0))],MICHELSON_QUANTITIES[key].color,true);
      }
      if(annotations.includes('differenceUm'))positions.set('differenceUm',V(70,110,65));
      // Physical readouts always use the true model, never the magnified illustration.
      for(const key of Object.keys(LABELS) as MichelsonAnnotation[]){const node=nodes.current.get(key);if(!node)continue;const value=key==='arm1Mm'?b.arm1Mm:key==='arm2Mm'?b.arm2Mm:key==='differenceUm'?b.differenceUm:p[key as keyof MichelsonParameters];node.textContent=`${LABELS[key]} = ${key.startsWith('arm')?Number(value.toFixed(6)):number(value)} ${key.includes('Um')?'μm':'mm'}`;}
    };
    const render=()=>{
      if(disposed)return;
      const next=latest.current;
      if(next!==oldProps){rebuild();oldProps=next;}
      if(oldView!==next.view||oldReset!==next.reset){
        oldView=next.view;oldReset=next.reset;camera.position.copy(next.view==='top'?V(0,640,-65):V(-310,365,420));controls.target.set(-20,25,-55);camera.zoom=1;camera.updateProjectionMatrix();controls.update();
      }
      camera.updateMatrixWorld();placeLabels();renderer.render(scene,camera);
    };
    const resize=()=>{const box=el.getBoundingClientRect();width=Math.max(1,box.width);height=Math.max(1,box.height);renderer.setSize(width,height);const half=Math.max(240,255/(width/height));camera.left=-half*width/height;camera.right=half*width/height;camera.top=half;camera.bottom=-half;camera.updateProjectionMatrix();render();};
    const observer=new ResizeObserver(resize);observer.observe(el);resize();controls.addEventListener('change',render);
    const begin=(id:MichelsonDevice,x:number,y:number,pointerId:number)=>{
      const current=latest.current;current.onSelect(id);const field=MICHELSON_DEVICE_FIELDS[id];if(!field)return;
      const origin=id==='mirror1'?V(100):id==='mirror2'?V(0,60,100):id==='source'?V(-100):V(0,60,-50);
      const direction=id==='mirror1'?V(1,0,0):id==='source'?V(-1,0,0):id==='mirror2'?V(0,0,1):V(0,0,-1);
      const a=project(origin),b=project(origin.clone().addScaledVector(direction,10));
      const dx=(b.x-a.x)/10,dy=(b.y-a.y)/10;if(Math.hypot(dx,dy)<.15)return;
      controls.enabled=false;current.onStart();drag={id:pointerId,field,value:current.p[field],x,y,dx,dy,scale:id.startsWith('mirror')?28:1};
    };
    const move=(x:number,y:number)=>{if(!drag)return;const d=drag,f=MICHELSON_FIELDS.find(f=>f.key===d.field)!;
      const distance=((x-d.x)*d.dx+(y-d.y)*d.dy)/(d.dx*d.dx+d.dy*d.dy)/d.scale;
      latest.current.onChange(d.field,Math.max(f.min,Math.min(f.max,d.value+distance)));
    };
    const finish=()=>{if(!drag)return;drag=null;controls.enabled=true;latest.current.onFinish();};
    runtime.current={begin,move,finish,render};
    const down=(e:PointerEvent)=>{
      if(e.button!==0)return;const rect=el.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/width*2-1,-(e.clientY-rect.top)/height*2+1),camera);
      let hit:THREE.Object3D|null=ray.intersectObjects(hitGroups,true)[0]?.object??null;while(hit&&!hit.userData.device)hit=hit.parent;
      if(!hit)return;e.stopImmediatePropagation();e.preventDefault();begin(hit.userData.device,e.clientX,e.clientY,e.pointerId);renderer.domElement.setPointerCapture(e.pointerId);
    };
    const moving=(e:PointerEvent)=>{if(drag?.id===e.pointerId)move(e.clientX,e.clientY);};
    const up=()=>finish();renderer.domElement.addEventListener('pointerdown',down,true);renderer.domElement.addEventListener('pointermove',moving);renderer.domElement.addEventListener('pointerup',up);renderer.domElement.addEventListener('pointercancel',up);renderer.domElement.addEventListener('lostpointercapture',up);
    const lost=(e:Event)=>{e.preventDefault();setError('3D 显示中断，请重试。');};renderer.domElement.addEventListener('webglcontextlost',lost);
    return()=>{disposed=true;finish();controls.removeEventListener('change',render);controls.dispose();observer.disconnect();runtime.current=null;release(scene);renderer.dispose();renderer.forceContextLoss();renderer.domElement.removeEventListener('webglcontextlost',lost);renderer.domElement.remove();};
  },[retry]);
  // Draw only after a control/camera/size change; there is no idle animation loop.
  useEffect(()=>runtime.current?.render(),[props]);
  return <div className="michelson-3d" onPointerMove={e=>runtime.current?.move(e.clientX,e.clientY)} onPointerUp={()=>runtime.current?.finish()} onPointerCancel={()=>runtime.current?.finish()} onLostPointerCapture={()=>runtime.current?.finish()}>
    <div ref={host} className="michelson-3d-host"/>
    {!error&&<div className="michelson-3d-overlay">
      <svg className="michelson-3d-leaders" aria-hidden="true">{[...Object.keys(MICHELSON_DEVICE_NAMES),...Object.keys(LABELS).filter(key=>props.annotations.includes(key as MichelsonAnnotation))].map(id=><line key={id} ref={node=>{if(node)leaders.current.set(id,node);else leaders.current.delete(id);}} stroke={MICHELSON_QUANTITIES[id as MichelsonAnnotation]?.color??'#aebed0'} strokeWidth="1"/>)}</svg>
      {(Object.keys(MICHELSON_DEVICE_NAMES) as MichelsonDevice[]).map(id=><button key={id} ref={bind(id)} className={`michelson-3d-name ${props.selected===id?'is-selected':''}`} data-testid={`michelson-device-${id}`} title={MICHELSON_DEVICE_FIELDS[id]?'拖动沿光路移动':'点击选择器件'} onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();runtime.current?.begin(id,e.clientX,e.clientY,e.pointerId);e.currentTarget.setPointerCapture(e.pointerId);}} onClick={()=>props.onSelect(id)} onKeyDown={e=>{const field=MICHELSON_DEVICE_FIELDS[id];if(!field||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();props.onSelect(id);const f=MICHELSON_FIELDS.find(f=>f.key===field)!;props.onStart();props.onChange(field,Math.max(f.min,Math.min(f.max,props.p[field]+(['ArrowUp','ArrowRight'].includes(e.key)?1:-1)*f.step*(e.shiftKey?10:1))));props.onFinish();}}>{MICHELSON_DEVICE_NAMES[id]}</button>)}
      {(Object.keys(LABELS) as MichelsonAnnotation[]).filter(key=>props.annotations.includes(key)).map(key=><span key={key} ref={bind(key)} className="michelson-3d-quantity" style={{color:MICHELSON_QUANTITIES[key].color}} data-testid={`michelson-annotation-${key}`}/>)}
    </div>}
    {error&&<div className="michelson-3d-error" role="alert"><p>{error}</p><button onClick={()=>setRetry(n=>n+1)}>重试 3D</button></div>}
  </div>;
}

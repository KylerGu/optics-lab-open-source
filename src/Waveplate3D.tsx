import { useEffect, useRef, useState, type PointerEvent } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { waveplate, fieldPoint, type WaveplateParameters } from './waveplate';
import { waveplateAngleFromPlane, waveplateSpatialField, WAVEPLATE_INPUT_X as INPUT, WAVEPLATE_OUTPUT_X as OUTPUT } from './waveplateGeometry';
import { numberText } from './sceneRuntime';
import { WAVEPLATE_COLORS as C } from './quantityColors';

export type WaveplateAnnotation='inputAngleDeg'|'axisAngleDeg'|'majorAngleDeg';
type AngleField='inputAngleDeg'|'axisAngleDeg';
interface Props {p:WaveplateParameters;annotations:WaveplateAnnotation[];phase:number;playing:boolean;onTogglePlaying:()=>void;onStart:()=>void;onChange:(key:keyof WaveplateParameters,value:number)=>void;onFinish:()=>void}
interface Runtime {camera:THREE.OrthographicCamera;controls:OrbitControls;reset:()=>void}
const V=(x:number,y=0,z=0)=>new THREE.Vector3(x,y,z);
function planePoint(x:number,angle:number,r:number){const a=angle*Math.PI/180;return V(x,r*Math.sin(a),-r*Math.cos(a));}
function release(scene:THREE.Scene){
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
  scene.traverse(o=>{const mesh=o as THREE.Mesh;if(mesh.geometry)geometries.add(mesh.geometry);if(mesh.material)(Array.isArray(mesh.material)?mesh.material:[mesh.material]).forEach(m=>materials.add(m));});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
}
export default function Waveplate3D(props:Props){
  const latest=useRef(props);latest.current=props;
  const host=useRef<HTMLDivElement>(null),runtime=useRef<Runtime|null>(null),nodes=useRef(new Map<string,HTMLElement>());
  const drag=useRef<{id:number;field:AngleField;plane:THREE.Plane;radius:number}|null>(null);
  const [error,setError]=useState(''),[retry,setRetry]=useState(0),[dragNotice,setDragNotice]=useState('');
  const setNode=(key:string)=>(node:HTMLElement|null)=>{if(node)nodes.current.set(key,node);else nodes.current.delete(key);};
  useEffect(()=>{
    const el=host.current!;let renderer:THREE.WebGLRenderer;
    setError('');try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});}catch{setError('3D 显示暂不可用，可先查看右侧正视图。');return;}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor('#f9fbfe',0);
    renderer.domElement.setAttribute('role','img');renderer.domElement.setAttribute('aria-label','波片三维示意：入射电场、波片与输出电场；拖动空白处旋转视角');renderer.domElement.dataset.testid='waveplate-3d-canvas';el.appendChild(renderer.domElement);
    const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-6,6,3,-3,.1,100);
    const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.enablePan=false;controls.minZoom=.7;controls.maxZoom=1.7;controls.minPolarAngle=.25;controls.maxPolarAngle=Math.PI-.25;
    const reset=()=>{const damping=controls.enableDamping;controls.enableDamping=false;controls.update();controls.enableDamping=damping;camera.position.set(-7,4.2,13);camera.zoom=1;controls.target.set(0,0,0);camera.updateProjectionMatrix();controls.update();};reset();
    scene.add(new THREE.AmbientLight('#ffffff',2));const light=new THREE.DirectionalLight('#ffffff',2.5);light.position.set(-2,6,8);scene.add(light);
    const fats:Line2[]=[];
    const line=(color:string,count:number,width=1.8)=>{const geometry=new LineGeometry();geometry.setPositions(new Float32Array(count*3));const material=new LineMaterial({color,linewidth:width,transparent:true,opacity:1});const object=new Line2(geometry,material);object.frustumCulled=false;scene.add(object);fats.push(object);return object;};
    const write=(object:Line2,points:THREE.Vector3[])=>{const a=object.geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute;for(let j=0;j<points.length-1;j++){const i=j*6;a.data.array[i]=points[j].x;a.data.array[i+1]=points[j].y;a.data.array[i+2]=points[j].z;a.data.array[i+3]=points[j+1].x;a.data.array[i+4]=points[j+1].y;a.data.array[i+5]=points[j+1].z;}a.data.needsUpdate=true;};
    const ring=(x:number,r:number,color:string)=>{const o=line(color,65,1.1);write(o,Array.from({length:65},(_,j)=>planePoint(x,j/64*360,r)));return o;};
    const disc=new THREE.Mesh(new THREE.CylinderGeometry(1.22,1.22,.08,80),new THREE.MeshPhysicalMaterial({color:'#dbd9ef',transparent:true,opacity:.35,roughness:.4,metalness:0,depthWrite:false}));disc.rotation.z=Math.PI/2;scene.add(disc);ring(0,1.23,'#aea4cc');
    const inputRing=ring(INPUT,1.05,'#c6d7e8'),outputRing=ring(OUTPUT,1.05,'#c6dbd2');inputRing.material.opacity=.7;outputRing.material.opacity=.7;
    scene.add(new THREE.ArrowHelper(V(1),V(-4.6),9.2,'#93a5b8',.18,.10));
    const inputAxis=line(C.inputAngleDeg,2,2),fastAxis=line(C.axisAngleDeg,2,2.3),inputArc=line(C.inputAngleDeg,33,1),fastArc=line(C.axisAngleDeg,33,1);
    const incoming=line(C.inputAngleDeg,141,2.2),outgoing=line(C.outputPowerMw,141,2.4),outputEllipse=line(C.outputPowerMw,97,2),majorAxis=line(C.majorAngleDeg,2,1);
    const fieldGroup=new THREE.Group();scene.add(fieldGroup);
    const arrows:{x:number;group:THREE.Group;shaft:THREE.Mesh;head:THREE.Mesh}[]=[];
    for(const x of [INPUT,-3,-2.2,-1.4,-.6,.6,1.4,2.2,3,OUTPUT]){const material=new THREE.MeshBasicMaterial({color:x<0?C.inputAngleDeg:C.outputPowerMw}),group=new THREE.Group(),shaft=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,1,8),material),head=new THREE.Mesh(new THREE.ConeGeometry(.055,.12,10),material);group.add(shaft,head);fieldGroup.add(group);arrows.push({x,group,shaft,head});}
    const updateArrow=(arrow:typeof arrows[number],pt:{x:number;y:number})=>{const direction=V(0,pt.y,-pt.x),length=direction.length();arrow.group.visible=length>.025;if(!arrow.group.visible)return;arrow.group.position.set(arrow.x,0,0);arrow.group.quaternion.setFromUnitVectors(V(0,1),direction.normalize());const headLength=Math.min(.12,length*.35);arrow.shaft.scale.y=Math.max(.001,length-headLength);arrow.shaft.position.y=(length-headLength)/2;arrow.head.scale.y=headLength/.12;arrow.head.position.y=length-headLength/2;};
    let width=1,height=1,frame=0,disposed=false;
    const resize=()=>{const box=el.getBoundingClientRect();width=Math.max(1,box.width);height=Math.max(1,box.height);renderer.setSize(width,height);const aspect=width/height,halfH=Math.max(2.7,5.5/aspect);camera.left=-halfH*aspect;camera.right=halfH*aspect;camera.top=halfH;camera.bottom=-halfH;camera.updateProjectionMatrix();fats.forEach(o=>o.material.resolution.set(width,height));};
    const observer=new ResizeObserver(resize);observer.observe(el);resize();runtime.current={camera,controls,reset};
    const place=(key:string,point:THREE.Vector3,label=false)=>{const node=nodes.current.get(key);if(!node)return;const q=point.clone().project(camera),x=(q.x+1)*width/2,y=(1-q.y)*height/2;node.style.left=`${label?Math.max(45,Math.min(width-45,x)):x}px`;node.style.top=`${label?Math.max(95,Math.min(height-27,y)):y}px`;node.style.visibility=q.z<1&&q.z>-1?'visible':'hidden';};
    const animate=()=>{
      if(disposed)return;controls.update();const {p,phase,annotations}=latest.current,b=waveplate(p),active=p.powerMw>0;
      write(inputAxis,[planePoint(INPUT,p.inputAngleDeg,1.02),planePoint(INPUT,p.inputAngleDeg+180,1.02)]);write(fastAxis,[planePoint(0,p.axisAngleDeg,1.22),planePoint(0,p.axisAngleDeg+180,1.22)]);
      write(inputArc,Array.from({length:33},(_,j)=>planePoint(INPUT,p.inputAngleDeg*j/32,.66)));write(fastArc,Array.from({length:33},(_,j)=>planePoint(0,p.axisAngleDeg*j/32,.82)));
      inputArc.visible=annotations.includes('inputAngleDeg');fastArc.visible=annotations.includes('axisAngleDeg');
      incoming.visible=outgoing.visible=outputEllipse.visible=fieldGroup.visible=active;
      if(active){for(const [curve,from,to] of [[incoming,INPUT,-.11],[outgoing,.11,OUTPUT]] as const)write(curve,Array.from({length:141},(_,j)=>{const x=from+(to-from)*j/140,f=waveplateSpatialField(p,x,phase,b);return V(x,f.y,-f.x);}));
        write(outputEllipse,Array.from({length:97},(_,j)=>{const f=fieldPoint(b,j/96*2*Math.PI);return V(OUTPUT,f.y,-f.x);}));arrows.forEach(a=>updateArrow(a,waveplateSpatialField(p,a.x,phase,b)));}
      majorAxis.visible=annotations.includes('majorAngleDeg')&&b.majorAngleDeg!==null;if(b.majorAngleDeg!==null)write(majorAxis,[planePoint(OUTPUT,b.majorAngleDeg,1),planePoint(OUTPUT,b.majorAngleDeg+180,1)]);
      for(const [field,x,r] of [['inputAngleDeg',INPUT,1.02],['axisAngleDeg',0,1.22]] as const){place(field,planePoint(x,p[field],r));place(field+'-opposite',planePoint(x,p[field]+180,r));place('label-'+field,planePoint(x,p[field],r+.24),true);}
      place('input-title',V(INPUT,1.8),true);place('plate-title',V(0,2),true);place('output-title',V(OUTPUT,1.8),true);place('propagation-title',V(1.1,-1.65),true);
      renderer.render(scene,camera);frame=requestAnimationFrame(animate);
    };frame=requestAnimationFrame(animate);
    const lost=(event:Event)=>{event.preventDefault();if(!disposed)setError('3D 显示中断，可重试或查看右侧正视图。');};renderer.domElement.addEventListener('webglcontextlost',lost);
    return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();renderer.domElement.removeEventListener('webglcontextlost',lost);if(drag.current){drag.current=null;latest.current.onFinish();}runtime.current=null;release(scene);renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();};
  },[retry]);
  const begin=(e:PointerEvent<HTMLButtonElement>,field:AngleField)=>{if(e.button!==0||!runtime.current)return;e.preventDefault();e.stopPropagation();e.currentTarget.focus();setDragNotice('');props.onStart();runtime.current.controls.enabled=false;drag.current={id:e.pointerId,field,plane:new THREE.Plane(V(1),field==='inputAngleDeg'?-INPUT:0),radius:field==='inputAngleDeg'?1.02:1.22};e.currentTarget.setPointerCapture(e.pointerId);};
  const move=(e:PointerEvent<HTMLDivElement>)=>{const d=drag.current,r=runtime.current;if(!d||d.id!==e.pointerId||!r)return;const box=host.current!.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-box.left)/box.width*2-1,-(e.clientY-box.top)/box.height*2+1),r.camera);const point=ray.ray.intersectPlane(d.plane,V(0));if(!point||Math.hypot(point.y,point.z)<d.radius*.08){if(!point)setDragNotice('侧视时请先转动视角');return;}props.onChange(d.field,waveplateAngleFromPlane(point.y,point.z));};
  const finish=()=>{if(!drag.current)return;drag.current=null;if(runtime.current)runtime.current.controls.enabled=true;props.onFinish();};
  const keyboard=(e:React.KeyboardEvent<HTMLButtonElement>,field:AngleField)=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();props.onStart();props.onChange(field,e.key==='Home'?0:e.key==='End'?180:Math.max(0,Math.min(180,props.p[field]+(['ArrowUp','ArrowRight'].includes(e.key)?1:-1))));props.onFinish();};
  return <div className="gs-plot fiber-plot waveplate-plot"><div className="fiber-banner">{props.p.powerMw===0?'光源关闭':props.p.plateType===0?'四分之一波片 · 改变偏振态':'半波片 · 转动线偏振方向'}</div>
    <div className="waveplate-3d-stage" onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
      <div ref={host} className="waveplate-3d-host"/>
      {!error&&<div className="waveplate-3d-overlay"><span ref={setNode('input-title')} className="waveplate-3d-title" style={{color:C.inputAngleDeg}}>入射光</span><span ref={setNode('plate-title')} className="waveplate-3d-title" style={{color:C.axisAngleDeg}}>波片</span><span ref={setNode('output-title')} className="waveplate-3d-title" style={{color:C.outputPowerMw}}>输出电场</span><span ref={setNode('propagation-title')} className="waveplate-3d-title waveplate-propagation-label">光传播方向</span>
        {(['inputAngleDeg','axisAngleDeg'] as const).map(field=><div key={field}>{[false,true].map(opposite=><button key={String(opposite)} ref={setNode(field+(opposite?'-opposite':''))} className="waveplate-3d-handle" style={{borderColor:C[field]}} role="slider" aria-label={opposite?(field==='inputAngleDeg'?'偏振方向另一端':'快轴另一端'):(field==='inputAngleDeg'?'图中偏振方向':'图中快轴角')} aria-valuemin={0} aria-valuemax={180} aria-valuenow={props.p[field]} data-testid={!opposite?'waveplate-handle-'+field:undefined} title={field==='inputAngleDeg'?'拖动旋转入射偏振方向':'拖动旋转波片快轴'} onPointerDown={e=>begin(e,field)} onKeyDown={e=>keyboard(e,field)}/>)}
          {props.annotations.includes(field)&&<span ref={setNode('label-'+field)} className="waveplate-3d-label" style={{color:C[field]}} data-testid={'waveplate-annotation-'+field}>{field==='inputAngleDeg'?'α':'β'} = {numberText(props.p[field])}°</span>}
        </div>)}
      </div>}
      {error&&<div className="waveplate-3d-error" role="alert"><p>{error}</p><button onClick={()=>setRetry(v=>v+1)}>重试 3D</button></div>}
    </div><div className="gs-visual-footer"><span>{dragNotice||'拖端点调角度 · 拖空白转视角'}</span><div className="waveplate-view-actions"><button className="waveplate-play" aria-label={props.playing?'暂停偏振动画':'播放偏振动画'} onClick={props.onTogglePlaying}>{props.playing?<Pause size={13}/>:<Play size={13}/>} {props.playing?'暂停':'播放'}</button><button className="waveplate-play" aria-label="恢复三维视角" onClick={()=>runtime.current?.reset()}><RotateCcw size={13}/>复位视角</button></div></div><div className="waveplate-field-note">曲线表示电场端点，光沿直轴传播 · 动画慢放</div>
  </div>;
}

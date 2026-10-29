import type {SpatialExperiment,Vec3} from './builderModel';
import type {ObjectImageResult} from './spatialImaging';
import {geometryFrame,sub3,dot3} from './spatialGeometry';

export interface ImageView {
  elementId:string; kind:'screen'|'sensor'|'eye'; width:number;height:number;
  paths:number[][][]; hits:{x:number;y:number}[]; focused:boolean;
  caption?:string;
}
/** Coordinates are physical sensor mm, including the ideal relay scale. */
export function imageView(experiment:SpatialExperiment,result:ObjectImageResult,elementId?:string,apparentEye=false):ImageView|null{
  const observation=elementId?result.observations.find(o=>o.elementId===elementId):result.observations.find(o=>o.kind==='sensor'||o.kind==='screen')??result.observations.find(o=>o.kind==='eye');
  if(!observation)return null;
  const detector=experiment.elements.find(e=>e.id===observation.elementId),final=result.stages.at(-1);
  if(!detector||!final)return null;
  const {u,v}=geometryFrame(detector);
  if(observation.kind==='eye'&&experiment.elements.find(e=>e.id===result.objectId)?.objectMode==='distant')return null;
  if(observation.kind==='eye'){
    if(!final.visible||observation.angularMagnification===null||!observation.fieldDiameterMm||!observation.hits.length)return null;
    const center=experiment.elements.find(e=>e.id===result.stages[0].lensId)?.position;
    if(!center)return null;
    const sign=Math.sign(observation.angularMagnification);
    // At the conventional 250 mm viewing distance, angular magnification scales apparent size.
    const scale=apparentEye?Math.abs(observation.angularMagnification):1;
    const caption=apparentEye?`${final.kind==='infinity'?'无穷远像':final.kind==='virtual'?'虚像':'实像'} · ${Math.abs(observation.angularMagnification).toFixed(1)}×`:undefined;
    return {elementId:detector.id,kind:'eye',width:observation.fieldDiameterMm*scale,height:observation.fieldDiameterMm*scale,focused:true,hits:[],caption,paths:result.objectPaths.map(path=>path.map(p=>{const delta=sub3(p,center);return [dot3(delta,u)*sign*scale,-dot3(delta,v)*sign*scale];}))};
  }
  const paths=observation.focused&&final.visible?final.paths.map(path=>path.map(p=>{
    const delta=sub3(p,detector.position);
    return [dot3(delta,u)*observation.adapterMagnification,-dot3(delta,v)*observation.adapterMagnification];
  })):[];
  return {elementId:detector.id,kind:observation.kind,width:observation.widthMm,height:observation.heightMm,paths,hits:observation.hits,focused:observation.focused};
}

export function imageCanvas(view:ImageView){
  const canvas=document.createElement('canvas');const scale=768/Math.max(view.width,view.height);canvas.width=Math.max(1,Math.round(view.width*scale));canvas.height=Math.max(1,Math.round(view.height*scale));
  const c=canvas.getContext('2d')!,sx=canvas.width/view.width,sy=canvas.height/view.height;
  c.fillStyle='#142d3b';c.fillRect(0,0,canvas.width,canvas.height);
  c.translate(canvas.width/2,canvas.height/2);
  if(view.kind==='screen'){c.beginPath();c.arc(0,0,canvas.width/2,0,Math.PI*2);c.clip();}
  c.strokeStyle='#f1cf8a';c.lineWidth=3;c.lineCap='round';c.lineJoin='round';
  if(view.paths.length){
    for(const path of view.paths){c.beginPath();path.forEach(([x,y],i)=>i?c.lineTo(x*sx,-y*sy):c.moveTo(x*sx,-y*sy));c.stroke();}
  }else{
    c.fillStyle='#f1cf8a';c.globalAlpha=.3;
    for(const h of view.hits){c.beginPath();c.arc(h.x*sx,-h.y*sy,2,0,Math.PI*2);c.fill();}
  }
  return canvas;
}

/** Near view crops the sensor view, it never rescales the optical coordinates. */
export function nearViewBox(view:ImageView){
  const points=view.paths.flat().concat(view.hits.map(h=>[h.x,h.y]));
  if(!points.length)return [-view.width/2,-view.height/2,view.width,view.height];
  const inside=points.filter(([x,y])=>Math.abs(x)<=view.width/2&&Math.abs(y)<=view.height/2);
  if(!inside.length)return [-view.width/2,-view.height/2,view.width,view.height];
  const xs=inside.map(p=>p[0]),ys=inside.map(p=>-p[1]);
  const size=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys),Math.min(view.width,view.height)*.08)*1.5;
  const w=Math.min(view.width,size),h=Math.min(view.height,size),cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
  return [Math.max(-view.width/2,Math.min(view.width/2-w,cx-w/2)),Math.max(-view.height/2,Math.min(view.height/2-h,cy-h/2)),w,h];
}

export const imageRayColor=(point:number)=>point===0?'#c08a36':'#358f9a';
export function raySections(segments:ObjectImageResult['segments'],axis:Vec3,points:readonly number[]=[0,2]){
  const groups=new Map<string,typeof segments>();
  for(const s of segments){if(s.dashed||!points.includes(s.point))continue;
    const key=[s.point,dot3(s.start,axis).toFixed(5),dot3(s.end,axis).toFixed(5)].join(':');
    groups.set(key,[...(groups.get(key)??[]),s]);
  }
  return [...groups.values()].filter(group=>group.length===5);
}

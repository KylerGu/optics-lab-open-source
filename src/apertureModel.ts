import { SCENE_DEFINITIONS, sceneKey, type SceneState, type SceneResult } from './sceneRuntime';

function overlap(r:number,q:number,d:number) {
  d=Math.abs(d);
  if(d>=r+q)return 0;
  if(d<=Math.abs(r-q))return Math.PI*Math.min(r,q)**2;
  const a=Math.acos(Math.max(-1,Math.min(1,(d*d+r*r-q*q)/(2*d*r))));
  const b=Math.acos(Math.max(-1,Math.min(1,(d*d+q*q-r*r)/(2*d*q))));
  return r*r*a+q*q*b-.5*Math.sqrt(Math.max(0,(-d+r+q)*(d+r-q)*(d-r+q)*(d+r+q)));
}
const imageDistance=(f:number,u:number)=>Math.abs(1/f-1/u)>1e-12?1/(1/f-1/u):null;

export function apertureGeometry(p:Record<string,number>,h=p.h) {
  const {f,u,z,lensD,stopD}=p,a=1+z/u-(z>0?z/f:0),b=-z*h/u,r=lensD/2,q=stopD/2;
  const limit=Math.abs(a)>1e-12?q/Math.abs(a):Infinity,active=limit<r-1e-10?'stop':'lens';
  let fraction:number,lo:number,hi:number;
  if(Math.abs(a)<1e-12){fraction=Math.abs(b)<=q?1:0;lo=fraction?-r:0;hi=fraction?r:0;}
  else {const center=-b/a;fraction=overlap(r,limit,center)/(Math.PI*r*r);lo=Math.max(-r,center-limit);hi=Math.min(r,center+limit);if(hi<lo)lo=hi=0;}
  let entrance:[number|null,number|null]=[0,lensD],exit:[number|null,number|null]=[0,lensD];
  if(active==='stop') {
    if(Math.abs(z)<1e-12)entrance=exit=[0,stopD];
    else {const v=imageDistance(f,Math.abs(z)),imaged:[number|null,number|null]=v===null?[null,null]:[z>0?-v:v,Math.abs(v/z)*stopD];if(z>0){entrance=imaged;exit=[z,stopD];}else{entrance=[z,stopD];exit=imaged;}}
  }
  return {a,b,lo,hi,fraction:Math.max(0,Math.min(1,fraction)),active,entrance,exit};
}

// Translate the lens while the object and external stop stay at their world
// positions. Both relative distances must remain within the declared ranges.
export function apertureLensShift(p:Record<string,number>,delta:number) {
  const fields=SCENE_DEFINITIONS['aberrations-0'].parameters,u=fields.find(p=>p.key==='u')!,z=fields.find(p=>p.key==='z')!;
  const shift=Math.max(u.min-p.u,p.z-z.max,Math.min(u.max-p.u,p.z-z.min,delta));
  return {u:p.u+shift,z:p.z-shift,shift};
}

export function immediateAperture(state:SceneState):SceneResult {
  const p=state.parameters,{f,u,z,h,lensD,stopD}=p,g=apertureGeometry(p),v=imageDistance(f,u),definition=SCENE_DEFINITIONS[state.sceneId];
  const xmin=-u*1.15,xmax=Math.max(v!==null&&v>0?v*1.12:0,z*1.2,160),ymax=Math.max(lensD*.8,stopD*.8,h*1.3,v!==null?Math.abs(v*h/u)*1.15:0,20);
  const metrics:SceneResult['metrics']=[],segments:SceneResult['segments']=[],warnings:string[]=[],devices:NonNullable<SceneResult['devices']>=[{kind:'lens',x:0,height:lensD/2,label:'透镜口径',sign:1},{kind:'stop',x:z,height:stopD/2,label:'外置光阑',sign:1}];
  const metric=(key:string,label:string,value:number|null,unit='',note='')=>metrics.push({key,label,value,unit,note});
  const seg=(start:[number,number],end:[number,number],role='transmitted')=>segments.push({start,end,role,dashed:false,power:1});
  metric('v','物体的像距',v,'mm','孔径改变通光范围，理想像距不变');
  metric('apertureStop','限制轴上光束的孔径',g.active==='lens'?0:1,'','0：透镜口径；1：外置光阑；等大时记为透镜口径');
  for(const [key,label,pupil] of [['entrance','入瞳',g.entrance],['exit','出瞳',g.exit]] as const) {
    metric(key+'Position',label+'位置',pupil[0],'mm','从透镜量起；正值在像侧，负值在物侧；空值表示在无穷远');
    metric(key+'Diameter',label+'直径',pupil[1],'mm','光瞳是限制轴上光束的孔径经前方或后方透镜所成的像');
  }
  metric('throughput','通光面积比例',g.fraction*100,'%','相对于均匀填满透镜口径的光束，圆形孔径重叠面积比例；不含余弦照度、吸收与衍射');
  metric('acceptedWidth','透镜面可通光范围宽度',Math.max(0,g.hi-g.lo),'mm','当前物点在子午面内可通过的光线范围');
  const heights=new Set(Array.from({length:17},(_,j)=>-lensD/2+j*lensD/16));
  if(g.fraction>0)for(const y of [g.lo,(g.lo+g.hi)/2,g.hi])heights.add(y);
  for(const y0 of [...heights].sort((a,b)=>a-b)) {
    const t0=(y0-h)/u,t1=t0-y0/f,ys=g.a*y0+g.b,passed=Math.abs(ys)<=stopD/2+1e-9;
    if(z<=0){seg([-u,h],[z,ys],passed?'incident':'blocked');if(passed){seg([z,ys],[0,y0],'incident');seg([0,y0],[xmax,y0+xmax*t1]);}}
    else {seg([-u,h],[0,y0],passed?'incident':'blocked');seg([0,y0],[z,ys],passed?'internal':'blocked');if(passed)seg([z,ys],[xmax,y0+xmax*t1]);}
  }
  const markers:SceneResult['markers']=[{x:-u,y:h,label:'物体',role:'object'}];
  if(v!==null&&v>0)markers.push({x:v,y:-v*h/u,label:'理想像点',role:'image'});
  const pupils=g.entrance[0]===g.exit[0]&&g.entrance[1]===g.exit[1]?[[g.entrance,'入瞳 / 出瞳']] as const:[[g.entrance,'入瞳'],[g.exit,'出瞳']] as const;
  for(const [pupil,label] of pupils){const [pos,diam]=pupil;if(pos!==null&&diam!==null&&xmin<=pos&&pos<=xmax&&diam<ymax*2)devices.push({kind:'pupil',x:pos,height:diam/2,label,sign:1});else if(pos!==null)warnings.push(label+'超出图中范围，读数保留实际位置与大小。');}
  if(Math.abs(g.a)<1e-12)warnings.push('外置孔径处在此物体的理想像面，主要限制视场；轴上光束仍由透镜口径限制。');
  if(h/u>.15||lensD/(2*f)>.3)warnings.push('当前物点偏离光轴较远或孔径较大，小角度近似的实际精度会下降；图中仍显示所声明的薄透镜模型。');
  if(g.entrance[0]===null||g.exit[0]===null)warnings.push('光阑处于透镜焦平面，一个光瞳位于无穷远；不能把它画成有限直径的孔。');
  return {revision:sceneKey(state),input:state,modelVersion:'scene-physics-3',model:'aperture',scope:definition.scope,status:(g.active==='stop'?'外置光阑':'透镜口径')+'限制轴上光束'+(g.fraction<1e-12?'；当前物点完全被遮挡':''),metrics,segments,markers,regions:[],devices,bounds:[xmin,xmax,-ymax,ymax],warnings,imagePreview:null,
    curve:Array.from({length:121},(_,j)=>{const height=j*80/120;return {x:height,y:apertureGeometry(p,height).fraction*100};}),chart:{xLabel:'物点离轴高度 / mm',yLabel:'通光面积比例 / %',currentX:h,currentY:g.fraction*100}};
}

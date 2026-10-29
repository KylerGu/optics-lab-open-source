import { SCENE_DEFINITIONS, sceneKey, type SceneState, type SceneResult } from './sceneRuntime';

export const TELESCOPE_STUDIES=['成像光路','放大与视场','分辨率','出瞳与观察'] as const;
export const ARCSECONDS=180/Math.PI*3600;
const RAD=Math.PI/180;
type Circle={x:number;y:number;r:number};
export function telescopeOptics(p:Record<string,number>) {
  const fe=p.f2*p.k2,a=1-p.d/p.f1,c=-1/p.f1-a/fe,dd=1-p.d/fe;
  const afocal=Math.abs(c)<1e-12,q=Math.abs(p.d-fe)>1e-12?fe*p.d/(p.d-fe):null;
  const objectivePupil=q===null?null:Math.abs(fe/(p.d-fe))*p.aperture;
  const eyepieceLimits=Math.abs(a)*p.aperture>p.eyepieceDiameter+1e-9;
  return {fe,a,c:afocal?0:c,dd,afocal,M:afocal?-p.f1/fe:null,q,objectivePupil,eyepieceLimits,
    pupilPosition:eyepieceLimits?0:q,pupilDiameter:eyepieceLimits?p.eyepieceDiameter:objectivePupil,
    resolution:1.22*p.wavelength/1e6/p.aperture*ARCSECONDS};
}

// Pull all three circular apertures back to the objective plane. Their common
// area is the geometrical fraction of a uniform incident bundle entering the eye.
function acceptedPupil(p:Record<string,number>,theta:number,vertical=0) {
  const o=telescopeOptics(p),g=o.a+p.eyeDistance*o.c,b=p.d+p.eyeDistance*o.dd;
  const circles:Circle[]=[{x:0,y:0,r:p.aperture/2}];
  for(const [factor,shift,radius,offset] of [[o.a,p.d,p.eyepieceDiameter/2,0],[g,b,p.eyeDiameter/2,p.eyeOffset]]) {
    if(Math.abs(factor)<1e-12){if(Math.hypot(shift*theta-offset,shift*vertical)>=radius)return [];}
    else circles.push({x:(offset-shift*theta)/factor,y:-shift*vertical/factor,r:radius/Math.abs(factor)});
  }
  return circles;
}
export function telescopeThroughput(p:Record<string,number>,theta:number,vertical=0) {
  const circles=acceptedPupil(p,theta,vertical);if(!circles.length)return 0;
  // Exact containment avoids integration error at the fully illuminated plateau.
  const smallest=circles.reduce((a,b)=>a.r<b.r?a:b);
  if(circles.every(c=>Math.hypot(c.x-smallest.x,c.y-smallest.y)+smallest.r<=c.r+1e-10))return Math.min(1,(smallest.r/(p.aperture/2))**2);
  const low=Math.max(...circles.map(c=>c.x-c.r)),high=Math.min(...circles.map(c=>c.x+c.r));if(high<=low)return 0;
  let area=0;const steps=192,dx=(high-low)/steps;
  for(let i=0;i<steps;i++){const x=low+(i+.5)*dx;let bottom=-Infinity,top=Infinity;for(const c of circles){const h=Math.sqrt(Math.max(0,c.r*c.r-(x-c.x)**2));bottom=Math.max(bottom,c.y-h);top=Math.min(top,c.y+h);}area+=Math.max(0,top-bottom)*dx;}
  return Math.max(0,Math.min(1,area/(Math.PI*(p.aperture/2)**2)));
}
// Horizontal angular interval with a non-zero overlap of collinear pupils.
// Restrict it to ±3°: this model does not extrapolate paraxial rays to wide angles.
export function telescopeField(p:Record<string,number>):[number,number]|null {
  const o=telescopeOptics(p);if(!o.afocal)return null;
  const g=o.a+p.eyeDistance*o.c,b=p.d+p.eyeDistance*o.dd;
  const disks=[{k:0,t:0,r:p.aperture/2}];let low=-3*RAD,high=3*RAD;
  const constrain=(k:number,t:number,r:number)=>{if(Math.abs(k)<1e-12){if(Math.abs(t)>=r){low=1;high=-1;}return;}const a=(-r-t)/k,z=(r-t)/k;low=Math.max(low,Math.min(a,z));high=Math.min(high,Math.max(a,z));};
  for(const [factor,shift,r,offset] of [[o.a,p.d,p.eyepieceDiameter/2,0],[g,b,p.eyeDiameter/2,p.eyeOffset]]){
    if(Math.abs(factor)<1e-12)constrain(shift,-offset,r);
    else disks.push({k:-shift/factor,t:offset/factor,r:r/Math.abs(factor)});
  }
  for(let i=0;i<disks.length;i++)for(let j=0;j<i;j++)constrain(disks[i].k-disks[j].k,disks[i].t-disks[j].t,disks[i].r+disks[j].r);
  return high>low?[low/RAD,high/RAD]:null;
}

export function immediateTelescope(state:SceneState):SceneResult {
  const p=state.parameters,o=telescopeOptics(p),theta=p.angle*RAD,field=telescopeField(p),fraction=telescopeThroughput(p,theta);
  const metric=(key:string,label:string,value:number|null,unit='',note='')=>({key,label,value,unit,note});
  const metrics=[metric('afocalLength','平行出射所需间距',p.f1+o.fe,'mm'),metric('angularM','角放大率 M',o.M,'倍'),metric('centralAngle','中心光线出射方向',o.dd*p.angle,'°'),metric('angularSpread','出射角全宽',Math.abs(o.c)*p.aperture*1000,'mrad'),metric('resolution','物镜角分辨率',o.resolution,'角秒'),metric('pupilPosition','出瞳距目镜',o.pupilPosition,'mm'),metric('pupilDiameter','出瞳直径',o.pupilDiameter,'mm'),metric('acceptedLight','入眼光束比例',fraction*100,'%'),metric('visibleField','近轴内可见视场',field?field[1]-field[0]:o.afocal?0:null,'°')];
  const xmin=-p.f1*.45,xmax=p.d+Math.max(80,p.eyeDistance*1.2,Math.abs(o.fe)*2),segments:SceneResult['segments']=[];
  let ymax=Math.max(15,p.aperture*.75,p.eyepieceDiameter*.75,Math.abs(theta*p.f1)*1.3);
  const seg=(start:[number,number],end:[number,number],role:string)=>segments.push({start,end,role,dashed:false,power:1});
  for(const h of [-p.aperture/2,0,p.aperture/2]){const t1=theta-h/p.f1,y2=h+p.d*t1,t2=t1-y2/o.fe;seg([xmin,h+xmin*theta],[0,h],'incident');seg([0,h],[p.d,y2],Math.abs(y2)>p.eyepieceDiameter/2?'blocked':'internal');if(Math.abs(y2)<=p.eyepieceDiameter/2)seg([p.d,y2],[xmax,y2+(xmax-p.d)*t2],'transmitted');ymax=Math.max(ymax,Math.abs(y2)*1.3);}
  const warnings:string[]=[];if(p.study!==2&&!o.afocal)warnings.push('两镜间距偏离对焦位置；请恢复平行出射后比较放大率与视场。');
  if(p.study!==2&&Math.max(...segments.filter(s=>s.role==='transmitted').map(s=>Math.abs((s.end[1]-s.start[1])/(s.end[0]-s.start[0]))))>.15)warnings.push('出射倾角较大，近轴模型的结果仅供近似参考。');
  let curve:SceneResult['curve'],chart:SceneResult['chart'];
  if(p.study===2){curve=Array.from({length:101},(_,i)=>{const D=5+i*.75;return {x:D,y:1.22*p.wavelength/1e6/D*ARCSECONDS};});chart={xLabel:'物镜有效直径 / mm',yLabel:'角分辨率 / 角秒',currentX:p.aperture,currentY:o.resolution};}
  else if(p.study===1||p.study===3){curve=Array.from({length:121},(_,i)=>({x:-3+i*.05,y:o.afocal?telescopeThroughput(p,(-3+i*.05)*RAD)*100:null}));chart={xLabel:'远物方向 / °',yLabel:'入眼光束比例 / %',currentX:p.angle,currentY:o.afocal?fraction*100:null};}
  else{curve=Array.from({length:161},(_,i)=>{const h=-p.aperture/2+i*p.aperture/160;return {x:h,y:(o.c*h+o.dd*theta)/RAD};});chart={xLabel:'物镜入射高度 / mm',yLabel:'出射角 / °',currentX:0,currentY:o.dd*p.angle};}
  return {revision:sceneKey(state),input:state,modelVersion:'telescope-study-1',model:'telescope',scope:SCENE_DEFINITIONS[state.sceneId].scope,status:o.afocal?(o.fe>0?'开普勒倒像，平行出射':'伽利略正像，平行出射'):'未对焦：出射光不平行',metrics,warnings,bounds:[xmin,xmax,-ymax,ymax],segments,markers:0<p.f1&&p.f1<p.d?[{x:p.f1,y:p.f1*theta,label:'中间像',role:'image'}]:[],regions:[],devices:[{kind:'lens',x:0,height:p.aperture/2,label:'物镜',sign:1},{kind:'lens',x:p.d,height:p.eyepieceDiameter/2,label:'目镜',sign:p.k2}],curve,chart,imagePreview:null};
}

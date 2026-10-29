import { SCENE_DEFINITIONS, sceneKey, type SceneResult, type SceneState } from './sceneRuntime';
import { immediateTelescope } from './telescopeModel';
import { immediateCamera } from './cameraModel';
import { immediateAperture } from './apertureModel';
import { immediateAberration } from './aberrationModel';
import { immediateCameraMicroscope } from './microscopeCamera';
import { immediateMicroscopePerformance, microscopeFieldResult } from './microscopePerformance';
import {normalizeMicroscope} from './microscopeFocus';
const RAD=Math.PI/180;
export function refraction(n1:number,n2:number,angle:number) {
  let s=n1/n2*Math.sin(angle*RAD);
  if(s>1+1e-12)return null;
  if(Math.abs(Math.abs(s)-1)<1e-12)s=Math.sign(s);
  return Math.asin(Math.max(-1,Math.min(1,s)))/RAD;
}
export function fresnel(n1:number,n2:number,i:number) {
  const t=refraction(n1,n2,i);
  if(t===null)return {angle:null,R:1,T:0};
  const ci=Math.cos(i*RAD),ct=Math.cos(t*RAD);
  const rs=n1===n2?0:((n1*ci-n2*ct)/(n1*ci+n2*ct))**2;
  const rp=n1===n2?0:((n2*ci-n1*ct)/(n2*ci+n1*ct))**2;
  const R=(rs+rp)/2;
  return {angle:t,R,T:1-R};
}
// Synchronous scene calculations keep the plot, readings and curve on the same frame.
// Server calculations remain the independent reference for formulas and the assistant.
export function immediateScene(state:SceneState):SceneResult|null {
  state=normalizeMicroscope(state);
  const definition=SCENE_DEFINITIONS[state.sceneId];
  if(definition.model==='camera')return immediateCamera(state);
  if(definition.model==='aperture')return immediateAperture(state);
  if(definition.model==='aberration')return immediateAberration(state);
  if(definition.model==='microscope'&&(state.parameters.study===1||state.parameters.study===3))return immediateMicroscopePerformance(state);
  if(definition.model==='telescope')return immediateTelescope(state);
  if(definition.model==='prism')return immediatePrism(state);
  if(definition.model==='lens')return immediateLens(state);
  if(definition.model==='mirror')return immediateMirror(state);
  if(definition.model==='double-lens'||definition.model==='microscope'){const result=definition.model==='microscope'&&state.parameters.mode===1?immediateCameraMicroscope(state):immediateDoubleLens(state);return definition.model==='microscope'&&state.parameters.study===2&&state.parameters.mode===0?microscopeFieldResult(result):result;}
  if(definition.model!=='interface')return null;
  const {n1,n2,angle:i}=state.parameters,r=fresnel(n1,n2,i);
  const critical=n1>n2?Math.asin(n2/n1)/RAD:null;
  const status=r.angle===null?'全反射：透射功率为零':critical!==null&&Math.abs(i-critical)<1e-8?'临界角：折射光沿界面传播':r.R>1e-12?'反射与折射同时存在':'无反射，光线继续传播';
  const segments:SceneResult['segments']=[{start:[-Math.sin(i*RAD),Math.cos(i*RAD)],end:[0,0],role:'incident',dashed:false,power:1},{start:[0,0],end:[Math.sin(i*RAD),Math.cos(i*RAD)],role:'reflected',dashed:false,power:r.R}];
  if(r.angle!==null)segments.push({start:[0,0],end:[Math.sin(r.angle*RAD),-Math.cos(r.angle*RAD)],role:'transmitted',dashed:false,power:r.T});
  return {revision:sceneKey(state),input:state,modelVersion:'scene-physics-1',model:'interface',scope:definition.scope,status,warnings:[],bounds:[-1.25,1.25,-1.15,1.15],segments,markers:[],regions:[],
    metrics:[{key:'reflectedAngle',label:'反射角',value:i,unit:'°',note:''},{key:'transmittedAngle',label:'折射角',value:r.angle,unit:'°',note:r.angle===null?'无传播折射光':''},{key:'criticalAngle',label:'临界角',value:critical,unit:'°',note:critical===null?'n₁ ≤ n₂，无全反射临界角':''},{key:'R',label:'反射功率比例 R',value:r.R*100,unit:'%',note:''},{key:'T',label:'透射功率比例 T',value:r.T*100,unit:'%',note:''}],
    curve:Array.from({length:181},(_,j)=>{const a=j*89.9/180;return {x:a,y:fresnel(n1,n2,a).R*100};}),chart:{xLabel:'入射角 / °',yLabel:'反射功率 / %',currentX:i,currentY:r.R*100}};
}

function immediateLens(state:SceneState):SceneResult {
  const definition=SCENE_DEFINITIONS[state.sceneId],{f:magnitude,kind,u,h}=state.parameters,f=magnitude*kind;
  const denominator=1/f-1/u,v=Math.abs(denominator)>1e-12?1/denominator:null,m=v===null?null:-v/u,imageH=m===null?null:m*h;
  const extent=Math.min(1600,Math.max(u,Math.abs(v??0),Math.abs(f)*2)*1.18);
  const xmin=Math.max(-1600,-Math.max(u*1.2,v!==null&&v<0?Math.abs(v)*1.15:Math.abs(f)*1.3)),xmax=Math.max(Math.abs(f)*1.8,Math.min(extent,(v??0)*1.15));
  const ymax=Math.min(300,Math.max(h*2.5,Math.abs(imageH??0)*1.25,25)),segments:SceneResult['segments']=[],markers:SceneResult['markers']=[{x:-u,y:h,label:'物体',role:'object'}],warnings:string[]=[];
  const segment=(start:[number,number],end:[number,number],role:string,dashed=false)=>segments.push({start,end,role,dashed,power:1});
  for(const [y0,slope] of [[h,-h/f],[0,-h/u]]){
    segment([-u,h],[0,y0],'incident');segment([0,y0],[xmax,y0+slope*xmax],'transmitted');
    if(v!==null&&v<0)segment([0,y0],[v,imageH!],'virtual',true);
  }
  if(v!==null&&xmin<v&&v<xmax&&Math.abs(imageH!)<ymax)markers.push({x:v,y:imageH!,label:v<0?'虚像':'实像',role:'image'});
  markers.push({x:f,y:0,label:'F′',role:'focus'},{x:-f,y:0,label:'F',role:'focus'},{x:0,y:ymax*.88,label:'薄透镜',role:'annotation'});
  if(v!==null&&Math.abs(v)>1500)warnings.push('像接近无穷远，超出图中范围；读数仍为实际像距。');
  if(h/u>.1||h/Math.abs(f)>.1)warnings.push('图中光线用于说明理想成像；物体高度相对距离较大时，真实透镜的近轴近似可能失效。');
  const metric=(key:string,label:string,value:number|null,unit='',note='')=>({key,label,value,unit,note});
  return {revision:sceneKey(state),input:state,modelVersion:'scene-physics-1',model:'lens',scope:definition.scope,warnings,bounds:[xmin,xmax,-ymax,ymax],segments,markers,regions:[],
    status:v===null?'物在焦平面：出射光平行':v>0?'倒立实像':'正立虚像',
    metrics:[metric('f','有向焦距',f,'mm'),metric('v','像距 v',v,'mm',v===null?'像在无穷远，出射光平行':v<0?'负像距表示虚像':'正像距表示实像'),metric('m','横向放大率 m',m),metric('imageHeight','像高 h′',imageH,'mm')],
    curve:Array.from({length:241},(_,j)=>{const distance=10+j*590/240,den=1/f-1/distance;return {x:distance,y:Math.abs(den)>1e-9&&Math.abs(1/den)<1500?1/den:null};}),chart:{xLabel:'物距 / mm',yLabel:'像距 / mm',currentX:u,currentY:v}};
}

function immediateMirror(state:SceneState):SceneResult {
  const definition=SCENE_DEFINITIONS[state.sceneId],{R,kind,u,h}=state.parameters,f=R*kind/2;
  const imageDistance=(distance:number)=>{const den=1/f-1/distance;return Math.abs(den)>1e-12?1/den:null;};
  const v=imageDistance(u),m=v===null?null:-v/u,imageH=m===null?null:m*h;
  const xmin=-Math.min(1800,Math.max(u*1.18,(v??0)*1.15,Math.abs(f)*1.5)),xmax=Math.min(1800,Math.max(60,-(v??0)*1.18,Math.abs(f)*.4));
  const ymax=Math.min(250,Math.max(25,h*2.5,Math.abs(imageH??0)*1.3)),segments:SceneResult['segments']=[],warnings:string[]=[];
  const markers:SceneResult['markers']=[{x:-u,y:h,label:'物体',role:'object'},{x:-f,y:0,label:'F',role:'focus'},{x:-2*f,y:0,label:'C',role:'focus'}];
  const segment=(start:[number,number],end:[number,number],role:string,dashed=false)=>segments.push({start,end,role,dashed,power:1});
  for(const [y0,slope] of [[h,h/f],[0,h/u]]){
    segment([-u,h],[0,y0],'incident');segment([0,y0],[xmin,y0+slope*xmin],'reflected');
    if(v!==null&&v<0)segment([0,y0],[-v,imageH!],'virtual',true);
  }
  if(v!==null&&xmin<-v&&-v<xmax&&Math.abs(imageH!)<ymax)markers.push({x:-v,y:imageH!,label:v>0?'实像':'虚像',role:'image'});
  if(h/u>.1||h/Math.abs(f)>.1)warnings.push('本图采用近轴球面镜模型；大孔径或大角度的球差未包含。');
  if(v!==null&&Math.abs(v)>1700)warnings.push('像超出图中范围，读数保留实际像距。');
  const metric=(key:string,label:string,value:number|null,unit='',note='')=>({key,label,value,unit,note});
  return {revision:sceneKey(state),input:state,modelVersion:'scene-physics-2',model:'mirror',scope:definition.scope,warnings,bounds:[xmin,xmax,-ymax,ymax],segments,markers,regions:[],imagePreview:null,
    devices:[{kind:'mirror',x:0,height:ymax*.65,label:f>0?'凹面镜':'凸面镜',sign:kind}],status:v===null?'物在焦平面：反射光平行':v>0?'镜前倒立实像':'镜后正立虚像',
    metrics:[metric('f','有向焦距 f',f,'mm'),metric('v','像距 v',v,'mm',v===null?'像在无穷远':'正值为镜前实像，负值为镜后虚像'),metric('m','横向放大率 m',m),metric('imageHeight','像高 h′',imageH,'mm')],
    curve:Array.from({length:241},(_,j)=>{const distance=10+j*790/240,value=imageDistance(distance);return {x:distance,y:value!==null&&Math.abs(value)<1500?value:null};}),chart:{xLabel:'物距 / mm',yLabel:'像距 / mm',currentX:u,currentY:v}};
}

function immediateDoubleLens(state:SceneState):SceneResult {
  const definition=SCENE_DEFINITIONS[state.sceneId],microscope=definition.model==='microscope',{u,h,d}=state.parameters,f1=state.parameters.f1*(state.parameters.k1??1),f2=state.parameters.f2*(state.parameters.k2??1);
  const image=(spacing:number)=>{
    const a=1-spacing/f1,b=u+spacing*(1-u/f1),c=-1/f1-a/f2,dd=1-u/f1-b/f2;
    const v=Math.abs(dd)>1e-12?-b/dd:null;
    return {a,b,c,dd,v,m:v===null?null:a+v*c};
  };
  const {b,c,dd,v,m}=image(d),ih=m===null?null:m*h,den=1/f1-1/u,v1=Math.abs(den)>1e-12?1/den:null,m1=v1===null?null:-v1/u;
  const fe=Math.abs(c)>1e-12?1/(1/f1+1/f2-d/(f1*f2)):null;
  const xmin=-Math.min(1800,Math.max(u*1.2,-(d+(v??0))*1.12,30)),xmax=Math.min(2200,Math.max(d+Math.abs(f2)*1.5,d+(v??0)*1.15,d*1.25));
  const intermediateH=m1===null?0:m1*h;
  let ymax=Math.min(250,Math.max(microscope?.5:20,h*2.5,Math.abs(ih??0)*1.25,v1!==null&&v1>0&&v1<d?Math.abs(intermediateH)*1.5:0));
  const segments:SceneResult['segments']=[],markers:SceneResult['markers']=[],warnings:string[]=[],y2s:number[]=[],angles:number[]=[];
  const segment=(start:[number,number],end:[number,number],role:string,dashed=false)=>segments.push({start,end,role,dashed,power:1});
  const angular=v===null&&m1!==null?m1*state.parameters.near/f2:v!==null&&v<0&&Math.abs(v)>1e-9?m!*state.parameters.near/Math.abs(v):null;
  if(microscope){if(v1===null||v1<=0||v1>=d)warnings.push('此配置未在两片透镜之间形成常规显微镜中间实像；按实际双透镜光路显示。');if(v!==null&&v>0)warnings.push('最终为实像，可作投影；不采用常规目视显微镜角放大率。');}
  for(const y1 of [h,0]){
    const t1=(y1-h)/u-y1/f1,y2=y1+d*t1,t2=t1-y2/f2;y2s.push(y2);angles.push(Math.abs((y1-h)/u),Math.abs(t1),Math.abs(t2));
    segment([-u,h],[0,y1],'incident');segment([0,y1],[d,y2],'internal');segment([d,y2],[xmax,y2+(xmax-d)*t2],'transmitted');
    if(v!==null&&v<0)segment([d,y2],[d+v,ih!],'virtual',true);
  }
  ymax=Math.min(400,Math.max(ymax,...y2s.map(y=>Math.abs(y)*1.5)));
  markers.push({x:-u,y:h,label:'物体',role:'object'});
  if(v1!==null&&v1>0&&v1<d&&Math.abs(intermediateH)<ymax)markers.push({x:v1,y:intermediateH,label:'中间像',role:'image'});
  if(v!==null&&xmin<d+v&&d+v<xmax&&Math.abs(ih!)<ymax)markers.push({x:d+v,y:ih!,label:v>0?'最终实像':'最终虚像',role:'image'});
  if(v!==null&&Math.abs(v)>2000)warnings.push('最终像超出图中范围，读数仍为实际像距。');
  if(h/u>.1)warnings.push('物体角度较大，实际系统可能超出近轴近似；未计算像差。');
  else if(Math.max(...angles)>.15)warnings.push('部分内部或出射光线倾角较大，真实系统可能超出近轴近似。');
  const metric=(key:string,label:string,value:number|null,unit='',note='')=>({key,label,value,unit,note});
  return {revision:sceneKey(state),input:state,modelVersion:'scene-physics-2',model:definition.model,scope:definition.scope,
    status:v===null?'最终像在无穷远：出射光平行':(m!<0?'倒立':'正立')+(v>0?'最终实像':'最终虚像'),warnings,bounds:[xmin,xmax,-ymax,ymax],segments,markers,regions:[],imagePreview:null,
    devices:[{kind:'lens',x:0,height:ymax*.65,label:microscope?'物镜':'透镜 1',sign:f1>0?1:-1},{kind:'lens',x:d,height:ymax*.65,label:microscope?'目镜':'透镜 2',sign:f2>0?1:-1}],
    metrics:[metric('v1',microscope?'中间像距 v₁':'第一片像距 v₁',v1,'mm'),metric('v',microscope?'距目镜的像距 v₂':'最终像距 v₂',v,'mm',v===null?'最终像在无穷远':'负像距为出射光的反向延长线相交；第二片前方可能有第一片形成的实像'),metric('m','总横向放大率 m',m),metric('equivalentFocal','系统等效焦距 F',fe,'mm',fe===null?'无焦系统':'从系统主面量起；不等于距第二片的后焦距'),metric('matrixB','光线传递系数 B',b,'mm'),metric('matrixD','光线传递系数 D',Math.abs(dd)<1e-12?0:dd,'无量纲'),...(microscope?[metric('objectiveM','物镜横向放大率',m1),metric('angularM','目视角放大率',angular,'倍','眼位于目镜附近，参考明视距离；只用于最终虚像或无穷远像'),metric('fieldDiameter','目视视野直径',angular!==null&&m1!==null&&v1!==null&&0<v1&&v1<d?state.parameters.fieldNumber/Math.abs(m1):null,'mm','由中间像面视场数估算')]:[])],
    curve:Array.from({length:241},(_,j)=>{const spacing=microscope?40+j*260/240:10+j*590/240,value=image(spacing).v;return {x:spacing,y:value!==null&&Math.abs(value)<1500?value:null};}),chart:{xLabel:microscope?'物镜到目镜距离 / mm':'透镜间距 / mm',yLabel:microscope?'距目镜的像距 / mm':'距第二片的像距 / mm',currentX:d,currentY:v}};
}

function immediatePrism(state:SceneState):SceneResult {
  const definition=SCENE_DEFINITIONS[state.sceneId],{n,outside,apex:A,angle:i}=state.parameters;
  const r1=refraction(outside,n,i),q=Math.tan(A*RAD/2),entry:[number,number]=[-q*.5,.5],phi0=(-A/2+i)*RAD;
  const segments:SceneResult['segments']=[{start:[entry[0]-.8*Math.cos(phi0),entry[1]-.8*Math.sin(phi0)],end:entry,role:'incident',dashed:false,power:1}],markers:SceneResult['markers']=[],warnings:string[]=[];
  const segment=(a:[number,number],b:[number,number],role:string)=>segments.push({start:a,end:b,role,dashed:false,power:1});
  let e:number|null=null,delta:number|null=null,r2:number|null=null,status='第一面全反射，光未进入棱镜';
  if(r1===null){const normal=[Math.cos(-A*RAD/2),Math.sin(-A*RAD/2)],dot=Math.cos(phi0)*normal[0]+Math.sin(phi0)*normal[1];segment(entry,[entry[0]+.7*(Math.cos(phi0)-2*dot*normal[0]),entry[1]+.7*(Math.sin(phi0)-2*dot*normal[1])],'reflected');}
  else {
    r2=A-r1;const phi=(-A/2+r1)*RAD,dx=Math.cos(phi),dy=Math.sin(phi),length=(q*(1-entry[1])-entry[0])/(dx+q*dy),exit:[number,number]=[entry[0]+length*dx,entry[1]+length*dy];segment(entry,exit,'internal');
    if(exit[1]<0||exit[1]>1){const l=dy<0?-entry[1]/dy:(1-entry[1])/dy;segments.at(-1)!.end=[entry[0]+l*dx,entry[1]+l*dy];status='主光线未到达第二斜面，此配置不适用两斜面偏折公式';warnings.push('主光线到达底面；本场景不追迹底面出射。');}
    else {e=refraction(n,outside,r2);if(e===null){const normal=[Math.cos(A*RAD/2),Math.sin(A*RAD/2)],dot=dx*normal[0]+dy*normal[1],rx=dx-2*dot*normal[0],ry=dy-2*dot*normal[1],distances:number[]=[];if(ry< -1e-12)distances.push(-exit[1]/ry);const den=rx-q*ry;if(Math.abs(den)>1e-12){const d=(-q*(1-exit[1])-exit[0])/den;if(d>1e-9)distances.push(d);}const l=distances.length?Math.min(...distances):.3;segment(exit,[exit[0]+l*rx,exit[1]+l*ry],'reflected');status='第二面全反射，没有该面的出射主光线';}
      else {delta=i+e-A;const phi=(A/2-e)*RAD;segment(exit,[exit[0]+.8*Math.cos(phi),exit[1]+.8*Math.sin(phi)],'transmitted');status='两次折射后的主光线';}
      markers.push({x:exit[0]+.08,y:exit[1]+.15,label:e===null?'全反射':`e = ${e.toFixed(2)}°`,role:'annotation'});
    }
  }
  const sine=n/outside*Math.sin(A*RAD/2),minimum=sine<=1?2*Math.asin(sine)/RAD-A:null;
  markers.push({x:0,y:1.1,label:`A = ${A.toFixed(1)}°`,role:'annotation'},{x:-.7,y:-.1,label:`n = ${n}，n₀ = ${outside}`,role:'annotation'});
  const metric=(key:string,label:string,value:number|null,note='')=>({key,label,value,unit:'°',note});
  return {revision:sceneKey(state),input:state,modelVersion:'scene-physics-1',model:'prism',scope:definition.scope,status,warnings,segments,markers,regions:[{points:[[-q,0],[0,1],[q,0]],label:'棱镜'}],bounds:[-1.35,1.35,-.5,1.5],metrics:[metric('r1','第一面折射角',r1),metric('r2','第二面内部入射角',r2===null?null:Math.abs(r2)),metric('exitAngle','第二面出射角',e===null?null:Math.abs(e)),metric('deviation','有向偏折角 δ',delta),metric('minimumDeviation','对称光路偏折 δₛ',minimum,'n > n₀ 时为最小偏折；n < n₀ 时是负偏折的极值')],
    curve:Array.from({length:181},(_,j)=>{const a=j*89/180,b=refraction(outside,n,a);let c=b===null?null:refraction(n,outside,A-b);if(b!==null){const phi=(-A/2+b)*RAD,dx=Math.cos(phi),dy=Math.sin(phi),d=(q*(1-entry[1])-entry[0])/(dx+q*dy),y=entry[1]+d*dy;if(y<0||y>1)c=null;}return {x:a,y:c===null?null:a+c-A};}),chart:{xLabel:'第一面入射角 / °',yLabel:'有向偏折角 / °',currentX:i,currentY:delta}};
}

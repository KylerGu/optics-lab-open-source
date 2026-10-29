import {SCENE_DEFINITIONS,sceneKey,type SceneResult,type SceneState} from './sceneRuntime';

type Point=[number,number];
export const ABERRATION_COLORS:Record<number,string>={450:'#568cdc',550:'#40ac82',650:'#d98275'};
export function aberrationDimensions(p:Record<string,number>){
  const radius=p.R,aperture=p.diameter/2;
  return {radius,aperture,thickness:2*(radius-Math.sqrt(radius*radius-aperture*aperture))+p.edge};
}
export const aberrationIndex=(p:Record<string,number>,wavelength:number)=>p.A+p.B/(wavelength/1000)**2;
export function aberrationFocal(p:Record<string,number>,wavelength:number){
  const {radius:r,thickness:t}=aberrationDimensions(p),n=aberrationIndex(p,wavelength);
  const effective=1/((n-1)*(2/r-(n-1)*t/(n*r*r)));
  return {effective,back:effective*(1-(n-1)*t/(n*r))};
}
function refract(d:Point,normal:Point,n1:number,n2:number):Point|null{
  const cosine=-(d[0]*normal[0]+d[1]*normal[1]),eta=n1/n2,disc=1-eta*eta*(1-cosine*cosine);
  if(disc< -1e-12)return null;
  const factor=eta*cosine-Math.sqrt(Math.max(0,disc));
  return [eta*d[0]+factor*normal[0],eta*d[1]+factor*normal[1]];
}
/** Exact intersections and Snell refraction at both spherical surfaces. */
export function aberrationRay(p:Record<string,number>,height:number,wavelength:number){
  const {radius:r,thickness:t}=aberrationDimensions(p),n=aberrationIndex(p,wavelength),x=r-Math.sqrt(r*r-height*height),front:Point=[x,height];
  const inside=refract([1,0],[(x-r)/r,height/r],1,n);if(!inside)return null;
  const cx=t-r,ox=x-cx,dot=ox*inside[0]+height*inside[1],disc=dot*dot-(ox*ox+height*height-r*r);if(disc<0)return null;
  const candidates=[-dot-Math.sqrt(disc),-dot+Math.sqrt(disc)].filter(length=>length>1e-10&&x+length*inside[0]>=cx-1e-8).map(length=>[x+length*inside[0],height+length*inside[1]] as Point).sort((a,b)=>a[0]-b[0]);
  const back=candidates[0];if(!back)return null;
  const outgoing=refract(inside,[-(back[0]-cx)/r,-back[1]/r],n,1);if(!outgoing)return null;
  const focus=Math.abs(outgoing[1])>1e-14?back[0]-back[1]*outgoing[0]/outgoing[1]-t:null;
  return {front,back,inside,outgoing,focus};
}
export type AberrationDrag='aberration-screen'|'aberration-aperture'|'aberration-radius';
export function aberrationDrag(p:Record<string,number>,kind:AberrationDrag,delta:number){
  const key=kind==='aberration-screen'?'screen':kind==='aberration-aperture'?'diameter':'R';
  const field=SCENE_DEFINITIONS['aberrations-1'].parameters.find(f=>f.key===key)!;
  return {[key]:Math.max(field.min,Math.min(field.max,p[key]+delta))};
}
/** Screen absorbs actual light. These are geometric references with it removed. */
export function aberrationFocusGuides(result:SceneResult){
  const p=result.input.parameters,{thickness:t}=aberrationDimensions(p),waves=p.mode===1?[450,550,650]:[p.wavelength];
  const farthest=Math.max(...waves.map(wave=>t+aberrationFocal(p,wave).back));
  const screen=t+p.screen;if(screen>=farthest)return [];
  const endX=farthest+p.R*.04;
  return result.segments.filter(segment=>segment.role==='transmitted').map(segment=>{
    const slope=(segment.end[1]-segment.start[1])/(segment.end[0]-segment.start[0]);
    return {start:segment.end,end:[endX,segment.end[1]+(endX-screen)*slope] as Point,color:segment.color};
  });
}
export function immediateAberration(state:SceneState):SceneResult{
  const p=state.parameters,{radius:r,aperture:ap,thickness:t}=aberrationDimensions(p),focal=aberrationFocal(p,p.wavelength);
  const edge=aberrationRay(p,ap,p.wavelength)?.focus??null,blue=aberrationFocal(p,450).back,red=aberrationFocal(p,650).back;
  const wavelengths=p.mode===1?[450,550,650]:[p.wavelength],points:NonNullable<SceneResult['imagePreview']>['points']=[],squares:number[]=[];
  for(const wavelength of wavelengths)for(let j=0;j<64;j++){
    const ray=aberrationRay(p,ap*Math.sqrt((j+.5)/64),wavelength);if(!ray)continue;
    const rho=ray.back[1]+(t+p.screen-ray.back[0])*ray.outgoing[1]/ray.outgoing[0];squares.push(rho*rho);
    for(let k=0;k<8;k++){const phi=(k+j*.61803398875)*Math.PI*2/8;points.push({x:rho*Math.cos(phi),y:rho*Math.sin(phi),color:ABERRATION_COLORS[wavelength]??'#79a5cb'});}
  }
  const rms=squares.length?Math.sqrt(squares.reduce((a,b)=>a+b,0)/squares.length):null;
  const xmin=-r*.35,xmax=t+Math.max(p.screen*1.08,focal.back*1.2);let ymax=Math.max(ap*1.3,10);
  const front:Point[]=[],back:Point[]=[];for(let j=0;j<=40;j++){const y=-ap+2*ap*j/40;front.push([r-Math.sqrt(r*r-y*y),y]);const by=ap-2*ap*j/40;back.push([t-r+Math.sqrt(r*r-by*by),by]);}
  const segments:SceneResult['segments']=[];
  for(const wavelength of wavelengths)for(const j of [-1,-.65,-.25,.25,.65,1]){
    const height=ap*j,ray=aberrationRay(p,height,wavelength);if(!ray)continue;
    const end:Point=[t+p.screen,ray.back[1]+(t+p.screen-ray.back[0])*ray.outgoing[1]/ray.outgoing[0]],color=ABERRATION_COLORS[wavelength]??'#238771';
    for(const [start,finish,role]of [[ [xmin,height],ray.front,'incident'],[ray.front,ray.back,'internal'],[ray.back,end,'transmitted']] as [Point,Point,string][])segments.push({start,end:finish,role,color,dashed:false,power:1});
    ymax=Math.max(ymax,Math.abs(end[1])*1.1);
  }
  const metrics:SceneResult['metrics']=[];
  const metric=(key:string,label:string,value:number|null,unit='',note='')=>metrics.push({key,label,value,unit,note});
  metric('index','当前波长折射率',aberrationIndex(p,p.wavelength));metric('thickness','透镜中心厚度',t,'mm','由曲率、口径与边缘厚度共同确定');
  metric('effectiveFocal','近轴有效焦距',focal.effective,'mm','从主面量起；屏距从透镜后顶点量起');metric('backFocal','近轴后焦距',focal.back,'mm');
  metric('marginalFocus','边缘光线焦距',edge,'mm','从后顶点量起，按两次精确折射求交点');metric('longitudinalSA','纵向球差',edge===null?null:focal.back-edge,'mm','近轴后焦距减边缘光线焦距');
  metric('chromaticShift','红蓝近轴焦距差',red-blue,'mm','650 nm 后焦距减 450 nm 后焦距；使用可调教学色散模型');
  metric('rmsRadius','屏上几何均方根半径',rms,'mm','表示光线落点离中心的平均散开程度，越小越集中；均匀圆形入瞳取64个等面积环，三色等权。只含球差、色差与离焦');
  const markers:SceneResult['markers']=[{x:t+focal.back,y:0,label:'近轴焦点',role:'focus'}];if(edge!==null)markers.push({x:t+edge,y:0,label:'边缘焦点',role:'focus'});
  const curve=Array.from({length:121},(_,j)=>{const y=ap*j/120;return {x:y,y:aberrationRay(p,Math.max(1e-6,y),p.wavelength)?.focus??null};});
  return {revision:sceneKey(state),input:state,modelVersion:'scene-physics-3',model:'aberration',scope:SCENE_DEFINITIONS[state.sceneId].scope,
    status:p.mode===1?'红绿蓝光分别折射：球差与色差叠加':'单色平行入射：边缘与近轴光线焦点不同',metrics,segments,markers,regions:[{points:[...front,...back],label:'球面透镜'}],
    devices:[{kind:'screen',x:t+p.screen,height:Math.max(ap*1.3,10)*.85,label:'观察屏',sign:1}],bounds:[xmin,xmax,-ymax,ymax],curve,
    chart:{xLabel:'入射光线高度 / mm',yLabel:`${Number(p.wavelength.toPrecision(6))} nm 后焦距 / mm`,currentX:ap,currentY:edge},
    warnings:['折射率使用 n = A + B/λ² 的可调教学模型，不代表某一牌号玻璃；透镜两面采用精确折射，未计反射损耗、衍射与其他像差。'],
    imagePreview:{kind:'geometric-spots',diameter:0,center:0,extent:Math.max(.25,...points.map(q=>Math.hypot(q.x,q.y)*1.15)),points,note:'均匀圆形入瞳的几何光线落点；范围会自动缩放，请对照半径读数。未计算衍射。'}};
}

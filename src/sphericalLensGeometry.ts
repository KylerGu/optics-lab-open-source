import type { SpatialElement, Vec3 } from './builderModel';
import { add3, sub3, mul3, dot3, unit3, geometryFrame, glassIndex, refractDirection } from './spatialGeometry';

export const SPHERICAL_KINDS=['plano-convex-lens','biconvex-lens','plano-concave-lens','biconcave-lens','positive-meniscus-lens','negative-meniscus-lens'] as const;
export const isSphericalLens=(kind:string)=>SPHERICAL_KINDS.some(k=>k===kind);
export function defaultLensRadii(kind:string){return kind==='negative-meniscus-lens'?[100,50]:[kind.startsWith('bi')?100:50,100];}
export function lensRadii(e:SpatialElement){if(e.kind.endsWith('meniscus-lens'))return [e.frontRadiusMm,e.backRadiusMm];const sign=['plano-convex-lens','biconvex-lens'].includes(e.kind)?1:-1;return [sign*e.frontRadiusMm,e.kind.startsWith('bi')?-sign*e.backRadiusMm:0];}
export function sphericalSag(radius:number,rho:number){return radius===0?0:Math.sign(radius)*rho*rho/(Math.abs(radius)+Math.sqrt(Math.max(0,radius*radius-rho*rho)));}
export function lensSurfaces(e:SpatialElement,rho:number){const [r1,r2]=lensRadii(e);return [-e.centerThicknessMm/2+sphericalSag(r1,rho),e.centerThicknessMm/2+sphericalSag(r2,rho)];}
export function validateSphericalLens(e:SpatialElement){
  if(!isSphericalLens(e.kind))return;
  const a=e.diameterMm/2;
  if(e.frontRadiusMm<=a||!e.kind.startsWith('plano')&&e.backRadiusMm<=a)throw new Error('曲面半径必须大于透镜口径的一半。');
  const [front,back]=lensSurfaces(e,a);
  if(back-front<.1-1e-9)throw new Error('透镜边缘厚度至少为0.1 mm；请增加中心厚度、增大曲面半径或减小口径。');
  if(e.glass==='custom'&&e.refractiveIndex<=1)throw new Error('球面透镜材料的参考折射率必须大于1。');
  if(e.kind==='positive-meniscus-lens'&&e.frontRadiusMm>=e.backRadiusMm)throw new Error('正弯月透镜的前凸面半径须小于后凹面半径。');
  if(e.kind==='negative-meniscus-lens'){
    if(e.frontRadiusMm<=e.backRadiusMm)throw new Error('负弯月透镜的前凸面半径须大于后凹面半径。');
    const focal=lensFocalLengths(e).effective;
    if(focal===null||focal>=0)throw new Error('当前厚度或材料使负弯月透镜不再发散；请减薄透镜或调整曲面半径。');
  }
}
export function lensFocalLengths(e:SpatialElement,wavelengthNm=587.56){
  const n=glassIndex(e,wavelengthNm),[r1,r2]=lensRadii(e),p1=(n-1)/r1,p2=r2?(1-n)/r2:0,power=p1+p2-e.centerThicknessMm/n*p1*p2;
  return Math.abs(power)<1e-12?{effective:null,back:null}:{effective:1/power,back:(1-e.centerThicknessMm/n*p1)/power};
}
export function lensProfile(e:SpatialElement){
  const points:[number,number][]=[];
  for(let i=0;i<=48;i++){const rho=e.diameterMm/2*i/48;points.push([rho,lensSurfaces(e,rho)[0]]);}
  for(let i=48;i>=0;i--){const rho=e.diameterMm/2*i/48;points.push([rho,lensSurfaces(e,rho)[1]]);}
  return points;
}
export type LensIntersection={distance:number;hit:Vec3;normal:Vec3;face:'front'|'back'|'edge'};
export function lensIntersection(e:SpatialElement,origin:Vec3,d:Vec3,inside=false):LensIntersection|null{
  const {n}=geometryFrame(e),a=e.diameterMm/2,[r1,r2]=lensRadii(e);let best:LensIntersection|null=null;
  const consider=(distance:number,normal:Vec3,face:LensIntersection['face'])=>{
    if(distance<=1e-5||distance>2000)return;
    const hit=add3(origin,mul3(d,distance)),local=sub3(hit,e.position),x=dot3(local,n),rho=Math.hypot(...sub3(local,mul3(n,x)));
    if(rho>a+1e-7)return;const [front,back]=lensSurfaces(e,Math.min(rho,a));
    if(x<front-1e-6||x>back+1e-6||face==='front'&&Math.abs(x-front)>1e-6||face==='back'&&Math.abs(x-back)>1e-6)return;
    const den=dot3(d,normal);if(inside?den<=1e-10:den>=-1e-10)return;
    if(!best||distance<best.distance)best={distance,hit,normal,face};
  };
  for(const [radius,vertex,face] of [[r1,-e.centerThicknessMm/2,'front'],[r2,e.centerThicknessMm/2,'back']] as const){
    if(radius===0){const den=dot3(d,n);if(Math.abs(den)>1e-10)consider((vertex-dot3(sub3(origin,e.position),n))/den,mul3(n,face==='front'?-1:1),face);}
    else {const center=add3(e.position,mul3(n,vertex+radius)),v=sub3(origin,center),b=dot3(v,d),disc=b*b-dot3(v,v)+radius*radius;if(disc<0)continue;
      for(const distance of [-b-Math.sqrt(disc),-b+Math.sqrt(disc)])consider(distance,unit3(mul3(sub3(add3(origin,mul3(d,distance)),center),(face==='front'?1:-1)/radius)),face);
    }
  }
  const local=sub3(origin,e.position),v=sub3(local,mul3(n,dot3(local,n))),w=sub3(d,mul3(n,dot3(d,n))),aa=dot3(w,w),bb=dot3(v,w),disc=bb*bb-aa*(dot3(v,v)-a*a);
  if(aa>1e-12&&disc>=0)for(const distance of [(-bb-Math.sqrt(disc))/aa,(-bb+Math.sqrt(disc))/aa])consider(distance,unit3(add3(v,mul3(w,distance))),'edge');
  return best;
}
export function lensExit(e:SpatialElement,entry:LensIntersection,incoming:Vec3,wavelengthNm:number){
  if(entry.face==='edge')return null;
  const index=glassIndex(e,wavelengthNm);let {direction}=refractDirection(incoming,entry.normal,1,index),origin=entry.hit;
  const path:{start:Vec3;end:Vec3;direction:Vec3}[]=[];
  for(let i=0;i<16;i++){const next=lensIntersection(e,origin,direction,true);if(!next)return null;
    path.push({start:origin,end:next.hit,direction});if(next.face==='edge')return null;
    const out=refractDirection(direction,next.normal,index,1);origin=next.hit;direction=out.direction;
    if(!out.tir)return {origin,direction,path};
  }return null;
}

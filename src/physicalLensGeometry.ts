import type { SpatialElement, Vec3 } from './builderModel';
import { add3, sub3, mul3, dot3, unit3, geometryFrame, glassIndex, refractDirection } from './spatialGeometry';
import { isSphericalLens, lensIntersection, lensSurfaces, lensFocalLengths, lensProfile, validateSphericalLens, type LensIntersection } from './sphericalLensGeometry';

export const ASPHERIC_KINDS=['aspheric-convex-lens','aspheric-concave-lens'] as const;
export const CYLINDER_KINDS=['plano-convex-cylinder-lens','plano-concave-cylinder-lens'] as const;
export const isAsphericLens=(kind:string)=>ASPHERIC_KINDS.some(k=>k===kind);
export const isSolidCylinder=(kind:string)=>CYLINDER_KINDS.some(k=>k===kind);
export const isProfileLens=(kind:string)=>isAsphericLens(kind)||isSolidCylinder(kind);
export const isPhysicalLens=(kind:string)=>isSphericalLens(kind)||isProfileLens(kind);
export function profileParameters(e:SpatialElement){return {c:(e.kind.includes('convex')?1:-1)/e.frontRadiusMm,k:isAsphericLens(e.kind)?e.conicConstant:0,a4:isAsphericLens(e.kind)?e.asphericA4:0,a6:isAsphericLens(e.kind)?e.asphericA6:0};}
export function profileSag(e:SpatialElement,r:number){const {c,k,a4,a6}=profileParameters(e);return c*r*r/(1+Math.sqrt(Math.max(0,1-(1+k)*c*c*r*r)))+a4*r**4+a6*r**6;}
export function profileSlope(e:SpatialElement,r:number){const {c,k,a4,a6}=profileParameters(e);return c*r/Math.sqrt(Math.max(1e-16,1-(1+k)*c*c*r*r))+4*a4*r**3+6*a6*r**5;}
export const physicalLensSpan=(e:SpatialElement)=>isSolidCylinder(e.kind)?e.cylinderWidthMm/2:e.diameterMm/2;
export const physicalLensSurfaces=(e:SpatialElement,r:number)=>isProfileLens(e.kind)?[-e.centerThicknessMm/2+profileSag(e,r),e.centerThicknessMm/2]:lensSurfaces(e,r);
export function physicalFocalLengths(e:SpatialElement,wavelengthNm=587.56){if(!isProfileLens(e.kind))return lensFocalLengths(e,wavelengthNm);const {c}=profileParameters(e),n=glassIndex(e,wavelengthNm),p=(n-1)*c;return Math.abs(p)<1e-12?{effective:null,back:null}:{effective:1/p,back:1/p-e.centerThicknessMm/n};}
export function withinClearAperture(e:SpatialElement,hit:Vec3){const {u,v}=geometryFrame(e),offset=sub3(hit,e.position),x=dot3(offset,u),y=dot3(offset,v);return isSolidCylinder(e.kind)?Math.abs(x)<=e.clearWidthMm/2+1e-7&&Math.abs(y)<=e.clearHeightMm/2+1e-7:Math.hypot(x,y)<=e.clearApertureMm/2+1e-7;}
export function validatePhysicalLens(e:SpatialElement){
  if(isPhysicalLens(e.kind)){if(isSolidCylinder(e.kind)?e.clearWidthMm>e.cylinderWidthMm+1e-9||e.clearHeightMm>e.cylinderHeightMm+1e-9:e.clearApertureMm>e.diameterMm+1e-9)throw new Error('有效通光尺寸不能超过镜片外形尺寸。');}
  if(!isProfileLens(e.kind))return validateSphericalLens(e);
  const a=physicalLensSpan(e),{c,k,a4,a6}=profileParameters(e),q=1-(1+k)*c*c*a*a,sign=Math.sign(c);
  if(q<1e-6)throw new Error('曲面超出有效范围；请增大顶点曲率半径、减小口径或调整圆锥常数。');
  const minimum=Math.abs(c)*Math.min(1,q**-1.5)+Math.min(0,12*sign*a4*a*a)+Math.min(0,30*sign*a6*a**4);
  if(minimum<=1e-9)throw new Error('高阶系数过大，不能保证曲面始终保持所选凸凹形状；请减小高阶系数。');
  const [front,back]=physicalLensSurfaces(e,a);if(back-front<.1-1e-9)throw new Error('透镜边缘厚度至少为0.1 mm；请增加中心厚度、增大半径或减小口径。');
  if(e.glass==='custom'&&e.refractiveIndex<=1)throw new Error('实体透镜材料的参考折射率必须大于1。');
}
export function physicalLensProfile(e:SpatialElement){if(!isProfileLens(e.kind))return lensProfile(e);const points:[number,number][]=[];for(let i=0;i<=64;i++){const r=physicalLensSpan(e)*i/64;points.push([r,physicalLensSurfaces(e,r)[0]]);}for(let i=64;i>=0;i--){const r=physicalLensSpan(e)*i/64;points.push([r,physicalLensSurfaces(e,r)[1]]);}return points;}
function quadraticRoots(a:number,b:number,c:number){if(Math.abs(a)<1e-14)return Math.abs(b)<1e-14?[]:[-c/b];const disc=b*b-4*a*c;if(disc<0)return [];const q=-.5*(b+(b>=0?1:-1)*Math.sqrt(disc));return Math.abs(q)<1e-14?[-b/(2*a)]:[q/a,c/q];}
export function physicalLensIntersection(e:SpatialElement,origin:Vec3,d:Vec3,inside=false):LensIntersection|null{
  if(!isProfileLens(e.kind))return lensIntersection(e,origin,d,inside);
  const {n,u,v}=geometryFrame(e),local=sub3(origin,e.position),o=[dot3(local,n),dot3(local,u),dot3(local,v)],w=[dot3(d,n),dot3(d,u),dot3(d,v)],cylinder=isSolidCylinder(e.kind),a=physicalLensSpan(e),h=e.cylinderHeightMm/2,{c,k,a4,a6}=profileParameters(e),vertex=-e.centerThicknessMm/2,back=e.centerThicknessMm/2;let best:LensIntersection|null=null;
  const consider=(t:number,face:LensIntersection['face'],outward?:Vec3)=>{
    if(t<=1e-5||t>2000)return;const [x,y,z]=o.map((value,i)=>value+t*w[i]),r=cylinder?Math.abs(y):Math.hypot(y,z);
    if(r>a+1e-7||cylinder&&Math.abs(z)>h+1e-7)return;const front=vertex+profileSag(e,Math.min(r,a));if(x<front-1e-6||x>back+1e-6)return;
    let normal=outward!;
    if(face==='front'){if(Math.abs(x-front)>1e-6)return;const slope=profileSlope(e,r),gu=r?slope*y/r:0,gv=cylinder||!r?0:slope*z/r;normal=unit3(add3(mul3(n,-1),add3(mul3(u,gu),mul3(v,gv))));}
    else if(face==='back'){if(Math.abs(x-back)>1e-6)return;normal=n;}
    const den=dot3(d,normal);if(inside?den<=1e-10:den>=-1e-10)return;
    if(!best||t<best.distance)best={distance:t,hit:add3(origin,mul3(d,t)),normal,face};
  };
  if(Math.abs(w[0])>1e-12)consider((back-o[0])/w[0],'back');
  if(!a4&&!a6){const z=o[0]-vertex,rw=w[1]**2+(cylinder?0:w[2]**2),ro=o[1]**2+(cylinder?0:o[2]**2),mixed=o[1]*w[1]+(cylinder?0:o[2]*w[2]),r=1/c;for(const t of quadraticRoots(rw+(1+k)*w[0]**2,2*(mixed+(1+k)*z*w[0]-r*w[0]),ro+(1+k)*z*z-2*r*z))consider(t,'front');}
  else {
    let lo=1e-5,hi=2000;
    const clip=(value:number,slope:number,minimum:number,maximum:number)=>{if(Math.abs(slope)<1e-14){if(value<minimum||value>maximum)hi=lo-1;}else{const [t1,t2]=[(minimum-value)/slope,(maximum-value)/slope].sort((a,b)=>a-b);lo=Math.max(lo,t1);hi=Math.min(hi,t2);}};
    clip(o[0],w[0],Math.min(vertex,vertex+profileSag(e,a)),back);
    const roots=quadraticRoots(w[1]**2+w[2]**2,2*(o[1]*w[1]+o[2]*w[2]),o[1]**2+o[2]**2-a*a);
    if(w[1]**2+w[2]**2>1e-14){if(roots.length===2){lo=Math.max(lo,Math.min(...roots));hi=Math.min(hi,Math.max(...roots));}else hi=lo-1;}else if(Math.hypot(o[1],o[2])>a)hi=lo-1;
    const f=(t:number)=>o[0]+t*w[0]-vertex-profileSag(e,Math.hypot(o[1]+t*w[1],o[2]+t*w[2]));
    const derivative=(t:number)=>{const y=o[1]+t*w[1],z=o[2]+t*w[2],r=Math.hypot(y,z);return w[0]-(r?profileSlope(e,r)*(y*w[1]+z*w[2])/r:0);};
    const bisect=(fn:(t:number)=>number,left:number,right:number)=>{let fl=fn(left);for(let i=0;i<55;i++){const middle=(left+right)/2,fm=fn(middle);if(fl*fm<=0)right=middle;else{left=middle;fl=fm;}}return (left+right)/2;};
    if(lo<=hi){const cuts=[lo,hi];if(derivative(lo)*derivative(hi)<0)cuts.splice(1,0,bisect(derivative,lo,hi));for(let i=1;i<cuts.length;i++){const left=cuts[i-1],right=cuts[i];if(Math.abs(f(left))<1e-8)consider(left,'front');if(Math.abs(f(right))<1e-8)consider(right,'front');if(f(left)*f(right)<0)consider(bisect(f,left,right),'front');}}
  }
  if(cylinder){for(const [axis,span,b] of [[1,a,u],[2,h,v]] as const)if(Math.abs(w[axis])>1e-12)for(const sign of [-1,1])consider((sign*span-o[axis])/w[axis],'edge',mul3(b,sign));}
  else for(const t of quadraticRoots(w[1]**2+w[2]**2,2*(o[1]*w[1]+o[2]*w[2]),o[1]**2+o[2]**2-a*a))consider(t,'edge',unit3(add3(mul3(u,o[1]+t*w[1]),mul3(v,o[2]+t*w[2]))));
  return best;
}
export function physicalLensExit(e:SpatialElement,entry:LensIntersection,incoming:Vec3,wavelengthNm:number){
  if(entry.face==='edge'||!withinClearAperture(e,entry.hit))return null;const index=glassIndex(e,wavelengthNm);let {direction}=refractDirection(incoming,entry.normal,1,index),origin=entry.hit;const path:{start:Vec3;end:Vec3;direction:Vec3}[]=[];
  for(let i=0;i<16;i++){const next=physicalLensIntersection(e,origin,direction,true);if(!next)return null;path.push({start:origin,end:next.hit,direction});if(next.face==='edge'||!withinClearAperture(e,next.hit))return null;const out=refractDirection(direction,next.normal,index,1);origin=next.hit;direction=out.direction;if(!out.tir)return {origin,direction,path};}return null;
}

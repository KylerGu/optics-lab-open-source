import type { SpatialElement, Vec3 } from './builderModel';
export const add3=(a:Vec3,b:Vec3):Vec3=>a.map((x,i)=>x+b[i]) as Vec3;
export const sub3=(a:Vec3,b:Vec3):Vec3=>a.map((x,i)=>x-b[i]) as Vec3;
export const mul3=(a:Vec3,k:number):Vec3=>a.map(x=>x*k) as Vec3;
export const dot3=(a:Vec3,b:Vec3)=>a.reduce((s,x,i)=>s+x*b[i],0);
export const cross3=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const unit3=(a:Vec3)=>mul3(a,1/Math.max(Math.hypot(...a),1e-12));
export function geometryFrame(e:Pick<SpatialElement,'yawDeg'|'pitchDeg'|'rollDeg'>){
  const yaw=e.yawDeg*Math.PI/180,pitch=e.pitchDeg*Math.PI/180,roll=(e.rollDeg??0)*Math.PI/180;
  const n:Vec3=[Math.cos(pitch)*Math.cos(yaw),Math.sin(pitch),Math.cos(pitch)*Math.sin(yaw)];
  const u=unit3(cross3(n,Math.abs(n[1])<.9?[0,1,0]:[0,0,1])),v=cross3(n,u);
  return {n,u:add3(mul3(u,Math.cos(roll)),mul3(v,Math.sin(roll))),v:add3(mul3(v,Math.cos(roll)),mul3(u,-Math.sin(roll)))};
}
export function prismVertices(e:SpatialElement):[number,number][]{
  const s=e.diameterMm;if(e.kind==='right-prism')return [[-s/3,-s/3],[2*s/3,-s/3],[-s/3,2*s/3]];
  const h=s/(2*Math.tan(e.apexAngleDeg*Math.PI/360));return [[-s/2,-h/3],[s/2,-h/3],[0,2*h/3]];
}
function prismPlanes(e:SpatialElement){
  const {n,u,v}=geometryFrame(e),vertices=prismVertices(e),planes=vertices.map(([x,y],i)=>{
    const [bx,by]=vertices[(i+1)%3];return {point:add3(e.position,add3(mul3(n,x),mul3(u,y))),normal:unit3(add3(mul3(n,by-y),mul3(u,x-bx)))};
  });return [...planes,{point:add3(e.position,mul3(v,e.prismHeightMm/2)),normal:v},{point:add3(e.position,mul3(v,-e.prismHeightMm/2)),normal:mul3(v,-1)}];
}
export function prismIntersection(e:SpatialElement,origin:Vec3,d:Vec3,inside=false){
  const planes=prismPlanes(e);let best:{distance:number;hit:Vec3;normal:Vec3}|null=null;
  for(const {point,normal} of planes){const den=dot3(d,normal);if(Math.abs(den)<1e-10||(inside?den<=0:den>=0))continue;
    const distance=dot3(sub3(point,origin),normal)/den;if(distance<=1e-5||distance>2000)continue;
    const hit=add3(origin,mul3(d,distance));if(planes.some(p=>dot3(sub3(hit,p.point),p.normal)>1e-6))continue;
    if(!best||distance<best.distance)best={distance,hit,normal};
  }return best;
}
export function glassIndex(e:SpatialElement,wavelengthNm:number){
  const w=wavelengthNm/1000;if(e.glass==='bk7')return Math.sqrt(1+[1.03961212,.231792344,1.01046945].reduce((s,b,i)=>s+b*w*w/(w*w-[.00600069867,.0200179144,103.560653][i]),0));
  const b=(e.refractiveIndex-1)/e.abbeNumber/(1/.48613**2-1/.65627**2);return e.refractiveIndex+b*(1/w**2-1/.58756**2);
}
export function refractDirection(d:Vec3,outward:Vec3,n1:number,n2:number){
  const n=dot3(d,outward)<0?outward:mul3(outward,-1),cosine=Math.max(0,Math.min(1,-dot3(d,n))),ratio=n1/n2,k=1-ratio*ratio*(1-cosine*cosine);
  return k<0?{direction:unit3(sub3(d,mul3(n,2*dot3(d,n)))),tir:true}:{direction:unit3(add3(mul3(d,ratio),mul3(n,ratio*cosine-Math.sqrt(k)))),tir:false};
}
export function prismExit(e:SpatialElement,entry:{hit:Vec3;normal:Vec3},incoming:Vec3,wavelengthNm:number){
  const index=glassIndex(e,wavelengthNm);let {direction}=refractDirection(incoming,entry.normal,1,index),origin=entry.hit;
  const path:{start:Vec3;end:Vec3;direction:Vec3}[]=[];
  for(let i=0;i<16;i++){const next=prismIntersection(e,origin,direction,true);if(!next)return null;
    path.push({start:origin,end:next.hit,direction});const out=refractDirection(direction,next.normal,index,1);origin=next.hit;direction=out.direction;
    if(!out.tir)return {origin,direction,path};
  }return null;
}

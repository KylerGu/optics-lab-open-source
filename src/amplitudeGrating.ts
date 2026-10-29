import type {SpatialElement,Vec3} from './builderModel';
import {geometryFrame,dot3} from './spatialGeometry';

export const isGrating=(e:SpatialElement)=>e.kind==='amplitude-grating';
export const gratingMountRadius=(e:SpatialElement)=>Math.max(30,Math.hypot(e.gratingWidthMm,e.gratingHeightMm)/2+5);
export function validateGrating(e:SpatialElement){
  if(isGrating(e)&&((e.gratingProfile==='binary'&&e.gratingSlitUm>e.gratingPeriodUm)||e.gratingWidthMm+1e-10<2*e.gratingPeriodUm*.001))throw new Error('透光条纹宽度 a 不能超过周期 d，通光宽度 W 至少覆盖两个周期。');
}
export function gratingOrderDirections(e:SpatialElement,direction:Vec3,wavelengthNm:number){
  const {n,u,v}=geometryFrame(e),ku=dot3(direction,u),kv=dot3(direction,v),kn=dot3(direction,n),spacing=wavelengthNm*.001/e.gratingPeriodUm,q=e.gratingSlitUm/e.gratingPeriodUm,limit=Math.sqrt(Math.max(0,1-kv*kv));
  const orders:{m:number;direction:Vec3;angleDeg:number;efficiency:number}[]=[];
  for(let m=Math.ceil((-limit-ku)/spacing);m<=Math.floor((limit-ku)/spacing);m++){
    if(e.gratingProfile==='sinusoidal'&&(Math.abs(m)>1||m!==0&&e.gratingModulation===0))continue;
    const outU=ku+m*spacing,square=1-outU*outU-kv*kv;if(square<=1e-12)continue;
    const coefficient=e.gratingProfile==='sinusoidal'?(m===0?1:e.gratingModulation/2)/(1+e.gratingModulation):m===0?q:Math.sin(Math.PI*m*q)/(Math.PI*m),efficiency=coefficient*coefficient,outN=(kn>=0?1:-1)*Math.sqrt(square);
    orders.push({m,direction:n.map((value,i)=>value*outN+u[i]*outU+v[i]*kv) as Vec3,angleDeg:Math.atan2(outU,Math.abs(outN))*180/Math.PI,efficiency:efficiency<1e-28?0:efficiency});
  }
  return orders.sort((a,b)=>Math.abs(a.m)-Math.abs(b.m)||a.m-b.m);
}

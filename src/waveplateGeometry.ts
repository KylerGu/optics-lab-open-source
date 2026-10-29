import { waveplate, fieldPoint, type WaveplateParameters } from './waveplate';

// Propagation +X, transverse U=-Z and V=+Y. Display space is schematic.
export const WAVEPLATE_INPUT_X=-3.8;
export const WAVEPLATE_OUTPUT_X=3.8;
export const WAVEPLATE_SPATIAL_K=2*Math.PI/2.4;
export function waveplateSpatialField(p:WaveplateParameters,x:number,phase:number,b=waveplate(p)){
  if(p.powerMw===0)return {x:0,y:0};
  const localPhase=phase+WAVEPLATE_SPATIAL_K*(WAVEPLATE_OUTPUT_X-x);
  if(x>=0)return fieldPoint(b,localPhase);
  const a=p.inputAngleDeg*Math.PI/180;
  return {x:Math.cos(a)*Math.cos(localPhase),y:Math.sin(a)*Math.cos(localPhase)};
}
export function waveplateAngleFromPlane(y:number,z:number){
  return Math.round(((Math.atan2(y,-z)*180/Math.PI+180)%180)*10)/10;
}

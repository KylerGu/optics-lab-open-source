import type {SceneResult,SceneState} from './sceneRuntime';

// Place the eye at the image of the objective aperture formed by the eyepiece.
// This is a display aid, not an extra surface in the microscope calculation.
export function microscopeEyePosition(state:SceneState,result:SceneResult){
  const {mode,study,d,f2}=state.parameters;
  const v=result.metrics.find(m=>m.key==='v')?.value;
  const v1=result.metrics.find(m=>m.key==='v1')?.value;
  // Real-image projection keeps its original complete ray diagram, without
  // inserting an observing eye in front of the projection plane.
  if(mode!==0||study!==0||d<=f2||v===undefined||v!==null&&v>0||v1==null||v1<=0)return null;
  const position=d+d*f2/(d-f2);
  return Number.isFinite(position)?position:null;
}

export function microscopeRayHeight(ray:SceneResult['segments'][number],position:number){
  return ray.start[1]+(position-ray.start[0])*(ray.end[1]-ray.start[1])/(ray.end[0]-ray.start[0]);
}

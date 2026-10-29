import type { SceneState } from './sceneRuntime';

export function symmetricPrismAngle(state:SceneState):number|null {
  const {n,outside,apex}=state.parameters;
  const sine=n/outside*Math.sin(apex*Math.PI/360);
  if(!Number.isFinite(sine)||sine<0||sine>1)return null;
  return Math.asin(sine)*180/Math.PI;
}

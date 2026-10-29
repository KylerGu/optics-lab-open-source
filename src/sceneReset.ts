import { defaultScene, type SceneState } from './sceneRuntime';

// Topic and observation mode select the current page, rather than a quantity to reset.
export function resetSceneParameters(current:SceneState):SceneState {
  const next=defaultScene(current.sceneId);
  for(const key of ['study','mode']){
    if(key in next.parameters)next.parameters[key]=current.parameters[key];
  }
  return next;
}

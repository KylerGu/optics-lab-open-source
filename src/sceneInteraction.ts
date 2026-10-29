import { parseScene, sceneKey, type SceneState } from './sceneRuntime';

export type SceneChangeSource = 'user'|'assistant'|'undo'|'redo'|'comparison'|'restore';
export interface SceneChange {before:SceneState;after:SceneState;source:SceneChangeSource}
export interface SceneInteraction {
  recentChange:SceneChange|null;
  comparison:{id:string;baseline:SceneState;shown:SceneState}|null;
}
export interface SceneInteractionControls {
  recentChange:SceneChange|null;
  selectedComparisonId:string|null;
  showComparison:(state:SceneState,id:string)=>boolean;
  restoreComparison:()=>boolean;
}
export const emptySceneInteraction = ():SceneInteraction => ({recentChange:null,comparison:null});
export function recordSceneChange(previous:SceneInteraction,before:SceneState,after:SceneState,source:SceneChangeSource):SceneInteraction {
  const start=parseScene(before),end=parseScene(after,start.sceneId);
  return {comparison:null,recentChange:sceneKey(start)===sceneKey(end)?previous.recentChange:{before:start,after:end,source}};
}
export function inspectSceneComparison(previous:SceneInteraction,current:SceneState,target:SceneState,id:string):SceneInteraction {
  const shown=parseScene(target,current.sceneId),before=previous.comparison?.shown??current;
  return {...recordSceneChange(previous,before,shown,'comparison'),comparison:{id,baseline:parseScene(previous.comparison?.baseline??current),shown}};
}
export function restoreSceneComparison(previous:SceneInteraction):SceneInteraction {
  const comparison=previous.comparison;
  return comparison?recordSceneChange(previous,comparison.shown,comparison.baseline,'restore'):previous;
}
export function changeForSnapshot(change:SceneChange|null,state:SceneState):SceneChange|null {
  return change&&sceneKey(change.after)===sceneKey(state)?structuredClone(change):null;
}

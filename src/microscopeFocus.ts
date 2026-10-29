import type {SceneState} from './sceneRuntime';

export function microscopeFocusDistance(p:Record<string,number>):number|null {
  const imageDistance=p.d-p.f2;
  const u=p.mode===1?p.f1:imageDistance>p.f1?p.f1*imageDistance/(imageDistance-p.f1):NaN;
  return Number.isFinite(u)&&u>=5&&u<=100?u:null;
}

// u is the saved physical position. z is its signed offset in micrometres:
// positive z means farther from the objective. Full snapshots preserve u.
export function normalizeMicroscope(state:SceneState):SceneState {
  if(state.sceneId!=='instruments-0')return state;
  const p=state.parameters,focus=microscopeFocusDistance(p),z=focus===null?0:(p.u-focus)*1000;
  return {...state,parameters:{...p,defocus:Math.abs(z)<1e-8?0:z,depthCriterion:p.mode===1?p.depthCriterion:0}};
}

export function patchSceneParameters(state:SceneState,patch:Record<string,number>):SceneState {
  let next={...state,parameters:{...state.parameters,...patch}};
  if(state.sceneId==='instruments-0'&&'defocus' in patch&&!('u' in patch)){
    const focus=microscopeFocusDistance(next.parameters);
    if(focus===null)throw new Error('当前镜组没有可调范围内的焦平面。');
    const u=focus+patch.defocus/1000;
    if(u<5-1e-10||u>100+1e-10)throw new Error('离焦位置超出物距调节范围。');
    next={...next,parameters:{...next.parameters,u:Math.max(5,Math.min(100,u))}};
  }
  return normalizeMicroscope(next);
}

export function microscopeDefocusRange(p:Record<string,number>):[number,number] {
  const focus=microscopeFocusDistance(p);
  return focus===null?[-50,50]:[Math.max((5-focus)*1000,Math.min(-50,p.defocus)),Math.min((100-focus)*1000,Math.max(50,p.defocus))];
}

import type {ReactNode} from 'react';
import {SceneAnswerProvider} from './SceneAnswer';
import {geometricalAnswerQuantities,type QuantitySelection} from './geometricalAnswerQuantities';
import {useCameraPresentation} from './CameraRayPresentation';
import {cameraAnnotationVisible} from './cameraAnnotations';
import {useTelescopePresentation} from './TelescopeRayPresentation';
import {useTelescopeResolution} from './TelescopeResolutionView';
import {useTelescopeEye} from './TelescopeEyeView';
import {useTelescopeField} from './TelescopeFieldView';
import {telescopeComparison,telescopeVisibleAnnotation} from './telescopeFieldPresentation';
import type {SceneState,SceneResult} from './sceneRuntime';

export default function GeometricalAnswerProvider({state,result,selection,children}:{state:SceneState;result:SceneResult|null;selection:QuantitySelection|null;children:ReactNode}){
  const camera=useCameraPresentation(),ray=useTelescopePresentation(),resolution=useTelescopeResolution(),eye=useTelescopeEye(),field=useTelescopeField();
  if(state.sceneId==='instruments-0')return children;
  let controls=selection;
  if(state.sceneId==='instruments-2')controls=camera?{...camera,selected:new Set([...camera.selected].filter(key=>cameraAnnotationVisible(camera.study,key,camera.fieldMode)))}:null;
  if(state.sceneId==='instruments-1'){
    controls=state.parameters.study===0?ray:state.parameters.study===2?resolution:state.parameters.study===3?eye:field?{
      selected:new Set([...(field.showRange?['skyAngle']:[]),...(field.showVisible?['visibleField']:[])]),
      toggle:key=>key==='skyAngle'?field.toggleRange():field.toggleVisible(),
      canMark:key=>key==='skyAngle'?field.reference||telescopeComparison(state.parameters)!==null:telescopeVisibleAnnotation(state.parameters,field.reference)!==null,
    }:null;
  }
  return <SceneAnswerProvider resolve={source=>geometricalAnswerQuantities(source,state,result,controls)}>{children}</SceneAnswerProvider>;
}

import { type ReactNode } from 'react';
import { CAMERA_STUDIES, cameraOptics } from './cameraModel';
import { SCENE_DEFINITIONS, type SceneParameter, type SceneState } from './sceneRuntime';

export { CameraStudyDiagram } from './CameraStudyDiagram';
import './camera-study.css';
import MicroscopeDetails from './MicroscopeDetails';

export function CameraStudyTabs({value,onChange}:{value:number;onChange:(n:number)=>void}) {
  return <div className="gs-plot-switch os-microscope-tabs" role="tablist" aria-label="相机显示内容">{CAMERA_STUDIES.map((label,i)=><button key={label} role="tab" id={`camera-tab-${i}`} aria-controls="camera-study-panel" aria-selected={i===value} tabIndex={i===value?0:-1} className={i===value?'active':''} onClick={()=>onChange(i)} onKeyDown={e=>{const n=e.key==='ArrowRight'?(i+1)%4:e.key==='ArrowLeft'?(i+3)%4:e.key==='Home'?0:e.key==='End'?3:null;if(n!==null){e.preventDefault();onChange(n);document.getElementById(`camera-tab-${n}`)?.focus();}}}>{label}</button>)}</div>;
}
export function CameraControls({state,renderField,onCommit}:{state:SceneState;renderField:(p:SceneParameter)=>ReactNode;onCommit:(p:Record<string,number>)=>void}) {
  const p=state.parameters,o=cameraOptics(p);
  const fields=SCENE_DEFINITIONS[state.sceneId].parameters;
  const render=(list:string[])=>list.map(k=>renderField(fields.find(f=>f.key===k)!));
  const canFocus=o.v!==null&&o.v>=10&&o.v<=300;
  if(p.study===0)return <>
    <div className="os-microscope-parameter-group"><h4>镜头与物体</h4>{render(['f','u','aperture'])}</div>
    <div className="os-microscope-parameter-group"><h4>感光面与对焦</h4>{render(['sensor'])}<div className="os-presets"><button className="text-button" disabled={!canFocus} title={canFocus?'将感光面移到当前物体的最佳像面':'最佳实像面不在感光面可移动范围内'} onClick={()=>{if(canFocus)onCommit({sensor:o.v!});}}>对焦当前物体</button><button className="text-button" onClick={()=>onCommit({f:50,u:400,h:20,sensor:65,aperture:12.5})}>观察离焦</button></div></div>
    <MicroscopeDetails id="camera-ray-size-settings" title="物体与感光面尺寸">{render(['h','sensorW','sensorH'])}</MicroscopeDetails>
  </>;
  if(p.study===1)return <>
    <div className="os-microscope-parameter-group"><h4>镜头与物距</h4>{render(['f','u'])}</div>
    <div className="os-microscope-parameter-group"><h4>感光面尺寸</h4>{render(['sensorW','sensorH'])}</div>
    <div className="os-presets"><button className="text-button" disabled={!canFocus} title={canFocus?'将感光面移到当前物体的最佳像面':'最佳实像面不在感光面可移动范围内'} onClick={()=>{if(canFocus)onCommit({sensor:o.v!});}}>对焦当前物体</button></div>
    <MicroscopeDetails id="camera-field-sample-settings" title="样品设置">{renderField({...fields.find(f=>f.key==='h')!,label:'样品高度 h'})}</MicroscopeDetails>
  </>;
  if(p.study===2)return <>
    <div className="os-microscope-parameter-group"><h4>样品与清晰标准</h4>{render(['u','aperture','coc'])}</div>
    <div className="os-presets"><button className="text-button" disabled={!canFocus} onClick={()=>{if(canFocus)onCommit({sensor:o.v!});}}>对焦当前样品</button></div>
    <MicroscopeDetails id="camera-depth-focus-settings" title="对焦设置">{render(['f','sensor'])}</MicroscopeDetails>
  </>;
  return <>
    <div className="os-microscope-parameter-group"><h4>光圈与采样</h4>{render(['aperture','pixel','wavelength'])}</div>
    <MicroscopeDetails id="camera-pixel-imaging-settings" title="镜头与物距">{render(['f','u'])}</MicroscopeDetails>
  </>;
}

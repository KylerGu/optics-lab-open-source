import definitions from './sceneDefinitions.json';
import {normalizeMicroscope} from './microscopeFocus';

export interface SceneParameter {key:string;label:string;unit:string;min:number;max:number;step:number;default:number;options?:{value:number;label:string}[]}
export interface SceneDefinition {title:string;topic:string;model:string;description:string;scope:string;parameters:SceneParameter[];formulas:string[];presets:{label:string;values:Record<string,number>}[]}
export const SCENE_DEFINITIONS = definitions as unknown as Record<string,SceneDefinition>;
// Only IDs with recorded physics and browser acceptance are exposed in the directory.
export const ACCEPTED_SCENES = new Set<string>(['polarization-2','polarization-1','polarization-0','fiber-modes-1','fiber-modes-0','photometric-quantities-0','radiometric-quantities-0','spatial-spectrum-1','spatial-spectrum-0','diffraction-0','diffraction-1','interference-2','interference-1','interference-0','wave-fields-1','reflection-refraction-0','reflection-refraction-1','reflection-refraction-2','paraxial-0','paraxial-1','paraxial-2','instruments-0','instruments-1','instruments-2','aberrations-0','aberrations-1','beam-transformation-1','resonators-0','laser-gain-0']);
export interface SceneState {version:1;sceneId:string;parameters:Record<string,number>}
export interface SceneMetric {key:string;label:string;value:number|null;unit:string;note:string}
export interface SceneResult {
  revision:string;input:SceneState;modelVersion:string;model:string;scope:string;status:string;warnings:string[];
  metrics:SceneMetric[];bounds:[number,number,number,number];
  segments:{start:[number,number];end:[number,number];role:string;dashed:boolean;power:number;color?:string}[];
  markers:{x:number;y:number;label:string;role:string}[];regions:{points:[number,number][];label:string}[];
  devices?:{kind:string;x:number;height:number;label:string;sign:number}[];
  imagePreview?:{kind:string;diameter:number;center:number;extent:number;note:string;points?:{x:number;y:number;color:string}[]}|null;
  curve:{x:number;y:number|null}[];chart:{xLabel:string;yLabel:string;currentX:number;currentY:number|null};
}
export const defaultScene = (sceneId:string):SceneState => ({version:1,sceneId,parameters:Object.fromEntries(SCENE_DEFINITIONS[sceneId].parameters.map(p=>[p.key,p.default]))});
export function parseScene(value:unknown,sceneId?:string):SceneState {
  if(!value || typeof value!=='object')throw new Error('场景文件格式无效。');
  const state=value as SceneState;
  const definition=SCENE_DEFINITIONS[state.sceneId];
  if(state.version!==1 || !definition || sceneId && state.sceneId!==sceneId || !state.parameters || typeof state.parameters!=='object' || Array.isArray(state.parameters))throw new Error('此文件不属于当前场景。');
  if(Object.keys(state.parameters).length!==definition.parameters.length)throw new Error('场景参数不完整。');
  for(const p of definition.parameters){const n=state.parameters[p.key];if(typeof n!=='number'||!Number.isFinite(n)||n<p.min||n>p.max||p.options&&!p.options.some(o=>o.value===n))throw new Error(`${p.label}超出有效范围。`);}
  if(state.sceneId==='instruments-0'&&state.parameters.NA>state.parameters.medium)throw new Error('数值孔径不能大于物镜前介质折射率。');
  if(state.sceneId==='beam-transformation-1'&&state.parameters.secondPositionMm-state.parameters.firstPositionMm<1)throw new Error('第二镜需在第一镜右侧，至少相隔 1 mm。');
  return normalizeMicroscope({version:1,sceneId:state.sceneId,parameters:{...state.parameters}});
}
export const sceneKey = (state:SceneState) => JSON.stringify([state.sceneId,...SCENE_DEFINITIONS[state.sceneId].parameters.map(p=>state.parameters[p.key])]);
export const draftKey = (id:string) => 'optics-scene-draft-v1-'+id;
export const savedKey = (id:string) => 'optics-scene-saved-v1-'+id;
export function readScene(id:string){try{const raw=localStorage.getItem(draftKey(id));if(!raw)return defaultScene(id);const stored=JSON.parse(raw);if((id==='instruments-0'||id==='instruments-1'||id==='instruments-2')&&stored.version===1&&stored.sceneId===id&&stored.parameters&&typeof stored.parameters==='object'&&!Array.isArray(stored.parameters))return parseScene({...stored,parameters:{...defaultScene(id).parameters,...stored.parameters}},id);return parseScene(stored,id);}catch{return defaultScene(id);}}
export function downloadScene(state:SceneState,title:string){const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=title+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export const numberText = (v:number|null) => v===null?'—': Math.abs(v)>1e5 || v!==0 && Math.abs(v)<1e-4 ? v.toExponential(3) : Number(v.toFixed(4)).toString();
export async function sceneCalculation(state:SceneState,signal?:AbortSignal):Promise<SceneResult>{
  const revision=sceneKey(state);
  let response:Response;
  try{response=await fetch('/api/scenes/calculate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,revision}),signal});}
  catch(error){if(error instanceof TypeError)throw new Error('暂时无法连接计算服务。服务恢复后，请点击“重新计算”。');throw error;}
  const result=await response.json();if(!response.ok)throw new Error(typeof result.detail==='string'?result.detail:'计算暂时无法完成。');
  if(result.revision!==revision || sceneKey(parseScene(result.input,state.sceneId))!==revision || !Array.isArray(result.metrics) || !Array.isArray(result.segments))throw new Error('计算结果与当前参数不符。');
  return result;
}

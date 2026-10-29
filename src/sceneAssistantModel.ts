import { parseScene, sceneKey, type SceneState, type SceneMetric } from './sceneRuntime';
export interface Evidence {input:SceneState;metrics:SceneMetric[];scope:string;status:string;warnings:string[]}
export interface SceneReply {requestId:string;inputSnapshot:SceneState;state:SceneState;changed:boolean;answer:string;evidence:Evidence|null;scans:{field:string;rows:{value:number;result:Evidence}[]}[]}
export interface Turn {id:string;prompt:string;reply:SceneReply|null;error:string|null;application:string;applied:boolean}
export function validateSceneReply(raw:unknown,id:string,snapshot:SceneState):SceneReply{
  const r=raw as SceneReply;
  if(!r||r.requestId!==id||typeof r.answer!=='string'||!r.answer.trim()||r.answer.length>12000||typeof r.changed!=='boolean')throw new Error('回答未完整返回，场景保持不变。');
  const before=parseScene(r.inputSnapshot,snapshot.sceneId),after=parseScene(r.state,snapshot.sceneId);
  if(sceneKey(before)!==sceneKey(snapshot)||r.changed!==(sceneKey(before)!==sceneKey(after)))throw new Error('返回参数与当前请求不符。');
  const check=(e:Evidence)=>{if(!e||!Array.isArray(e.metrics)||typeof e.scope!=='string'||typeof e.status!=='string')throw new Error('计算依据不完整。');parseScene(e.input,snapshot.sceneId);for(const m of e.metrics)if(typeof m.label!=='string'||!(m.value===null||typeof m.value==='number'&&Number.isFinite(m.value)))throw new Error('读数无效。');};
  if(r.evidence!==null)check(r.evidence);
  if(r.changed&&(!r.evidence||sceneKey(r.evidence.input)!==sceneKey(after)))throw new Error('修改缺少对应计算依据。');
  if(!Array.isArray(r.scans)||r.scans.length>2)throw new Error('比较数据无效。');
  for(const s of r.scans){if(typeof s.field!=='string'||!Array.isArray(s.rows)||s.rows.length>21)throw new Error('比较数据无效。');for(const row of s.rows){if(!Number.isFinite(row.value))throw new Error('比较取值无效。');check(row.result);}}
  return {...r,inputSnapshot:before,state:after};
}

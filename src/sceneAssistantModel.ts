import { consumeAgentNdjsonStream, readProgressSteps } from './agentProgress';
import { modelHeaders } from './modelSettings';
import { parseScene, sceneKey, type SceneState, type SceneMetric } from './sceneRuntime';
import type { AgentStep } from './spatialAgent';

export interface Evidence {input:SceneState;metrics:SceneMetric[];scope:string;status:string;warnings:string[]}
export interface SceneReply {requestId:string;inputSnapshot:SceneState;state:SceneState;changed:boolean;answer:string;evidence:Evidence|null;scans:{field:string;rows:{value:number;result:Evidence}[]}[];trace?:AgentStep[]}
export interface Turn {id:string;prompt:string;reply:SceneReply|null;error:string|null;application:string;applied:boolean;steps?:AgentStep[];durationMs?:number}

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
  const trace=readProgressSteps(r.trace,24);
  return {
    requestId:r.requestId,
    inputSnapshot:before,
    state:after,
    changed:r.changed,
    answer:r.answer,
    evidence:r.evidence,
    scans:r.scans,
    ...(trace.length?{trace}:{}),
  };
}

function parseSceneStep(raw:unknown):AgentStep{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('助教进度数据无效。');
  const step=raw as Record<string,unknown>;
  if(typeof step.name!=='string'||step.name.length>80||(step.status!=='ok'&&step.status!=='error'))throw new Error('助教进度数据无效。');
  const summary=typeof step.summary==='string'&&step.summary.trim()?step.summary.slice(0,300):step.name;
  return {name:step.name,status:step.status,summary};
}

export async function cancelSceneAgent(requestId:string):Promise<void>{
  await fetch('/api/scenes/agent/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId}),signal:AbortSignal.timeout(5000),keepalive:true}).catch(()=>{});
}

export async function requestSceneAgent(
  id:string,
  snapshot:SceneState,
  message:string,
  history:{role:string;content:string}[],
  recentChange:unknown,
  signal:AbortSignal,
  handlers:{onStep?:(step:AgentStep)=>void;onDelta?:(text:string)=>void;onReset?:()=>void},
):Promise<SceneReply>{
  const response=await fetch('/api/scenes/agent/chat',{
    method:'POST',
    headers:{'Content-Type':'application/json',...modelHeaders()},
    body:JSON.stringify({requestId:id,state:snapshot,message,history,...(recentChange?{recentChange}:{})}),
    signal,
  });
  if(!response.ok){
    const body=await response.json().catch(()=>null) as {detail?:unknown}|null;
    throw new Error(typeof body?.detail==='string'?body.detail:'暂时无法回答，请稍后重试。');
  }
  if(!response.body)throw new Error('助教连接中断，请重试。');
  return consumeAgentNdjsonStream(response.body,{
    signal,
    maxBytes:8_000_000,
    sizeError:'助教返回数据过大。',
    formatError:'助教返回格式无效。',
    incompleteError:'回答未完整接收，场景保持不变。',
    duplicateError:'收到重复助教回复。',
    fallbackError:'本轮回答未完成。',
    throwOnAbort:true,
    onStep:handlers.onStep,
    onDelta:handlers.onDelta,
    onReset:handlers.onReset,
    parseStep:parseSceneStep,
    parseReply:raw=>validateSceneReply(raw,id,snapshot),
  });
}

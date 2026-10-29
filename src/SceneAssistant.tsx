import SceneComparisonTable from './SceneComparisonTable';
import { changeForSnapshot, type SceneInteractionControls } from './sceneInteraction';
import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Undo2 } from 'lucide-react';
import AssistantFrame from './AssistantFrame';
import SceneAnswer from './SceneAnswer';
import { numberText, parseScene, SCENE_DEFINITIONS, sceneKey, type SceneState, type SceneMetric } from './sceneRuntime';

export interface SceneAssistantProps {interaction?:SceneInteractionControls;sceneState:SceneState;editing:boolean;onApplyScene:(s:SceneState)=>boolean;onRestoreScene:(before:SceneState,after:SceneState)=>boolean}
import { validateSceneReply, type SceneReply, type Turn } from './sceneAssistantModel';
export default function SceneAssistant(props:SceneAssistantProps){
  const definition=SCENE_DEFINITIONS[props.sceneState.sceneId];
  const key='optics-scene-conversation-v1-'+props.sceneState.sceneId;
  const [initial]=useState(()=>{try{const value=JSON.parse(localStorage.getItem(key)??'{}');const turns:Turn[]=[];for(const t of (Array.isArray(value.turns)?value.turns:[]).slice(-40)){try{if(typeof t.id!=='string'||typeof t.prompt!=='string'||typeof t.application!=='string')continue;const reply=t.reply?validateSceneReply(t.reply,t.id,parseScene(t.reply.inputSnapshot,props.sceneState.sceneId)):null;turns.push({...t,reply,error:reply?null:t.error??'上次请求未完成，可以重新发送。'});}catch{/* Preserve valid turns. */}}return {draft:typeof value.draft==='string'?value.draft.slice(0,2000):'',turns};}catch{return {draft:'',turns:[] as Turn[]};}});
  const [turns,setTurns]=useState(initial.turns),[prompt,setPrompt]=useState(initial.draft),[busy,setBusy]=useState(false),[configured,setConfigured]=useState(false),[checking,setChecking]=useState(false),[setupError,setSetupError]=useState('');
  const latest=useRef(props);latest.current=props;const active=useRef<AbortController|null>(null);
  const checkStatus=async()=>{setChecking(true);try{const r=await fetch('/api/agent/status',{signal:AbortSignal.timeout(6000)});const d=await r.json();if(!r.ok||typeof d.configured!=='boolean')throw new Error();setConfigured(d.configured);setSetupError('');}catch{setConfigured(false);setSetupError('无法连接助手后台，请确认服务已启动后重新检测。');}finally{setChecking(false);}};
  useEffect(()=>{void checkStatus();return()=>active.current?.abort('unmount');},[]);
  useEffect(()=>{try{localStorage.setItem(key,JSON.stringify({draft:prompt,turns:turns.slice(-40)}));}catch{/* Session remains available in memory. */}},[key,prompt,turns]);
  const send=async()=>{
    if(busy||!configured||!prompt.trim()||latest.current.editing)return;
    const message=prompt.trim(),snapshot=parseScene(latest.current.sceneState),id=crypto.randomUUID(),controller=new AbortController();active.current=controller;
    const recentChange=changeForSnapshot(latest.current.interaction?.recentChange??null,snapshot);
    const timer=setTimeout(()=>controller.abort('timeout'),330000);
    setBusy(true);setPrompt('');setTurns(t=>[...t,{id,prompt:message,reply:null,error:null,application:'',applied:false}].slice(-40));
    const history=turns.filter(t=>t.reply).flatMap(t=>[{role:'user',content:t.prompt},{role:'assistant',content:t.reply!.answer}]).slice(-8).map(m=>({...m,content:m.content.slice(0,2500)}));
    try{const response=await fetch('/api/scenes/agent/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:id,state:snapshot,message,history,...(recentChange?{recentChange}:{})}),signal:controller.signal});const data=await response.json();if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'暂时无法回答，请稍后重试。');const reply=validateSceneReply(data,id,snapshot);if(controller.signal.aborted)throw new Error();let applied=false,application='';if(sceneKey(latest.current.sceneState)!==sceneKey(snapshot)||latest.current.editing)application='等待时你已调整参数，本轮结果对应发送时的场景。';else if(reply.changed&&document.activeElement?.matches('.os-parameter input'))application='你正在输入参数，本轮调参未应用。';else if(reply.changed){applied=latest.current.onApplyScene(reply.state);application=applied?'参数已更新。':'未能应用调参。';}setTurns(t=>t.map(row=>row.id===id?{...row,reply,application,applied}:row));}
    catch(e){if(controller.signal.reason==='unmount')return;setTurns(t=>t.map(row=>row.id===id?{...row,error:controller.signal.aborted?'本轮已停止，参数保持不变。':e instanceof Error?e.message:'连接中断，场景保持不变。'}:row));}
    finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false);}}
  };
  const sceneStarters:Record<string,string[]>={lens:['为什么会形成虚像？','把像距调到300 mm，保持透镜不变'],mirror:['凹面镜和凸面镜的像有什么区别？','把像距调到300 mm，保持镜面不变'],prism:['最小偏折是什么？','调到最小偏折位置'],'double-lens':['解释当前中间像和最终像','把最终像距调到200 mm，透镜不变'],microscope:['为什么需要物镜和目镜？','调到放松眼观察的镜距'],telescope:['为什么有正像和倒像望远镜？','调到平行出射的镜距'],camera:['缩小光圈为什么能减轻离焦？','调节感光面使当前物体对焦'],aperture:['光阑和光瞳有什么区别？','把入瞳位置调到150 mm，保持孔径不变'],aberration:['为什么缩小口径能减轻球差？','把观察屏调到几何光斑最小的位置，保持透镜不变']};
  sceneStarters['gaussian-focus']=['解释当前束腰位置和光斑大小','把透镜焦距改为150 mm，其他参数不变','比较焦距80、100、150 mm'];
  sceneStarters['gaussian-expander']=['解释当前扩束倍率和发散角','调到准直，其他参数不变','比较第二镜位置170、175、180 mm'];
  sceneStarters['two-mirror-resonator']=['解释当前谐振腔是否稳定','只调整镜距，调到稳定','比较镜距300、500、1000 mm'];
  sceneStarters['michelson']=['为什么移镜一条纹只需要半个波长？','只移动第二镜，调到观察点为暗环','比较移镜量0、0.15、0.3 μm'];
  sceneStarters['film-interference']=props.sceneState.parameters.mode===0?['为什么反射最弱时不一定完全消光？','只改变膜厚，调到反射最弱','比较膜厚0、100、200 nm']:['为什么接触圆心是暗的？','只移动观察点，调到就近亮环','比较中心间隙0、100、150 nm'];
  sceneStarters['polarization-refraction']=props.sceneState.parameters.mode===1?['两束光为什么平行出射？','只调整光轴，让出射间距最大','只调整光轴，让两束光同轴']:['布儒斯特角处为什么还有反射光？','只调整入射角，让p光不反射','比较入射角0、30、60°'];
  sceneStarters['waveplate']=['为什么45°快轴能得到圆偏振？','只调整快轴，把输出调成圆偏振','比较快轴角0、22.5、45°'];
  sceneStarters['malus']=['夹角为什么决定透射功率？','只调整透光轴，让透射功率为一半','比较透光轴0、45、90°'];
  sceneStarters['four-f']=['低通为什么让条纹变平滑？','只改滤波片，设为居中高通','比较滤波宽度100、400、1000 μm'];
  sceneStarters['fourier-lens']=['为什么条纹越密，两侧频谱越远？','只移动观察点，调到正一级','比较条纹周期0.1、0.2、0.4 mm'];
  sceneStarters['circular-diffraction']=['为什么圆孔越小，中央亮斑越大？','只移动观察点，调到第一暗环','比较圆孔直径1、2、4 mm'];
  sceneStarters['single-slit']=['为什么缝越窄，中央亮纹越宽？','只移动观察点，调到第一暗纹','比较缝宽0.025、0.05、0.075 mm'];
  sceneStarters['young-double-slit']=['为什么双缝间距越大，条纹越密？','只移动观察点，调到第一暗纹','比较屏幕距离0.5、1、2 m'];
  sceneStarters['illumination-map']=['为什么转动射灯，亮区会移动？','只调整方向，让观察点尽可能亮','比较倾角0、20、40度'];
  sceneStarters['fiber-coupling']=['为什么对准了中心，效率还不是100%？','只调整位置和倾角，让光束对准','比较横向偏移0、2、5 μm'];
  sceneStarters['fiber-modes']=['为什么单模与入射角无关？','只调整纤芯半径，调到单模','比较入射角0、5、15度'];
  sceneStarters['point-source']=['为什么距离加倍，照度变为四分之一？','保持光强不变，把照度调到100 lx','比较距离1、2、4 m'];
  sceneStarters['wave-superposition']=['为什么反相时不一定完全抵消？','只调整相位差，调到相消','比较相位差0、90、180度'];
  sceneStarters['laser-gain']=['解释当前是否达到阈值','只调整增益，调到阈值以上','比较输出镜反射率80、90、99%'];
  const starters=sceneStarters[definition.model]??['临界角是什么？','计算当前反射与透射功率','比较入射角30、45、60度'];
  return <AssistantFrame conversationRevision={turns} title={definition.title+'助教'} prompt={prompt} onPrompt={setPrompt} busy={busy} configured={configured} checking={checking} setupError={setupError||undefined} onCheck={()=>void checkStatus()} onSend={()=>void send()} onStop={()=>active.current?.abort('cancel')} onClear={()=>setTurns([])} canClear={!!turns.length} editing={props.editing} starters={starters}>{turns.map(t=><article className="agent-turn" key={t.id}><p className="agent-user"><small>你</small>{t.prompt}</p>{t.error?<p className="agent-error" role="alert">{t.error}</p>:t.reply?<><div className="agent-answer"><SceneAnswer text={t.reply.answer} source={t.reply.evidence?.input??t.reply.scans[0]?.rows[0]?.result.input??t.reply.inputSnapshot} disabled={props.editing}/></div>{t.application&&<div className="agent-application"><span>{t.application}</span>{t.applied&&!busy&&!props.editing&&sceneKey(props.sceneState)===sceneKey(t.reply.state)&&<button className="text-button" onClick={()=>{if(latest.current.onRestoreScene(t.reply!.inputSnapshot,t.reply!.state))setTurns(rows=>rows.map(row=>row.id===t.id?{...row,applied:false,application:'已撤销此次调参。'}:row));}}><Undo2 size={12}/>撤销此次调参</button>}</div>}{t.reply.scans.map((s,index)=><SceneComparisonTable key={index} id={t.id+':'+index} scan={s} state={props.sceneState} interaction={props.interaction} disabled={busy||props.editing}/>)}</>:<div className="agent-pending" role="status"><LoaderCircle size={14}/>正在回答…</div>}</article>)}</AssistantFrame>;
}

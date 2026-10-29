import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Download, LoaderCircle, Maximize2, Minimize2, RefreshCw, Sparkles, Square, Trash2, Undo2 } from 'lucide-react';
import { experimentKey } from './simulation';
import { validateAgentReply, scanCSV, assistantErrorMessage, isAssistantConnectionError, type ConversationMessage, type Scan } from './agent';
import { formatNumber } from './formatNumber';
import type { Experiment } from './model';
import AssistantAnswer from './AssistantAnswer';
import { downloadDesign, type FocusDesign } from './research';
import { downloadStudy, type StabilityStudy } from './tolerance';
import type { LearningContext } from './teaching';
import { loadConversation, saveConversation, type ConversationTurn } from './assistantHistory';
import './assistant.css';
import AssistantFrame from './AssistantFrame';
import SceneAssistant, { type SceneAssistantProps } from './SceneAssistant';

interface LegacyProps {
  experiment: Experiment; mode: 'teaching' | 'research'; editing: boolean;
  scene?: 'gaussian';
  onApply: (experiment: Experiment) => boolean;
  onRestore?: (before: Experiment, after: Experiment) => boolean;
  onDesign: (design: FocusDesign) => void;
  onStudy: (study: StabilityStudy) => void;
  learningContext?: LearningContext|null;
  suggestion?: {id:string;text:string}|null;
}
interface Status { configured: boolean }

function ScanTable({scan, scene}: {scan: Scan; scene?: 'gaussian'}) {
  const screens = scan.rows.find(row=>row.result)?.result?.screens ?? [];
  const [screenId,setScreenId] = useState(screens[0]?.elementId ?? '');
  const download = () => {
    const url = URL.createObjectURL(new Blob([scanCSV(scan)],{type:'text/csv;charset=utf-8'}));
    const anchor = document.createElement('a'); anchor.href=url; anchor.download='光学参数比较.csv'; anchor.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <details className="agent-scan">
    <summary>{scene === 'gaussian' ? scan.fieldLabel : `${scan.elementName} · ${scan.fieldLabel}`}比较（{scan.rows.length}组）</summary>
    <p>单参数等间距比较，保留扫描前参数。各行均由计算程序求得。</p>
    {scene !== 'gaussian' && screens.length>0 && <label className="scan-screen-selector">比较观察屏
      <select aria-label="参数比较观察屏" value={screenId} onChange={event=>setScreenId(event.target.value)}>
        {screens.map(screen=><option key={screen.elementId} value={screen.elementId}>{screen.name} · {formatNumber(screen.positionMm)} mm</option>)}
      </select>
    </label>}
    <div className="scan-table-scroll"><table>
      <thead><tr><th>{scan.fieldLabel} / {scan.unit}</th>{screens.length>0 && <th>{scene === 'gaussian' ? '光斑半径' : '屏上半径'} / mm</th>}{scene !== 'gaussian' && <><th>最小半径 / mm</th><th>位置 / mm</th></>}<th>状态</th></tr></thead>
      <tbody>{scan.rows.map((row,index)=>{
        const screen=row.result?.screens.find(item=>item.elementId===screenId);
        return <tr key={index}><td>{formatNumber(row.value)}</td>{screens.length>0 && <td>{screen ? formatNumber(screen.radiusMm) : '—'}</td>}{scene !== 'gaussian' && <><td>{row.result ? formatNumber(row.result.minimum.radiusMm) : '—'}</td><td>{row.result ? formatNumber(row.result.minimum.positionMm) : '—'}</td></>}<td>{row.error ?? (row.result?.quality==='reference-only' ? '仅作参考' : '理想条件内')}</td></tr>;
      })}</tbody>
    </table></div>
    <button className="text-button" onClick={download}><Download size={12}/>导出比较数据CSV</button>
  </details>;
}

export default function AssistantPanel(props: LegacyProps | SceneAssistantProps) {
  if ('sceneState' in props) return <SceneAssistant key={props.sceneState.sceneId} {...props}/>;
  return <AssistantSession key={props.scene ?? props.mode} {...props} />;
}

function AssistantSession(props: LegacyProps) {
  const isGaussian = props.scene === 'gaussian';
  const scope = props.scene ?? props.mode;
  const [initial] = useState(() => loadConversation(scope));
  const [status,setStatus]=useState<Status|null>(null);
  const [statusError,setStatusError]=useState<string|null>(null);
  const [checking,setChecking]=useState(false);
  const [prompt,setPrompt]=useState(initial.draft);
  const [turns,setTurns]=useState<ConversationTurn[]>(initial.turns);
  const [busy,setBusy]=useState(false);
  const [inputError,setInputError]=useState<string|null>(null);
  const latest=useRef(props); latest.current=props;
  const active=useRef<AbortController|null>(null);
  useEffect(()=>{if(props.suggestion)setPrompt(props.suggestion.text);},[props.suggestion]);

  async function checkStatus() {
    setChecking(true); setStatusError(null);
    try {
      const response=await fetch('/api/agent/status',{signal:AbortSignal.timeout(6000)});
      if(!response.ok) throw new Error('暂时无法检测助手配置，请确认后台已启动。');
      const data=await response.json();
      if(typeof data.configured!=='boolean') throw new Error('助手状态响应无效。');
      setStatus(data);
    } catch {setStatus(null);setStatusError('无法连接助手后台，请检查网络连接，稍后重新检测。');}
    finally {setChecking(false);}
  }
  useEffect(()=>{void checkStatus();return()=>active.current?.abort('unmount');},[]);
  useEffect(()=>{saveConversation(scope, { draft: prompt, turns });},[scope,prompt,turns]);

  async function send() {
    if(busy || !prompt.trim() || !status?.configured || latest.current.editing) return;
    if(prompt.trim().length>2000) {setInputError('每条实验指令最多2000字。');return;}
    const message=prompt.trim(), requestId=crypto.randomUUID(), snapshot=latest.current.experiment, snapshotKey=experimentKey(snapshot);
    const history: ConversationMessage[]=turns.filter(turn=>turn.reply).flatMap(turn=>[{role:'user' as const,content:turn.prompt},{role:'assistant' as const,content:turn.reply!.answer}]).slice(-8).map(item=>({...item,content:item.content.slice(0,2500)}));
    const controller=new AbortController();active.current=controller;
    const timer=setTimeout(()=>controller.abort('timeout'),330000);
    setBusy(true);setPrompt('');setInputError(null);
    setTurns(current=>[...current,{id:requestId,prompt:message,reply:null,error:null,application:''}].slice(-40));
    try {
      const response=await fetch('/api/agent/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,experiment:snapshot,message,mode:latest.current.mode,history,scene:latest.current.scene??null,learningContext:latest.current.mode==='teaching'?latest.current.learningContext??null:null}),signal:controller.signal});
      if(!response.ok) {
        let error='助手暂时无法处理请求，装置保持不变。';
        try {const data=await response.json();if(typeof data.detail==='string')error=data.detail;} catch { /* never display proxy HTML */ }
        if(response.status===401 || response.status>=500) void checkStatus();
        throw new Error(error);
      }
      const reply=validateAgentReply(await response.json(),requestId,snapshotKey);
      if(controller.signal.aborted) throw new Error('请求已取消。');
      const currentKey=experimentKey(latest.current.experiment);
      let application='', applied=false;
      if(currentKey!==snapshotKey || latest.current.editing) application=isGaussian ? '你已调整参数，本轮回答对应发送时的光束，未覆盖当前场景。' : '你在等待期间调整了装置，本轮结果对应发送时的参数，未覆盖当前装置。';
      else if(reply.changed && document.activeElement?.matches('.left-sidebar input, .projectbar input, .gs-parameter input[type=number]')) application=isGaussian ? '你正在输入参数，本轮调参未应用。' : '你正在输入装置参数，AI方案未应用。完成编辑后可以重新发送指令。';
      else if(reply.changed) {
        applied=latest.current.onApply(reply.experiment);
        application=applied ? isGaussian ? '参数已更新。' : 'AI方案已应用。' : isGaussian ? '参数未能应用，场景保持不变。' : '方案未能应用，当前装置保持不变。';
      }
      setTurns(current=>current.map(turn=>turn.id===requestId ? {...turn,reply,application,applied} : turn));
      if(reply.designs.length)latest.current.onDesign(reply.designs[0]);
      if(reply.studies.length)latest.current.onStudy(reply.studies[reply.studies.length-1]);
    } catch(error) {
      if(controller.signal.reason==='unmount') return;
      const failure=controller.signal.aborted ? controller.signal.reason==='timeout' ? '等待超时，当前装置保持不变。可以重试或简化目标。' : '已停止等待，当前装置保持不变。' : assistantErrorMessage(error);
      setTurns(current=>current.map(turn=>turn.id===requestId ? {...turn,error:failure} : turn));
      if(!controller.signal.aborted && isAssistantConnectionError(error)) {
        setPrompt(current=>current || message);
        void checkStatus();
      }
    } finally {clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false);}}
  }
  const wasApplied=(turn:ConversationTurn)=>turn.applied ?? ['参数已更新，可撤销恢复。','AI方案已应用；一次撤销即可恢复之前的装置。'].includes(turn.application);
  const canRestore=(turn:ConversationTurn)=>!!props.onRestore && !!turn.reply?.changed && wasApplied(turn) && !props.editing && experimentKey(props.experiment)===experimentKey(turn.reply.experiment);
  function restore(turn:ConversationTurn) {
    if(busy || !canRestore(turn) || !turn.reply)return;
    if(latest.current.onRestore?.(turn.reply.inputSnapshot,turn.reply.experiment))
      setTurns(current=>current.map(item=>item.id===turn.id ? {...item,applied:false,application:isGaussian?'已撤销此次调参。':'已撤销此次修改。'} : item));
  }
  return <AssistantFrame title={isGaussian ? '高斯光束助教' : '光学探索助手'} prompt={prompt} onPrompt={setPrompt} busy={busy} configured={!!status?.configured} checking={checking} setupError={statusError} onCheck={()=>void checkStatus()} onSend={()=>void send()} onStop={()=>active.current?.abort('cancel')} onClear={()=>setTurns([])} canClear={turns.length>0} editing={props.editing} inputError={inputError} starters={isGaussian ? ['瑞利长度是什么？','把光斑半径调到0.4 mm，其他参数不变'] : props.mode==='teaching' ? ['解释当前装置的光束半径与光斑','搭建一个单透镜聚焦实验'] : ['帮我寻找固定观察屏上的较小光斑方案','分析当前方案的位置与焦距偏差']}>
      {turns.map(turn=><article className="agent-turn" key={turn.id}><p className="agent-user"><small>你</small>{turn.prompt}</p>{turn.error ? <p className="agent-error" role="alert">{turn.error}</p> : turn.reply ? <><div className="agent-answer"><AssistantAnswer text={turn.reply.answer}/></div>{turn.application && <div className="agent-application"><span>{wasApplied(turn) ? isGaussian ? '参数已更新。' : 'AI方案已应用。' : turn.application}</span>{canRestore(turn) && <button type="button" className="text-button" disabled={busy} onClick={()=>restore(turn)}><Undo2 size={12}/>{isGaussian ? '撤销此次调参' : '撤销此次修改'}</button>}</div>}{turn.reply.scans.map(scan=><ScanTable scan={scan} scene={props.scene} key={scan.id}/>)}{turn.reply.designs.map(design=><div className="agent-evidence" key={design.id}><strong>自动设计 · {design.counts.total}组计算</strong><p>{design.recommendation ? `推荐屏上半径 ${formatNumber(design.recommendation.radiusMm!)} mm；位置 ${formatNumber(design.recommendation.positionMm)} mm，焦距 ${formatNumber(design.recommendation.focalLengthMm)} mm。` : design.noRecommendationReason}</p><p>有限范围内的比较，不保证全局最优。搜索记录对应当时的装置。</p><button className="text-button" onClick={()=>props.onDesign(design)}>查看比较图与载入方案<ArrowRight size={12}/></button><button className="text-button" onClick={()=>downloadDesign(design,'json')}><Download size={12}/>导出完整记录</button></div>)}{turn.reply.studies.map(study=><div className="agent-evidence" key={study.id}><strong>{study.mode==='analysis'?'误差分析':'误差下的稳定方案比较'}</strong><p>位置±{formatNumber(study.tolerance.positionErrorMm)} mm，焦距±{formatNumber(study.tolerance.focalErrorPercent)}%；已计算偏差中最大半径 {study.baseline.maxRadiusMm===null?'无法计算':`${formatNumber(study.baseline.maxRadiusMm)} mm`}（当前方案）。</p>{study.recommendation && <p>较稳定推荐：标称位置 {formatNumber(study.recommendation.positionMm)} mm，焦距 {formatNumber(study.recommendation.focalLengthMm)} mm；偏差中最大半径 {formatNumber(study.recommendation.maxRadiusMm!)} mm。</p>}<p>有限采样，不代表连续误差严格界限。记录对应计算时装置。</p><button className="text-button" onClick={()=>props.onStudy(study)}>查看误差图与方案比较<ArrowRight size={12}/></button><button className="text-button" onClick={()=>downloadStudy(study,'json')}><Download size={12}/>导出分析记录</button></div>)}</> : <div className="agent-pending" role="status"><LoaderCircle size={14}/><span>正在回答…</span></div>}</article>)}
  </AssistantFrame>;
}

import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, RotateCcw, Send, Sparkles, Square, Trash2 } from 'lucide-react';
import AssistantAnswer from './AssistantAnswer';
import { COMPARISON_LABELS, SPATIAL_CHAT_KEY, readSpatialChat, requestSpatialAgent, type AgentStep, type SpatialAgentReply, type SpatialChatMessage, type SpatialComparison } from './spatialAgent';
import { DiffractionChart } from './SpatialMeasurements';
import type { SpatialExperiment } from './builderModel';
import './spatialAgent.css';

interface Row extends SpatialChatMessage {reply?:SpatialAgentReply;state?:'applied'|'stale'|'unmet'|'unchanged'|'restored'}
interface Props {experiment:SpatialExperiment;editing:boolean;onApply:(next:SpatialExperiment,expected:SpatialExperiment)=>boolean}
function ComparisonTable({comparison:c}:{comparison:SpatialComparison}){
  const wave=c.rows.some(r=>r.fourF||r.fourier);
  const diffracting=c.rows.some(r=>r.diffraction?.some(p=>'slitId' in p));
  return <details className="sa-comparison"><summary>比较数据 · {COMPARISON_LABELS[c.field]}</summary><div><table><thead><tr><th>{COMPARISON_LABELS[c.field]}</th><th>探测功率（mW）</th>{diffracting&&<th>中央亮纹宽度（mm）</th>}</tr></thead><tbody>{c.rows.map((r,i)=><tr key={i}><td>{Number(r.value.toPrecision(5))}</td><td>{r.error?'无法计算':r.screens.map(s=><span key={s.elementId}>{r.screens.length>1?s.name+'：':''}{r.fourier?.screenId===s.elementId?Number(r.fourier.capturedPowerMw.toPrecision(5)):r.fourF?.screenId===s.elementId?Number(r.fourF.capturedPowerMw.toPrecision(5)):s.detectorKind==='power-meter'?(s.overRange?'超量程':Number((s.readingMw??0).toPrecision(5))):Number(s.sampledPowerMw.toPrecision(5))}<small>{r.fourier?.screenId===s.elementId?`波动计算 · I/I₀ ${r.fourier.pointIntensity.toFixed(4)}`:r.fourF?.screenId===s.elementId?`波动计算 · T ${(r.fourF.transmission*100).toFixed(2)}% · I ${r.fourF.pointIntensity.toFixed(4)}`:<>{s.hits} 条命中{s.detectorKind==='power-meter'?' · 几何采样':s.gaussianRadiusMm!==null?` · 高斯半径 ${Number(s.gaussianRadiusMm.toPrecision(4))} mm`:s.footprintRadiusMm!==null?` · 采样半径 ${Number(s.footprintRadiusMm.toPrecision(4))} mm`:''}</>}</small></span>)}</td>{diffracting&&<td>{r.diffraction?.length?r.diffraction.filter(p=>'slitId' in p).map(p=><span key={p.slitId+p.screenId+p.sourceId}>{Number(p.centralMaximumWidthMm.toPrecision(5))}</span>):'不符合远场条件'}</td>}</tr>)}</tbody></table></div><p>{wave?'频谱与 4f 结果为波动计算；条件失效的采样点仅显示几何光路。':'功率为几何采样；条纹为独立的归一化远场计算。'}</p></details>;
}
function PlanAnswer({text}:{text:string}){
  const paragraphs=text.split(/\n\s*\n/),preview=paragraphs.find(p=>p.trim()&&!p.trim().startsWith('#'))??text;
  return text.length>240&&paragraphs.length>1?<><AssistantAnswer text={preview}/><details className="sa-full-answer"><summary>展开方案说明</summary><AssistantAnswer text={text}/></details></>:<AssistantAnswer text={text}/>;
}
export default function SpatialAssistantPanel({experiment,editing,onApply}:Props){
  const [rows,setRows]=useState<Row[]>(readSpatialChat),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[steps,setSteps]=useState<AgentStep[]>([]),[configured,setConfigured]=useState<boolean|null>(null);
  const controller=useRef<AbortController|null>(null),list=useRef<HTMLDivElement>(null),mounted=useRef(true),current=useRef({experiment,editing,onApply}),version=useRef(0),last=useRef(JSON.stringify(experiment));
  current.current={experiment,editing,onApply};
  const key=JSON.stringify(experiment);if(last.current!==key){last.current=key;version.current++;}
  useEffect(()=>{mounted.current=true;const status=new AbortController();void fetch('/api/spatial/agent/status',{signal:status.signal}).then(r=>{if(!r.ok)throw new Error();return r.json();}).then((v:unknown)=>{if(mounted.current)setConfigured(!!v&&typeof v==='object'&&'configured'in v&&v.configured===true);}).catch(()=>{});return()=>{mounted.current=false;status.abort();controller.current?.abort();};},[]);
  useEffect(()=>{try{const history=rows.map(({role,content})=>({role,content})).slice(-12);while(history.reduce((n,m)=>n+m.content.length,0)>24000)history.splice(0,2);localStorage.setItem(SPATIAL_CHAT_KEY,JSON.stringify(history));}catch{/* Chat storage failure must never block apparatus editing. */}list.current?.scrollTo({top:list.current.scrollHeight,behavior:'smooth'});},[rows,busy,steps]);
  const submit=async()=>{
    const message=text.trim();if(!message||busy||current.current.editing)return;
    const snapshot=structuredClone(current.current.experiment),baseline=version.current,id=crypto.randomUUID(),abort=new AbortController();controller.current=abort;
    const history=rows.map(({role,content})=>({role,content})).slice(-10);while(history.reduce((n,m)=>n+m.content.length,0)>20000)history.splice(0,2);
    setRows(old=>[...old,{role:'user',content:message}]);setText('');setError(null);setSteps([]);setBusy(true);
    try{
      const reply=await requestSpatialAgent(id,snapshot,message,history,abort.signal,step=>{if(mounted.current&&!abort.signal.aborted)setSteps(old=>[...old,step].slice(-40));});
      if(!mounted.current||abort.signal.aborted)return;
      let state:Row['state']='unchanged';
      if(reply.changed){
        if(!reply.applyAllowed)state='unmet';
        else if(version.current!==baseline||current.current.editing||JSON.stringify(current.current.experiment)!==JSON.stringify(snapshot))state='stale';
        else state=current.current.onApply(reply.experiment,snapshot)?'applied':'stale';
      }
      // Store actual application status with history so subsequent turns don't mistake a rejected plan for the current bench.
      const note=state==='applied'?'\n（方案已载入，尚未保存存档。）':state==='stale'?'\n（装置已变化，此方案未载入。）':state==='unmet'?'\n（未通过目标核对，装置未修改。）':'';
      setRows(old=>[...old,{role:'assistant',content:reply.answer+note,reply,state}]);
    }catch(e){if(mounted.current){setText(message);setError(abort.signal.aborted?'已停止设计，装置未修改。':e instanceof Error?e.message:'本轮设计未完成，装置未修改。');}}
    finally{if(mounted.current)setBusy(false);if(controller.current===abort)controller.current=null;}
  };
  const restore=(index:number,row:Row)=>{if(!row.reply||busy||current.current.editing)return;if(current.current.onApply(row.reply.inputSnapshot,row.reply.experiment)){setRows(old=>old.map((r,i)=>i===index?{...r,state:'restored',content:r.content+'\n（已撤回此次搭建。）'}:r));setError(null);}else setError('装置已继续修改，请用工作区的撤销按钮逐步恢复。');};
  return <section className="spatial-agent" aria-label="AI光路搭建助手">
    <header><span><Sparkles size={16}/></span><div><h2>AI 光路搭建</h2><p>说出实验目标，帮你设计并验证</p></div></header>
    <div className="sa-chat" ref={list} data-navigation-scroll="spatial-agent">
      {!rows.length&&<div className="sa-empty"><div><Sparkles size={26} strokeWidth={1.3}/></div><h3>你想搭建什么实验？</h3><p>描述要验证的现象、空间安排或目标数值，也可以让我修改当前装置。</p><span>设计 → 搭建 → 仿真核对</span></div>}
      {rows.map((row,index)=><article key={index} className={`sa-message ${row.role}`}><div className="sa-role">{row.role==='user'?'你':'搭建助手'}</div>{row.role==='assistant'?<PlanAnswer text={row.reply?row.reply.answer:row.content}/>:<AssistantAnswer text={row.content}/>} {row.reply&&<>
        {row.state==='applied'&&<div className="sa-applied"><Check size={13}/>已载入装置<button disabled={busy||editing||JSON.stringify(experiment)!==JSON.stringify(row.reply.experiment)} onClick={()=>restore(index,row)}><RotateCcw size={12}/>撤回</button></div>}
        {row.state==='stale'&&<p className="sa-notice">你已修改装置，本轮方案未载入。重新发送可按新装置设计。</p>}
        {row.state==='unmet'&&<p className="sa-notice">目标尚未达成，装置未修改。</p>}
        {row.state==='restored'&&<p className="sa-notice">此次搭建已撤回。</p>}
        {!!row.reply.checks.length&&<details className="sa-evidence"><summary>数值比较 · {row.reply.checks.length} 项参考指标</summary>{row.reply.checks.map((c,i)=><p key={i}><span className={c.passed?'pass':'fail'}>{c.passed?'✓':'○'}</span>{c.criterion.label}<small>目标 {c.criterion.operator==='le'?'≤':c.criterion.operator==='ge'?'≥':'='} {c.criterion.value}{c.criterion.tolerance>0?`（允许差 ${c.criterion.tolerance}）`:''} · 计算 {c.actual===null?'无结果':Number(c.actual.toPrecision(5))}</small></p>)}{row.reply.evidence?.warnings.map((w,i)=><p key={'w'+i} className="sa-warning">{w}</p>)}<span className="sa-model-note">理想器件模型；到屏功率为光线采样估计。</span></details>}
        {!!row.reply.trace.length&&<details className="sa-steps"><summary>查看搭建过程</summary>{row.reply.trace.map((s,i)=><p key={i} className={s.status==='error'?'sa-warning':''}>{s.status==='ok'?'✓':'○'} {s.summary}</p>)}</details>}
        {row.reply.comparisons.map(comparison=><ComparisonTable key={comparison.comparisonId} comparison={comparison}/>)}
        {!!row.reply.evidence?.diffraction?.length&&<details className="sa-evidence"><summary>查看衍射曲线</summary>{row.reply.evidence.diffraction.map(p=><DiffractionChart key={('gratingId' in p?p.gratingId:p.slitId)+p.screenId+p.sourceId} profile={p}/>)}</details>}
      </>}</article>)}
      {busy&&<div className="sa-progress" role="status"><LoaderCircle size={14}/><div><strong>{steps.at(-1)?.summary??'正在理解目标并设计光路…'}</strong><span>{steps.length?`已完成 ${steps.length} 步 · 方案核对后载入`:'首次设计可能需要一两分钟'}</span></div></div>}
      {!busy&&error&&steps.length>0&&<details className="sa-steps"><summary>查看本轮执行记录</summary>{steps.map((s,i)=><p key={i} className={s.status==='error'?'sa-warning':''}>{s.status==='ok'?'✓':'○'} {s.summary}</p>)}</details>}
    </div>
    <footer>{error&&<p className="sa-error" role="alert">{error}</p>}{configured===false&&<p className="sa-error">AI接口尚未配置，请在项目中配置模型后使用。</p>}<form onSubmit={e=>{e.preventDefault();void submit();}}><textarea aria-label="实验目标" value={text} maxLength={2000} placeholder="告诉我你想做的实验…" onChange={e=>setText(e.target.value)} disabled={busy} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void submit();}}}/><div><button type="button" className="sa-clear" aria-label="清空搭建助手对话" disabled={busy||!rows.length} onClick={()=>{setRows([]);setText('');setError(null);setSteps([]);}}><Trash2 size={13}/>清空对话</button>{busy?<button key="stop" type="button" className="sa-stop" onClick={event=>{event.preventDefault();controller.current?.abort();}}><Square size={11}/>停止</button>:<button key="send" type="submit" className="sa-send" disabled={!text.trim()||editing||configured===false}><Send size={13}/>发送</button>}</div></form><span className="sa-footer-note">搭建结果可撤销 · 保存请用“保存装置”</span></footer>
  </section>;
}

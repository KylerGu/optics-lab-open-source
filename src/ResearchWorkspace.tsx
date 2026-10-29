import { builderConversationId } from './builderTabs';
import { createPortal } from 'react-dom';
import { builderConversation, promoteBuilderConversation, sameApparatus, updateConversationObject, type BuilderConversationContext } from './researchConversation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, BarChart3, Check, ChevronRight, CircleHelp, Download, FileText, FlaskConical, FolderOpen, LoaderCircle, MessageSquare, MoreHorizontal, Paperclip, Plus, RefreshCw, Sparkles, Square, Trash2, X } from 'lucide-react';
import AssistantAnswer from './AssistantAnswer';
import ResearchVisualActions from './ResearchVisualActions';
import type { ResearchVisualGuide } from './researchVisual';
import { useLocalDebug } from './useLocalDebug';
import ResearchRecordResults from './ResearchRecordResults';
import { collectResearchArtifacts, groupResearchArtifacts } from './researchResultRecords';
import ResearchObjectPicker, { ResearchObjectUpdate } from './ResearchObjectPicker';
import type { SpatialExperiment } from './builderModel';
import { MAX_RESEARCH_OBJECTS, SOURCE_LABELS, attachResearchObject, importedObjectChoice, readResearchObjectSources, refreshedResearchObject, type ObjectChoice, type ResearchObject } from './researchObjects';
import { assistantErrorMessage } from './agent';
import { type AgentStep } from './spatialAgent';
import { RESEARCH_WORKSPACE_KEY, parseResearchStorage, cancelResearchAgent, downloadResearch, newResearchProject, readResearchStorage, requestResearchAgent, researchHistory, researchReport, retainResearchBuilds, type ResearchProject, type ResearchStorage, type ResearchTurn } from './researchSession';
import './research-workspace.css';
import { applyResearchTitle } from './researchTitle';
import { currentResearchPlan } from './researchPlan';
import { ResearchPlanList, ResearchRecordList } from './ResearchSidebar';
import { useResearchLayout } from './researchLayout';
import { findResearchArchive } from './researchBuilderLink';
import type { ResearchBuilderOrigin } from './researchBuilderIdentity';
import { readSavedSpatial } from './spatialStorage';

interface Props { builderContext?: BuilderConversationContext | null; inBuilder?: boolean; visible?: boolean; onOpenBuilder: (experiment?: SpatialExperiment, origin?: ResearchBuilderOrigin, guide?: ResearchVisualGuide) => void }
const STARTERS = [
  { title: '看懂一个现象', text: '为什么激光经过透镜后，光斑不是一直变小？请用一个简单的仿真实验帮我直观理解。', icon: CircleHelp },
  { title: '改变参数看看', text: '光束初始束腰越小，传播时扩展得越慢吗？请选择示范条件，比较两组结果，告诉我该观察哪里。', icon: BarChart3 },
  { title: '设计一个小实验', text: '请设计一个简单的双缝干涉仿真实验，让我观察缝间距改变时条纹如何变化，并解释原因。', icon: FlaskConical },
];


export default function ResearchWorkspace({ onOpenBuilder, visible = true, builderContext = null, inBuilder = false }: Props) {
  const layout = useResearchLayout();
  const [initial] = useState(readResearchStorage);
  const [savedApparatus, setSavedApparatus] = useState(() => { try { return readSavedSpatial(); } catch { return []; } });
  const [store, setStore] = useState<ResearchStorage>(() => {
    if (initial.projects.length) return initial;
    const project = newResearchProject(); return { schemaVersion: 2, selectedId: project.id, projects: [project] };
  });
  const [detachedInitial] = useState(() => {
    try { const raw=localStorage.getItem('optics-builder-conversations-v1'); return {projects:raw?parseResearchStorage(JSON.parse(raw),1000).projects:[],warning:null}; }
    catch { return {projects:[] as ResearchProject[],warning:'独立光路的旧对话暂时无法读取，原记录保留，请先导出备份。'}; }
  });
  const [detached,setDetached]=useState<ResearchProject[]>(()=>detachedInitial.projects.filter(p=>!initial.projects.some(row=>row.id===p.id)));
  const promotedIds=useRef(new Set(initial.projects.map(p=>p.id)));
  const binding=builderContext?builderConversation(builderContext.tab,store.projects):null;
  const standaloneId=builderContext?'builder:'+builderConversationId(builderContext.tab):null;
  const newStandalone=useMemo(()=>{
    const p=newResearchProject();
    return {...p,id:standaloneId??p.id,title:'独立光路对话',titleMode:'manual' as const,objects:builderContext?[{id:'apparatus',source:'draft' as const,sourceId:builderContext.tab.id,label:'当前光路',experiment:builderContext.tab.history.present,snapshotAt:new Date().toISOString()}]:[],activeObjectId:builderContext?'apparatus':null};
  },[standaloneId]);
  const standalone=detached.find(p=>p.id===standaloneId)??newStandalone;
  const blockedBinding=!!(inBuilder&&(binding?.missing||binding?.ambiguous||binding?.conflict));
  const project = inBuilder&&builderContext?(binding?.selected?.project??standalone):(store.projects.find(p => p.id === store.selectedId) ?? store.projects[0]);
  const currentObject = project.objects.find(o => o.id === project.activeObjectId);
  const latest = useRef({projects:[...store.projects,...detached],project,builderContext}); latest.current={projects:[...store.projects,...detached],project,builderContext};
  const [configured, setConfigured] = useState<boolean | null>(null), [checking, setChecking] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null), [storageError, setStorageError] = useState(initial.warning);
  const [running, setRunning] = useState<Record<string, AgentStep[]>>({});
  const busy = project.id in running, steps = running[project.id] ?? [];
  const activity = steps.at(-1);
  const pendingLabel = activity?.name === 'phase_explain' ? '正在分析与整理结果…' : activity?.name === 'phase_compute' ? '正在计算…' : activity?.name.startsWith('builder_') ? '正在搭建光路…' : '正在探究问题…';
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [update, setUpdate] = useState<{ original: ResearchObject; next: ResearchObject } | null>(null);
  const file = useRef<HTMLInputElement>(null), fileObjectId = useRef<string | null>(null);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const resultDialog = useRef<HTMLDialogElement>(null), deleteDialog = useRef<HTMLDialogElement>(null);
  const active = useRef(new Map<string, AbortController>()), conversation = useRef<HTMLDivElement>(null), textarea = useRef<HTMLTextAreaElement>(null);
  const artifacts = useMemo(() => collectResearchArtifacts(project), [project]);
  const records = useMemo(() => groupResearchArtifacts(artifacts), [artifacts]);
  const modelSources = useMemo(()=>{
    const sources=new Map<string,(typeof artifacts)[number]>();
    for(const artifact of artifacts)if(artifact.kind==='model'){sources.delete(artifact.input.sceneId);sources.set(artifact.input.sceneId,artifact);}
    return [...sources.values()];
  },[artifacts]);
  const selectedArtifact = artifacts.find(a => a.id === artifactId);
  useLocalDebug('research', {
    projectId: project.id, title: project.title, activeObjectId: project.activeObjectId,
    objects: project.objects, latestTurn: project.turns.at(-1) ?? null,
    selectedResultId: artifactId, busy, error,
  }, visible);
  const selectedRecord = records.find(record => record.artifacts.some(a => a.id === artifactId));
  const planDialog = useRef<HTMLDialogElement>(null);
  const plan = currentResearchPlan(project.turns);
  const hasPlanProgress = !![...project.turns].reverse().find(t => t.reply?.plan.length)?.reply?.planProgress;
  useEffect(()=>{setError(null);setArtifactId(null);setUpdate(null);setPickerOpen(false);resultDialog.current?.close();},[project.id,builderContext?.tab.id]);

  function changeProject(id: string, change: (p: ResearchProject) => ResearchProject) {
    const previous=latest.current.projects.find(p=>p.id===id)??(latest.current.project.id===id?latest.current.project:undefined);
    if(!previous)return;
    const next={...change(previous),updatedAt:new Date().toISOString()};
    latest.current={...latest.current,projects:[...latest.current.projects.filter(p=>p.id!==id),next],project:latest.current.project.id===id?next:latest.current.project};
    if(id.startsWith('builder:')&&!promotedIds.current.has(id))setDetached(s=>[...s.filter(p=>p.id!==id),next]);
    else setStore(s=>({...s,projects:s.projects.map(p=>p.id===id?next:p)}));
  }
  useEffect(()=>{
    if(!builderContext)return;
    const selected=binding?.selected;
    if(selected){
      // The builder follows its linked conversation without changing the research workspace selection.
      if(!binding?.conflict&&!binding?.missing){
        const next=builderContext.tab.history.present;
        if(!sameApparatus(selected.object.experiment,next)||inBuilder&&selected.project.activeObjectId!==selected.object.id)changeProject(selected.project.id,p=>({...updateConversationObject(p,selected.object.id,next),activeObjectId:inBuilder?selected.object.id:p.activeObjectId}));
        if(builderContext.tab.researchContext?.key!==selected.key||!sameApparatus(builderContext.tab.researchContext.baseline,next))builderContext.bind(selected.key,next);
      }
    }else if(inBuilder&&!builderContext.tab.researchKeys?.length){
      const p=latest.current.projects.find(p=>p.id===standaloneId)??standalone;
      if(!detached.some(row=>row.id===p.id)||!sameApparatus(p.objects.find(o=>o.id===p.activeObjectId)?.experiment,builderContext.tab.history.present))changeProject(p.id,row=>updateConversationObject(row,row.activeObjectId!,builderContext.tab.history.present));
    }
  },[builderContext,inBuilder,store.projects,standaloneId,detached]);
  useEffect(()=>{
    if(detachedInitial.warning)return;
    try{localStorage.setItem('optics-builder-conversations-v1',JSON.stringify({schemaVersion:2,selectedId:null,projects:detached}));}
    catch{setStorageError('独立光路对话未能保存，请导出备份。');}
  },[detached,detachedInitial.warning]);
  function resolveVersion(useBuilder:boolean){
    const selected=binding?.selected;if(!selected||!builderContext)return;
    if(active.current.has(selected.project.id)){setError('请先停止本轮回复，再选择装置版本。');return;}
    const next=useBuilder?builderContext.tab.history.present:selected.object.experiment;
    if(!useBuilder&&!builderContext.apply(next,builderContext.tab.history.present)){setError('装置正在变化，请完成调整后重试。');return;}
    changeProject(selected.project.id,p=>updateConversationObject(p,selected.object.id,next));
    builderContext.bind(selected.key,next);setError(null);
  }
  function setDraft(value: string) { changeProject(project.id, p => ({ ...p, draft: value })); }
  async function checkStatus() {
    setChecking(true); setStatusError(null);
    try {
      const response = await fetch('/api/agent/status', { signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error();
      const data = await response.json(); if (typeof data.configured !== 'boolean') throw new Error();
      setConfigured(data.configured);
      if (!data.configured) setStatusError('AI 模型接口尚未配置。');
    } catch { setConfigured(null); setStatusError('暂时无法连接实验探究助手，请确认后台服务已启动。'); }
    finally { setChecking(false); }
  }
  useEffect(() => { void checkStatus(); return () => { for (const controller of active.current.values()) controller.abort('unmount'); }; }, []);
  useEffect(() => {
    if (visible) { try { setSavedApparatus(readSavedSpatial()); } catch { /* Keep the last readable list. */ } }
    else {
      resultDialog.current?.close(); deleteDialog.current?.close(); planDialog.current?.close();
      setPickerOpen(false); setUpdate(null);
    }
  }, [visible]);
  useEffect(() => {
    if (!initial.writable) return;
    try { localStorage.setItem(RESEARCH_WORKSPACE_KEY, JSON.stringify(store)); setStorageError(null); }
    catch { setStorageError('浏览器存储空间不足或不可用。当前探究仍可使用，请导出记录备份。'); }
  }, [store, initial.writable]);
  useEffect(() => {
    const el = conversation.current; if (el) el.scrollTop = el.scrollHeight;
  }, [project.id, project.turns, busy, steps]);
  useEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = 'auto'; textarea.current.style.height = Math.min(180, Math.max(72, textarea.current.scrollHeight)) + 'px';
  }, [project.draft]);

  function startNew() {
    if (store.projects.length >= 30) { setError('最多保留 30 项探究，请先导出并整理已有记录。'); return; }
    const next = newResearchProject(); setStore(s => ({ ...s, selectedId: next.id, projects: [next, ...s.projects] })); setError(null); setArtifactId(null);
  }
  function chooseDevice() {
    if (project.objects.length >= MAX_RESEARCH_OBJECTS) { setError(`每项探究最多保留 ${MAX_RESEARCH_OBJECTS} 个对象，请先移除不用的对象。`); return; }
    setPickerOpen(true);
  }
  function attachObjects(choices: ObjectChoice[]) {
    try {
      const additions = choices.map(attachResearchObject);
      changeProject(project.id, p => ({ ...p, objects: [...p.objects, ...additions], activeObjectId: p.activeObjectId ?? additions[0].id }));
      setPickerOpen(false); setError(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '选入对象失败。'); }
  }
  function removeObject(id: string) {
    changeProject(project.id, p => { const objects = p.objects.filter(o => o.id !== id); return { ...p, objects, activeObjectId: p.activeObjectId === id ? objects[0]?.id ?? null : p.activeObjectId }; });
  }
  function builderOrigin(object: ResearchObject): ResearchBuilderOrigin {
    return { projectId: project.id, objectId: object.id, savedId: object.source === 'saved' && !object.sourceId.startsWith('legacy:') ? object.sourceId : null };
  }
  function openObject(object: ResearchObject, guide?: ResearchVisualGuide) {
    if(project.id.startsWith('builder:')&&!promotedIds.current.has(project.id)){
      if(guide&&builderContext&&sameApparatus(object.experiment,builderContext.tab.history.present))builderContext.locate(guide);
      else onOpenBuilder(object.experiment,undefined,guide);
    }else onOpenBuilder(object.experiment,builderOrigin(object),guide);
  }
  function linkedArchive(object: ResearchObject) { return findResearchArchive(builderOrigin(object), savedApparatus); }
  function refreshObject(object: ResearchObject) {
    try {
      const archive = findResearchArchive(builderOrigin(object), readSavedSpatial());
      if (archive) { setUpdate({ original: object, next: { ...object, experiment: structuredClone(archive.experiment), snapshotAt: new Date().toISOString() } }); return; }
    } catch { setError('已保存装置暂时无法读取，请稍后重试。'); return; }
    if (object.source === 'file') { fileObjectId.current = object.id; file.current?.click(); return; }
    try { setUpdate({ original: object, next: refreshedResearchObject(object, readResearchObjectSources().choices) }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '来源暂时无法读取。'); }
  }
  async function updateFile(input: File) {
    try {
      const object = project.objects.find(o => o.id === fileObjectId.current);
      if (!object) return;
      if (input.size > 1024 * 1024) throw new Error('装置文件不能超过 1 MB。');
      const choice = importedObjectChoice(JSON.parse(await input.text()), input.name);
      setUpdate({ original: object, next: { ...object, label: choice.label, experiment: choice.experiment!, snapshotAt: new Date().toISOString() } });
    } catch (reason) { setError(reason instanceof SyntaxError ? '文件不是有效的装置 JSON，请重新选择。' : reason instanceof Error ? reason.message : '文件读取失败。'); }
  }
  function viewArtifact(id: string) { setArtifactId(records.find(record => record.id === id)?.primaryId ?? id); resultDialog.current?.showModal(); }
  async function send(override?: string) {
    let current = latest.current.project;
    const message = (override ?? current?.draft ?? '').trim();
    if (blockedBinding || inBuilder && builderContext?.editing || !current || active.current.has(current.id) || !message || !configured) return;
    if (active.current.size >= 2) { setError('已有两项探究正在进行，请等待其中一项完成。'); return; }
    if (message.length > 2000 || current.turns.length >= 80) { setError('每条问题最多 2000 字，每项探究最多 80 轮。较长探究可导出后新建继续。'); return; }
    if(inBuilder&&builderContext&&!binding?.selected){
      if(!initial.writable||detachedInitial.warning){setError('对话存储暂时无法读取，请先恢复记录后再发送。');return;}
      if(store.projects.length>=30){setError('最多保留 30 项探究，请先导出并整理已有记录。');return;}
      current=promoteBuilderConversation(current,builderContext.tab);
      const nextStore={...store,selectedId:current.id,projects:[current,...store.projects]};
      // Persist the destination before removing the legacy independent record.
      try{localStorage.setItem(RESEARCH_WORKSPACE_KEY,JSON.stringify(nextStore));}
      catch{setError('未能保存新探究，请释放浏览器存储空间后重试。');return;}
      promotedIds.current.add(current.id);
      latest.current={...latest.current,project:current,projects:[...latest.current.projects.filter(p=>p.id!==current.id),current]};
      setStore(nextStore);setDetached(s=>s.filter(p=>p.id!==current.id));
      builderContext.bind(JSON.stringify([current.id,current.activeObjectId]),builderContext.tab.history.present);
    }
    const linkedBuilder=builderContext&&(current.id==='builder:'+builderConversationId(builderContext.tab)||builderContext.tab.researchContext?.key===JSON.stringify([current.id,current.activeObjectId]));
    const id = crypto.randomUUID(), controller = new AbortController(), input = current.objects.find(o => o.id === current.activeObjectId)?.experiment ?? null;
    active.current.set(current.id, controller); setRunning(r => ({ ...r, [current.id]: [] })); setError(null);
    controller.signal.addEventListener('abort', () => { void cancelResearchAgent(id); }, { once: true });
    // Max research has a ten-minute backend budget, plus stream delivery margin.
    const timer = setTimeout(() => controller.abort('timeout'), 630000);
    const turn: ResearchTurn = { id, prompt: message, createdAt: new Date().toISOString(), reply: null, error: null };
    changeProject(current.id, p => ({ ...p, draft: '', turns: [...p.turns, turn] }));
    try {
      const reply = await requestResearchAgent(id, input, message, researchHistory(current.turns), controller.signal, step => { if (!controller.signal.aborted) setRunning(r => current.id in r ? { ...r, [current.id]: [...r[current.id], step] } : r); }, current.objects, current.activeObjectId, current.titleMode === 'pending', current.turns, {workspace:inBuilder?'builder':'research',projectId:current.id,tabId:linkedBuilder?builderContext?.tab.id:null,selectedElementId:linkedBuilder?builderContext?.selectedElementId:null});
      if (controller.signal.aborted) throw new Error('请求已停止。');
      let applied=false;
      const edit=reply.apparatusEdits?.at(-1);
      const build=reply.apparatusBuilds?.[0];
      const editedBuild=build&&edit?.objectId===build.objectId;
      if(edit&&!editedBuild){
        const before=reply.apparatusEdits![0].reply.inputSnapshot;
        const now=latest.current.projects.find(p=>p.id===current.id);
        const context=latest.current.builderContext;
        const object=now?.objects.find(o=>o.id===edit.objectId);
        const ownsTab=context&&(current.id==='builder:'+builderConversationId(context.tab)||context.tab.researchContext?.key===JSON.stringify([current.id,edit.objectId]));
        applied=reply.editsApplyAllowed!==false&&!!object&&sameApparatus(object.experiment,before)&&(!inBuilder||ownsTab===true);
        if(applied&&ownsTab&&context){applied=context.apply(edit.reply.experiment,before);if(applied&&context.tab.researchContext)context.bind(context.tab.researchContext.key,edit.reply.experiment);}
        reply.answer+='\n\n'+(applied?'（修改已应用，后续交流使用新参数；前后计算分别保留原条件。保存装置存档请使用“保存装置”。）':reply.editsApplyAllowed===false?'（本轮任务未完整完成，修改未应用；已完成的候选计算保留，当前装置不变。）':'（本轮修改未应用：装置、关联或工作区已变化。当前参数保留；修改后读数仅对应候选方案，请按最新装置重试。）');
      }
      // An independent empty bench can receive its first verified apparatus.
      const builtExperiment=build&&reply.objectSnapshots?.find(o=>o.id===build.objectId)?.experiment;
      let buildApplied=false;
      if(build&&inBuilder&&current.id.startsWith('builder:')){
        const context=latest.current.builderContext;
        if(context&&current.id==='builder:'+builderConversationId(context.tab)&&input&&builtExperiment&&reply.editsApplyAllowed!==false&&context.apply(builtExperiment,input)){buildApplied=true;context.bind(JSON.stringify([current.id,build.objectId]),builtExperiment);reply.answer+='\n\n（新装置已载入当前光路，尚未保存装置存档。）';}
        else reply.answer+='\n\n（当前光路已变化，新装置未载入；已作为候选装置保留。）';
      }
      changeProject(current.id, p => {
        const retained=applyResearchTitle(retainResearchBuilds(p,reply,new Date().toISOString()),reply.researchTitle);
        if(build&&inBuilder&&current.id.startsWith('builder:')&&!buildApplied)retained.activeObjectId=p.activeObjectId;
        const next=edit&&applied?updateConversationObject(retained,edit.objectId,edit.reply.experiment):retained;
        return {...next,turns:p.turns.map(t=>t.id===id?{...t,reply}:t)};
      });
    } catch (reason) {
      if (controller.signal.reason === 'unmount' || controller.signal.reason === 'cancel' && active.current.get(current.id) !== controller) return;
      const failure = controller.signal.aborted ? controller.signal.reason === 'timeout' ? '本轮没有收到完整回复，请重试。' : '已停止本轮探究，未保存不完整的计算结果。' : assistantErrorMessage(reason);
      changeProject(current.id, p => ({ ...p, draft: p.draft || message, turns: p.turns.map(t => t.id === id ? { ...t, error: failure } : t) }));
    } finally { clearTimeout(timer); if (active.current.get(current.id) === controller) { active.current.delete(current.id); setRunning(r => { const next = { ...r }; delete next[current.id]; return next; }); } }
  }
  function stopResearch(event: React.MouseEvent<HTMLButtonElement>) {
    // The same button becomes a submit button after stopping. Suppress the
    // click's form default so the cancelled question is not sent again.
    event.preventDefault();
    const controller = active.current.get(project.id);
    if (!controller) return;
    controller.abort('cancel');
    active.current.delete(project.id);
    setRunning(r => { const next = { ...r }; delete next[project.id]; return next; });
    changeProject(project.id, p => ({ ...p, draft: p.draft || p.turns.find(t => !t.reply && !t.error)?.prompt || '', turns: p.turns.map(t => !t.reply && !t.error ? { ...t, error: '已停止本轮探究，未保存不完整的计算结果。' } : t) }));
  }
  function exportProject(format: 'json' | 'md') {
    downloadResearch(format === 'json' ? { schemaVersion: 2, selectedId: project.id, projects: [project] } : researchReport(project), project.title + '-探究记录', format);
  }
  function deleteProject() {
    if (busy) return;
    const remaining = store.projects.filter(p => p.id !== project.id);
    if (!remaining.length) remaining.push(newResearchProject());
    setStore({ schemaVersion: 2, selectedId: remaining[0].id, projects: remaining }); deleteDialog.current?.close(); setArtifactId(null); setError(null);
  }

  const content = <main ref={layout.workspace} style={layout.style} className={`research-workspace${inBuilder?' rw-builder-conversation':''}${layout.dragging ? ' rw-resizing' : ''}${layout.leftHidden ? ' rw-left-hidden' : ''}${layout.rightHidden ? ' rw-right-hidden' : ''}`} aria-label="实验探究工作区">
    <aside id="research-projects" className="rw-projects" hidden={layout.leftHidden}>
      <div className="rw-projects-title"><span><FolderOpen size={17}/>我的探究</span></div>
      <button className="rw-button rw-new-research" onClick={startNew}><Plus size={16}/>新建探究</button>
      <nav className="rw-project-list" aria-label="探究记录" data-navigation-scroll="research-projects">{store.projects.map(p => <button key={p.id} className={`rw-project-item ${p.id === project.id ? 'is-selected' : ''}`} aria-current={p.id === project.id ? 'page' : undefined} onClick={() => { setStore(s => ({ ...s, selectedId: p.id })); setError(null); setArtifactId(null); setPickerOpen(false); setUpdate(null); }}><MessageSquare size={16}/><span><strong>{p.title}</strong><small>{p.objects.length ? `${p.objects.length} 个装置` : p.turns.length ? `${p.turns.length} 轮探究` : '从一个问题开始'}</small></span></button>)}</nav>
    </aside>
    <div className="rw-resize-handle rw-resize-left" {...layout.leftSeparator}/>
    <section className="rw-main">
      <header className="rw-project-header"><button className="rw-panel-toggle" aria-label={layout.leftHidden ? '展开探究记录栏' : '收起探究记录栏'} aria-expanded={!layout.leftHidden} aria-controls="research-projects" title={layout.leftHidden ? '展开探究记录栏' : '收起探究记录栏'} onClick={() => layout.toggle('left')}><FolderOpen size={18}/></button><div><input aria-label="探究名称" value={project.title} maxLength={80} disabled={busy} onChange={event => changeProject(project.id, p => ({ ...p, title: event.target.value.trim() ? event.target.value : '未命名探究', titleMode: 'manual' }))}/><span className="rw-save-status">{storageError ? '记录未保存，请导出备份' : '自动保存'}</span></div><button className="rw-panel-toggle" aria-label={layout.rightHidden ? '展开装置与结果栏' : '收起装置与结果栏'} aria-expanded={!layout.rightHidden} aria-controls="research-inspector" title={layout.rightHidden ? '展开装置与结果栏' : '收起装置与结果栏'} onClick={() => layout.toggle('right')}><FileText size={18}/></button><details className="rw-project-menu"><summary aria-label="探究操作"><MoreHorizontal size={20}/></summary><div><button onClick={startNew}><Plus size={15}/>新建探究</button>{plan.length > 0 && <button onClick={() => planDialog.current?.showModal()}><FileText size={15}/>查看探究计划</button>}<button onClick={() => exportProject('md')}><FileText size={15}/>下载探究笔记</button><button onClick={() => exportProject('json')}><Download size={15}/>保存探究记录</button><button disabled={busy} onClick={() => deleteDialog.current?.showModal()}><Trash2 size={15}/>删除这项探究</button></div></details></header>
      {inBuilder&&<div className="rw-builder-context"><strong>{binding?.selected?binding.selected.project.title:'独立光路对话'}</strong><span>当前装置：{builderContext?.tab.history.present.name}</span>{builderContext?.selectedElementId&&<small>选中器件：{builderContext.tab.history.present.elements.find(e=>e.id===builderContext.selectedElementId)?.name}</small>}{binding&&binding.candidates.length>1&&<label>所属探究<select aria-label="选择关联探究" value={binding.selected?.key??''} disabled={busy} onChange={e=>{const c=binding.candidates.find(c=>c.key===e.target.value);if(c&&builderContext)builderContext.bind(c.key,builderContext.tab.history.present);}}><option value="" disabled>请选择要继续的探究</option>{binding.candidates.map(c=><option key={c.key} value={c.key}>{c.project.title} · {c.object.experiment.name}</option>)}</select></label>}{binding?.missing&&<p role="alert">原关联探究或装置已移除，无法确定对话归属。请从需要继续的探究重新打开装置，或新建独立光路。</p>}{binding?.ambiguous&&<p role="alert">此装置关联多个探究，请先选择要继续的对话。</p>}{binding?.conflict&&<div role="alert"><p>探究与光路中的装置参数版本不同。请选择后续使用的版本；历史结果保持原参数。</p><button disabled={busy} onClick={()=>resolveVersion(true)}>使用当前光路参数</button><button disabled={busy} onClick={()=>resolveVersion(false)}>使用探究中的参数</button></div>}{detachedInitial.warning&&<p role="alert">{detachedInitial.warning}</p>}</div>}
      {storageError && <div className="rw-warning" role="status">{storageError}</div>}
      <div className="rw-conversation" ref={conversation} data-navigation-scroll="research-conversation" role="log" aria-label="探究对话" aria-live="polite">
        {inBuilder&&(binding?.missing||binding?.ambiguous)?null:!project.turns.length ? <div className="rw-welcome"><div className="rw-welcome-symbol"><Sparkles size={27}/></div><span className="rw-eyebrow">光学实验探究助手</span><h1>用实验，看懂光学</h1><p>说说你没想明白的原理或现象，<br/>一起设计实验、观察变化、理解原因。</p><div className="rw-starters">{STARTERS.map(item => { const Icon = item.icon; return <button key={item.title} disabled={busy} onClick={() => { setDraft(item.text); textarea.current?.focus(); }}><Icon size={20}/><strong>{item.title}</strong><ChevronRight size={15}/></button>; })}</div></div> : project.turns.map(turn => {
          const turnRecords = records.filter(record => record.requestId === turn.id);
          return <article key={turn.id} className="rw-turn"><div className="rw-user-message"><span>你</span><p>{turn.prompt}</p></div>{turn.reply ? <div className="rw-agent-message"><div className="rw-agent-name"><Sparkles size={17}/><strong>光学实验探究助手</strong></div><AssistantAnswer text={turn.reply.answer}/><ResearchVisualActions reply={turn.reply} objects={project.objects} disabled={busy} onOpen={openObject}/>{turnRecords.length > 0 && <div className="rw-turn-artifacts">{turnRecords.map(a => <button key={a.id} onClick={() => viewArtifact(a.id)}><BarChart3 size={15}/>{a.title}<ArrowUpRight size={14}/></button>)}</div>}</div> : turn.error ? <div className="rw-turn-error" role="alert"><p>{turn.error}</p><button className="rw-text-button" disabled={busy || !configured} onClick={() => void send(turn.prompt)}><RefreshCw size={14}/>重试这个问题</button></div> : <div className="rw-pending"><LoaderCircle size={16}/><span>{pendingLabel}</span></div>}</article>;
        })}
      </div>
      <div className="rw-composer-area">
        {(statusError || configured === false) && <div className="rw-connection"><span>{statusError ?? 'AI 模型接口尚未配置。'}</span><button className="rw-text-button" disabled={checking || busy} onClick={() => void checkStatus()}><RefreshCw size={14}/>{checking ? '检测中' : '重新检测'}</button></div>}
        {error && <p className="rw-input-error" role="alert">{error}</p>}
        {currentObject ? <div className="rw-current-object"><Paperclip size={13}/><span>当前装置：{currentObject.experiment.name}</span>{project.objects.length > 1 && <small>可在问题中指定多个对象进行比较</small>}</div>:modelSources.length>0&&<div className="rw-current-object"><Paperclip size={13}/><span>当前模型：{modelSources.at(-1)!.title.split(' · ')[0]}</span></div>}
        <form className="rw-composer" onSubmit={event => { event.preventDefault(); void send(); }}><label className="sr-only" htmlFor="research-prompt">探究问题</label><textarea ref={textarea} id="research-prompt" value={project.draft} maxLength={2000} disabled={busy} onChange={event => setDraft(event.target.value)} placeholder={project.turns.length ? '哪里还没明白？也可以试着改变一个条件…' : '哪个光学现象让你困惑？直接说说你的问题…'} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}/><div className="rw-composer-actions"><button className="rw-text-button" type="button" disabled={busy} onClick={chooseDevice}><Paperclip size={16}/>选择装置</button><span>{checking ? '正在连接助手…' : 'Ctrl + Enter 发送'}</span>{busy ? <button className="rw-button" type="button" onClick={stopResearch}><Square size={12}/>停止</button> : <button className="rw-button rw-primary" type="submit" disabled={blockedBinding || !!(inBuilder&&builderContext?.editing) || !configured || !project.draft.trim()}>发送<ArrowRight size={16}/></button>}</div></form>
      </div>
    </section>
    <div className="rw-resize-handle rw-resize-right" {...layout.rightSeparator}/>
    <aside id="research-inspector" hidden={layout.rightHidden} className="rw-inspector" aria-label="装置与结果" data-navigation-scroll="research-results">
      <div className="rw-inspector-heading"><FileText size={18}/><h2>装置与结果</h2></div>
      <section className="rw-inspector-section"><div className="rw-section-heading"><h3>实验装置 {project.objects.length > 0 && `· ${project.objects.length}`}</h3><button className="rw-icon-button" aria-label="添加探究对象" disabled={busy} onClick={chooseDevice}><Plus size={15}/></button></div>{project.objects.length ? <><div className="rw-attached-objects">{project.objects.map(object => <div key={object.id} className={`rw-attached-object ${object.id === project.activeObjectId ? 'is-current' : ''}`}><div className="rw-object-meta"><span>{SOURCE_LABELS[object.source]}</span><button className="rw-text-button" aria-pressed={object.id === project.activeObjectId} disabled={busy} onClick={() => changeProject(project.id, p => ({ ...p, activeObjectId: object.id }))}>{object.id === project.activeObjectId ? <><Check size={12}/>当前装置</> : '设为当前'}</button></div><button className="rw-device-link" disabled={busy} onClick={() => openObject(object)}><Paperclip size={15}/><span>{object.experiment.name}</span><ArrowUpRight size={14}/></button><div className="rw-object-actions">{(object.source !== 'generated' || linkedArchive(object)) && <button className="rw-text-button" disabled={busy} onClick={() => refreshObject(object)}><RefreshCw size={12}/>{object.source === 'file' && !linkedArchive(object) ? '重新导入参数' : '更新参数'}</button>}<button className="rw-text-button" aria-label={`移除探究对象 ${object.experiment.name}`} disabled={busy} onClick={() => removeObject(object.id)}><X size={12}/>移除</button></div>{object.source === 'file' && <small className="rw-object-time">{object.label}</small>}</div>)}</div></> : <p className="rw-empty-text">直接提问即可，助手会按需选择模型或搭建装置。也可以选入你已有的装置。</p>}<button className="rw-button" disabled={busy} onClick={chooseDevice}><Plus size={14}/>选择装置</button></section>
      {records.length > 0 && <section className="rw-inspector-section"><div className="rw-section-heading"><h3>实验记录</h3><span className="rw-record-count">{records.length}</span></div><ResearchRecordList records={records} onSelect={viewArtifact}/></section>}
    </aside>
    {pickerOpen && <ResearchObjectPicker objects={project.objects} onChoose={attachObjects} onClose={() => setPickerOpen(false)}/>}
    {update && <ResearchObjectUpdate original={update.original} next={update.next} onClose={() => setUpdate(null)} onUpdate={() => { changeProject(project.id, p => ({ ...p, objects: p.objects.map(o => o.id === update.original.id ? update.next : o) })); setUpdate(null); setError(null); }}/>}
    <input ref={file} type="file" accept=".json,application/json" hidden aria-label="重新导入探究对象参数" onChange={e => { const input = e.target.files?.[0]; if (input) void updateFile(input); e.target.value = ''; }}/>
    <dialog ref={resultDialog} className="rw-dialog rw-result-dialog" aria-label="探究计算结果"><header><span>实验记录</span><button className="rw-icon-button" aria-label="关闭探究结果" onClick={() => resultDialog.current?.close()}><X size={20}/></button></header>{selectedRecord && selectedArtifact && <ResearchRecordResults record={selectedRecord} selectedArtifactId={selectedArtifact.id} onSelectArtifact={setArtifactId} onOpenBuilder={input => { resultDialog.current?.close(); onOpenBuilder(input); }}/>}</dialog>
    <dialog ref={planDialog} className="rw-dialog rw-plan-dialog" aria-labelledby="research-plan-title"><header><h2 id="research-plan-title">探究计划</h2><button className="rw-icon-button" aria-label="关闭探究计划" onClick={() => planDialog.current?.close()}><X size={20}/></button></header><ResearchPlanList plan={plan} hasProgress={hasPlanProgress} artifacts={artifacts} onSelect={id => { planDialog.current?.close(); viewArtifact(id); }}/></dialog>
    <dialog ref={deleteDialog} className="rw-dialog rw-delete-dialog" aria-labelledby="research-delete-title"><header><h2 id="research-delete-title">删除这项探究？</h2><button className="rw-icon-button" aria-label="关闭删除确认" onClick={() => deleteDialog.current?.close()}><X size={19}/></button></header><p>将移除“{project.title}”的对话和计算记录。关联的光路装置仍保留。</p><div className="rw-dialog-actions"><button className="rw-button" onClick={() => exportProject('json')}>先导出记录</button><button className="rw-button" onClick={() => deleteDialog.current?.close()}>取消</button><button className="rw-button rw-danger" onClick={deleteProject}>删除探究</button></div></dialog>
  </main>;
  return inBuilder&&builderContext?.host?createPortal(content,builderContext.host):content;
}

import {parseSpatial,spatialTemplate,type SpatialExperiment} from './builderModel';
import {parseConversationId,saveSpatialSnapshot,type SavedSpatial} from './spatialStorage';
import {parseResearchBuilderKeys} from './researchBuilderIdentity';

export const BUILDER_TABS='optics-spatial-tabs-v1';
export interface BuilderHistory {past:SpatialExperiment[];present:SpatialExperiment;future:SpatialExperiment[]}
export interface BuilderTab {id:string;savedId:string|null;history:BuilderHistory;resetBaseline?:SpatialExperiment;conversationId?:string;researchKeys?:string[];researchContext?:{key:string;baseline:SpatialExperiment}}
export interface BuilderTabs {activeId:string;tabs:BuilderTab[]}
export const builderConversationId=(tab:BuilderTab)=>tab.conversationId??tab.id;
export function newBuilderTab(experiment:SpatialExperiment,savedId:string|null=null,conversationId?:string,resetBaseline:SpatialExperiment=experiment):BuilderTab{
  const id=crypto.randomUUID();
  return {id,savedId,resetBaseline:parseSpatial(resetBaseline),conversationId:parseConversationId(conversationId)??id,history:{past:[],present:parseSpatial(experiment),future:[]}};
}
export function initialBuilderTabs(experiment:SpatialExperiment,savedId:string|null=null,conversationId?:string):BuilderTabs{
  const tab=newBuilderTab(experiment,savedId,conversationId);return {activeId:tab.id,tabs:[tab]};
}
export function openBuilderTab(state:BuilderTabs,experiment:SpatialExperiment,savedId:string|null=null,conversationId?:string,resetBaseline?:SpatialExperiment):BuilderTabs{
  const existing=savedId&&state.tabs.find(tab=>tab.savedId===savedId);
  if(existing)return {...state,activeId:existing.id};
  if(state.tabs.length>=40)throw new Error('最多同时打开 40 个装置，请先关闭一些标签页。');
  const tab=newBuilderTab(experiment,savedId,conversationId,resetBaseline);return {activeId:tab.id,tabs:[...state.tabs,tab]};
}
// Upgrade legacy open tabs by exact saved ID; do not infer links from names or parameters.
export function rememberBuilderConversations(tabs:BuilderTab[],saved:SavedSpatial[]):SavedSpatial[]{
  let changed=false;
  const next=saved.map(row=>{
    const tab=tabs.find(t=>t.savedId===row.id);if(!tab)return row;
    const conversationId=builderConversationId(tab);
    if(row.conversationId&&row.conversationId!==conversationId)throw new Error('装置与标签的对话关联不同，未覆盖原记录。');
    if(row.conversationId)return row;
    if(saved.some(other=>other.id!==row.id&&other.conversationId===conversationId))throw new Error('装置对话关联重复，未覆盖原记录。');
    changed=true;return {...row,conversationId};
  });
  return changed?next:saved;
}
export function saveBuilderTabSnapshot(saved:SavedSpatial[],tab:BuilderTab,asCopy=false){
  const existing=rememberBuilderConversations([tab],saved);
  const conversationId=asCopy?crypto.randomUUID():builderConversationId(tab);
  const next=saveSpatialSnapshot(existing,asCopy?null:tab.savedId,tab.history.present,asCopy?undefined:tab.researchKeys,conversationId,tab.resetBaseline??tab.history.present);
  return {saved:next,tab:{...tab,savedId:next[0].id,conversationId,...(asCopy?{researchKeys:undefined,researchContext:undefined}:{})}};
}
export function closeBuilderTab(state:BuilderTabs,id:string):BuilderTabs{
  const index=state.tabs.findIndex(tab=>tab.id===id);if(index<0)return state;
  const tabs=state.tabs.filter(tab=>tab.id!==id);
  if(!tabs.length)return initialBuilderTabs(spatialTemplate('empty'));
  return {tabs,activeId:state.activeId===id?tabs[Math.min(index,tabs.length-1)].id:state.activeId};
}
export function builderTabDirty(tab:BuilderTab,saved:SavedSpatial[]):boolean{
  const archived=tab.savedId&&saved.find(row=>row.id===tab.savedId);
  const baseline=archived?archived.experiment:spatialTemplate('empty');
  return JSON.stringify(tab.history.present)!==JSON.stringify(baseline);
}
export function serializeBuilderTabs(state:BuilderTabs):string{
  return JSON.stringify({version:1,activeId:state.activeId,tabs:state.tabs.map(tab=>({id:tab.id,savedId:tab.savedId,conversationId:builderConversationId(tab),experiment:tab.history.present,resetBaseline:tab.resetBaseline??tab.history.present,...(tab.researchKeys?.length?{researchKeys:tab.researchKeys}:{}),...(tab.researchContext?{researchContext:tab.researchContext}:{})}))});
}
export function parseBuilderTabs(raw:string,saved:SavedSpatial[]):BuilderTabs{
  const value=JSON.parse(raw);
  if(value?.version!==1||!Array.isArray(value.tabs)||!value.tabs.length||value.tabs.length>40)throw new Error('标签页草稿格式无效。');
  const ids=new Set<string>(),archiveIds=new Set<string>();
  const tabs:BuilderTab[]=value.tabs.map((tab:unknown)=>{
    if(!tab||typeof tab!=='object')throw new Error('标签页草稿无效。');
    const t=tab as Record<string,unknown>;
    if(typeof t.id!=='string'||!t.id||t.id.length>100||ids.has(t.id)||!(t.savedId===null||typeof t.savedId==='string'&&t.savedId.length>0&&t.savedId.length<=100))throw new Error('标签页草稿无效。');
    ids.add(t.id);
    const savedId=typeof t.savedId==='string'&&saved.some(row=>row.id===t.savedId)?t.savedId:null;
    if(savedId&&archiveIds.has(savedId))throw new Error('标签页存档重复。');
    if(savedId)archiveIds.add(savedId);
    const researchKeys=parseResearchBuilderKeys(t.researchKeys);
    const archived=saved.find(row=>row.id===savedId);
    const conversationId=parseConversationId(t.conversationId)??archived?.conversationId??t.id;
    if(archived?.conversationId&&archived.conversationId!==conversationId)throw new Error('装置与标签的对话关联不同，原记录保留。');
    let researchContext:BuilderTab['researchContext'];
    if(t.researchContext){const c=t.researchContext as Record<string,unknown>;if(typeof c.key!=='string'||!researchKeys?.includes(c.key))throw new Error('当前探究关联无效。');researchContext={key:c.key,baseline:parseSpatial(c.baseline)};}
    return {id:t.id,savedId,conversationId,resetBaseline:parseSpatial(t.resetBaseline??archived?.resetBaseline??archived?.experiment??t.experiment),history:{past:[],present:parseSpatial(t.experiment),future:[]},...(researchKeys?.length?{researchKeys}:{}),...(researchContext?{researchContext}:{})};
  });
  if(typeof value.activeId!=='string'||!ids.has(value.activeId))throw new Error('当前标签页无效。');
  return {tabs,activeId:value.activeId};
}

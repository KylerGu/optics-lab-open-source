import { BUILDER_SAVED, parseSpatial, type SpatialExperiment } from './builderModel';
import { parseResearchBuilderKeys } from './researchBuilderIdentity';

export interface SavedSpatial {id:string;savedAt:string;experiment:SpatialExperiment;resetBaseline?:SpatialExperiment;researchKeys?:string[];conversationId?:string}
export function parseConversationId(value:unknown):string|undefined{
  if(value===undefined)return undefined;
  if(typeof value!=='string'||!value.trim()||value.length>90)throw new Error('装置对话关联无效。');
  return value;
}
export const BUILDER_ACTIVE_SAVED='optics-spatial-active-saved-v2';
export function readSavedSpatial():SavedSpatial[]{
  const raw=localStorage.getItem(BUILDER_SAVED);if(!raw)return [];
  const rows:unknown=JSON.parse(raw);if(!Array.isArray(rows)||rows.length>40)throw new Error('存档格式无效。');
  const conversations=new Set<string>();
  return rows.map(row=>{if(!row||typeof row.id!=='string'||!row.id||row.id.length>100||typeof row.savedAt!=='string'||!Number.isFinite(Date.parse(row.savedAt)))throw new Error('存档无效。');const researchKeys=parseResearchBuilderKeys(row.researchKeys),conversationId=parseConversationId(row.conversationId);if(conversationId){if(conversations.has(conversationId))throw new Error('多份装置存档共用了对话关联，请先导出备份核对。');conversations.add(conversationId);}return {id:row.id,savedAt:row.savedAt,experiment:parseSpatial(row.experiment),...(row.resetBaseline?{resetBaseline:parseSpatial(row.resetBaseline)}:{}),...(researchKeys?.length?{researchKeys}:{}),...(conversationId?{conversationId}:{})};});
}
export function saveSpatialSnapshot(existing:SavedSpatial[],currentId:string|null,experiment:SpatialExperiment,researchKeys?:string[],conversationId?:string,resetBaseline?:SpatialExperiment):SavedSpatial[]{
  const updating=!!currentId&&existing.some(row=>row.id===currentId);
  if(!updating&&existing.length>=40)throw new Error('最多保存 40 份装置，请先整理存档。');
  const keys=parseResearchBuilderKeys([...new Set([...(updating?existing.find(row=>row.id===currentId)?.researchKeys??[]:[]),...researchKeys??[]])]);
  const chat=parseConversationId(conversationId??(updating?existing.find(row=>row.id===currentId)?.conversationId:undefined));
  if(chat&&existing.some(row=>row.id!==currentId&&row.conversationId===chat))throw new Error('另一份装置已关联此对话，未覆盖存档。');
  const baseline=resetBaseline??(updating?(existing.find(row=>row.id===currentId)?.resetBaseline??existing.find(row=>row.id===currentId)?.experiment):undefined)??experiment;
  const row={resetBaseline:parseSpatial(baseline),id:updating?currentId!:crypto.randomUUID(),savedAt:new Date().toISOString(),experiment:parseSpatial(experiment),...(keys?.length?{researchKeys:keys}:{}),...(chat?{conversationId:chat}:{})};
  return [row,...existing.filter(item=>item.id!==row.id)];
}

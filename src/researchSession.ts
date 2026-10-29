import { parseSpatial, toLegacy, type SpatialExperiment, type SpatialResult } from './builderModel';
import { validateSpatialAgentReply, validateStep, type AgentStep, type SpatialComparison, type SpatialChatMessage, type SpatialAgentReply } from './spatialAgent';
import { validateFocusDesign, type FocusDesign } from './research';
import { validateStabilityStudy, type StabilityStudy } from './tolerance';
import { experimentKey } from './simulation';
import type { Experiment } from './model';
import { MAX_RESEARCH_OBJECTS, SOURCE_LABELS, objectInputs, parseObjectInput, parseResearchObject, type ResearchObject, type ResearchObjectInput } from './researchObjects';
import { restoreResearchTitle, type ResearchTitleMode } from './researchTitle';
import { currentResearchPlan, parsePlanProgress, planStatusLabel, validatePlanEvidence, type ResearchPlanStep } from './researchPlan';
import { parseResearchMethod, type ResearchMethodAssessment } from './researchMethod';
import { validateResearchModels, researchModelInputs, type ResearchModelResult } from './researchModels';
import { SCENE_DEFINITIONS, numberText } from './sceneRuntime';
import { validateVisualActions, type ResearchVisualAction } from './researchVisual';

export const RESEARCH_WORKSPACE_KEY = 'optics-research-workspace-v1';
export interface ResearchObjectResult {
  objectId: string; inputSnapshot: SpatialExperiment; sourceLabel?: string;
  revision?: number;
  evidence: SpatialResult | null; comparisons: SpatialComparison[]; designs: FocusDesign[]; studies: StabilityStudy[];
}
export interface ResearchApparatusBuild {
  objectId: string; baseObjectId: string | null; goal: string; reply: SpatialAgentReply;
}
export interface ResearchApparatusEdit { objectId: string; goal: string; reply: SpatialAgentReply }
export interface ConversationContext { workspace: 'research' | 'builder'; projectId?: string | null; tabId?: string | null; selectedElementId?: string | null }
export interface ResearchReply {
  visualActions?: ResearchVisualAction[];
  requestId: string; inputSnapshot: SpatialExperiment | null; answer: string; trace: AgentStep[];
  plan: string[]; evidence: SpatialResult | null; comparisons: SpatialComparison[]; designs: FocusDesign[]; studies: StabilityStudy[];
  activeObjectId?: string | null; objectSnapshots?: ResearchObjectInput[]; objectResults?: ResearchObjectResult[];
  objectComparisons?: { id: string; objectIds: string[]; revisions?: Record<string, number> }[];
  researchTitle?: string | null;
  planProgress?: ResearchPlanStep[];
  apparatusBuilds?: ResearchApparatusBuild[];
  apparatusEdits?: ResearchApparatusEdit[];
  parameterHistory?: ResearchObjectResult[];
  editsApplyAllowed?: boolean;
  methodAssessment?: ResearchMethodAssessment | null;
  modelResults?: ResearchModelResult[];
}
export interface ResearchTurn {
  id: string; prompt: string; createdAt: string; reply: ResearchReply | null; error: string | null;
}
export interface ResearchProject {
  id: string; title: string; titleMode: ResearchTitleMode; createdAt: string; updatedAt: string; draft: string;
  objects: ResearchObject[]; activeObjectId: string | null;
  turns: ResearchTurn[];
}
export interface ResearchStorage { schemaVersion: 2; selectedId: string | null; projects: ResearchProject[] }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

function validateApparatusBuilds(value: unknown, objects: ResearchObjectInput[]): ResearchApparatusBuild[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 1) throw new Error('每轮最多生成一个探究装置。');
  return value.map(build => {
    if (!record(build) || !text(build.objectId, 100) || !(build.baseObjectId === null || text(build.baseObjectId, 100)) || !text(build.goal, 2000) || !record(build.reply) || !text(build.reply.requestId, 100)) throw new Error('生成装置的交接记录无效。');
    const object = objects.find(o => o.id === build.objectId);
    const base = objects.find(o => o.id === build.baseObjectId);
    const seed = parseSpatial(build.reply.inputSnapshot);
    if (!object || object.source !== 'generated' || build.baseObjectId !== null && (!base || base.id === object.id || JSON.stringify(base.experiment) !== JSON.stringify(seed)) || build.baseObjectId === null && seed.elements.length) throw new Error('生成装置与原对象不一致。');
    const reply = validateSpatialAgentReply(build.reply, build.reply.requestId, seed);
    if (!reply.applyAllowed || !reply.evidence || reply.checks.some(c => !reply.experiment.elements.some(e => e.id === c.criterion.elementId)) || reply.evidence.warnings.some(w => w.includes('停止追踪') || w.includes('上限')) || !reply.experiment.elements.some(e => ['laser', 'object'].includes(e.kind)) || !reply.experiment.elements.some(e => ['screen', 'power-meter', 'sensor', 'eye'].includes(e.kind)) || JSON.stringify(reply.experiment) !== JSON.stringify(object.experiment)) throw new Error('生成装置缺少有效的计算结果，不能加入探究。');
    return { objectId: object.id, baseObjectId: build.baseObjectId as string | null, goal: build.goal, reply };
  });
}

export function validateResearchReply(v: unknown, id: string, input: SpatialExperiment | null, expectedObjects?: ResearchObjectInput[], activeObjectId?: string | null): ResearchReply {
  if (!record(v) || v.requestId !== id || !text(v.answer, 12000) || !Array.isArray(v.plan) || v.plan.length > 6 || !v.plan.every(p => text(p, 160)) || !Array.isArray(v.trace) || v.trace.length > 24 || !Array.isArray(v.designs) || v.designs.length > 1 || !Array.isArray(v.studies) || v.studies.length > 2 || !Array.isArray(v.comparisons)) throw new Error('探究回复数据无效，请重试。');
  const responseObjects = Array.isArray(v.objectSnapshots) ? v.objectSnapshots.map(parseObjectInput) : [];
  const visualActions = validateVisualActions(v.visualActions, responseObjects);
  if (v.apparatusEdits !== undefined && (!Array.isArray(v.apparatusEdits) || v.apparatusEdits.length > 3)) throw new Error('装置修改交接记录无效。');
  // A new apparatus can be corrected in this turn; validate its initial build and edit chain separately.
  const buildObjects = responseObjects.map(object => {
    const first = (v.apparatusEdits as unknown[] | undefined)?.find(e => record(e) && e.objectId === object.id);
    return record(first) && record(first.reply) ? { ...object, experiment: parseSpatial(first.reply.inputSnapshot) } : object;
  });
  const builds = validateApparatusBuilds(v.apparatusBuilds, buildObjects);
  const edits: ResearchApparatusEdit[] = [];
  if (v.apparatusEdits !== undefined) {
    if (!Array.isArray(v.apparatusEdits)) throw new Error('装置修改交接记录无效。');
    for (const edit of v.apparatusEdits) {
      if (!record(edit) || !text(edit.objectId, 100) || edit.objectId !== v.activeObjectId || !text(edit.goal, 2000) || !record(edit.reply) || !text(edit.reply.requestId, 100)) throw new Error('装置修改记录无效。');
      const before = parseSpatial(edit.reply.inputSnapshot);
      const checked = validateSpatialAgentReply(edit.reply, edit.reply.requestId, before);
      const object = responseObjects.find(o => o.id === edit.objectId);
      if (!object || !checked.applyAllowed || !checked.evidence) throw new Error('装置修改缺少有效的计算结果。');
      const previous = edits.at(-1)?.reply.experiment ?? builds.find(b => b.objectId === edit.objectId)?.reply.experiment ?? expectedObjects?.find(o => o.id === edit.objectId)?.experiment;
      if (previous && JSON.stringify(previous) !== JSON.stringify(before)) throw new Error('装置修改基于不同版本。');
      edits.push({ objectId: edit.objectId, goal: edit.goal, reply: checked });
    }
    const final = edits.at(-1);
    if (final && JSON.stringify(responseObjects.find(o => o.id === final.objectId)?.experiment) !== JSON.stringify(final.reply.experiment)) throw new Error('最终装置与修改结果不一致。');
  }
  const activeBuild = builds.find(b => b.objectId === v.activeObjectId);
  if (activeBuild && expectedObjects) input = activeBuild.reply.experiment;
  if (edits.length && expectedObjects) input = edits.at(-1)!.reply.experiment;
  const snapshot = v.inputSnapshot === null ? null : parseSpatial(v.inputSnapshot);
  if (JSON.stringify(snapshot) !== JSON.stringify(input)) throw new Error('探究回复与本轮装置不一致。');
  let comparisons: SpatialComparison[] = [], evidence: SpatialResult | null = null;
  if (input) {
    const checked = validateSpatialAgentReply({ ...v, experiment: input, changed: false, applyAllowed: true, checks: [] }, id, input);
    comparisons = checked.comparisons; evidence = checked.evidence;
    if (comparisons.some(c => JSON.stringify(c.inputSnapshot) !== JSON.stringify(input))) throw new Error('参数比较与探究装置不一致。');
  } else if (v.evidence !== null || v.comparisons.length || v.designs.length || v.studies.length) throw new Error('未选择装置的探究不能包含仿真结果。');
  const designs = v.designs.map(d => validateFocusDesign(d));
  const studies = v.studies.map(s => validateStabilityStudy(s));
  const legacy = input && toLegacy(input);
  if ([...designs, ...studies].some(d => !legacy || experimentKey(d.inputSnapshot) !== experimentKey(legacy))) throw new Error('分析结果与探究装置不一致。');
  const result: ResearchReply = { requestId: id, inputSnapshot: snapshot, answer: v.answer, trace: v.trace.map(validateStep), plan: v.plan as string[], evidence, comparisons, designs, studies };
  if (v.visualActions !== undefined) result.visualActions = visualActions;
  if (v.apparatusBuilds !== undefined) result.apparatusBuilds = builds;
  if (v.apparatusEdits !== undefined) result.apparatusEdits = edits;
  if (v.editsApplyAllowed !== undefined) {
    if (typeof v.editsApplyAllowed !== 'boolean') throw new Error('修改应用状态无效。');
    result.editsApplyAllowed = v.editsApplyAllowed;
  }
  if (v.parameterHistory !== undefined) {
    if (!Array.isArray(v.parameterHistory) || v.parameterHistory.length !== edits.length) throw new Error('修改前的计算记录不完整。');
    result.parameterHistory = v.parameterHistory.map((r, revision) => {
      const edit = edits[revision];
      if (!record(r) || r.objectId !== edit.objectId || r.revision !== revision) throw new Error('计算阶段无效。');
      const checked = validateResearchReply({ requestId: id, answer: v.answer, trace: [], plan: [], inputSnapshot: r.inputSnapshot, evidence: r.evidence, comparisons: r.comparisons, designs: r.designs, studies: r.studies }, id, edit.reply.inputSnapshot);
      return { objectId: edit.objectId, revision, inputSnapshot: edit.reply.inputSnapshot, evidence: checked.evidence, comparisons: checked.comparisons, designs: checked.designs, studies: checked.studies };
    });
  } else if (edits.length > 1) throw new Error('连续修改缺少前后记录。');
  if (v.researchTitle !== undefined) {
    if (v.researchTitle !== null && (!text(v.researchTitle, 36) || /[\r\n<>]/.test(v.researchTitle))) throw new Error('探究标题格式无效。');
    result.researchTitle = v.researchTitle as string | null;
  }
  if (v.planProgress !== undefined) result.planProgress = parsePlanProgress(v.planProgress, result.plan);
  if (v.methodAssessment !== undefined) result.methodAssessment = parseResearchMethod(v.methodAssessment);
  // Recover the model's original text from the exact wrapper used by older builds.
  // Match both ends and stored scope; never strip freely written qualifications.
  if (result.methodAssessment?.coverage === 'partial') {
    const scope = result.methodAssessment;
    const suffix = `\n\n本轮计算范围：“${scope.calculationQuestion}”；“${scope.remainingQuestion}”尚未得到验证。`;
    for (const prefix of ['这次计算只能回答部分问题，原问题尚未得到验证。', '当前模型只能计算部分内容，原问题尚未得到验证。']) {
      if (result.answer.startsWith(prefix) && result.answer.endsWith(suffix)) {
        const original = result.answer.slice(prefix.length, -suffix.length);
        if (original.trim()) result.answer = original;
        break;
      }
    }
  }
  if (v.modelResults !== undefined) {
    result.modelResults = validateResearchModels(v.modelResults);
    if (result.modelResults.some(model=>responseObjects.some(object=>object.id===model.id))) throw new Error('模型实验不能冒充三维探究装置。');
  }
  if (expectedObjects || v.objectSnapshots !== undefined) {
    if (!Array.isArray(v.objectSnapshots) || v.objectSnapshots.length > MAX_RESEARCH_OBJECTS || !Array.isArray(v.objectResults) || v.objectResults.length !== v.objectSnapshots.length || !Array.isArray(v.objectComparisons) || v.objectComparisons.length > 3) throw new Error('探究对象结果不完整。');
    const objects = responseObjects, ids = objects.map(o => o.id);
    const updatedExpected = expectedObjects?.map(o => { const edit = [...edits].reverse().find(e => e.objectId === o.id); return edit ? { ...o, experiment: edit.reply.experiment } : o; });
    if (new Set(ids).size !== ids.length || expectedObjects && (JSON.stringify(objects.slice(0, expectedObjects.length)) !== JSON.stringify(updatedExpected) || objects.length !== expectedObjects.length + builds.length || objects.slice(expectedObjects.length).some(o => !builds.some(b => b.objectId === o.id)))) throw new Error('计算与本轮探究对象不一致。');
    if (!(v.activeObjectId === null && !objects.length || typeof v.activeObjectId === 'string' && ids.includes(v.activeObjectId)) || activeObjectId !== undefined && v.activeObjectId !== (builds.at(-1)?.objectId ?? activeObjectId)) throw new Error('当前探究对象不一致。');
    const active = objects.find(o => o.id === v.activeObjectId);
    if (JSON.stringify(active?.experiment ?? null) !== JSON.stringify(input)) throw new Error('当前对象的参数不一致。');
    const seen = new Set<string>();
    const objectResults = v.objectResults.map(r => {
      if (!record(r) || typeof r.objectId !== 'string' || seen.has(r.objectId)) throw new Error('探究对象结果重复或无效。');
      seen.add(r.objectId);
      const object = objects.find(o => o.id === r.objectId);
      if (!object) throw new Error('探究结果引用了未选入的对象。');
      if (r.revision !== undefined && r.revision !== edits.filter(e => e.objectId === r.objectId).length || v.parameterHistory !== undefined && r.revision === undefined) throw new Error('最终计算阶段不一致。');
      const checked = validateResearchReply({ requestId: id, answer: v.answer, trace: [], plan: [], inputSnapshot: r.inputSnapshot, evidence: r.evidence, comparisons: r.comparisons, designs: r.designs, studies: r.studies }, id, object.experiment);
      return { objectId: r.objectId, ...(r.revision !== undefined ? {revision: r.revision as number} : {}), inputSnapshot: object.experiment, sourceLabel: SOURCE_LABELS[object.source] + (object.label && object.label !== SOURCE_LABELS[object.source] ? ' · ' + object.label : ''), evidence: checked.evidence, comparisons: checked.comparisons, designs: checked.designs, studies: checked.studies };
    });
    const primary = objectResults.find(r => r.objectId === v.activeObjectId);
    if (primary && ['evidence', 'comparisons', 'designs', 'studies'].some(k => JSON.stringify(primary[k as keyof ResearchObjectResult]) !== JSON.stringify(result[k as keyof ResearchReply]))) throw new Error('当前对象的计算记录不一致。');
    const groupIds = new Set<string>();
    const objectComparisons = v.objectComparisons.map(g => {
      if (!record(g) || !text(g.id, 100) || groupIds.has(g.id) || !Array.isArray(g.objectIds) || g.objectIds.length < 2 || g.objectIds.length > MAX_RESEARCH_OBJECTS || new Set(g.objectIds).size !== g.objectIds.length) throw new Error('多个探究对象的比较记录无效。');
      const revisions = g.revisions;
      if (revisions !== undefined && (!record(revisions) || Object.keys(revisions).length !== g.objectIds.length)) throw new Error('对象比较阶段无效。');
      if (!g.objectIds.every(i => typeof i === 'string' && [...(result.parameterHistory ?? []), ...objectResults].some(r => r.objectId === i && r.evidence && (revisions === undefined ? r === objectResults.find(o => o.objectId === i) : r.revision === (revisions as Record<string, unknown>)[i])))) throw new Error('对象比较缺少对应阶段的读数。');
      groupIds.add(g.id); return { id: g.id, objectIds: g.objectIds as string[], ...(revisions !== undefined ? {revisions: revisions as Record<string, number>} : {}) };
    });
    Object.assign(result, { activeObjectId: v.activeObjectId, objectSnapshots: objects, objectResults, objectComparisons });
  }
  return result;
}

export function retainResearchBuilds(project: ResearchProject, reply: ResearchReply, snapshotAt: string): ResearchProject {
  const additions = (reply.apparatusBuilds ?? []).map(build => {
    const object = reply.objectSnapshots?.find(o => o.id === build.objectId);
    if (!object || project.objects.some(o => o.id === object.id)) throw new Error('生成探究对象重复或缺失。');
    return { ...object, experiment: structuredClone(object.experiment), sourceId: object.id, snapshotAt };
  });
  if (project.objects.length + additions.length > MAX_RESEARCH_OBJECTS) throw new Error('生成对象超出探究数量上限。');
  return additions.length ? { ...project, objects: [...project.objects, ...additions], activeObjectId: additions.at(-1)!.id } : project;
}

export function parseResearchStorage(v: unknown, maxProjects = 30): ResearchStorage {
  if (!record(v) || ![1, 2].includes(v.schemaVersion as number) || !Array.isArray(v.projects) || v.projects.length > maxProjects || !(v.selectedId === null || typeof v.selectedId === 'string')) throw new Error('探究存档格式无效。');
  const ids = new Set<string>();
  const projects = v.projects.map((p): ResearchProject => {
    if (!record(p) || !text(p.id, 100) || ids.has(p.id) || !text(p.title, 80) || !date(p.createdAt) || !date(p.updatedAt) || typeof p.draft !== 'string' || p.draft.length > 2000 || !Array.isArray(p.turns) || p.turns.length > 80) throw new Error('探究记录格式无效。');
    ids.add(p.id);
    let objects: ResearchObject[] = [], activeObjectId: string | null = null;
    if (v.schemaVersion === 2) {
      if (!Array.isArray(p.objects) || p.objects.length > MAX_RESEARCH_OBJECTS) throw new Error('探究对象列表无效。');
      objects = p.objects.map(parseResearchObject);
      if (new Set(objects.map(o => o.id)).size !== objects.length || !(p.activeObjectId === null && !objects.length || typeof p.activeObjectId === 'string' && objects.some(o => o.id === p.activeObjectId))) throw new Error('当前探究对象无效。');
      activeObjectId = p.activeObjectId as string | null;
    } else if (p.device !== null) {
      if (!record(p.device) || !text(p.device.sourceId, 100)) throw new Error('探究装置附件无效。');
      objects = [{ id: 'legacy-device', sourceId: p.device.sourceId, source: p.device.sourceId === 'draft' ? 'draft' : 'saved', label: '原关联装置', experiment: parseSpatial(p.device.experiment), snapshotAt: p.updatedAt as string }]; activeObjectId = 'legacy-device';
    }
    const turnIds = new Set<string>();
    const turns = p.turns.map((t): ResearchTurn => {
      if (!record(t) || !text(t.id, 100) || turnIds.has(t.id) || !text(t.prompt, 2000) || !date(t.createdAt) || !(t.error === null || text(t.error, 1000))) throw new Error('探究对话格式无效。');
      turnIds.add(t.id);
      const reply = t.reply === null ? null : validateResearchReply(t.reply, t.id, record(t.reply) && t.reply.inputSnapshot !== null ? parseSpatial(t.reply.inputSnapshot) : null);
      return { id: t.id, prompt: t.prompt, createdAt: t.createdAt, reply, error: t.error === null && !reply ? '上次探究未完整接收，可重新发送。' : t.error as string | null };
    });
    turns.forEach((turn, index) => { if (turn.reply) validatePlanEvidence(turn.reply, turns.slice(0, index)); });
    return { id: p.id, ...restoreResearchTitle(p.title, p.titleMode, turns), createdAt: p.createdAt, updatedAt: p.updatedAt, draft: p.draft, objects, activeObjectId, turns };
  });
  return { schemaVersion: 2, projects, selectedId: projects.some(p => p.id === v.selectedId) ? v.selectedId as string : projects[0]?.id ?? null };
}

export function readResearchStorage(): ResearchStorage & { warning: string | null; writable: boolean } {
  try {
    const raw = localStorage.getItem(RESEARCH_WORKSPACE_KEY);
    return { ...(raw ? parseResearchStorage(JSON.parse(raw)) : { schemaVersion: 2 as const, selectedId: null, projects: [] }), warning: null, writable: true };
  } catch {
    return { schemaVersion: 2, selectedId: null, projects: [], warning: '旧探究记录暂时无法读取，原记录仍保留。当前探究请导出备份。', writable: false };
  }
}

export function newResearchProject(): ResearchProject {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), title: '未命名探究', titleMode: 'pending', createdAt: now, updatedAt: now, draft: '', objects: [], activeObjectId: null, turns: [] };
}

export function researchHistory(turns: ResearchTurn[]): SpatialChatMessage[] {
  return turns.filter(t => t.reply).slice(-4).flatMap(t => [
    { role: 'user' as const, content: t.prompt.slice(0, 2000) },
    { role: 'assistant' as const, content: t.reply!.answer.slice(0, 2500) + (t.reply!.plan.length ? '\n探究计划：' + t.reply!.plan.join('；') : '') + (t.reply!.objectSnapshots?.length ? '\n当轮对象：' + t.reply!.objectSnapshots.map(o => o.experiment.name).join('、') : '') },
  ]);
}

export async function cancelResearchAgent(requestId: string): Promise<void> {
  await fetch('/api/research/agent/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId }), signal: AbortSignal.timeout(5000), keepalive: true }).catch(() => {});
}

export async function requestResearchAgent(id: string, input: SpatialExperiment | null, message: string, history: SpatialChatMessage[], signal: AbortSignal, onStep: (step: AgentStep) => void, objects?: ResearchObject[], activeObjectId?: string | null, titleNeeded = false, previousTurns: ResearchTurn[] = [], conversationContext: ConversationContext = { workspace: 'research' }): Promise<ResearchReply> {
  const expected = objects ? objectInputs(objects) : undefined;
  const response = await fetch('/api/research/agent/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: id, experiment: input, message, history, titleNeeded, conversationContext, currentPlan: currentResearchPlan(previousTurns), modelExperiments: researchModelInputs(previousTurns), ...(expected ? { objects: expected, activeObjectId } : {}) }), signal });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === 'string' ? body.detail : '实验探究助手暂时无法连接，请重试。');
  }
  if (!response.body) throw new Error('探究连接中断，请重试。');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const stopReading = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', stopReading, { once: true });
  if (signal.aborted) stopReading();
  let buffer = '', bytes = 0, reply: ResearchReply | null = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (value) { bytes += value.byteLength; if (bytes > 8_000_000) throw new Error('探究结果过大，请缩小计算范围。'); }
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const event: unknown = JSON.parse(line);
        if (!record(event)) throw new Error('探究结果格式无效。');
        if (event.type === 'progress') onStep(validateStep(event.step));
        else if (event.type === 'reply') { if (reply) throw new Error('收到重复探究结果。'); reply = validateResearchReply(event.reply, id, input, expected, activeObjectId); }
        else if (event.type === 'error') throw new Error(typeof event.message === 'string' ? event.message : '本轮探究未完成。');
        else throw new Error('探究结果格式无效。');
      }
      if (done) break;
    }
    if (buffer.trim() || !reply) throw new Error('探究结果未完整接收，请重试。');
    validatePlanEvidence(reply, previousTurns);
    return reply;
  } finally { signal.removeEventListener('abort', stopReading); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function recommendedSpatial(original: SpatialExperiment, recommendation: Experiment): SpatialExperiment {
  const legacy = toLegacy(original);
  if (!legacy || original.elements.length !== recommendation.elements.length) throw new Error('推荐方案不能转换为当前装置。');
  return parseSpatial({ ...original, elements: original.elements.map(element => {
    const candidate = recommendation.elements.find(e => e.id === element.id);
    if (!candidate || candidate.kind !== element.kind) throw new Error('推荐方案与装置器件不一致。');
    return { ...element, position: [candidate.positionMm, element.position[1], element.position[2]], ...(candidate.kind === 'lens' ? { focalLengthMm: candidate.focalLengthMm } : {}) };
  }) });
}

export function downloadResearch(value: unknown, name: string, format: 'json' | 'csv' | 'md') {
  const contents = format === 'json' ? JSON.stringify(value, null, 2) : String(value);
  const url = URL.createObjectURL(new Blob([contents], { type: format === 'json' ? 'application/json' : 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') + '.' + format;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function researchReport(project: ResearchProject): string {
  const lines = [`# ${project.title}`, '', `记录时间：${project.updatedAt}`, `探究对象：${project.objects.map(o => o.experiment.name).join('、') || '未选择'}`, '', ...project.objects.map(o => `- ${o.experiment.name}：${o.label}，参数保留于 ${o.snapshotAt}`), '', '本记录中的计算来自理想光学模型，不是实测数据。每份计算保留当时的装置条件。'];
  for (const [index, turn] of project.turns.entries()) {
    lines.push('', `## 探究对话 ${index + 1}`, '', turn.prompt, '', turn.reply?.answer ?? turn.error ?? '尚未完成');
    if (!turn.reply) continue;
    for(const model of turn.reply.modelResults??[]) {
      const definition=SCENE_DEFINITIONS[model.state.sceneId];
      lines.push('',`模型实验：${definition.title}`,'模型参数：'+definition.parameters.map(p=>`${p.label} ${numberText(model.state.parameters[p.key])}${p.unit?' '+p.unit:''}`).join('；'),'', '| 指标 | 读数 | 单位 |','|---|---|---|',...model.evidence.metrics.map(m=>`| ${m.label} | ${numberText(m.value)} | ${m.unit} |`));
      for(const scan of model.scans) {
        const parameter=definition.parameters.find(p=>p.key===scan.field)!;
        lines.push('',`扫描：${parameter.label}${parameter.unit?' / '+parameter.unit:''}`,'| 参数值 | '+model.evidence.metrics.map(m=>m.label+(m.unit?' / '+m.unit:'')).join(' | ')+' |','|---|'+model.evidence.metrics.map(()=>'---|').join(''),...scan.rows.map(r=>'| '+numberText(r.value)+' | '+r.result.metrics.map(m=>numberText(m.value)).join(' | ')+' |'));
      }
      lines.push('',model.limits,model.evidence.scope,...model.evidence.warnings);
    }
    for (const build of turn.reply.apparatusBuilds ?? []) lines.push('', `生成装置：${build.reply.experiment.name}`, `搭建目标：${build.goal}`, '已完成模型计算并作为新探究对象保留；原装置保留，不代表实测验证。', ...build.reply.checks.map(c => `- ${c.criterion.label}：通过`));
    if (turn.reply.plan.length) lines.push('', '探究计划：', ...(turn.reply.planProgress ? turn.reply.planProgress.map(s => `- [${planStatusLabel(s)}] ${s.text}${s.note ? '：' + s.note : ''}`) : turn.reply.plan.map(p => '- [进度未记录] ' + p)));
    const results = [...(turn.reply.parameterHistory ?? []), ...(turn.reply.objectResults ?? [{ ...turn.reply, objectId: 'legacy', revision: undefined }])];
    for (const result of results) {
    if (!result.evidence && !result.comparisons.length && !result.designs.length && !result.studies.length) continue;
    if (turn.reply.parameterHistory?.some(r => r.objectId === result.objectId)) {
      lines.push('', result.revision ? `第${result.revision}次修改后` : '修改前');
      for (const e of result.inputSnapshot?.elements ?? []) lines.push(`${e.name}：位置 (${e.position.join(', ')}) mm${e.kind === 'lens' ? `，焦距 ${e.focalLengthMm} mm` : ''}`);
    }
    if (result.inputSnapshot) lines.push('', `计算装置：${result.inputSnapshot.name}`);
    if (result.evidence) {
      lines.push('', '装置仿真读数：', '', '| 观察屏 | 高斯半径 / mm | 几何覆盖半径 / mm | 采样功率 / mW |', '|---|---|---|---|');
      for (const s of result.evidence.screens) lines.push(`| ${s.name.replace(/\|/g, '/')} | ${s.gaussianRadiusMm ?? '—'} | ${s.footprintRadiusMm ?? '—'} | ${s.sampledPowerMw} |`);
      lines.push('', ...result.evidence.warnings.map(w => '模型警告：' + w));
    }
    for (const c of result.comparisons) {
      lines.push('', `参数比较：${c.field}`, '', '| 参数值 | 屏名称 | 几何覆盖半径 / mm | 高斯半径 / mm | 采样功率 / mW | 状态 |', '|---|---|---|---|---|---|');
      for (const row of c.rows) {
        if (row.error) lines.push(`| ${row.value} | — | — | — | — | ${row.error.replace(/\|/g, '/')} |`);
        else for (const s of row.screens) lines.push(`| ${row.value} | ${s.name.replace(/\|/g, '/')} | ${s.footprintRadiusMm ?? '—'} | ${s.gaussianRadiusMm ?? '—'} | ${s.sampledPowerMw} | ${row.warnings.length ? '存在模型警告' : '已计算'} |`);
      }
    }
    for (const design of result.designs) {
      const best = design.recommendation;
      lines.push('', `方案搜索：固定屏位置 ${design.goal.screenPositionMm} mm，共 ${design.counts.total} 个计算组合。`, best ? `范围内推荐：透镜位置 ${best.positionMm} mm、焦距 ${best.focalLengthMm} mm，屏上半径 ${best.radiusMm} mm。` : design.noRecommendationReason ?? '暂无推荐。', '', ...design.limitations);
    }
    for (const study of result.studies) lines.push('', `误差分析：位置偏差 ±${study.tolerance.positionErrorMm} mm、焦距偏差 ±${study.tolerance.focalErrorPercent}%。`, `原方案已计算偏差中的最大半径：${study.baseline.maxRadiusMm ?? '无法计算'} mm。`, ...(study.recommendation ? [`推荐方案已计算偏差中的最大半径：${study.recommendation.maxRadiusMm} mm。`] : []), '', ...study.limitations);
    if (result.designs.length || result.studies.length) lines.push('', '详细搜索与误差分析数据随完整JSON记录导出。');
    }
    for (const group of turn.reply.objectComparisons ?? []) lines.push('', '对象比较：' + group.objectIds.map(id => turn.reply!.objectSnapshots!.find(o => o.id === id)!.experiment.name).join('、'), '各对象的完整参数随JSON导出；比较结论需核对输入条件、屏位置和指标。');
  }
  return lines.join('\n');
}

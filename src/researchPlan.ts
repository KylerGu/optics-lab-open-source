import type { ResearchReply, ResearchTurn } from './researchSession';

export interface ResearchEvidenceRef {
  requestId: string; objectId: string; kind: 'simulation' | 'comparison' | 'design' | 'study' | 'objects' | 'model'; recordId: string;
}
export interface ResearchPlanStep {
  text: string; status: 'pending' | 'completed' | 'needs_validation';
  basis: 'context' | 'calculation' | 'analysis' | null; note: string; evidence: ResearchEvidenceRef[];
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;

export function parsePlanProgress(value: unknown, plan: string[]): ResearchPlanStep[] {
  if (!Array.isArray(value) || value.length !== plan.length) throw new Error('探究计划进度不完整。');
  return value.map((v, i) => {
    if (!record(v) || v.text !== plan[i] || !['pending', 'completed', 'needs_validation'].includes(v.status as string) || !(v.basis === null || ['context', 'calculation', 'analysis'].includes(v.basis as string)) || typeof v.note !== 'string' || v.note.length > 240 || !Array.isArray(v.evidence) || v.evidence.length > 6) throw new Error('探究计划进度无效。');
    if (v.status === 'pending' && (v.basis !== null || v.note || v.evidence.length) || v.status !== 'pending' && (v.basis === null || !v.note.trim()) || v.status === 'completed' && v.basis === 'calculation' && !v.evidence.length || v.basis !== 'calculation' && v.evidence.length) throw new Error('探究步骤缺少有效依据。');
    const evidence = v.evidence.map(r => {
      if (!record(r) || !text(r.requestId, 100) || !text(r.objectId, 100) || !text(r.recordId, 100) || !['simulation', 'comparison', 'design', 'study', 'objects', 'model'].includes(r.kind as string)) throw new Error('探究步骤引用无效。');
      return { requestId: r.requestId, objectId: r.objectId, kind: r.kind, recordId: r.recordId } as ResearchEvidenceRef;
    });
    return { text: plan[i], status: v.status, basis: v.basis, note: v.note, evidence } as ResearchPlanStep;
  });
}

export function hasResearchEvidence(reply: ResearchReply, ref: ResearchEvidenceRef): boolean {
  if (reply.requestId !== ref.requestId) return false;
  if (ref.kind === 'model') return ref.objectId === ref.recordId && !!reply.modelResults?.some(m=>m.id===ref.recordId && m.evidence.metrics.length);
  const stages = [...(reply.parameterHistory ?? []), ...(reply.objectResults ?? [])];
  if (ref.kind === 'objects') return !!reply.objectComparisons?.some(g => g.id === ref.recordId && g.objectIds[0] === ref.objectId && g.objectIds.every(id => stages.some(r => r.objectId === id && r.evidence?.screens.length && (g.revisions ? r.revision === g.revisions[id] : reply.objectResults?.includes(r)))));
  const match = /^v([1-3]):(.+)$/.exec(ref.recordId), revision = match ? Number(match[1]) : 0;
  const recordId = match?.[2] ?? ref.recordId;
  const result = stages.find(r => r.objectId === ref.objectId && (r.revision ?? 0) === revision) ?? (!reply.objectResults && ref.objectId === 'legacy-device' && !revision ? reply : null);
  if (!result) return false;
  if (ref.kind === 'simulation') return recordId === 'simulation' && !!result.evidence?.screens.length;
  if (ref.kind === 'comparison') return result.comparisons.some(c => c.comparisonId === recordId && c.rows.some(r => !r.error && r.screens.length));
  if (ref.kind === 'design') return result.designs.some(d => d.id === recordId && d.rows.some(r => r.radiusMm !== null));
  return result.studies.some(s => s.id === recordId && s.baseline.rows.some(r => r.radiusMm !== null));
}

export function validatePlanEvidence(reply: ResearchReply, previous: ResearchTurn[]): void {
  for (const step of reply.planProgress ?? []) for (const ref of step.evidence) {
    const source = ref.requestId === reply.requestId ? reply : previous.find(t => t.id === ref.requestId)?.reply;
    if (!source || !hasResearchEvidence(source, ref)) throw new Error('探究计划引用了不存在或未完成的计算。');
  }
}

export function currentResearchPlan(turns: ResearchTurn[]): ResearchPlanStep[] {
  const reply = [...turns].reverse().find(t => t.reply?.plan.length)?.reply;
  return reply?.planProgress ?? (reply?.plan ?? []).map(text => ({ text, status: 'pending', basis: null, note: '', evidence: [] }));
}

export function planStatusLabel(step: ResearchPlanStep): string {
  return step.status === 'pending' ? '待开展' : step.status === 'needs_validation' ? '待验证' : step.basis === 'analysis' ? '已完成分析' : step.basis === 'context' ? '已核对' : '已完成计算';
}

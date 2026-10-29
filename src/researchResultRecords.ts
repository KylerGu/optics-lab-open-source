import type { ResearchProject } from './researchSession';
import type { ResearchArtifact } from './ResearchResults';
import type { ResearchEvidenceRef } from './researchPlan';
import { COMPARISON_LABELS } from './spatialAgent';
import { SCENE_DEFINITIONS } from './sceneRuntime';

export interface ResearchResultRecord {
  id: string;
  requestId: string;
  title: string;
  createdAt: string;
  primaryId: string;
  artifacts: ResearchArtifact[];
}

export function groupResearchArtifacts(artifacts: ResearchArtifact[]): ResearchResultRecord[] {
  const groups = new Map<string, ResearchArtifact[]>();
  for (const artifact of artifacts) {
    const requestId = artifact.reference.requestId;
    groups.set(requestId, [...(groups.get(requestId) ?? []), artifact]);
  }
  const priority = { simulation: 0, comparison: 1, objects: 2, model:2, design: 3, study: 4 };
  return [...groups].map(([requestId, members]) => {
    const staged = members.some(a => /^v[1-3]:/.test(a.reference.recordId));
    const primary = members.reduce((chosen, candidate) => priority[candidate.kind] > priority[chosen.kind] || staged && priority[candidate.kind] === priority[chosen.kind] ? candidate : chosen);
    return { id: 'research-result-' + requestId, requestId, title: staged ? '装置修改前后对照' : primary.title, createdAt: primary.createdAt, primaryId: primary.id, artifacts: members };
  });
}

export function collectResearchArtifacts(project: ResearchProject): ResearchArtifact[] {
  const artifacts: ResearchArtifact[] = [];
  for (const turn of project.turns) {
    const reply = turn.reply;
    if (!reply) continue;
    const results = [...(reply.parameterHistory ?? []), ...(reply.objectResults ?? [{ ...reply, objectId: 'legacy', revision: undefined }])];
    for (const result of results) {
      const input = result.inputSnapshot;
      if (!input) continue;
      const objectId = result.objectId === 'legacy' ? 'legacy-device' : result.objectId;
      const version = result.revision ? `v${result.revision}:` : '';
      const shared = { createdAt: turn.createdAt, input }, prefix = turn.id + '-' + result.objectId + '-' + version;
      const reference = (kind: ResearchEvidenceRef['kind'], recordId: string): ResearchEvidenceRef => ({ requestId: turn.id, objectId, kind, recordId: version + recordId });
      const duplicateName = results.some(r => r.objectId !== result.objectId && r.inputSnapshot?.name === input.name);
      const sourceLabel = 'sourceLabel' in result ? result.sourceLabel : '';
      const stage = reply.parameterHistory?.some(r => r.objectId === objectId) ? (result.revision ? `第${result.revision}次修改后` : '修改前') + ' · ' : '';
      const name = stage + input.name + (duplicateName && sourceLabel ? '（' + sourceLabel + '）' : '') + ' · ';
      if (result.evidence) artifacts.push({ ...shared, reference: reference('simulation', 'simulation'), id: prefix + 'simulation', kind: 'simulation', title: name + '仿真读数', data: result.evidence });
      for (const c of result.comparisons) artifacts.push({ ...shared, reference: reference('comparison', c.comparisonId), id: prefix + c.comparisonId, kind: 'comparison', title: name + (COMPARISON_LABELS[c.field] ?? c.field) + '比较', data: c });
      for (const d of result.designs) artifacts.push({ ...shared, reference: reference('design', d.id), id: prefix + d.id, kind: 'design', title: name + '位置与焦距方案搜索', data: d });
      for (const s of result.studies) artifacts.push({ ...shared, reference: reference('study', s.id), id: prefix + s.id, kind: 'study', title: name + (s.mode === 'analysis' ? '位置与焦距误差分析' : '误差下的稳定方案比较'), data: s });
    }
    for (const group of reply.objectComparisons ?? []) {
      const rows = [...(reply.parameterHistory ?? []), ...(reply.objectResults ?? [])].filter(r => group.objectIds.includes(r.objectId) && (group.revisions ? r.revision === group.revisions[r.objectId] : reply.objectResults?.includes(r)));
      artifacts.push({ reference: { requestId: turn.id, objectId: group.objectIds[0], kind: 'objects', recordId: group.id }, id: turn.id + '-' + group.id, kind: 'objects', title: `${rows.length} 个探究对象比较`, createdAt: turn.createdAt, input: rows[0].inputSnapshot, data: rows });
    }
    for(const model of reply.modelResults??[]) {
      const definition=SCENE_DEFINITIONS[model.state.sceneId], scan=model.scans[0];
      const study=definition.parameters.find(p=>p.key==='study')?.options?.find(o=>o.value===model.state.parameters.study)?.label;
      const page=study?' · '+study:'';
      artifacts.push({reference:{requestId:turn.id,objectId:model.id,kind:'model',recordId:model.id},id:turn.id+'-model-'+model.id,kind:'model',title:definition.title+page+(scan?' · '+(definition.parameters.find(p=>p.key===scan.field)?.label??scan.field)+'比较':''),createdAt:turn.createdAt,input:model.state,data:model});
    }
  }
  return artifacts;
}

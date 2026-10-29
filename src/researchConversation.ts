import type { SpatialExperiment } from './builderModel';
import { builderConversationId, type BuilderTab } from './builderTabs';
import type { ResearchProject } from './researchSession';
import { researchBuilderKey } from './researchBuilderIdentity';
import type { ResearchVisualGuide } from './researchVisual';

export interface BuilderConversationContext {
  tab: BuilderTab;
  selectedElementId: string | null;
  editing: boolean;
  host: HTMLElement | null;
  apply: (next: SpatialExperiment, expected: SpatialExperiment) => boolean;
  bind: (key: string, baseline: SpatialExperiment) => void;
  locate: (guide: ResearchVisualGuide) => void;
}
export const sameApparatus = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function builderConversation(tab: BuilderTab, projects: ResearchProject[]) {
  const candidates = projects.flatMap(project => project.objects.flatMap(object => {
    const key = researchBuilderKey({ projectId: project.id, objectId: object.id, savedId: null });
    // Archives retain conversation identity even when saved before the first message.
    const ownConversation = !tab.researchKeys?.length && project.id === 'builder:' + builderConversationId(tab) && object.id === project.activeObjectId;
    return tab.researchKeys?.includes(key) || ownConversation ? [{ key, project, object }] : [];
  }));
  const selected = candidates.find(c => c.key === tab.researchContext?.key) ?? (candidates.length === 1 ? candidates[0] : undefined);
  const missing = !!tab.researchKeys?.length && (!candidates.length || !!tab.researchContext && !candidates.some(c => c.key === tab.researchContext?.key));
  const conflict = !!selected && !sameApparatus(selected.object.experiment, tab.history.present) &&
    !(tab.researchContext?.key === selected.key && sameApparatus(selected.object.experiment, tab.researchContext.baseline));
  return { candidates, selected: missing ? undefined : selected, missing, conflict, ambiguous: candidates.length > 1 && !selected };
}

export function promoteBuilderConversation(project: ResearchProject, tab: BuilderTab): ResearchProject {
  const next = updateConversationObject(project, project.activeObjectId!, tab.history.present);
  return { ...next, title: project.turns.length ? project.title : tab.history.present.name,
    titleMode: project.turns.length ? project.titleMode : 'pending' };
}

// Changes affect the current object only; turn snapshots are immutable evidence.
export function updateConversationObject(project: ResearchProject, objectId: string, experiment: SpatialExperiment): ResearchProject {
  return { ...project, activeObjectId: objectId, objects: project.objects.map(o => o.id === objectId ? { ...o, experiment: structuredClone(experiment), snapshotAt: new Date().toISOString() } : o) };
}

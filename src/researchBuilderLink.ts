import { parseSpatial, type SpatialExperiment } from './builderModel';
import { openBuilderTab, type BuilderTabs } from './builderTabs';
import type { SavedSpatial } from './spatialStorage';
import { researchBuilderKey, type ResearchBuilderOrigin } from './researchBuilderIdentity';
import type { ResearchVisualGuide } from './researchVisual';

export interface ResearchBuilderCopy {
  id: string;
  experiment: SpatialExperiment;
  origin?: ResearchBuilderOrigin;
  guide?: ResearchVisualGuide;
}

export function findResearchArchive(origin: ResearchBuilderOrigin, saved: SavedSpatial[]): SavedSpatial | undefined {
  const key = researchBuilderKey(origin);
  const explicit = saved.find(row => row.id === origin.savedId);
  const matches = saved.filter(row => row.researchKeys?.includes(key));
  return explicit ?? (matches.length === 1 ? matches[0] : undefined);
}

// Compatibility for copies opened before associations existed: only an exact,
// unique, unclaimed snapshot is eligible. Names and similar parameters are not identities.
function uniqueSnapshot<T>(rows: T[], experiment: SpatialExperiment, get: (row: T) => SpatialExperiment): T | undefined {
  const snapshot = JSON.stringify(parseSpatial(experiment));
  const matches = rows.filter(row => JSON.stringify(parseSpatial(get(row))) === snapshot);
  return matches.length === 1 ? matches[0] : undefined;
}

export function openResearchBuilderTab(state: BuilderTabs, experiment: SpatialExperiment, origin: ResearchBuilderOrigin, saved: SavedSpatial[]) {
  const key = researchBuilderKey(origin);
  if (state.tabs.filter(candidate => candidate.researchKeys?.includes(key)).length > 1 ||
      !saved.some(row => row.id === origin.savedId) && saved.filter(row => row.researchKeys?.includes(key)).length > 1) {
    throw new Error('此探究对象关联了多个装置版本，请先明确要使用的存档；未覆盖任何参数。');
  }
  const linkedTab = state.tabs.find(candidate => candidate.researchKeys?.includes(key));
  const archive = findResearchArchive(origin, saved) ?? (!linkedTab ? uniqueSnapshot(saved.filter(row => !row.researchKeys?.length), experiment, row => row.experiment) : undefined);
  if (linkedTab && archive && linkedTab.savedId !== archive.id) throw new Error('已打开的关联光路与装置存档属于不同版本，请先处理已有标签或重新选入明确的装置；未覆盖参数。');
  let tab = archive && state.tabs.find(candidate => candidate.savedId === archive.id);
  tab ??= linkedTab && (!archive || linkedTab.savedId === archive.id) ? linkedTab : undefined;
  if (!tab && !archive) tab = uniqueSnapshot(state.tabs.filter(candidate => !candidate.savedId && !candidate.researchKeys?.length), experiment, candidate => candidate.history.present);
  const opened = tab ? { ...state, activeId: tab.id } : openBuilderTab(state, archive?.experiment ?? experiment, archive?.id ?? null, archive?.conversationId, archive?.resetBaseline);
  const workspace = { ...opened, tabs: opened.tabs.map(candidate => candidate.id === opened.activeId ? { ...candidate, researchKeys: [...new Set([...(candidate.researchKeys ?? []), key])], researchContext: { key, baseline: candidate.researchContext?.key === key ? candidate.researchContext.baseline : candidate.history.present } } : candidate) };
  const archives = archive && !archive.researchKeys?.includes(key) ? saved.map(row => row.id === archive.id ? { ...row, researchKeys: [...(row.researchKeys ?? []), key] } : row) : saved;
  return { workspace, saved: archives };
}

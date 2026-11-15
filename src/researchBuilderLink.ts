import { BUILDER_SAVED, parseSpatial, type SpatialExperiment } from './builderModel';
import { BUILDER_TABS, openBuilderTab, parseBuilderTabs, serializeBuilderTabs, type BuilderTab, type BuilderTabs } from './builderTabs';
import { readSavedSpatial, type SavedSpatial } from './spatialStorage';
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

export function unlinkResearchReferences(
  state: BuilderTabs | null,
  saved: SavedSpatial[],
  matchKey: (key: string) => boolean,
): { workspace: BuilderTabs | null; saved: SavedSpatial[]; changed: boolean } {
  const rotatedConversations = new Map<string, string>();
  let tabsChanged = false;
  const nextTabs = state?.tabs.map((tab): BuilderTab => {
    if (!tab.researchKeys?.length) return tab;
    const remaining = tab.researchKeys.filter(key => !matchKey(key));
    if (remaining.length === tab.researchKeys.length) return tab;
    tabsChanged = true;
    if (!remaining.length) {
      const conversationId = crypto.randomUUID();
      if (tab.savedId) rotatedConversations.set(tab.savedId, conversationId);
      const { researchKeys: _keys, researchContext: _context, ...rest } = tab;
      return { ...rest, conversationId };
    }
    if (tab.researchContext && remaining.includes(tab.researchContext.key)) {
      return { ...tab, researchKeys: remaining };
    }
    const { researchContext: _context, ...rest } = tab;
    return { ...rest, researchKeys: remaining };
  });

  let savedChanged = false;
  const nextSaved = saved.map((row): SavedSpatial => {
    const nextKeys = row.researchKeys?.filter(key => !matchKey(key));
    const keysChanged = !!row.researchKeys && nextKeys!.length !== row.researchKeys.length;
    const rotatedId = rotatedConversations.get(row.id);
    const openTab = state?.tabs.find(tab => tab.savedId === row.id);
    const nextConversationId = rotatedId ?? (keysChanged && !nextKeys!.length && !openTab && row.conversationId ? crypto.randomUUID() : row.conversationId);
    if (!keysChanged && nextConversationId === row.conversationId) return row;
    savedChanged = true;
    const { researchKeys: _keys, conversationId: _conversationId, ...rest } = row;
    return {
      ...rest,
      ...(nextKeys?.length ? { researchKeys: nextKeys } : {}),
      ...(nextConversationId ? { conversationId: nextConversationId } : {}),
    };
  });

  return {
    workspace: state && tabsChanged && nextTabs ? { ...state, tabs: nextTabs } : state,
    saved: savedChanged ? nextSaved : saved,
    changed: tabsChanged || savedChanged,
  };
}

export function unlinkResearchStorage(matchKey: (key: string) => boolean) {
  let saved: SavedSpatial[] = [];
  let hasSaved = false;
  try {
    if (localStorage.getItem(BUILDER_SAVED) !== null) {
      saved = readSavedSpatial();
      hasSaved = true;
    }
  } catch { /* Keep unreadable saved archives intact. */ }
  let tabs: BuilderTabs | null = null;
  let hasTabs = false;
  try {
    const raw = localStorage.getItem(BUILDER_TABS);
    if (raw) {
      tabs = parseBuilderTabs(raw, saved);
      hasTabs = true;
    }
  } catch { /* Keep unreadable tab drafts intact. */ }
  const next = unlinkResearchReferences(tabs, saved, matchKey);
  if (!next.changed) return;
  try {
    if (hasSaved && next.saved !== saved) localStorage.setItem(BUILDER_SAVED, JSON.stringify(next.saved));
    if (hasTabs && next.workspace && next.workspace !== tabs) localStorage.setItem(BUILDER_TABS, serializeBuilderTabs(next.workspace));
  } catch { /* Keep existing storage on write failure. */ }
}

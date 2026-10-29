import test from 'node:test';
import assert from 'node:assert/strict';
import { spatialTemplate } from './builderModel';
import { builderTabDirty, closeBuilderTab, initialBuilderTabs, openBuilderTab, parseBuilderTabs, serializeBuilderTabs } from './builderTabs';
import { readSavedSpatial, saveSpatialSnapshot } from './spatialStorage';
import { findResearchArchive, openResearchBuilderTab } from './researchBuilderLink';
import { parseResearchBuilderKeys, researchBuilderKey, type ResearchBuilderOrigin } from './researchBuilderIdentity';

const origin: ResearchBuilderOrigin = { projectId: 'project', objectId: 'object', savedId: null };

test('reopening an unsaved research object preserves its edits and history instead of copying it', () => {
  const input = spatialTemplate('focus'), before = JSON.stringify(input);
  const opened = openResearchBuilderTab(initialBuilderTabs(spatialTemplate('empty')), input, origin, []);
  const tab = opened.workspace.tabs.at(-1)!;
  tab.history = { past: [tab.history.present], present: { ...tab.history.present, name: '已调整' }, future: [] };
  const again = openResearchBuilderTab(opened.workspace, input, origin, []);
  assert.equal(again.workspace.tabs.length, opened.workspace.tabs.length);
  assert.equal(again.workspace.activeId, tab.id);
  assert.equal(again.workspace.tabs.at(-1)!.history, tab.history);
  assert.equal(JSON.stringify(input), before);
});

test('saving and restoring the builder preserves research identity and opens the same saved tab', () => {
  const input = spatialTemplate('focus'), opened = openResearchBuilderTab(initialBuilderTabs(spatialTemplate('empty')), input, origin, []);
  const active = opened.workspace.tabs.find(tab => tab.id === opened.workspace.activeId)!;
  const saved = saveSpatialSnapshot([], null, { ...active.history.present, name: '保存后改名' }, active.researchKeys);
  const state = { ...opened.workspace, tabs: opened.workspace.tabs.map(tab => tab.id === active.id ? { ...tab, savedId: saved[0].id, history: { ...tab.history, present: saved[0].experiment } } : tab) };
  const restored = parseBuilderTabs(serializeBuilderTabs(state), saved);
  const again = openResearchBuilderTab(restored, input, origin, saved);
  assert.equal(again.workspace.activeId, active.id);
  assert.equal(again.workspace.tabs.length, state.tabs.length);
  assert.equal(builderTabDirty(again.workspace.tabs.at(-1)!, saved), false);
  assert.equal(findResearchArchive(origin, saved)?.id, saved[0].id);
});

test('after closing the tab, a changed archive is opened without rewriting the original research snapshot', () => {
  const input = spatialTemplate('focus'), before = JSON.stringify(input);
  const saved = saveSpatialSnapshot([], null, { ...input, name: '存档中的新名字', elements: input.elements.map(e => e.kind === 'laser' ? { ...e, powerMw: 27 } : e) }, [researchBuilderKey(origin)]);
  const state = initialBuilderTabs(saved[0].experiment, saved[0].id);
  const closed = closeBuilderTab(state, state.activeId);
  const reopened = openResearchBuilderTab(closed, input, origin, saved);
  const active = reopened.workspace.tabs.find(tab => tab.id === reopened.workspace.activeId)!;
  assert.equal(active.savedId, saved[0].id);
  assert.equal(active.history.present.elements[0].powerMw, 27);
  assert.equal(active.history.present.name, '存档中的新名字');
  assert.equal(JSON.stringify(input), before);
});

test('saved source identity takes priority over names or matching parameters and preserves pending edits', () => {
  const input = spatialTemplate('focus');
  const saved = saveSpatialSnapshot(saveSpatialSnapshot([], null, input), null, input);
  const explicit = { ...origin, savedId: saved[1].id };
  const state = openBuilderTab(initialBuilderTabs(saved[0].experiment, saved[0].id), saved[1].experiment, saved[1].id);
  const active = state.tabs.at(-1)!;
  active.history.present = { ...active.history.present, name: '未保存的调整' };
  const opened = openResearchBuilderTab(state, input, explicit, saved);
  assert.equal(opened.workspace.tabs.length, 2);
  assert.equal(opened.workspace.activeId, active.id);
  assert.equal(opened.workspace.tabs.at(-1)!.history.present.name, '未保存的调整');
  assert.equal(findResearchArchive(explicit, opened.saved)?.id, saved[1].id);
});

test('legacy copies recover only from one exact unclaimed snapshot, never a shared name or ambiguous archives', () => {
  const input = spatialTemplate('focus'), saved = saveSpatialSnapshot([], null, input);
  const opened = openResearchBuilderTab(initialBuilderTabs(spatialTemplate('empty')), input, origin, saved);
  assert.equal(opened.workspace.tabs.at(-1)!.savedId, saved[0].id);
  assert.equal(opened.saved[0].savedAt, saved[0].savedAt);
  assert.equal(JSON.stringify(opened.saved[0].experiment), JSON.stringify(saved[0].experiment));
  assert.equal(findResearchArchive(origin, opened.saved)?.id, saved[0].id);
  assert.equal(saved[0].researchKeys, undefined);
  const other = { ...origin, objectId: 'another-object' };
  assert.equal(openResearchBuilderTab(initialBuilderTabs(spatialTemplate('empty')), input, other, opened.saved).workspace.tabs.at(-1)!.savedId, null);
  const duplicate = saveSpatialSnapshot(saved, null, input);
  assert.equal(openResearchBuilderTab(initialBuilderTabs(spatialTemplate('empty')), input, origin, duplicate).workspace.tabs.at(-1)!.savedId, null);
  const namedOnly = saveSpatialSnapshot([], null, { ...input, elements: input.elements.map(e => e.kind === 'laser' ? { ...e, powerMw: 33 } : e) });
  assert.equal(openResearchBuilderTab(initialBuilderTabs(spatialTemplate('empty')), input, origin, namedOnly).workspace.tabs.at(-1)!.savedId, null);
});

test('deleting a linked archive preserves its associated draft rather than claiming an unrelated archive', () => {
  const input = spatialTemplate('focus');
  const saved = saveSpatialSnapshot([], null, input, [researchBuilderKey(origin)]);
  let state = openResearchBuilderTab(initialBuilderTabs(spatialTemplate('empty')), input, origin, saved).workspace;
  state = parseBuilderTabs(serializeBuilderTabs(state), []);
  const active = state.activeId;
  const otherArchive = saveSpatialSnapshot([], null, input);
  const opened = openResearchBuilderTab(state, input, origin, otherArchive);
  assert.equal(opened.workspace.activeId, active);
  assert.equal(opened.workspace.tabs.at(-1)!.savedId, null);
  assert.equal(opened.saved[0].researchKeys, undefined);
});

test('ordinary saves retain associations, while a separate saved copy does not steal the original link', () => {
  const input = spatialTemplate('focus'), keys = [researchBuilderKey(origin)];
  const original = saveSpatialSnapshot([], null, input, keys);
  const updated = saveSpatialSnapshot(original, original[0].id, { ...input, name: '更新原装置' });
  assert.deepEqual(updated[0].researchKeys, keys);
  const copied = saveSpatialSnapshot(updated, null, { ...input, name: '另存副本' });
  assert.equal(copied[0].researchKeys, undefined);
  assert.equal(findResearchArchive(origin, copied)?.id, original[0].id);
});

test('archive readers preserve links and metadata parsing rejects malformed identities', () => {
  const rows = saveSpatialSnapshot([], null, spatialTemplate('focus'), [researchBuilderKey(origin)]);
  const prior = globalThis.localStorage;
  try {
    const values = new Map<string, string>();
    globalThis.localStorage = { length: 1, getItem: () => JSON.stringify(rows), clear: () => values.clear(), key: index => [...values.keys()][index] ?? null, removeItem: key => { values.delete(key); }, setItem: (key, value) => { values.set(key, value); } };
    assert.deepEqual(readSavedSpatial()[0].researchKeys, rows[0].researchKeys);
  } finally { if (prior) globalThis.localStorage = prior; else Reflect.deleteProperty(globalThis, 'localStorage'); }
  assert.equal(parseResearchBuilderKeys(undefined), undefined);
  assert.throws(() => parseResearchBuilderKeys(['not-an-identity']));
  assert.throws(() => parseResearchBuilderKeys([researchBuilderKey(origin), researchBuilderKey(origin)]));
  assert.throws(() => parseResearchBuilderKeys(['["project",""]']));
});

test('ambiguous linked archives and conflicting open versions are reported rather than selecting the first match', () => {
  const input=spatialTemplate('focus'), key=researchBuilderKey(origin);
  const saved=saveSpatialSnapshot(saveSpatialSnapshot([],null,input,[key]),null,{...input,name:'另一版'},[key]);
  assert.equal(findResearchArchive(origin,saved),undefined);
  assert.throws(()=>openResearchBuilderTab(initialBuilderTabs(input),input,origin,saved),/多个装置版本/);
  const opened=openResearchBuilderTab(initialBuilderTabs(spatialTemplate('empty')),input,origin,[]).workspace;
  assert.throws(()=>openResearchBuilderTab(opened,input,origin,saved.slice(0,1)),/不同版本/);
});

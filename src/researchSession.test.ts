import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpatial, spatialTemplate, toLegacy, type SpatialExperiment } from './builderModel';
import { parseResearchStorage, newResearchProject, recommendedSpatial, cancelResearchAgent, requestResearchAgent, researchHistory, researchReport, validateResearchReply, retainResearchBuilds, type ResearchProject, type ResearchTurn } from './researchSession';
import { collectResearchArtifacts } from './researchResultRecords';
import { hasResearchEvidence } from './researchPlan';
import { attachResearchObject, importedObjectChoice, objectInputs, readResearchObjectSources, refreshedResearchObject, type ResearchObject } from './researchObjects';
import { BUILDER_DRAFT, BUILDER_SAVED, fromLegacy } from './builderModel';
import { GAUSSIAN_DRAFT_KEY, makeGaussianScene } from './gaussianBeam';
import { applyResearchTitle, isResearchSmallTalk, restoreResearchTitle } from './researchTitle';
import { currentResearchPlan, parsePlanProgress, planStatusLabel, validatePlanEvidence } from './researchPlan';
import { comparisonRange, snapshotConditions, snapshotSummary } from './researchRecords';
import type { SpatialComparison } from './spatialAgent';

const input = parseSpatial({ schemaVersion: 2, name: '装置', elements: [] });
const reply = (snapshot: SpatialExperiment | null = null) => ({ requestId: 'r', inputSnapshot: snapshot, answer: '先明确研究指标。', plan: ['明确比较条件'], trace: [], evidence: null, comparisons: [], designs: [], studies: [] });

test('stop cancels a pending response reader even when transport ignores fetch abort', async () => {
  const oldFetch = globalThis.fetch, controller = new AbortController();
  let readerCancelled = false;
  try {
    globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { readerCancelled = true; } }));
    const pending = requestResearchAgent('stopping', null, '问题', [], controller.signal, () => {});
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort('cancel');
    await assert.rejects(pending, reason => reason === 'cancel');
    assert.equal(readerCancelled, true);
    globalThis.fetch = async (url, init) => {
      assert.equal(url, '/api/research/agent/cancel');
      assert.deepEqual(JSON.parse(init!.body as string), {requestId:'stopping'});
      assert.equal(init!.signal!.aborted, false);
      return new Response('{}');
    };
    await cancelResearchAgent('stopping');
  } finally { globalThis.fetch = oldFetch; }
});

test('old program wrappers are removed exactly while natural model text and scope survive', () => {
  const methodAssessment = { question: '研究现象', method: '比较读数', questionRequires: ['coherent-path-interference'], calculationUses: ['ideal-coherent-interference'], calculationQuestion: '局部光强', remainingQuestion: '整体能流', coverage: 'partial' };
  const answer = '能量没有消失。\n\n这里只计算了局部光强。';
  const raw = { ...reply(), answer: `这次计算只能回答部分问题，原问题尚未得到验证。${answer}\n\n本轮计算范围：“局部光强”；“整体能流”尚未得到验证。`, methodAssessment };
  const restored = validateResearchReply(raw, 'r', null);
  assert.equal(restored.answer, answer);
  assert.deepEqual(restored.methodAssessment, methodAssessment);
  assert.equal(validateResearchReply(restored, 'r', null).answer, answer);
  assert.equal(validateResearchReply({ ...raw, answer }, 'r', null).answer, answer);
  const natural = '这次计算只能回答部分问题，原问题尚未得到验证。自然解释。';
  assert.equal(validateResearchReply({ ...raw, answer: natural }, 'r', null).answer, natural);
  assert.notEqual(raw.answer, restored.answer);
});

test('plan progress distinguishes analysis from calculation and rejects invented evidence', () => {
  const progress = [{ text: '明确比较条件', status: 'completed', basis: 'analysis', note: '给出理论解释，尚无实测', evidence: [] }];
  const result = validateResearchReply({ ...reply(), planProgress: progress }, 'r', null);
  assert.equal(planStatusLabel(result.planProgress![0]), '已完成分析');
  validatePlanEvidence(result, []);
  for (const malformed of [{ ...progress[0], basis: 'calculation' }, { ...progress[0], status: 'pending' }, { ...progress[0], text: '其他计划' }]) assert.throws(() => parsePlanProgress([malformed], result.plan));
  const fake = validateResearchReply({ ...reply(), planProgress: [{ ...progress[0], basis: 'calculation', evidence: [{ requestId: 'r', objectId: 'missing', kind: 'comparison', recordId: 'comparison-1' }] }] }, 'r', null);
  assert.throws(() => validatePlanEvidence(fake, []), /不存在/);
  const now = new Date().toISOString();
  const storage = { schemaVersion: 2, selectedId: 'p', projects: [{ id: 'p', title: '研究', createdAt: now, updatedAt: now, draft: '', objects: [], activeObjectId: null, turns: [{ id: 'r', prompt: '问题', createdAt: now, error: null, reply: result }] }] };
  const restored = parseResearchStorage(storage);
  assert.equal(currentResearchPlan(restored.projects[0].turns)[0].status, 'completed');
  assert.deepEqual(parseResearchStorage(restored), restored);
  assert.throws(() => parseResearchStorage({ ...storage, projects: [{ ...storage.projects[0], turns: [{ ...storage.projects[0].turns[0], reply: fake }] }] }));
});

test('record summaries identify scan ranges and snapshot conditions without changing originals', () => {
  const device = fromLegacy(makeGaussianScene());
  const original = JSON.stringify(device), source = device.elements.find(e => e.kind === 'laser')!;
  const c: SpatialComparison = { comparisonId: 'comparison-1', inputSnapshot: device, elementId: source.id, field: 'beamRadiusMm', rows: [.1, .2, .3].map(value => ({ value, screens: [], warnings: [], error: null })) };
  assert.match(comparisonRange(c), /0.1 → 0.3 · 3 点/);
  const conditions = snapshotConditions(device, c).join('\n');
  assert.match(conditions, /波长 532 nm/);
  assert.match(conditions, /束腰半径 0.2 mm（比较前原值）/);
  assert.match(conditions, /直线间距：320 mm/);
  assert.match(snapshotSummary(device), /532 nm · 源屏间距 320 mm/);
  assert.ok(!snapshotConditions(device, { ...c, field: 'x' }).some(s => s.includes('直线间距')));
  assert.equal(JSON.stringify(device), original);
});

test('completed calculation references survive followups and reload but cannot point to another round', () => {
  const device = fromLegacy(makeGaussianScene()), source = device.elements.find(e => e.kind === 'laser')!, screen = device.elements.find(e => e.kind === 'screen')!;
  const c: SpatialComparison = { comparisonId: 'comparison-1', inputSnapshot: device, elementId: source.id, field: 'beamRadiusMm', rows: [.1, .2, .3].map(value => ({ value, screens: [{ elementId: screen.id, name: screen.name, hits: 9, sampledPowerFraction: 1, sampledPowerMw: source.powerMw, centroid: screen.position, footprintRadiusMm: value, gaussianRadiusMm: .5 }], warnings: [], error: null })) };
  const progress = [{ text: '明确比较条件', status: 'completed', basis: 'calculation', note: '完成三点比较', evidence: [{ requestId: 'r', objectId: 'legacy-device', kind: 'comparison', recordId: 'comparison-1' }] }];
  const first = validateResearchReply({ ...reply(device), comparisons: [c], planProgress: progress }, 'r', device);
  validatePlanEvidence(first, []);
  const now = new Date().toISOString(), turn: ResearchTurn = { id: 'r', prompt: '比较', createdAt: now, error: null, reply: first };
  const next = validateResearchReply({ ...reply(device), requestId: 'next', planProgress: progress }, 'next', device);
  validatePlanEvidence(next, [turn]);
  assert.throws(() => validatePlanEvidence(next, []));
  const invalid = structuredClone(next); invalid.planProgress![0].evidence[0].requestId = 'next';
  assert.throws(() => validatePlanEvidence(invalid, [turn]));
  const storage = parseResearchStorage({ schemaVersion: 2, selectedId: 'p', projects: [{ id: 'p', title: '研究', createdAt: now, updatedAt: now, draft: '', objects: [], activeObjectId: null, turns: [turn, { id: 'next', prompt: '解释', createdAt: now, error: null, reply: next }] }] });
  assert.equal(currentResearchPlan(storage.projects[0].turns)[0].evidence[0].requestId, 'r');
});

test('greetings leave research unnamed and meaningful questions can receive an agent title', () => {
  for (const greeting of ['你好', '你好！谢谢', 'Hello!', '你能做什么？']) assert.ok(isResearchSmallTalk(greeting));
  assert.ok(!isResearchSmallTalk('你好，我想研究光束半径如何影响光斑'));
  const project = { title: '未命名研究', titleMode: 'pending' as const };
  assert.deepEqual(applyResearchTitle(project, null), project);
  assert.deepEqual(applyResearchTitle(project, '你好'), project);
  const named = applyResearchTitle(project, '束腰半径与光斑变化');
  assert.equal(named.title, '束腰半径与光斑变化');
  assert.equal(named.titleMode, 'auto');
  assert.equal(applyResearchTitle(named, '下一轮题目').title, named.title);
  assert.equal(applyResearchTitle({ title: '我的课题', titleMode: 'manual' as const }, '自动题目').title, '我的课题');
});

test('old greeting titles recover from existing research while explicit manual titles survive reload', () => {
  const turns = [{ prompt: '你好', reply: { ...reply(), researchTitle: undefined } }, { prompt: '我想研究束腰半径对观察屏光斑的影响。其他参数保持不变。', reply: { ...reply(), researchTitle: undefined } }];
  assert.deepEqual(restoreResearchTitle('你好', undefined, turns.slice(0, 1)), { title: '未命名探究', titleMode: 'pending' });
  assert.deepEqual(restoreResearchTitle('你好', undefined, turns), { title: '研究束腰半径对观察屏光斑的影响', titleMode: 'pending' });
  assert.deepEqual(restoreResearchTitle('你好', 'manual', turns), { title: '你好', titleMode: 'manual' });
  assert.throws(() => restoreResearchTitle('研究', ['pending'], turns));
  const now = new Date().toISOString();
  const storage = parseResearchStorage({ schemaVersion: 2, selectedId: 'p', projects: [{ id: 'p', title: '我的课题', titleMode: 'manual', createdAt: now, updatedAt: now, draft: '', objects: [], activeObjectId: null, turns: [] }] });
  assert.equal(storage.projects[0].titleMode, 'manual');
  assert.deepEqual(parseResearchStorage(storage), storage);
});

test('research titles are validated separately from scientific evidence', () => {
  assert.equal(validateResearchReply({ ...reply(), researchTitle: '光束传播研究' }, 'r', null).researchTitle, '光束传播研究');
  for (const title of ['', '题目\n第二行', '<标题>', '长'.repeat(37), 42]) assert.throws(() => validateResearchReply({ ...reply(), researchTitle: title }, 'r', null));
});

test('inquiry naming preserves old conversations and manual titles through storage reload', () => {
  const fresh = newResearchProject();
  assert.equal(fresh.title, '未命名探究');
  const turn: ResearchTurn = { id: 'r', prompt: '我想研究光束', createdAt: fresh.createdAt, error: null, reply: reply() };
  for (const mode of [undefined, 'pending', 'manual', 'auto'] as const) {
    const old = { ...fresh, title: '未命名研究', titleMode: mode, turns: [turn] };
    const restored = parseResearchStorage({ schemaVersion: 2, selectedId: fresh.id, projects: [old] });
    assert.equal(restored.projects[0].title, mode === undefined || mode === 'pending' ? '未命名探究' : '未命名研究');
    assert.deepEqual(restored.projects[0].turns, [turn]);
    assert.deepEqual(parseResearchStorage(restored), restored);
  }
});

test('research reply cannot attach invented evidence to a study without apparatus', () => {
  assert.equal(validateResearchReply(reply(), 'r', null).inputSnapshot, null);
  assert.throws(() => validateResearchReply({ ...reply(), evidence: {} }, 'r', null));
  assert.throws(() => validateResearchReply({ ...reply(), comparisons: [{}] }, 'r', null));
  assert.throws(() => validateResearchReply(reply(input), 'r', null));
});
test('reply identity and apparatus snapshot are checked independently', () => {
  assert.throws(() => validateResearchReply(reply(input), 'other', input));
  assert.throws(() => validateResearchReply(reply({ ...input, name: '另一装置' }), 'r', input));
  assert.equal(validateResearchReply(reply(input), 'r', input).answer, '先明确研究指标。');
});
test('restoring interrupted research makes it retryable rather than permanently loading', () => {
  const now = new Date().toISOString();
  const storage = parseResearchStorage({ schemaVersion: 1, selectedId: 'p', projects: [{ id: 'p', title: '研究', createdAt: now, updatedAt: now, device: null, draft: '', turns: [{ id: 'r', prompt: '研究问题', createdAt: now, reply: null, error: null }] }] });
  assert.match(storage.projects[0].turns[0].error!, /未完整接收/);
});
test('historical results retain their original device after attachment changes', () => {
  const now = new Date().toISOString();
  const p = { id: 'p', title: '研究', createdAt: now, updatedAt: now, draft: '', device: { sourceId: 'new', experiment: { ...input, name: '新装置' } }, turns: [{ id: 'r', prompt: '研究问题', createdAt: now, reply: reply(input), error: null }] };
  const storage = parseResearchStorage({ schemaVersion: 1, selectedId: 'p', projects: [p] });
  assert.equal(storage.projects[0].objects[0].experiment.name, '新装置');
  assert.equal(storage.projects[0].turns[0].reply?.inputSnapshot?.name, '装置');
});

test('legacy studies migrate to multiple-object storage without rewriting historical results', () => {
  const now = new Date().toISOString();
  const old = { id: 'p', title: '研究', createdAt: now, updatedAt: now, draft: '', device: { sourceId: 'draft', experiment: input }, turns: [{ id: 'r', prompt: '问题', createdAt: now, reply: reply(input), error: null }] };
  const migrated = parseResearchStorage({ schemaVersion: 1, selectedId: 'p', projects: [old] });
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.projects[0].activeObjectId, migrated.projects[0].objects[0].id);
  assert.deepEqual(parseResearchStorage(migrated), migrated);
});

test('object sources use independent saved apparatus and scene parameters, including pending availability', () => {
  const originalStorage = globalThis.localStorage;
  const scene = makeGaussianScene(), apparatus = fromLegacy(scene);
  const values = new Map([[BUILDER_DRAFT, JSON.stringify({ ...apparatus, name: '当前草稿' })], [BUILDER_SAVED, JSON.stringify([{ id: 's', savedAt: new Date().toISOString(), experiment: { ...apparatus, name: '另一个存档' } }])], [GAUSSIAN_DRAFT_KEY, JSON.stringify(scene)]]);
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (key: string) => values.get(key) ?? null }, configurable: true });
  try {
    const { choices, warnings } = readResearchObjectSources();
    assert.equal(warnings.length, 0);
    assert.equal(choices.find(c => c.source === 'saved')?.experiment?.name, '另一个存档');
    assert.equal(choices.find(c => c.source === 'scene' && c.experiment)?.experiment?.elements[0].beamRadiusMm, .2);
    assert.ok(choices.some(c => c.source === 'scene' && !c.experiment));
    const choice = choices.find(c => c.source === 'draft')!, object = attachResearchObject(choice);
    values.set(BUILDER_DRAFT, JSON.stringify({ ...apparatus, name: '修改后的草稿' }));
    assert.equal(object.experiment.name, '当前草稿');
    const next = refreshedResearchObject(object, readResearchObjectSources().choices);
    assert.equal(next.id, object.id); assert.equal(next.experiment.name, '修改后的草稿');
    assert.equal(object.experiment.name, '当前草稿');
    assert.throws(() => attachResearchObject(choices.find(c => c.source === 'scene' && !c.experiment)!));
  } finally { Object.defineProperty(globalThis, 'localStorage', { value: originalStorage, configurable: true }); }
});

test('file import validates both apparatus formats and rejects result files and empty apparatus', () => {
  const legacy = makeGaussianScene();
  assert.equal(importedObjectChoice(legacy, '装置.json').experiment?.elements[0].beamModel, 'gaussian');
  const spatial = fromLegacy(legacy);
  assert.deepEqual(importedObjectChoice(spatial, '三维.json').experiment, spatial);
  assert.throws(() => importedObjectChoice(reply(spatial), '结果.json'));
  assert.throws(() => importedObjectChoice(input, '空.json'));
});

test('multiple-object replies bind every result to its own snapshot and preserve removed objects in history', () => {
  const now = new Date().toISOString();
  const objects: ResearchObject[] = ['a', 'b'].map(id => ({ id, source: 'file', sourceId: id, label: id + '.json', snapshotAt: now, experiment: { ...input, name: id } }));
  const snapshots = objectInputs(objects);
  const bundle = { ...reply(objects[0].experiment), activeObjectId: 'a', objectSnapshots: snapshots, objectResults: objects.map(o => ({ objectId: o.id, inputSnapshot: o.experiment, evidence: null, comparisons: [], designs: [], studies: [] })), objectComparisons: [] };
  const checked = validateResearchReply(bundle, 'r', objects[0].experiment, snapshots, 'a');
  assert.equal(checked.objectResults?.length, 2);
  assert.throws(() => validateResearchReply({ ...bundle, objectResults: [{ ...bundle.objectResults[0], inputSnapshot: objects[1].experiment }, bundle.objectResults[1]] }, 'r', objects[0].experiment, snapshots, 'a'));
  assert.throws(() => validateResearchReply({ ...bundle, objectComparisons: [{ id: 'g', objectIds: ['a', 'b'] }] }, 'r', objects[0].experiment, snapshots, 'a'));
  assert.throws(() => validateResearchReply(bundle, 'r', objects[0].experiment, snapshots.slice(0, 1), 'a'));
  const storage = parseResearchStorage({ schemaVersion: 2, selectedId: 'p', projects: [{ id: 'p', title: '研究', createdAt: now, updatedAt: now, draft: '', objects: [], activeObjectId: null, turns: [{ id: 'r', prompt: '问题', createdAt: now, reply: bundle, error: null }] }] });
  assert.equal(storage.projects[0].objects.length, 0);
  assert.equal(storage.projects[0].turns[0].reply?.objectSnapshots?.length, 2);
});
test('history is bounded and excludes unsuccessful turns', () => {
  const turns: ResearchTurn[] = Array.from({ length: 12 }, (_, i) => ({ id: String(i), prompt: '问题', createdAt: new Date().toISOString(), error: null, reply: { ...reply(), answer: '答'.repeat(12000) } }));
  const h = researchHistory([...turns, { ...turns[0], reply: null, error: '失败' }]);
  assert.equal(h.length, 8);
  assert.ok(h.reduce((sum, m) => sum + m.content.length, 0) < 24000);
});
test('opening a focus recommendation preserves source power and sampling configuration', () => {
  const e = (kind: string, x: number) => ({ id: kind, name: kind, kind, position: [x, 60, 0], yawDeg: 0, pitchDeg: 0, diameterMm: 40, focalLengthMm: 100, beamRadiusMm: 1, wavelengthNm: 532, transmission: 1, beamModel: 'gaussian', powerMw: 17, rayCount: 101 });
  const original = parseSpatial({ schemaVersion: 2, name: '研究装置', elements: [e('laser', 20), e('lens', 100), e('screen', 250)] });
  const recommendation = structuredClone(toLegacy(original)!);
  recommendation.elements[1].positionMm = 110;
  const converted = recommendedSpatial(original, recommendation);
  assert.equal(converted.elements[0].powerMw, 17);
  assert.equal(converted.elements[0].rayCount, 101);
  assert.equal(converted.elements[1].position[0], 110);
  assert.equal(original.elements[1].position[0], 100);
});
test('research stream handles split UTF-8 and refuses incomplete or mismatched results', async () => {
  const oldFetch = globalThis.fetch;
  try {
    const encoded = new TextEncoder().encode('\n\n' + JSON.stringify({ type: 'progress', step: { name: 'read_research', status: 'ok', summary: '读取研究上下文' } }) + '\n\n' + JSON.stringify({ type: 'reply', reply: reply() }) + '\n\n');
    globalThis.fetch = async () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < encoded.length; i += 5) c.enqueue(encoded.slice(i, i + 5)); c.close(); } }));
    const steps: string[] = [];
    assert.equal((await requestResearchAgent('r', null, '问题', [], new AbortController().signal, s => steps.push(s.summary))).answer, '先明确研究指标。');
    assert.deepEqual(steps, ['读取研究上下文']);
    globalThis.fetch = async () => new Response(JSON.stringify({ type: 'reply', reply: reply() }));
    await assert.rejects(requestResearchAgent('r', null, '问题', [], new AbortController().signal, () => {}), /完整/);
  } finally { globalThis.fetch = oldFetch; }
});

function generatedBundle(existing: ResearchObject[] = []) {
  const device = fromLegacy(makeGaussianScene()), screen = device.elements.find(e => e.kind === 'screen')!, source = device.elements.find(e => e.kind === 'laser')!;
  device.name = '新研究装置';
  const evidence = { revision: 0, inputSnapshot: device, model: 'test', segments: [], beams: [], screens: [{ elementId: screen.id, name: screen.name, hits: 9, sampledPowerFraction: 1, sampledPowerMw: source.powerMw, centroid: screen.position, footprintRadiusMm: 1, gaussianRadiusMm: .5 }], warnings: [], assumptions: ['这是模型内核验，不是实测。'], chiefHitIds: [] };
  const seed = existing[0]?.experiment ?? input;
  const build = { objectId: 'generated', baseObjectId: existing[0]?.id ?? null, goal: '设计可到屏的装置', reply: { requestId: 'builder', inputSnapshot: seed, experiment: device, changed: true, applyAllowed: true, answer: '完成模型内核验。', trace: [], checks: [{ criterion: { label: '到屏', metric: 'screen_hits', elementId: screen.id, operator: 'ge', value: 1, tolerance: 0, radiusModel: 'sampled' }, actual: 9, passed: true }], comparisons: [], evidence } };
  const objects = [...objectInputs(existing), { id: build.objectId, source: 'generated', label: '科研 Agent 生成', experiment: device }];
  return { ...reply(device), evidence, apparatusBuilds: [build], activeObjectId: build.objectId, objectSnapshots: objects, objectResults: objects.map(o => ({ objectId: o.id, inputSnapshot: o.experiment, evidence: o.id === build.objectId ? evidence : null, comparisons: [], designs: [], studies: [] })), objectComparisons: [] };
}

test('verified object imaging can be retained without a laser, and forged focus is rejected', () => {
  const bundle = generatedBundle();
  const build = bundle.apparatusBuilds[0], device = build.reply.experiment;
  const source = device.elements.find(e => e.kind === 'laser')!;
  source.kind = 'object';
  const screen = device.elements.find(e => e.kind === 'screen')!;
  const evidence = {...bundle.evidence, imaging: [{objectId: source.id, objectPaths: [], stages: [], segments: [], warnings: [], observations: [{
    elementId: screen.id, kind: 'screen', focused: true, defocusMm: 0, magnification: -1,
    angularMagnification: null, fieldDiameterMm: null, adapterMagnification: 1,
    widthMm: 40, heightMm: 40, hits: [{x: 0, y: 0, point: 0}],
  }]}]};
  const document = {...bundle, evidence, apparatusBuilds: [{...build, reply: {...build.reply, evidence, checks: [{
    criterion: {label: '清晰成像', metric: 'image_focused', elementId: screen.id, otherId: source.id, operator: 'eq', value: 1, tolerance: 0, radiusModel: 'sampled'}, actual: 1, passed: true,
  }]}}], objectResults: bundle.objectResults.map(row => ({...row, evidence}))};
  const checked = validateResearchReply(document, 'r', null, [], null);
  const project = retainResearchBuilds(newResearchProject(), checked, new Date().toISOString());
  assert.equal(project.objects.length, 1);
  assert.equal(project.objects[0].experiment.elements.some(e => e.kind === 'laser'), false);
  for (const mutate of [
    (e: typeof evidence) => {e.imaging[0].observations[0].focused = false;},
    (e: typeof evidence) => {e.imaging[0].observations[0].hits = [];},
  ]) {
    const forged = structuredClone(document);
    mutate(forged.apparatusBuilds[0].reply.evidence);
    assert.throws(() => validateResearchReply(forged, 'r', null, [], null), /成像核对/);
  }
});

function sequentialBundle() {
  const seed = generatedBundle(), original = structuredClone(seed.inputSnapshot!);
  original.elements.splice(1,0,spatialTemplate('focus').elements.find(e=>e.kind==='lens')!);
  const originalObject: ResearchObject = {id:'o',source:'draft',sourceId:'draft',label:'测试',snapshotAt:new Date().toISOString(),experiment:original};
  const stage = (device: SpatialExperiment, revision: number) => ({objectId:'o',revision,inputSnapshot:device,evidence:{...structuredClone(seed.evidence),inputSnapshot:device},comparisons:[],designs:[],studies:[]});
  const initial=stage(original,0), history=[initial], edits=[];
  let previous=original;
  for(let revision=1;revision<=2;revision++) {
    const next=structuredClone(previous);
    next.elements.find(e=>e.kind==='lens')!.focalLengthMm+=20;
    const result=stage(next,revision);
    edits.push({objectId:'o',goal:'增加焦距',reply:{...structuredClone(seed.apparatusBuilds[0].reply),inputSnapshot:previous,experiment:next,evidence:result.evidence}});
    if(revision<2)history.push(result);
    previous=next;
  }
  const final=stage(previous,2);
  return {originalObject,bundle:{...reply(previous),evidence:final.evidence,activeObjectId:'o',objectSnapshots:[{...objectInputs([originalObject])[0],experiment:previous}],objectResults:[final],objectComparisons:[],apparatusBuilds:[],apparatusEdits:edits,parameterHistory:history,editsApplyAllowed:true}};
}

test('sequential calculations retain stage parameters, distinct result references, export and refresh',()=>{
  const {originalObject,bundle}=sequentialBundle();
  const checked=validateResearchReply(bundle,'r',originalObject.experiment,objectInputs([originalObject]),'o');
  const project={...newResearchProject(),objects:[originalObject],activeObjectId:'o',turns:[{id:'r',prompt:'先算再改再算',createdAt:originalObject.snapshotAt,reply:checked,error:null}]};
  const restored=parseResearchStorage({schemaVersion:2,selectedId:project.id,projects:[project]}).projects[0];
  assert.deepEqual(restored.turns[0].reply,checked);
  const artifacts=collectResearchArtifacts(restored);
  assert.equal(artifacts.length,3);
  assert.equal(new Set(artifacts.map(a=>a.id)).size,3);
  assert.deepEqual(artifacts.map(a=>a.reference.recordId),['simulation','v1:simulation','v2:simulation']);
  assert.match(artifacts[0].title,/修改前/);
  assert.match(artifacts[2].title,/第2次修改后/);
  for(const a of artifacts)assert.ok(hasResearchEvidence(checked,a.reference));
  assert.equal(hasResearchEvidence(checked,{...artifacts[2].reference,recordId:'v3:simulation'}),false);
  const report=researchReport(restored);
  assert.match(report,/修改前/);assert.match(report,/第2次修改后/);assert.match(report,/焦距/);
  assert.equal(checked.parameterHistory![0].inputSnapshot.elements.find(e=>e.kind==='lens')!.focalLengthMm+40,checked.inputSnapshot!.elements.find(e=>e.kind==='lens')!.focalLengthMm);
  assert.equal(validateResearchReply({...bundle,editsApplyAllowed:false},'r',originalObject.experiment,objectInputs([originalObject]),'o').editsApplyAllowed,false);
});

test('sequential replies reject broken chains, missing history and mislabeled old parameters',()=>{
  const {originalObject,bundle}=sequentialBundle();
  for(const mutate of [
    (v:typeof bundle)=>{v.apparatusEdits[1].reply.inputSnapshot=originalObject.experiment;},
    (v:typeof bundle)=>{v.parameterHistory.pop();},
    (v:typeof bundle)=>{v.parameterHistory[0].inputSnapshot=v.inputSnapshot!;},
    (v:typeof bundle)=>{v.parameterHistory[1].revision=0;},
    (v:typeof bundle)=>{v.objectResults[0].revision=0;},
    (v:typeof bundle)=>{v.apparatusEdits[1].reply.applyAllowed=false;},
  ]) {
    const bad=structuredClone(bundle);mutate(bad);
    assert.throws(()=>validateResearchReply(bad,'r',originalObject.experiment,objectInputs([originalObject]),'o'));
  }
  assert.throws(()=>validateResearchReply(bundle,'r',originalObject.experiment,objectInputs([{...originalObject,experiment:{...originalObject.experiment,name:'手动改过'}}]),'o'),/不同版本/);
});

test('verified generated objects can compute in the same reply, persist and remain available on followup', () => {
  const now = new Date().toISOString();
  const bundle = generatedBundle();
  const result = validateResearchReply(bundle, 'r', null, [], null);
  assert.equal(result.activeObjectId, 'generated');
  assert.equal(result.objectResults![0].evidence!.screens[0].hits, 9);
  const project: ResearchProject = { id: 'p', title: '研究', titleMode: 'pending', createdAt: now, updatedAt: now, draft: '', objects: [], activeObjectId: null, turns: [{ id: 'r', prompt: '设计并计算', createdAt: now, error: null, reply: result }] };
  const retained = retainResearchBuilds(project, result, now);
  assert.equal(project.objects.length, 0);
  assert.equal(retained.objects[0].source, 'generated');
  assert.equal(retained.activeObjectId, 'generated');
  const restored = parseResearchStorage({ schemaVersion: 2, selectedId: 'p', projects: [retained] });
  assert.deepEqual(restored.projects[0], retained);
  const followup = { ...reply(retained.objects[0].experiment), evidence: bundle.evidence, activeObjectId: 'generated', objectSnapshots: objectInputs(retained.objects), objectResults: bundle.objectResults, objectComparisons: [] };
  assert.equal(validateResearchReply(followup, 'r', retained.objects[0].experiment, objectInputs(retained.objects), 'generated').objectResults?.length, 1);
});

test('generation preserves original objects, rejects unverified additions and mismatched handoffs', () => {
  const now = new Date().toISOString();
  const original: ResearchObject = { id: 'original', source: 'saved', sourceId: 'saved-device', label: '已保存装置', snapshotAt: now, experiment: { ...fromLegacy(makeGaussianScene()), name: '原装置' } };
  const before = JSON.stringify(original), bundle = generatedBundle([original]);
  const checked = validateResearchReply(bundle, 'r', original.experiment, objectInputs([original]), original.id);
  const project: ResearchProject = { id: 'p', title: '研究', titleMode: 'pending', createdAt: now, updatedAt: now, draft: '', objects: [original], activeObjectId: original.id, turns: [] };
  const retained = retainResearchBuilds(project, checked, now);
  assert.equal(JSON.stringify(retained.objects[0]), before);
  assert.equal(retained.objects.length, 2);
  assert.throws(() => retainResearchBuilds(retained, checked, now), /重复/);
  const invalids = [
    { ...bundle, apparatusBuilds: undefined },
    { ...bundle, apparatusBuilds: [bundle.apparatusBuilds[0], bundle.apparatusBuilds[0]] },
    { ...bundle, activeObjectId: original.id },
    { ...bundle, objectSnapshots: bundle.objectSnapshots.slice(1), objectResults: bundle.objectResults.slice(1) },
  ];
  for (const change of [
    (v: ReturnType<typeof generatedBundle>) => { v.apparatusBuilds[0].reply.applyAllowed = false; },
    (v: ReturnType<typeof generatedBundle>) => { v.objectSnapshots[0].experiment.name = '偷偷改原装置'; },
    (v: ReturnType<typeof generatedBundle>) => { v.apparatusBuilds[0].reply.experiment = { ...v.apparatusBuilds[0].reply.experiment, name: '另一套装置' }; },
  ]) { const malformed = structuredClone(bundle); change(malformed); invalids.push(malformed); }
  for (const malformed of invalids) assert.throws(() => validateResearchReply(malformed, 'r', original.experiment, objectInputs([original]), original.id));
  assert.equal(JSON.stringify(original), before);
});

test('streamed builder handoff is validated before additions are retained', async () => {
  const oldFetch = globalThis.fetch;
  try {
    const bundle = generatedBundle();
    globalThis.fetch = async () => new Response(JSON.stringify({ type: 'reply', reply: bundle }) + '\n');
    const result = await requestResearchAgent('r', null, '设计并计算', [], new AbortController().signal, () => {}, [], null);
    assert.equal(result.apparatusBuilds?.[0].objectId, 'generated');
    globalThis.fetch = async () => new Response(JSON.stringify({ type: 'reply', reply: { ...bundle, apparatusBuilds: undefined } }) + '\n');
    await assert.rejects(requestResearchAgent('r', null, '设计并计算', [], new AbortController().signal, () => {}, [], null));
  } finally { globalThis.fetch = oldFetch; }
});

test('verified edits preserve identity, validate both versions and restore their historical snapshot', () => {
  const original: ResearchObject = { id:'original', source:'saved', sourceId:'archive', label:'原装置', snapshotAt:new Date().toISOString(), experiment:{...fromLegacy(makeGaussianScene()),name:'修改前'} };
  const generated=generatedBundle([original]);
  const edit={objectId:original.id,goal:'修改当前装置',reply:generated.apparatusBuilds[0].reply};
  const bundle={...generated,apparatusBuilds:[],apparatusEdits:[edit],activeObjectId:original.id,
    objectSnapshots:[{...objectInputs([original])[0],experiment:edit.reply.experiment}],
    objectResults:[{...generated.objectResults[1],objectId:original.id}]};
  const checked=validateResearchReply(bundle,'r',original.experiment,objectInputs([original]),original.id);
  assert.equal(checked.apparatusEdits?.[0].reply.inputSnapshot.name,'修改前');
  assert.equal(checked.objectSnapshots?.[0].id,original.id);
  const project={...newResearchProject(),objects:[original],activeObjectId:original.id,turns:[{id:'r',prompt:'修改装置',createdAt:original.snapshotAt,reply:checked,error:null}]};
  assert.deepEqual(parseResearchStorage({schemaVersion:2,selectedId:project.id,projects:[project]}).projects[0].turns[0].reply,checked);
  assert.throws(()=>validateResearchReply(bundle,'r',original.experiment,objectInputs([{...original,experiment:{...original.experiment,name:'等待时已改动'}}]),original.id),/不同版本/);
  for(const mutate of [
    (v:typeof bundle)=>{v.apparatusEdits[0].reply.applyAllowed=false;},
    (v:typeof bundle)=>{v.objectSnapshots[0].source='file';},
    (v:typeof bundle)=>{v.apparatusEdits[0].objectId='another';},
  ]){const invalid=structuredClone(bundle);mutate(invalid);assert.throws(()=>validateResearchReply(invalid,'r',original.experiment,objectInputs([original]),original.id));}
});


test('calculated builds need no goal checklist and unmet comparisons remain informational', () => {
  for (const checks of [[], [{criterion: {label:'optional comparison',metric:'screen_hits',elementId:'screen',operator:'ge',value:10000,tolerance:0,radiusModel:'sampled'},actual:9,passed:false}]]) {
    const bundle=generatedBundle();
    if(checks.length)checks[0].criterion.elementId=bundle.evidence.screens[0].elementId;
    const document={...bundle,apparatusBuilds:[{...bundle.apparatusBuilds[0],reply:{...bundle.apparatusBuilds[0].reply,checks}}]};
    assert.doesNotThrow(()=>validateResearchReply(document,'r',null,[],null));
    const missing={...document,apparatusBuilds:[{...document.apparatusBuilds[0],reply:{...document.apparatusBuilds[0].reply,evidence:null}}]};
    assert.throws(()=>validateResearchReply(missing,'r',null,[],null));
  }
});

test('new apparatus can be corrected immediately and retains final parameters after reload',()=>{
  const initial=generatedBundle(), original=initial.inputSnapshot!;
  const final=structuredClone(original);
  final.elements.find(e=>e.kind==='screen')!.position[0]+=20;
  const evidence={...structuredClone(initial.evidence),inputSnapshot:final};
  evidence.screens[0].centroid=final.elements.find(e=>e.kind==='screen')!.position;
  const history={objectId:'generated',revision:0,inputSnapshot:original,evidence:initial.evidence,comparisons:[],designs:[],studies:[]};
  const edit={objectId:'generated',goal:'移动新装置的屏',reply:{...structuredClone(initial.apparatusBuilds[0].reply),inputSnapshot:original,experiment:final,evidence,checks:[]}};
  const bundle={...initial,inputSnapshot:final,evidence,apparatusEdits:[edit],editsApplyAllowed:true,parameterHistory:[history],objectSnapshots:initial.objectSnapshots.map(o=>({...o,experiment:final})),objectResults:[{...history,revision:1,inputSnapshot:final,evidence}]};
  const checked=validateResearchReply(bundle,'r',null,[],null);
  const project=newResearchProject();
  project.turns=[{id:'r',prompt:'搭建并修正',createdAt:project.createdAt,reply:checked,error:null}];
  const retained=retainResearchBuilds(project,checked,project.createdAt);
  const restored=parseResearchStorage({schemaVersion:2,selectedId:project.id,projects:[retained]}).projects[0];
  assert.deepEqual(restored.objects[0].experiment,final);
  assert.deepEqual(restored.turns[0].reply!.parameterHistory![0].inputSnapshot,original);
  const bad=JSON.parse(JSON.stringify(bundle)) as typeof bundle;
  bad.apparatusEdits[0].reply.inputSnapshot.elements.find(e=>e.kind==='screen')!.position[0]+=10;
  assert.throws(()=>validateResearchReply(bad,'r',null,[],null));
});

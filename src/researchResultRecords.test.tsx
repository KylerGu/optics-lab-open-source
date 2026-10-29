import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { spatialTemplate, type SpatialResult } from './builderModel';
import type { ResearchArtifact } from './ResearchResults';
import { groupResearchArtifacts } from './researchResultRecords';
import ResearchRecordResults from './ResearchRecordResults';
import ResearchModelNotes from './ResearchModelNotes';
import { parseResearchMethod } from './researchMethod';

const input = spatialTemplate('focus');
const screen: SpatialResult['screens'][number] = { elementId: 'screen', name: '观察屏', hits: 9, sampledPowerFraction: .5, sampledPowerMw: 5, centroid: null, footprintRadiusMm: 1, gaussianRadiusMm: null };
const data: SpatialResult = { revision: 0, inputSnapshot: input, model: 'record', segments: [], beams: [], screens: [screen], warnings: [], assumptions: ['全部技术说明保留'], chiefHitIds: [] };
const simulation = (requestId = 'r', objectId = 'o'): ResearchArtifact => ({ id: requestId + objectId + '-baseline', kind: 'simulation', title: objectId + ' · 仿真读数', createdAt: '2026-10-01T00:00:00Z', input, data, reference: { requestId, objectId, kind: 'simulation', recordId: 'simulation' } });
const comparison = (requestId = 'r', objectId = 'o'): ResearchArtifact => ({ id: requestId + objectId + '-scan', kind: 'comparison', title: objectId + ' · 功率比较', createdAt: '2026-10-01T00:00:00Z', input, reference: { requestId, objectId, kind: 'comparison', recordId: 'scan' }, data: { comparisonId: 'scan', inputSnapshot: input, elementId: input.elements[0].id, field: 'powerMw', rows: [1, 5, 9].map(value => ({ value, screens: [{ ...screen, sampledPowerMw: value }], warnings: [], error: null })) } });
const render = (artifacts: ResearchArtifact[]) => { const record = groupResearchArtifacts(artifacts)[0]; return renderToStaticMarkup(<ResearchRecordResults record={record} selectedArtifactId={record.primaryId} onSelectArtifact={() => {}} onOpenBuilder={() => {}}/>); };

test('one research turn has one result entry while retaining every underlying record', () => {
  const artifacts = [simulation(), comparison()];
  const before = JSON.stringify(artifacts);
  const grouped = groupResearchArtifacts(artifacts);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].primaryId, artifacts[1].id);
  assert.deepEqual(grouped[0].artifacts, artifacts);
  assert.equal(JSON.stringify(artifacts), before);
  const html = render(artifacts);
  assert.match(html, /基准读数/);
  assert.match(html, /采样功率 \/ mW：5/);
  assert.doesNotMatch(html, /aria-label="查看探究结果"/);
});

test('history and independent objects are retained rather than merged by names or identical numbers', () => {
  assert.equal(groupResearchArtifacts([simulation('old'), comparison('new')]).length, 2);
  const html = render([simulation(), comparison(), simulation('r', 'another')]);
  assert.match(html, /aria-label="查看探究结果"/);
  assert.match(html, /another · 仿真读数/);
  assert.doesNotMatch(html, /<option[^>]*>o · 仿真读数/);
});

test('a standalone simulation remains visible and a changed snapshot cannot be presented as its scan baseline', () => {
  assert.match(render([simulation()]), /仿真读数/);
  const changed = comparison();
  if (changed.kind !== 'comparison') throw new Error('fixture');
  changed.data = { ...changed.data, inputSnapshot: { ...input, name: '不同参数副本' } };
  assert.doesNotMatch(render([simulation(), changed]), /基准读数/);
  assert.match(render([simulation(), changed]), /<option[^>]*>o · 仿真读数/);
});

test('model notes keep relevant limits and warnings visible while folding unrelated technical descriptions', () => {
  const html = renderToStaticMarkup(<ResearchModelNotes data-detail="explanation" notes={['本次指标的计算限制']} warnings={['截光警告', '截光警告']} fullNotes={['其他器件模型说明', '全部计算定义']}/>);
  assert.ok(html.indexOf('本次指标的计算限制') < html.indexOf('<details'));
  assert.ok(html.indexOf('截光警告') < html.indexOf('<details'));
  assert.equal((html.match(/截光警告/g) ?? []).length, 1);
  assert.ok(html.indexOf('其他器件模型说明') > html.indexOf('<details'));
  assert.doesNotMatch(html, /<details[^>]*\bopen[= >]/);
});

test('method metadata preserves partial coverage and rejects unsupported claims of full validation', () => {
  const partial = { question: '原问题', method: '相关计算', questionRequires: ['coherent-path-interference'], calculationUses: ['ray-geometry'], calculationQuestion: '分光后的功率', remainingQuestion: '相消干涉', coverage: 'partial' };
  const before = JSON.stringify(partial);
  assert.equal(parseResearchMethod(partial)?.remainingQuestion, '相消干涉');
  assert.equal(JSON.stringify(partial), before);
  assert.throws(() => parseResearchMethod({ ...partial, coverage: 'supported', remainingQuestion: '' }));
  assert.equal(parseResearchMethod(null), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResearchPlanList, ResearchRecordList } from './ResearchSidebar';
import type { ResearchPlanStep } from './researchPlan';
import type { ResearchArtifact } from './ResearchResults';
import { fromLegacy } from './builderModel';
import { makeTemplate } from './model';
import { groupResearchArtifacts } from './researchResultRecords';

const artifact: ResearchArtifact = {
  id: 'scan-record', kind: 'comparison', title: '已有装置 · 参数比较', createdAt: '2026-10-01T00:00:00Z', input: fromLegacy(makeTemplate('focus')),
  reference: { requestId: 'request', objectId: 'object', kind: 'comparison', recordId: 'scan' },
  data: { comparisonId: 'scan', inputSnapshot: fromLegacy(makeTemplate('focus')), elementId: 'lens', field: 'focalLengthMm', rows: [] },
};

test('plan presents each task once with a direct expansion and preserves evidence and validation status', () => {
  const plan: ResearchPlanStep[] = [
    { text: '比较参数对读数的影响', status: 'completed', basis: 'calculation', note: '已比较参数对读数的影响，这是一条重复完成说明。', evidence: [artifact.reference] },
    { text: '进行实测验证', status: 'needs_validation', basis: 'analysis', note: '还没有实测数据。', evidence: [] },
  ];
  const before = JSON.stringify(plan);
  const html = renderToStaticMarkup(<ResearchPlanList plan={plan} hasProgress artifacts={[artifact]} onSelect={() => {}}/>);
  assert.match(html, /<summary><span>比较参数对读数的影响<\/span><\/summary>/);
  assert.equal((html.match(/比较参数对读数的影响/g) ?? []).length, 1);
  assert.match(html, /已完成/);
  assert.match(html, /待验证/);
  assert.match(html, /查看结果/);
  assert.doesNotMatch(html, /步骤详情|进度说明|重复完成说明|已核对|通过/);
  assert.equal(JSON.stringify(plan), before);
});

test('record list shows type badge, title, and concise numeric summary without raw metadata boilerplate', () => {
  const before = JSON.stringify(artifact);
  const html = renderToStaticMarkup(<ResearchRecordList records={groupResearchArtifacts([artifact])} onSelect={() => {}}/>);
  assert.match(html, /已有装置 · 参数比较/);
  assert.match(html, /rw-record-badge">扫描/);
  assert.doesNotMatch(html, /2026|计算条件|查看完整参数与结果|扫描点|<small/);

  const populated: ResearchArtifact = {
    ...artifact,
    data: {
      ...artifact.data,
      rows: [
        { value: 200, screens: [{ elementId: 's', name: '探测屏', hits: 9, sampledPowerFraction: 1, sampledPowerMw: 1, centroid: null, footprintRadiusMm: 0.25, gaussianRadiusMm: 0.25356 }], warnings: [], error: null },
        { value: 250, screens: [{ elementId: 's', name: '探测屏', hits: 9, sampledPowerFraction: 1, sampledPowerMw: 1, centroid: null, footprintRadiusMm: 0.04, gaussianRadiusMm: 0.033868 }], warnings: [], error: null },
        { value: 450, screens: [{ elementId: 's', name: '探测屏', hits: 9, sampledPowerFraction: 1, sampledPowerMw: 1, centroid: null, footprintRadiusMm: 1, gaussianRadiusMm: 1 }], warnings: [], error: null },
      ],
    } as Extract<ResearchArtifact, { kind: 'comparison' }>['data'],
  };
  const summaryHtml = renderToStaticMarkup(<ResearchRecordList records={groupResearchArtifacts([populated])} onSelect={() => {}} selectedRecordId="research-result-request"/>);
  assert.match(summaryHtml, /最小光斑 33\.9 μm/);
  assert.match(summaryHtml, /is-selected/);
  assert.equal(JSON.stringify(artifact), before);
});

test('multi-turn records on the same apparatus show turn number and distinct scan ranges', () => {
  const makeScan = (requestId: string, createdAt: string, values: number[]): ResearchArtifact => ({
    id: `scan-${requestId}`,
    kind: 'comparison',
    title: '高斯光束单透镜聚焦：光斑沿轴先缩后涨 · Z位置（mm）比较',
    createdAt,
    input: fromLegacy(makeTemplate('focus')),
    reference: { requestId, objectId: 'object', kind: 'comparison', recordId: `rec-${requestId}` },
    data: {
      comparisonId: `rec-${requestId}`,
      inputSnapshot: fromLegacy(makeTemplate('focus')),
      elementId: 'screen',
      field: 'z',
      rows: values.map(value => ({
        value,
        screens: [{ elementId: 'screen', name: '探测屏', hits: 9, sampledPowerFraction: 1, sampledPowerMw: 1, centroid: null, footprintRadiusMm: 0.04, gaussianRadiusMm: 0.033868 }],
        warnings: [],
        error: null,
      })),
    },
  });
  const records = groupResearchArtifacts([
    makeScan('t1', '2026-10-01T00:00:00Z', [200, 250, 450]),
    makeScan('t2', '2026-10-01T00:01:00Z', [166.4, 200, 250]),
  ]);
  const html = renderToStaticMarkup(
    <ResearchRecordList records={records} turnOrderByRequest={{ t1: 1, t2: 2 }} onSelect={() => {}}/>,
  );
  assert.match(html, /第 1 轮/);
  assert.match(html, /第 2 轮/);
  assert.match(html, /<strong>Z位置 200→450 mm<\/strong>/);
  assert.match(html, /<strong>Z位置 166\.4→250 mm<\/strong>/);
  assert.doesNotMatch(html, /3 点/);
});

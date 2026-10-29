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

test('record list uses only the title, while the complete record is retained for opening', () => {
  const before = JSON.stringify(artifact);
  const html = renderToStaticMarkup(<ResearchRecordList records={groupResearchArtifacts([artifact])} onSelect={() => {}}/>);
  assert.match(html, /已有装置 · 参数比较/);
  assert.doesNotMatch(html, /2026|计算条件|查看完整参数与结果|扫描点|<small/);
  assert.equal(JSON.stringify(artifact), before);
});

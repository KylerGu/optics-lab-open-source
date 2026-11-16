import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import ResearchResults, { comparisonCSV, scanHighlights, type ResearchArtifact } from './ResearchResults';
import { artifactOptionLabel } from './researchResultRecords';
import { niceAxisRange, shortRecordTitle } from './researchUnits';
import { resolveArtifactFormulas } from './researchFormulaLinks';
import { fromLegacy, makeSpatialElement, type SpatialResult } from './builderModel';
import { makeTemplate } from './model';
import type { SpatialComparison } from './spatialAgent';

const input = fromLegacy(makeTemplate('focus'));
const screen = (id: string, gaussian: number | null, power = 0): SpatialResult['screens'][number] => ({
  elementId: id, name: id, hits: 9, sampledPowerFraction: power / 10, sampledPowerMw: power,
  centroid: null, footprintRadiusMm: 1, gaussianRadiusMm: gaussian,
});
const comparison = (): SpatialComparison => ({
  comparisonId: 'scan', inputSnapshot: input, elementId: input.elements[0].id, field: 'beamRadiusMm',
  rows: [
    { value: .1, screens: [screen('A', .9), screen('B', 2)], warnings: [], error: null },
    { value: .2, screens: [screen('A', .5, 3)], warnings: [], error: null },
    { value: .3, screens: [screen('A', null)], warnings: [], error: null },
    { value: .4, screens: [screen('A', .01)], warnings: [], error: '无法计算' },
    { value: .5, screens: [screen('A', .5)], warnings: ['模型警告'], error: null },
  ],
});
const shared = { id: 'record', title: '已有计算记录', createdAt: '2026-10-01T00:00:00Z', input };
const reference = (kind: ResearchArtifact['kind']) => ({ requestId: 'r', objectId: 'o', kind, recordId: 'record' });
const render = (artifact: ResearchArtifact) => renderToStaticMarkup(<ResearchResults artifact={artifact} onOpenBuilder={() => {}}/>);

test('scan highlights use only the selected detector, retain zero and ties, and exclude failed or missing readings', () => {
  const record = comparison(), before = JSON.stringify(record);
  const highlights = scanHighlights(record, 'A', 'gaussianRadiusMm');
  assert.equal(highlights[0].value, '3 / 5');
  assert.equal(highlights[1].value, '0.5 mm');
  assert.match(highlights[1].note!, /等 2 个参数点/);
  assert.match(highlights[1].note!, /模型警告，仅供参考/);
  assert.equal(highlights[2].value, '0.9 mm');
  assert.equal(scanHighlights(record, 'A', 'sampledPowerMw')[1].value, '0 mW');
  assert.equal(scanHighlights(record, 'B', 'gaussianRadiusMm')[0].value, '1 / 5');
  assert.equal(scanHighlights(record, 'missing', 'gaussianRadiusMm')[1].value, '—');
  assert.equal(JSON.stringify(record), before);
});

test('scan display prioritizes actual results, shows calculation derivations directly, and removes boilerplate', () => {
  const html = render({ ...shared, reference: reference('comparison'), kind: 'comparison', data: comparison() });
  assert.ok(html.indexOf('关键结果') < html.indexOf('全部扫描数据'));
  assert.ok(html.indexOf('关键结果') < html.indexOf('计算公式'));
  assert.match(html, /实际计算比较/);
  assert.match(html, /理想基模高斯光束/);
  assert.match(html, /role="tab"[^>]*>数据<\/button>/);
  assert.match(html, /role="tab"[^>]*>计算<\/button>/);
  assert.match(html, /下载数据/);
  assert.doesNotMatch(html, /完整计算说明|模型口径|rw-results-subtitle|基准读数/);
  assert.doesNotMatch(html, /装置参数|JSON|CSV|计算条件|<details[^>]*\bopen[= >]/);
  assert.doesNotMatch(html, /全局最优|继续细化|下一步/);
});

test('simulation display distinguishes unavailable radius from zero power without inventing readings', () => {
  const data: SpatialResult = { revision: 0, inputSnapshot: input, model: 'record', segments: [], beams: [], screens: [screen('观察屏', null)], warnings: [], assumptions: ['原模型适用范围'], chiefHitIds: [] };
  const before = JSON.stringify(data);
  const html = render({ ...shared, reference: reference('simulation'), kind: 'simulation', data });
  assert.match(html, /采样功率<\/dt><dd>0 mW/);
  assert.match(html, /高斯半径<\/dt><dd>—/);
  assert.match(html, /原模型适用范围/);
  assert.equal(JSON.stringify(data), before);
});

test('Fourier results show wave readings instead of presenting geometric coverage as the spectrum', () => {
  const fourier: NonNullable<SpatialResult['fourier']> = {
    screenId: 'A', sourceId: 'source', gratingId: 'grating',
    parameters: { wavelengthNm: 532, periodMm: .16, waistMm: .8, modulation: 1, focalLengthMm: 120, observationUm: 399 },
    spatialFrequency: 6.25, orderPositionUm: 399, spotRadiusUm: 25.401, pointIntensity: .25,
    inputPowerMw: 3.75, capturedPowerMw: 3.75, points: [{ xMm: -.6, intensity: 0 }, { xMm: .6, intensity: 0 }],
  };
  const data: SpatialResult = { revision: 0, inputSnapshot: input, model: 'record', segments: [], beams: [], screens: [screen('A', null, 3.75)], warnings: [], assumptions: [], chiefHitIds: [], fourier };
  const html = render({ ...shared, reference: reference('simulation'), kind: 'simulation', data });
  assert.match(html, /傅里叶频谱结果/);
  assert.match(html, /399\.00/);
  assert.match(html, /0\.2500/);
  assert.match(html, /到屏功率（波动计算）/);
  assert.doesNotMatch(html, /几何覆盖半径<\/dt>/);
  const scan = comparison();
  scan.rows = [
    { value: 0, screens: data.screens, fourier: { ...fourier, pointIntensity: 1, parameters: { ...fourier.parameters, observationUm: 0 } }, warnings: [], error: null },
    { value: .399, screens: data.screens, fourier, warnings: [], error: null },
    { value: .5, screens: [], warnings: [], error: '计算失败' },
  ];
  const scanHtml = render({ ...shared, reference: reference('comparison'), kind: 'comparison', data: scan });
  assert.match(scanHtml, /波动计算读数/);
  assert.match(scanHtml, /<td>0\.399<\/td><td>0\.399<\/td><td>0\.25<\/td><td>3\.75<\/td>/);
  assert.match(scanHtml, /<td>0\.5<\/td><td>—<\/td><td>—<\/td><td>—<\/td>/);
});

test('object comparison keeps missing readings and individual conditions without ranking different apparatus', () => {
  const second = { ...input, name: '另一个装置' };
  const rows = [input, second].map((inputSnapshot, i) => ({ objectId: String(i), inputSnapshot, evidence: null, comparisons: [], designs: [], studies: [] }));
  const html = render({ ...shared, reference: reference('objects'), kind: 'objects', data: rows });
  assert.match(html, /不自动判断装置优劣/);
  assert.match(html, /暂无到屏读数/);
  assert.match(html, /另一个装置/);
  assert.doesNotMatch(html, /推荐方案|下一步/);
});

test('units adapt by median magnitude, clamp floating-point noise to 0, hide flat power, and distinguish duplicate scans', () => {
  const fineMicroScan: SpatialComparison = {
    comparisonId: 'scan',
    inputSnapshot: input,
    elementId: input.elements[0].id,
    field: 'beamRadiusMm',
    rows: [
      { value: 240, screens: [screen('A', 0.085, 1)], warnings: [], error: null },
      { value: 250, screens: [screen('A', 0.033868, 1)], warnings: [], error: null },
      { value: 260, screens: [screen('A', 0.092, 1)], warnings: [], error: null },
    ],
  };
  const fineHtml = render({ ...shared, reference: reference('comparison'), kind: 'comparison', data: fineMicroScan });
  assert.match(fineHtml, /33\.9 μm/);
  assert.match(fineHtml, /92 μm/);
  assert.match(fineHtml, /高斯半径 \/ μm/);
  assert.match(fineHtml, />33\.9<\/td>/);
  assert.doesNotMatch(fineHtml, /采样功率/);
  assert.doesNotMatch(fineHtml, /极值变化幅度/);
  assert.doesNotMatch(fineHtml, /0\.033868/);

  const zeroNoiseScan: SpatialComparison = {
    comparisonId: 'scan',
    inputSnapshot: input,
    elementId: input.elements[0].id,
    field: 'beamRadiusMm',
    rows: [
      { value: 200, screens: [{ ...screen('A', null, 1), footprintRadiusMm: 0.25 }], warnings: [], error: null },
      { value: 250, screens: [{ ...screen('A', null, 1), footprintRadiusMm: 2.93e-14 }], warnings: [], error: null },
      { value: 450, screens: [{ ...screen('A', null, 1), footprintRadiusMm: 1.0 }], warnings: [], error: null },
    ],
  };
  const noiseHtml = render({ ...shared, reference: reference('comparison'), kind: 'comparison', data: zeroNoiseScan });
  assert.match(noiseHtml, /0 mm/);
  assert.match(noiseHtml, /1 mm/);
  assert.doesNotMatch(noiseHtml, /2\.93e-11|3\.41e\+13/);

  const coarse = { ...shared, id: 'coarse', reference: reference('comparison'), kind: 'comparison' as const, data: zeroNoiseScan };
  const fine = { ...shared, id: 'fine', reference: reference('comparison'), kind: 'comparison' as const, data: fineMicroScan };
  assert.match(artifactOptionLabel(coarse, [coarse, fine]), /200 → 450/);
  assert.match(artifactOptionLabel(fine, [coarse, fine]), /240 → 260/);

  const ticks = niceAxisRange(33.868, 1000, 3);
  assert.deepEqual(ticks.ticks, [0, 500, 1000]);

  const rawCsv = comparisonCSV(fineMicroScan);
  assert.match(rawCsv, /高斯半径_mm/);
  assert.match(rawCsv, /0\.033868/);

  const linkedHtml = renderToStaticMarkup(
    <ResearchResults
      artifact={{ ...shared, reference: reference('comparison'), kind: 'comparison', data: fineMicroScan }}
      onOpenBuilder={() => {}}
      onOpenFormula={() => {}}
    />,
  );
  assert.match(linkedHtml, /class="rw-formula-card is-clickable"/);
  assert.match(linkedHtml, /代入计算/);
  assert.match(linkedHtml, /参数代入与估算/);
  assert.match(linkedHtml, /像方束腰坐标/);
  assert.match(linkedHtml, /class="rw-result-min"/);
  assert.match(linkedHtml, /<span class="rw-table-tag">最小<\/span>/);
  assert.match(linkedHtml, /class="katex"/);
  assert.doesNotMatch(linkedHtml, /去公式库代入：高斯光束传播半径/);

  const thickInput = {
    ...input,
    elements: [
      input.elements[0],
      makeSpatialElement('biconvex-lens', [200, 60, 0]),
      input.elements[2],
    ],
  };
  const thickFormula = resolveArtifactFormulas(
    { ...shared, input: thickInput, reference: reference('simulation'), kind: 'simulation', data: { revision: 0, inputSnapshot: thickInput, model: 'record', segments: [], beams: [], screens: [screen('A', null, 1)], warnings: [], assumptions: [], chiefHitIds: [] } },
    'footprintRadiusMm',
  );
  assert.equal(thickFormula.expressions[0].title, '厚透镜制造者公式');
  assert.equal(thickFormula.expressions[0].preset?.knowledgeId, 'lensmaker-thick');
  assert.equal(
    shortRecordTitle({
      id: 'rec',
      requestId: 'r',
      title: '高斯光束单透镜聚焦：光斑沿轴先缩后涨 · Z位置（mm）比较',
      createdAt: '2026-10-01T00:00:00Z',
      primaryId: 'p',
      artifacts: [{ ...shared, id: 'p', reference: reference('comparison'), kind: 'comparison', data: { ...fineMicroScan, field: 'z' } }],
    }),
    'Z位置比较',
  );
});

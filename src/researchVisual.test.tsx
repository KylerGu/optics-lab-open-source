import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeSpatialElement, spatialTemplate, type SpatialResult } from './builderModel';
import { buildVisualHandoffPrompt, resolveComparisonGuide, validateVisualActions, visualComparisonStatus, sameVisualSnapshot, type ResearchVisualAction } from './researchVisual';
import { InquiryComparisonView, imagingDeltaSummary, powerDeltaSummary, spotDeltaSummary } from './InquiryComparison';
import { cleanElementDisplayName } from './researchUnits';
import ResearchVisualActions from './ResearchVisualActions';
import type { ResearchReply } from './researchSession';
import { newResearchProject, parseResearchStorage } from './researchSession';
import type { ResearchObject } from './researchObjects';

const base = spatialTemplate('focus'), screen = base.elements.find(e => e.kind === 'screen')!, lens = base.elements.find(e => e.kind === 'lens')!;
const action: ResearchVisualAction = {objectId:'a', elementId:screen.id, kind:'compare', field:'x', screenId:screen.id, explanation:'只移动屏，观察光斑。'};
test('visual actions validate object, element, field and observation screen, old replies stay compatible',()=>{
  const objects=[{id:'a',experiment:base}];
  assert.deepEqual(validateVisualActions(undefined,objects),[]);
  assert.deepEqual(validateVisualActions([action],objects),[action]);
  for(const patch of [{objectId:'wrong'},{elementId:'missing'},{field:'focalLengthMm'},{screenId:lens.id},{kind:'locate'},{field:'__proto__'}])assert.throws(()=>validateVisualActions([{...action,...patch}],objects));
});
test('comparison distinguishes unchanged, single variable, extra changes, deletion and undo',()=>{
  const current=structuredClone(base);
  assert.equal(visualComparisonStatus(base,current,action),'unchanged');
  current.elements.find(e=>e.id===screen.id)!.position[0]+=20;
  assert.equal(visualComparisonStatus(base,current,action),'single');
  current.elements.find(e=>e.id===lens.id)!.focalLengthMm+=10;
  assert.equal(visualComparisonStatus(base,current,action),'multiple');
  current.elements=current.elements.filter(e=>e.id!==screen.id);
  assert.equal(visualComparisonStatus(base,current,action),'missing');
  assert.equal(visualComparisonStatus(base,structuredClone(base),action),'unchanged');
});
test('guided links are absent for ordinary replies and disabled for replaced or removed objects',()=>{
  const object: ResearchObject={id:'a',experiment:base,source:'draft',sourceId:'draft',label:'示范装置',snapshotAt:new Date().toISOString()};
  const reply: ResearchReply={requestId:'r',inputSnapshot:base,answer:'可以直接看画面。',trace:[],plan:[],evidence:null,comparisons:[],designs:[],studies:[],visualActions:[action],objectSnapshots:[object]};
  const render=(objects:ResearchObject[],r=reply)=>renderToStaticMarkup(<ResearchVisualActions reply={r} objects={objects} disabled={false} onOpen={()=>{throw new Error('render must never navigate');}}/>);
  assert.equal(render([object],{...reply,visualActions:[]}), '');
  assert.match(render([object]),/前后对照/);
  assert.doesNotMatch(render([object]),/disabled/);
  assert.match(render([]),/disabled/);
  const changed=structuredClone(base);changed.elements[0].position[0]+=1;
  assert.equal(sameVisualSnapshot(base,changed),false);
  const updatedHtml=render([{...object,experiment:changed}]);
  assert.match(updatedHtml,/按本轮原装置打开验证/);
  assert.match(updatedHtml,/用当前光路继续/);
  assert.doesNotMatch(updatedHtml,/disabled/);
  const removedScreen={...changed,elements:changed.elements.filter(e=>e.kind!=='screen')};
  const removedScreenHtml=render([{...object,experiment:removedScreen}]);
  assert.match(removedScreenHtml,/按本轮原装置打开验证/);
  assert.doesNotMatch(removedScreenHtml,/用当前光路继续/);
});
test('visual links survive storage reload with the original object snapshot',()=>{
  const p=newResearchProject(), object: ResearchObject={id:'a',experiment:base,source:'draft',sourceId:'draft',label:'示范',snapshotAt:p.createdAt};
  p.objects=[object];p.activeObjectId='a';
  const reply: ResearchReply={requestId:'r',inputSnapshot:base,answer:'可按需打开。',trace:[],plan:[],evidence:null,comparisons:[],designs:[],studies:[],visualActions:[action],objectSnapshots:[object],activeObjectId:'a',objectComparisons:[],objectResults:[{objectId:'a',inputSnapshot:base,evidence:null,comparisons:[],designs:[],studies:[]}]};
  p.turns=[{id:'r',prompt:'我想移动屏看看。',createdAt:p.createdAt,error:null,reply}];
  const restored=parseResearchStorage(JSON.parse(JSON.stringify({schemaVersion:2,selectedId:p.id,projects:[p]})));
  assert.deepEqual(restored.projects[0].turns[0].reply?.visualActions,[action]);
  assert.equal(sameVisualSnapshot(restored.projects[0].turns[0].reply!.inputSnapshot!,base),true);
});

test('old duplicate buttons merge despite different descriptions while distinct controls remain',()=>{
  const object: ResearchObject={id:'a',experiment:base,source:'draft',sourceId:'draft',label:'示范',snapshotAt:new Date().toISOString()};
  const locate: ResearchVisualAction={objectId:'a',elementId:screen.id,kind:'locate',field:null,screenId:null,explanation:'自动说明'};
  const reply: ResearchReply={requestId:'r',inputSnapshot:base,answer:'观察屏',trace:[],plan:[],evidence:null,comparisons:[],designs:[],studies:[],visualActions:[locate,{...locate,explanation:'助手补充说明'},action,{...action,field:'y'}],objectSnapshots:[object]};
  const html=renderToStaticMarkup(<ResearchVisualActions reply={reply} objects={[object]} disabled={false} onOpen={()=>{}}/>);
  assert.equal((html.match(/<button/g)??[]).length,3);
  assert.doesNotMatch(html,/自动说明/);
  assert.match(html,/助手补充说明/);
  assert.match(html,/X · 前后/);
  assert.match(html,/Y · 高度/);

  assert.equal(spotDeltaSummary(0.033868, 0.033868, true).text, '拖动滑杆开始对比');
  assert.match(spotDeltaSummary(0.033868, 1.0, false).text, /扩大 29\.5×/);
  assert.match(spotDeltaSummary(0.5, 0.2, false).text, /缩小 60%/);
});

test('cleanElementDisplayName strips redundant mobility hints while preserving physical specs', () => {
  assert.equal(cleanElementDisplayName('探测屏（可沿光轴移动）'), '探测屏');
  assert.equal(cleanElementDisplayName('探测屏 (可延光轴移动)'), '探测屏');
  assert.equal(cleanElementDisplayName('会聚透镜 f=100mm（可移动）'), '会聚透镜 f=100mm');
  assert.equal(cleanElementDisplayName('会聚透镜 f=100mm'), '会聚透镜 f=100mm');

  const verbose = structuredClone(base);
  verbose.elements.find(e => e.id === screen.id)!.name = '探测屏（可沿光轴移动）';
  const obj: ResearchObject = { id: 'a', experiment: verbose, source: 'draft', sourceId: 'draft', label: '示范', snapshotAt: new Date().toISOString() };
  const reply: ResearchReply = { requestId: 'r', inputSnapshot: verbose, answer: '移动屏', trace: [], plan: [], evidence: null, comparisons: [], designs: [], studies: [], visualActions: [action], objectSnapshots: [obj] };
  const html = renderToStaticMarkup(<ResearchVisualActions reply={reply} objects={[obj]} disabled={false} onOpen={() => {}}/>);
  assert.match(html, /<strong>探测屏 · X · 前后<\/strong>/);
  assert.doesNotMatch(html, /可沿光轴移动/);
});

test('resolveComparisonGuide enables live comparison for adjust on Gaussian screen and buildVisualHandoffPrompt reports multi-field diffs', () => {
  const adjustGuide = { action: { ...action, kind: 'adjust' as const, screenId: null }, snapshot: base };
  const resolved = resolveComparisonGuide(adjustGuide);
  assert.equal(resolved?.action.screenId, screen.id);

  const singleEdit = structuredClone(base);
  singleEdit.elements.find(e => e.id === screen.id)!.position[0] = 350;
  const singleText = buildVisualHandoffPrompt(adjustGuide, singleEdit, null);
  assert.match(singleText ?? '', /把「.*」的X · 前后从 380 mm 调到了 350 mm/);

  const multiEdit = structuredClone(singleEdit);
  multiEdit.elements.find(e => e.id === screen.id)!.position[1] = 45;
  const multiText = buildVisualHandoffPrompt(adjustGuide, multiEdit, null);
  assert.match(multiText ?? '', /X · 前后 380→350 mm/);
  assert.match(multiText ?? '', /Y · 高度 60→45 mm/);
});

test('expanded visual coverage supports polarizer, slit, spherical lens, laser and handoff unit formatting', () => {
  const rich = structuredClone(base);
  const laser = rich.elements.find(e => e.kind === 'laser')!;
  const pol = makeSpatialElement('polarizer', [120, 60, 0]);
  const slit = makeSpatialElement('slit', [160, 60, 0]);
  const sph = makeSpatialElement('biconvex-lens', [200, 60, 0]);
  rich.elements = [laser, pol, slit, sph, rich.elements.find(e => e.kind === 'screen')!];

  const polAction: ResearchVisualAction = {
    objectId: 'a',
    elementId: pol.id,
    kind: 'adjust',
    field: 'rollDeg',
    screenId: null,
    explanation: '转动偏振片透光轴角度。',
  };
  const slitAction: ResearchVisualAction = {
    objectId: 'a',
    elementId: slit.id,
    kind: 'adjust',
    field: 'slitWidthMm',
    screenId: null,
    explanation: '改变狭缝宽度。',
  };
  const sphAction: ResearchVisualAction = {
    objectId: 'a',
    elementId: sph.id,
    kind: 'adjust',
    field: 'frontRadiusMm',
    screenId: null,
    explanation: '调节前表面曲率半径。',
  };

  const validated = validateVisualActions([polAction, slitAction, sphAction], [{ id: 'a', experiment: rich }]);
  assert.equal(validated.length, 3);
  assert.throws(() =>
    validateVisualActions([{ ...slitAction, elementId: laser.id }], [{ id: 'a', experiment: rich }]),
  );

  const rotated = structuredClone(rich);
  rotated.elements.find(e => e.id === pol.id)!.rollDeg = 45;
  const polPrompt = buildVisualHandoffPrompt({ action: polAction, snapshot: rich }, rotated, null);
  assert.match(polPrompt ?? '', /轴向转角从 0° 调到了 45°/);
  assert.doesNotMatch(polPrompt ?? '', /0 mm/);

  const multiChanged = structuredClone(rich);
  multiChanged.elements.find(e => e.id === slit.id)!.slitWidthMm = 0.08;
  multiChanged.elements.find(e => e.id === sph.id)!.frontRadiusMm = 80;
  multiChanged.elements.find(e => e.id === laser.id)!.beamModel = 'parallel';
  const multiPrompt = buildVisualHandoffPrompt({ action: slitAction, snapshot: rich }, multiChanged, null);
  assert.match(multiPrompt ?? '', /狭缝宽度/);
  assert.match(multiPrompt ?? '', /前表面曲率半径/);
  assert.match(multiPrompt ?? '', /几何光束/);

  const removedGuided = structuredClone(rich);
  removedGuided.elements = removedGuided.elements.filter(e => e.id !== pol.id);
  const removedPrompt = buildVisualHandoffPrompt({ action: polAction, snapshot: rich }, removedGuided, null);
  assert.match(removedPrompt ?? '', /移除了「偏振片」/);
});

test('universal InquiryComparison supports power-meter, imaging, and geometric modes alongside Gaussian', () => {
  const pmTemplate = spatialTemplate('focus');
  const pmLaser = pmTemplate.elements.find(e => e.kind === 'laser')!;
  pmLaser.beamModel = 'parallel';
  pmLaser.powerMw = 10;
  pmLaser.polarization = 'linear';
  pmLaser.polarizationDeg = 0;
  const pol = makeSpatialElement('polarizer', [120, 60, 0]);
  const pm = makeSpatialElement('power-meter', [250, 60, 0]);
  pmTemplate.elements = [pmLaser, pol, pm];

  const pmAdjust: ResearchVisualAction = {
    objectId: 'a',
    elementId: pol.id,
    kind: 'adjust',
    field: 'rollDeg',
    screenId: null,
    explanation: '转动偏振片观察功率变化。',
  };
  const resolvedPm = resolveComparisonGuide({ action: pmAdjust, snapshot: pmTemplate });
  assert.equal(resolvedPm?.action.screenId, pm.id);

  const rotatedPm = structuredClone(pmTemplate);
  rotatedPm.elements.find(e => e.id === pol.id)!.rollDeg = 60;
  const pmBefore: SpatialResult = {
    revision: 0, inputSnapshot: pmTemplate, model: 'test', segments: [], beams: [],
    screens: [{ elementId: pm.id, name: pm.name, hits: 20, sampledPowerFraction: 1, sampledPowerMw: 10, centroid: null, footprintRadiusMm: null, gaussianRadiusMm: null, detectorKind: 'power-meter', readingMw: 10, overRange: false }],
    warnings: [], assumptions: [], chiefHitIds: [],
  };
  const pmAfter: SpatialResult = {
    revision: 1, inputSnapshot: rotatedPm, model: 'test', segments: [], beams: [],
    screens: [{ elementId: pm.id, name: pm.name, hits: 20, sampledPowerFraction: 0.25, sampledPowerMw: 2.5, centroid: null, footprintRadiusMm: null, gaussianRadiusMm: null, detectorKind: 'power-meter', readingMw: 2.5, overRange: false }],
    warnings: [], assumptions: [], chiefHitIds: [],
  };
  const pmHtml = renderToStaticMarkup(
    <InquiryComparisonView
      guide={resolvedPm!}
      experiment={rotatedPm}
      beforeResult={pmBefore}
      beforeLoading={false}
      beforeError={null}
      onBeforeRetry={() => {}}
      result={pmAfter}
      pending={false}
      error={null}
      retry={() => {}}
    />,
  );
  assert.match(pmHtml, /光功率读数对照/);
  assert.match(pmHtml, /10 mW/);
  assert.match(pmHtml, /2\.5 mW/);
  assert.match(pmHtml, /衰减 75%/);
  assert.match(powerDeltaSummary(2.5, 5, false).text, /增强 2×/);

  const imgTemplate = spatialTemplate('imaging');
  const imgObj = imgTemplate.elements.find(e => e.kind === 'object')!;
  const imgLens = imgTemplate.elements.find(e => e.kind === 'lens')!;
  const imgScreen = imgTemplate.elements.find(e => e.kind === 'screen')!;
  const imgAdjust: ResearchVisualAction = {
    objectId: 'a',
    elementId: imgScreen.id,
    kind: 'adjust',
    field: 'x',
    screenId: null,
    explanation: '移动观察屏对焦。',
  };
  const resolvedImg = resolveComparisonGuide({ action: imgAdjust, snapshot: imgTemplate });
  assert.equal(resolvedImg?.action.screenId, imgScreen.id);

  const focusedScreen = structuredClone(imgTemplate);
  focusedScreen.elements.find(e => e.id === imgScreen.id)!.position[0] += 10;
  const imgBeforeObs = { elementId: imgScreen.id, kind: 'screen' as const, focused: false, defocusMm: -10, magnification: -1, angularMagnification: null, fieldDiameterMm: null, adapterMagnification: 1, widthMm: 60, heightMm: 60, hits: [] };
  const imgAfterObs = { elementId: imgScreen.id, kind: 'screen' as const, focused: true, defocusMm: 0, magnification: -1, angularMagnification: null, fieldDiameterMm: null, adapterMagnification: 1, widthMm: 60, heightMm: 60, hits: [] };
  const imgBefore: SpatialResult = {
    revision: 0, inputSnapshot: imgTemplate, model: 'test', segments: [], beams: [], screens: [], warnings: [], assumptions: [], chiefHitIds: [],
    imaging: [{ objectId: imgObj.id, objectPaths: [], segments: [], stages: [{ lensId: imgLens.id, kind: 'real', distanceMm: 200, magnification: -1, heightMm: -10, position: [400, 60, 0], paths: [], visible: true }], observations: [imgBeforeObs], warnings: [] }],
  };
  const imgAfter: SpatialResult = {
    revision: 1, inputSnapshot: focusedScreen, model: 'test', segments: [], beams: [], screens: [], warnings: [], assumptions: [], chiefHitIds: [],
    imaging: [{ objectId: imgObj.id, objectPaths: [], segments: [], stages: [{ lensId: imgLens.id, kind: 'real', distanceMm: 200, magnification: -1, heightMm: -10, position: [400, 60, 0], paths: [], visible: true }], observations: [imgAfterObs], warnings: [] }],
  };
  const imgHtml = renderToStaticMarkup(
    <InquiryComparisonView
      guide={resolvedImg!}
      experiment={focusedScreen}
      beforeResult={imgBefore}
      beforeLoading={false}
      beforeError={null}
      onBeforeRetry={() => {}}
      result={imgAfter}
      pending={false}
      error={null}
      retry={() => {}}
    />,
  );
  assert.match(imgHtml, /成像对焦对照/);
  assert.match(imgHtml, /未对焦/);
  assert.match(imgHtml, /已对焦/);
  assert.match(imgHtml, /已调至合焦/);
  assert.equal(imagingDeltaSummary(imgBeforeObs, imgAfterObs, false).text, '已调至合焦');

  const geoTemplate = spatialTemplate('focus');
  geoTemplate.elements.find(e => e.kind === 'laser')!.beamModel = 'parallel';
  const geoScreen = geoTemplate.elements.find(e => e.kind === 'screen')!;
  const geoLens = geoTemplate.elements.find(e => e.kind === 'lens')!;
  const geoGuide = resolveComparisonGuide({
    action: { objectId: 'a', elementId: geoLens.id, kind: 'adjust', field: 'focalLengthMm', screenId: null, explanation: '改变透镜焦距。' },
    snapshot: geoTemplate,
  });
  const geoAfterExp = structuredClone(geoTemplate);
  geoAfterExp.elements.find(e => e.id === geoLens.id)!.focalLengthMm = 150;
  const geoBefore: SpatialResult = {
    revision: 0, inputSnapshot: geoTemplate, model: 'test', segments: [], beams: [],
    screens: [{ elementId: geoScreen.id, name: geoScreen.name, hits: 20, sampledPowerFraction: 1, sampledPowerMw: 1, centroid: null, footprintRadiusMm: 2.0, gaussianRadiusMm: null }],
    warnings: [], assumptions: [], chiefHitIds: [],
  };
  const geoAfter: SpatialResult = {
    revision: 1, inputSnapshot: geoAfterExp, model: 'test', segments: [], beams: [],
    screens: [{ elementId: geoScreen.id, name: geoScreen.name, hits: 20, sampledPowerFraction: 1, sampledPowerMw: 1, centroid: null, footprintRadiusMm: 1.0, gaussianRadiusMm: null }],
    warnings: [], assumptions: [], chiefHitIds: [],
  };
  const geoHtml = renderToStaticMarkup(
    <InquiryComparisonView
      guide={geoGuide!}
      experiment={geoAfterExp}
      beforeResult={geoBefore}
      beforeLoading={false}
      beforeError={null}
      onBeforeRetry={() => {}}
      result={geoAfter}
      pending={false}
      error={null}
      retry={() => {}}
    />,
  );
  assert.match(geoHtml, /几何光斑覆盖对照/);
  assert.match(geoHtml, /2 mm/);
  assert.match(geoHtml, /1 mm/);
  assert.match(geoHtml, /缩小 50%/);
});

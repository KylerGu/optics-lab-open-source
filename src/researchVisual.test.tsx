import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeSpatialElement, spatialTemplate } from './builderModel';
import { buildVisualHandoffPrompt, resolveComparisonGuide, validateVisualActions, visualComparisonStatus, sameVisualSnapshot, type ResearchVisualAction } from './researchVisual';
import { spotDeltaSummary } from './InquiryComparison';
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

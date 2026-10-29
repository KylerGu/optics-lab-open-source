import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { spatialTemplate } from './builderModel';
import { validateVisualActions, visualComparisonStatus, sameVisualSnapshot, type ResearchVisualAction } from './researchVisual';
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
  assert.match(render([{...object,experiment:changed}]),/装置已更新或移除/);
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
});

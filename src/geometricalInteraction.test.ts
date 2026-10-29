import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultScene,SCENE_DEFINITIONS,sceneKey} from './sceneRuntime';
import {immediateScene} from './sceneImmediate';
import {geometricalAnswerQuantities,supportsGeometricalInteraction} from './geometricalAnswerQuantities';
import {emptySceneInteraction,recordSceneChange,inspectSceneComparison,restoreSceneComparison,changeForSnapshot} from './sceneInteraction';
import {comparisonColumns} from './sceneComparisonColumns';
import {cameraAnnotationKeys,cameraAnnotationVisible,cameraStudyQuantities} from './cameraAnnotations';

test('camera answers share the current diagram list, names, symbols and visibility',()=>{
  for(const study of [0,1,2,3]){
    const state=defaultScene('instruments-2');state.parameters.study=study;
    const result=immediateScene(state)!,selection={selected:new Set<string>(),toggle:()=>{}};
    const links=geometricalAnswerQuantities(state,state,result,selection);
    assert.deepEqual(links.map(q=>q.id),cameraAnnotationKeys(study));
    for(const q of links){
      const metadata=cameraStudyQuantities(study)[q.id];
      if(metadata){assert.equal(q.label,metadata.label);assert.ok(q.symbols?.includes(metadata.symbol));assert.equal(q.color,metadata.color);}
      const metric=result.metrics.find(m=>m.key===q.id);
      if(metric)assert.ok(q.terms.includes(metric.label.replace(/\s+[|A-Za-zλθΔβη].*$/u,'')));
    }
    if(study===2){assert.ok(links.find(q=>q.id==='depth')!.symbols!.includes('\\Delta D'));assert.ok(links.find(q=>q.id==='farDepth')!.symbols!.includes('D_f'));}
    if(study===3)assert.ok(links.find(q=>q.id==='airyDiameter')!.symbols!.includes('d_a'));
  }
  assert.equal(cameraAnnotationVisible(1,'sensorW','sample'),false);
  assert.equal(cameraAnnotationVisible(1,'fieldWidth','sample'),true);
  assert.equal(cameraAnnotationVisible(1,'sensorW','sensor'),true);
  assert.equal(cameraAnnotationVisible(1,'fieldWidth','sensor'),false);
});

const ids=Object.keys(SCENE_DEFINITIONS).filter(id=>supportsGeometricalInteraction(id)&&id!=='instruments-0');
test('all ten other imaging scenes reuse changes, comparison viewing and restoration',()=>{
  assert.equal(ids.length,10);
  for(const id of ids){
    const baseline=defaultScene(id),field=SCENE_DEFINITIONS[id].parameters.find(p=>!p.options&&p.default+p.step<=p.max)!;
    const changed={...baseline,parameters:{...baseline.parameters,[field.key]:field.default+field.step}};
    const record=recordSceneChange(emptySceneInteraction(),baseline,changed,'user');
    assert.equal(changeForSnapshot(record.recentChange,changed)?.after.parameters[field.key],changed.parameters[field.key]);
    assert.equal(changeForSnapshot(record.recentChange,baseline),null);
    const preview=inspectSceneComparison(record,changed,baseline,'first');
    const preview2=inspectSceneComparison(preview,changed,changed,'second');
    assert.deepEqual(restoreSceneComparison(preview2).recentChange?.after,changed);
    assert.deepEqual(preview2.comparison?.baseline,changed);
    assert.equal(sceneKey(baseline),sceneKey(defaultScene(id)));
  }
});

test('answer links toggle the existing selection without changing physical parameters across all views',()=>{
  for(const id of ids)for(const study of /^instruments-/.test(id)?[0,1,2,3]:[0]){
    const state=defaultScene(id);if('study' in state.parameters)state.parameters.study=study;
    const before=sceneKey(state),selected=new Set<string>();
    const selection={selected,toggle:(key:string)=>{if(selected.has(key))selected.delete(key);else selected.add(key);}};
    const resolve=()=>geometricalAnswerQuantities(state,state,immediateScene(state),selection);
    const links=resolve();assert.ok(links.length>0,`${id}/${study}`);
    for(const link of links){
      assert.ok(link.label&&!/[a-z]{5}/.test(link.label),link.label);
      link.onToggle();assert.equal(resolve().find(q=>q.id===link.id)?.selected,true);
      link.onToggle();assert.equal(selected.size,0);
    }
    assert.equal(sceneKey(state),before);
  }
});

test('links reject foreign views, undefined geometry and provider-specific unavailable marks',()=>{
  const lens=defaultScene('paraxial-0');lens.parameters.u=lens.parameters.f;
  const selection={selected:new Set<string>(),toggle:()=>{}};
  const links=geometricalAnswerQuantities(lens,lens,immediateScene(lens),selection);
  assert.ok(!links.some(q=>['v','imageHeight','m'].includes(q.id)));
  const tir=defaultScene('reflection-refraction-1');Object.assign(tir.parameters,{n1:1.5,n2:1,angle:60});
  assert.ok(!geometricalAnswerQuantities(tir,tir,immediateScene(tir),selection).some(q=>q.id==='transmittedAngle'));
  const telescope=defaultScene('instruments-1'),old=structuredClone(telescope);telescope.parameters.study=2;
  assert.deepEqual(geometricalAnswerQuantities(old,telescope,immediateScene(telescope),selection),[]);
  assert.deepEqual(geometricalAnswerQuantities(telescope,telescope,immediateScene(telescope),{...selection,canMark:()=>false}),[]);
  assert.deepEqual(geometricalAnswerQuantities(telescope,lens,immediateScene(lens),selection),[]);
});

test('comparison tables show only relevant results for the current study with symbols',()=>{
  for(const id of ids)for(const study of /^instruments-/.test(id)?[0,1,2,3]:[0]){
    const state=defaultScene(id);if('study' in state.parameters)state.parameters.study=study;
    const result=immediateScene(state)!;
    const field=SCENE_DEFINITIONS[id].parameters.find(p=>!p.options)!.key;
    const columns=comparisonColumns({field,rows:[{value:state.parameters[field],result}]});
    assert.ok(columns.length>0&&columns.length<=3,`${id}/${study}`);
    assert.ok(columns.every(c=>c.key!==field&&!['matrixB','matrixD'].includes(c.key)));
    assert.ok(columns.every(c=>/[A-Za-zθδΔηβ]/.test(c.label)),columns.map(c=>c.label).join(','));
    for(const column of columns)assert.ok(column.value(result)===null||Number.isFinite(column.value(result)));
  }
});

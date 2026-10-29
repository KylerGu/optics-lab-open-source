import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSpatialElement, parseSpatial, type SpatialExperiment } from './builderModel';
import { validateSpatialAgentReply, requestSpatialAgent } from './spatialAgent';

const input=parseSpatial({schemaVersion:2,name:'装置',elements:[]});
const reply=(experiment:SpatialExperiment=input)=>({requestId:'turn',inputSnapshot:input,experiment,changed:experiment!==input,applyAllowed:false,answer:'方案说明',trace:[],checks:[],evidence:null});

test('ideal lens focal checks validate the configured focal length without replacing its model',()=>{
  for(const kind of ['lens','cylindrical-lens'] as const)for(const focal of [80,-80]){
    const lens={...makeSpatialElement(kind,[100,60,0]),focalLengthMm:focal};
    const experiment={...input,elements:[lens]};
    for(const metric of ['lens_focal_mm','lens_back_focal_mm']){
      const criterion={label:'焦距',metric,elementId:lens.id,operator:'eq',value:focal,tolerance:0,radiusModel:'sampled'};
      const document={...reply(experiment),checks:[{criterion,actual:focal,passed:true}]};
      assert.doesNotThrow(()=>validateSpatialAgentReply(document,'turn',input));
      assert.throws(()=>validateSpatialAgentReply({...document,checks:[{criterion,actual:focal+1,passed:true}]},'turn',input),/焦距/);
    }
  }
});

test('power-meter comparison preserves overload and distinguishes nonincreasing from mixed trends',()=>{
  const meter=makeSpatialElement('power-meter',[200,60,0]),laser=makeSpatialElement('laser',[0,60,0]);
  const snapshot={schemaVersion:2 as const,name:'功率扫描',elements:[laser,meter]};
  const read=(value:number)=>({elementId:meter.id,name:meter.name,hits:1,sampledPowerFraction:1,sampledPowerMw:value,centroid:meter.position,footprintRadiusMm:0,gaussianRadiusMm:null,detectorKind:'power-meter',readingMw:value,overRange:false});
  const comparison={comparisonId:'comparison-1',inputSnapshot:snapshot,elementId:laser.id,field:'powerMw',rows:[1,2,3].map((value,i)=>({value,screens:[read([3,2,1][i])],warnings:[],error:null}))};
  const criterion={label:'功率单调不增',elementId:meter.id,metric:'comparison_nonincreasing',comparisonId:'comparison-1',measurement:'meter_reading_mw',operator:'eq',value:1,tolerance:0,radiusModel:'sampled'};
  const document={...reply(),comparisons:[comparison],checks:[{criterion,actual:1,passed:true}]};
  assert.doesNotThrow(()=>validateSpatialAgentReply(document,'turn',input));
  const mixed=structuredClone(document);mixed.comparisons[0].rows[1].screens[0]=read(.5);assert.throws(()=>validateSpatialAgentReply(mixed,'turn',input));
  const forged=structuredClone(document);forged.comparisons[0].rows[1].screens[0].readingMw=20;assert.throws(()=>validateSpatialAgentReply(forged,'turn',input));
});
test('new agent rejects stale input, incorrect identity and unsupported apparatus',()=>{
  assert.throws(()=>validateSpatialAgentReply({...reply(),requestId:'old'},'turn',input));
  assert.throws(()=>validateSpatialAgentReply({...reply(),inputSnapshot:{...input,name:'other'}},'turn',input));
  assert.throws(()=>validateSpatialAgentReply({...reply(),experiment:{...input,elements:[{id:'a',kind:'prism'}]}},'turn',input));
  assert.throws(()=>validateSpatialAgentReply({...reply(),changed:true},'turn',input));
});
test('no edited plan can apply without physical evidence and goal checks',()=>{
  const proposal=parseSpatial({...input,name:'新方案'});
  assert.throws(()=>validateSpatialAgentReply({...reply(proposal),applyAllowed:true},'turn',input));
  assert.equal(validateSpatialAgentReply(reply(proposal),'turn',input).applyAllowed,false);
});
test('claimed successful numeric comparison is independently checked',()=>{
  const criterion={label:'功率≥5mW',elementId:'p',metric:'screen_power_mw',operator:'ge',value:5,tolerance:0,radiusModel:'sampled'};
  assert.throws(()=>validateSpatialAgentReply({...reply(),checks:[{criterion,actual:2,passed:true}]},'turn',input));
  assert.throws(()=>validateSpatialAgentReply({...reply(),checks:[{criterion,actual:null,passed:true}]},'turn',input));
  assert.equal(validateSpatialAgentReply({...reply(),checks:[{criterion,actual:2,passed:false}]},'turn',input).checks[0].passed,false);
});
test('direction radius and polarization goals must agree with physical detector evidence',()=>{
  const screen=makeSpatialElement('screen',[200,60,0]),experiment={...input,elements:[screen]};
  const evidence={revision:0,inputSnapshot:experiment,model:'test',segments:[],beams:[],screens:[{elementId:screen.id,name:screen.name,hits:1,sampledPowerFraction:1,sampledPowerMw:10,centroid:screen.position,footprintRadiusMm:4,gaussianRadiusMm:null,sampledRadiusUMm:0,sampledRadiusVMm:4,polarizationStokes:{s1:0,s2:0,s3:1}}],warnings:[],assumptions:[],chiefHitIds:[]};
  for(const [metric,value] of [['polarization_s3',1],['screen_radius_u_mm',0],['screen_radius_v_mm',4]] as const){
    const criterion={label:'新器材目标',metric,elementId:screen.id,operator:'eq',value,tolerance:0,radiusModel:'sampled'};
    const response={...reply(experiment),applyAllowed:true,evidence,checks:[{criterion,actual:value,passed:true}]};
    assert.doesNotThrow(()=>validateSpatialAgentReply(response,'turn',input));
    assert.throws(()=>validateSpatialAgentReply({...response,checks:[{criterion:{...criterion,value:value+.5},actual:value+.5,passed:true}]},'turn',input));
    assert.throws(()=>validateSpatialAgentReply({...response,evidence:null},'turn',input));
  }
});
test('stream handles split UTF-8 chunks and reports actual steps',async()=>{
  const old=globalThis.fetch;
  const encoded=new TextEncoder().encode(JSON.stringify({type:'progress',step:{name:'trace_light',status:'ok',summary:'仿真核对'}})+'\n'+JSON.stringify({type:'reply',reply:reply()})+'\n');
  globalThis.fetch=async()=>new Response(new ReadableStream({start(c){for(let i=0;i<encoded.length;i+=5)c.enqueue(encoded.slice(i,i+5));c.close();}}));
  try{const steps:string[]=[];const result=await requestSpatialAgent('turn',input,'搭建',[],new AbortController().signal,s=>steps.push(s.summary));assert.deepEqual(steps,['仿真核对']);assert.equal(result.answer,'方案说明');}finally{globalThis.fetch=old;}
});
test('truncated stream or error does not return a partially received proposal',async()=>{
  const old=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response(JSON.stringify({type:'reply',reply:reply()}));
    await assert.rejects(requestSpatialAgent('turn',input,'搭建',[],new AbortController().signal,()=>{}),/完整/);
    globalThis.fetch=async()=>new Response(JSON.stringify({type:'error',message:'未完成'})+'\n');
    await assert.rejects(requestSpatialAgent('turn',input,'搭建',[],new AbortController().signal,()=>{}),/未完成/);
  }finally{globalThis.fetch=old;}
});

test('comparison conclusions need matching real rows and cannot spoof variation',()=>{
  const experiment=parseSpatial({schemaVersion:2,name:'比较',elements:[
    {id:'source',name:'光源',kind:'laser',position:[0,60,0],yawDeg:0,pitchDeg:0,diameterMm:40,focalLengthMm:100,beamRadiusMm:4,wavelengthNm:532,transmission:1},
    {id:'screen',name:'屏',kind:'screen',position:[200,60,0],yawDeg:0,pitchDeg:0,diameterMm:40,focalLengthMm:100,beamRadiusMm:4,wavelengthNm:532,transmission:1},
  ]});
  const screen=(power:number)=>({elementId:'screen',name:'屏',hits:9,sampledPowerFraction:1,sampledPowerMw:power,centroid:[200,60,0],footprintRadiusMm:4,gaussianRadiusMm:null});
  const comparison={comparisonId:'comparison-1',inputSnapshot:experiment,elementId:'source',field:'powerMw',rows:[1,2,3].map(value=>({value,screens:[screen(value)],warnings:[],error:null}))};
  const criterion={label:'比较功率变化',metric:'comparison_span',elementId:'screen',operator:'ge',value:1,tolerance:0,radiusModel:'sampled',comparisonId:'comparison-1',measurement:'screen_power_mw'};
  const response={...reply(),inputSnapshot:experiment,experiment,comparisons:[comparison],checks:[{criterion,actual:2,passed:true}]};
  assert.equal(validateSpatialAgentReply(response,'turn',experiment).comparisons[0].rows.length,3);
  assert.throws(()=>validateSpatialAgentReply({...response,checks:[{criterion,actual:3,passed:true}]},'turn',experiment),/逐点/);
  assert.throws(()=>validateSpatialAgentReply({...response,comparisons:[]},'turn',experiment),/原始/);
  assert.throws(()=>validateSpatialAgentReply({...response,comparisons:[{...comparison,rows:[comparison.rows[1],comparison.rows[0],comparison.rows[2]]}]},'turn',experiment));
});

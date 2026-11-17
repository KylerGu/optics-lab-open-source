import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {makeSpatialElement,spatialTemplate,type SpatialResult} from './builderModel';
import {spatialResultNotes} from './spatialResultNotes';
import SpatialMeasurements, { builderStatusReadout } from './SpatialMeasurements';
import { resolveSpatialFormulas } from './researchFormulaLinks';

const result=():SpatialResult=>({revision:1,inputSnapshot:spatialTemplate('focus'),model:'test',segments:[],beams:[],screens:[],warnings:[],assumptions:['完整模型说明只保留在原始结果'],chiefHitIds:[]});
test('calculation notes describe only the apparatus present, with concise folded content',()=>{
  const r=result(),notes=spatialResultNotes(r),html=renderToStaticMarkup(<SpatialMeasurements result={r} onSelect={()=>{}}/>);
  assert.equal(notes.scope.length,2);assert.ok(notes.scope.every(text=>text.length<45));
  assert.ok(!notes.scope.join('').match(/棱镜|偏振|衍射|4f/));
  assert.ok(html.includes('<summary>计算说明</summary>'));assert.ok(!html.includes('完整模型说明'));
  assert.ok(!html.includes('<details class="sb-calculation-details" open'));
  assert.equal(r.assumptions[0],'完整模型说明只保留在原始结果');
});
test('known repeated envelope notices move into scope while failed or uncertain measurements remain visible',()=>{
  const r=result();r.inputSnapshot.elements[1]=makeSpatialElement('plano-convex-lens',[280,60,0]);
  r.warnings=['镜片之后显示实际曲面折射的几何光线；暂不计算实体透镜后的高斯包络。','功率计超过 1 mW 量程，请增大量程或降低入射功率。','光线尚未到达观察屏，请检查位置和朝向。','未知后端警告，请检查测量设置。'];
  const notes=spatialResultNotes(r);
  assert.equal(notes.warnings.length,3);assert.ok(notes.scope.some(text=>text.includes('实体透镜后不计算高斯包络')));
  assert.ok(!notes.scope.join('').includes('棱镜'));assert.ok(notes.warnings.includes(r.warnings[3]));
  const html=renderToStaticMarkup(<SpatialMeasurements result={r} onSelect={()=>{}}/>);
  assert.ok(html.includes('超过 1 mW 量程'));assert.ok(html.includes('光线尚未到达观察屏'));assert.ok(html.includes('未知后端警告'));
});
test('a failed wave calculation still says that only geometric rays are shown',()=>{
  const r=result();r.warnings=['当前装置不满足 4f 波动计算条件：检查共轴、等焦距、f / 2f / f 间距、输入束腰、通光口径及滤波片所在焦面；当前仅显示几何光路。'];
  const notes=spatialResultNotes(r);
  assert.equal(notes.warnings.length,1);assert.ok(notes.warnings[0].includes('仅显示几何光路'));
  for(const condition of ['共轴','等焦距','间距','束腰','口径','滤波片'])assert.ok(notes.warnings[0].includes(condition));
});
test('4f power notes keep wave integration distinct from geometric and standalone diffraction readings',()=>{
  const r=result();r.inputSnapshot.elements.push(makeSpatialElement('amplitude-grating'));
  r.fourF={screenId:'screen',sourceId:'source',gratingId:'grating',filterId:null,parameters:{wavelengthNm:532,periodMm:.15,waistMm:1,modulation:1,focalLengthMm:100,filterWidthUm:200,filterOffsetUm:0,filterMode:2,observationMm:0},transmission:1,pointIntensity:1,inputPowerMw:1,outputPowerMw:1,capturedPowerMw:1,points:[]};
  const notes=spatialResultNotes(r);
  assert.ok(notes.scope[0].includes('屏面积积分'));assert.ok(notes.scope.some(text=>text.includes('f / 2f / f')));
  assert.ok(!notes.scope.join('').includes('曲线与几何功率分开'));
});

test('screen cards show relevant physical metrics and omit algorithm/polarization clutter unless applicable',()=>{
  const r=result();
  const screenEl=r.inputSnapshot.elements.find(e=>e.kind==='screen')!;
  r.screens=[{
    elementId:screenEl.id,name:'探测屏（可沿光轴移动）',hits:21,sampledPowerFraction:1,sampledPowerMw:1,
    centroid:[250,60,0],footprintRadiusMm:0,gaussianRadiusMm:0.033868,
    sampledRadiusUMm:0,sampledRadiusVMm:0,
    polarizationStokes:{s1:-0.766,s2:-0.643,s3:0},
  }];
  const html=renderToStaticMarkup(<SpatialMeasurements result={r} onSelect={()=>{}}/>);
  assert.match(html,/33\.9 μm/);
  assert.doesNotMatch(html,/可沿光轴移动|命中光线|21 条|电场轨迹示意|S1 \/ S2|采样半径|光斑分布与偏振明细/);
  assert.match(html,/较入射光束.*聚焦压缩/);
  assert.match(html,/选中定位/);

  const withSplitter=structuredClone(r);
  withSplitter.inputSnapshot.elements.push(makeSpatialElement('splitter',[200,60,0]));
  withSplitter.screens[0].sampledPowerFraction=0.5;
  withSplitter.screens[0].sampledPowerMw=0.5;
  const splitHtml=renderToStaticMarkup(<SpatialMeasurements result={withSplitter} onSelect={()=>{}}/>);
  assert.match(splitHtml,/到达功率.*0\.5 mW/);
  assert.match(splitHtml,/通过占比.*50%/);

  const withPol=structuredClone(r);
  withPol.inputSnapshot.elements.push(makeSpatialElement('polarizer',[200,60,0]));
  const polHtml=renderToStaticMarkup(<SpatialMeasurements result={withPol} onSelect={()=>{}}/>);
  assert.match(polHtml,/电场轨迹示意/);
});

test('builderStatusReadout summarizes multi-screen, coherent, and imaging results clearly',()=>{
  const r=result();
  assert.equal(builderStatusReadout(r,false),null);
  assert.equal(builderStatusReadout(r,true),null);

  r.screens=[
    {elementId:'s1',name:'探测屏（可沿光轴移动）',hits:20,sampledPowerFraction:1,sampledPowerMw:1,centroid:[300,60,0],footprintRadiusMm:0,gaussianRadiusMm:0.033868},
    {elementId:'s2',name:'反射屏（支路）',hits:20,sampledPowerFraction:0.5,sampledPowerMw:0.5,centroid:[200,60,150],footprintRadiusMm:0,gaussianRadiusMm:0.5},
  ];
  assert.equal(builderStatusReadout(r,true),'探测屏 33.9 μm 等 2 屏');

  const coherent=result();
  coherent.fourier={screenId:'screen',sourceId:'source',gratingId:'grating',parameters:{wavelengthNm:532,periodMm:.1,waistMm:1,modulation:1,focalLengthMm:100,observationUm:0},spatialFrequency:10,orderPositionUm:0,spotRadiusUm:20,pointIntensity:1,inputPowerMw:1,capturedPowerMw:0.42,points:[]};
  assert.equal(builderStatusReadout(coherent,true),'0.42 mW');

  const imagingTemplate=spatialTemplate('imaging');
  const imagingObj=imagingTemplate.elements.find(e=>e.kind==='object')!;
  const imagingLens=imagingTemplate.elements.find(e=>e.kind==='lens')!;
  const imagingScreen=imagingTemplate.elements.find(e=>e.kind==='screen')!;
  imagingObj.name='样品 F（可沿光轴移动）';
  imagingLens.name='成像透镜（可沿光轴移动）';
  imagingScreen.name='接收像屏（可沿光轴移动）';
  const imaging={
    ...result(),
    inputSnapshot:imagingTemplate,
    imaging:[{
      objectId:imagingObj.id,
      objectPaths:[],
      segments:[],
      stages:[{lensId:imagingLens.id,kind:'real' as const,distanceMm:200,magnification:-1,heightMm:-10,position:[400,60,0] as [number,number,number],paths:[],visible:true}],
      observations:[{elementId:imagingScreen.id,kind:'screen' as const,focused:true,defocusMm:0,magnification:-1,angularMagnification:null,fieldDiameterMm:null,adapterMagnification:1,widthMm:60,heightMm:60,hits:[]}],
      warnings:[],
    }],
  };
  assert.equal(builderStatusReadout(imaging,true),'已对焦');
  const imagingHtml=renderToStaticMarkup(<SpatialMeasurements result={imaging} onSelect={()=>{}} onOpenFormula={()=>{}}/>);
  assert.doesNotMatch(imagingHtml,/可沿光轴移动/);
  assert.match(imagingHtml,/样品 F/);
  assert.match(imagingHtml,/薄透镜物像公式/);
});

test('SpatialMeasurements renders formula bridge CTA only when onOpenFormula and presets apply',()=>{
  const r=result();
  const withBridge=renderToStaticMarkup(<SpatialMeasurements result={r} onSelect={()=>{}} onOpenFormula={()=>{}}/>);
  assert.match(withBridge,/sb-formula-bridge/);
  assert.match(withBridge,/高斯光束传输半径/);
  assert.match(withBridge,/代入公式库计算/);

  const noCallback=renderToStaticMarkup(<SpatialMeasurements result={r} onSelect={()=>{}}/>);
  assert.doesNotMatch(noCallback,/sb-formula-bridge/);
});

test('resolveSpatialFormulas builds valid presets across Gaussian focus, imaging, slit, and polarizer setups',()=>{
  const focus=spatialTemplate('focus');
  const gauss=resolveSpatialFormulas(focus.elements);
  const radiusExpr=gauss.expressions.find(e=>e.preset?.formulaId==='radius');
  assert.ok(radiusExpr?.preset?.values);
  assert.ok((radiusExpr!.preset!.values!.waistMm??1)<0.1,'focused Gaussian preset uses image-space waist');

  const imaging=spatialTemplate('imaging');
  const lensFormula=resolveSpatialFormulas(imaging.elements);
  assert.equal(lensFormula.expressions[0].preset?.knowledgeId,'thin-lens');
  assert.ok((lensFormula.expressions[0].preset?.opticsValues?.f??0)>0);
  assert.ok((lensFormula.expressions[0].preset?.opticsValues?.u??0)>0);

  const laser=makeSpatialElement('laser',[0,60,0]);
  laser.beamModel='parallel';
  laser.powerMw=5;
  laser.polarization='linear';
  laser.polarizationDeg=15;
  const pol=makeSpatialElement('polarizer',[100,60,0]);
  pol.rollDeg=150;
  const malus=resolveSpatialFormulas([laser,pol]);
  assert.equal(malus.expressions[0].preset?.knowledgeId,'malus-power');
  assert.equal(malus.expressions[0].preset?.opticsValues?.Pin,5);
  assert.equal(malus.expressions[0].preset?.opticsValues?.theta,45);

  const slit=makeSpatialElement('slit',[100,60,0]);
  slit.slitWidthMm=0.05;
  const screen=makeSpatialElement('screen',[600,60,0]);
  const diff=resolveSpatialFormulas([laser,slit,screen]);
  assert.equal(diff.expressions[0].preset?.knowledgeId,'single-slit-width');
  assert.equal(diff.expressions[0].preset?.opticsValues?.a,0.05);
  assert.equal(diff.expressions[0].preset?.opticsValues?.L,0.5);
});

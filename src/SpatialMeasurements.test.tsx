import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {makeSpatialElement,spatialTemplate,type SpatialResult} from './builderModel';
import {spatialResultNotes} from './spatialResultNotes';
import SpatialMeasurements from './SpatialMeasurements';

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

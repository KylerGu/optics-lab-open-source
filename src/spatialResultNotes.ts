import type {SpatialResult} from './builderModel';
import {isPhysicalLens} from './physicalLensGeometry';

// Known model notices are covered by the concise, apparatus-specific scope below.
// Unknown warnings stay visible, so a new backend warning cannot disappear silently.
const explainedNotice=[
  /之后显示实际曲面折射的几何光线；暂不计算实体透镜后的高斯包络。$/,
  /之后仅计算几何光线，尚不提供棱镜内的高斯包络与像散。$/,
  /之后只显示单方向聚焦的几何光线，尚不计算椭圆高斯包络。$/,
  /条纹为独立的归一化远场强度，采样光线与功率计读数未包含衍射能量分布。$/,
  /^光栅级次功率为薄振幅模型的采样估计；光强剖面单独计算，不是功率计读数。$/,
];
function compactWarning(text:string):string{
  return text
    .replace('当前装置不满足前后焦面傅里叶计算条件：检查共轴、输入与屏距透镜均为 f、输入束腰和通光口径；当前仅显示几何光路。','未满足傅里叶计算条件，仅显示几何光路。检查共轴、前后焦面、束腰与口径。')
    .replace('当前装置不满足 4f 波动计算条件：检查共轴、等焦距、f / 2f / f 间距、输入束腰、通光口径及滤波片所在焦面；当前仅显示几何光路。','未满足 4f 计算条件，仅显示几何光路。检查共轴、等焦距、间距、束腰、口径与滤波片位置。')
    .replace('当前只计算几何截光；远场条纹需宽光束正入射、窄而长的狭缝及无遮挡的远处正对观察屏。','仅计算截光。显示条纹需宽光束正入射、窄长狭缝及远处正对且无遮挡的观察屏。')
    .replace('偏离设计波长，按恒定双折射的零级延迟近似，未使用实测色散。','偏离设计波长，偏振结果为近似；可调整设计波长。')
    .replace('采用理想偏振分光面；当前偏离45°入射，未计算真实镀膜的角度和波长变化。','偏离 45° 入射，结果未包含真实镀膜效应。')
    .replace('倾斜入射仅投影快轴，未计算晶体角度相关延迟。','倾斜入射，偏振结果仅为近似。');
}
export function spatialResultNotes(result:SpatialResult):{warnings:string[];scope:string[]}{
  const elements=result.inputSnapshot.elements,has=(kind:string)=>elements.some(e=>e.kind===kind),coherent=result.fourF??result.fourier;
  const scope=[coherent?'到屏功率按屏面积积分；其余功率读数为光线采样估计。':'功率按光线采样估计，光线少时误差较大。'];
  if(has('object'))scope.push('物体视为已照亮；多物点使用与激光相同的理想薄透镜折转关系。只支持共轴薄透镜，不计算照明、像差或衍射。相机转接仅缩放像面，位置与光线使用转接前坐标；目视读数以观察位置为准。');
  if(result.fourF)scope.push('4f：共轴、等焦距，间距 f / 2f / f；忽略像差与离焦。');
  else if(result.fourier)scope.push('傅里叶频谱：输入与观察屏位于前后焦面；忽略像差与离焦。');
  const solidKinds=[elements.some(e=>isPhysicalLens(e.kind))?'实体透镜':null,elements.some(e=>e.kind.endsWith('prism'))?'棱镜':null].filter(Boolean),solid=solidKinds.length>0;
  if(solid)scope.push(solidKinds.join('、')+'逐面折射，包含透射损耗；不追踪杂散反射。');
  if(has('lens')||has('cylindrical-lens'))scope.push('理想透镜采用小角度、薄透镜近似。');
  if(elements.some(e=>['polarizer','half-wave-plate','quarter-wave-plate','polarizing-splitter'].includes(e.kind)))scope.push('偏振器件采用理想模型；偏离设计条件时用近似。');
  if(elements.some(e=>e.kind==='laser'&&e.beamModel==='gaussian')&&(solid||has('cylindrical-lens')))scope.push([...solidKinds,...(has('cylindrical-lens')?['理想柱面透镜']:[])].join('、')+'后不计算高斯包络，仅显示几何光线。');
  if(!coherent&&(result.diffraction?.length||has('amplitude-grating')))scope.push('衍射仅计算支持条件下的一维条纹；曲线与几何功率分开计算。');
  if(elements.filter(e=>e.kind==='laser').length>1)scope.push('多光源按功率相加，不计算相干干涉。');
  const warnings=[...new Set(result.warnings.filter(text=>!explainedNotice.some(pattern=>pattern.test(text))).map(compactWarning))];
  return {warnings,scope};
}

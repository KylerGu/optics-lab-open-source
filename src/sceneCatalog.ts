import { OPTICS_OUTLINE } from './opticsOutline';
import { ACCEPTED_SCENES } from './sceneRuntime';

export const SCENE_CATEGORIES = [
  { id: 'geometrical', title: '成像与光学系统', topics: ['reflection-refraction', 'paraxial', 'instruments', 'aberrations'] },
  { id: 'interference', title: '光波与干涉', topics: ['wave-fields', 'interference', 'coherence'] },
  { id: 'diffraction', title: '衍射与空间滤波', topics: ['diffraction', 'spatial-spectrum', 'optical-transfer', 'holography'] },
  { id: 'polarization', title: '偏振控制', topics: ['polarization'] },
  { id: 'laser', title: '激光光学', topics: ['gaussian', 'beam-transformation', 'resonators', 'laser-gain'] },
  { id: 'guided', title: '光纤与波导', topics: ['planar-waveguide', 'fiber-modes', 'fiber-dispersion'] },
  { id: 'light-matter', title: '介质与光谱', topics: ['absorption', 'material-dispersion', 'scattering'] },
  { id: 'radiometry', title: '照明与探测', topics: ['radiometric-quantities', 'photometric-quantities', 'detector-response', 'detector-noise'] },
  { id: 'nonlinear', title: '非线性光学', topics: ['frequency-conversion', 'optical-kerr'] },
  { id: 'quantum', title: '量子光学', topics: ['photon-energy', 'photon-statistics'] },
];

const DESCRIPTIONS: Record<string, string> = {
  'reflection-refraction': '观察光线在界面处的反射与转折。',
  paraxial: '改变物体与器件的位置，观察成像关系。',
  instruments: '观察物镜与目镜如何组成成像系统。',
  aberrations: '观察孔径和像差对成像的影响。',
  'wave-fields': '观察光波传播与叠加的图样。',
  interference: '调整光程差，观察干涉条纹的变化。',
  coherence: '观察相干条件对条纹清晰度的影响。',
  diffraction: '改变孔径或波长，观察衍射图样。',
  polarization: '调整偏振器件，观察偏振态与光强。',
  'spatial-spectrum': '观察透镜与空间滤波器对光场的作用。',
  'optical-transfer': '比较成像系统保留细节的能力。',
  holography: '观察物光与参考光的记录和再现。',
  gaussian: '观察束腰、光斑与传播距离的关系。',
  'beam-transformation': '观察透镜如何改变光束大小与传播。',
  resonators: '调节腔镜曲率与镜距，观察稳定范围和腔内光束。',
  'laser-gain': '调节增益、损耗和腔镜反射率，观察起振阈值与增益饱和。',
  'planar-waveguide': '观察光在波导中的限制与传播。',
  'fiber-modes': '观察光纤中的导模与耦合。',
  'fiber-dispersion': '观察光脉冲在传播中的展宽。',
  absorption: '观察光通过介质后的能量变化。',
  'material-dispersion': '观察不同波长的传播差异。',
  scattering: '观察光在介质中的散射分布。',
  'radiometric-quantities': '改变光源与距离，观察接收能量。',
  'photometric-quantities': '观察照明方向与照度分布。',
  'detector-response': '观察入射光与探测器响应的关系。',
  'detector-noise': '比较信号强度与噪声的影响。',
  'frequency-conversion': '观察光的频率变换与相位匹配。',
  'optical-kerr': '观察光强变化引起的传播变化。',
  'photon-energy': '观察光频率与光电效应的关系。',
  'photon-statistics': '观察光子计数的统计分布。',
};

export interface CatalogScene { id: string; title: string; description: string; categoryId: string; topic: string; available: boolean; variant: number }
const SCENE_DESCRIPTIONS: Record<string, string> = {
  '偏振片与马吕斯定律': '旋转偏振方向与透光轴，观察透射功率。',
  '单模光纤耦合': '对准光斑大小、位置与方向，观察耦合效率。',
  '光纤数值孔径与导模': '调节入射角与纤芯参数，观察导光和单模条件。',
  '照度分布与光源方向': '移动射灯、改变方向，观察接收面的照度分布。',
  '点光源照度与距离': '调整光强与距离，观察接收面中心照度。',
  '激光扩束与准直': '调节两镜焦距与镜距，观察扩束倍率、发散角和光斑。',
  '高斯光束透镜聚焦': '调整透镜，观察束腰位置与目标平面的光斑大小。',
  '全反射与临界角': '改变入射角，观察折射光消失的条件。',
  '棱镜偏折': '观察光线穿过棱镜后的方向变化。',
  '球面镜成像': '改变物距，观察反射光的成像位置。',
  '双透镜光学系统': '调整两片透镜的位置，观察组合成像。',
  '显微镜成像': '观察物镜与目镜如何逐级放大物像。',
  '望远镜成像': '观察物镜与目镜对远处物体的成像。',
  '相机成像': '观察镜头在感光面上的成像。',
  '光阑与光瞳': '观察孔径对通过光线范围的限制。',
  '球差与色差': '比较不同位置、波长光线的聚焦差异。',
  '光波叠加': '调整两束光的振幅与相位差，观察电场叠加。',
  '杨氏双缝干涉': '调整双缝间距，观察明暗条纹。',
  '薄膜干涉与牛顿环': '观察薄层厚度变化产生的干涉图样。',
  '迈克耳孙干涉仪': '调整两臂光程差，观察干涉条纹。',
  '法布里–珀罗干涉仪': '观察多次反射形成的透射干涉。',
  '单缝衍射': '改变缝宽，观察中央亮纹与两侧暗纹。',
  '圆孔衍射与艾里斑': '改变孔径，观察中央光斑与衍射环。',
  '4f 系统与空间滤波': '拖动滤波片，观察保留与去除频谱后的条纹。',
  '布儒斯特角与双折射': '拖动入射光或晶体光轴，观察偏振反射与分束。',
  '波片与偏振态': '转动快轴，观察直线、圆与椭圆偏振。',
  '透镜的傅里叶变换': '拖动输入条纹，观察频谱位置与宽度。',
  '衍射光栅': '观察光栅间距与衍射方向的关系。',
};
// Keep withdrawn scenes and their saved data available by direct URL, without a library card.
const HIDDEN_SCENES = new Set(['laser-gain-0']);
export const CATALOG_SCENES: CatalogScene[] = SCENE_CATEGORIES.flatMap(category => category.topics.flatMap(topic => OPTICS_OUTLINE[topic].scenes.map((title, variant) => ({ id: `${topic}-${variant}`, title, description: SCENE_DESCRIPTIONS[title] ?? DESCRIPTIONS[topic], categoryId: category.id, topic, available: topic === 'gaussian' || topic === 'beam-transformation' && variant === 0 || ACCEPTED_SCENES.has(`${topic}-${variant}`), variant })))).filter(scene => !HIDDEN_SCENES.has(scene.id)).sort((a, b) => Number(b.available) - Number(a.available));

export function normalizeSceneCategory(id: string) {
  if (SCENE_CATEGORIES.some(category => category.id === id)) return id;
  const legacy = { wave: 'interference', fourier: 'diffraction', detection: 'radiometry' } as Record<string, string>;
  return legacy[id] ?? SCENE_CATEGORIES.find(category => category.topics.includes(id))?.id ?? 'all';
}

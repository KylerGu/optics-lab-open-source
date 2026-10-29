export interface OpticsCategory { id: string; title: string; children?: OpticsCategory[] }
export const OPTICS_CATEGORIES: OpticsCategory[] = [
  { id: 'geometrical', title: '几何光学', children: [
    { id: 'reflection-refraction', title: '反射与折射' },
    { id: 'paraxial', title: '近轴成像' },
    { id: 'instruments', title: '光学仪器' },
    { id: 'aberrations', title: '光阑与像差' },
  ] },
  { id: 'wave', title: '波动光学', children: [
    { id: 'wave-fields', title: '光波与叠加' },
    { id: 'interference', title: '干涉' },
    { id: 'coherence', title: '相干性' },
    { id: 'diffraction', title: '衍射' },
    { id: 'polarization', title: '偏振' },
  ] },
  { id: 'fourier', title: '傅里叶光学', children: [
    { id: 'spatial-spectrum', title: '空间频谱与滤波' },
    { id: 'optical-transfer', title: '成像与传递函数' },
    { id: 'holography', title: '全息成像' },
  ] },
  { id: 'laser', title: '激光光学', children: [
    { id: 'gaussian', title: '高斯光束' },
    { id: 'beam-transformation', title: '光束变换与模式匹配' },
    { id: 'resonators', title: '光学谐振腔' },
    { id: 'laser-gain', title: '激光增益与振荡' },
  ] },
  { id: 'guided', title: '导波光学', children: [
    { id: 'planar-waveguide', title: '平面波导' },
    { id: 'fiber-modes', title: '光纤与导模' },
    { id: 'fiber-dispersion', title: '光纤色散与传输' },
  ] },
  { id: 'light-matter', title: '光与物质相互作用', children: [
    { id: 'absorption', title: '吸收' },
    { id: 'material-dispersion', title: '色散' },
    { id: 'scattering', title: '散射' },
  ] },
  { id: 'radiometry', title: '辐射度学与光度学', children: [
    { id: 'radiometric-quantities', title: '辐射量与能量传递' },
    { id: 'photometric-quantities', title: '光度量与照明' },
  ] },
  { id: 'detection', title: '光电探测', children: [
    { id: 'detector-response', title: '探测器响应' },
    { id: 'detector-noise', title: '噪声与信噪比' },
  ] },
  { id: 'nonlinear', title: '非线性光学', children: [
    { id: 'frequency-conversion', title: '频率变换' },
    { id: 'optical-kerr', title: '光学克尔效应' },
  ] },
  { id: 'quantum', title: '量子光学', children: [
    { id: 'photon-energy', title: '光子与光电效应' },
    { id: 'photon-statistics', title: '光子统计' },
  ] },
];

export const OPTICS_OUTLINE: Record<string, { scenes: string[]; formulas: string[] }> = {
  'reflection-refraction': { scenes: ['平面界面的反射与折射', '全反射与临界角', '棱镜偏折'], formulas: ['反射定律', '折射定律', '临界角', '费马原理'] },
  paraxial: { scenes: ['薄透镜成像', '球面镜成像', '双透镜光学系统'], formulas: ['薄透镜成像公式', '球面镜成像公式', '透镜制造者公式', '近轴光线传递矩阵'] },
  instruments: { scenes: ['显微镜成像', '望远镜成像', '相机成像'], formulas: ['横向放大率', '角放大率', '数值孔径', '物像关系'] },
  aberrations: { scenes: ['光阑与光瞳', '球差与色差'], formulas: ['孔径与视场', '光瞳位置', '球差与色差描述'] },
  'wave-fields': { scenes: ['平面波与球面波', '光波叠加'], formulas: ['单色光波表达式', '光程与相位', '光强与电场振幅'] },
  interference: { scenes: ['杨氏双缝干涉', '薄膜干涉与牛顿环', '迈克耳孙干涉仪', '法布里–珀罗干涉仪'], formulas: ['双光束干涉强度', '条纹间距', '薄膜光程差', '多光束干涉透射率'] },
  coherence: { scenes: ['有限相干长度与条纹可见度'], formulas: ['条纹可见度', '相干时间与相干长度', '复相干度'] },
  diffraction: { scenes: ['单缝衍射', '圆孔衍射与艾里斑', '衍射光栅', '菲涅耳衍射'], formulas: ['单缝衍射强度', '圆孔衍射强度', '瑞利分辨判据', '光栅方程', '菲涅耳数'] },
  polarization: { scenes: ['偏振片与马吕斯定律', '波片与偏振态', '布儒斯特角与双折射'], formulas: ['马吕斯定律', '布儒斯特角', '琼斯矩阵', '斯托克斯参数'] },
  'spatial-spectrum': { scenes: ['透镜的傅里叶变换', '4f 系统与空间滤波'], formulas: ['二维傅里叶变换', '透镜后焦面的空间频率映射', '空间滤波关系'] },
  'optical-transfer': { scenes: ['点扩散函数与成像分辨率', '光学传递函数'], formulas: ['点扩散函数', '光学传递函数', '调制传递函数'] },
  holography: { scenes: ['全息记录与再现'], formulas: ['全息干涉记录强度', '再现光场关系'] },
  gaussian: { scenes: ['高斯光束自由传播'], formulas: ['高斯光束传播半径', '瑞利长度', '远场发散半角', '波前曲率半径', '高斯光斑的光强分布'] },
  'beam-transformation': { scenes: ['高斯光束透镜聚焦', '激光扩束与准直', '光束模式匹配'], formulas: ['复光束参数', '光束参数的 ABCD 变换', '模式重叠效率'] },
  resonators: { scenes: ['两镜谐振腔稳定性', '谐振腔模式'], formulas: ['谐振腔稳定条件', '纵模频率间隔', '腔内高斯模式'] },
  'laser-gain': { scenes: ['激光阈值与增益'], formulas: ['激光阈值条件', '受激辐射与增益', '增益饱和'] },
  'planar-waveguide': { scenes: ['平面介质波导模式'], formulas: ['波导传播常数', '平面波导色散方程'] },
  'fiber-modes': { scenes: ['光纤数值孔径与导模', '单模光纤耦合'], formulas: ['光纤数值孔径', '归一化频率 V', '单模条件', '耦合效率'] },
  'fiber-dispersion': { scenes: ['光纤脉冲展宽'], formulas: ['群速度', '群速度色散', '脉冲展宽关系'] },
  absorption: { scenes: ['介质吸收与透射'], formulas: ['比尔–朗伯定律', '吸收系数与透射率'] },
  'material-dispersion': { scenes: ['折射率色散与棱镜分光'], formulas: ['柯西色散公式', '塞尔迈耶色散公式', '相速度与群速度'] },
  scattering: { scenes: ['瑞利散射'], formulas: ['瑞利散射的波长关系', '散射截面'] },
  'radiometric-quantities': { scenes: ['点光源照度与距离', '朗伯辐射与能量接收'], formulas: ['辐射通量与辐照度', '辐亮度', '距离平方反比关系', '朗伯余弦关系'] },
  'photometric-quantities': { scenes: ['照度分布与光源方向'], formulas: ['光通量与光强', '照度与亮度', '光谱光视效率换算'] },
  'detector-response': { scenes: ['光电二极管响应', '相机光子计数与饱和'], formulas: ['响应度与量子效率', '光电流与入射功率'] },
  'detector-noise': { scenes: ['探测器噪声与信噪比'], formulas: ['散粒噪声', '热噪声', '信噪比', '噪声等效功率'] },
  'frequency-conversion': { scenes: ['二次谐波产生与相位匹配'], formulas: ['二阶非线性极化', '相位匹配条件', '频率变换效率'] },
  'optical-kerr': { scenes: ['自相位调制'], formulas: ['强度相关折射率', '非线性相移'] },
  'photon-energy': { scenes: ['光电效应与截止频率'], formulas: ['光子能量', '爱因斯坦光电效应方程'] },
  'photon-statistics': { scenes: ['光子计数统计'], formulas: ['泊松光子计数分布', '二阶关联函数'] },
};

export function opticsCategoryPath(id: string, branches = OPTICS_CATEGORIES): OpticsCategory[] {
  for (const category of branches) {
    if (category.id === id) return [category];
    const child = opticsCategoryPath(id, category.children ?? []);
    if (child.length) return [category, ...child];
  }
  return [];
}
export function opticsLeaves(branches = OPTICS_CATEGORIES): OpticsCategory[] {
  return branches.flatMap(branch => branch.children ? opticsLeaves(branch.children) : [branch]);
}
export function inOpticsCategory(leafId: string, categoryId: string) {
  return categoryId === 'all' || opticsCategoryPath(leafId).some(category => category.id === categoryId);
}

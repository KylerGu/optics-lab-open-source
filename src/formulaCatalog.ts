import { OPTICS_CATEGORIES, type OpticsCategory } from './opticsOutline';

export type FormulaId = 'radius' | 'rayleigh' | 'divergence' | 'curvature' | 'intensity';
export type FormulaField = 'wavelengthNm' | 'waistMm' | 'distanceMm' | 'radiusMm' | 'offsetMm';
export interface FormulaValues { wavelengthNm: number; waistMm: number; distanceMm: number; radiusMm: number; offsetMm: number }
export type FormulaCategory = OpticsCategory;
export const FORMULA_CATEGORIES = OPTICS_CATEGORIES;
export interface FormulaTopic {
  id: FormulaId;
  categoryId: string;
  latex: string;
  title: string;
  symbol: string;
  question: string;
  meaning: string;
  diagramCaption: string;
  symbols: { symbol: string; meaning: string; unit: string }[];
  conditions: string;
  application: string;
  fields: FormulaField[];
  result: { label: string; unit: string };
}

export const FORMULA_TOPICS: FormulaTopic[] = [
  {
    id: 'radius', categoryId: 'gaussian', latex: String.raw`w(z)=w_0\sqrt{1+\left(\frac{d}{z_R}\right)^2}`, title: '高斯光束传播半径', symbol: 'w(z)', question: '传播到这个位置，光斑有多大？',
    meaning: '光束在束腰处最细，离开束腰后逐渐展开。这条公式把传播距离转换为该位置的光斑半径。',
    diagramCaption: 'w₀ 与 w(z) 都从光轴量到光束边界，表示半径。',
    symbols: [{ symbol: 'w(z)', meaning: '观察位置的光斑半径', unit: 'mm' }, { symbol: 'w₀', meaning: '光束最细处的半径', unit: 'mm' }, { symbol: 'd = z − z₀', meaning: '观察位置距束腰的距离', unit: 'mm' }, { symbol: 'z_R', meaning: '瑞利长度，描述束腰附近的传播尺度', unit: 'mm' }],
    conditions: '空气中自由传播的理想基模高斯光束，传播角度较小，传播段无透镜或遮挡；半径按光强降至中心的 1/e² 定义。',
    application: '估算接收面的光斑大小，辅助选择接收镜、探测器和窗口的口径。',
    fields: ['wavelengthNm', 'waistMm', 'distanceMm'], result: { label: '光斑半径 w(z)', unit: 'mm' },
  },
  {
    id: 'rayleigh', categoryId: 'gaussian', latex: String.raw`z_R=\frac{\pi w_0^2}{\lambda}`, title: '瑞利长度', symbol: 'z_R', question: '光束能在多长的距离内保持较小光斑？',
    meaning: '从束腰传播一个瑞利长度，光斑半径变为束腰半径的 √2 倍，对应的光斑面积变为两倍。',
    diagramCaption: 'z_R 是沿传播方向的距离；到达此处时 w = √2 w₀。',
    symbols: [{ symbol: 'z_R', meaning: '瑞利长度', unit: 'mm' }, { symbol: 'w₀', meaning: '束腰半径', unit: 'mm' }, { symbol: 'λ', meaning: '光在传播介质中的波长', unit: '公式内与 w₀ 使用相同长度单位' }],
    conditions: '理想基模高斯光束；λ 为介质中的波长，与 w₀ 使用相同长度单位，本页按空气计算。',
    application: '估计激光加工或测量的聚焦范围，判断偏离束腰对光斑大小的影响。',
    fields: ['wavelengthNm', 'waistMm'], result: { label: '瑞利长度 z_R', unit: 'mm' },
  },
  {
    id: 'divergence', categoryId: 'gaussian', latex: String.raw`\theta\approx\frac{\lambda}{\pi w_0}`, title: '远场发散半角', symbol: 'θ', question: '为什么细光束在远处可能展开得更快？',
    meaning: '发散半角描述远处光束展开方向与光轴的夹角。角度越大，相同传播距离下光斑增加得越多。',
    diagramCaption: 'θ 是一侧展开方向与光轴的夹角，上下两侧的总角为 2θ。',
    symbols: [{ symbol: 'θ', meaning: '远场发散半角', unit: 'rad；读数用 mrad' }, { symbol: 'λ', meaning: '空气中的波长', unit: '与 w₀ 使用相同长度单位' }, { symbol: 'w₀', meaning: '束腰半径', unit: 'mm' }],
    conditions: '理想基模高斯光束、小角度近似；θ 表示远场发散半角，远场距离满足 d ≫ z_R。',
    application: '估算远距离传播的发散程度，选择扩束倍率和出射口径。',
    fields: ['wavelengthNm', 'waistMm'], result: { label: '发散半角 θ', unit: 'mrad' },
  },
  {
    id: 'curvature', categoryId: 'gaussian', latex: String.raw`R(z)=d+\frac{z_R^2}{d}`, title: '波前曲率半径', symbol: 'R(z)', question: '光波前有多弯？',
    meaning: '波前是光波处于相同振动阶段的点组成的面。曲率半径 R 越大，这个面越平；它与描述光束粗细的 w(z) 是不同的量。',
    diagramCaption: '曲线显示 R 随距束腰距离变化，不是光束的外形曲线。',
    symbols: [{ symbol: 'R(z)', meaning: '观察位置的波前曲率半径', unit: 'mm' }, { symbol: 'd = z − z₀', meaning: '观察位置距束腰的距离', unit: 'mm' }, { symbol: 'z_R', meaning: '瑞利长度', unit: 'mm' }],
    conditions: '空气中自由传播的理想基模高斯光束，取束腰右侧 d ≥ 0；束腰处 d = 0 时 R → ∞。',
    application: '计算波前弯曲程度，辅助光束准直、光纤耦合和光学腔匹配。',
    fields: ['wavelengthNm', 'waistMm', 'distanceMm'], result: { label: '波前曲率半径 R(z)', unit: 'mm' },
  },
  {
    id: 'intensity', categoryId: 'gaussian', latex: String.raw`\frac{I(r)}{I(0)}=\exp\!\left(-\frac{2r^2}{w^2}\right)`, title: '高斯光斑的光强分布', symbol: 'I(r)/I(0)', question: '光斑边缘为什么没有一条锐利的分界？',
    meaning: '高斯光斑中心最亮，光强随横向距离平滑降低。光斑半径 w 是一个约定的测量尺度，不代表半径之外完全没有光。',
    diagramCaption: '横向距离 r = w 时，曲线降到中心光强的约 13.5%。',
    symbols: [{ symbol: 'I(r)/I(0)', meaning: '该点光强相对于中心光强的比例', unit: '无量纲' }, { symbol: 'r', meaning: '到光斑中心的横向距离', unit: 'mm' }, { symbol: 'w', meaning: '当前平面的光斑半径', unit: 'mm' }],
    conditions: '理想圆对称高斯光斑；I(r)/I(0) 为当前平面某点与中心的光强比，不是总功率比例。',
    application: '拟合相机测得的光斑，比较中心与边缘的光强。',
    fields: ['radiusMm', 'offsetMm'], result: { label: '相对中心的光强', unit: '%' },
  },
];

export function formulaInCategory(topic: FormulaTopic, categoryId: string): boolean {
  if (categoryId === 'all' || topic.categoryId === categoryId) return true;
  const includesTopic = (category: FormulaCategory): boolean => category.id === topic.categoryId || !!category.children?.some(includesTopic);
  const findCategory = (categories: FormulaCategory[]): FormulaCategory | undefined => {
    for (const category of categories) {
      if (category.id === categoryId) return category;
      const found = findCategory(category.children ?? []);
      if (found) return found;
    }
  };
  const category = findCategory(FORMULA_CATEGORIES);
  return !!category && includesTopic(category);
}

export const FORMULA_FIELD_INFO: Record<FormulaField, { label: string; unit: string; positive: boolean }> = {
  wavelengthNm: { label: '波长 λ', unit: 'nm', positive: true },
  waistMm: { label: '束腰半径 w₀', unit: 'mm', positive: true },
  distanceMm: { label: '距束腰 d', unit: 'mm', positive: false },
  radiusMm: { label: '光斑半径 w', unit: 'mm', positive: true },
  offsetMm: { label: '横向距离 r', unit: 'mm', positive: false },
};
export const DEFAULT_FORMULA_VALUES: FormulaValues = { wavelengthNm: 532, waistMm: .2, distanceMm: 320, radiusMm: .3368, offsetMm: .3368 };

export function solveFormula(id: FormulaId, values: FormulaValues): number {
  const topic = FORMULA_TOPICS.find(item => item.id === id)!;
  for (const field of topic.fields) {
    const value = values[field];
    if (!Number.isFinite(value) || (FORMULA_FIELD_INFO[field].positive ? value <= 0 : value < 0)) throw new Error(`${FORMULA_FIELD_INFO[field].label}需要${FORMULA_FIELD_INFO[field].positive ? '大于' : '大于或等于'} 0。`);
  }
  if (id === 'intensity') return Math.exp(-2 * (values.offsetMm / values.radiusMm) ** 2) * 100;
  const zr = Math.PI * values.waistMm ** 2 / (values.wavelengthNm * 1e-6);
  if (id === 'rayleigh') return zr;
  if (id === 'divergence') return values.wavelengthNm * 1e-6 / (Math.PI * values.waistMm) * 1000;
  if (id === 'curvature') return values.distanceMm === 0 ? Infinity : values.distanceMm + zr ** 2 / values.distanceMm;
  return values.waistMm * Math.hypot(1, values.distanceMm / zr);
}

import { FORMULA_FIELD_INFO, solveFormula, type FormulaField, type FormulaId, type FormulaValues } from './formulaCatalog';

export type FormulaQuantity = FormulaField | 'rayleighMm' | 'divergenceMrad' | 'curvatureMm' | 'intensityPercent';
export type CalculatorValues = Record<FormulaQuantity, number>;
export const QUANTITY_INFO: Record<FormulaQuantity, { label: string; unit: string; positive: boolean }> = {
  ...FORMULA_FIELD_INFO,
  rayleighMm: { label: '瑞利长度 z_R', unit: 'mm', positive: true },
  divergenceMrad: { label: '发散半角 θ', unit: 'mrad', positive: true },
  curvatureMm: { label: '波前曲率半径 R(z)', unit: 'mm', positive: true },
  intensityPercent: { label: '相对中心的光强', unit: '%', positive: false },
};
export const FORMULA_QUANTITIES: Record<FormulaId, FormulaQuantity[]> = {
  radius: ['radiusMm', 'waistMm', 'distanceMm', 'rayleighMm'],
  rayleigh: ['rayleighMm', 'waistMm', 'wavelengthNm'],
  divergence: ['divergenceMrad', 'waistMm', 'wavelengthNm'],
  curvature: ['curvatureMm', 'distanceMm', 'rayleighMm'],
  intensity: ['intensityPercent', 'radiusMm', 'offsetMm'],
};

export function calculatorValues(values: FormulaValues): CalculatorValues {
  return { ...values, rayleighMm: solveFormula('rayleigh', values), divergenceMrad: solveFormula('divergence', values), curvatureMm: solveFormula('curvature', values), intensityPercent: solveFormula('intensity', values) };
}

export function solveForQuantity(id: FormulaId, target: FormulaQuantity, v: CalculatorValues): { values: number[]; note?: string } {
  const quantities = FORMULA_QUANTITIES[id];
  if (!quantities.includes(target)) throw new Error('该公式不包含这个物理量。');
  for (const field of quantities.filter(field => field !== target)) {
    const info = QUANTITY_INFO[field];
    if (!Number.isFinite(v[field]) || (info.positive ? v[field] <= 0 : v[field] < 0)) throw new Error(`${info.label}需要${info.positive ? '大于' : '大于或等于'} 0，且为有限数值。`);
    if (field === 'intensityPercent' && v[field] > 100) throw new Error('相对中心的光强不能超过 100%。');
  }
  const { radiusMm: w, waistMm: w0, distanceMm: d, rayleighMm: zr, wavelengthNm: wavelength, divergenceMrad: theta, curvatureMm: R, intensityPercent: percent, offsetMm: r } = v;
  let answers: number[];
  let note: string | undefined;
  if (id === 'radius') {
    if (target === 'radiusMm') answers = [w0 * Math.hypot(1, d / zr)];
    else if (target === 'waistMm') answers = [w / Math.hypot(1, d / zr)];
    else {
      const delta = (w - w0) * (w + w0);
      const tolerance = 1e-12 * Math.max(w * w, w0 * w0);
      if (delta < -tolerance) throw new Error('光斑半径不能小于束腰半径，这组已知量没有解。');
      const spread = Math.sqrt(Math.max(0, delta));
      if (target === 'distanceMm') answers = [zr * spread / w0];
      else {
        if (d === 0 && spread === 0) throw new Error('束腰处 w = w₀，无法仅凭这些已知量确定瑞利长度。');
        if (d === 0 || spread === 0) throw new Error('这组已知量没有有限的正瑞利长度解。');
        answers = [w0 * d / spread];
      }
    }
  } else if (id === 'rayleigh') {
    answers = [target === 'rayleighMm' ? Math.PI * w0 ** 2 / (wavelength * 1e-6) : target === 'waistMm' ? Math.sqrt(zr * wavelength * 1e-6 / Math.PI) : Math.PI * w0 ** 2 / zr * 1e6];
  } else if (id === 'divergence') {
    answers = [target === 'divergenceMrad' ? wavelength * 1e-3 / (Math.PI * w0) : target === 'waistMm' ? wavelength * 1e-3 / (Math.PI * theta) : theta * Math.PI * w0 * 1000];
  } else if (id === 'curvature') {
    if (target === 'curvatureMm') answers = [d === 0 ? Infinity : d + zr ** 2 / d];
    else if (target === 'rayleighMm') {
      if (d === 0 || R <= d) throw new Error('有限波前曲率半径要求 d > 0 且 R(z) > d。');
      answers = [Math.sqrt(d * (R - d))];
    } else {
      const delta = R - 2 * zr;
      if (delta < -1e-12 * Math.max(R, 2 * zr)) throw new Error('R(z) 小于 2z_R，这组已知量没有传播距离解。');
      if (Math.abs(delta) <= 1e-12 * Math.max(R, 2 * zr)) answers = [zr];
      else {
        const large = (R + Math.sqrt(delta * (R + 2 * zr))) / 2;
        answers = [zr ** 2 / large, large];
        note = '同一波前曲率半径可对应束腰附近和更远处的两个位置。';
      }
    }
  } else {
    if (target === 'intensityPercent') answers = [Math.exp(-2 * (r / w) ** 2) * 100];
    else {
      if (percent === 0) throw new Error('有限距离下光强比例大于 0%，请填写 0% 到 100% 之间的已知光强。');
      const scale = Math.sqrt(-Math.log(percent / 100) / 2);
      if (target === 'offsetMm') answers = [w * scale];
      else {
        if (scale === 0 && r === 0) throw new Error('光斑中心的光强为 100%，无法由中心这一点确定光斑半径。');
        if (scale === 0 || r === 0) throw new Error('这组光强和横向距离没有有限的正光斑半径解。');
        answers = [r / scale];
      }
    }
  }
  if (answers.some(value => !Number.isFinite(value) && !(id === 'curvature' && target === 'curvatureMm' && d === 0 && value === Infinity))) throw new Error('结果超过可计算范围，请调整已知量。');
  if (answers.some(value => QUANTITY_INFO[target].positive ? value <= 0 : value < 0)) throw new Error('这组已知量没有符合物理条件的解。');
  return { values: answers.map(value => value === 0 ? 0 : value), note };
}

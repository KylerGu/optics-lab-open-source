import { parseSpatial, type SpatialElement, type SpatialExperiment, type SpatialResult } from './builderModel';
import { resizeLens } from './lensPresets';
import { isPhysicalLens } from './physicalLensGeometry';
import { isSphericalLens } from './sphericalLensGeometry';
import { cleanElementDisplayName, formatCompact, formatReadoutWithUnit } from './researchUnits';

export type VisualField =
  | 'x'
  | 'y'
  | 'z'
  | 'yawDeg'
  | 'pitchDeg'
  | 'rollDeg'
  | 'focalLengthMm'
  | 'wavelengthNm'
  | 'beamRadiusMm'
  | 'waistOffsetMm'
  | 'powerMw'
  | 'polarizationDeg'
  | 'diameterMm'
  | 'transmission'
  | 'slitWidthMm'
  | 'gratingPeriodUm'
  | 'apexAngleDeg'
  | 'frontRadiusMm'
  | 'backRadiusMm';

export interface VisualFieldSpec {
  label: string;
  unit: string;
  min: number;
  max: number;
  sliderMin?: number;
  sliderMax?: number;
  step: number;
}

export const VISUAL_FIELD_SPECS: Record<VisualField, VisualFieldSpec> = {
  x: { label: 'X · 前后', unit: 'mm', min: -1000, max: 1000, sliderMin: -500, sliderMax: 800, step: 1 },
  y: { label: 'Y · 高度', unit: 'mm', min: -1000, max: 1000, sliderMin: 0, sliderMax: 500, step: 1 },
  z: { label: 'Z · 左右', unit: 'mm', min: -1000, max: 1000, sliderMin: -500, sliderMax: 800, step: 1 },
  yawDeg: { label: '水平转角', unit: '°', min: -180, max: 180, step: 1 },
  pitchDeg: { label: '俯仰角', unit: '°', min: -90, max: 90, step: 1 },
  rollDeg: { label: '轴向转角', unit: '°', min: -180, max: 180, step: 0.1 },
  focalLengthMm: { label: '焦距', unit: 'mm', min: -5000, max: 5000, sliderMin: -500, sliderMax: 500, step: 1 },
  wavelengthNm: { label: '波长', unit: 'nm', min: 380, max: 1100, step: 1 },
  beamRadiusMm: { label: '光束半径', unit: 'mm', min: 0.01, max: 20, sliderMax: 5, step: 0.01 },
  waistOffsetMm: { label: '束腰距光源', unit: 'mm', min: -2000, max: 2000, sliderMin: -500, sliderMax: 500, step: 0.1 },
  powerMw: { label: '发射功率', unit: 'mW', min: 0, max: 1000, sliderMax: 100, step: 1 },
  polarizationDeg: { label: '偏振角', unit: '°', min: -180, max: 180, step: 1 },
  diameterMm: { label: '通光口径', unit: 'mm', min: 1, max: 200, step: 1 },
  transmission: { label: '透过率', unit: '', min: 0, max: 1, step: 0.01 },
  slitWidthMm: { label: '狭缝宽度', unit: 'mm', min: 0.001, max: 20, sliderMax: 1, step: 0.001 },
  gratingPeriodUm: { label: '光栅周期', unit: 'μm', min: 0.84, max: 400, sliderMax: 50, step: 0.01 },
  apexAngleDeg: { label: '棱镜顶角', unit: '°', min: 20, max: 100, step: 1 },
  frontRadiusMm: { label: '前表面曲率半径', unit: 'mm', min: 1, max: 5000, sliderMax: 200, step: 0.1 },
  backRadiusMm: { label: '后表面曲率半径', unit: 'mm', min: 1, max: 5000, sliderMax: 200, step: 0.1 },
};

export const VISUAL_FIELDS: Record<VisualField, string> = Object.fromEntries(
  Object.entries(VISUAL_FIELD_SPECS).map(([k, spec]) => [k, spec.label]),
) as Record<VisualField, string>;

const ROLL_KINDS = new Set([
  'right-prism',
  'dispersion-prism',
  'slit',
  'amplitude-grating',
  'plano-convex-cylinder-lens',
  'plano-concave-cylinder-lens',
  'cylindrical-lens',
  'polarizer',
  'half-wave-plate',
  'quarter-wave-plate',
]);

const TRANSMISSION_KINDS = new Set([
  'splitter',
  'filter',
  'polarizer',
  'half-wave-plate',
  'quarter-wave-plate',
]);

const DIAMETER_KINDS = new Set([
  'aperture',
  'lens',
  'mirror',
  'splitter',
  'polarizing-splitter',
  'filter',
  'polarizer',
  'half-wave-plate',
  'quarter-wave-plate',
  'screen',
  'power-meter',
  'right-prism',
  'dispersion-prism',
]);

export function allowedVisualFields(element: SpatialElement): VisualField[] {
  const fields: VisualField[] = ['x', 'y', 'z', 'yawDeg', 'pitchDeg'];
  if (ROLL_KINDS.has(element.kind)) fields.push('rollDeg');
  if (element.kind === 'lens' || element.kind === 'cylindrical-lens') fields.push('focalLengthMm');
  if (element.kind === 'laser') {
    fields.push('wavelengthNm', 'beamRadiusMm', 'powerMw');
    if (element.beamModel === 'gaussian') fields.push('waistOffsetMm');
    if (element.polarization === 'linear') fields.push('polarizationDeg');
  } else if (element.kind === 'object') {
    fields.push('wavelengthNm');
  }
  if (DIAMETER_KINDS.has(element.kind) || (isPhysicalLens(element.kind) && !element.kind.includes('cylinder'))) {
    fields.push('diameterMm');
  }
  if (TRANSMISSION_KINDS.has(element.kind)) fields.push('transmission');
  if (element.kind === 'slit') fields.push('slitWidthMm');
  if (element.kind === 'amplitude-grating') fields.push('gratingPeriodUm');
  if (element.kind === 'dispersion-prism') fields.push('apexAngleDeg');
  if (isPhysicalLens(element.kind)) {
    fields.push('frontRadiusMm');
    if (isSphericalLens(element.kind) && !element.kind.startsWith('plano')) {
      fields.push('backRadiusMm');
    }
  }
  return fields;
}

export function formatVisualValue(value: number, field: VisualField): string {
  const unit = VISUAL_FIELD_SPECS[field].unit;
  const num = formatCompact(value, 4);
  if (!unit) return num;
  return unit === '°' ? `${num}°` : `${num} ${unit}`;
}

export interface ResearchVisualAction {
  objectId: string; elementId: string; kind: 'locate' | 'adjust' | 'compare';
  field: VisualField | null; screenId: string | null; explanation: string;
}
export interface ResearchVisualGuide { action: ResearchVisualAction; snapshot: SpatialExperiment; resetToSnapshot?: boolean }

export function visualActionLabel(action: ResearchVisualAction, snapshot: SpatialExperiment) {
  const rawName = snapshot.elements.find(e => e.id === action.elementId)?.name ?? '器件';
  const elementName = cleanElementDisplayName(rawName);
  const fieldLabel = action.field ? VISUAL_FIELDS[action.field] : null;
  const badge = action.kind === 'compare' ? '3D 前后对照' : action.kind === 'adjust' ? '3D 参数定位' : '3D 器件定位';
  return { badge, elementName, fieldLabel };
}

/** Resolve a live spot comparison guide for `compare`, or for `adjust` when a Gaussian beam and screen exist. */
export function resolveComparisonGuide(guide: ResearchVisualGuide): ResearchVisualGuide | null {
  if (guide.action.kind === 'compare' && guide.action.screenId) return guide;
  if (guide.action.kind !== 'adjust') return null;
  const hasGaussian = guide.snapshot.elements.some(e => e.kind === 'laser' && e.beamModel === 'gaussian');
  if (!hasGaussian) return null;
  const target = guide.snapshot.elements.find(e => e.id === guide.action.elementId);
  const screenId = target?.kind === 'screen' ? target.id : guide.snapshot.elements.find(e => e.kind === 'screen')?.id ?? null;
  if (!screenId) return null;
  return { ...guide, action: { ...guide.action, screenId } };
}

const HANDOFF_SCALAR_FIELDS: readonly [keyof SpatialElement, string, string][] = [
  ['focalLengthMm', '焦距', 'mm'],
  ['yawDeg', '水平转角', '°'],
  ['pitchDeg', '俯仰角', '°'],
  ['rollDeg', '轴向转角', '°'],
  ['diameterMm', '口径', 'mm'],
  ['clearApertureMm', '通光口径', 'mm'],
  ['wavelengthNm', '波长', 'nm'],
  ['beamRadiusMm', '光束半径', 'mm'],
  ['waistOffsetMm', '束腰距光源', 'mm'],
  ['powerMw', '发射功率', 'mW'],
  ['divergenceMrad', '发散半角', 'mrad'],
  ['polarizationDeg', '偏振角', '°'],
  ['transmission', '透过率', ''],
  ['pTransmission', 'p偏振透过率', ''],
  ['sTransmission', 's偏振透过率', ''],
  ['slitWidthMm', '狭缝宽度', 'mm'],
  ['slitHeightMm', '狭缝高度', 'mm'],
  ['gratingPeriodUm', '光栅周期', 'μm'],
  ['gratingSlitUm', '条纹宽', 'μm'],
  ['gratingModulation', '调制度', ''],
  ['apexAngleDeg', '顶角', '°'],
  ['prismHeightMm', '棱镜厚度', 'mm'],
  ['refractiveIndex', '折射率', ''],
  ['frontRadiusMm', '前表面曲率半径', 'mm'],
  ['backRadiusMm', '后表面曲率半径', 'mm'],
  ['centerThicknessMm', '中心厚度', 'mm'],
  ['meterRangeMw', '量程', 'mW'],
  ['sensorWidthMm', '感光面宽度', 'mm'],
  ['sensorHeightMm', '感光面高度', 'mm'],
  ['adapterMagnification', '转接倍率', '倍'],
];

const BEAM_MODEL_LABELS = { parallel: '几何光束', gaussian: '高斯光束' } as const;
const POLARIZATION_LABELS = { linear: '线偏振', unpolarized: '未偏振' } as const;
const SLIT_MODE_LABELS = { pass: '通光狭缝', stop: '遮光挡片' } as const;
const GLASS_LABELS = { bk7: 'N-BK7 玻璃', custom: '自定义玻璃' } as const;

function diffElementFields(before: SpatialElement, after: SpatialElement): string[] {
  const changes: string[] = [];
  (['x', 'y', 'z'] as const).forEach((axis, idx) => {
    if (Math.abs(before.position[idx] - after.position[idx]) > 1e-6) {
      changes.push(`${VISUAL_FIELDS[axis]} ${formatCompact(before.position[idx], 4)}→${formatCompact(after.position[idx], 4)} mm`);
    }
  });
  if (before.beamModel !== after.beamModel) {
    changes.push(`光束类型 ${BEAM_MODEL_LABELS[before.beamModel]}→${BEAM_MODEL_LABELS[after.beamModel]}`);
  }
  if (before.polarization !== after.polarization) {
    changes.push(`偏振态 ${POLARIZATION_LABELS[before.polarization]}→${POLARIZATION_LABELS[after.polarization]}`);
  }
  if (before.slitMode !== after.slitMode) {
    changes.push(`狭缝方式 ${SLIT_MODE_LABELS[before.slitMode]}→${SLIT_MODE_LABELS[after.slitMode]}`);
  }
  if (before.glass !== after.glass) {
    changes.push(`材料 ${GLASS_LABELS[before.glass]}→${GLASS_LABELS[after.glass]}`);
  }
  for (const [key, label, unit] of HANDOFF_SCALAR_FIELDS) {
    const bVal = before[key];
    const aVal = after[key];
    if (typeof bVal === 'number' && typeof aVal === 'number' && Math.abs(bVal - aVal) > 1e-6) {
      const unitText = !unit ? '' : unit === '°' || unit === '倍' ? unit : ` ${unit}`;
      changes.push(`${label} ${formatCompact(bVal, 4)}→${formatCompact(aVal, 4)}${unitText}`);
    }
  }
  return changes;
}

function detectorReadoutClause(
  guide: ResearchVisualGuide,
  result: SpatialResult | null,
): string {
  if (!result) return '';
  const effectiveScreenId = resolveComparisonGuide(guide)?.action.screenId ?? guide.action.screenId;
  const preferredScreen = effectiveScreenId
    ? result.screens.find(s => s.elementId === effectiveScreenId)
    : result.screens[0];
  if (preferredScreen) {
    if (preferredScreen.gaussianRadiusMm != null) {
      return `，屏上高斯半径变为 ${formatReadoutWithUnit(preferredScreen.gaussianRadiusMm, 'mm')}`;
    }
    if (preferredScreen.detectorKind === 'power-meter' && preferredScreen.readingMw != null) {
      return `，功率计读数变为 ${formatReadoutWithUnit(preferredScreen.readingMw, 'mW')}`;
    }
    if (preferredScreen.hits > 0 && preferredScreen.footprintRadiusMm != null) {
      return `，屏上光斑覆盖半径变为 ${formatReadoutWithUnit(preferredScreen.footprintRadiusMm, 'mm')}`;
    }
  }
  const obs = result.imaging?.[0]?.observations.find(o => o.kind !== 'eye');
  if (obs) {
    return `，成像状态为${obs.focused ? '已对焦' : '未对焦'}`;
  }
  return '';
}

export function buildVisualHandoffPrompt(
  guide: ResearchVisualGuide,
  current: SpatialExperiment,
  result: SpatialResult | null,
): string | undefined {
  const guidedEl = current.elements.find(e => e.id === guide.action.elementId);
  const baseGuided = guide.snapshot.elements.find(e => e.id === guide.action.elementId);
  const spotClause = detectorReadoutClause(guide, result);

  const baseMap = new Map(guide.snapshot.elements.map(e => [e.id, e]));
  const currentMap = new Map(current.elements.map(e => [e.id, e]));
  const allDiffs: string[] = [];
  for (const el of current.elements) {
    const prev = baseMap.get(el.id);
    if (!prev) {
      allDiffs.push(`新增「${cleanElementDisplayName(el.name)}」`);
      continue;
    }
    const fields = diffElementFields(prev, el);
    if (fields.length) allDiffs.push(`${cleanElementDisplayName(el.name)}（${fields.join('、')}）`);
  }
  for (const prev of guide.snapshot.elements) {
    if (!currentMap.has(prev.id)) allDiffs.push(`移除了「${cleanElementDisplayName(prev.name)}」`);
  }
  if (!allDiffs.length) return undefined;

  const gField = guide.action.field;
  const guidedOnlyFields = guidedEl && baseGuided ? diffElementFields(baseGuided, guidedEl) : [];
  if (allDiffs.length === 1 && guidedOnlyFields.length === 1 && gField && guidedEl) {
    const beforeParam = visualParameter(guide.snapshot, guide.action);
    const afterParam = visualParameter(current, guide.action);
    if (beforeParam != null && afterParam != null && Math.abs(beforeParam - afterParam) > 1e-6) {
      return `我刚在光路搭建中把「${cleanElementDisplayName(guidedEl.name)}」的${VISUAL_FIELDS[gField]}从 ${formatVisualValue(beforeParam, gField)} 调到了 ${formatVisualValue(afterParam, gField)}${spotClause}。请帮我结合物理公式解释这个变化。`;
    }
  }
  return `我刚在光路搭建中调整了装置参数：${allDiffs.slice(0, 4).join('；')}${spotClause}。请结合当前装置帮我解释物理原因。`;
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function validateVisualActions(value: unknown, objects: { id: string; experiment: SpatialExperiment }[]): ResearchVisualAction[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3) throw new Error('画面操作入口无效。');
  return value.map(v => {
    if (!record(v) || typeof v.objectId !== 'string' || typeof v.elementId !== 'string' || !['locate', 'adjust', 'compare'].includes(v.kind as string) || typeof v.explanation !== 'string' || !v.explanation.trim() || v.explanation.length > 240) throw new Error('画面操作入口无效。');
    const experiment = objects.find(o => o.id === v.objectId)?.experiment;
    const element = experiment?.elements.find(e => e.id === v.elementId);
    if (!element) throw new Error('画面操作引用了不存在的器件。');
    const fields = allowedVisualFields(element) as string[];
    if (v.kind === 'locate' ? v.field !== null : typeof v.field !== 'string' || !fields.includes(v.field)) throw new Error('画面操作参数不匹配。');
    if (v.kind === 'compare' ? !experiment!.elements.some(e => e.id === v.screenId && e.kind === 'screen') || !experiment!.elements.some(e => e.kind === 'laser' && e.beamModel === 'gaussian') : v.screenId !== null) throw new Error('前后对照观察屏或光源无效。');
    return { objectId: v.objectId, elementId: v.elementId, kind: v.kind as ResearchVisualAction['kind'], field: v.field as VisualField | null, screenId: v.screenId as string | null, explanation: v.explanation };
  });
}

export function sameVisualSnapshot(a: SpatialExperiment, b: SpatialExperiment) {
  return JSON.stringify(parseSpatial(a)) === JSON.stringify(parseSpatial(b));
}

export function visualParameter(experiment: SpatialExperiment, action: Pick<ResearchVisualAction, 'elementId' | 'field'>): number | null {
  const e = experiment.elements.find(el => el.id === action.elementId);
  if (!e || !action.field) return null;
  if (action.field === 'x' || action.field === 'y' || action.field === 'z') {
    return e.position[{ x: 0, y: 1, z: 2 }[action.field]];
  }
  const value = e[action.field];
  return typeof value === 'number' ? value : null;
}

export function applyVisualFieldPatch(element: SpatialElement, field: VisualField, value: number): Partial<SpatialElement> {
  if (field === 'x' || field === 'y' || field === 'z') {
    const idx = { x: 0, y: 1, z: 2 }[field];
    const position: [number, number, number] = [...element.position];
    position[idx] = value;
    return { position };
  }
  const patch: Partial<SpatialElement> = { [field]: value };
  return isPhysicalLens(element.kind) ? resizeLens(element, patch) : patch;
}

export function visualComparisonStatus(base: SpatialExperiment, current: SpatialExperiment, action: ResearchVisualAction) {
  const target = current.elements.find(e => e.id === action.elementId), original = base.elements.find(e => e.id === action.elementId);
  if (!target || target.kind !== original?.kind || !current.elements.some(e => e.id === action.screenId && e.kind === 'screen')) return 'missing';
  if (sameVisualSnapshot(base, current)) return 'unchanged';
  const expected = structuredClone(base), element = expected.elements.find(e => e.id === action.elementId)!;
  if (action.field) {
    const val = visualParameter(current, { elementId: target.id, field: action.field });
    if (val != null) Object.assign(element, applyVisualFieldPatch(element, action.field, val));
  }
  return sameVisualSnapshot(expected, current) ? 'single' : 'multiple';
}

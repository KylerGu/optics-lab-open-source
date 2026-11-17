import { parseSpatial, type SpatialElement, type SpatialExperiment, type SpatialResult } from './builderModel';
import { cleanElementDisplayName, formatCompact, formatReadoutWithUnit } from './researchUnits';

export type VisualField = 'x' | 'y' | 'z' | 'focalLengthMm';
export interface ResearchVisualAction {
  objectId: string; elementId: string; kind: 'locate' | 'adjust' | 'compare';
  field: VisualField | null; screenId: string | null; explanation: string;
}
export interface ResearchVisualGuide { action: ResearchVisualAction; snapshot: SpatialExperiment; resetToSnapshot?: boolean }
export const VISUAL_FIELDS = { x: 'X · 前后', y: 'Y · 高度', z: 'Z · 左右', focalLengthMm: '焦距' };
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
  ['diameterMm', '口径', 'mm'],
  ['wavelengthNm', '波长', 'nm'],
  ['beamRadiusMm', '光束半径', 'mm'],
  ['powerMw', '功率', 'mW'],
];

function diffElementFields(before: SpatialElement, after: SpatialElement): string[] {
  const changes: string[] = [];
  (['x', 'y', 'z'] as const).forEach((axis, idx) => {
    if (Math.abs(before.position[idx] - after.position[idx]) > 1e-6) {
      changes.push(`${VISUAL_FIELDS[axis]} ${formatCompact(before.position[idx], 4)}→${formatCompact(after.position[idx], 4)} mm`);
    }
  });
  for (const [key, label, unit] of HANDOFF_SCALAR_FIELDS) {
    const bVal = before[key];
    const aVal = after[key];
    if (typeof bVal === 'number' && typeof aVal === 'number' && Math.abs(bVal - aVal) > 1e-6) {
      changes.push(`${label} ${formatCompact(bVal, 4)}→${formatCompact(aVal, 4)}${unit === '°' ? '°' : ` ${unit}`}`);
    }
  }
  return changes;
}

export function buildVisualHandoffPrompt(
  guide: ResearchVisualGuide,
  current: SpatialExperiment,
  result: SpatialResult | null,
): string | undefined {
  const guidedEl = current.elements.find(e => e.id === guide.action.elementId);
  const baseGuided = guide.snapshot.elements.find(e => e.id === guide.action.elementId);
  if (!guidedEl) return undefined;
  const effectiveScreenId = resolveComparisonGuide(guide)?.action.screenId ?? guide.action.screenId;
  const afterR = effectiveScreenId ? result?.screens.find(s => s.elementId === effectiveScreenId)?.gaussianRadiusMm : null;
  const spotClause = afterR != null ? `，屏上高斯半径变为 ${formatReadoutWithUnit(afterR, 'mm')}` : '';

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
  const guidedOnlyFields = baseGuided ? diffElementFields(baseGuided, guidedEl) : [];
  if (allDiffs.length === 1 && guidedOnlyFields.length === 1 && gField) {
    const beforeParam = visualParameter(guide.snapshot, guide.action);
    const afterParam = visualParameter(current, guide.action);
    if (beforeParam != null && afterParam != null && Math.abs(beforeParam - afterParam) > 1e-6) {
      return `我刚在光路搭建中把「${cleanElementDisplayName(guidedEl.name)}」的${VISUAL_FIELDS[gField]}从 ${formatCompact(beforeParam, 4)} mm 调到了 ${formatCompact(afterParam, 4)} mm${spotClause}。请帮我结合物理公式解释这个变化。`;
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
    if (!element || !['lens', 'screen'].includes(element.kind)) throw new Error('画面操作引用了不存在或未支持的器件。');
    const fields = element.kind === 'lens' ? ['x', 'y', 'z', 'focalLengthMm'] : ['x', 'y', 'z'];
    if (v.kind === 'locate' ? v.field !== null : !fields.includes(v.field as string)) throw new Error('画面操作参数不匹配。');
    if (v.kind === 'compare' ? !experiment!.elements.some(e => e.id === v.screenId && e.kind === 'screen') || !experiment!.elements.some(e => e.kind === 'laser' && e.beamModel === 'gaussian') : v.screenId !== null) throw new Error('前后对照观察屏或光源无效。');
    return { objectId: v.objectId, elementId: v.elementId, kind: v.kind as ResearchVisualAction['kind'], field: v.field as VisualField | null, screenId: v.screenId as string | null, explanation: v.explanation };
  });
}
export function sameVisualSnapshot(a: SpatialExperiment, b: SpatialExperiment) {
  return JSON.stringify(parseSpatial(a)) === JSON.stringify(parseSpatial(b));
}
export function visualParameter(experiment: SpatialExperiment, action: ResearchVisualAction): number | null {
  const e = experiment.elements.find(e => e.id === action.elementId);
  if (!e || !action.field) return null;
  return action.field === 'focalLengthMm' ? e.focalLengthMm : e.position[(['x', 'y', 'z'] as string[]).indexOf(action.field)];
}
export function visualComparisonStatus(base: SpatialExperiment, current: SpatialExperiment, action: ResearchVisualAction) {
  const target = current.elements.find(e => e.id === action.elementId), original = base.elements.find(e => e.id === action.elementId);
  if (!target || target.kind !== original?.kind || !current.elements.some(e => e.id === action.screenId && e.kind === 'screen')) return 'missing';
  if (sameVisualSnapshot(base, current)) return 'unchanged';
  const expected = structuredClone(base), element = expected.elements.find(e => e.id === action.elementId)!;
  if (action.field === 'focalLengthMm') element.focalLengthMm = target.focalLengthMm;
  else if (action.field) { const index = ['x', 'y', 'z'].indexOf(action.field); element.position[index] = target.position[index]; }
  return sameVisualSnapshot(expected, current) ? 'single' : 'multiple';
}

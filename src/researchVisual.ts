import { parseSpatial, type SpatialExperiment } from './builderModel';

export type VisualField = 'x' | 'y' | 'z' | 'focalLengthMm';
export interface ResearchVisualAction {
  objectId: string; elementId: string; kind: 'locate' | 'adjust' | 'compare';
  field: VisualField | null; screenId: string | null; explanation: string;
}
export interface ResearchVisualGuide { action: ResearchVisualAction; snapshot: SpatialExperiment }
export const VISUAL_FIELDS = { x: 'X · 前后', y: 'Y · 高度', z: 'Z · 左右', focalLengthMm: '焦距' };
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

import { BUILDER_DRAFT, fromLegacy, parseSpatial, type SpatialExperiment } from './builderModel';
import { DRAFT_KEY, LIBRARY_KEY, parseExperiment, parseLibrary } from './model';
import { readSavedSpatial } from './spatialStorage';
import { CATALOG_SCENES } from './sceneCatalog';
import { GAUSSIAN_DRAFT_KEY, gaussianElements, makeGaussianScene } from './gaussianBeam';

export type ResearchSource = 'saved' | 'draft' | 'scene' | 'file' | 'generated';
export interface ResearchObject {
  id: string; source: ResearchSource; sourceId: string; label: string;
  experiment: SpatialExperiment; snapshotAt: string;
}
export interface ResearchObjectInput { id: string; source: ResearchSource; label: string; experiment: SpatialExperiment }
export interface ObjectChoice { source: ResearchSource; sourceId: string; label: string; name: string; description: string; experiment: SpatialExperiment | null }
export const SOURCE_LABELS: Record<ResearchSource, string> = { saved: '已保存装置', draft: '当前光路草稿', scene: '仿真场景库', file: '装置文件', generated: 'Agent 生成装置' };
export const MAX_RESEARCH_OBJECTS = 6;
export function objectInputs(objects: ResearchObject[]): ResearchObjectInput[] {
  return objects.map(({ id, source, label, experiment }) => ({ id, source, label, experiment }));
}
export function parseObjectInput(value: unknown): ResearchObjectInput {
  const v = value as Partial<ResearchObjectInput> | null;
  if (!v || typeof v.id !== 'string' || !v.id.trim() || v.id.length > 100 || !v.source || !Object.hasOwn(SOURCE_LABELS, v.source)) throw new Error('探究对象格式无效。');
  if (v.label !== undefined && (typeof v.label !== 'string' || v.label.length > 160)) throw new Error('探究对象来源名称无效。');
  return { id: v.id, source: v.source, label: v.label ?? SOURCE_LABELS[v.source], experiment: parseSpatial(v.experiment) };
}
export function parseResearchObject(value: unknown): ResearchObject {
  const input = parseObjectInput(value), v = value as ResearchObject;
  if (typeof v.sourceId !== 'string' || !v.sourceId.trim() || v.sourceId.length > 160 || typeof v.label !== 'string' || !v.label.trim() || v.label.length > 160 || typeof v.snapshotAt !== 'string' || !Number.isFinite(Date.parse(v.snapshotAt))) throw new Error('探究对象来源无效。');
  return { ...input, sourceId: v.sourceId, label: v.label, snapshotAt: v.snapshotAt };
}
export function attachResearchObject(choice: ObjectChoice): ResearchObject {
  if (!choice.experiment) throw new Error('这个场景尚未接入计算，暂时不能用于探究。');
  if (!choice.experiment.elements.length) throw new Error('空装置不能作为探究对象，请先添加器件。');
  return { id: crypto.randomUUID(), source: choice.source, sourceId: choice.sourceId, label: choice.label, experiment: structuredClone(choice.experiment), snapshotAt: new Date().toISOString() };
}
export function importedObjectChoice(value: unknown, filename: string): ObjectChoice {
  const experiment = (value as { schemaVersion?: unknown } | null)?.schemaVersion === 1 ? fromLegacy(parseExperiment(value)) : parseSpatial(value);
  if (!experiment.elements.length) throw new Error('文件中的装置为空，请导入包含器件的装置文件。');
  return { source: 'file', sourceId: crypto.randomUUID(), label: filename.slice(0, 160), name: experiment.name, description: '导入装置文件中的参数', experiment };
}
export function readResearchObjectSources(): { choices: ObjectChoice[]; warnings: string[] } {
  const choices: ObjectChoice[] = [], warnings: string[] = [];
  try {
    choices.push(...readSavedSpatial().map(s => ({ source: 'saved' as const, sourceId: s.id, label: '已保存装置', name: s.experiment.name, description: '保存于 ' + new Date(s.savedAt).toLocaleString('zh-CN'), experiment: s.experiment })));
  } catch { warnings.push('已保存装置暂时无法读取，请到光路搭建中检查。'); }
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (raw) choices.push(...parseLibrary(JSON.parse(raw)).map(s => ({ source: 'saved' as const, sourceId: 'legacy:' + s.id, label: '早期保存装置', name: s.experiment.name, description: '已转换为当前装置格式', experiment: fromLegacy(s.experiment) })));
  } catch { warnings.push('早期装置存档暂时无法读取。'); }
  try {
    const raw = localStorage.getItem(BUILDER_DRAFT), legacy = raw ? null : localStorage.getItem(DRAFT_KEY);
    const experiment = raw ? parseSpatial(JSON.parse(raw)) : legacy ? fromLegacy(JSON.parse(legacy)) : null;
    if (experiment?.elements.length) choices.push({ source: 'draft', sourceId: 'draft', label: '当前光路草稿', name: experiment.name, description: '未保存的参数也可选入，之后独立保留', experiment });
  } catch { warnings.push('当前光路草稿暂时无法读取。'); }
  let gaussian: SpatialExperiment | null = null, sceneLabel = '场景默认参数';
  try {
    const raw = localStorage.getItem(GAUSSIAN_DRAFT_KEY);
    const original = raw ? JSON.parse(raw) : makeGaussianScene();
    gaussianElements(original); gaussian = fromLegacy(original);
    if (raw) sceneLabel = '场景中最近保存的参数';
    else gaussian.elements = gaussian.elements.map(e => ({ ...e, id: 'scene-gaussian-' + e.kind }));
  } catch { warnings.push('高斯场景保存的参数无法读取，请先在场景库中检查。'); }
  choices.push(...CATALOG_SCENES.map(s => ({ source: 'scene' as const, sourceId: s.id, label: s.title, name: s.title, description: s.available ? sceneLabel + ' · 理想高斯自由传播' : '场景计算暂未实现', experiment: s.available && gaussian ? { ...structuredClone(gaussian), name: s.title } : null })));
  return { choices, warnings };
}
export function refreshedResearchObject(object: ResearchObject, choices: ObjectChoice[]): ResearchObject {
  const choice = choices.find(c => c.source === object.source && c.sourceId === object.sourceId);
  if (!choice?.experiment) throw new Error('原对象暂时无法读取，可能已被删除。可以重新选择或导入。');
  const experiment = structuredClone(choice.experiment);
  if (object.source === 'scene') experiment.elements = experiment.elements.map(e => ({ ...e, id: object.experiment.elements.find(old => old.kind === e.kind)?.id ?? e.id }));
  return { ...object, experiment, snapshotAt: new Date().toISOString() };
}

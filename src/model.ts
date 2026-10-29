export type ElementKind = 'laser' | 'lens' | 'screen';
interface ElementBase { id: string; kind: ElementKind; name: string; positionMm: number }
export interface Laser extends ElementBase { kind: 'laser'; wavelengthNm: number; waistMm: number }
export interface Lens extends ElementBase { kind: 'lens'; focalLengthMm: number; diameterMm: number }
export interface Screen extends ElementBase { kind: 'screen'; sizeMm: number }
export type OpticalElement = Laser | Lens | Screen;
export interface Experiment { schemaVersion: 1; name: string; railLengthMm: 600; elements: OpticalElement[] }
export interface SavedExperiment { id: string; savedAt: string; experiment: Experiment }
export interface History { past: Experiment[]; present: Experiment; future: Experiment[] }
export type HistoryAction = { type: 'commit'; experiment: Experiment } | { type: 'undo' } | { type: 'redo' };

export const DRAFT_KEY = 'optics-lab-draft-v1';
export const LIBRARY_KEY = 'optics-lab-library-v1';
export const KIND_LABELS: Record<ElementKind, string> = { laser: '激光光源', lens: '理想薄透镜', screen: '观察屏' };

export function makeElement(kind: ElementKind, positionMm: number): OpticalElement {
  const base = { id: crypto.randomUUID(), name: KIND_LABELS[kind], positionMm };
  if (kind === 'laser') return { ...base, kind, wavelengthNm: 532, waistMm: 1 };
  if (kind === 'lens') return { ...base, kind, focalLengthMm: 100, diameterMm: 25.4 };
  return { ...base, kind, sizeMm: 40 };
}

export function makeTemplate(template: 'expander' | 'focus' | 'empty' = 'expander'): Experiment {
  if (template === 'empty') return { schemaVersion: 1, name: '我的光学实验', railLengthMm: 600, elements: [] };
  const laser = makeElement('laser', 30);
  const lens = makeElement('lens', template === 'focus' ? 250 : 180) as Lens;
  const screen = makeElement('screen', template === 'focus' ? 350 : 520);
  return {
    schemaVersion: 1, name: template === 'focus' ? '单透镜聚焦 · 装置模板' : '双透镜扩束 · 装置模板', railLengthMm: 600,
    elements: template === 'focus' ? [laser, lens, screen] : [laser, lens, { ...makeElement('lens', 430), focalLengthMm: 150 } as Lens, screen],
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const numberIn = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const textIn = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

// Only canonical, validated fields are copied into the experiment; imported text never executes.
export function parseExperiment(value: unknown): Experiment {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.railLengthMm !== 600 || !textIn(value.name, 80)) {
    throw new Error('实验格式不兼容，请使用光学智研导出的实验文件。');
  }
  if (!Array.isArray(value.elements) || value.elements.length > 50) throw new Error('实验最多支持50个元件。');
  const ids = new Set<string>();
  let lasers = 0;
  const elements = value.elements.map((raw): OpticalElement => {
    if (!isRecord(raw) || !textIn(raw.id, 100) || !textIn(raw.name, 40) || !numberIn(raw.positionMm, 0, 600)) {
      throw new Error('元件名称或位置无效，位置必须在0–600 mm之间。');
    }
    const id = raw.id as string;
    if (ids.has(id)) throw new Error('实验中存在重复元件编号。');
    ids.add(id);
    const base = { id, name: raw.name as string, positionMm: raw.positionMm as number };
    if (raw.kind === 'laser') {
      if (++lasers > 1) throw new Error('当前同轴实验只支持一个光源。');
      if (!numberIn(raw.wavelengthNm, 380, 1100) || !numberIn(raw.waistMm, 0.01, 20)) throw new Error('光源参数超出支持范围。');
      return { ...base, kind: 'laser', wavelengthNm: raw.wavelengthNm as number, waistMm: raw.waistMm as number };
    }
    if (raw.kind === 'lens') {
      if (!numberIn(raw.focalLengthMm, -5000, 5000) || Math.abs(raw.focalLengthMm as number) < 1 || !numberIn(raw.diameterMm, 1, 100)) {
        throw new Error('透镜焦距绝对值需为1–5000 mm，直径需为1–100 mm。');
      }
      return { ...base, kind: 'lens', focalLengthMm: raw.focalLengthMm as number, diameterMm: raw.diameterMm as number };
    }
    if (raw.kind === 'screen') {
      if (!numberIn(raw.sizeMm, 5, 100)) throw new Error('观察屏边长需为5–100 mm。');
      return { ...base, kind: 'screen', sizeMm: raw.sizeMm as number };
    }
    throw new Error('文件包含当前阶段不支持的元件。');
  });
  return { schemaVersion: 1, name: value.name as string, railLengthMm: 600, elements };
}

export function parseLibrary(value: unknown): SavedExperiment[] {
  if (!Array.isArray(value) || value.length > 40) throw new Error('实验库格式无效。');
  const ids = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item) || !textIn(item.id, 100) || typeof item.savedAt !== 'string' || !Number.isFinite(Date.parse(item.savedAt))) throw new Error('实验库记录无效。');
    if (ids.has(item.id as string)) throw new Error('实验库包含重复记录。');
    ids.add(item.id as string);
    return { id: item.id as string, savedAt: item.savedAt, experiment: parseExperiment(item.experiment) };
  });
}

export function historyReducer(state: History, action: HistoryAction): History {
  if (action.type === 'commit') {
    if (JSON.stringify(action.experiment) === JSON.stringify(state.present)) return state;
    const next = parseExperiment(action.experiment);
    return { past: [...state.past, state.present].slice(-80), present: next, future: [] };
  }
  if (action.type === 'undo') {
    if (!state.past.length) return state;
    return { past: state.past.slice(0, -1), present: state.past.at(-1)!, future: [state.present, ...state.future] };
  }
  if (!state.future.length) return state;
  return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) };
}

export function findFreePosition(elements: OpticalElement[]): number {
  for (let position = 250; position <= 590; position += 30) {
    if (elements.every((element) => Math.abs(element.positionMm - position) >= 20)) return position;
  }
  for (let position = 20; position < 250; position += 30) {
    if (elements.every((element) => Math.abs(element.positionMm - position) >= 20)) return position;
  }
  return 300;
}

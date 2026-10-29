import { parseExperiment, type Experiment } from './model';
import { experimentKey, type BeamSample } from './simulation';
import { validateFocusDesign, type FocusDesign } from './research';
import { validateStabilityStudy, type StabilityStudy } from './tolerance';

export interface Evidence {
  modelVersion: string; quality: 'within-model' | 'reference-only'; minimum: BeamSample;
  warnings: string[]; assumptions: string[];
  screens: {elementId: string; name: string; positionMm: number; radiusMm: number; capturedFraction: number}[];
  gaussian?: {
    wavelengthNm: number; waistMm: number; waistPositionMm: number; observationPositionMm: number;
    distanceMm: number; radiusMm: number; rayleighMm: number; divergenceMrad: number;
    wavefrontRadiusMm: number; peakRelativeToWaist: number; region: 'near' | 'transition' | 'far';
  };
}
export interface Scan {
  id: string; elementId: string; elementName: string; field: string; fieldLabel: string; unit: 'mm' | 'nm';
  inputSnapshot: Experiment;
  rows: {value: number; result: Evidence | null; error: string | null}[];
}
export interface AgentReply {
  requestId: string; model: string; inputSnapshot: Experiment; experiment: Experiment; changed: boolean; answer: string;
  trace: {name: string; status: 'ok' | 'error'; summary: string}[]; evidence: Evidence | null; scans: Scan[]; designs: FocusDesign[]; studies: StabilityStudy[];
}
export interface ConversationMessage { role: 'user' | 'assistant'; content: string }

export function isAssistantConnectionError(error: unknown): boolean {
  return error instanceof Error && (error instanceof TypeError || /failed to fetch|networkerror|network request failed|load failed/i.test(error.message));
}

export function assistantErrorMessage(error: unknown): string {
  if (isAssistantConnectionError(error)) return '连接中断，未收到回复，场景未改动。请检查网络连接，稍后重试此问题。';
  if (error instanceof Error && error.message === '观察屏数据无效。') return '回复已返回，但网站无法读取其中的观察屏计算结果，本轮结果未载入。可以重试此问题；若再次出现，请保留问题和装置以便排查。';
  return error instanceof Error ? error.message : '请求失败，场景未改动。';
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function evidence(value: unknown): asserts value is Evidence {
  if (!record(value) || typeof value.modelVersion !== 'string' || !['within-model', 'reference-only'].includes(value.quality as string) || !record(value.minimum) || !finite(value.minimum.positionMm) || !finite(value.minimum.radiusMm) || value.minimum.radiusMm <= 0 || !Array.isArray(value.warnings) || !value.warnings.every(item => typeof item === 'string') || !Array.isArray(value.assumptions) || !value.assumptions.every(item => typeof item === 'string') || !Array.isArray(value.screens) || value.screens.length > 50) throw new Error('助手计算依据格式无效。');
  for (const screen of value.screens) if (!record(screen) || typeof screen.elementId !== 'string' || typeof screen.name !== 'string' || !finite(screen.positionMm) || !finite(screen.radiusMm) || screen.radiusMm <= 0 || !finite(screen.capturedFraction) || screen.capturedFraction < 0 || screen.capturedFraction > 1) throw new Error('助手观察屏数据无效。');
  if (value.gaussian !== undefined) {
    const beam = value.gaussian;
    if (!record(beam) || !['wavelengthNm', 'waistMm', 'waistPositionMm', 'observationPositionMm', 'distanceMm', 'radiusMm', 'rayleighMm', 'divergenceMrad', 'wavefrontRadiusMm', 'peakRelativeToWaist'].every(field => finite(beam[field])) || !['near', 'transition', 'far'].includes(beam.region as string) || (beam.distanceMm as number) <= 0 || (beam.radiusMm as number) <= 0 || (beam.rayleighMm as number) <= 0) throw new Error('助手高斯光束读数无效。');
  }
}

export function validateAgentReply(value: unknown, requestId: string, snapshotKey: string): AgentReply {
  if (!record(value) || value.requestId !== requestId || typeof value.model !== 'string' || typeof value.answer !== 'string' || !value.answer.trim() || value.answer.length > 12000 || typeof value.changed !== 'boolean') throw new Error('助手响应与当前请求不一致。');
  const original = parseExperiment(value.inputSnapshot), experiment = parseExperiment(value.experiment);
  if (experimentKey(original) !== snapshotKey || value.changed !== (experimentKey(original) !== experimentKey(experiment))) throw new Error('助手返回的装置参数不匹配。');
  if (!Array.isArray(value.trace) || value.trace.length > 17 || !value.trace.every(item => record(item) && typeof item.name === 'string' && ['ok', 'error'].includes(item.status as string) && typeof item.summary === 'string')) throw new Error('助手操作记录无效。');
  if (value.evidence !== null) evidence(value.evidence);
  if (value.changed && value.evidence === null) throw new Error('助手方案缺少计算核对，尚未应用。');
  if (!Array.isArray(value.scans) || value.scans.length > 2) throw new Error('助手参数比较数据无效。');
  for (const scan of value.scans) {
    if (!record(scan) || !['id', 'elementId', 'elementName', 'field', 'fieldLabel'].every(field => typeof scan[field] === 'string') || !['mm', 'nm'].includes(scan.unit as string) || !Array.isArray(scan.rows) || scan.rows.length < 3 || scan.rows.length > 21) throw new Error('参数比较格式无效。');
    parseExperiment(scan.inputSnapshot);
    for (const row of scan.rows) {
      if (!record(row) || !finite(row.value) || !((row.result === null && typeof row.error === 'string') || (row.result !== null && row.error === null))) throw new Error('参数比较结果无效。');
      if (row.result !== null) evidence(row.result);
    }
  }
  if(!Array.isArray(value.designs) || value.designs.length>1) throw new Error('助手设计结果无效。');
  const designs=value.designs.map(item=>validateFocusDesign(item));
  if(!Array.isArray(value.studies) || value.studies.length>2) throw new Error('助手误差分析结果无效。');
  const studies=value.studies.map(item=>validateStabilityStudy(item));
  return {...value, inputSnapshot: original, experiment, designs, studies} as unknown as AgentReply;
}

export function scanCSV(scan: Scan): string {
  const cell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const safe = (value: string) => /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  const reference = scan.rows.find(row=>row.result)?.result;
  const rows: (string | number)[][] = [
    ['model_version', reference?.modelVersion ?? ''], ['radius_definition', '1/e^2 intensity radius'],
    ['assumptions', safe(reference?.assumptions.join(' | ') ?? '')],
    ['element', safe(scan.elementName)], ['parameter', scan.field], ['parameter_unit', scan.unit],
    ['input_snapshot_json', JSON.stringify(scan.inputSnapshot)],
    ['value', 'minimum_radius_mm', 'minimum_position_mm', 'quality', 'screen_results_json', 'warnings', 'error'],
    ...scan.rows.map(row => [row.value, row.result?.minimum.radiusMm ?? '', row.result?.minimum.positionMm ?? '', row.result?.quality ?? '', JSON.stringify(row.result?.screens ?? []), safe(row.result?.warnings.join(' | ') ?? ''), safe(row.error ?? '')]),
  ];
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}

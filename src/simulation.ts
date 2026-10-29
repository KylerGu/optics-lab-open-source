import { parseExperiment, type Experiment } from './model';

export interface BeamSample { positionMm: number; radiusMm: number }
export interface RayPath { initialHeightMm: number; points: { positionMm: number; heightMm: number }[]; blockedBy: string | null }
export interface ScreenResult {
  elementId: string; name: string; positionMm: number; radiusMm: number; sizeMm: number; halfExtentMm: number;
  capturedFraction: number; peakRelativeToSource: number;
  profile: { offsetMm: number; relativeIntensity: number }[];
}
export interface SimulationResult {
  revision: number; modelVersion: string; inputSnapshot: Experiment; quality: 'reference-only' | 'within-model';
  warnings: string[]; assumptions: string[]; sourcePositionMm: number; rayleighRangeMm: number;
  minimum: BeamSample; samples: BeamSample[]; rayPaths: RayPath[]; screens: ScreenResult[];
  apertureChecks: { elementId: string; name: string; radiusMm: number; clippedFraction: number }[];
  endMatrix: { A: number; B: number; C: number; D: number };
}

export const experimentKey = (experiment: Experiment) => JSON.stringify(parseExperiment(experiment));

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown) => finite(value) && value > 0;
const fraction = (value: unknown) => finite(value) && value >= 0 && value <= 1;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

// Reject responses from another request before any chart or scene receives them.
export function validateResult(value: unknown, revision: number, key: string): SimulationResult {
  if (!record(value) || value.revision !== revision || typeof value.modelVersion !== 'string' || !record(value.inputSnapshot)) throw new Error('计算响应与当前请求不一致。');
  if (experimentKey(parseExperiment(value.inputSnapshot)) !== key) throw new Error('计算响应的实验参数不匹配。');
  if (!Array.isArray(value.samples) || value.samples.length < 2 || value.samples.length > 800 || !Array.isArray(value.rayPaths) || value.rayPaths.length !== 9 || !Array.isArray(value.screens) || value.screens.length > 50) throw new Error('计算响应格式无效。');
  let previous = -Infinity;
  for (const sample of value.samples) {
    if (!record(sample) || !finite(sample.positionMm) || !positive(sample.radiusMm) || sample.positionMm < previous) throw new Error('光束采样数据无效。');
    previous = sample.positionMm;
  }
  for (const path of value.rayPaths) {
    if (!record(path) || !finite(path.initialHeightMm) || !Array.isArray(path.points) || path.points.length < 2 || path.points.length > 52 || !(path.blockedBy === null || typeof path.blockedBy === 'string')) throw new Error('光线数据无效。');
    for (const point of path.points) if (!record(point) || !finite(point.positionMm) || !finite(point.heightMm)) throw new Error('光线坐标无效。');
  }
  for (const screen of value.screens) {
    if (!record(screen) || typeof screen.elementId !== 'string' || typeof screen.name !== 'string' || !positive(screen.radiusMm) || !finite(screen.positionMm) || !positive(screen.sizeMm) || !positive(screen.halfExtentMm) || !fraction(screen.capturedFraction) || !positive(screen.peakRelativeToSource) || !Array.isArray(screen.profile) || screen.profile.length !== 129) throw new Error('观察屏数据无效。');
    for (const point of screen.profile) if (!record(point) || !finite(point.offsetMm) || !fraction(point.relativeIntensity)) throw new Error('观察屏光强无效。');
  }
  if (!record(value.minimum) || !finite(value.minimum.positionMm) || !positive(value.minimum.radiusMm) || !positive(value.rayleighRangeMm) || !finite(value.sourcePositionMm)) throw new Error('光束摘要无效。');
  if (!record(value.endMatrix) || !['A', 'B', 'C', 'D'].every((field) => finite((value.endMatrix as Record<string, unknown>)[field]))) throw new Error('光学矩阵无效。');
  if (!['reference-only', 'within-model'].includes(value.quality as string) || !Array.isArray(value.warnings) || !value.warnings.every((message) => typeof message === 'string') || !Array.isArray(value.assumptions) || !value.assumptions.every((message) => typeof message === 'string')) throw new Error('模型说明无效。');
  if (!Array.isArray(value.apertureChecks) || !value.apertureChecks.every((item) => record(item) && typeof item.elementId === 'string' && typeof item.name === 'string' && positive(item.radiusMm) && fraction(item.clippedFraction))) throw new Error('口径检查无效。');
  return value as unknown as SimulationResult;
}

export function simulationCSV(result: SimulationResult): string {
  const quote = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  // Metadata is non-executable text; element names are prefixed if they could be spreadsheet formulas.
  const safe = (value: string) => /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  const rows: (string | number)[][] = [
    ['model_version', result.modelVersion], ['quality', result.quality], ['experiment', safe(result.inputSnapshot.name)],
    ['radius_definition', '1/e^2 intensity radius'], ['wavelength_nm', result.inputSnapshot.elements.find((item) => item.kind === 'laser')?.wavelengthNm ?? ''],
    ['assumptions', safe(result.assumptions.join(' | '))], ['warnings', safe(result.warnings.join(' | '))],
    ['input_snapshot_json', JSON.stringify(result.inputSnapshot)], [],
    ['position_mm', 'beam_radius_mm'], ...result.samples.map((sample) => [sample.positionMm, sample.radiusMm]), [],
    ['screen', 'position_mm', 'beam_radius_mm', 'square_capture_fraction_ideal', 'peak_relative_to_source'],
    ...result.screens.map((screen) => [safe(screen.name), screen.positionMm, screen.radiusMm, screen.capturedFraction, screen.peakRelativeToSource]),
  ];
  return '\uFEFF' + rows.map((row) => row.map(quote).join(',')).join('\r\n');
}

export function beamDisplayScale(result: SimulationResult | null): number {
  if (!result) return 1;
  const maximum = Math.max(...result.samples.map((point) => point.radiusMm), ...result.rayPaths.flatMap((ray) => ray.points.map((point) => Math.abs(point.heightMm))));
  return Math.min(10, 26 / maximum);
}

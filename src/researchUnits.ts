import { COMPARISON_LABELS } from './spatialAgent';
import type { ResearchArtifact } from './ResearchResults';
import type { ResearchResultRecord } from './researchResultRecords';
import { SCENE_DEFINITIONS } from './sceneRuntime';

export interface UnitDisplay {
  unit: string;
  factor: number;
}

export const RECORD_BADGES: Record<ResearchArtifact['kind'], string> = {
  comparison: '扫描',
  simulation: '仿真',
  design: '设计',
  study: '误差',
  objects: '对比',
  model: '模型',
};

/** Clamp sub-picometer / floating-point intersection noise (< 1e-7) cleanly to zero. */
export function clampZero(value: number, epsilon = 1e-7): number {
  if (!Number.isFinite(value)) return value;
  return Math.abs(value) < epsilon ? 0 : value;
}

const REDUNDANT_MOBILITY_NOTE =
  /[（(]\s*(?:可|支持|允许)?\s*(?:沿|延|沿着)?\s*(?:光轴|X轴?|Y轴?|Z轴?|轴线|前后|左右|上下)?\s*(?:自由)?(?:移动|调节|调整|拖动|滑动|改变)(?:位置)?\s*[)）]/gi;

/** Strip redundant UI mobility annotations (e.g. "（可沿光轴移动）") from element display names. */
export function cleanElementDisplayName(name: string): string {
  const cleaned = name
    .replace(REDUNDANT_MOBILITY_NOTE, '')
    .replace(/\s*[·・\-]\s*可(?:沿|延)光轴(?:移动|调节)\s*$/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || name.trim();
}

/** Format a numeric readout cleanly without excessive trailing digits. */
export function formatCompact(value: number, sigFigs = 3): string {
  if (!Number.isFinite(value)) return '—';
  const clean = clampZero(value);
  if (clean === 0) return '0';
  const abs = Math.abs(clean);
  if (abs < 0.001 || abs >= 100000) return clean.toExponential(Math.max(1, sigFigs - 1));
  return Number(clean.toPrecision(sigFigs)).toString();
}

export function formatScaled(value: number, display: UnitDisplay, sigFigs = 3): string {
  if (!Number.isFinite(value)) return '—';
  const clean = clampZero(value);
  return formatCompact(clean * display.factor, sigFigs);
}

/** Format a single standalone KPI value with its own most readable unit. */
export function formatReadoutWithUnit(value: number, baseUnit: string, sigFigs = 3): string {
  if (!Number.isFinite(value)) return '—';
  const clean = clampZero(value);
  if (clean === 0) return baseUnit ? `0 ${baseUnit}` : '0';
  if (baseUnit === 'mm') {
    const abs = Math.abs(clean);
    if (abs < 0.0005) return `${formatCompact(clean * 1_000_000, sigFigs)} nm`;
    if (abs < 0.2) return `${formatCompact(clean * 1000, sigFigs)} μm`;
    return `${formatCompact(clean, sigFigs)} mm`;
  }
  if (baseUnit === 'mW') {
    const abs = Math.abs(clean);
    if (abs < 0.2) return `${formatCompact(clean * 1000, sigFigs)} μW`;
    return `${formatCompact(clean, sigFigs)} mW`;
  }
  return baseUnit ? `${formatCompact(clean, sigFigs)} ${baseUnit}` : formatCompact(clean, sigFigs);
}

function seriesStats(values: readonly (number | null | undefined)[]): { sorted: number[]; median: number; maxAbs: number } | null {
  const nonZero: number[] = [];
  let maxAbs = 0;
  for (const raw of values) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const clean = Math.abs(clampZero(raw));
    if (clean > maxAbs) maxAbs = clean;
    if (clean > 0) nonZero.push(clean);
  }
  if (!nonZero.length) return null;
  nonZero.sort((a, b) => a - b);
  return { sorted: nonZero, median: nonZero[Math.floor(nonZero.length / 2)], maxAbs };
}

/**
 * Pick one display unit for a whole chart/table based on its median non-zero magnitude
 * (not an isolated near-zero focal point), keeping floating-point zeros in base units.
 */
export function chooseLengthDisplay(valuesMm: readonly (number | null | undefined)[]): UnitDisplay {
  const stats = seriesStats(valuesMm);
  if (!stats) return { unit: 'mm', factor: 1 };
  if (stats.median < 0.0005 && stats.maxAbs < 0.05) return { unit: 'nm', factor: 1_000_000 };
  if (stats.median < 0.2 && stats.maxAbs <= 5) return { unit: 'μm', factor: 1000 };
  return { unit: 'mm', factor: 1 };
}

export function choosePowerDisplay(valuesMw: readonly (number | null | undefined)[]): UnitDisplay {
  const stats = seriesStats(valuesMw);
  if (!stats) return { unit: 'mW', factor: 1 };
  if (stats.median < 0.2 && stats.maxAbs <= 5) return { unit: 'μW', factor: 1000 };
  return { unit: 'mW', factor: 1 };
}

export function chooseUnitForMetric(unit: string, values: readonly (number | null | undefined)[]): UnitDisplay {
  if (unit === 'mm') return chooseLengthDisplay(values);
  if (unit === 'mW') return choosePowerDisplay(values);
  return { unit, factor: 1 };
}

export function hasMetricVariation(values: readonly (number | null | undefined)[]): boolean {
  const valid = values
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .map(v => clampZero(v));
  if (valid.length < 2) return valid.length === 1;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  return max - min > 1e-6 * Math.max(1, Math.abs(max));
}

/** Compute clean 1/2/2.5/5 * 10^n axis ticks covering [minValue, maxValue]. */
export function niceAxisRange(
  minValue: number,
  maxValue: number,
  targetIntervals = 3,
): { low: number; high: number; ticks: number[] } {
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    return { low: 0, high: 1, ticks: [0, 0.5, 1] };
  }
  let lo = Math.min(minValue, maxValue);
  let hi = Math.max(minValue, maxValue);
  if (lo >= 0 && lo <= hi * 0.35) lo = 0;
  if (hi === lo) {
    if (lo === 0) return { low: 0, high: 1, ticks: [0, 0.5, 1] };
    const pad = Math.abs(lo) * 0.2;
    lo = lo >= 0 && lo - pad <= 0 ? 0 : lo - pad;
    hi = hi + pad;
  }
  const rawStep = (hi - lo) / Math.max(1, targetIntervals);
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  const stepBase = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  const step = stepBase * mag;
  const low = lo === 0 ? 0 : Math.floor(lo / step + 1e-9) * step;
  const high = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  const count = Math.min(8, Math.max(2, Math.round((high - low) / step) + 1));
  for (let i = 0; i < count; i++) {
    const tick = Number((low + i * step).toPrecision(12));
    ticks.push(Object.is(tick, -0) ? 0 : tick);
  }
  return { low: ticks[0], high: ticks.at(-1)!, ticks };
}

export function niceXTicks(xs: readonly number[], maxTicks = 5): number[] {
  if (!xs.length) return [];
  if (xs.length <= maxTicks) return [...xs];
  const step = Math.max(1, Math.ceil((xs.length - 1) / (maxTicks - 1)));
  const picks: number[] = [];
  for (let i = 0; i < xs.length; i += step) picks.push(xs[i]);
  if (picks.at(-1) !== xs.at(-1)) picks.push(xs.at(-1)!);
  return picks;
}

function splitLabelUnit(raw: string): { label: string; unit: string } {
  const matched = raw.match(/^(.+?)（([^）]+)）$/);
  return matched ? { label: matched[1], unit: matched[2] } : { label: raw, unit: '' };
}

function formatValueRange(values: readonly number[], unit: string): string {
  const finite = values.filter(v => Number.isFinite(v));
  if (!finite.length) return '';
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const unitSuffix = unit ? (unit === '°' ? '°' : ` ${unit}`) : '';
  return lo === hi
    ? `${formatCompact(lo, 4)}${unitSuffix}`
    : `${formatCompact(lo, 4)}→${formatCompact(hi, 4)}${unitSuffix}`;
}

export function recordRangeText(record: ResearchResultRecord): string {
  const primary = record.artifacts.find(a => a.id === record.primaryId) ?? record.artifacts[0];
  if (!primary) return '';
  if (primary.kind === 'comparison' && primary.data.rows.length > 0) {
    const { unit } = splitLabelUnit(COMPARISON_LABELS[primary.data.field] ?? primary.data.field);
    return formatValueRange(primary.data.rows.map(r => r.value), unit);
  }
  if (primary.kind === 'model' && primary.data.scans[0]?.rows.length) {
    const scan = primary.data.scans[0];
    const param = SCENE_DEFINITIONS[primary.data.state.sceneId]?.parameters.find(p => p.key === scan.field);
    return formatValueRange(scan.rows.map(r => r.value), param?.unit ?? '');
  }
  return '';
}

export function shortRecordTitle(record: ResearchResultRecord): string {
  const primary = record.artifacts.find(a => a.id === record.primaryId) ?? record.artifacts[0];
  if (!primary) return record.title;
  if (primary.kind === 'comparison') {
    const { label } = splitLabelUnit(COMPARISON_LABELS[primary.data.field] ?? primary.data.field);
    return `${label}比较`;
  }
  const parts = record.title.split(' · ');
  if (parts.length > 1) return parts.slice(-1)[0];
  return record.title;
}

export function recordSidebarTitle(record: ResearchResultRecord, showObjectPrefix = true): string {
  const primary = record.artifacts.find(a => a.id === record.primaryId) ?? record.artifacts[0];
  if (!primary) return record.title;
  if (primary.kind === 'comparison') {
    if (!primary.data.rows.length) return record.title;
    const { label } = splitLabelUnit(COMPARISON_LABELS[primary.data.field] ?? primary.data.field);
    const range = recordRangeText(record);
    const base = range ? `${label} ${range}` : `${label}比较`;
    if (!showObjectPrefix) return base;
    const prefix = record.title.split(' · ')[0];
    return prefix && prefix !== base ? `${prefix} · ${base}` : base;
  }
  if (primary.kind === 'model' && primary.data.scans[0]?.rows.length) {
    const scan = primary.data.scans[0];
    const param = SCENE_DEFINITIONS[primary.data.state.sceneId]?.parameters.find(p => p.key === scan.field);
    const label = param?.label ?? scan.field;
    const range = recordRangeText(record);
    const base = range ? `${label} ${range}` : shortRecordTitle(record);
    if (!showObjectPrefix) return base;
    const prefix = record.title.split(' · ')[0];
    return prefix && prefix !== base ? `${prefix} · ${base}` : base;
  }
  if (primary.kind === 'simulation' && primary.data.screens.length > 0) {
    const screenName = cleanElementDisplayName(primary.data.screens[0].name);
    const base = `单点仿真 · ${screenName}`;
    if (!showObjectPrefix) return base;
    const prefix = record.title.split(' · ')[0];
    return prefix && prefix !== base ? `${prefix} · ${base}` : base;
  }
  return showObjectPrefix ? record.title : shortRecordTitle(record);
}

export function summarizeRecord(record: ResearchResultRecord): { badge: string; summary: string } {
  const primary = record.artifacts.find(a => a.id === record.primaryId) ?? record.artifacts[0];
  if (!primary) return { badge: '记录', summary: '' };
  const badge = RECORD_BADGES[primary.kind];

  if (primary.kind === 'comparison') {
    const { data } = primary;
    if (!data.rows.length) return { badge, summary: '' };
    const screens = [...new Map(data.rows.flatMap(r => r.error ? [] : r.screens).map(s => [s.elementId, s])).values()];
    const screen = screens[0];
    if (!screen) return { badge, summary: `${data.rows.length} 点扫描` };
    const useGaussian = screens.some(s => s.gaussianRadiusMm !== null);
    const useFootprint = !useGaussian && screens.some(s => s.footprintRadiusMm !== null);
    const metric = useGaussian ? 'gaussianRadiusMm' : useFootprint ? 'footprintRadiusMm' : 'sampledPowerMw';
    const valid = data.rows.flatMap(r => {
      const value = r.error ? null : r.screens.find(s => s.elementId === screen.elementId)?.[metric];
      return typeof value === 'number' && Number.isFinite(value) ? [{ x: r.value, y: clampZero(value) }] : [];
    });
    if (!valid.length) return { badge, summary: `${data.rows.length} 点扫描` };
    const min = valid.reduce((a, b) => (b.y < a.y ? b : a));
    const fieldLabel = (COMPARISON_LABELS[data.field] ?? data.field).replace(/（[^）]*）/, '');
    const prefix = useGaussian ? '最小光斑' : useFootprint ? '最小覆盖' : '最小功率';
    return {
      badge,
      summary: `${prefix} ${formatReadoutWithUnit(min.y, metric === 'sampledPowerMw' ? 'mW' : 'mm')} (${fieldLabel} ${formatCompact(min.x, 4)})`,
    };
  }

  if (primary.kind === 'simulation') {
    const screen = primary.data.screens[0];
    if (!screen) return { badge, summary: '' };
    if (screen.gaussianRadiusMm !== null) {
      return { badge, summary: `高斯半径 ${formatReadoutWithUnit(screen.gaussianRadiusMm, 'mm')}` };
    }
    return { badge, summary: `采样功率 ${formatReadoutWithUnit(screen.sampledPowerMw, 'mW')}` };
  }

  if (primary.kind === 'design') {
    const rec = primary.data.recommendation;
    if (!rec) return { badge, summary: '暂无可推荐方案' };
    return {
      badge,
      summary: rec.radiusMm === null
        ? `推荐方案 · f=${formatCompact(rec.focalLengthMm, 4)} mm`
        : `推荐 ${formatReadoutWithUnit(rec.radiusMm, 'mm')} · f=${formatCompact(rec.focalLengthMm, 4)} mm`,
    };
  }

  if (primary.kind === 'study') {
    const target = primary.data.recommendation ?? primary.data.baseline;
    if (target.maxRadiusMm === null) return { badge, summary: `${target.counts.total} 组偏差分析` };
    return { badge, summary: `偏差最大半径 ${formatReadoutWithUnit(target.maxRadiusMm, 'mm')}` };
  }

  if (primary.kind === 'objects') {
    return { badge, summary: `${primary.data.length} 个装置对比` };
  }

  const scan = primary.data.scans[0];
  const metric =
    primary.data.evidence.metrics.find(m => m.key === 'intensity' || m.key === 'reflectancePct') ??
    primary.data.evidence.metrics[0];
  if (scan && metric) {
    const values = scan.rows
      .map(row => row.result.metrics.find(m => m.key === metric.key)?.value ?? null)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (values.length) {
      const display = chooseUnitForMetric(metric.unit, values);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const unitText = display.unit ? ` ${display.unit}` : '';
      return {
        badge,
        summary: `${metric.label} ${formatScaled(min, display)}～${formatScaled(max, display)}${unitText}`,
      };
    }
  }
  const def = SCENE_DEFINITIONS[primary.data.state.sceneId];
  return { badge, summary: metric && metric.value !== null ? `${metric.label} ${formatCompact(metric.value)} ${metric.unit}`.trim() : def.title };
}

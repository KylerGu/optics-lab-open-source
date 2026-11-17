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
    const base = primary.data.screens.length > 1 ? `多屏仿真 · ${screenName} 等 ${primary.data.screens.length} 屏` : `单点仿真 · ${screenName}`;
    if (!showObjectPrefix) return base;
    const prefix = record.title.split(' · ')[0];
    return prefix && prefix !== base ? `${prefix} · ${base}` : base;
  }
  if (primary.kind === 'simulation' && primary.data.imaging?.length) {
    const imgObjId = primary.data.imaging[0].objectId;
    const objName = cleanElementDisplayName(primary.input.elements.find(e => e.id === imgObjId)?.name ?? '物体成像');
    const base = `单点仿真 · ${objName}`;
    if (!showObjectPrefix) return base;
    const prefix = record.title.split(' · ')[0];
    return prefix && prefix !== base ? `${prefix} · ${base}` : base;
  }
  return showObjectPrefix ? record.title : shortRecordTitle(record);
}

type ScreenSummaryEntry = Extract<ResearchArtifact, { kind: 'simulation' }>['data']['screens'][number];

function compactDetectorReading(screen: ScreenSummaryEntry): string {
  if (screen.detectorKind === 'power-meter') {
    if (screen.overRange) return '超量程';
    return formatReadoutWithUnit(screen.readingMw ?? screen.sampledPowerMw, 'mW');
  }
  if (screen.gaussianRadiusMm !== null) return formatReadoutWithUnit(screen.gaussianRadiusMm, 'mm');
  if (screen.hits === 0) return '未到达';
  if (screen.footprintRadiusMm !== null) return formatReadoutWithUnit(screen.footprintRadiusMm, 'mm');
  return formatReadoutWithUnit(screen.sampledPowerMw, 'mW');
}

function summarizeImagingResult(
  imaging: NonNullable<Extract<ResearchArtifact, { kind: 'simulation' }>['data']['imaging']>[number],
): string {
  const obs = imaging.observations.find(o => o.kind !== 'eye');
  if (obs) {
    const status = obs.focused ? '已对焦' : '未对焦';
    const mag = obs.magnification !== null ? ` · 倍率 ${formatCompact(obs.magnification, 3)}×` : '';
    const defocus = !obs.focused && obs.defocusMm !== null ? ` · 离焦 ${formatReadoutWithUnit(obs.defocusMm, 'mm')}` : '';
    return `${status}${mag}${defocus}`;
  }
  const eye = imaging.observations.find(o => o.kind === 'eye');
  if (eye) {
    return eye.angularMagnification !== null
      ? `目视观察 · 角放大率 ${formatCompact(eye.angularMagnification, 3)}×`
      : '目视观察';
  }
  const finalStage = imaging.stages.at(-1);
  if (!finalStage) return '物体成像仿真';
  if (finalStage.kind === 'infinity') return '像在无穷远';
  const orientation = finalStage.magnification !== null && finalStage.magnification < 0 ? '倒立' : '正立';
  const kind = finalStage.kind === 'real' ? '实像' : '虚像';
  const dist = finalStage.distanceMm !== null ? ` · 像距 ${formatCompact(finalStage.distanceMm, 4)} mm` : '';
  return `${orientation}${kind}${dist}`;
}

export function summarizeRecord(record: ResearchResultRecord): { badge: string; summary: string } {
  const primary = record.artifacts.find(a => a.id === record.primaryId) ?? record.artifacts[0];
  if (!primary) return { badge: '记录', summary: '' };
  const badge = RECORD_BADGES[primary.kind];

  if (primary.kind === 'comparison') {
    const { data } = primary;
    if (!data.rows.length) return { badge, summary: '' };
    const fieldLabel = (COMPARISON_LABELS[data.field] ?? data.field).replace(/（[^）]*）/, '');
    const screens = [...new Map(data.rows.flatMap(r => r.error ? [] : r.screens).map(s => [s.elementId, s])).values()];
    const screen = screens[0];
    if (!screen) {
      const wavePoints = data.rows.flatMap(r => {
        const coh = r.error ? null : (r.fourF ?? r.fourier);
        return coh ? [{ x: r.value, y: clampZero(coh.capturedPowerMw) }] : [];
      });
      if (wavePoints.length) {
        const minW = wavePoints.reduce((a, b) => (b.y < a.y ? b : a));
        const maxW = wavePoints.reduce((a, b) => (b.y > a.y ? b : a));
        return {
          badge,
          summary: maxW.y > minW.y
            ? `到屏功率 ${formatReadoutWithUnit(minW.y, 'mW')}～${formatReadoutWithUnit(maxW.y, 'mW')}`
            : `到屏功率 ${formatReadoutWithUnit(maxW.y, 'mW')}`,
        };
      }
      return { badge, summary: `${data.rows.length} 点扫描` };
    }
    const useGaussian = screens.some(s => s.gaussianRadiusMm !== null);
    const useFootprint = !useGaussian && screens.some(s => s.footprintRadiusMm !== null);
    const usePowerMeter = !useGaussian && !useFootprint && screens.some(s => s.detectorKind === 'power-meter' && s.readingMw != null);
    const metric: 'gaussianRadiusMm' | 'footprintRadiusMm' | 'readingMw' | 'sampledPowerMw' =
      useGaussian ? 'gaussianRadiusMm' : useFootprint ? 'footprintRadiusMm' : usePowerMeter ? 'readingMw' : 'sampledPowerMw';
    const valid = data.rows.flatMap(r => {
      const target = r.error ? undefined : r.screens.find(s => s.elementId === screen.elementId);
      const raw = target?.[metric];
      return typeof raw === 'number' && Number.isFinite(raw) ? [{ x: r.value, y: clampZero(raw) }] : [];
    });
    if (!valid.length) return { badge, summary: `${data.rows.length} 点扫描` };
    const screenSuffix = screens.length > 1 ? ` · 等 ${screens.length} 屏` : '';
    if (metric === 'readingMw' || metric === 'sampledPowerMw') {
      const minP = valid.reduce((a, b) => (b.y < a.y ? b : a));
      const maxP = valid.reduce((a, b) => (b.y > a.y ? b : a));
      const prefix = metric === 'readingMw' ? '功率计' : '功率';
      const body = maxP.y - minP.y > 1e-6
        ? `${prefix} ${formatReadoutWithUnit(minP.y, 'mW')}～${formatReadoutWithUnit(maxP.y, 'mW')}（峰值 ${fieldLabel} ${formatCompact(maxP.x, 4)}）`
        : `${prefix} ${formatReadoutWithUnit(maxP.y, 'mW')}`;
      return { badge, summary: `${body}${screenSuffix}` };
    }
    const min = valid.reduce((a, b) => (b.y < a.y ? b : a));
    const prefix = useGaussian ? '最小光斑' : '最小覆盖';
    return {
      badge,
      summary: `${prefix} ${formatReadoutWithUnit(min.y, 'mm')} (${fieldLabel} ${formatCompact(min.x, 4)})${screenSuffix}`,
    };
  }

  if (primary.kind === 'simulation') {
    const coherent = primary.data.fourF ?? primary.data.fourier;
    if (coherent) {
      return { badge, summary: `到屏功率 ${formatReadoutWithUnit(coherent.capturedPowerMw, 'mW')}` };
    }
    const imaging = primary.data.imaging?.[0];
    if (imaging && !primary.data.screens.length) {
      return { badge, summary: summarizeImagingResult(imaging) };
    }
    const screens = primary.data.screens;
    if (!screens.length) return { badge, summary: '' };
    if (screens.length > 1) {
      const pair = screens
        .slice(0, 2)
        .map(s => `${cleanElementDisplayName(s.name)} ${compactDetectorReading(s)}`)
        .join(' · ');
      return {
        badge,
        summary: screens.length > 2 ? `${pair} 等 ${screens.length} 屏` : pair,
      };
    }
    const screen = screens[0];
    if (screen.detectorKind === 'power-meter') {
      return {
        badge,
        summary: screen.overRange
          ? '功率计 超量程'
          : `功率计 ${formatReadoutWithUnit(screen.readingMw ?? screen.sampledPowerMw, 'mW')}`,
      };
    }
    if (screen.gaussianRadiusMm !== null) {
      return { badge, summary: `高斯半径 ${formatReadoutWithUnit(screen.gaussianRadiusMm, 'mm')}` };
    }
    if (screen.hits === 0) {
      return { badge, summary: `${cleanElementDisplayName(screen.name)} 未到达` };
    }
    if (screen.footprintRadiusMm !== null) {
      return { badge, summary: `覆盖半径 ${formatReadoutWithUnit(screen.footprintRadiusMm, 'mm')}` };
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

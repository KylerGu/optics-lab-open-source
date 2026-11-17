import { useSpatialSimulation } from './useSpatialSimulation';
import type { SpatialElement, SpatialExperiment, SpatialResult } from './builderModel';
import { formatVisualValue, visualComparisonStatus, visualParameter, VISUAL_FIELDS, type ResearchVisualGuide } from './researchVisual';
import { clampZero, cleanElementDisplayName, formatCompact, formatReadoutWithUnit } from './researchUnits';

export type ComparisonMode = 'gaussian' | 'power-meter' | 'imaging' | 'geometric';

export interface ComparisonDelta {
  text: string;
  tone: 'muted' | 'grow' | 'shrink';
}

export function spotDeltaSummary(before: number | null | undefined, after: number | null | undefined, unchanged: boolean): ComparisonDelta {
  if (unchanged) return { text: '拖动滑杆开始对比', tone: 'muted' };
  if (before == null || after == null || !Number.isFinite(before) || !Number.isFinite(after)) {
    return { text: '已调整参数', tone: 'muted' };
  }
  const b = clampZero(before);
  const a = clampZero(after);
  if (b === 0) {
    return a === 0 ? { text: '光斑保持不变', tone: 'muted' } : { text: `↑ 变为 ${formatReadoutWithUnit(a, 'mm')}`, tone: 'grow' };
  }
  const ratio = a / b;
  if (Math.abs(ratio - 1) < 0.015) return { text: '≈ 基本不变', tone: 'muted' };
  if (ratio > 1) return { text: `↑ 扩大 ${formatCompact(ratio, 3)}×`, tone: 'grow' };
  return { text: `↓ 缩小 ${formatCompact((1 - ratio) * 100, 3)}%`, tone: 'shrink' };
}

export function powerDeltaSummary(before: number | null | undefined, after: number | null | undefined, unchanged: boolean): ComparisonDelta {
  if (unchanged) return { text: '拖动滑杆开始对比', tone: 'muted' };
  if (before == null || after == null || !Number.isFinite(before) || !Number.isFinite(after)) {
    return { text: '已调整参数', tone: 'muted' };
  }
  const b = clampZero(before);
  const a = clampZero(after);
  if (Math.abs(a - b) <= Math.max(1e-6, 0.015 * Math.max(a, b))) {
    return { text: '≈ 功率不变', tone: 'muted' };
  }
  if (b === 0) return { text: `↑ 升至 ${formatReadoutWithUnit(a, 'mW')}`, tone: 'grow' };
  if (a > b) return { text: `↑ 增强 ${formatCompact(a / b, 3)}×`, tone: 'grow' };
  return { text: `↓ 衰减 ${formatCompact((1 - a / b) * 100, 3)}%`, tone: 'shrink' };
}

type ImagingObs = NonNullable<SpatialResult['imaging']>[number]['observations'][number];

export function imagingDeltaSummary(before: ImagingObs | null | undefined, after: ImagingObs | null | undefined, unchanged: boolean): ComparisonDelta {
  if (unchanged) return { text: '拖动滑杆开始对比', tone: 'muted' };
  if (!before || !after) return { text: '已调整参数', tone: 'muted' };
  if (!before.focused && after.focused) return { text: '已调至合焦', tone: 'shrink' };
  if (before.focused && !after.focused) return { text: '偏离最佳像面', tone: 'grow' };
  if (before.focused && after.focused) return { text: '保持合焦', tone: 'muted' };
  if (before.defocusMm != null && after.defocusMm != null) {
    const bd = Math.abs(before.defocusMm);
    const ad = Math.abs(after.defocusMm);
    if (ad + 1e-4 < bd) return { text: `↓ 离焦减小 ${formatReadoutWithUnit(bd - ad, 'mm')}`, tone: 'shrink' };
    if (ad > bd + 1e-4) return { text: `↑ 离焦增大 ${formatReadoutWithUnit(ad - bd, 'mm')}`, tone: 'grow' };
  }
  return { text: '未对焦', tone: 'muted' };
}

export function resolveComparisonMode(
  snapshot: SpatialExperiment,
  detectorId: string | null,
  beforeResult: SpatialResult | null,
  currentResult: SpatialResult | null,
): ComparisonMode {
  const detector: SpatialElement | undefined = detectorId
    ? snapshot.elements.find(e => e.id === detectorId)
    : undefined;
  if (detector?.kind === 'power-meter') return 'power-meter';
  const hasImagingResult =
    !!(currentResult?.imaging?.some(r => r.observations.some(o => o.elementId === detectorId))) ||
    !!(beforeResult?.imaging?.some(r => r.observations.some(o => o.elementId === detectorId))) ||
    (snapshot.elements.some(e => e.kind === 'object') && detector?.kind === 'sensor');
  if (hasImagingResult) return 'imaging';
  const beforeScreen = beforeResult?.screens.find(s => s.elementId === detectorId);
  const currentScreen = currentResult?.screens.find(s => s.elementId === detectorId);
  if (beforeScreen?.gaussianRadiusMm != null || currentScreen?.gaussianRadiusMm != null) return 'gaussian';
  const hasGaussianLaser = snapshot.elements.some(e => e.kind === 'laser' && e.beamModel === 'gaussian');
  if (hasGaussianLaser && beforeScreen == null && currentScreen == null) return 'gaussian';
  return 'geometric';
}

function findImagingObservation(result: SpatialResult | null, detectorId: string | null): ImagingObs | null {
  if (!result?.imaging?.length || !detectorId) return null;
  for (const r of result.imaging) {
    const obs = r.observations.find(o => o.elementId === detectorId);
    if (obs) return obs;
  }
  return null;
}

export function InquiryComparisonView({
  guide,
  experiment,
  beforeResult,
  beforeLoading,
  beforeError,
  onBeforeRetry,
  result,
  pending,
  error,
  retry,
}: {
  guide: ResearchVisualGuide;
  experiment: SpatialExperiment;
  beforeResult: SpatialResult | null;
  beforeLoading: boolean;
  beforeError: string | null;
  onBeforeRetry: () => void;
  result: SpatialResult | null;
  pending: boolean;
  error: string | null;
  retry: () => void;
}) {
  const state = visualComparisonStatus(guide.snapshot, experiment, guide.action);
  const detectorEl = guide.snapshot.elements.find(e => e.id === guide.action.screenId);
  const screenName = detectorEl ? cleanElementDisplayName(detectorEl.name) : undefined;
  const baseline = beforeResult?.screens.find(s => s.elementId === guide.action.screenId) ?? null;
  const current = state === 'missing' ? null : result?.screens.find(s => s.elementId === guide.action.screenId) ?? null;
  const baselineObs = findImagingObservation(beforeResult, guide.action.screenId);
  const currentObs = state === 'missing' ? null : findImagingObservation(result, guide.action.screenId);
  const mode = resolveComparisonMode(guide.snapshot, guide.action.screenId, beforeResult, result);

  const radii =
    mode === 'gaussian'
      ? [baseline?.gaussianRadiusMm, current?.gaussianRadiusMm]
      : mode === 'geometric'
        ? [baseline?.footprintRadiusMm, current?.footprintRadiusMm]
        : [];
  const extent = Math.max(0.001, ...radii.map(r => (r == null ? 0 : clampZero(r)))) * 1.35;

  const beforeMw = baseline ? (baseline.readingMw ?? baseline.sampledPowerMw) : null;
  const currentMw = current ? (current.readingMw ?? current.sampledPowerMw) : null;
  const maxPowerScale = Math.max(detectorEl?.meterRangeMw ?? 0, beforeMw ?? 0, currentMw ?? 0, 1e-6);

  const fieldLabel = guide.action.field ? VISUAL_FIELDS[guide.action.field] : null;
  const delta: ComparisonDelta =
    mode === 'power-meter'
      ? powerDeltaSummary(beforeMw, currentMw, state === 'unchanged')
      : mode === 'imaging'
        ? imagingDeltaSummary(baselineObs, currentObs, state === 'unchanged')
        : spotDeltaSummary(
            mode === 'gaussian' ? baseline?.gaussianRadiusMm : baseline?.footprintRadiusMm,
            mode === 'gaussian' ? current?.gaussianRadiusMm : current?.footprintRadiusMm,
            state === 'unchanged',
          );

  const modeHeading =
    mode === 'gaussian'
      ? '1/e² 高斯光斑等比对照'
      : mode === 'power-meter'
        ? '光功率读数对照'
        : mode === 'imaging'
          ? '成像对焦对照'
          : '几何光斑覆盖对照';

  const warnings = [...new Set([...(beforeResult?.warnings ?? []), ...(result?.warnings ?? [])])];

  return (
    <section className={`sb-inquiry-comparison is-mode-${mode}`} aria-label="调整前后实验对照">
      <div className="sb-inquiry-comp-head">
        <strong>{screenName ? `${screenName} · ` : ''}{modeHeading}</strong>
        <span className={`sb-comp-status is-${state}`} role="status">
          {state === 'missing'
            ? '目标器件已移除'
            : state === 'multiple'
              ? '多项条件已改动'
              : state === 'unchanged'
                ? '尚未拖动'
                : '仅改变所选参数'}
        </span>
      </div>
      <div className="sb-inquiry-pair">
        {[0, 1].map(i => {
          const isBefore = i === 0;
          const loading = isBefore ? beforeLoading : pending;
          const failure = isBefore ? beforeError : error;
          const screen = isBefore ? baseline : current;
          const obs = isBefore ? baselineObs : currentObs;
          const waitingFirstReading = loading && (mode === 'imaging' ? obs == null && screen == null : screen == null);
          const param = visualParameter(isBefore ? guide.snapshot : experiment, guide.action);

          let readoutText = '—';
          let subNote: string | null = null;
          if (waitingFirstReading) {
            readoutText = '计算中…';
          } else if (failure) {
            readoutText = '计算出错';
          } else if (mode === 'power-meter') {
            const mw = isBefore ? beforeMw : currentMw;
            readoutText = screen?.overRange ? '超量程' : mw != null ? formatReadoutWithUnit(mw, 'mW') : '无读数';
            if (detectorEl?.meterRangeMw) subNote = `量程 ${formatCompact(detectorEl.meterRangeMw, 4)} mW`;
          } else if (mode === 'imaging') {
            readoutText = obs ? (obs.focused ? '已对焦' : '未对焦') : '暂无成像';
            if (obs && !obs.focused && obs.defocusMm != null) subNote = `偏离 ${formatReadoutWithUnit(obs.defocusMm, 'mm')}`;
            else if (obs?.magnification != null) subNote = `倍率 ${formatCompact(obs.magnification, 3)}×`;
          } else if (mode === 'gaussian') {
            const r = screen?.gaussianRadiusMm;
            readoutText = r != null ? formatReadoutWithUnit(r, 'mm') : '无高斯读数';
          } else {
            const r = screen?.footprintRadiusMm;
            readoutText = screen?.hits === 0 ? '未到达' : r != null ? formatReadoutWithUnit(r, 'mm') : '无读数';
          }

          return (
            <article key={i} className={!isBefore && state !== 'unchanged' ? 'is-live' : undefined}>
              {mode === 'power-meter' ? (() => {
                const mw = isBefore ? beforeMw : currentMw;
                const fillPct = mw != null ? Math.min(1, Math.max(0, mw / maxPowerScale)) : 0;
                const barWidth = 84 * fillPct;
                const color = screen?.overRange ? '#dc2626' : '#2563eb';
                return (
                  <svg viewBox="0 0 120 96" role="img" aria-label={`${isBefore ? '调整前' : '当前'}功率条`}>
                    <text x="60" y="24" textAnchor="middle" fontSize="10.5" fill="#64748b">
                      0 ～ {formatReadoutWithUnit(maxPowerScale, 'mW')}
                    </text>
                    <rect x="18" y="36" width="84" height="16" rx="4" fill="#e2e8f0" />
                    {!waitingFirstReading && !failure && barWidth > 0 && (
                      <rect x="18" y="36" width={barWidth} height="16" rx="4" fill={color} />
                    )}
                    <text x="60" y="74" textAnchor="middle" fontSize="10.5" fill="#475569">
                      {screen?.overRange ? '超过探测上限' : `${Math.round(fillPct * 100)}% 量程`}
                    </text>
                  </svg>
                );
              })() : mode === 'imaging' ? (() => {
                const defocus = obs?.defocusMm != null ? Math.abs(obs.defocusMm) : null;
                const blurR = obs?.focused ? 4 : defocus != null ? Math.min(34, Math.max(8, defocus * 0.6)) : 16;
                const color = obs?.focused ? '#16a34a' : '#d97706';
                return (
                  <svg viewBox="0 0 120 96" role="img" aria-label={`${isBefore ? '调整前' : '当前'}对焦模糊示意`}>
                    <path d="M18 44H102M60 8V80" stroke="#cbd5e1" strokeDasharray="3 3" />
                    {!waitingFirstReading && !failure && obs && (
                      obs.focused
                        ? <>
                            <circle cx="60" cy="44" r="5" fill="#16a34a33" stroke="#16a34a" strokeWidth="2" />
                            <circle cx="60" cy="44" r="14" fill="none" stroke="#16a34a66" strokeWidth="1" />
                          </>
                        : <circle cx="60" cy="44" r={blurR} fill={`${color}20`} stroke={color} strokeWidth="1.6" strokeDasharray="3 2" />
                    )}
                    <text x="60" y="92" textAnchor="middle" fontSize="10.5" fill="#475569">
                      {obs?.focused ? '像点汇聚' : '散斑弥散示意'}
                    </text>
                  </svg>
                );
              })() : (() => {
                const radius = mode === 'gaussian' ? screen?.gaussianRadiusMm : screen?.footprintRadiusMm;
                const svgRadius = radius == null ? 0 : Math.max(2, (clampZero(radius) / extent) * 34);
                const strokeColor = mode === 'geometric' ? '#0f766e' : '#2563eb';
                const fillColor = mode === 'geometric' ? '#0f766e22' : '#2563eb24';
                return (
                  <svg viewBox="0 0 120 96" role="img" aria-label={`${isBefore ? '调整前' : '当前'}光斑轮廓`}>
                    <path d="M18 42H102M60 6V78" stroke="#cbd5e1" strokeDasharray="3 3" />
                    {radius != null && !waitingFirstReading && !failure && (screen?.hits ?? 1) > 0 && (
                      <circle cx="60" cy="42" r={svgRadius} fill={fillColor} stroke={strokeColor} strokeWidth="1.75" />
                    )}
                    <path d="M18 81V86M18 83.5H102M102 81V86" stroke="#64748b" />
                    <text x="60" y="94" textAnchor="middle" fontSize="10.5" fill="#475569">
                      标尺 {formatReadoutWithUnit(extent * 2, 'mm')}
                    </text>
                  </svg>
                );
              })()}
              <div className="sb-comp-metrics">
                <div className="sb-comp-tag">
                  <span>{isBefore ? '基准' : '当前'}</span>
                  {fieldLabel && guide.action.field && (
                    <small>{fieldLabel} {param == null ? '—' : formatVisualValue(param, guide.action.field)}</small>
                  )}
                </div>
                <strong className="sb-comp-value">{readoutText}</strong>
                {subNote && <small className="sb-comp-sub">{subNote}</small>}
                {failure && (
                  <button type="button" onClick={isBefore ? onBeforeRetry : retry}>
                    重试
                  </button>
                )}
              </div>
            </article>
          );
        })}
        <div className={`sb-inquiry-delta is-${delta.tone}`} aria-live="polite">
          <span>{delta.text}</span>
        </div>
      </div>
      {warnings.length > 0 && (
        <details className="sb-comp-warnings">
          <summary>模型提示（{warnings.length}）</summary>
          {warnings.map(w => <p key={w}>{w}</p>)}
        </details>
      )}
    </section>
  );
}

export default function InquiryComparison({ guide, experiment, result, pending, error, retry }: {
  guide: ResearchVisualGuide;
  experiment: SpatialExperiment;
  result: SpatialResult | null;
  pending: boolean;
  error: string | null;
  retry: () => void;
}) {
  const before = useSpatialSimulation(guide.snapshot, true);
  return (
    <InquiryComparisonView
      guide={guide}
      experiment={experiment}
      beforeResult={before.result}
      beforeLoading={before.status === 'pending'}
      beforeError={before.error}
      onBeforeRetry={before.retry}
      result={result}
      pending={pending}
      error={error}
      retry={retry}
    />
  );
}

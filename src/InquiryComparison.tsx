import { useSpatialSimulation } from './useSpatialSimulation';
import type { SpatialExperiment, SpatialResult } from './builderModel';
import { formatVisualValue, visualComparisonStatus, visualParameter, VISUAL_FIELDS, type ResearchVisualGuide } from './researchVisual';
import { clampZero, cleanElementDisplayName, formatCompact, formatReadoutWithUnit } from './researchUnits';

export function spotDeltaSummary(before: number | null | undefined, after: number | null | undefined, unchanged: boolean): { text: string; tone: 'muted' | 'grow' | 'shrink' } {
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

export default function InquiryComparison({ guide, experiment, result, pending, error, retry }: {
  guide: ResearchVisualGuide;
  experiment: SpatialExperiment;
  result: SpatialResult | null;
  pending: boolean;
  error: string | null;
  retry: () => void;
}) {
  const before = useSpatialSimulation(guide.snapshot, true);
  const state = visualComparisonStatus(guide.snapshot, experiment, guide.action);
  const rawScreenName = guide.snapshot.elements.find(e => e.id === guide.action.screenId)?.name;
  const screenName = rawScreenName ? cleanElementDisplayName(rawScreenName) : undefined;
  const baseline = before.result?.screens.find(s => s.elementId === guide.action.screenId);
  const current = state === 'missing' ? null : result?.screens.find(s => s.elementId === guide.action.screenId);
  const radii = [baseline?.gaussianRadiusMm, current?.gaussianRadiusMm];
  const extent = Math.max(0.001, ...radii.map(r => (r == null ? 0 : clampZero(r)))) * 1.35;
  const fieldLabel = guide.action.field ? VISUAL_FIELDS[guide.action.field] : null;
  const delta = spotDeltaSummary(baseline?.gaussianRadiusMm, current?.gaussianRadiusMm, state === 'unchanged');
  const warnings = [...new Set([...(before.result?.warnings ?? []), ...(result?.warnings ?? [])])];

  return (
    <section className="sb-inquiry-comparison" aria-label="调整前后光斑对照">
      <div className="sb-inquiry-comp-head">
        <strong>{screenName ? `${screenName} · ` : ''}1/e² 高斯光斑等比对照</strong>
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
        {[baseline, current].map((screen, i) => {
          const loading = i === 0 ? before.status === 'pending' : pending;
          const failure = i === 0 ? before.error : error;
          const radius = screen?.gaussianRadiusMm;
          const waitingFirstReading = loading && screen == null;
          const param = visualParameter(i === 0 ? guide.snapshot : experiment, guide.action);
          const svgRadius = radius == null ? 0 : Math.max(2, (clampZero(radius) / extent) * 34);
          return (
            <article key={i} className={i === 1 && state !== 'unchanged' ? 'is-live' : undefined}>
              <svg viewBox="0 0 120 96" role="img" aria-label={`${i === 0 ? '调整前' : '当前'}高斯光斑轮廓`}>
                <path d="M18 42H102M60 6V78" stroke="#cbd5e1" strokeDasharray="3 3" />
                {radius != null && !waitingFirstReading && !failure && (
                  <circle cx="60" cy="42" r={svgRadius} fill="#2563eb24" stroke="#2563eb" strokeWidth="1.75" />
                )}
                <path d="M18 81V86M18 83.5H102M102 81V86" stroke="#64748b" />
                <text x="60" y="94" textAnchor="middle" fontSize="10.5" fill="#475569">
                  标尺 {formatReadoutWithUnit(extent * 2, 'mm')}
                </text>
              </svg>
              <div className="sb-comp-metrics">
                <div className="sb-comp-tag">
                  <span>{i === 0 ? '基准' : '当前'}</span>
                  {fieldLabel && guide.action.field && <small>{fieldLabel} {param == null ? '—' : formatVisualValue(param, guide.action.field)}</small>}
                </div>
                <strong className="sb-comp-value">
                  {waitingFirstReading
                    ? '计算中…'
                    : failure
                      ? '计算出错'
                      : radius == null
                        ? '无高斯读数'
                        : formatReadoutWithUnit(radius, 'mm')}
                </strong>
                {failure && (
                  <button type="button" onClick={i === 0 ? before.retry : retry}>
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

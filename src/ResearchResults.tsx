import { Children, isValidElement, useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { ArrowUpRight, Download } from 'lucide-react';
import { renderToString } from 'katex';
import { formatNumber } from './formatNumber';
import { COMPARISON_LABELS, type SpatialComparison } from './spatialAgent';
import type { SpatialExperiment, SpatialResult } from './builderModel';
import { downloadResearch, recommendedSpatial, type ResearchObjectResult } from './researchSession';
import { downloadDesign, type FocusDesign } from './research';
import { downloadStudy, type StabilityStudy } from './tolerance';
import { RESEARCH_METRIC_METHODS, snapshotSummary } from './researchRecords';
import type { ResearchEvidenceRef } from './researchPlan';
import { ErrorChart } from './ErrorChart';
import ResearchModelNotes from './ResearchModelNotes';
import { SCENE_DEFINITIONS, numberText, type SceneState } from './sceneRuntime';
import { modelMetricLabel, type ResearchModelResult } from './researchModels';
import SpatialFourierOutput from './SpatialFourierOutput';
import SpatialFourFOutput from './SpatialFourFOutput';
import { resolveArtifactFormulas, type FormulaPresetRequest } from './researchFormulaLinks';
import {
  chooseLengthDisplay,
  choosePowerDisplay,
  chooseUnitForMetric,
  clampZero,
  cleanElementDisplayName,
  formatCompact,
  formatReadoutWithUnit,
  formatScaled,
  hasMetricVariation,
  niceAxisRange,
  niceXTicks,
  type UnitDisplay,
} from './researchUnits';

export type ResearchArtifact = ({ reference: ResearchEvidenceRef } & (
  | { id: string; kind: 'simulation'; title: string; createdAt: string; input: SpatialExperiment; data: SpatialResult }
  | { id: string; kind: 'comparison'; title: string; createdAt: string; input: SpatialExperiment; data: SpatialComparison }
  | { id: string; kind: 'design'; title: string; createdAt: string; input: SpatialExperiment; data: FocusDesign }
  | { id: string; kind: 'study'; title: string; createdAt: string; input: SpatialExperiment; data: StabilityStudy }
  | { id: string; kind: 'objects'; title: string; createdAt: string; input: SpatialExperiment; data: ResearchObjectResult[] }
  | { id: string; kind: 'model'; title: string; createdAt: string; input: SceneState; data: ResearchModelResult }));

type Point = { x: number; y: number | null };
type ScanMetric = keyof typeof RESEARCH_METRIC_METHODS;
const METRIC_BASE_NAMES: Record<ScanMetric, string> = {
  gaussianRadiusMm: '高斯半径',
  footprintRadiusMm: '几何覆盖半径',
  sampledPowerMw: '采样功率',
};
const METRIC_LABELS: Record<ScanMetric, string> = { gaussianRadiusMm: '高斯半径 / mm', footprintRadiusMm: '几何覆盖半径 / mm', sampledPowerMw: '采样功率 / mW' };
const RESULT_LABELS: Record<ResearchArtifact['kind'], string> = { comparison: '参数扫描', design: '方案搜索与推荐', study: '误差分析', objects: '方案对比', simulation: '仿真读数', model: '模型实验' };

type Highlight = { label: string; value: string; note?: string; primary?: boolean };
function ResultHighlights({ items }: { items: Highlight[] }) {
  return (
    <dl className={`rw-result-highlights${items.length === 2 ? ' is-two' : ''}`} aria-label="关键结果">
      {items.map(item => (
        <div key={item.label} className={item.primary ? 'is-primary' : undefined}>
          <dt>{item.label}</dt>
          <dd>{item.value}{item.note && <small>{item.note}</small>}</dd>
        </div>
      ))}
    </dl>
  );
}

const formattedRadius = (value: number | null, _display?: UnitDisplay) =>
  value === null ? '—' : formatReadoutWithUnit(value, 'mm');

const measurementNotes = (data: SpatialResult | null | undefined) => [
  ...(data?.screens.some(s => s.gaussianRadiusMm !== null) ? [RESEARCH_METRIC_METHODS.gaussianRadiusMm] : []),
  ...(data?.screens.some(s => s.footprintRadiusMm !== null) ? [RESEARCH_METRIC_METHODS.footprintRadiusMm] : []),
  ...(data?.screens.length ? [RESEARCH_METRIC_METHODS.sampledPowerMw] : []),
];

// Summarize stored readings only; do not interpolate missing points or rank apparatus.
export function scanHighlights(comparison: SpatialComparison, screenId: string, metric: ScanMetric): Highlight[] {
  const readings = comparison.rows.flatMap(row => {
    const value = row.screens.find(s => s.elementId === screenId)?.[metric];
    return !row.error && value != null && Number.isFinite(value) ? [{ value, parameter: row.value, warnings: row.warnings }] : [];
  });
  const field = COMPARISON_LABELS[comparison.field] ?? comparison.field;
  const extrema = (minimum: boolean): Highlight => {
    const value = readings.length ? (minimum ? Math.min : Math.max)(...readings.map(r => r.value)) : null;
    const matches = readings.filter(r => r.value === value);
    return { label: `已算点${minimum ? '最小' : '最大'}读数`, value: value === null ? '—' : formatNumber(value) + (metric === 'sampledPowerMw' ? ' mW' : ' mm'), note: matches.length ? `${field} ${formatNumber(matches[0].parameter)}${matches.length > 1 ? ` 等 ${matches.length} 个参数点` : ''}${matches.some(r => r.warnings.length) ? ' · 存在模型警告，仅供参考' : ''}` : '所选观察屏没有该指标的有效读数' };
  };
  return [{ label: '有效读数 / 扫描点', value: `${readings.length} / ${comparison.rows.length}`, note: METRIC_LABELS[metric] }, extrema(true), extrema(false)];
}

function comparisonHighlightCards(
  readings: { x: number; y: number; warnings: string[] }[],
  baseUnit: string,
  fieldLabel: string,
): Highlight[] {
  const buildExtremum = (minimum: boolean): Highlight => {
    if (!readings.length) {
      return {
        label: `已算点${minimum ? '最小' : '最大'}读数`,
        value: '—',
        note: '所选观察屏没有该指标的有效读数',
        primary: minimum,
      };
    }
    const extremum = (minimum ? Math.min : Math.max)(...readings.map(r => r.y));
    const matches = readings.filter(r => r.y === extremum);
    return {
      label: `已算点${minimum ? '最小' : '最大'}读数`,
      value: formatReadoutWithUnit(extremum, baseUnit),
      note: `${fieldLabel} ${formatCompact(matches[0].x, 4)}${matches.length > 1 ? ` 等 ${matches.length} 点` : ''}${matches.some(r => r.warnings.length) ? ' · 存在警告' : ''}`,
      primary: minimum,
    };
  };
  return [buildExtremum(true), buildExtremum(false)];
}

function ResearchLineChart({
  points,
  xLabel,
  yLabel,
  yUnit = '',
  highlightMin = true,
}: {
  points: Point[];
  xLabel: string;
  yLabel: string;
  yUnit?: string;
  highlightMin?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const gradId = useId();
  const shadowId = useId();
  const [width, setWidth] = useState(520);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.floor(entry.contentRect.width))));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  const values = points.filter((p): p is { x: number; y: number } => p.y !== null && Number.isFinite(p.y));
  if (!points.length) return null;

  const xs = points.map(p => p.x);
  const ys = values.map(p => p.y);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const ymin = ys.length ? Math.min(...ys) : 0;
  const ymax = ys.length ? Math.max(...ys) : 1;
  const { low, high, ticks } = niceAxisRange(ymin, ymax, 3);

  const left = 60;
  const right = width - 20;
  const top = 30;
  const bottom = 186;
  const x = (value: number) => left + ((value - xmin) / (xmax - xmin || 1)) * (right - left);
  const y = (value: number) => bottom - ((value - low) / (high - low || 1)) * (bottom - top);

  let running = false;
  const path = points
    .map(p => {
      if (p.y === null) {
        running = false;
        return '';
      }
      const command = `${running ? 'L' : 'M'}${x(p.x)},${y(p.y)}`;
      running = true;
      return command;
    })
    .join(' ');

  const areaSegments: string[] = [];
  let segment: { x: number; y: number }[] = [];
  for (const p of points) {
    if (p.y === null || !Number.isFinite(p.y)) {
      if (segment.length >= 2) {
        const startX = x(segment[0].x);
        const endX = x(segment.at(-1)!.x);
        areaSegments.push(`M${startX},${bottom} ` + segment.map(pt => `L${x(pt.x)},${y(pt.y)}`).join(' ') + ` L${endX},${bottom} Z`);
      }
      segment = [];
    } else {
      segment.push({ x: p.x, y: p.y });
    }
  }
  if (segment.length >= 2) {
    const startX = x(segment[0].x);
    const endX = x(segment.at(-1)!.x);
    areaSegments.push(`M${startX},${bottom} ` + segment.map(pt => `L${x(pt.x)},${y(pt.y)}`).join(' ') + ` L${endX},${bottom} Z`);
  }

  const xTicks = niceXTicks(xs, 5);
  const minPoint = highlightMin && values.length >= 3 ? values.reduce((best, p) => (p.y < best.y ? p : best)) : null;
  const activeIdx = hoverIndex ?? pinnedIndex;
  const activePoint = activeIdx !== null && points[activeIdx]?.y != null ? points[activeIdx] : null;
  const unitSuffix = yUnit ? ` ${yUnit}` : '';

  const nearestIndex = (event: MouseEvent<SVGSVGElement>): number | null => {
    if (!points.length) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return null;
    const svgX = ((event.clientX - rect.left) / rect.width) * width;
    let bestIdx: number | null = null;
    let bestDist = Infinity;
    points.forEach((p, idx) => {
      if (p.y === null || !Number.isFinite(p.y)) return;
      const dist = Math.abs(x(p.x) - svgX);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = idx;
      }
    });
    return bestIdx;
  };

  return (
    <div ref={container} className="rw-line-chart">
      <svg
        viewBox={`0 0 ${width} 248`}
        role="img"
        aria-label={`${xLabel}与${yLabel}的实际计算比较，${values.length}个有效点`}
        onMouseMove={event => setHoverIndex(nearestIndex(event))}
        onMouseLeave={() => setHoverIndex(null)}
        onClick={event => {
          const idx = nearestIndex(event);
          setPinnedIndex(prev => (prev === idx ? null : idx));
        }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b76d8" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#3b76d8" stopOpacity="0.01" />
          </linearGradient>
          <filter id={shadowId} x="-15%" y="-20%" width="130%" height="150%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#1e293b" floodOpacity="0.12" />
          </filter>
        </defs>
        {ticks.map(tick => {
          const py = y(tick);
          return (
            <g key={tick}>
              <line x1={left} x2={right} y1={py} y2={py} className="rw-grid-line" />
              <text x={left - 9} y={py + 4} textAnchor="end">{formatCompact(tick, 4)}</text>
            </g>
          );
        })}
        <line x1={left} x2={right} y1={bottom} y2={bottom} className="rw-axis-line" />
        {areaSegments.map((d, i) => (
          <path key={i} d={d} fill={`url(#${gradId})`} />
        ))}
        {values.length > 0 && <path d={path} className="rw-chart-line" />}
        {minPoint && (
          <g className="rw-chart-min-guide">
            <line x1={x(minPoint.x)} x2={x(minPoint.x)} y1={y(minPoint.y)} y2={bottom} strokeDasharray="3 3" />
            <circle cx={x(minPoint.x)} cy={y(minPoint.y)} r={6} className="rw-chart-min-halo" />
            {!activePoint && (() => {
              const cx = x(minPoint.x);
              const cy = y(minPoint.y);
              const label = `最小 ${formatCompact(minPoint.y)}${unitSuffix}`;
              const nearRight = cx > right - 95;
              const anchor = nearRight ? 'end' : cx < left + 80 ? 'start' : 'middle';
              const textY = cy - 12 < top + 10 ? cy + 20 : cy - 11;
              return <text x={cx} y={textY} textAnchor={anchor} className="rw-chart-min-label" style={{ fill: '#1e4ea6' }}>{label}</text>;
            })()}
          </g>
        )}
        {points.map((p, i) => {
          if (p.y === null || !Number.isFinite(p.y)) return null;
          const active = activeIdx === i;
          return (
            <circle key={i} cx={x(p.x)} cy={y(p.y)} r={active ? 5 : 3.2} className={active ? 'rw-chart-point is-active' : 'rw-chart-point'}>
              <title>{`${xLabel}：${formatCompact(p.x, 4)}；${yLabel}：${formatCompact(p.y)}${unitSuffix}`}</title>
            </circle>
          );
        })}
        {activePoint && activePoint.y !== null && (() => {
          const cx = x(activePoint.x);
          const cy = y(activePoint.y);
          const text = `${formatCompact(activePoint.x, 4)} → ${formatCompact(activePoint.y)}${unitSuffix}`;
          const boxWidth = Math.max(122, text.length * 7.6 + 22);
          const bx = Math.min(right - boxWidth, Math.max(left, cx - boxWidth / 2));
          const by = cy - 42 >= 4 ? cy - 40 : Math.min(bottom - 34, cy + 12);
          return (
            <g className="rw-chart-tooltip" pointerEvents="none">
              <line x1={cx} x2={cx} y1={top} y2={bottom} className="rw-chart-crosshair" />
              <rect x={bx} y={by} width={boxWidth} height={28} rx={7} filter={`url(#${shadowId})`} style={{ fill: '#ffffff', stroke: '#cbd5e1', strokeWidth: 1 }} />
              <text x={bx + boxWidth / 2} y={by + 18} textAnchor="middle" style={{ fill: '#1e293b', fontSize: '12px', fontWeight: 600 }}>
                {text}
              </text>
            </g>
          );
        })()}
        {xTicks.map((tickVal, idx) => (
          <text
            key={tickVal + '-' + idx}
            x={x(tickVal)}
            y={208}
            textAnchor={idx === 0 ? 'start' : idx === xTicks.length - 1 ? 'end' : 'middle'}
          >
            {formatCompact(tickVal, 4)}
          </text>
        ))}
        <text x={left} y={14} className="rw-chart-axis-title">{yLabel}</text>
        <text x={(left + right) / 2} y={234} textAnchor="middle" className="rw-chart-axis-title">{xLabel}</text>
        {!values.length && <text x={(left + right) / 2} y={100} textAnchor="middle">没有可绘制的有效结果</text>}
      </svg>
    </div>
  );
}

export function comparisonCSV(comparison: SpatialComparison): string {
  const cell = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const safe = (s: string) => (/^[=+\-@\t\r]/.test(s) ? "'" + s : s);
  const rows: unknown[][] = [['装置快照', JSON.stringify(comparison.inputSnapshot)], ['参数', comparison.field], ['参数值', '观察屏', '几何覆盖半径_mm', '高斯半径_mm', '采样功率_mW', '警告', '错误']];
  for (const row of comparison.rows) {
    if (row.error) rows.push([row.value, '', '', '', '', '', safe(row.error)]);
    else for (const screen of row.screens) rows.push([row.value, safe(screen.name), screen.footprintRadiusMm, screen.gaussianRadiusMm, screen.sampledPowerMw, safe(row.warnings.join('；')), '']);
  }
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}

function FormulaSection({
  artifact,
  metric,
  onOpenFormula,
}: {
  artifact: ResearchArtifact;
  metric?: string;
  onOpenFormula?: (preset: Omit<FormulaPresetRequest, 'id'>) => void;
}) {
  const info = resolveArtifactFormulas(artifact, metric);
  if (!info.expressions.length && !info.derivations.length && !info.extraLinks.length) return null;
  const renderMath = (latex: string) => ({
    __html: renderToString(latex, { displayMode: true, throwOnError: false, output: 'htmlAndMathml', trust: false }),
  });

  return (
    <div data-detail="explanation">
      {info.expressions.length > 0 && (
        <section className="rw-detail-section rw-formula-section">
          <h3>计算公式</h3>
          <div className="rw-formula-cards">
            {info.expressions.map(item => {
              const clickable = !!(onOpenFormula && item.preset);
              const body = (
                <>
                  <span className="rw-formula-card-head">
                    <span className="rw-formula-title">{item.title}</span>
                    {clickable && (
                      <span className="rw-formula-card-cta">
                        {item.presetLabel ?? '代入计算'} <ArrowUpRight size={13} />
                      </span>
                    )}
                  </span>
                  <div className="rw-formula-math" dangerouslySetInnerHTML={renderMath(item.latex)} />
                </>
              );
              return clickable ? (
                <button
                  key={item.title}
                  type="button"
                  className="rw-formula-card is-clickable"
                  onClick={() => onOpenFormula!(item.preset!)}
                >
                  {body}
                </button>
              ) : (
                <div key={item.title} className="rw-formula-card">
                  {body}
                </div>
              );
            })}
          </div>
          {onOpenFormula && info.extraLinks.length > 0 && (
            <div className="rw-formula-links">
              <span className="rw-formula-links-label">相关工具：</span>
              {info.extraLinks.map(link => (
                <button
                  key={link.label}
                  type="button"
                  className="rw-button rw-formula-link-btn"
                  onClick={() => onOpenFormula(link.preset)}
                >
                  <span>{link.label}</span>
                  <ArrowUpRight size={13} />
                </button>
              ))}
            </div>
          )}
        </section>
      )}
      {info.derivations.length > 0 && (
        <section className="rw-detail-section rw-derivations-section">
          <h3>参数代入与估算</h3>
          <div className="rw-derivations">
            {info.derivations.map(step => (
              <div key={step.label} className="rw-derivation-row">
                <span className="rw-derivation-label">{step.label}</span>
                <div className="rw-formula-math rw-derivation-math" dangerouslySetInnerHTML={renderMath(step.latex)} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ResultDetails({
  artifact,
  metric,
  onOpenFormula,
  children,
}: {
  artifact: ResearchArtifact;
  metric?: string;
  onOpenFormula?: (preset: Omit<FormulaPresetRequest, 'id'>) => void;
  children: ReactNode;
}) {
  const [tab, setTab] = useState<'data' | 'calc'>('data');
  const id = useId();
  const tabs: { key: 'data' | 'calc'; label: string }[] = [
    { key: 'data', label: '数据' },
    { key: 'calc', label: '计算' },
  ];
  const blocks = Children.toArray(children);
  const isExplanation = (node: ReactNode) => isValidElement<{ 'data-detail'?: string }>(node) && node.props['data-detail'] === 'explanation';
  return <div className="rw-result-details"><div className="rw-result-detail-body">
    <div className="rw-detail-tabs" role="tablist" aria-label="结果详情">{tabs.map((item, index) => <button key={item.key} id={`${id}-${item.key}`} role="tab" aria-selected={tab === item.key} aria-controls={`${id}-${item.key}-panel`} tabIndex={tab === item.key ? 0 : -1} onClick={() => setTab(item.key)} onKeyDown={event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
      if (next === null) return;
      event.preventDefault(); setTab(tabs[next].key); (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus();
    }}>{item.label}</button>)}</div>
    <div id={`${id}-data-panel`} role="tabpanel" aria-labelledby={`${id}-data`} hidden={tab !== 'data'}>{blocks.filter(node => !isExplanation(node))}</div>
    <div id={`${id}-calc-panel`} role="tabpanel" aria-labelledby={`${id}-calc`} hidden={tab !== 'calc'}>
      <FormulaSection artifact={artifact} metric={metric} onOpenFormula={onOpenFormula} />
      {blocks.filter(isExplanation)}
    </div>
  </div></div>;
}

function ComparisonResults({
  comparison,
  artifact,
  onOpenFormula,
}: {
  comparison: SpatialComparison;
  artifact: ResearchArtifact;
  baseline?: SpatialResult;
  onOpenFormula?: (preset: Omit<FormulaPresetRequest, 'id'>) => void;
}) {
  const screens = [...new Map(comparison.rows.flatMap(row => row.error ? [] : row.screens).map(s => [s.elementId, s])).values()];
  const [screenId, setScreenId] = useState(screens[0]?.elementId ?? '');

  const hasGaussian = screens.some(s => s.gaussianRadiusMm !== null);
  const hasFootprint = screens.some(s => s.footprintRadiusMm !== null);
  const powerValues = comparison.rows.map(row => (row.error ? null : row.screens.find(s => s.elementId === screenId)?.sampledPowerMw ?? null));
  const powerVaries = hasMetricVariation(powerValues);
  const showPowerOption = powerVaries || (!hasGaussian && !hasFootprint);

  const availableMetrics: { key: ScanMetric; label: string }[] = [
    ...(hasGaussian || !hasFootprint ? [{ key: 'gaussianRadiusMm' as const, label: '高斯半径' }] : []),
    ...(hasFootprint || !hasGaussian ? [{ key: 'footprintRadiusMm' as const, label: '几何覆盖半径' }] : []),
    ...(showPowerOption ? [{ key: 'sampledPowerMw' as const, label: '采样功率' }] : []),
  ];

  const [selectedMetric, setSelectedMetric] = useState<ScanMetric>(hasGaussian ? 'gaussianRadiusMm' : showPowerOption ? 'sampledPowerMw' : 'footprintRadiusMm');
  const metric: ScanMetric = availableMetrics.some(m => m.key === selectedMetric) ? selectedMetric : availableMetrics[0].key;

  const rawValues = comparison.rows.map(row => (row.error ? null : row.screens.find(s => s.elementId === screenId)?.[metric] ?? null));
  const display = metric === 'sampledPowerMw'
    ? choosePowerDisplay(rawValues)
    : chooseLengthDisplay(rawValues);

  const baseUnit = metric === 'sampledPowerMw' ? 'mW' : 'mm';
  const metricName = METRIC_BASE_NAMES[metric];
  const label = `${metricName} / ${display.unit}`;
  const fieldLabel = COMPARISON_LABELS[comparison.field] ?? comparison.field;
  const hasWave = comparison.rows.some(row => (row.fourier ?? row.fourF)?.screenId === screenId);

  const readings = comparison.rows.flatMap(row => {
    const value = row.error ? null : row.screens.find(s => s.elementId === screenId)?.[metric];
    return typeof value === 'number' && Number.isFinite(value) ? [{ x: row.value, y: clampZero(value), warnings: row.warnings }] : [];
  });
  const chartPoints = comparison.rows.map(row => {
    const raw = row.error ? null : row.screens.find(s => s.elementId === screenId)?.[metric] ?? null;
    return { x: row.value, y: raw === null ? null : clampZero(raw) * display.factor };
  });

  const issueCount = comparison.rows.filter(r => r.error || r.warnings.length).length;
  const hasRowIssues = issueCount > 0 || readings.length < comparison.rows.length;
  const minValue = readings.length >= 2 && metric !== 'sampledPowerMw'
    ? Math.min(...readings.map(r => r.y))
    : null;

  return <>
    {hasWave && <section className="rw-detail-section"><h3>波动计算读数</h3><p className="rw-result-note">取样点光强是相对值，不是功率；下方几何采样指标不能代替它。</p><div className="rw-table-wrap"><table><thead><tr><th>{fieldLabel}</th><th>屏上取样点 / mm</th><th>相对光强</th><th>到屏功率 / mW</th></tr></thead><tbody>{comparison.rows.map((row, i) => {
      const wave = row.error ? null : [row.fourier, row.fourF].find(w => w?.screenId === screenId);
      const probe = wave && ('observationUm' in wave.parameters ? wave.parameters.observationUm / 1000 : wave.parameters.observationMm);
      return <tr key={i}><td>{formatNumber(row.value)}</td><td>{probe == null ? '—' : formatNumber(probe)}</td><td>{wave ? formatNumber(wave.pointIntensity) : '—'}</td><td>{wave ? formatNumber(wave.capturedPowerMw) : '—'}</td></tr>;
    })}</tbody></table></div><p className="rw-result-note">傅里叶光强相对频谱中心；4f光强相对输入中心。— 表示该点未得到有效波动结果。</p></section>}
    {(screens.length > 1 || availableMetrics.length > 1) && (
      <div className="rw-chart-controls">
        {screens.length > 1 && <label>观察屏<select value={screenId} disabled={!screens.length} onChange={event => setScreenId(event.target.value)}>{screens.map(s => <option key={s.elementId} value={s.elementId}>{cleanElementDisplayName(s.name)}</option>)}</select></label>}
        {availableMetrics.length > 1 && (
          <label>比较指标<select value={metric} onChange={event => setSelectedMetric(event.target.value as ScanMetric)}>{availableMetrics.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select></label>
        )}
      </div>
    )}
    <ResultHighlights items={comparisonHighlightCards(readings, baseUnit, fieldLabel)} />
    {hasRowIssues && <p className="rw-result-alert">有效读数 {readings.length} / {comparison.rows.length}；存在警告的点 {comparison.rows.filter(r => r.warnings.length).length} 个，无法计算的点 {comparison.rows.filter(r => r.error).length} 个。</p>}
    <ResearchLineChart points={chartPoints} xLabel={fieldLabel} yLabel={label} yUnit={display.unit} highlightMin={metric !== 'sampledPowerMw'} />
    <ResultDetails artifact={artifact} metric={metric} onOpenFormula={onOpenFormula}>
      <section className="rw-detail-section">
        <div className="rw-detail-section-head">
          <h3>全部扫描数据 · {comparison.rows.length} 点</h3>
          <button className="rw-button" onClick={() => downloadResearch(comparisonCSV(comparison), '参数比较', 'csv')}><Download size={15}/>下载数据</button>
        </div>
        <div className="rw-table-wrap">
          <table>
            <thead><tr><th>{fieldLabel}</th><th>{label}</th>{hasRowIssues && <th>状态</th>}</tr></thead>
            <tbody>{comparison.rows.map((row, i) => {
              const value = row.error ? null : row.screens.find(s => s.elementId === screenId)?.[metric];
              const isMin = minValue !== null && typeof value === 'number' && Number.isFinite(value) && clampZero(value) === minValue;
              const badge = row.error ? <span className="rw-status-pill is-error">{row.error}</span>
                : row.warnings.length ? <span className="rw-status-pill is-warn">警告</span>
                : value == null ? <span className="rw-status-pill is-muted">无读数</span>
                : <span className="rw-status-pill is-ok">✓</span>;
              return <tr key={i} className={isMin ? 'rw-result-min' : undefined}><td>{formatCompact(row.value, 4)}{isMin && <span className="rw-table-tag">最小</span>}</td><td>{value == null ? '—' : formatScaled(value, display)}</td>{hasRowIssues && <td>{badge}</td>}</tr>;
            })}</tbody>
          </table>
        </div>
      </section>
      <ResearchModelNotes data-detail="explanation" title="物理假设" notes={[RESEARCH_METRIC_METHODS[metric]]} warnings={comparison.rows.flatMap(row => row.warnings)} />
    </ResultDetails>
  </>;
}

function SimulationResults({
  data,
  artifact,
  onOpenFormula,
}: {
  data: SpatialResult;
  artifact: ResearchArtifact;
  onOpenFormula?: (preset: Omit<FormulaPresetRequest, 'id'>) => void;
}) {
  const [screenId, setScreenId] = useState(data.screens[0]?.elementId ?? '');
  const selected = data.screens.find(s => s.elementId === screenId);
  const wave = [data.fourier, data.fourF].find(w => w?.screenId === screenId);
  const screenRadius = (data.inputSnapshot.elements.find(e => e.id === screenId)?.diameterMm ?? 40) / 2;

  const lengthDisplay = chooseLengthDisplay(data.screens.flatMap(s => [s.gaussianRadiusMm, s.footprintRadiusMm]));
  const powerDisplay = choosePowerDisplay(data.screens.map(s => s.sampledPowerMw));

  return <>
    {data.screens.length > 1 && <div className="rw-chart-controls"><label>查看观察屏<select value={screenId} onChange={event => setScreenId(event.target.value)}>{data.screens.map(s => <option key={s.elementId} value={s.elementId}>{cleanElementDisplayName(s.name)}</option>)}</select></label></div>}
    {data.fourier?.screenId === screenId && <SpatialFourierOutput result={data.fourier} radius={screenRadius}/>}
    {data.fourF?.screenId === screenId && <SpatialFourFOutput result={data.fourF} radius={screenRadius}/>}
    <ResultHighlights items={wave ? [
      { label: '到屏功率（波动计算）', value: formatReadoutWithUnit(wave.capturedPowerMw, 'mW'), note: selected ? cleanElementDisplayName(selected.name) : undefined, primary: true },
    ] : [
      { label: '高斯半径', value: formattedRadius(selected?.gaussianRadiusMm ?? null), note: selected ? cleanElementDisplayName(selected.name) : '暂无到屏读数', primary: selected?.gaussianRadiusMm !== null },
      { label: '几何覆盖半径', value: formattedRadius(selected?.footprintRadiusMm ?? null), note: '采样光线的落点范围' },
      { label: '采样功率', value: selected ? formatReadoutWithUnit(selected.sampledPowerMw, 'mW') : '—', note: '有限光线采样近似' },
    ]}/>
    {data.warnings.length > 0 && <p className="rw-result-alert">{data.warnings.join('；')}</p>}
    <ResultDetails artifact={artifact} onOpenFormula={onOpenFormula}>
      <div className="rw-detail-section-head">
        <h3>观察屏读数</h3>
        <button className="rw-button" onClick={() => downloadResearch(data, '光学仿真结果', 'json')}><Download size={15}/>保存完整记录</button>
      </div>
      <div className="rw-table-wrap"><table><thead><tr><th>观察屏</th><th>命中光线</th><th>高斯半径 / {lengthDisplay.unit}</th><th>几何覆盖半径 / {lengthDisplay.unit}</th><th>采样功率 / {powerDisplay.unit}</th></tr></thead><tbody>{data.screens.map(s => <tr key={s.elementId} className={s.elementId === screenId ? 'rw-result-selected' : undefined}><td>{cleanElementDisplayName(s.name)}</td><td>{s.hits} 条</td><td>{s.gaussianRadiusMm === null ? '—' : formatScaled(s.gaussianRadiusMm, lengthDisplay)}</td><td>{s.footprintRadiusMm === null ? '—' : formatScaled(s.footprintRadiusMm, lengthDisplay)}</td><td>{formatScaled(s.sampledPowerMw, powerDisplay)}</td></tr>)}</tbody></table></div>
      {!data.screens.length && <p className="rw-result-note">装置没有观察屏，尚无到屏读数。</p>}
      <ResearchModelNotes data-detail="explanation" title="物理假设" notes={measurementNotes(data)} warnings={data.warnings} fullNotes={data.assumptions}/>
    </ResultDetails>
  </>;
}

function DesignResults({
  design,
  input,
  onOpenBuilder,
  onOpenFormula,
  artifact,
}: {
  artifact: ResearchArtifact;
  design: FocusDesign;
  input: SpatialExperiment;
  onOpenBuilder: (input: SpatialExperiment) => void;
  onOpenFormula?: (preset: Omit<FormulaPresetRequest, 'id'>) => void;
}) {
  const [phase, setPhase] = useState<'coarse' | 'refined'>('coarse');
  const [selected, setSelected] = useState(0);
  const rows = design.rows.filter(row => row.phase === phase), values = rows.flatMap(r => r.radiusMm === null ? [] : [r.radiusMm]);
  const min = values.length ? Math.min(...values) : 0, max = values.length ? Math.max(...values) : 1;
  const recommendation = design.recommendation, chosen = rows[selected] ?? rows[0];
  const grid = design.grids.find(g => g.phase === phase) ?? design.grids[0];
  const improvement = recommendation?.improvementFraction;

  return <>
    <ResultHighlights items={[
      { label: '原方案屏上半径', value: formattedRadius(design.baseline.radiusMm), note: design.baseline.quality === 'reference-only' ? '存在模型警告，仅供参考' : '原透镜参数在同一固定屏上的读数' },
      { label: '搜索推荐半径', value: formattedRadius(recommendation?.radiusMm ?? null), note: recommendation ? '搜索范围内已计算的较好方案' : '暂无可推荐方案', primary: !!recommendation },
      { label: '相对原方案变化', value: improvement == null ? '—' : `${improvement >= 0 ? '减小' : '增大'} ${formatCompact(Math.abs(improvement) * 100)}%`, note: '仿真读数比较，不代表实测改善' },
    ]}/>
    <div className="rw-recommendation"><h3>{recommendation ? '搜索范围内的较好方案' : '暂无可推荐方案'}</h3>{recommendation ? <>
      <p>透镜位置 <strong>{formatCompact(recommendation.positionMm, 4)} mm</strong> · 焦距 <strong>{formatCompact(recommendation.focalLengthMm, 4)} mm</strong> · 观察屏固定 {formatCompact(design.goal.screenPositionMm, 4)} mm。</p>
      {recommendation.boundaryParameters.length > 0 && <p className="rw-result-alert">{recommendation.boundaryParameters.join('、')}位于搜索范围边界。</p>}
      <button className="rw-button" onClick={() => onOpenBuilder(recommendedSpatial(input, recommendation.experiment))}>在光路搭建中查看推荐<ArrowUpRight size={15}/></button>
    </> : <p role="status">{design.noRecommendationReason}</p>}</div>
    <div className="rw-chart-controls"><button className="rw-button" aria-pressed={phase === 'coarse'} onClick={() => { setPhase('coarse'); setSelected(0); }}>全范围</button><button className="rw-button" disabled={design.grids.length < 2} aria-pressed={phase === 'refined'} onClick={() => { setPhase('refined'); setSelected(0); }}>局部细化</button></div>
    <div className="rw-grid-label">焦距 / mm：{formatCompact(grid.focalsMm[0], 4)} → {formatCompact(grid.focalsMm.at(-1)!, 4)}</div>
    <div className="rw-heatmap" aria-label="位置与焦距组合的光斑半径比较">{rows.map((row, i) => <button key={i} className={row.radiusMm === null ? 'rw-invalid-cell' : 'rw-heat-cell'} style={{ opacity: row.radiusMm === null ? 1 : .12 + .88 * (max === min ? .5 : 1 - (row.radiusMm - min) / (max - min)) }} aria-label={`位置${formatCompact(row.positionMm, 4)}毫米、焦距${formatCompact(row.focalLengthMm, 4)}毫米，半径${row.radiusMm === null ? '无法计算' : formattedRadius(row.radiusMm)}`} aria-pressed={selected === i} onClick={() => setSelected(i)}/>)}</div>
    <div className="rw-grid-label">透镜位置 / mm：{formatCompact(grid.positionsMm[0], 4)} → {formatCompact(grid.positionsMm.at(-1)!, 4)}</div>
    <p className="rw-result-note">颜色越深，光斑越小。点击色块查看该组合的真实计算结果。</p>
    {chosen && <p className="rw-selected-point">位置 {formatCompact(chosen.positionMm, 4)} mm · 焦距 {formatCompact(chosen.focalLengthMm, 4)} mm · 屏上半径 {formattedRadius(chosen.radiusMm)}<small>{chosen.error ?? chosen.warnings.join('；')}</small></p>}
    <ResultDetails artifact={artifact} onOpenFormula={onOpenFormula}>
      <div className="rw-result-actions"><button className="rw-button" onClick={() => downloadDesign(design, 'csv')}><Download size={15}/>下载数据</button><button className="rw-button" onClick={() => downloadDesign(design, 'json')}>保存完整记录</button></div>
      <p className="rw-result-description">固定观察屏 {formatCompact(design.goal.screenPositionMm, 4)} mm，比较透镜位置与焦距的 {design.counts.total} 个组合。</p>
      <p className="rw-result-note rw-result-scope">无模型警告 {design.counts.withinModel} 组 · 仅供参考 {design.counts.referenceOnly} 组 · 无法计算 {design.counts.invalid} 组。</p>
      <ResearchModelNotes data-detail="explanation" title="物理假设" notes={['推荐来自本次搜索范围内已计算的组合，不证明连续范围的全局最优。']} warnings={design.rows.flatMap(row => row.warnings)} fullNotes={[design.method, ...design.limitations]}/>
    </ResultDetails>
  </>;
}

function StudyResults({
  study,
  input,
  onOpenBuilder,
  onOpenFormula,
  artifact,
}: {
  artifact: ResearchArtifact;
  study: StabilityStudy;
  input: SpatialExperiment;
  onOpenBuilder: (input: SpatialExperiment) => void;
  onOpenFormula?: (preset: Omit<FormulaPresetRequest, 'id'>) => void;
}) {
  const options = [{ key: 'baseline', label: '原方案', value: study.baseline }, ...(study.nominalBest ? [{ key: 'nominal', label: '标称光斑较小方案', value: study.nominalBest }] : []), ...(study.recommendation ? [{ key: 'robust', label: '误差下较稳定方案', value: study.recommendation }] : [])];
  const [choice, setChoice] = useState('baseline');
  const evaluation = options.find(o => o.key === choice)?.value ?? study.baseline;
  const recommendation = study.recommendation;
  const display = chooseLengthDisplay([evaluation.nominal.radiusMm, evaluation.maxRadiusMm, ...evaluation.rows.map(r => r.radiusMm)]);

  return <>
    <div className="rw-chart-controls"><label>查看偏差数据<select value={choice} onChange={event => setChoice(event.target.value)}>{options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label></div>
    <ResultHighlights items={[
      { label: '无偏差半径', value: formattedRadius(evaluation.nominal.radiusMm), note: `位置 ${formatCompact(evaluation.positionMm, 4)} mm · 焦距 ${formatCompact(evaluation.focalLengthMm, 4)} mm` },
      { label: '已算偏差中最大半径', value: formattedRadius(evaluation.maxRadiusMm), note: evaluation.eligible ? '全部已算组合通过模型检查' : '仅统计有效点，不能代表整个误差范围', primary: true },
      { label: '偏差组合', value: String(evaluation.counts.total), note: `无警告 ${evaluation.counts.withinModel} · 参考 ${evaluation.counts.referenceOnly} · 无法计算 ${evaluation.counts.invalid}` },
    ]}/>
    {study.mode === 'robust-search' && <div className="rw-recommendation"><h3>{recommendation ? '误差下较稳定的推荐方案' : '暂无可推荐方案'}</h3>{recommendation ? <>
      <p>透镜位置 <strong>{formatCompact(recommendation.positionMm, 4)} mm</strong> · 焦距 <strong>{formatCompact(recommendation.focalLengthMm, 4)} mm</strong> · 最大采样半径 <strong>{formattedRadius(recommendation.maxRadiusMm)}</strong>。</p>
      {recommendation.maxRadiusImprovementPercent !== null && <p>相对原方案的最大采样半径{recommendation.maxRadiusImprovementPercent >= 0 ? '减小' : '增大'} {formatCompact(Math.abs(recommendation.maxRadiusImprovementPercent))}%。</p>}
      {recommendation.boundaryParameters.length > 0 && <p className="rw-result-alert">{recommendation.boundaryParameters.join('、')}位于搜索范围边界。</p>}
      <button className="rw-button" onClick={() => onOpenBuilder(recommendedSpatial(input, recommendation.experiment))}>在光路搭建中查看推荐<ArrowUpRight size={15}/></button>
    </> : <p role="status">{study.noRecommendationReason}</p>}</div>}
    {!evaluation.eligible && <p className="rw-result-alert">部分组合存在警告或无法计算，不能将有效点的最大值当作整个范围的结论。</p>}
    <ErrorChart key={choice} evaluation={evaluation}/>
    <ResultDetails artifact={artifact} onOpenFormula={onOpenFormula}>
      <div className="rw-result-actions"><button className="rw-button" onClick={() => downloadStudy(study, 'csv')}><Download size={15}/>下载偏差数据</button><button className="rw-button" onClick={() => downloadStudy(study, 'json')}>保存完整记录</button></div>
      {options.length > 1 && <div className="rw-table-wrap"><table><caption>各方案在相同误差设置下的记录</caption><thead><tr><th>方案</th><th>无偏差半径 / {display.unit}</th><th>采样最大半径 / {display.unit}</th><th>模型检查</th></tr></thead><tbody>{options.map(o => <tr key={o.key} className={o.key === choice ? 'rw-result-selected' : undefined}><td>{o.label}</td><td>{o.value.nominal.radiusMm === null ? '—' : formatScaled(o.value.nominal.radiusMm, display)}</td><td>{o.value.maxRadiusMm === null ? '—' : formatScaled(o.value.maxRadiusMm, display)}</td><td>{o.value.eligible ? '全部已算组合通过' : '存在警告或无效组合'}</td></tr>)}</tbody></table></div>}
      <section className="rw-detail-section"><h3>全部偏差数据 · {evaluation.rows.length} 组</h3><div className="rw-table-wrap rw-error-table"><table><thead><tr><th>位置偏差 / mm</th><th>焦距偏差 / %</th><th>屏上半径 / {display.unit}</th><th>状态</th></tr></thead><tbody>{evaluation.rows.map((r, i) => <tr key={i}><td>{formatCompact(r.positionErrorMm, 4)}</td><td>{formatCompact(r.focalErrorPercent, 4)}</td><td>{r.radiusMm === null ? '—' : formatScaled(r.radiusMm, display)}</td><td>{r.error ?? (r.quality === 'reference-only' ? '仅供参考' : '✓')}</td></tr>)}</tbody></table></div></section>
      <ResearchModelNotes data-detail="explanation" title="物理假设" notes={['最大值来自已计算的偏差组合，不保证连续误差范围内的最大值。']} warnings={evaluation.rows.flatMap(row => row.warnings)} fullNotes={[study.method, ...study.limitations]}/>
    </ResultDetails>
  </>;
}

function ObjectComparisonResults({
  rows,
  onOpenBuilder,
  onOpenFormula,
  artifact,
}: {
  artifact: ResearchArtifact;
  rows: ResearchObjectResult[];
  onOpenBuilder: (input: SpatialExperiment) => void;
  onOpenFormula?: (preset: Omit<FormulaPresetRequest, 'id'>) => void;
}) {
  const csvRows: unknown[][] = [['探究对象', '来源', '观察屏', '高斯半径 / mm', '几何覆盖半径 / mm', '采样功率 / mW', '警告', '装置参数']];
  for (const r of rows) for (const s of r.evidence?.screens ?? []) csvRows.push([r.inputSnapshot.name, r.sourceLabel ?? '', s.name, s.gaussianRadiusMm, s.footprintRadiusMm, s.sampledPowerMw, r.evidence?.warnings.join('；'), JSON.stringify(r.inputSnapshot)]);
  const csv = csvRows.map(row => row.map(value => { const v = String(value ?? ''); return '"' + (/^[=+@-]/.test(v) ? "'" + v : v).replace(/"/g, '""') + '"'; }).join(',')).join('\n');

  const lengthDisplay = chooseLengthDisplay(rows.flatMap(r => r.evidence?.screens.flatMap(s => [s.gaussianRadiusMm, s.footprintRadiusMm]) ?? []));
  const powerDisplay = choosePowerDisplay(rows.flatMap(r => r.evidence?.screens.map(s => s.sampledPowerMw) ?? []));

  return <><ResultHighlights items={[
    { label: '比较对象', value: String(rows.length), note: '分别使用各自原有参数' },
    { label: '到屏读数', value: String(rows.reduce((total, r) => total + (r.evidence?.screens.length ?? 0), 0)), note: '保留各对象与观察屏的对应关系' },
    { label: '存在模型警告的对象', value: String(rows.filter(r => r.evidence?.warnings.length).length), note: '不自动判断装置优劣' },
  ]}/><div className="rw-table-wrap"><table><thead><tr><th>探究对象</th><th>观察屏</th><th>高斯半径 / {lengthDisplay.unit}</th><th>几何覆盖半径 / {lengthDisplay.unit}</th><th>采样功率 / {powerDisplay.unit}</th><th>状态</th></tr></thead><tbody>{rows.flatMap(r => r.evidence?.screens.length ? r.evidence.screens.map(s => <tr key={r.objectId + '-' + s.elementId}><td>{r.inputSnapshot.name}<small className="rw-comparison-source">{r.sourceLabel}</small></td><td>{cleanElementDisplayName(s.name)}</td><td>{s.gaussianRadiusMm === null ? '—' : formatScaled(s.gaussianRadiusMm, lengthDisplay)}</td><td>{s.footprintRadiusMm === null ? '—' : formatScaled(s.footprintRadiusMm, lengthDisplay)}</td><td>{formatScaled(s.sampledPowerMw, powerDisplay)}</td><td>{r.evidence!.warnings.length ? '存在模型警告' : '✓'}</td></tr>) : [<tr key={r.objectId}><td>{r.inputSnapshot.name}<small className="rw-comparison-source">{r.sourceLabel}</small></td><td colSpan={5}>装置没有观察屏，暂无到屏读数</td></tr>])}</tbody></table></div><ResultDetails artifact={artifact} onOpenFormula={onOpenFormula}><div className="rw-result-actions"><button className="rw-button" onClick={() => downloadResearch(csv, '探究对象比较', 'csv')}><Download size={15}/>下载数据</button><button className="rw-button" onClick={() => downloadResearch(rows, '探究对象比较', 'json')}>保存完整记录</button></div><p className="rw-result-note rw-result-scope">比较前需核对光源、屏的位置和评价指标。不同模型的高斯半径与几何覆盖半径不能混作同一指标；各屏读数也不自动代表装置优劣。</p>{rows.map(r => <div key={r.objectId} data-detail="explanation"><ResearchModelNotes data-detail="explanation" title={r.inputSnapshot.name} notes={measurementNotes(r.evidence)} warnings={r.evidence?.warnings ?? []} fullNotes={r.evidence?.assumptions ?? []}/><button className="rw-button" onClick={() => onOpenBuilder(r.inputSnapshot)}>在光路搭建中查看参数<ArrowUpRight size={14}/></button></div>)}</ResultDetails></>;
}

function ModelResults({
  artifact,
  onOpenFormula,
}: {
  artifact: Extract<ResearchArtifact, { kind: 'model' }>;
  onOpenFormula?: (preset: Omit<FormulaPresetRequest, 'id'>) => void;
}) {
  const data = artifact.data, definition = SCENE_DEFINITIONS[data.state.sceneId];
  const [scanIndex, setScanIndex] = useState(0);
  const [metricKey, setMetricKey] = useState(data.evidence.metrics.find(m => m.key === 'intensity' || m.key === 'reflectancePct')?.key ?? data.evidence.metrics[0].key);
  const scan = data.scans[scanIndex], metric = data.evidence.metrics.find(m => m.key === metricKey)!;
  const parameter = definition.parameters.find(p => p.key === scan?.field);
  const rawPoints = scan?.rows.map(row => ({ x: row.value, y: row.result.metrics.find(m => m.key === metricKey)?.value ?? null }));
  const valid = rawPoints?.filter((point): point is { x: number; y: number } => point.y !== null) ?? [];

  const display = chooseUnitForMetric(metric.unit, valid.map(p => p.y));
  const scaledMetricLabel = display.unit ? `${metric.label} / ${display.unit}` : metric.label;
  const minimum = valid.reduce<{ x: number; y: number } | null>((best, p) => (!best || p.y < best.y ? p : best), null);
  const maximum = valid.reduce<{ x: number; y: number } | null>((best, p) => (!best || p.y > best.y ? p : best), null);
  const formatVal = (n: number | null) => (n === null ? '—' : formatScaled(n, display) + (display.unit ? ' ' + display.unit : ''));
  const chartPoints = rawPoints?.map(p => ({ x: p.x, y: p.y === null ? null : clampZero(p.y) * display.factor })) ?? data.evidence.curve;

  const modelHighlights: Highlight[] = scan ? [
    { label: '已算点最小读数', value: formatVal(minimum?.y ?? null), note: minimum ? `${parameter?.label} ${formatCompact(minimum.x, 4)} ${parameter?.unit ?? ''}`.trim() : undefined, primary: true },
    { label: '已算点最大读数', value: formatVal(maximum?.y ?? null), note: maximum ? `${parameter?.label} ${formatCompact(maximum.x, 4)} ${parameter?.unit ?? ''}`.trim() : undefined },
  ] : [metric, ...data.evidence.metrics.filter(m => m.key !== metric.key)].slice(0, 2).map(m => ({ label: m.label, value: numberText(m.value) + (m.value !== null && m.unit ? ' ' + m.unit : ''), note: m.note || undefined }));

  return <>
    {scan && <div className="rw-chart-controls">{data.scans.length > 1 && <label>比较参数<select value={scanIndex} onChange={e => setScanIndex(Number(e.target.value))}>{data.scans.map((s, i) => <option key={i} value={i}>{definition.parameters.find(p => p.key === s.field)?.label ?? s.field}</option>)}</select></label>}<label>比较指标<select value={metricKey} onChange={e => setMetricKey(e.target.value)}>{data.evidence.metrics.map(m => <option key={m.key} value={m.key}>{modelMetricLabel(m)}</option>)}</select></label></div>}
    <ResultHighlights items={modelHighlights} />
    {(rawPoints?.length || data.evidence.curve.length) ? (
      <ResearchLineChart
        points={chartPoints}
        xLabel={scan ? `${parameter?.label ?? scan.field}${parameter?.unit ? ' / ' + parameter.unit : ''}` : data.evidence.chart.xLabel}
        yLabel={scan ? scaledMetricLabel : data.evidence.chart.yLabel}
        yUnit={scan ? display.unit : ''}
        highlightMin={!!scan}
      />
    ) : null}
    <ResultDetails artifact={artifact} onOpenFormula={onOpenFormula}>
      <div className="rw-detail-section-head">
        <h3>全部数据</h3>
        <button className="rw-button" onClick={() => {
          const rows = scan ? [[parameter?.label ?? scan.field, modelMetricLabel(metric)], ...scan.rows.map(row => [row.value, row.result.metrics.find(m => m.key === metricKey)?.value ?? ''])] : [['指标', '读数', '单位'], ...data.evidence.metrics.map(m => [m.label, m.value ?? '', m.unit])];
          downloadResearch('\uFEFF' + rows.map(row => row.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n'), definition.title, 'csv');
        }}><Download size={15}/>下载数据</button>
      </div>
      {scan ? <div className="rw-table-wrap"><table><thead><tr><th>{parameter?.label}{parameter?.unit ? ' / ' + parameter.unit : ''}</th><th>{scaledMetricLabel}</th></tr></thead><tbody>{scan.rows.map((row, i) => { const v = row.result.metrics.find(m => m.key === metricKey)?.value ?? null; const isMin = minimum !== null && v !== null && v === minimum.y; return <tr key={i} className={isMin ? 'rw-result-min' : undefined}><td>{formatCompact(row.value, 4)}{isMin && <span className="rw-table-tag">最小</span>}</td><td>{v === null ? '—' : formatScaled(v, display)}</td></tr>; })}</tbody></table></div> : <div className="rw-table-wrap"><table><thead><tr><th>指标</th><th>读数</th></tr></thead><tbody>{data.evidence.metrics.map(m => <tr key={m.key}><td>{modelMetricLabel(m)}</td><td>{numberText(m.value)}</td></tr>)}</tbody></table></div>}
      <ResearchModelNotes data-detail="explanation" title="物理假设" notes={[metric.note || '读数按所选模型计算。', data.limits]} warnings={[...data.evidence.warnings, ...data.scans.flatMap(s => s.rows.flatMap(r => r.result.warnings))]} fullNotes={[data.evidence.scope]} />
    </ResultDetails>
  </>;
}

function artifactDisplayTitle(artifact: ResearchArtifact): string {
  if (artifact.kind === 'comparison') {
    const field = COMPARISON_LABELS[artifact.data.field] ?? artifact.data.field;
    return `${field.replace(/（[^）]*）/, '')}比较`;
  }
  return artifact.title;
}

function artifactSubtitle(artifact: ResearchArtifact): string {
  if (artifact.kind === 'comparison') return '';
  if (artifact.kind === 'design') return `观察屏固定 ${formatCompact(artifact.data.goal.screenPositionMm, 4)} mm · 比较 ${artifact.data.counts.total} 组`;
  if (artifact.kind === 'study') return `位置 ±${formatCompact(artifact.data.tolerance.positionErrorMm, 4)} mm · 焦距 ±${formatCompact(artifact.data.tolerance.focalErrorPercent, 4)}%`;
  if (artifact.kind === 'simulation') return snapshotSummary(artifact.input);
  if (artifact.kind === 'objects') return `${artifact.data.length} 个探究对象横向比较`;
  return artifact.data.evidence.status;
}

export default function ResearchResults({
  artifact,
  baseline,
  onOpenBuilder,
  onOpenFormula,
}: {
  artifact: ResearchArtifact;
  baseline?: SpatialResult;
  onOpenBuilder: (input: SpatialExperiment) => void;
  onOpenFormula?: (preset: Omit<FormulaPresetRequest, 'id'>) => void;
}) {
  const subtitle = artifactSubtitle(artifact);
  return <div className="rw-results" key={artifact.id}>
    <div className="rw-results-head">
      <div>
        <span className="rw-result-kind">{RESULT_LABELS[artifact.kind]}</span>
        <h2>{artifactDisplayTitle(artifact)}</h2>
        {subtitle && <p className="rw-results-subtitle">{subtitle}</p>}
      </div>
      {artifact.kind !== 'model' && (
        <button type="button" className="rw-button rw-open-builder-btn" onClick={() => onOpenBuilder(artifact.input)}>
          光路区查看<ArrowUpRight size={14}/>
        </button>
      )}
    </div>
    {artifact.kind === 'model' ? <ModelResults artifact={artifact} onOpenFormula={onOpenFormula} /> : artifact.kind === 'objects' ? <ObjectComparisonResults artifact={artifact} rows={artifact.data} onOpenBuilder={onOpenBuilder} onOpenFormula={onOpenFormula} /> : artifact.kind === 'comparison' ? <ComparisonResults artifact={artifact} comparison={artifact.data} baseline={baseline} onOpenFormula={onOpenFormula} /> : artifact.kind === 'simulation' ? <SimulationResults artifact={artifact} data={artifact.data} onOpenFormula={onOpenFormula} /> : artifact.kind === 'design' ? <DesignResults artifact={artifact} design={artifact.data} input={artifact.input} onOpenBuilder={onOpenBuilder} onOpenFormula={onOpenFormula} /> : <StudyResults artifact={artifact} study={artifact.data} input={artifact.input} onOpenBuilder={onOpenBuilder} onOpenFormula={onOpenFormula} />}
  </div>;
}

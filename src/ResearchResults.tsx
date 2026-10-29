import { Children, isValidElement, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, Download } from 'lucide-react';
import { formatNumber } from './formatNumber';
import { COMPARISON_LABELS, type SpatialComparison } from './spatialAgent';
import type { SpatialExperiment, SpatialResult } from './builderModel';
import { downloadResearch, recommendedSpatial, type ResearchObjectResult } from './researchSession';
import { downloadDesign, type FocusDesign } from './research';
import { downloadStudy, type StabilityStudy } from './tolerance';
import { RESEARCH_METRIC_METHODS, artifactConditions, comparisonRange, snapshotConditions } from './researchRecords';
import type { ResearchEvidenceRef } from './researchPlan';
import { ErrorChart } from './ErrorChart';
import ResearchModelNotes from './ResearchModelNotes';
import { SCENE_DEFINITIONS, numberText, type SceneState } from './sceneRuntime';
import { modelMetricLabel, type ResearchModelResult } from './researchModels';
import SpatialFourierOutput from './SpatialFourierOutput';
import SpatialFourFOutput from './SpatialFourFOutput';

export type ResearchArtifact = ({ reference: ResearchEvidenceRef } & (
  | { id: string; kind: 'simulation'; title: string; createdAt: string; input: SpatialExperiment; data: SpatialResult }
  | { id: string; kind: 'comparison'; title: string; createdAt: string; input: SpatialExperiment; data: SpatialComparison }
  | { id: string; kind: 'design'; title: string; createdAt: string; input: SpatialExperiment; data: FocusDesign }
  | { id: string; kind: 'study'; title: string; createdAt: string; input: SpatialExperiment; data: StabilityStudy }
  | { id: string; kind: 'objects'; title: string; createdAt: string; input: SpatialExperiment; data: ResearchObjectResult[] }
  | { id: string; kind: 'model'; title: string; createdAt: string; input: SceneState; data: ResearchModelResult }));

type Point = { x: number; y: number | null };
type ScanMetric = keyof typeof RESEARCH_METRIC_METHODS;
const METRIC_LABELS: Record<ScanMetric, string> = { gaussianRadiusMm: '高斯半径 / mm', footprintRadiusMm: '几何覆盖半径 / mm', sampledPowerMw: '采样功率 / mW' };
const RESULT_LABELS: Record<ResearchArtifact['kind'], string> = { comparison: '参数扫描', design: '方案搜索与推荐', study: '误差分析', objects: '方案对比', simulation: '仿真读数', model: '模型实验' };

type Highlight = { label: string; value: string; note?: string };
function ResultHighlights({ items }: { items: Highlight[] }) {
  return <dl className="rw-result-highlights" aria-label="关键结果">{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}{item.note && <small>{item.note}</small>}</dd></div>)}</dl>;
}
const radius = (value: number | null) => value === null ? '—' : `${formatNumber(value)} mm`;
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
function ResearchLineChart({ points, xLabel, yLabel }: { points: Point[]; xLabel: string; yLabel: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))));
    observer.observe(container.current); return () => observer.disconnect();
  }, []);
  const values = points.filter((p): p is { x: number; y: number } => p.y !== null && Number.isFinite(p.y));
  if (!points.length) return null;
  const xs = points.map(p => p.x), ys = values.map(p => p.y);
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = ys.length ? Math.min(...ys) : 0, ymax = ys.length ? Math.max(...ys) : 1;
  const pad = Math.max((ymax - ymin) * .12, Math.abs(ymax) * .03, 1e-9);
  const low = Math.max(0, ymin - pad), high = Math.max(low + 1e-9, ymax + pad);
  const left = 74, right = width - 18, top = 20, bottom = 177;
  const x = (value: number) => left + (value - xmin) / (xmax - xmin || 1) * (right - left);
  const y = (value: number) => bottom - (value - low) / (high - low) * (bottom - top);
  let running = false;
  const path = points.map(p => {
    if (p.y === null) { running = false; return ''; }
    const command = `${running ? 'L' : 'M'}${x(p.x)},${y(p.y)}`; running = true; return command;
  }).join(' ');
  const indices = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  return <div ref={container} className="rw-line-chart"><svg viewBox={`0 0 ${width} 252`} role="img" aria-label={`${xLabel}与${yLabel}的实际计算比较，${values.length}个有效点`}>
    {[0, .5, 1].map(t => <g key={t}><line x1={left} x2={right} y1={top + t * (bottom - top)} y2={top + t * (bottom - top)} className="rw-grid-line"/><text x={left - 9} y={top + t * (bottom - top) + 4} textAnchor="end">{formatNumber(high - t * (high - low))}</text></g>)}
    <line x1={left} x2={right} y1={bottom} y2={bottom} className="rw-axis-line"/>
    {values.length > 0 && <path d={path} className="rw-chart-line"/>}
    {values.map((p, i) => <circle key={i} cx={x(p.x)} cy={y(p.y)} r={3.5} className="rw-chart-point"><title>{`${xLabel}：${formatNumber(p.x)}；${yLabel}：${formatNumber(p.y)}`}</title></circle>)}
    {indices.map((i, n) => <text key={i} x={x(points[i].x)} y={200} textAnchor={n === 0 ? 'start' : n === indices.length - 1 ? 'end' : 'middle'}>{formatNumber(points[i].x)}</text>)}
    <text x={left} y={12}>{yLabel}</text><text x={(left + right) / 2} y={236} textAnchor="middle">{xLabel}</text>
    {!values.length && <text x={(left + right) / 2} y={95} textAnchor="middle">没有可绘制的有效结果</text>}
  </svg></div>;
}

export function comparisonCSV(comparison: SpatialComparison): string {
  const cell = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const safe = (s: string) => /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  const rows: unknown[][] = [['装置快照', JSON.stringify(comparison.inputSnapshot)], ['参数', comparison.field], ['参数值', '观察屏', '几何覆盖半径_mm', '高斯半径_mm', '采样功率_mW', '警告', '错误']];
  for (const row of comparison.rows) {
    if (row.error) rows.push([row.value, '', '', '', '', '', safe(row.error)]);
    else for (const screen of row.screens) rows.push([row.value, safe(screen.name), screen.footprintRadiusMm, screen.gaussianRadiusMm, screen.sampledPowerMw, safe(row.warnings.join('；')), '']);
  }
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}

function ResultDetails({ artifact, children }: { artifact: ResearchArtifact; children: ReactNode }) {
  const [tab, setTab] = useState('data');
  const id = useId();
  const tabs = [{ key: 'data', label: '数据' }, { key: 'parameters', label: artifact.kind==='model'?'参数':'装置' }, { key: 'explanation', label: '说明' }];
  const blocks = Children.toArray(children);
  const isExplanation = (node: ReactNode) => isValidElement<{ 'data-detail'?: string }>(node) && node.props['data-detail'] === 'explanation';
  return <details className="rw-result-details"><summary>详情</summary><div className="rw-result-detail-body">
    <div className="rw-detail-tabs" role="tablist" aria-label="结果详情">{tabs.map((item, index) => <button key={item.key} id={`${id}-${item.key}`} role="tab" aria-selected={tab === item.key} aria-controls={`${id}-${item.key}-panel`} tabIndex={tab === item.key ? 0 : -1} onClick={() => setTab(item.key)} onKeyDown={event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
      if (next === null) return;
      event.preventDefault(); setTab(tabs[next].key); (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus();
    }}>{item.label}</button>)}</div>
    <div id={`${id}-data-panel`} role="tabpanel" aria-labelledby={`${id}-data`} hidden={tab !== 'data'}>{blocks.filter(node => !isExplanation(node))}</div>
    <div id={`${id}-explanation-panel`} role="tabpanel" aria-labelledby={`${id}-explanation`} hidden={tab !== 'explanation'}>{blocks.filter(isExplanation)}</div>
    <div id={`${id}-parameters-panel`} role="tabpanel" aria-labelledby={`${id}-parameters`} hidden={tab !== 'parameters'}><section className="rw-detail-section"><h3>{artifact.kind==='model'?'模型参数':'装置参数'}</h3>
      {artifact.kind === 'objects' ? artifact.data.map(r => <div key={r.objectId}><strong>{r.inputSnapshot.name}</strong>{snapshotConditions(r.inputSnapshot).map((text, i) => <p key={i}>{text}</p>)}</div>) : artifactConditions(artifact).map((text, i) => <p key={i}>{text}</p>)}
      <button className="rw-button" onClick={() => downloadResearch(artifact.kind === 'objects' ? artifact.data.map(r => ({ name: r.inputSnapshot.name, experiment: r.inputSnapshot })) : artifact.input, artifact.kind==='model'?'模型参数':'计算时装置参数', 'json')}><Download size={15}/>{artifact.kind==='model'?'保存参数':'保存装置'}</button>
    </section>
    <p className="rw-result-note">记录时间：{new Date(artifact.createdAt).toLocaleString('zh-CN')}</p></div>
  </div></details>;
}

function ComparisonResults({ comparison, artifact, baseline }: { comparison: SpatialComparison; artifact: ResearchArtifact; baseline?: SpatialResult }) {
  const screens = [...new Map(comparison.rows.flatMap(row => row.error ? [] : row.screens).map(s => [s.elementId, s])).values()];
  const [screenId, setScreenId] = useState(screens[0]?.elementId ?? '');
  const [metric, setMetric] = useState<ScanMetric>(screens.some(s => s.gaussianRadiusMm !== null) ? 'gaussianRadiusMm' : 'sampledPowerMw');
  const label = METRIC_LABELS[metric];
  const fieldLabel = COMPARISON_LABELS[comparison.field] ?? comparison.field;
  const hasWave = comparison.rows.some(row => (row.fourier ?? row.fourF)?.screenId === screenId);
  return <>
    {hasWave && <section className="rw-detail-section"><h3>波动计算读数</h3><p className="rw-result-note">取样点光强是相对值，不是功率；下方几何采样指标不能代替它。</p><div className="rw-table-wrap"><table><thead><tr><th>{fieldLabel}</th><th>屏上取样点 / mm</th><th>相对光强</th><th>到屏功率 / mW</th></tr></thead><tbody>{comparison.rows.map((row, i) => {
      const wave = row.error ? null : [row.fourier, row.fourF].find(w => w?.screenId === screenId);
      const probe = wave && ('observationUm' in wave.parameters ? wave.parameters.observationUm / 1000 : wave.parameters.observationMm);
      return <tr key={i}><td>{formatNumber(row.value)}</td><td>{probe == null ? '—' : formatNumber(probe)}</td><td>{wave ? formatNumber(wave.pointIntensity) : '—'}</td><td>{wave ? formatNumber(wave.capturedPowerMw) : '—'}</td></tr>;
    })}</tbody></table></div><p className="rw-result-note">傅里叶光强相对频谱中心；4f光强相对输入中心。— 表示该点未得到有效波动结果。</p></section>}
    <div className="rw-chart-controls"><label>观察屏<select value={screenId} disabled={!screens.length} onChange={event => setScreenId(event.target.value)}>{!screens.length && <option value="">无可用读数</option>}{screens.map(s => <option key={s.elementId} value={s.elementId}>{s.name}</option>)}</select></label><label>比较指标<select value={metric} onChange={event => setMetric(event.target.value as ScanMetric)}><option value="gaussianRadiusMm">高斯半径</option><option value="footprintRadiusMm">几何覆盖半径</option><option value="sampledPowerMw">采样功率</option></select></label></div>
    <ResultHighlights items={scanHighlights(comparison, screenId, metric)}/>
    {comparison.rows.some(r => r.error || r.warnings.length) && <p className="rw-result-alert">存在模型警告的点 {comparison.rows.filter(r => r.warnings.length).length} 个，无法计算的点 {comparison.rows.filter(r => r.error).length} 个；警告读数仅供参考。</p>}
    <ResearchLineChart points={comparison.rows.map(row => ({ x: row.value, y: row.error ? null : row.screens.find(s => s.elementId === screenId)?.[metric] ?? null }))} xLabel={fieldLabel} yLabel={label}/>
    <ResultDetails artifact={artifact}>
    {baseline && <section className="rw-detail-section"><h3>基准读数</h3><p>{baseline.screens.find(s => s.elementId === screenId)?.name ?? '所选观察屏'} · {label}：{baseline.screens.find(s => s.elementId === screenId)?.[metric] == null ? '—' : formatNumber(baseline.screens.find(s => s.elementId === screenId)![metric]!)}</p></section>}
    <p className="rw-result-description">{comparisonRange(comparison)}。其余装置参数保持不变。</p>
    <p className="rw-result-note rw-result-scope">本次只比较了 {comparison.rows.length} 个参数值；连线帮助观察趋势，不代表计算了点之间的所有结果。</p>
    <section className="rw-detail-section"><h3>全部扫描数据 · {comparison.rows.length} 点</h3><div className="rw-table-wrap"><table><thead><tr><th>{fieldLabel}</th><th>{label}</th><th>状态</th></tr></thead><tbody>{comparison.rows.map((row, i) => { const value = row.error ? null : row.screens.find(s => s.elementId === screenId)?.[metric]; return <tr key={i}><td>{formatNumber(row.value)}</td><td>{value == null ? '—' : formatNumber(value)}</td><td>{row.error ?? (row.warnings.length ? '存在模型警告' : value == null ? '该指标不可用' : '已计算')}</td></tr>; })}</tbody></table></div></section>
    <ResearchModelNotes data-detail="explanation" notes={[RESEARCH_METRIC_METHODS[metric]]} warnings={comparison.rows.flatMap(row => row.warnings)} fullNotes={[...Object.values(RESEARCH_METRIC_METHODS), '高斯半径描述理想包络，已包含自由传播时的衍射发散，不描述截光后的衍射图样或真实像差。其他物理指标须按各自模型及条件解释，不能混入这里的高斯半径或几何采样功率。']}/>
    <button className="rw-button" onClick={() => downloadResearch(comparisonCSV(comparison), '参数比较', 'csv')}><Download size={15}/>下载数据</button>
    </ResultDetails>
  </>;
}

function SimulationResults({ data, artifact }: { data: SpatialResult; artifact: ResearchArtifact }) {
  const [screenId, setScreenId] = useState(data.screens[0]?.elementId ?? '');
  const selected = data.screens.find(s => s.elementId === screenId);
  const wave = [data.fourier, data.fourF].find(w => w?.screenId === screenId);
  const screenRadius = (data.inputSnapshot.elements.find(e => e.id === screenId)?.diameterMm ?? 40) / 2;
  return <>
    {data.screens.length > 1 && <div className="rw-chart-controls"><label>查看观察屏<select value={screenId} onChange={event => setScreenId(event.target.value)}>{data.screens.map(s => <option key={s.elementId} value={s.elementId}>{s.name}</option>)}</select></label></div>}
    {data.fourier?.screenId === screenId && <SpatialFourierOutput result={data.fourier} radius={screenRadius}/>}
    {data.fourF?.screenId === screenId && <SpatialFourFOutput result={data.fourF} radius={screenRadius}/>}
    <ResultHighlights items={wave ? [
      { label: '到屏功率（波动计算）', value: `${formatNumber(wave.capturedPowerMw)} mW`, note: selected?.name },
    ] : [
      { label: '高斯半径', value: radius(selected?.gaussianRadiusMm ?? null), note: selected?.name ?? '暂无到屏读数' },
      { label: '几何覆盖半径', value: radius(selected?.footprintRadiusMm ?? null), note: '采样光线的落点范围' },
      { label: '采样功率', value: selected ? `${formatNumber(selected.sampledPowerMw)} mW` : '—', note: '有限光线采样近似' },
    ]}/>
    {data.warnings.length > 0 && <p className="rw-result-alert">存在 {data.warnings.length} 条模型警告，展开详情查看。</p>}
    <ResultDetails artifact={artifact}>
    <div className="rw-table-wrap"><table><thead><tr><th>观察屏</th><th>高斯半径 / mm</th><th>几何覆盖半径 / mm</th><th>采样功率 / mW</th></tr></thead><tbody>{data.screens.map(s => <tr key={s.elementId} className={s.elementId === screenId ? 'rw-result-selected' : undefined}><td>{s.name}</td><td>{s.gaussianRadiusMm === null ? '—' : formatNumber(s.gaussianRadiusMm)}</td><td>{s.footprintRadiusMm === null ? '—' : formatNumber(s.footprintRadiusMm)}</td><td>{formatNumber(s.sampledPowerMw)}</td></tr>)}</tbody></table></div>
    {!data.screens.length && <p className="rw-result-note">装置没有观察屏，尚无到屏读数。</p>}
    <p className="rw-result-note rw-result-scope">高斯半径描述理想光束包络，几何覆盖半径描述采样光线落点范围。以上为仿真结果。</p>
    <ResearchModelNotes data-detail="explanation" notes={measurementNotes(data)} warnings={data.warnings} fullNotes={data.assumptions}/>
    <button className="rw-button" onClick={() => downloadResearch(data, '光学仿真结果', 'json')}><Download size={15}/>保存完整记录</button>
    </ResultDetails>
  </>;
}

function DesignResults({ design, input, onOpenBuilder, artifact }: { artifact: ResearchArtifact; design: FocusDesign; input: SpatialExperiment; onOpenBuilder: (input: SpatialExperiment) => void }) {
  const [phase, setPhase] = useState<'coarse' | 'refined'>('coarse');
  const [selected, setSelected] = useState(0);
  const rows = design.rows.filter(row => row.phase === phase), values = rows.flatMap(r => r.radiusMm === null ? [] : [r.radiusMm]);
  const min = values.length ? Math.min(...values) : 0, max = values.length ? Math.max(...values) : 1;
  const recommendation = design.recommendation, chosen = rows[selected] ?? rows[0];
  const grid = design.grids.find(g => g.phase === phase) ?? design.grids[0];
  const improvement = recommendation?.improvementFraction;
  return <>
    <ResultHighlights items={[
      { label: '原方案屏上半径', value: radius(design.baseline.radiusMm), note: design.baseline.quality === 'reference-only' ? '存在模型警告，仅供参考' : '原透镜参数在同一固定屏上的读数' },
      { label: '搜索推荐半径', value: radius(recommendation?.radiusMm ?? null), note: recommendation ? '搜索范围内已计算的较好方案' : '暂无可推荐方案' },
      { label: '相对原方案变化', value: improvement == null ? '—' : `${improvement >= 0 ? '减小' : '增大'} ${formatNumber(Math.abs(improvement) * 100)}%`, note: '仿真读数比较，不代表实测改善' },
    ]}/>
    <div className="rw-recommendation"><h3>{recommendation ? '搜索范围内的较好方案' : '暂无可推荐方案'}</h3>{recommendation ? <>
      <p>透镜位置 <strong>{formatNumber(recommendation.positionMm)} mm</strong> · 焦距 <strong>{formatNumber(recommendation.focalLengthMm)} mm</strong> · 观察屏固定 {formatNumber(design.goal.screenPositionMm)} mm。</p>
      {recommendation.boundaryParameters.length > 0 && <p className="rw-result-alert">{recommendation.boundaryParameters.join('、')}位于搜索范围边界。</p>}
      <button className="rw-button" onClick={() => onOpenBuilder(recommendedSpatial(input, recommendation.experiment))}>在光路搭建中查看推荐<ArrowUpRight size={15}/></button>
    </> : <p role="status">{design.noRecommendationReason}</p>}</div>
    <div className="rw-chart-controls"><button className="rw-button" aria-pressed={phase === 'coarse'} onClick={() => { setPhase('coarse'); setSelected(0); }}>全范围</button><button className="rw-button" disabled={design.grids.length < 2} aria-pressed={phase === 'refined'} onClick={() => { setPhase('refined'); setSelected(0); }}>局部细化</button></div>
    <div className="rw-grid-label">焦距 / mm：{formatNumber(grid.focalsMm[0])} → {formatNumber(grid.focalsMm.at(-1)!)}</div>
    <div className="rw-heatmap" aria-label="位置与焦距组合的光斑半径比较">{rows.map((row, i) => <button key={i} className={row.radiusMm === null ? 'rw-invalid-cell' : 'rw-heat-cell'} style={{ opacity: row.radiusMm === null ? 1 : .12 + .88 * (max === min ? .5 : 1 - (row.radiusMm - min) / (max - min)) }} aria-label={`位置${formatNumber(row.positionMm)}毫米、焦距${formatNumber(row.focalLengthMm)}毫米，半径${row.radiusMm === null ? '无法计算' : formatNumber(row.radiusMm) + '毫米'}`} aria-pressed={selected === i} onClick={() => setSelected(i)}/>)}</div>
    <div className="rw-grid-label">透镜位置 / mm：{formatNumber(grid.positionsMm[0])} → {formatNumber(grid.positionsMm.at(-1)!)}</div>
    <p className="rw-result-note">颜色越深，光斑越小。点击色块查看该组合的真实计算结果。</p>
    {chosen && <p className="rw-selected-point">位置 {formatNumber(chosen.positionMm)} mm · 焦距 {formatNumber(chosen.focalLengthMm)} mm · 屏上半径 {radius(chosen.radiusMm)}<small>{chosen.error ?? chosen.warnings.join('；')}</small></p>}
    <ResultDetails artifact={artifact}>
    <p className="rw-result-description">固定观察屏 {formatNumber(design.goal.screenPositionMm)} mm，比较透镜位置与焦距的 {design.counts.total} 个组合。</p>
    <p className="rw-result-note rw-result-scope">无模型警告 {design.counts.withinModel} 组 · 仅供参考 {design.counts.referenceOnly} 组 · 无法计算 {design.counts.invalid} 组。</p>
    <ResearchModelNotes data-detail="explanation" notes={['推荐来自本次搜索范围内已计算的组合，不证明连续范围的全局最优。']} warnings={design.rows.flatMap(row => row.warnings)} fullNotes={[design.method, ...design.limitations]}/>
    <div className="rw-result-actions"><button className="rw-button" onClick={() => downloadDesign(design, 'csv')}><Download size={15}/>下载数据</button><button className="rw-button" onClick={() => downloadDesign(design, 'json')}>保存完整记录</button></div>
    </ResultDetails>
  </>;
}

function StudyResults({ study, input, onOpenBuilder, artifact }: { artifact: ResearchArtifact; study: StabilityStudy; input: SpatialExperiment; onOpenBuilder: (input: SpatialExperiment) => void }) {
  const options = [{ key: 'baseline', label: '原方案', value: study.baseline }, ...(study.nominalBest ? [{ key: 'nominal', label: '标称光斑较小方案', value: study.nominalBest }] : []), ...(study.recommendation ? [{ key: 'robust', label: '误差下较稳定方案', value: study.recommendation }] : [])];
  const [choice, setChoice] = useState('baseline');
  const evaluation = options.find(o => o.key === choice)?.value ?? study.baseline;
  const recommendation = study.recommendation;
  return <>
    <div className="rw-chart-controls"><label>查看偏差数据<select value={choice} onChange={event => setChoice(event.target.value)}>{options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label></div>
    <ResultHighlights items={[
      { label: '无偏差半径', value: radius(evaluation.nominal.radiusMm), note: `位置 ${formatNumber(evaluation.positionMm)} mm · 焦距 ${formatNumber(evaluation.focalLengthMm)} mm` },
      { label: '已算偏差中最大半径', value: radius(evaluation.maxRadiusMm), note: evaluation.eligible ? '全部已算组合通过模型检查' : '仅统计有效点，不能代表整个误差范围' },
      { label: '偏差组合', value: String(evaluation.counts.total), note: `无警告 ${evaluation.counts.withinModel} · 参考 ${evaluation.counts.referenceOnly} · 无法计算 ${evaluation.counts.invalid}` },
    ]}/>
    {study.mode === 'robust-search' && <div className="rw-recommendation"><h3>{recommendation ? '误差下较稳定的推荐方案' : '暂无可推荐方案'}</h3>{recommendation ? <>
      <p>透镜位置 <strong>{formatNumber(recommendation.positionMm)} mm</strong> · 焦距 <strong>{formatNumber(recommendation.focalLengthMm)} mm</strong> · 最大采样半径 <strong>{radius(recommendation.maxRadiusMm)}</strong>。</p>
      {recommendation.maxRadiusImprovementPercent !== null && <p>相对原方案的最大采样半径{recommendation.maxRadiusImprovementPercent >= 0 ? '减小' : '增大'} {formatNumber(Math.abs(recommendation.maxRadiusImprovementPercent))}%。</p>}
      {recommendation.boundaryParameters.length > 0 && <p className="rw-result-alert">{recommendation.boundaryParameters.join('、')}位于搜索范围边界。</p>}
      <button className="rw-button" onClick={() => onOpenBuilder(recommendedSpatial(input, recommendation.experiment))}>在光路搭建中查看推荐<ArrowUpRight size={15}/></button>
    </> : <p role="status">{study.noRecommendationReason}</p>}</div>}
    <p className="rw-result-description">透镜位置允许偏差 ±{formatNumber(study.tolerance.positionErrorMm)} mm，焦距允许偏差 ±{formatNumber(study.tolerance.focalErrorPercent)}%。</p>
    <p className="rw-result-note rw-result-scope">最大值来自已计算偏差组合，不是连续误差范围的严格保证。</p>
    {!evaluation.eligible && <p className="rw-result-alert">部分组合存在警告或无法计算，不能将有效点的最大值当作整个范围的结论。</p>}
    <ErrorChart key={choice} evaluation={evaluation}/>
    <ResultDetails artifact={artifact}>
    {options.length > 1 && <div className="rw-table-wrap"><table><caption>各方案在相同误差设置下的记录</caption><thead><tr><th>方案</th><th>无偏差半径 / mm</th><th>采样最大半径 / mm</th><th>模型检查</th></tr></thead><tbody>{options.map(o => <tr key={o.key} className={o.key === choice ? 'rw-result-selected' : undefined}><td>{o.label}</td><td>{o.value.nominal.radiusMm === null ? '—' : formatNumber(o.value.nominal.radiusMm)}</td><td>{o.value.maxRadiusMm === null ? '—' : formatNumber(o.value.maxRadiusMm)}</td><td>{o.value.eligible ? '全部已算组合通过' : '存在警告或无效组合'}</td></tr>)}</tbody></table></div>}
    <section className="rw-detail-section"><h3>全部偏差数据 · {evaluation.rows.length} 组</h3><div className="rw-table-wrap rw-error-table"><table><thead><tr><th>位置偏差 / mm</th><th>焦距偏差 / %</th><th>屏上半径 / mm</th><th>状态</th></tr></thead><tbody>{evaluation.rows.map((r, i) => <tr key={i}><td>{formatNumber(r.positionErrorMm)}</td><td>{formatNumber(r.focalErrorPercent)}</td><td>{r.radiusMm === null ? '—' : formatNumber(r.radiusMm)}</td><td>{r.error ?? (r.quality === 'reference-only' ? '仅供参考' : '已计算')}</td></tr>)}</tbody></table></div></section>
    <ResearchModelNotes data-detail="explanation" notes={['最大值来自已计算的偏差组合，不保证连续误差范围内的最大值。']} warnings={evaluation.rows.flatMap(row => row.warnings)} fullNotes={[study.method, ...study.limitations]}/>
    <div className="rw-result-actions"><button className="rw-button" onClick={() => downloadStudy(study, 'csv')}><Download size={15}/>下载偏差数据</button><button className="rw-button" onClick={() => downloadStudy(study, 'json')}>保存完整记录</button></div>
    </ResultDetails>
  </>;
}

function ObjectComparisonResults({ rows, onOpenBuilder, artifact }: { artifact: ResearchArtifact; rows: ResearchObjectResult[]; onOpenBuilder: (input: SpatialExperiment) => void }) {
  const csvRows: unknown[][] = [['探究对象', '来源', '观察屏', '高斯半径 / mm', '几何覆盖半径 / mm', '采样功率 / mW', '警告', '装置参数']];
  for (const r of rows) for (const s of r.evidence?.screens ?? []) csvRows.push([r.inputSnapshot.name, r.sourceLabel ?? '', s.name, s.gaussianRadiusMm, s.footprintRadiusMm, s.sampledPowerMw, r.evidence?.warnings.join('；'), JSON.stringify(r.inputSnapshot)]);
  const csv = csvRows.map(row => row.map(value => { const v = String(value ?? ''); return '"' + (/^[=+@-]/.test(v) ? "'" + v : v).replace(/"/g, '""') + '"'; }).join(',')).join('\n');
  return <><ResultHighlights items={[
    { label: '比较对象', value: String(rows.length), note: '分别使用各自原有参数' },
    { label: '到屏读数', value: String(rows.reduce((total, r) => total + (r.evidence?.screens.length ?? 0), 0)), note: '保留各对象与观察屏的对应关系' },
    { label: '存在模型警告的对象', value: String(rows.filter(r => r.evidence?.warnings.length).length), note: '不自动判断装置优劣' },
  ]}/><p className="rw-result-description">分别计算各对象原有参数，汇总观察屏读数。</p><div className="rw-table-wrap"><table><thead><tr><th>探究对象</th><th>观察屏</th><th>高斯半径 / mm</th><th>几何覆盖半径 / mm</th><th>采样功率 / mW</th><th>状态</th></tr></thead><tbody>{rows.flatMap(r => r.evidence?.screens.length ? r.evidence.screens.map(s => <tr key={r.objectId + '-' + s.elementId}><td>{r.inputSnapshot.name}<small className="rw-comparison-source">{r.sourceLabel}</small></td><td>{s.name}</td><td>{s.gaussianRadiusMm === null ? '—' : formatNumber(s.gaussianRadiusMm)}</td><td>{s.footprintRadiusMm === null ? '—' : formatNumber(s.footprintRadiusMm)}</td><td>{formatNumber(s.sampledPowerMw)}</td><td>{r.evidence!.warnings.length ? '存在模型警告' : '已计算'}</td></tr>) : [<tr key={r.objectId}><td>{r.inputSnapshot.name}<small className="rw-comparison-source">{r.sourceLabel}</small></td><td colSpan={5}>装置没有观察屏，暂无到屏读数</td></tr>])}</tbody></table></div><ResultDetails artifact={artifact}><p className="rw-result-note rw-result-scope">比较前需核对光源、屏的位置和评价指标。不同模型的高斯半径与几何覆盖半径不能混作同一指标；各屏读数也不自动代表装置优劣。</p>{rows.map(r => <div key={r.objectId} data-detail="explanation"><ResearchModelNotes data-detail="explanation" title={r.inputSnapshot.name} notes={measurementNotes(r.evidence)} warnings={r.evidence?.warnings ?? []} fullNotes={r.evidence?.assumptions ?? []}/><button className="rw-button" onClick={() => onOpenBuilder(r.inputSnapshot)}>在光路搭建中查看参数<ArrowUpRight size={14}/></button></div>)}<div className="rw-result-actions"><button className="rw-button" onClick={() => downloadResearch(csv, '探究对象比较', 'csv')}><Download size={15}/>下载数据</button><button className="rw-button" onClick={() => downloadResearch(rows, '探究对象比较', 'json')}>保存完整记录</button></div></ResultDetails></>;
}

function ModelResults({artifact}: {artifact: Extract<ResearchArtifact,{kind:'model'}>}) {
  const data=artifact.data, definition=SCENE_DEFINITIONS[data.state.sceneId];
  const [scanIndex,setScanIndex]=useState(0);
  const [metricKey,setMetricKey]=useState(data.evidence.metrics.find(m=>m.key==='intensity'||m.key==='reflectancePct')?.key??data.evidence.metrics[0].key);
  const scan=data.scans[scanIndex], metric=data.evidence.metrics.find(m=>m.key===metricKey)!;
  const parameter=definition.parameters.find(p=>p.key===scan?.field);
  const points=scan?.rows.map(row=>({x:row.value,y:row.result.metrics.find(m=>m.key===metricKey)?.value??null}));
  const valid=points?.filter((point):point is {x:number;y:number}=>point.y!==null)??[];
  const minimum=valid.reduce<{x:number;y:number}|null>((best,p)=>!best||p.y<best.y?p:best,null), maximum=valid.reduce<{x:number;y:number}|null>((best,p)=>!best||p.y>best.y?p:best,null);
  const value=(n:number|null)=>numberText(n)+(n!==null&&metric.unit?' '+metric.unit:'');
  return <>
    {scan&&<div className="rw-chart-controls">{data.scans.length>1&&<label>比较参数<select value={scanIndex} onChange={e=>setScanIndex(Number(e.target.value))}>{data.scans.map((s,i)=><option key={i} value={i}>{definition.parameters.find(p=>p.key===s.field)?.label??s.field}</option>)}</select></label>}<label>比较指标<select value={metricKey} onChange={e=>setMetricKey(e.target.value)}>{data.evidence.metrics.map(m=><option key={m.key} value={m.key}>{modelMetricLabel(m)}</option>)}</select></label></div>}
    <ResultHighlights items={scan?[
      {label:'有效读数 / 扫描点',value:`${valid.length} / ${scan.rows.length}`,note:modelMetricLabel(metric)},
      {label:'已算点最小读数',value:value(minimum?.y??null),note:minimum?`${parameter?.label} ${numberText(minimum.x)} ${parameter?.unit??''}`:undefined},
      {label:'已算点最大读数',value:value(maximum?.y??null),note:maximum?`${parameter?.label} ${numberText(maximum.x)} ${parameter?.unit??''}`:undefined},
    ]:[metric,...data.evidence.metrics.filter(m=>m.key!==metric.key)].slice(0,3).map(m=>({label:m.label,value:numberText(m.value)+(m.value!==null&&m.unit?' '+m.unit:''),note:m.note||undefined}))}/>
    {(points?.length||data.evidence.curve.length)?<ResearchLineChart points={points??data.evidence.curve} xLabel={scan?`${parameter?.label??scan.field}${parameter?.unit?' / '+parameter.unit:''}`:data.evidence.chart.xLabel} yLabel={scan?modelMetricLabel(metric):data.evidence.chart.yLabel}/>:null}
    <ResultDetails artifact={artifact}>
      {data.defaultParameters.length>0&&<p className="rw-result-note">未指定的参数采用模型示范默认值，具体数值见“参数”。</p>}
      {scan?<div className="rw-table-wrap"><table><thead><tr><th>{parameter?.label}{parameter?.unit?' / '+parameter.unit:''}</th><th>{modelMetricLabel(metric)}</th></tr></thead><tbody>{scan.rows.map((row,i)=><tr key={i}><td>{numberText(row.value)}</td><td>{numberText(row.result.metrics.find(m=>m.key===metricKey)?.value??null)}</td></tr>)}</tbody></table></div>:<div className="rw-table-wrap"><table><thead><tr><th>指标</th><th>读数</th></tr></thead><tbody>{data.evidence.metrics.map(m=><tr key={m.key}><td>{modelMetricLabel(m)}</td><td>{numberText(m.value)}</td></tr>)}</tbody></table></div>}
      {scan&&<p className="rw-result-note">只计算了这 {scan.rows.length} 个取值；曲线连线不表示已经验证连续范围。</p>}
      <ResearchModelNotes data-detail="explanation" notes={[metric.note||'读数按所选模型计算。',data.limits]} warnings={[...data.evidence.warnings,...data.scans.flatMap(s=>s.rows.flatMap(r=>r.result.warnings))]} fullNotes={[data.evidence.scope]}/>
      <button className="rw-button" onClick={()=>{
        const rows=scan?[[parameter?.label??scan.field,modelMetricLabel(metric)],...scan.rows.map(row=>[row.value,row.result.metrics.find(m=>m.key===metricKey)?.value??''])]:[['指标','读数','单位'],...data.evidence.metrics.map(m=>[m.label,m.value??'',m.unit])];
        downloadResearch('\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n'),definition.title,'csv');
      }}><Download size={15}/>下载数据</button>
    </ResultDetails>
  </>;
}

export default function ResearchResults({ artifact, baseline, onOpenBuilder }: { artifact: ResearchArtifact; baseline?: SpatialResult; onOpenBuilder: (input: SpatialExperiment) => void }) {
  return <div className="rw-results" key={artifact.id}>
    <span className="rw-result-kind">{RESULT_LABELS[artifact.kind]}</span>
    <h2>{artifact.title}</h2>
    {artifact.kind==='model'?<ModelResults artifact={artifact}/>:artifact.kind === 'objects' ? <ObjectComparisonResults artifact={artifact} rows={artifact.data} onOpenBuilder={onOpenBuilder}/> : artifact.kind === 'comparison' ? <ComparisonResults artifact={artifact} comparison={artifact.data} baseline={baseline}/> : artifact.kind === 'simulation' ? <SimulationResults artifact={artifact} data={artifact.data}/> : artifact.kind === 'design' ? <DesignResults artifact={artifact} design={artifact.data} input={artifact.input} onOpenBuilder={onOpenBuilder}/> : <StudyResults artifact={artifact} study={artifact.data} input={artifact.input} onOpenBuilder={onOpenBuilder}/>}

  </div>;
}

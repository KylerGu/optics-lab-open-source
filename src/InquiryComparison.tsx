import { useSpatialSimulation } from './useSpatialSimulation';
import type { SpatialExperiment, SpatialResult } from './builderModel';
import { visualComparisonStatus, visualParameter, VISUAL_FIELDS, type ResearchVisualGuide } from './researchVisual';

const number = (n: number | null | undefined) => n == null ? '—' : Number(n.toPrecision(5)).toString();
export default function InquiryComparison({ guide, experiment, result, pending, error, retry }: {
  guide: ResearchVisualGuide; experiment: SpatialExperiment; result: SpatialResult | null;
  pending: boolean; error: string | null; retry: () => void;
}) {
  const before = useSpatialSimulation(guide.snapshot, true);
  const state = visualComparisonStatus(guide.snapshot, experiment, guide.action);
  const screenName = guide.snapshot.elements.find(e => e.id === guide.action.screenId)?.name;
  const baseline = before.result?.screens.find(s => s.elementId === guide.action.screenId);
  const current = state === 'missing' ? null : result?.screens.find(s => s.elementId === guide.action.screenId);
  const radii = [baseline?.gaussianRadiusMm, current?.gaussianRadiusMm];
  const extent = Math.max(.001, ...radii.map(r => r ?? 0)) * 1.3;
  return <section className="sb-inquiry-comparison" aria-label="调整前后光斑对照">
    <div className="sb-inquiry-pair">{[baseline, current].map((screen, i) => {
      const loading = i === 0 ? before.status === 'pending' : pending;
      const failure = i === 0 ? before.error : error;
      const radius = screen?.gaussianRadiusMm;
      return <article key={i}><strong>{i === 0 ? '调整前' : '当前'} · {screenName}</strong><span>{guide.action.field && VISUAL_FIELDS[guide.action.field]}：{number(visualParameter(i === 0 ? guide.snapshot : experiment, guide.action))} mm</span>
        <svg viewBox="0 0 160 120" role="img" aria-label={`${i === 0 ? '调整前' : '当前'}高斯光斑轮廓`}><path d="M30 60H130M80 10V100" stroke="#b4c4d7" strokeDasharray="3 3"/>{radius != null && !loading && !failure && <circle cx="80" cy="60" r={radius / extent * 50} fill="#5597ee22" stroke="#377ed1" strokeWidth="1.5"/>}<path d="M30 101V107M30 104H130M130 101V107" stroke="#70859e"/><text x="80" y="117" textAnchor="middle" fontSize="9" fill="#53677f">标尺 {number(extent * 2)} mm</text></svg>
        <span>{loading ? '计算中…' : failure ? failure : radius == null ? '当前条件无高斯半径，不能显示光斑对照。' : `光斑半径 ${number(radius)} mm`}</span>
        {failure && <button onClick={i === 0 ? before.retry : retry}>重新计算</button>}
      </article>;
    })}</div>
    <p role="status">{state === 'missing' ? '目标器件已删除或更换，请关闭对照后重新选择装置。' : state === 'multiple' ? '其他条件也已改变，这组结果不能只归因于指定参数。' : state === 'unchanged' ? '尚未改变参数；可拖动已标出的滑杆，或直接输入数值。' : '仅指定参数改变，其余装置条件一致。'}</p>
    <small>两图使用相同比例；圆线表示光强降至中心约13.5%的边界，不是相机照片。理想高斯模型，未计真实像差与截光后的衍射。</small>
    {[...(before.result?.warnings ?? []), ...(result?.warnings ?? [])].length > 0 && <details><summary>查看计算提示</summary>{[...new Set([...(before.result?.warnings ?? []), ...(result?.warnings ?? [])])].map(w => <p key={w}>{w}</p>)}</details>}
  </section>;
}

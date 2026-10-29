import type { SpatialExperiment } from './builderModel';
import { COMPARISON_LABELS, type SpatialComparison } from './spatialAgent';
import type { ResearchArtifact } from './ResearchResults';
import { formatNumber } from './formatNumber';
import { SCENE_DEFINITIONS, numberText } from './sceneRuntime';

export const RESEARCH_METRIC_METHODS = {
  gaussianRadiusMm: '高斯半径由理想高斯光束传播公式与薄透镜变换计算，是 1/e² 光强半径，不是光线采样估计。',
  footprintRadiusMm: '几何覆盖半径来自有限条几何光线的落点范围，受光线数量和采样方式影响，不等于高斯光斑半径。',
  sampledPowerMw: '到屏功率是等权几何光线的功率合计，属于有限光线采样近似，不是精确高斯光强积分或实测功率。',
};

export function comparisonRange(c: SpatialComparison): string {
  const element = c.inputSnapshot.elements.find(e => e.id === c.elementId);
  return `${element?.name ?? '器件'} · ${COMPARISON_LABELS[c.field] ?? c.field}：${formatNumber(c.rows[0].value)} → ${formatNumber(c.rows.at(-1)!.value)} · ${c.rows.length} 点`;
}

export function snapshotConditions(input: SpatialExperiment, comparison?: SpatialComparison): string[] {
  const changed = (id: string, field: string) => comparison?.elementId === id && comparison.field === field ? '（比较前原值）' : '';
  const conditions = input.elements.filter(e => e.kind === 'laser' || e.kind === 'screen').map(e => {
    const positionChanged = comparison?.elementId === e.id && ['x', 'y', 'z'].includes(comparison.field);
    const pose = `位置 (${e.position.map(formatNumber).join(', ')}) mm${positionChanged ? '（比较前原值）' : ''}`;
    if (e.kind === 'screen') return `${e.name}：${pose}，口径 ${formatNumber(e.diameterMm)} mm${changed(e.id, 'diameterMm')}`;
    const radiusLabel = e.beamModel === 'gaussian' ? '束腰半径' : '输入半径';
    return `${e.name}：${e.beamModel === 'gaussian' ? '理想高斯光束' : '几何光束'}，波长 ${formatNumber(e.wavelengthNm)} nm${changed(e.id, 'wavelengthNm')}，${radiusLabel} ${formatNumber(e.beamRadiusMm)} mm${changed(e.id, 'beamRadiusMm')}，功率 ${formatNumber(e.powerMw)} mW${changed(e.id, 'powerMw')}，${e.rayCount} 条采样光线${changed(e.id, 'rayCount')}；${pose}`;
  });
  const sources = input.elements.filter(e => e.kind === 'laser'), screens = input.elements.filter(e => e.kind === 'screen');
  for (const lens of input.elements.filter(e => e.kind === 'lens')) conditions.push(`${lens.name}：位置 (${lens.position.map(formatNumber).join(', ')}) mm，焦距 ${formatNumber(lens.focalLengthMm)} mm${changed(lens.id, 'focalLengthMm')}`);
  if (sources.length === 1 && input.elements.every(e => e.kind === 'laser' || e.kind === 'screen') && (!comparison || !['x', 'y', 'z'].includes(comparison.field))) {
    for (const screen of screens) {
      const distance = Math.hypot(...screen.position.map((v, i) => v - sources[0].position[i]));
      conditions.push(`${sources[0].name}与${screen.name}的直线间距：${formatNumber(distance)} mm`);
    }
  }
  return conditions;
}

export function snapshotSummary(input: SpatialExperiment): string {
  const sources = input.elements.filter(e => e.kind === 'laser');
  const wavelengths = [...new Set(sources.map(e => formatNumber(e.wavelengthNm)))];
  const summary = wavelengths.length ? `波长 ${wavelengths.join('/')} nm` : '无光源';
  const screens = input.elements.filter(e => e.kind === 'screen');
  if (sources.length === 1 && screens.length === 1 && input.elements.length === 2) return summary + ` · 源屏间距 ${formatNumber(Math.hypot(...screens[0].position.map((v, i) => v - sources[0].position[i])))} mm`;
  return summary + ` · ${screens.length} 个观察屏`;
}

export function artifactSummary(a: ResearchArtifact): string {
  if(a.kind==='model')return a.data.evidence.status;
  if (a.kind === 'comparison') return comparisonRange(a.data);
  if (a.kind === 'design') return `屏位置 ${formatNumber(a.data.goal.screenPositionMm)} mm · ${a.data.counts.total} 个位置与焦距组合`;
  if (a.kind === 'study') return `位置偏差 ±${formatNumber(a.data.tolerance.positionErrorMm)} mm · 焦距偏差 ±${formatNumber(a.data.tolerance.focalErrorPercent)}%`;
  if (a.kind === 'objects') return a.data.map(r => r.inputSnapshot.name).join(' / ');
  return `${a.data.screens.length} 个观察屏的当前参数读数`;
}

export function artifactConditions(a: ResearchArtifact): string[] {
  if(a.kind==='model')return SCENE_DEFINITIONS[a.input.sceneId].parameters.map(p=>`${p.label}：${numberText(a.input.parameters[p.key])}${p.unit?' '+p.unit:''}`);
  if (a.kind === 'objects') return [];
  const goal = a.kind === 'design' ? a.data.goal : a.kind === 'study' ? a.data.goal : null;
  const input = goal ? { ...a.input, elements: a.input.elements.map(e => e.id === goal.screenId ? { ...e, position: [goal.screenPositionMm, e.position[1], e.position[2]] as [number, number, number] } : e) } : a.input;
  const lines = snapshotConditions(input, a.kind === 'comparison' ? a.data : undefined);
  if (goal) lines.push(`搜索条件：观察屏固定 X=${formatNumber(goal.screenPositionMm)} mm；透镜 X=${formatNumber(goal.positionRange.start)} → ${formatNumber(goal.positionRange.stop)} mm，焦距 ${formatNumber(goal.focalRange.start)} → ${formatNumber(goal.focalRange.stop)} mm。装置原值不代表所有搜索点。`);
  if (a.kind === 'study') lines.push(`误差条件：透镜位置 ±${formatNumber(a.data.tolerance.positionErrorMm)} mm，焦距 ±${formatNumber(a.data.tolerance.focalErrorPercent)}%。`);
  return lines;
}

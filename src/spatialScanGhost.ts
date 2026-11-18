import { parseSpatial, type SpatialElement, type SpatialExperiment, type Vec3 } from './builderModel';
import { resizeLens } from './lensPresets';
import { isPhysicalLens, physicalFocalLengths } from './physicalLensGeometry';
import { cleanElementDisplayName, formatCompact, formatReadoutWithUnit } from './researchUnits';
import { COMPARISON_LABELS, type SpatialComparison } from './spatialAgent';
import { add3, dot3, geometryFrame, mul3, sub3, unit3 } from './spatialGeometry';

export interface SpatialScanOverlay {
  comparison: SpatialComparison;
  activeValue: number | null;
  pinned?: boolean;
}

export interface GhostRaySegment {
  start: Vec3;
  end: Vec3;
  startRadiusMm: number;
  endRadiusMm: number;
  waistPos: Vec3 | null;
  waistRadiusMm: number | null;
  beamRadiiMm: number[];
}

export interface ScanGhostSample {
  rowIndex: number;
  value: number;
  element: SpatialElement;
  role: 'active' | 'best' | 'trail';
  isBest: boolean;
  overlapWithLive: boolean;
  spotRadiusMm: number | null;
  sampledPowerMw: number | null;
  paramText: string;
  metricText: string | null;
  badgeText: string;
  rayEnvelope: GhostRaySegment[];
}

export interface ScanGhostScene {
  elementId: string;
  elementName: string;
  field: string;
  fieldLabel: string;
  isSpatialMove: boolean;
  contextOptics: SpatialElement[];
  bestValue: number | null;
  bestMetricText: string | null;
  activeSample: ScanGhostSample | null;
  bestSample: ScanGhostSample | null;
  samples: ScanGhostSample[];
  trajectoryPoints: Vec3[];
}

const SPATIAL_MOVE_FIELDS = new Set(['x', 'y', 'z', 'yawDeg', 'pitchDeg', 'rollDeg']);
const DETECTOR_KINDS = new Set(['screen', 'power-meter', 'sensor', 'eye']);
const STOP_KINDS = new Set(['screen', 'power-meter', 'sensor', 'eye', 'slit', 'right-prism', 'dispersion-prism']);

const SHORT_FIELD_LABELS: Record<string, { name: string; unit: string }> = {
  x: { name: 'X', unit: 'mm' },
  y: { name: 'Y', unit: 'mm' },
  z: { name: 'Z', unit: 'mm' },
  yawDeg: { name: '水平角', unit: '°' },
  pitchDeg: { name: '俯仰角', unit: '°' },
  rollDeg: { name: '轴向角', unit: '°' },
  focalLengthMm: { name: '焦距 f', unit: 'mm' },
  beamRadiusMm: { name: '束腰 w₀', unit: 'mm' },
  wavelengthNm: { name: '波长 λ', unit: 'nm' },
  waistOffsetMm: { name: '束腰距', unit: 'mm' },
  diameterMm: { name: '口径', unit: 'mm' },
  powerMw: { name: '功率', unit: 'mW' },
  divergenceMrad: { name: '发散角', unit: 'mrad' },
  transmission: { name: '透过率', unit: '' },
};

function formatParamValue(field: string, value: number): string {
  const meta = SHORT_FIELD_LABELS[field];
  if (meta) {
    return `${meta.name} ${formatCompact(value, 4)}${meta.unit ? ` ${meta.unit}` : ''}`;
  }
  const full = COMPARISON_LABELS[field] ?? field;
  return `${full.replace(/（.*?）/g, '').trim()} ${formatCompact(value, 4)}`;
}

export function applyComparisonValue(
  snapshot: SpatialExperiment,
  elementId: string,
  field: string,
  value: number,
): SpatialExperiment {
  const candidate = structuredClone(snapshot);
  const target = candidate.elements.find(e => e.id === elementId);
  if (!target) return snapshot;

  if (field === 'x' || field === 'y' || field === 'z') {
    const axisIdx = field === 'x' ? 0 : field === 'y' ? 1 : 2;
    target.position[axisIdx] = value;
  } else {
    const patch = { [field]: value };
    Object.assign(target, isPhysicalLens(target.kind) ? resizeLens(target, patch) : patch);
  }

  try {
    return parseSpatial(candidate);
  } catch {
    return candidate;
  }
}

export function matchTableRowToComparison(
  cellTexts: readonly string[],
  comparisons: readonly SpatialComparison[],
): { comparison: SpatialComparison; rowValue: number; rowIndex: number } | null {
  if (!cellTexts.length || !comparisons.length) return null;
  const firstText = (cellTexts[0] ?? '').replace(/,/g, '').trim();
  const match = firstText.match(/^[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const num = Number(match[0]);
  if (!Number.isFinite(num)) return null;

  let best: {
    comparison: SpatialComparison;
    rowValue: number;
    rowIndex: number;
    score: number;
  } | null = null;

  for (const comparison of comparisons) {
    if (!comparison.rows.length) continue;
    const firstVal = comparison.rows[0].value;
    const lastVal = comparison.rows.at(-1)!.value;
    const span = Math.abs(lastVal - firstVal);
    const step = comparison.rows.length > 1 ? span / (comparison.rows.length - 1) : 1;

    for (let i = 0; i < comparison.rows.length; i++) {
      const row = comparison.rows[i];
      const diff = Math.abs(row.value - num);
      const maxTol = Math.max(0.25, Math.abs(row.value) * 0.005);
      const tol = comparison.rows.length > 1 ? Math.min(maxTol, step * 0.45 + 1e-6) : maxTol;
      if (diff <= tol) {
        const score = diff / Math.max(1e-6, tol);
        if (!best || score < best.score - 1e-9) {
          best = { comparison, rowValue: row.value, rowIndex: i, score };
        }
      }
    }
  }

  return best ? { comparison: best.comparison, rowValue: best.rowValue, rowIndex: best.rowIndex } : null;
}

interface QuickRayState {
  origin: Vec3;
  dir: Vec3;
  beamModel: 'gaussian' | 'parallel';
  wavelengthMm: number;
  qRe: number;
  qIm: number;
  radiusMm: number;
  divRad: number;
  depth: number;
}

function quickRadiusAt(ray: QuickRayState, dist: number): number {
  if (ray.beamModel === 'gaussian') {
    const qRe = ray.qRe + dist;
    const qIm = Math.max(ray.qIm, 1e-9);
    const w0Sq = (ray.wavelengthMm * qIm) / Math.PI;
    return Math.sqrt(Math.max(1e-10, w0Sq * (1 + (qRe / qIm) ** 2)));
  }
  return Math.max(0.01, ray.radiusMm + ray.divRad * dist);
}

function buildQuickRaySegment(ray: QuickRayState, end: Vec3, dist: number): GhostRaySegment {
  const steps = 16;
  const beamRadiiMm: number[] = [];
  for (let i = 0; i <= steps; i++) {
    beamRadiiMm.push(quickRadiusAt(ray, (dist * i) / steps));
  }
  let waistPos: Vec3 | null = null;
  let waistRadiusMm: number | null = null;
  if (ray.beamModel === 'gaussian') {
    const waistDist = -ray.qRe;
    if (waistDist > 1e-3 && waistDist < dist - 1e-3) {
      waistPos = add3(ray.origin, mul3(ray.dir, waistDist));
      waistRadiusMm = quickRadiusAt(ray, waistDist);
    }
  }
  return {
    start: ray.origin,
    end,
    startRadiusMm: beamRadiiMm[0],
    endRadiusMm: beamRadiiMm.at(-1)!,
    waistPos,
    waistRadiusMm,
    beamRadiiMm,
  };
}

export function traceQuickGaussianEnvelope(experiment: SpatialExperiment): GhostRaySegment[] {
  const segments: GhostRaySegment[] = [];
  const queue: QuickRayState[] = [];

  for (const el of experiment.elements) {
    if (el.kind !== 'laser' || el.powerMw <= 0) continue;
    const { n } = geometryFrame(el);
    const wavelengthMm = el.wavelengthNm * 1e-6;
    const zR = (Math.PI * el.beamRadiusMm * el.beamRadiusMm) / Math.max(wavelengthMm, 1e-9);
    queue.push({
      origin: el.position,
      dir: unit3(n),
      beamModel: el.beamModel,
      wavelengthMm,
      qRe: -el.waistOffsetMm,
      qIm: zR,
      radiusMm: el.beamRadiusMm,
      divRad: el.divergenceMrad * 1e-3,
      depth: 0,
    });
  }

  let maxX = 350;
  for (const el of experiment.elements) {
    maxX = Math.max(maxX, el.position[0] + 150);
  }

  while (queue.length > 0 && segments.length < 32) {
    const ray = queue.shift()!;
    if (ray.depth > 10) continue;

    let bestHit: { dist: number; point: Vec3; el: SpatialElement; normal: Vec3 } | null = null;
    for (const el of experiment.elements) {
      if (el.kind === 'laser' || el.kind === 'object') continue;
      const { n } = geometryFrame(el);
      const denom = dot3(ray.dir, n);
      if (Math.abs(denom) < 1e-6) continue;
      const t = dot3(sub3(el.position, ray.origin), n) / denom;
      if (t <= 1e-3 || t > 3000) continue;
      const point = add3(ray.origin, mul3(ray.dir, t));
      const offset = sub3(point, el.position);
      const radialSq = dot3(offset, offset);
      const halfSpan = (el.diameterMm || 40) * 0.55;
      if (radialSq > halfSpan * halfSpan) continue;
      if (!bestHit || t < bestHit.dist) {
        bestHit = { dist: t, point, el, normal: unit3(n) };
      }
    }

    if (!bestHit) {
      const farDist = Math.max(180, Math.min(550, maxX - ray.origin[0] + 160));
      const end = add3(ray.origin, mul3(ray.dir, farDist));
      segments.push(buildQuickRaySegment(ray, end, farDist));
      continue;
    }

    segments.push(buildQuickRaySegment(ray, bestHit.point, bestHit.dist));
    const hitEl = bestHit.el;
    if (STOP_KINDS.has(hitEl.kind)) continue;

    const qEndRe = ray.qRe + bestHit.dist;
    const qEndIm = ray.qIm;
    const endRadius = quickRadiusAt(ray, bestHit.dist);

    if (hitEl.kind === 'mirror') {
      const reflDir = unit3(sub3(ray.dir, mul3(bestHit.normal, 2 * dot3(ray.dir, bestHit.normal))));
      queue.push({ ...ray, origin: bestHit.point, dir: reflDir, qRe: qEndRe, radiusMm: endRadius, depth: ray.depth + 1 });
      continue;
    }

    if (hitEl.kind === 'splitter' || hitEl.kind === 'polarizing-splitter') {
      const reflDir = unit3(sub3(ray.dir, mul3(bestHit.normal, 2 * dot3(ray.dir, bestHit.normal))));
      queue.push({ ...ray, origin: bestHit.point, dir: ray.dir, qRe: qEndRe, radiusMm: endRadius, depth: ray.depth + 1 });
      queue.push({ ...ray, origin: bestHit.point, dir: reflDir, qRe: qEndRe, radiusMm: endRadius, depth: ray.depth + 1 });
      continue;
    }

    let focalMm: number | null = null;
    if (hitEl.kind === 'lens' || hitEl.kind === 'cylindrical-lens') {
      focalMm = hitEl.focalLengthMm;
    } else if (isPhysicalLens(hitEl.kind)) {
      focalMm = physicalFocalLengths(hitEl).effective;
    }

    if (focalMm !== null && Math.abs(focalMm) >= 1) {
      const offset = sub3(bestHit.point, hitEl.position);
      const axialComp = dot3(offset, bestHit.normal);
      const perp = sub3(offset, mul3(bestHit.normal, axialComp));
      const outDir = unit3(sub3(ray.dir, mul3(perp, 1 / focalMm)));

      let nextQRe = qEndRe;
      let nextQIm = qEndIm;
      if (ray.beamModel === 'gaussian') {
        const denom = qEndRe * qEndRe + qEndIm * qEndIm;
        if (denom > 1e-12) {
          const invRe = qEndRe / denom - 1 / focalMm;
          const invIm = -qEndIm / denom;
          const invDenom = invRe * invRe + invIm * invIm;
          if (invDenom > 1e-12) {
            nextQRe = invRe / invDenom;
            nextQIm = -invIm / invDenom;
          }
        }
      }
      queue.push({
        ...ray,
        origin: bestHit.point,
        dir: outDir,
        qRe: nextQRe,
        qIm: nextQIm,
        radiusMm: endRadius,
        divRad: ray.divRad - endRadius / focalMm,
        depth: ray.depth + 1,
      });
      continue;
    }

    queue.push({ ...ray, origin: bestHit.point, qRe: qEndRe, radiusMm: endRadius, depth: ray.depth + 1 });
  }

  return segments;
}

function elementsOverlap(a: SpatialElement, b?: SpatialElement): boolean {
  if (!b) return false;
  const dist = Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]);
  if (dist > 0.5) return false;
  return (
    Math.abs(a.yawDeg - b.yawDeg) < 0.25 &&
    Math.abs(a.pitchDeg - b.pitchDeg) < 0.25 &&
    Math.abs(a.rollDeg - b.rollDeg) < 0.25 &&
    Math.abs(a.focalLengthMm - b.focalLengthMm) < 0.25 &&
    Math.abs(a.diameterMm - b.diameterMm) < 0.25
  );
}

export function buildScanGhostScene(
  comparison: SpatialComparison,
  activeValue: number | null,
  liveExperiment?: SpatialExperiment,
  maxSamples = 9,
): ScanGhostScene | null {
  const rows = comparison.rows;
  if (!rows.length) return null;

  const baseEl = comparison.inputSnapshot.elements.find(e => e.id === comparison.elementId);
  if (!baseEl) return null;

  const screenIds = new Set<string>();
  for (const row of rows) {
    if (row.error) continue;
    for (const s of row.screens) screenIds.add(s.elementId);
  }
  const preferredScreenId =
    rows.flatMap(r => r.screens).find(s => s.gaussianRadiusMm !== null)?.elementId ??
    rows.flatMap(r => r.screens).find(s => s.footprintRadiusMm !== null)?.elementId ??
    [...screenIds][0] ??
    null;

  const readRadius = (rowIdx: number): number | null => {
    const row = rows[rowIdx];
    if (!row || row.error || !preferredScreenId) return null;
    const sc = row.screens.find(s => s.elementId === preferredScreenId);
    const r = sc?.gaussianRadiusMm ?? sc?.footprintRadiusMm ?? null;
    return typeof r === 'number' && Number.isFinite(r) ? r : null;
  };
  const readPower = (rowIdx: number): number | null => {
    const row = rows[rowIdx];
    if (!row || row.error || !preferredScreenId) return null;
    const sc = row.screens.find(s => s.elementId === preferredScreenId);
    const p = sc?.sampledPowerMw ?? null;
    return typeof p === 'number' && Number.isFinite(p) ? p : null;
  };

  let bestRowIndex: number | null = null;
  let bestRadius = Infinity;
  for (let i = 0; i < rows.length; i++) {
    const r = readRadius(i);
    if (r !== null && r < bestRadius) {
      bestRadius = r;
      bestRowIndex = i;
    }
  }
  if (bestRowIndex === null) {
    const powers = rows.map((_, i) => readPower(i)).filter((p): p is number => p !== null);
    if (powers.length >= 2 && Math.max(...powers) - Math.min(...powers) > 1e-6) {
      let bestPow = -Infinity;
      for (let i = 0; i < rows.length; i++) {
        const p = readPower(i);
        if (p !== null && p > bestPow) {
          bestPow = p;
          bestRowIndex = i;
        }
      }
    }
  }

  let activeRowIndex: number | null = null;
  if (activeValue !== null && Number.isFinite(activeValue)) {
    let bestDiff = Infinity;
    for (let i = 0; i < rows.length; i++) {
      const diff = Math.abs(rows[i].value - activeValue);
      if (diff < bestDiff) {
        bestDiff = diff;
        activeRowIndex = i;
      }
    }
    const tol = 1e-3 + Math.abs(activeValue) * 2e-3;
    if (bestDiff > tol) activeRowIndex = null;
  }

  const picked = new Set<number>();
  if (rows.length <= maxSamples) {
    for (let i = 0; i < rows.length; i++) picked.add(i);
  } else {
    picked.add(0);
    picked.add(rows.length - 1);
    if (bestRowIndex !== null) picked.add(bestRowIndex);
    if (activeRowIndex !== null) picked.add(activeRowIndex);
    const targetCount = Math.max(2, maxSamples);
    for (let k = 1; k < targetCount - 1 && picked.size < targetCount; k++) {
      const idx = Math.round((k * (rows.length - 1)) / (targetCount - 1));
      picked.add(idx);
    }
  }

  const sortedIndices = [...picked].sort((a, b) => a - b);
  const liveEl = liveExperiment?.elements.find(e => e.id === comparison.elementId);
  const isDetector = DETECTOR_KINDS.has(baseEl.kind);
  const contextOptics: SpatialElement[] = liveExperiment
    ? comparison.inputSnapshot.elements.filter(el => {
        if (el.id === comparison.elementId) return false;
        const liveMatch = liveExperiment.elements.find(e => e.id === el.id);
        return !elementsOverlap(el, liveMatch);
      })
    : [];
  const apparatusChanged = contextOptics.length > 0;

  const samples: ScanGhostSample[] = sortedIndices.map(rowIndex => {
    const row = rows[rowIndex];
    const role: ScanGhostSample['role'] =
      activeRowIndex === rowIndex ? 'active' : bestRowIndex === rowIndex ? 'best' : 'trail';
    const exp = applyComparisonValue(comparison.inputSnapshot, comparison.elementId, comparison.field, row.value);
    const element = exp.elements.find(e => e.id === comparison.elementId) ?? baseEl;
    const spotRadiusMm = readRadius(rowIndex);
    const sampledPowerMw = readPower(rowIndex);
    const paramText = formatParamValue(comparison.field, row.value);
    const metricText =
      spotRadiusMm !== null
        ? `光斑 ${formatReadoutWithUnit(spotRadiusMm, 'mm')}`
        : sampledPowerMw !== null
          ? `功率 ${formatReadoutWithUnit(sampledPowerMw, 'mW')}`
          : null;
    const isBest = bestRowIndex === rowIndex;
    const prefix = isBest ? '★ 最优 ' : '';
    const badgeText = metricText ? `${prefix}${paramText} · ${metricText}` : `${prefix}${paramText}`;
    const rayEnvelope = (!isDetector || apparatusChanged) && (role === 'active' || role === 'best') ? traceQuickGaussianEnvelope(exp) : [];

    return {
      rowIndex,
      value: row.value,
      element,
      role,
      isBest,
      overlapWithLive: elementsOverlap(element, liveEl),
      spotRadiusMm,
      sampledPowerMw,
      paramText,
      metricText,
      badgeText,
      rayEnvelope,
    };
  });

  const trajectoryPoints: Vec3[] =
    comparison.field === 'x' || comparison.field === 'y' || comparison.field === 'z'
      ? rows.map(row => {
          const exp = applyComparisonValue(comparison.inputSnapshot, comparison.elementId, comparison.field, row.value);
          return exp.elements.find(e => e.id === comparison.elementId)?.position ?? baseEl.position;
        })
      : [];

  const activeSample = samples.find(s => s.role === 'active') ?? null;
  const bestSample = samples.find(s => s.role === 'best') ?? null;
  const fieldLabel = COMPARISON_LABELS[comparison.field] ?? comparison.field;

  return {
    elementId: comparison.elementId,
    elementName: cleanElementDisplayName(baseEl.name),
    field: comparison.field,
    fieldLabel,
    isSpatialMove: SPATIAL_MOVE_FIELDS.has(comparison.field),
    contextOptics,
    bestValue: bestRowIndex !== null ? rows[bestRowIndex].value : null,
    bestMetricText: bestSample?.metricText ?? null,
    activeSample,
    bestSample,
    samples,
    trajectoryPoints,
  };
}

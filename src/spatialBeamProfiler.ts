import type { SpatialElement, SpatialExperiment, SpatialResult } from './builderModel';

export type ProfilerPalette = 'inferno' | 'wavelength';

export interface ProfilerDetectorCandidate {
  elementId: string;
  name: string;
  kind: 'screen' | 'power-meter' | 'sensor';
  hasSignal: boolean;
  powerMw: number;
}

export interface ProfilerFieldData {
  gridSize: number;
  matrix: Float32Array;
  uProfile: number[];
  vProfile: number[];
  extentMm: number;
  radiusMm: number | null;
  radiusUMm: number | null;
  radiusVMm: number | null;
  powerMw: number;
  wavelengthNm: number;
  stokes: { s1: number; s2: number; s3: number } | null;
  modeLabel: string;
}

const INFERNO_STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 4],
  [40, 11, 84],
  [101, 21, 110],
  [159, 42, 99],
  [212, 72, 66],
  [245, 125, 21],
  [250, 193, 39],
  [252, 255, 164],
];

export function infernoColor(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const scaled = clamped * (INFERNO_STOPS.length - 1);
  const idx = Math.min(INFERNO_STOPS.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const a = INFERNO_STOPS[idx];
  const b = INFERNO_STOPS[idx + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * frac),
    Math.round(a[1] + (b[1] - a[1]) * frac),
    Math.round(a[2] + (b[2] - a[2]) * frac),
  ];
}

export function wavelengthToRgb(wavelengthNm: number): [number, number, number] {
  const wl = Number.isFinite(wavelengthNm) ? wavelengthNm : 532;
  let r = 0;
  let g = 0;
  let b = 0;
  if (wl >= 380 && wl < 440) {
    r = -(wl - 440) / (440 - 380);
    b = 1;
  } else if (wl >= 440 && wl < 490) {
    g = (wl - 440) / (490 - 440);
    b = 1;
  } else if (wl >= 490 && wl < 510) {
    g = 1;
    b = -(wl - 510) / (510 - 490);
  } else if (wl >= 510 && wl < 580) {
    r = (wl - 510) / (580 - 510);
    g = 1;
  } else if (wl >= 580 && wl < 645) {
    r = 1;
    g = -(wl - 645) / (645 - 580);
  } else if (wl >= 645 && wl <= 780) {
    r = 1;
  } else if (wl < 380) {
    r = 0.65;
    b = 1;
  } else {
    r = 0.85;
  }

  let factor = 1;
  if (wl >= 380 && wl < 420) factor = 0.3 + 0.7 * ((wl - 380) / (420 - 380));
  else if (wl > 700 && wl <= 780) factor = 0.3 + 0.7 * ((780 - wl) / (780 - 700));
  else if (wl < 380 || wl > 780) factor = 0.35;

  return [
    Math.round(Math.pow(r * factor, 0.85) * 255),
    Math.round(Math.pow(g * factor, 0.85) * 255),
    Math.round(Math.pow(b * factor, 0.85) * 255),
  ];
}

export function wavelengthColorLut(t: number, wavelengthNm: number): [number, number, number] {
  const v = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const [wr, wg, wb] = wavelengthToRgb(wavelengthNm);
  if (v <= 0.75) {
    const s = v / 0.75;
    return [Math.round(wr * s), Math.round(wg * s), Math.round(wb * s)];
  }
  const whiteMix = (v - 0.75) / 0.25;
  return [
    Math.round(wr + (255 - wr) * whiteMix * 0.75),
    Math.round(wg + (255 - wg) * whiteMix * 0.75),
    Math.round(wb + (255 - wb) * whiteMix * 0.75),
  ];
}

function isDetectorKind(kind: SpatialElement['kind']): kind is ProfilerDetectorCandidate['kind'] {
  return kind === 'screen' || kind === 'power-meter' || kind === 'sensor';
}

export function listProfilerDetectors(
  experiment: SpatialExperiment,
  result: SpatialResult | null,
): ProfilerDetectorCandidate[] {
  const candidates: ProfilerDetectorCandidate[] = [];
  for (const el of experiment.elements) {
    if (!isDetectorKind(el.kind)) continue;
    const screen = result?.screens.find((s) => s.elementId === el.id);
    const powerMw = screen ? (screen.readingMw ?? screen.sampledPowerMw) : 0;
    const hasImaging = el.kind === 'sensor' && Boolean(result?.imaging);
    const hasDiffraction = Boolean(
      result?.diffraction?.some((d) => d.screenId === el.id)
      || (result?.fourF && result.fourF.screenId === el.id)
      || (result?.fourier && result.fourier.screenId === el.id),
    );
    const hasSignal = Boolean(
      (screen && (screen.hits > 0 || powerMw > 0 || screen.gaussianRadiusMm !== null))
      || hasImaging
      || hasDiffraction,
    );
    candidates.push({
      elementId: el.id,
      name: el.name,
      kind: el.kind,
      hasSignal,
      powerMw: Number.isFinite(powerMw) ? powerMw : 0,
    });
  }
  return candidates;
}

export function selectProfilerDetector(
  experiment: SpatialExperiment,
  result: SpatialResult | null,
  selectedId: string | null,
  preferredId?: string | null,
): ProfilerDetectorCandidate | null {
  const list = listProfilerDetectors(experiment, result);
  if (list.length === 0) return null;
  if (selectedId) {
    const selected = list.find((d) => d.elementId === selectedId);
    if (selected) return selected;
  }
  if (preferredId) {
    const preferred = list.find((d) => d.elementId === preferredId);
    if (preferred) return preferred;
  }
  return list.find((d) => d.hasSignal) ?? list[0];
}

export function describeStokesState(stokes: { s1: number; s2: number; s3: number }) {
  const { s1, s2, s3 } = stokes;
  const dop = Math.min(1, Math.hypot(s1, s2, s3));
  const angleRad = 0.5 * Math.atan2(s2, s1);
  const ellipticity = Math.abs(s3) / Math.max(dop, 1e-6);
  let label = '未偏振';
  if (dop < 0.1) label = '未偏振';
  else if (ellipticity > 0.85) label = s3 >= 0 ? '右旋圆偏振' : '左旋圆偏振';
  else if (ellipticity < 0.15) label = '线偏振';
  else label = '椭圆偏振';
  return { label, angleRad, ellipticity, dop };
}

export type ProfilerZoomMode = 'auto' | 'full';

export function sampleDetectorField(
  candidate: ProfilerDetectorCandidate,
  experiment: SpatialExperiment,
  result: SpatialResult | null,
  gridSize = 48,
  zoomMode: ProfilerZoomMode = 'auto',
): ProfilerFieldData {
  const n = Math.max(16, Math.min(96, Math.round(gridSize)));
  const matrix = new Float32Array(n * n);
  const uProfile = new Array<number>(n).fill(0);
  const vProfile = new Array<number>(n).fill(0);

  const element = experiment.elements.find((e) => e.id === candidate.elementId);
  const primarySource = experiment.elements.find((e) => e.kind === 'laser');
  const wavelengthNm = primarySource?.wavelengthNm ?? 532;
  const screen = result?.screens.find((s) => s.elementId === candidate.elementId);

  const waveData =
    (result?.fourF && result.fourF.screenId === candidate.elementId ? result.fourF : null)
    ?? (result?.fourier && result.fourier.screenId === candidate.elementId ? result.fourier : null)
    ?? result?.diffraction?.find((d) => d.screenId === candidate.elementId)
    ?? null;

  if (waveData && waveData.points.length >= 2) {
    const extentMm = Math.max(1, Math.abs(waveData.points[waveData.points.length - 1].xMm));
    const maxI = Math.max(1e-9, ...waveData.points.map((p) => p.intensity));
    for (let row = 0; row < n; row++) {
      const vNorm = (row / (n - 1)) * 2 - 1;
      const vEnv = Math.exp(-vNorm * vNorm * 2.2);
      for (let col = 0; col < n; col++) {
        const uMm = ((col / (n - 1)) * 2 - 1) * extentMm;
        // Linearly interpolate 1D wave intensity
        let val = 0;
        for (let k = 0; k < waveData.points.length - 1; k++) {
          const p0 = waveData.points[k];
          const p1 = waveData.points[k + 1];
          if ((uMm >= p0.xMm && uMm <= p1.xMm) || (uMm <= p0.xMm && uMm >= p1.xMm)) {
            const span = p1.xMm - p0.xMm;
            const t = Math.abs(span) > 1e-9 ? (uMm - p0.xMm) / span : 0;
            val = (p0.intensity + (p1.intensity - p0.intensity) * t) / maxI;
            break;
          }
        }
        const intensity = Math.max(0, Math.min(1, val * vEnv));
        matrix[row * n + col] = intensity;
      }
    }
    const mid = Math.floor(n / 2);
    for (let i = 0; i < n; i++) {
      uProfile[i] = matrix[mid * n + i];
      vProfile[i] = matrix[i * n + mid];
    }
    return {
      gridSize: n,
      matrix,
      uProfile,
      vProfile,
      extentMm,
      radiusMm: screen?.gaussianRadiusMm ?? screen?.footprintRadiusMm ?? null,
      radiusUMm: screen?.sampledRadiusUMm ?? null,
      radiusVMm: screen?.sampledRadiusVMm ?? null,
      powerMw: candidate.powerMw,
      wavelengthNm,
      stokes: screen?.polarizationStokes ?? null,
      modeLabel: result?.fourF ? '4F 频谱/像面' : result?.fourier ? '傅里叶频谱' : '衍射条纹',
    };
  }

  const defaultExtent = Math.max(5, Math.min(50, (element?.diameterMm ?? 30) * 0.45));
  if (!screen || (!candidate.hasSignal && !result?.imaging)) {
    return {
      gridSize: n,
      matrix,
      uProfile,
      vProfile,
      extentMm: defaultExtent,
      radiusMm: null,
      radiusUMm: null,
      radiusVMm: null,
      powerMw: 0,
      wavelengthNm,
      stokes: null,
      modeLabel: '无有效光斑',
    };
  }

  const rx = screen.sampledRadiusUMm ?? screen.gaussianRadiusMm ?? screen.footprintRadiusMm ?? 2.0;
  const ry = screen.sampledRadiusVMm ?? screen.gaussianRadiusMm ?? screen.footprintRadiusMm ?? 2.0;
  const safeRx = Math.max(0.05, rx);
  const safeRy = Math.max(0.05, ry);
  const screenRadius = Math.max(0.5, (element?.diameterMm ?? 30) / 2);
  const spotRadius = Math.max(safeRx, safeRy);
  const extentMm = zoomMode === 'full'
    ? screenRadius
    : Math.min(screenRadius, Math.max(spotRadius * 4.5, 0.25));
  const isGaussian = screen.gaussianRadiusMm !== null || screen.sampledRadiusUMm !== undefined;

  for (let row = 0; row < n; row++) {
    const y = ((row / (n - 1)) * 2 - 1) * extentMm;
    for (let col = 0; col < n; col++) {
      const x = ((col / (n - 1)) * 2 - 1) * extentMm;
      const r2 = (x * x) / (safeRx * safeRx) + (y * y) / (safeRy * safeRy);
      const val = isGaussian
        ? Math.exp(-2 * r2)
        : r2 <= 1
          ? Math.max(0.25, 1 - 0.55 * r2)
          : Math.exp(-6 * (r2 - 1));
      matrix[row * n + col] = Math.max(0, Math.min(1, val));
    }
  }

  const mid = Math.floor(n / 2);
  for (let i = 0; i < n; i++) {
    uProfile[i] = matrix[mid * n + i];
    vProfile[i] = matrix[i * n + mid];
  }

  return {
    gridSize: n,
    matrix,
    uProfile,
    vProfile,
    extentMm,
    radiusMm: screen.gaussianRadiusMm ?? screen.footprintRadiusMm ?? Math.max(safeRx, safeRy),
    radiusUMm: screen.sampledRadiusUMm ?? null,
    radiusVMm: screen.sampledRadiusVMm ?? null,
    powerMw: candidate.powerMw,
    wavelengthNm,
    stokes: screen.polarizationStokes ?? null,
    modeLabel: isGaussian ? '高斯光斑' : '几何光斑',
  };
}

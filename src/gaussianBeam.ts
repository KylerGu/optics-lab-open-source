import { makeElement, parseExperiment, type Experiment, type Laser, type Screen } from './model';

export const GAUSSIAN_DRAFT_KEY = 'optics-lab-gaussian-scene-v1';

export function gaussianElements(experiment: Experiment): { laser: Laser; screen: Screen } {
  const valid = parseExperiment(experiment);
  const laser = valid.elements.find((item): item is Laser => item.kind === 'laser');
  const screen = valid.elements.find((item): item is Screen => item.kind === 'screen');
  if (!laser || !screen || valid.elements.length !== 2 || screen.positionMm <= laser.positionMm) {
    throw new Error('这个场景只包含一个光源和一个观察屏，观察屏需要在光源右侧。透镜组合请在光路搭建中打开。');
  }
  return { laser, screen };
}

export function makeGaussianScene(): Experiment {
  return {
    schemaVersion: 1, name: '高斯光束 · 自由传播', railLengthMm: 600,
    elements: [{ ...makeElement('laser', 30), waistMm: 0.2 } as Laser, makeElement('screen', 350)],
  };
}

// Exact free-space solution of the same M²=1 model used by backend/optics.py.
// Evaluate locally during gestures so there is no network/debounce delay.
export function gaussianBeam(laser: Laser, screen: Screen) {
  const wavelengthMm = laser.wavelengthNm * 1e-6;
  const rayleighMm = Math.PI * laser.waistMm ** 2 / wavelengthMm;
  const radiusAt = (positionMm: number) => laser.waistMm * Math.hypot(1, (positionMm - laser.positionMm) / rayleighMm);
  const screenRadiusMm = radiusAt(screen.positionMm);
  const distanceMm = screen.positionMm - laser.positionMm;
  const wavefrontRadiusAt = (positionMm: number) => {
    const distance = positionMm - laser.positionMm;
    return distance === 0 ? Infinity : distance + rayleighMm ** 2 / distance;
  };
  return {
    rayleighMm, radiusAt, screenRadiusMm,
    distanceMm, wavefrontRadiusAt,
    screenWavefrontRadiusMm: wavefrontRadiusAt(screen.positionMm),
    region: distanceMm <= rayleighMm ? 'near' as const : distanceMm < 3 * rayleighMm ? 'transition' as const : 'far' as const,
    divergenceMrad: wavelengthMm / (Math.PI * laser.waistMm) * 1000,
    relativeIntensityAt: (offsetMm: number) => Math.exp(-2 * (offsetMm / screenRadiusMm) ** 2),
    peakRelativeToWaist: (laser.waistMm / screenRadiusMm) ** 2,
  };
}

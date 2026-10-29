// Executes the actual browser-side numerical functions, without a browser mock.
import fs from 'node:fs';
import { gaussianBeam } from '../src/gaussianBeam';
import { gaussianFocus, parseFocus } from '../src/gaussianFocus';
const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const results = cases.map((c: any) => {
  if (c.kind === 'focus') {
    const v = gaussianFocus(parseFocus(c.parameters));
    return { id: c.id, metrics: Object.fromEntries(['observationRadiusMm', 'outputWaistMm', 'outputWaistPositionMm', 'outputRayleighMm', 'lensRadiusMm', 'minimumForwardMm'].map(k => [k, (v as any)[k]])), warning: !v.paraxial };
  }
  const [laser, screen] = c.experiment.elements;
  const v = gaussianBeam(laser, screen);
  return { id: c.id, metrics: { radiusMm: v.screenRadiusMm, rayleighMm: v.rayleighMm, divergenceMrad: v.divergenceMrad, wavefrontRadiusMm: v.screenWavefrontRadiusMm, peakRelativeToWaist: v.peakRelativeToWaist } };
});
fs.writeFileSync(process.argv[3], JSON.stringify(results, null, 2));

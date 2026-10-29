import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { DEFAULT_FOCUS, focusBuilderCopy, focusHistory, gaussianFocus, parseFocus, type FocusParameters } from './gaussianFocus';
import { fromLegacy } from './builderModel';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < Math.max(1, Math.abs(b)) * 1e-10, `${a} ≠ ${b}`);
const cases: FocusParameters[] = [DEFAULT_FOCUS,
  { ...DEFAULT_FOCUS, waistMm: .05, focalLengthMm: 400 }, // virtual output waist
  { ...DEFAULT_FOCUS, waistPositionMm: 400 }, // incident beam still converging at lens
  { ...DEFAULT_FOCUS, waistMm: .2, waistPositionMm: -2000, focalLengthMm: 2225 }, // nearly parallel
  { ...DEFAULT_FOCUS, waistMm: .01, waistPositionMm: 99, lensPositionMm: 200, focalLengthMm: 100 }, // far outside viewport
  { ...DEFAULT_FOCUS, waistMm: .01, focalLengthMm: 10, wavelengthNm: 1100 },
  { ...DEFAULT_FOCUS, waistMm: 5, focalLengthMm: 5000, wavelengthNm: 380, observationMm: 2000 },
  { ...DEFAULT_FOCUS, waistPositionMm: -2000, observationMm: 100 }, // observation before lens
];

test('thin-lens results match independent Python complex arithmetic and existing radius implementation', () => {
  const code = `import json, sys, math
from backend.optics import beam_radius
from backend.scene_physics import calculate
out=[]
for p in json.loads(sys.argv[1]):
 lam=p['wavelengthNm']*1e-6
 zr=math.pi*p['waistMm']**2/lam
 q=complex(p['lensPositionMm']-p['waistPositionMm'],zr)
 transformed=1/(1/q-1/p['focalLengthMm'])
 observation=(complex(p['observationMm']-p['waistPositionMm'],zr) if p['observationMm']<p['lensPositionMm'] else transformed+p['observationMm']-p['lensPositionMm'])
 values=[p['lensPositionMm']-transformed.real,math.sqrt(lam*transformed.imag/math.pi),beam_radius(observation,lam),transformed.imag]
 assistant=calculate(dict(version=1,sceneId='gaussian-focus',parameters=p))
 metrics={m['key']:m['value'] for m in assistant['metrics']}
 for actual,expected in zip([metrics[k] for k in ['outputWaistPositionMm','outputWaistMm','observationRadiusMm','outputRayleighMm']],values):
  assert math.isclose(actual,expected,rel_tol=1e-10,abs_tol=1e-10)
 out.append(values)
print(json.dumps(out))`;
  const independent = JSON.parse(execFileSync('python', ['-c', code, JSON.stringify(cases)], { encoding: 'utf8' })) as number[][];
  cases.forEach((p, i) => {
    const b = gaussianFocus(p);
    [b.outputWaistPositionMm, b.outputWaistMm, b.observationRadiusMm, b.outputRayleighMm].forEach((v, j) => close(v, independent[i][j]));
    close(b.input.radiusAt(p.lensPositionMm), b.output.radiusAt(p.lensPositionMm));
    close(b.output.radiusAt(b.outputWaistPositionMm), b.outputWaistMm);
    close(b.output.radiusAt(b.outputWaistPositionMm + b.outputRayleighMm), Math.SQRT2 * b.outputWaistMm);
  });
});

test('actual Gaussian waist differs from geometrical focal plane, virtual minimum stays at lens', () => {
  const b = gaussianFocus({ ...DEFAULT_FOCUS, waistMm: .1, lensPositionMm: 50 });
  assert.ok(Math.abs(b.waistDistanceMm - 100) > 20);
  const virtual = gaussianFocus(cases[1]);
  assert.equal(virtual.virtual, true);
  close(virtual.minimumForwardMm, virtual.lensRadiusMm);
  assert.ok(virtual.output.radiusAt(201) > virtual.minimumForwardMm);
  assert.equal(gaussianFocus(cases[3]).nearlyParallel, true);
  assert.ok(gaussianFocus(cases[4]).outputWaistPositionMm > 5000);
});

test('translation changes positions without changing sizes; upstream observer uses input beam', () => {
  const b = gaussianFocus(DEFAULT_FOCUS), delta = 100;
  const moved = gaussianFocus({ ...DEFAULT_FOCUS, lensPositionMm: DEFAULT_FOCUS.lensPositionMm + delta, waistPositionMm: DEFAULT_FOCUS.waistPositionMm + delta, observationMm: DEFAULT_FOCUS.observationMm + delta });
  close(moved.outputWaistPositionMm, b.outputWaistPositionMm + delta);
  close(moved.outputWaistMm, b.outputWaistMm); close(moved.observationRadiusMm, b.observationRadiusMm);
  const upstream = gaussianFocus({ ...DEFAULT_FOCUS, observationMm: 100 });
  close(upstream.observationRadiusMm, upstream.input.radiusAt(100));
  assert.equal(upstream.observationBeforeLens, true);
});

test('builder copy retains exact Gaussian input, lens and observation; unsupported cases stay unavailable', () => {
  const copy = focusBuilderCopy(DEFAULT_FOCUS).experiment!;
  const spatial = fromLegacy(copy);
  const source = spatial.elements.find(e => e.kind === 'laser')!, lens = spatial.elements.find(e => e.kind === 'lens')!, screen = spatial.elements.find(e => e.kind === 'screen')!;
  assert.equal(source.beamModel, 'gaussian'); close(source.beamRadiusMm, DEFAULT_FOCUS.waistMm);
  close(source.wavelengthNm, DEFAULT_FOCUS.wavelengthNm); close(source.position[0], DEFAULT_FOCUS.waistPositionMm);
  close(lens.position[0], DEFAULT_FOCUS.lensPositionMm); close(lens.focalLengthMm, DEFAULT_FOCUS.focalLengthMm);
  close(screen.position[0], DEFAULT_FOCUS.observationMm);
  const python = `import json,sys
from backend.spatial import SpatialExperiment,trace
p=SpatialExperiment.model_validate(json.loads(sys.argv[1]))
print(trace(p)['screens'][0]['gaussianRadiusMm'])`;
  close(Number(execFileSync('python', ['-c', python, JSON.stringify(spatial)], { encoding: 'utf8' })), gaussianFocus(DEFAULT_FOCUS).observationRadiusMm);
  for (const patch of [{ waistPositionMm: -1 }, { waistPositionMm: 300 }, { observationMm: 700 }, { observationMm: 100 }, { waistMm: .01, waistPositionMm: -2000 }]) assert.equal(focusBuilderCopy({ ...DEFAULT_FOCUS, ...patch }).experiment, null);
});

test('parameter history records one finished gesture and round-trips undo and redo', () => {
  const initial = { past: [], present: DEFAULT_FOCUS, future: [] };
  const next = { ...DEFAULT_FOCUS, lensPositionMm: 234.5 };
  const committed = focusHistory(initial, { type: 'commit', parameters: next });
  const undone = focusHistory(committed, { type: 'undo' });
  assert.deepEqual(undone.present, DEFAULT_FOCUS);
  assert.deepEqual(focusHistory(undone, { type: 'redo' }).present, next);
  assert.throws(() => parseFocus({ ...DEFAULT_FOCUS, waistMm: 0 }));
  assert.throws(() => parseFocus({ ...DEFAULT_FOCUS, focalLengthMm: NaN }));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { DEFAULT_GAIN as base, GAIN_FIELDS, laserGain, gainTarget, parseGain, gainHistory, type LaserGainParameters } from './laserGain';
import { defaultScene, SCENE_DEFINITIONS, parseScene, ACCEPTED_SCENES } from './sceneRuntime';
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) <= Math.max(1, Math.abs(b)) * 1e-9, `${a} != ${b}`);
const cases: LaserGainParameters[] = [base, { ...base, smallSignalGain: 0 }, { ...base, smallSignalGain: .3 }, { ...base, smallSignalGain: gainTarget(base)! }, { ...base, lengthMm: 1000, smallSignalGain: 50, lossPerM: 0 }, { ...base, lengthMm: 10, firstReflectivityPct: 1, secondReflectivityPct: 1, lossPerM: 10 }, { ...base, firstReflectivityPct: 100, secondReflectivityPct: 100 }, { ...base, firstReflectivityPct: 100, secondReflectivityPct: 100, lossPerM: 0 }, { ...base, firstReflectivityPct: 100, secondReflectivityPct: 100, lossPerM: 0, smallSignalGain: 0 }, { ...base, probeIntensity: 20 }, { ...base, secondReflectivityPct: 80 }, { ...base, secondReflectivityPct: 99.999999999, firstReflectivityPct: 100, lossPerM: 0 }];
test('threshold independently balances two gain passes, internal attenuation and both reflectors', () => {
  for (const p of cases) {
    const b = laserGain(p), L = p.lengthMm / 1000;
    const pass = Math.exp((p.smallSignalGain - p.lossPerM) * L);
    const Q = p.firstReflectivityPct / 100 * pass * p.secondReflectivityPct / 100 * pass;
    close(b.roundTrip, Q);
    const thresholdPass = Math.exp((b.thresholdGain - p.lossPerM) * L);
    close(thresholdPass ** 2 * p.firstReflectivityPct / 100 * p.secondReflectivityPct / 100, 1);
    if (b.above && !b.lossless) {
      const saturatedGain = b.gainAt(b.steadyIntensity!);
      close(saturatedGain, b.thresholdGain);
      close((p.firstReflectivityPct / 100) * (p.secondReflectivityPct / 100) * Math.exp(2 * (saturatedGain - p.lossPerM) * L), 1);
      close(b.outputIntensity!, (1 - p.secondReflectivityPct / 100) * b.steadyIntensity!);
    }
  }
});
test('known values, gain clamping, saturation halves at unity, boundary and closed-cavity behavior', () => {
  const b = laserGain(base);
  close(b.thresholdGain, .2 + Math.log(1 / .891) / .2);
  close(b.roundTrip, .891 * Math.exp(.36)); close(b.gainAt(1), 1);
  assert.equal(b.status, '阈值以上'); close(b.steadyGain!, b.thresholdGain);
  const below = laserGain({ ...base, smallSignalGain: .3 }); assert.equal(below.status, '阈值以下'); assert.equal(below.steadyIntensity, 0); close(below.steadyGain!, .3);
  const at = laserGain({ ...base, smallSignalGain: gainTarget(base)! }); assert.equal(at.status, '达到阈值'); assert.equal(at.outputIntensity, 0); close(at.roundTrip, 1);
  const more = laserGain({ ...base, smallSignalGain: 3 }); close(more.steadyGain!, b.steadyGain!); assert.ok(more.outputIntensity! > b.outputIntensity!);
  const closed = laserGain({ ...base, secondReflectivityPct: 100 }); assert.ok(closed.steadyIntensity! > 0); assert.equal(closed.outputIntensity, 0);
  for (const p of cases.slice(7, 9)) { const r = laserGain(p); assert.equal(r.steadyIntensity, null); assert.equal(r.outputIntensity, null); assert.equal(r.outputAt(20), null); assert.equal(gainTarget(p), null); }
  assert.equal(gainTarget(cases[5]), null);
});
test('loss and mirror reflectivity affect threshold monotonically; output coupling has a tradeoff', () => {
  const threshold = laserGain(base).thresholdGain;
  assert.ok(laserGain({ ...base, lossPerM: .3 }).thresholdGain > threshold);
  assert.ok(laserGain({ ...base, secondReflectivityPct: 80 }).thresholdGain > threshold);
  assert.ok(laserGain({ ...base, lengthMm: 200 }).thresholdGain < threshold);
  assert.equal(laserGain({ ...base, probeIntensity: 10 }).outputIntensity, laserGain(base).outputIntensity);
  assert.ok(laserGain({ ...base, secondReflectivityPct: 10 }).outputIntensity! < laserGain(base).outputIntensity!);
});
test('front-end calculations and solver agree with independent backend intensity propagation', () => {
  const python = `import json,sys\nfrom backend.scene_physics import calculate\nfrom backend.scene_laser_gain import target_gain\nout=[]\nfor p in json.loads(sys.argv[1]):\n r=calculate(dict(version=1,sceneId='laser-gain-0',parameters=p))\n try: target=target_gain(p,True)\n except ValueError: target=None\n out.append(dict(status=r['status'],metrics={m['key']:m['value'] for m in r['metrics']},target=target))\nprint(json.dumps(out,allow_nan=False))`;
  const results = JSON.parse(execFileSync('python', ['-c', python, JSON.stringify(cases)], { encoding: 'utf8' }));
  cases.forEach((p, i) => { const b = laserGain(p), r = results[i]; assert.equal(b.status, r.status); assert.equal(gainTarget(p, true), r.target);
    for (const key of ['thresholdGain', 'roundTrip', 'steadyIntensity', 'outputIntensity', 'steadyGain', 'probeGain', 'mirrorLoss', 'internalLoss'] as const) { if (b[key] === null) assert.equal(r.metrics[key], null); else close(b[key]!, r.metrics[key]); }
    close(b.margin, r.metrics.gainMargin);
  });
});
test('parameter validation, shared definitions, state isolation and atomic undo/redo', () => {
  assert.ok(ACCEPTED_SCENES.has('laser-gain-0')); assert.deepEqual(defaultScene('laser-gain-0').parameters, base);
  for (const f of GAIN_FIELDS) { const d = SCENE_DEFINITIONS['laser-gain-0'].parameters.find(p => p.key === f.key)!; assert.deepEqual([d.min, d.max, d.step, d.default], [f.min, f.max, f.step, base[f.key]]); }
  for (const patch of [{ firstReflectivityPct: 0 }, { secondReflectivityPct: 101 }, { lengthMm: NaN }, { smallSignalGain: -1 }, { probeIntensity: 21 }]) { assert.throws(() => parseGain({ ...base, ...patch })); assert.throws(() => parseScene({ version: 1, sceneId: 'laser-gain-0', parameters: { ...base, ...patch } })); }
  const h = gainHistory({ past: [], present: base, future: [] }, { type: 'commit', parameters: { ...base, smallSignalGain: 3 } });
  const undo = gainHistory(h, { type: 'undo' }); assert.deepEqual(undo.present, base); assert.deepEqual(gainHistory(undo, { type: 'redo' }), h);
  assert.notDeepEqual(defaultScene('resonators-0').parameters, base);
});

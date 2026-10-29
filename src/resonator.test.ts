import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { DEFAULT_RESONATOR as base, RESONATOR_FIELDS, resonator, stableLength, parseResonator, resonatorHistory, type ResonatorParameters } from './resonator';
import { defaultScene, parseScene, SCENE_DEFINITIONS, ACCEPTED_SCENES } from './sceneRuntime';
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) <= Math.max(1, Math.abs(b)) * 1e-9, `${a} != ${b}`);
const cases: ResonatorParameters[] = [base, { ...base, firstKind: 0 }, { ...base, secondKind: 0 }, { ...base, lengthMm: 500 }, { ...base, lengthMm: 1000 }, { ...base, lengthMm: 1200 }, { ...base, firstRadiusMm: 400, lengthMm: 450 }, { ...base, firstKind: -1, secondRadiusMm: 100, lengthMm: 50 }, { ...base, secondKind: -1, firstRadiusMm: 100, lengthMm: 50 }, { ...base, firstKind: 0, secondKind: 0 }, { ...base, firstKind: -1, secondKind: -1 }, { ...base, observationMm: 1000 }, { ...base, wavelengthNm: 1100, lengthMm: 10, firstRadiusMm: 5000, secondRadiusMm: 20 }];
test('Gaussian mode matches an independent round-trip ray matrix and both mirror curvatures', () => {
  for (const p of cases) {
    const b = resonator(p), m = b.mode;
    const multiply = (a: number[], c: number[]) => [a[0] * c[0] + a[1] * c[2], a[0] * c[1] + a[1] * c[3], a[2] * c[0] + a[3] * c[2], a[2] * c[1] + a[3] * c[3]];
    const P = [1, p.lengthMm, 0, 1], K1 = [1, 0, -2 * p.firstKind / p.firstRadiusMm, 1], K2 = [1, 0, -2 * p.secondKind / p.secondRadiusMm, 1];
    const [A, B, C, D] = multiply(K1, multiply(P, multiply(K2, P)));
    close(A * D - B * C, 1); close((A + D) / 2, 2 * b.product - 1);
    if (!m) continue;
    const qr = -m.waistPositionMm, qi = m.rayleighMm, dr = C * qr + D, di = C * qi, nr = A * qr + B, ni = A * qi;
    close((nr * dr + ni * di) / (dr * dr + di * di), qr);
    close((ni * dr - nr * di) / (dr * dr + di * di), qi);
    close(qr / (qr * qr + qi * qi), -p.firstKind / p.firstRadiusMm);
    const q2r = qr + p.lengthMm;
    close(q2r / (q2r * q2r + qi * qi), p.secondKind / p.secondRadiusMm);
  }
});
test('known symmetric and plane-concave solutions, boundary states and physical observer domain', () => {
  const m = resonator(base).mode!; close(m.waistPositionMm, 150); close(m.rayleighMm, Math.sqrt(150 * 350));
  close(m.waistMm ** 2, 532e-6 * Math.sqrt(150 * 350) / Math.PI);
  const plane = resonator({ ...base, firstKind: 0 }).mode!; close(plane.waistPositionMm, 0); close(plane.rayleighMm, Math.sqrt(300 * 200));
  const confocal = resonator({ ...base, lengthMm: 500 }); assert.equal(confocal.status, '共焦（简并）'); close(confocal.mode!.waistMm ** 2, 532e-6 * 500 / (2 * Math.PI));
  for (const p of [{ ...base, lengthMm: 1000 }, { ...base, firstKind: 0, lengthMm: 500 }, { ...base, firstKind: 0, secondKind: 0 }]) { const b = resonator(p); assert.equal(b.status, '临界'); assert.equal(b.mode, null); assert.equal(b.observationRadiusMm, null); }
  assert.equal(resonator({ ...base, lengthMm: 1200 }).status, '不稳定');
  assert.equal(resonator({ ...base, observationMm: 301 }).observationRadiusMm, null);
  close(resonator({ ...base, observationMm: 300 }).observationRadiusMm!, m.secondSpotMm);
  assert.equal(resonator(cases[7]).mode!.waistInside, false);
  assert.equal(resonator({ ...base, lengthMm: 499.999 }).stable, true);
  assert.equal(resonator({ ...base, lengthMm: 500.001 }).stable, true);
});
test('stable distance solver uses valid interval interiors for signed and plane mirrors', () => {
  for (const p of cases) {
    const lengthMm = stableLength(p);
    if (lengthMm !== null) { assert.ok(lengthMm >= 10 && lengthMm <= 2000); assert.equal(resonator({ ...p, lengthMm }).stable, true); }
  }
  assert.equal(stableLength({ ...base, lengthMm: 1200 }), 750);
  assert.equal(stableLength({ ...base, firstKind: -1, secondKind: -1 }), null);
  assert.equal(stableLength({ ...base, firstKind: 0, secondKind: 0 }), null);
});
test('front end and assistant agree across stable, unstable, confocal and external-waist cases', () => {
  const python = `import json,sys\nfrom backend.scene_physics import calculate\nfrom backend.scene_resonator import stable_length\nout=[]\nfor p in json.loads(sys.argv[1]):\n r=calculate(dict(version=1,sceneId='resonators-0',parameters=p))\n try: length=stable_length(p)\n except ValueError: length=None\n out.append(dict(status=r['status'],metrics={m['key']:m['value'] for m in r['metrics']},length=length))\nprint(json.dumps(out,allow_nan=False))`;
  const out = JSON.parse(execFileSync('python', ['-c', python, JSON.stringify(cases)], { encoding: 'utf8' }));
  cases.forEach((p, i) => { const b = resonator(p), r = out[i]; assert.equal(b.status, r.status); close(b.g1, r.metrics.g1); close(b.g2, r.metrics.g2); close(b.product, r.metrics.stabilityProduct); assert.equal(stableLength(p), r.length);
    for (const key of ['waistMm', 'waistPositionMm', 'rayleighMm', 'firstSpotMm', 'secondSpotMm'] as const) { if (b.mode) close(b.mode[key], r.metrics[key]); else assert.equal(r.metrics[key], null); }
    if (b.observationRadiusMm === null) assert.equal(r.metrics.observationRadiusMm, null); else close(b.observationRadiusMm, r.metrics.observationRadiusMm);
  });
});
test('scene constraints and undo/redo preserve complete independent state', () => {
  assert.ok(ACCEPTED_SCENES.has('resonators-0')); assert.deepEqual(defaultScene('resonators-0').parameters, base);
  for (const f of RESONATOR_FIELDS) { const d = SCENE_DEFINITIONS['resonators-0'].parameters.find(v => v.key === f.key)!; assert.deepEqual([d.min, d.max, d.step, d.default], [f.min, f.max, f.step, base[f.key]]); }
  assert.throws(() => parseResonator({ ...base, firstKind: .5 })); assert.throws(() => parseResonator({ ...base, lengthMm: Infinity }));
  assert.throws(() => parseScene({ version: 1, sceneId: 'resonators-0', parameters: { ...base, secondKind: .5 } }));
  const committed = resonatorHistory({ past: [], present: base, future: [] }, { type: 'commit', parameters: { ...base, lengthMm: 700 } });
  const undo = resonatorHistory(committed, { type: 'undo' }); assert.deepEqual(undo.present, base); assert.deepEqual(resonatorHistory(undo, { type: 'redo' }), committed);
});

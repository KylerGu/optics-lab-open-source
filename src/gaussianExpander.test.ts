import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { DEFAULT_EXPANDER, EXPANDER_FIELDS, collimatedPosition, expanderBuilderCopy, expanderHistory, gaussianExpander, parseExpander, type ExpanderParameters } from './gaussianExpander';
import { fromLegacy } from './builderModel';
import { SCENE_DEFINITIONS, defaultScene, parseScene } from './sceneRuntime';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) <= Math.max(1, Math.abs(b)) * 1e-9, `${a} ≠ ${b}`);
const cases: ExpanderParameters[] = [DEFAULT_EXPANDER,
  { ...DEFAULT_EXPANDER, firstKind: 1, secondPositionMm: 225 },
  { ...DEFAULT_EXPANDER, secondPositionMm: 170 },
  { ...DEFAULT_EXPANDER, secondPositionMm: 180 },
  { ...DEFAULT_EXPANDER, waistMm: .05, waistPositionMm: 400, observationMm: 150 },
  { ...DEFAULT_EXPANDER, waistPositionMm: -2000, observationMm: 50 },
  { ...DEFAULT_EXPANDER, firstKind: 1, firstFocalMm: 75, secondFocalMm: 300, secondPositionMm: 475, wavelengthNm: 1100, observationMm: 2000 },
  { ...DEFAULT_EXPANDER, firstKind: 1, firstFocalMm: 500, secondFocalMm: 10, waistMm: 5, secondPositionMm: 1100, wavelengthNm: 380 },
];
test('front end and assistant match independent whole-system ABCD calculations', () => {
  const python = `import json,sys,math
from backend.scene_physics import calculate
out=[]
for p in json.loads(sys.argv[1]):
 lam=p['wavelengthNm']*1e-6; zr=math.pi*p['waistMm']**2/lam
 q=complex(p['firstPositionMm']-p['waistPositionMm'],zr); f1=p['firstKind']*p['firstFocalMm']; f2=p['secondFocalMm']; d=p['secondPositionMm']-p['firstPositionMm']
 A=1-d/f1; B=d; C=-1/f1-A/f2; D=1-d/f2
 assert math.isclose(A*D-B*C,1,abs_tol=1e-10)
 qout=(A*q+B)/(C*q+D); qmid=q/(1-q/f1)
 radius=lambda q: math.sqrt(lam*(q.real*q.real+q.imag*q.imag)/(math.pi*q.imag))
 obs=(complex(p['observationMm']-p['waistPositionMm'],zr) if p['observationMm']<p['firstPositionMm'] else qmid+p['observationMm']-p['firstPositionMm'] if p['observationMm']<p['secondPositionMm'] else qout+p['observationMm']-p['secondPositionMm'])
 w=math.sqrt(lam*qout.imag/math.pi)
 vals=[radius(qmid+d)/radius(q),lam/(math.pi*w)*1000,radius(obs),p['secondPositionMm']-qout.real,w]
 backend=calculate(dict(version=1,sceneId='beam-transformation-1',parameters=p)); metrics={m['key']:m['value'] for m in backend['metrics']}
 for k,v in zip(['expansion','divergenceMrad','observationRadiusMm','outputWaistPositionMm','outputWaistMm'],vals): assert math.isclose(metrics[k],v,rel_tol=1e-9,abs_tol=1e-9)
 out.append(vals)
print(json.dumps(out))`;
  const independent = JSON.parse(execFileSync('python', ['-c', python, JSON.stringify(cases)], { encoding: 'utf8' })) as number[][];
  cases.forEach((p, i) => {
    const b = gaussianExpander(p);
    [b.expansion, b.divergenceMrad, b.observationRadiusMm, b.output.waistPositionMm, b.output.waistMm].forEach((v, j) => close(v, independent[i][j]));
    close(b.input.radiusAt(p.firstPositionMm), b.middle.radiusAt(p.firstPositionMm));
    close(b.middle.radiusAt(p.secondPositionMm), b.output.radiusAt(p.secondPositionMm));
  });
});
test('both afocal layouts reduce divergence; only Keplerian example has an intermediate waist', () => {
  for (const p of cases.slice(0, 2)) {
    const b = gaussianExpander(p); close(b.divergenceMrad, b.input.divergenceMrad / b.nominalExpansion);
    assert.equal(b.status, '近准直'); assert.equal(b.intermediateWaist, p.firstKind === 1);
  }
  assert.notEqual(gaussianExpander(cases[2]).status, '近准直');
  assert.notEqual(gaussianExpander(cases[3]).status, '近准直');
});
test('collimation changes lens 2 only, has flat wavefront, and retains nonzero diffraction divergence', () => {
  for (const p of cases.slice(0, 2)) {
    const position = collimatedPosition(p).positionMm!; assert.ok(position > p.firstPositionMm);
    const b = gaussianExpander({ ...p, secondPositionMm: position });
    close(b.q2.real, 0); assert.ok(b.divergenceMrad > 0); assert.equal(b.status, '近准直');
  }
  assert.equal(collimatedPosition({ ...DEFAULT_EXPANDER, firstKind: 1, waistMm: .01, waistPositionMm: 75 }).positionMm, null);
});
test('translation preserves widths and each observation segment uses its own beam', () => {
  const b = gaussianExpander(DEFAULT_EXPANDER), shift = 100;
  const shifted = gaussianExpander({ ...DEFAULT_EXPANDER, waistPositionMm: shift, firstPositionMm: 200, secondPositionMm: 275, observationMm: 600 });
  close(b.observationRadiusMm, shifted.observationRadiusMm); close(b.divergenceMrad, shifted.divergenceMrad);
  for (const z of [50, 150, 500]) {
    const result = gaussianExpander({ ...DEFAULT_EXPANDER, observationMm: z });
    close(result.observationRadiusMm, (z < 100 ? result.input : z < 175 ? result.middle : result.output).radiusAt(z));
  }
});
test('builder reproduces both complete Gaussian configurations', () => {
  const python = `import json,sys
from backend.spatial import SpatialExperiment,trace
print(trace(SpatialExperiment.model_validate(json.loads(sys.argv[1])))['screens'][0]['gaussianRadiusMm'])`;
  for (const p of cases.slice(0, 2)) {
    const copy = expanderBuilderCopy(p).experiment!; assert.ok(copy);
    const lenses = copy.elements.filter(e => e.kind === 'lens'); close(lenses[0].focalLengthMm, p.firstKind * p.firstFocalMm);
    close(lenses[1].positionMm, p.secondPositionMm);
    close(Number(execFileSync('python', ['-c', python, JSON.stringify(fromLegacy(copy))], { encoding: 'utf8' })), gaussianExpander(p).observationRadiusMm);
  }
  for (const patch of [{ waistPositionMm: -1 }, { observationMm: 150 }, { secondPositionMm: 650 }, { observationMm: 800 }]) assert.equal(expanderBuilderCopy({ ...DEFAULT_EXPANDER, ...patch }).experiment, null);
});
test('definition constraints agree and history keeps each gesture atomic', () => {
  const definition = SCENE_DEFINITIONS['beam-transformation-1'];
  for (const f of EXPANDER_FIELDS) {
    const d = definition.parameters.find(v => v.key === f.key)!;
    assert.deepEqual([d.min, d.max, d.step, d.default], [f.min, f.max, f.step, DEFAULT_EXPANDER[f.key]]);
  }
  assert.deepEqual(defaultScene('beam-transformation-1').parameters, DEFAULT_EXPANDER);
  const initial = { past: [], present: DEFAULT_EXPANDER, future: [] }, moved = { ...DEFAULT_EXPANDER, secondPositionMm: 180 };
  const commit = expanderHistory(initial, { type: 'commit', parameters: moved });
  const undo = expanderHistory(commit, { type: 'undo' }); assert.deepEqual(undo.present, DEFAULT_EXPANDER);
  assert.deepEqual(expanderHistory(undo, { type: 'redo' }).present, moved);
  for (const patch of [{ firstKind: 0 }, { secondPositionMm: 99 }, { firstFocalMm: 0 }]) {
    assert.throws(() => parseExpander({ ...DEFAULT_EXPANDER, ...patch }));
    assert.throws(() => parseScene({ version: 1, sceneId: 'beam-transformation-1', parameters: { ...DEFAULT_EXPANDER, ...patch } }));
  }
});

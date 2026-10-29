import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_FORMULA_VALUES, solveFormula } from './formulaCatalog';
import { gaussianBeam, gaussianElements, makeGaussianScene } from './gaussianBeam';
import { calculatorValues, FORMULA_QUANTITIES, solveForQuantity } from './formulaSolver';
import { parseFormulaFavorites } from './formulaFavorites';
import { readRoute, routeHash } from './navigation';
import { formatFormulaInput, formatFormulaNumber } from './formulaNumbers';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) <= Math.max(1, Math.abs(b)) * 1e-12);

test('calculator displays shorten decimals without changing calculation values', () => {
  const raw = calculatorValues(DEFAULT_FORMULA_VALUES);
  const before = { ...raw };
  assert.equal(formatFormulaInput(String(raw.rayleighMm)), '236.21');
  assert.equal(formatFormulaNumber(0.3368), '0.3368');
  assert.equal(formatFormulaInput('0.200000'), '0.2');
  assert.equal(formatFormulaInput('320'), '320');
  assert.deepEqual(raw, before);
  assert.notEqual(raw.rayleighMm, Number(formatFormulaInput(String(raw.rayleighMm))));
});

test('calculator formatting preserves small nonzero readings and handles empty or infinite values', () => {
  assert.equal(formatFormulaInput('0.0000000123456789'), '1.235e-8');
  assert.equal(formatFormulaInput('120000000'), '1.2e+8');
  assert.equal(formatFormulaNumber(-0), '0');
  assert.equal(formatFormulaNumber(Infinity), '∞');
  assert.equal(formatFormulaNumber(NaN), '—');
  for (const raw of ['', ' ', 'NaN', 'Infinity']) assert.equal(formatFormulaInput(raw), '');
});

test('favorites restore formulas across categories and discard duplicates or removed entries', () => {
  assert.deepEqual(parseFormulaFavorites(JSON.stringify(['radius', 'reflection-law', 'radius', 'removed-formula', 3, null])), ['radius', 'reflection-law']);
});

test('missing or damaged favorites do not prevent the library opening', () => {
  for (const value of [null, '', '{broken', '{}', 'false']) assert.deepEqual(parseFormulaFavorites(value), []);
});

test('favorite routes retain search and detail context through refresh and return navigation', () => {
  const list = { area: 'formulas' as const, category: 'favorites', query: '光束' };
  assert.deepEqual(readRoute(routeHash(list)), { ...list, formula: undefined, knowledge: undefined });
  const detail = readRoute(routeHash({ ...list, formula: 'radius' }));
  assert.equal(detail.category, 'favorites');
  assert.equal(detail.formula, 'radius');
  assert.equal(detail.query, '光束');
  assert.equal(readRoute('#/formulas?category=unknown').category, 'all');
  assert.equal(readRoute('#/scenes?category=favorites').category, 'all');
});

test('knowledge calculators convert nm and reproduce independent Gaussian reference values', () => {
  const values = { ...DEFAULT_FORMULA_VALUES, wavelengthNm: 1000, waistMm: .1, distanceMm: 10 * Math.PI, radiusMm: .2, offsetMm: .2 };
  close(solveFormula('rayleigh', values), 10 * Math.PI);
  close(solveFormula('radius', values), .1 * Math.SQRT2);
  close(solveFormula('divergence', values), 10 / Math.PI);
  close(solveFormula('curvature', values), 20 * Math.PI);
  close(solveFormula('intensity', values), 100 * Math.exp(-2));
});

test('knowledge results agree with the scene without changing its inputs', () => {
  const { laser, screen } = gaussianElements(makeGaussianScene());
  const before = JSON.stringify({ laser, screen });
  const beam = gaussianBeam(laser, screen);
  const values = { ...DEFAULT_FORMULA_VALUES, wavelengthNm: laser.wavelengthNm, waistMm: laser.waistMm, distanceMm: beam.distanceMm, radiusMm: beam.screenRadiusMm, offsetMm: beam.screenRadiusMm };
  close(solveFormula('radius', values), beam.screenRadiusMm);
  close(solveFormula('rayleigh', values), beam.rayleighMm);
  close(solveFormula('divergence', values), beam.divergenceMrad);
  close(solveFormula('curvature', values), beam.screenWavefrontRadiusMm);
  close(solveFormula('intensity', values), beam.relativeIntensityAt(beam.screenRadiusMm) * 100);
  assert.equal(JSON.stringify({ laser, screen }), before);
});

test('calculator domains include a flat wavefront but exclude nonphysical inputs', () => {
  assert.equal(solveFormula('curvature', { ...DEFAULT_FORMULA_VALUES, distanceMm: 0 }), Infinity);
  assert.equal(solveFormula('intensity', { ...DEFAULT_FORMULA_VALUES, offsetMm: 0 }), 100);
  assert.throws(() => solveFormula('rayleigh', { ...DEFAULT_FORMULA_VALUES, wavelengthNm: 0 }));
  assert.throws(() => solveFormula('radius', { ...DEFAULT_FORMULA_VALUES, distanceMm: -1 }));
  assert.throws(() => solveFormula('divergence', { ...DEFAULT_FORMULA_VALUES, waistMm: NaN }));
  assert.throws(() => solveFormula('intensity', { ...DEFAULT_FORMULA_VALUES, radiusMm: 0 }));
});

test('each displayed formula can recover every unknown with consistent units', () => {
  const inputs = { ...DEFAULT_FORMULA_VALUES, wavelengthNm: 1000, waistMm: .1, distanceMm: 20 * Math.PI, radiusMm: .2, offsetMm: .2 };
  const values = calculatorValues(inputs);
  const references = {
    radius: { ...values, radiusMm: .1 * Math.sqrt(5) },
    rayleigh: { ...values, rayleighMm: 10 * Math.PI },
    divergence: { ...values, divergenceMrad: 10 / Math.PI },
    curvature: { ...values, curvatureMm: 25 * Math.PI },
    intensity: { ...values, intensityPercent: 100 * Math.exp(-2) },
  };
  for (const id of Object.keys(FORMULA_QUANTITIES) as (keyof typeof FORMULA_QUANTITIES)[]) {
    for (const target of FORMULA_QUANTITIES[id]) {
      const results = solveForQuantity(id, target, references[id]).values;
      assert.ok(results.some(result => Math.abs(result - references[id][target]) < 1e-10), `${id} recovers ${target}`);
    }
  }
});

test('curvature inverse returns both physical positions and the repeated Rayleigh solution', () => {
  const values = { ...calculatorValues(DEFAULT_FORMULA_VALUES), rayleighMm: 10, curvatureMm: 25 };
  const result = solveForQuantity('curvature', 'distanceMm', values);
  assert.deepEqual(result.values, [5, 20]);
  assert.ok(result.note);
  for (const d of result.values) close(d + 100 / d, 25);
  assert.deepEqual(solveForQuantity('curvature', 'distanceMm', { ...values, curvatureMm: 20 }).values, [10]);
  assert.throws(() => solveForQuantity('curvature', 'distanceMm', { ...values, curvatureMm: 19 }));
  const widelySeparated = solveForQuantity('curvature', 'distanceMm', { ...values, curvatureMm: 1e10 }).values;
  close(widelySeparated[0], 1e-8);
  close(widelySeparated[1], 1e10);
});

test('inverse solvers reject impossible or underdetermined inputs and handle waist limits', () => {
  const values = calculatorValues(DEFAULT_FORMULA_VALUES);
  assert.deepEqual(solveForQuantity('radius', 'distanceMm', { ...values, radiusMm: values.waistMm }).values, [0]);
  assert.throws(() => solveForQuantity('radius', 'distanceMm', { ...values, radiusMm: .1 }));
  assert.throws(() => solveForQuantity('radius', 'rayleighMm', { ...values, distanceMm: 0, radiusMm: values.waistMm }), /无法/);
  assert.equal(solveForQuantity('curvature', 'curvatureMm', { ...values, distanceMm: 0 }).values[0], Infinity);
  assert.throws(() => solveForQuantity('curvature', 'rayleighMm', { ...values, distanceMm: 0 }));
  assert.deepEqual(solveForQuantity('intensity', 'offsetMm', { ...values, intensityPercent: 100 }).values, [0]);
  assert.throws(() => solveForQuantity('intensity', 'radiusMm', { ...values, offsetMm: 0, intensityPercent: 100 }), /无法/);
  for (const intensityPercent of [-1, 0, 101, NaN]) assert.throws(() => solveForQuantity('intensity', 'offsetMm', { ...values, intensityPercent }));
  assert.throws(() => solveForQuantity('rayleigh', 'waistMm', { ...values, rayleighMm: 0 }));
  assert.throws(() => solveForQuantity('divergence', 'wavelengthNm', { ...values, divergenceMrad: Infinity }));
});

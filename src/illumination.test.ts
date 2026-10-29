import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DEFAULT_ILLUMINATION, illuminanceAt, illuminationMap, illuminationHistory, parseIllumination } from './illumination';

test('illumination: independent server agrees on the point, section and full area across boundaries', () => {
  const samples = [DEFAULT_ILLUMINATION, ...Array.from({ length: 12 }, (_, i) => ({ ...DEFAULT_ILLUMINATION, intensityCd: i === 0 ? 0 : 25+i*100, heightM: .5+i*.4, sourceXM: -3+i*.5, tiltDeg: -70+i*12, halfAngleDeg: 10+i*4, observationXM: -4+i*.65, observationYM: 4-i*.6 }))];
  const proc = spawnSync('python', ['-c', 'import json,sys; from backend.scene_illumination import illuminance_at,map_values; print(json.dumps([dict(observation=illuminance_at(p),**map_values(p)) for p in json.load(sys.stdin)]))'], { input: JSON.stringify(samples), encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  const expected = JSON.parse(proc.stdout);
  const close = (a: number, b: number) => assert.ok(Math.abs(a-b) < Math.max(1e-10, Math.abs(b)*1e-10), `${a} vs ${b}`);
  samples.forEach((p, i) => { const b=illuminationMap(p), r=expected[i]; close(b.observation.value, r.observation.value); close(b.observation.distance, r.observation.distance); close(b.average,r.average); close(b.maximum,r.maximum); close(b.minimum,r.minimum); assert.equal(b.uniformity===null,r.uniformity===null); if(b.uniformity!==null)close(b.uniformity,r.uniformity); const row=b.curve[37]; close(row.y,illuminanceAt(p,row.x,p.observationYM).value); });
});

test('illumination: state history preserves all coordinates and rejects invalid scene parameters', () => {
  const initial = { past: [], present: { ...DEFAULT_ILLUMINATION }, future: [] };
  const moved = illuminationHistory(initial, { type: 'commit', parameters: { ...DEFAULT_ILLUMINATION, observationXM: -2, observationYM: 3 } });
  assert.deepEqual(illuminationHistory(moved, { type: 'undo' }).present, DEFAULT_ILLUMINATION);
  assert.deepEqual(illuminationHistory(illuminationHistory(moved, { type: 'undo' }), { type: 'redo' }), moved);
  for(const patch of [{heightM:0},{halfAngleDeg:90},{tiltDeg:71},{observationXM:5},{intensityCd:NaN}])assert.throws(()=>parseIllumination({...DEFAULT_ILLUMINATION,...patch}));
});

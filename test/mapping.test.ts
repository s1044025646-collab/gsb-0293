import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScl } from '../src/scl';
import { pitchForKey } from '../src/mapping';
import { FREQ_REL_TOL } from '../src/constants';

const SCALE = parseScl('d\n2\n3/2\n2/1\n'); // ratios [1, 3/2, 2], N=2, period 2
const CFG = { periodKey: 0, refKey: 0, refHz: 440 };

function freq(key: number, cfg = CFG) {
  return pitchForKey(SCALE.ratios, SCALE.period, SCALE.count, cfg, key).frequency;
}

test('规格示例：K=R=0, 440Hz → 键1=660, 键2=880, 键-1=330', () => {
  assert.ok(Math.abs(freq(1) - 660) < 660 * FREQ_REL_TOL);
  assert.ok(Math.abs(freq(2) - 880) < 880 * FREQ_REL_TOL);
  assert.ok(Math.abs(freq(-1) - 330) < 330 * FREQ_REL_TOL);
});

test('负键差使用向下取整：键-1 落在周期 -1、级数 1', () => {
  const p = pitchForKey(SCALE.ratios, SCALE.period, SCALE.count, CFG, -1);
  assert.equal(p.periodIndex, -1);
  assert.equal(p.degree, 1);
  assert.equal(p.ratio, 0.75); // (3/2) * 2^-1
});

test('负多周期：键 -3 → 周期 -2、级数 1，频率 165', () => {
  const p = pitchForKey(SCALE.ratios, SCALE.period, SCALE.count, CFG, -3);
  assert.equal(p.periodIndex, -2);
  assert.equal(p.degree, 1);
  assert.ok(Math.abs(p.frequency - 165) < 165 * FREQ_REL_TOL);
});

test('相隔 N 键的频率比等于周期', () => {
  for (const k of [-7, -1, 0, 3, 10]) {
    const ratio = freq(k + 2) / freq(k);
    assert.ok(Math.abs(ratio - 2) < 2 * FREQ_REL_TOL, `k=${k} ratio=${ratio}`);
  }
});

test('参考键不必是周期起点：R=1 且 660Hz 时键 0 归一为 440', () => {
  const cfg = { periodKey: 0, refKey: 1, refHz: 660 };
  assert.ok(Math.abs(freq(0, cfg) - 440) < 440 * FREQ_REL_TOL);
  assert.ok(Math.abs(freq(1, cfg) - 660) < 660 * FREQ_REL_TOL);
});

test('周期起点 K 非零：K=5, R=5 时键 6 = 660', () => {
  const cfg = { periodKey: 5, refKey: 5, refHz: 440 };
  assert.ok(Math.abs(freq(6, cfg) - 660) < 660 * FREQ_REL_TOL);
  assert.ok(Math.abs(freq(4, cfg) - 330) < 330 * FREQ_REL_TOL);
});

test('整体更换参考 Hz 只同比例缩放', () => {
  const cfg2 = { ...CFG, refHz: 220 };
  for (const k of [-3, 0, 1, 5]) {
    assert.ok(Math.abs(freq(k, cfg2) / freq(k) - 0.5) < FREQ_REL_TOL);
  }
});

test('周期为 3/1 的音阶：跨周期比值为 3', () => {
  const s = parseScl('d\n2\n3/2\n3/1\n');
  const f = (k: number) => pitchForKey(s.ratios, s.period, s.count, CFG, k).frequency;
  assert.ok(Math.abs(f(2) / f(0) - 3) < 3 * FREQ_REL_TOL);
  assert.ok(Math.abs(f(-1) * 3 - f(1)) < FREQ_REL_TOL);
});

test('N=1 音阶：每键一个周期', () => {
  const s = parseScl('d\n1\n2\n');
  const f = (k: number) => pitchForKey(s.ratios, s.period, s.count, CFG, k).frequency;
  assert.ok(Math.abs(f(1) - 880) < 880 * FREQ_REL_TOL);
  assert.ok(Math.abs(f(-1) - 220) < 220 * FREQ_REL_TOL);
});

test('键号越界与非有限频率被诊断', () => {
  assert.throws(() => freq(2_000_000), (e: any) => e.code === 'KEY_OUT_OF_RANGE');
  // 3/1 周期、极大负键 → 下溢为 0
  const s = parseScl('d\n1\n3\n');
  assert.throws(
    () => pitchForKey(s.ratios, s.period, s.count, CFG, -1_000_000),
    (e: any) => e.code === 'FREQ_NOT_FINITE'
  );
});

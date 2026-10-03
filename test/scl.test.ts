import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScl } from '../src/scl';
import { ERR } from '../src/errors';
import { CENTS_TOL } from '../src/constants';

const BASIC = `! 注释行
示例音阶
2
!
3/2
2/1
`;

test('解析基本音阶：隐含首级 + 声明两项', () => {
  const p = parseScl(BASIC);
  assert.equal(p.count, 2);
  assert.deepEqual(p.ratios, [1, 1.5, 2]);
  assert.equal(p.period, 2);
});

test('注释与空行被忽略', () => {
  const p = parseScl('\n! hello\n\n描述\n\n2\n! x\n3/2\n\n2/1\n');
  assert.equal(p.count, 2);
});

test('音分与分数表示等价', () => {
  const a = parseScl('d\n2\n701.9550008653874\n1200.0\n');
  const b = parseScl('d\n2\n3/2\n2/1\n');
  for (let i = 0; i < a.ratios.length; i++) {
    const centsA = 1200 * Math.log2(a.ratios[i]);
    const centsB = 1200 * Math.log2(b.ratios[i]);
    assert.ok(Math.abs(centsA - centsB) < 1e-4, `${centsA} vs ${centsB}`);
  }
  assert.ok(Math.abs(a.period - 2) < CENTS_TOL);
});

test('整数按频率比解释（2 是 2/1 而非 2 音分）', () => {
  const p = parseScl('d\n1\n2\n');
  assert.equal(p.period, 2);
});

test('N=1：只有周期', () => {
  const p = parseScl('d\n1\n2/1\n');
  assert.deepEqual(p.ratios, [1, 2]);
});

test('周期不必是 2/1（3/1 周期）', () => {
  const p = parseScl('d\n2\n3/2\n3/1\n');
  assert.equal(p.period, 3);
});

test('计数不符被拒绝', () => {
  assert.throws(() => parseScl('d\n3\n3/2\n2/1\n'), (e: any) => e.code === ERR.SCL_COUNT_MISMATCH);
});

test('零分母被拒绝', () => {
  assert.throws(() => parseScl('d\n1\n1/0\n'), (e: any) => e.code === ERR.SCL_BAD_INTERVAL);
});

test('非递增音程被拒绝', () => {
  assert.throws(() => parseScl('d\n2\n2/1\n3/2\n'), (e: any) => e.code === ERR.SCL_NOT_INCREASING);
  assert.throws(() => parseScl('d\n2\n0.0\n2/1\n'), (e: any) => e.code === ERR.SCL_NOT_INCREASING);
});

test('计数越界被拒绝', () => {
  assert.throws(() => parseScl('d\n0\n2\n'), (e: any) => e.code === ERR.SCL_BAD_COUNT);
  assert.throws(() => parseScl('d\n129\n2\n'), (e: any) => e.code === ERR.SCL_BAD_COUNT);
});

test('不支持的扩展语法被明确拒绝', () => {
  assert.throws(() => parseScl('d\n1\n2^(1/1)\n'), (e: any) => e.code === ERR.SCL_UNSUPPORTED_SYNTAX);
  assert.throws(() => parseScl('d\n1\n1,5\n'), (e: any) => e.code === ERR.SCL_UNSUPPORTED_SYNTAX);
});

test('空文本被拒绝', () => {
  assert.throws(() => parseScl('  \n! only comments\n'), (e: any) => e.code === ERR.SCL_EMPTY);
});

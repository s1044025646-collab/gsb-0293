import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openDb } from '../src/db';
import * as core from '../src/core';
import { ERR } from '../src/errors';

const SCL = 'demo\n2\n3/2\n2/1\n';

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scl-test-'));
  return { dir, file: path.join(dir, 't.db') };
}

test('导入失败不留下音阶记录', () => {
  const { file } = tmpDb();
  const db = openDb(file);
  assert.throws(() => core.importScale(db, 'bad', 'd\n3\n3/2\n2/1\n'), (e: any) => e.code === ERR.SCL_COUNT_MISMATCH);
  assert.equal(core.listScales(db).length, 0);
  db.close();
});

test('修改参考频率生成新配置版本，旧配置仍可查询', () => {
  const { file } = tmpDb();
  const db = openDb(file);
  const s = core.importScale(db, 'a', SCL);
  const c1 = core.createConfig(db, s.id, 0, 0, 440);
  const c2 = core.createConfig(db, s.id, 0, 0, 220);
  assert.equal(c1.version, 1);
  assert.equal(c2.version, 2);
  assert.equal(core.pitch(db, c1.id, 1).frequency, 660);
  assert.equal(core.pitch(db, c2.id, 1).frequency, 330);
  db.close();
});

test('重启后数据仍可读（持久化）', () => {
  const { file } = tmpDb();
  let db = openDb(file);
  const s = core.importScale(db, 'a', SCL);
  const c = core.createConfig(db, s.id, 0, 0, 440);
  db.close();
  db = openDb(file);
  assert.equal(core.listScales(db).length, 1);
  assert.equal(core.pitch(db, c.id, 2).frequency, 880);
  db.close();
});

test('区间上限与非法区间诊断', () => {
  const { file } = tmpDb();
  const db = openDb(file);
  const s = core.importScale(db, 'a', SCL);
  const c = core.createConfig(db, s.id, 0, 0, 440);
  assert.throws(() => core.pitchRange(db, c.id, 0, 99999), (e: any) => e.code === ERR.RANGE_TOO_LARGE);
  assert.throws(() => core.pitchRange(db, c.id, 5, 1), (e: any) => e.code === ERR.BAD_PARAM);
  db.close();
});

test('比较两套音阶：12-TET 与微分音在键 1 上音分差非零', () => {
  const { file } = tmpDb();
  const db = openDb(file);
  const tet = core.importScale(db, 'tet', 't\n12\n' + Array.from({ length: 12 }, (_, i) => `${(i + 1) * 100}.0`).join('\n') + '\n');
  const micro = core.importScale(db, 'm', SCL);
  const c1 = core.createConfig(db, tet.id, 0, 0, 440);
  const c2 = core.createConfig(db, micro.id, 0, 0, 440);
  const rows = core.compareConfigs(db, c1.id, c2.id, 0, 2);
  assert.ok(Math.abs(rows[0].centsDiff) < 1e-6);
  assert.ok(Math.abs(rows[1].centsDiff - (1200 * Math.log2(1.5) - 100)) < 1e-6);
  assert.ok(Math.abs(rows[2].centsDiff - 1000) < 1e-6); // 周期 1200 音分 vs 12-TET 200 音分
  db.close();
});

test('导出调律表 CSV', () => {
  const { file } = tmpDb();
  const db = openDb(file);
  const s = core.importScale(db, 'a', SCL);
  const c = core.createConfig(db, s.id, 0, 0, 440);
  const csv = core.exportTuningTable(db, c.id, 0, 2);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^key,frequency_hz/);
  assert.match(lines[2], /^1,660/);
  db.close();
});

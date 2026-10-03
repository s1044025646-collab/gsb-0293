import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db';
import { createServer } from '../src/api';
import type { Server } from 'node:http';

let server: Server;
let base: string;

before(async () => {
  const db = openDb(':memory:');
  server = createServer(db);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

after(() => server.close());

async function post(p: string, body: unknown) {
  const res = await fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

test('API 端到端：导入、配置、查询、解释、导出', async () => {
  const bad = await post('/scales', { name: 'bad', text: 'd\n3\n3/2\n2/1\n' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'SCL_COUNT_MISMATCH');

  const imp = await post('/scales', { name: 'a', text: 'demo\n2\n3/2\n2/1\n' });
  assert.equal(imp.status, 201);
  const scaleId = imp.body.id;

  const cfg = await post('/configs', { scaleId, periodKey: 0, refKey: 0, refHz: 440 });
  assert.equal(cfg.status, 201);
  const cid = cfg.body.id;

  const pitch = await (await fetch(`${base}/configs/${cid}/pitch?key=-1`)).json();
  assert.equal(pitch.frequency, 330);
  assert.equal(pitch.periodIndex, -1);
  assert.equal(pitch.degree, 1);

  const explain = await (await fetch(`${base}/configs/${cid}/explain?key=2`)).json();
  assert.match(explain.text, /第 1 个周期/);

  const exp = await fetch(`${base}/configs/${cid}/export?from=0&to=1`);
  assert.match(await exp.text(), /660/);

  const oob = await fetch(`${base}/configs/${cid}/pitch?key=2000000`);
  assert.equal(oob.status, 400);
  assert.equal((await oob.json()).error.code, 'KEY_OUT_OF_RANGE');
});

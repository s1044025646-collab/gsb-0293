import { DatabaseSync } from 'node:sqlite';
import { parseScl, ParsedScale } from './scl';
import { MappingConfig, PitchResult, pitchForKey } from './mapping';
import { ApiError, ERR } from './errors';
import { MAX_SPAN } from './constants';
import { ConfigRow, ScaleRow } from './db';

export interface ScaleView {
  id: number;
  name: string;
  description: string;
  count: number;
  ratios: number[];
  period: number;
  sclText: string;
  createdAt: string;
}

export interface ConfigView {
  id: number;
  scaleId: number;
  periodKey: number;
  refKey: number;
  refHz: number;
  version: number;
  createdAt: string;
}

function scaleView(row: ScaleRow): ScaleView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    count: row.count,
    ratios: JSON.parse(row.ratios),
    period: row.period,
    sclText: row.scl_text,
    createdAt: row.created_at
  };
}

function configView(row: ConfigRow): ConfigView {
  return {
    id: row.id,
    scaleId: row.scale_id,
    periodKey: row.period_key,
    refKey: row.ref_key,
    refHz: row.ref_hz,
    version: row.version,
    createdAt: row.created_at
  };
}

/** 仅校验 SCL 文本，不落库。 */
export function validateScale(text: string): ParsedScale {
  return parseScl(text);
}

/** 导入音阶：解析失败时不写入任何记录。 */
export function importScale(db: DatabaseSync, name: string, text: string): ScaleView {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ApiError(ERR.BAD_PARAM, '音阶名称不能为空');
  }
  const parsed = parseScl(text); // 先解析，失败则抛错且不落库
  const stmt = db.prepare(
    `INSERT INTO scales (name, description, scl_text, count, ratios, period, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const res = stmt.run(
    name.trim(),
    parsed.description,
    text,
    parsed.count,
    JSON.stringify(parsed.ratios),
    parsed.period,
    new Date().toISOString()
  );
  return getScale(db, Number(res.lastInsertRowid));
}

export function getScale(db: DatabaseSync, id: number): ScaleView {
  const row = db.prepare('SELECT * FROM scales WHERE id = ?').get(id) as ScaleRow | undefined;
  if (!row) throw new ApiError(ERR.SCALE_NOT_FOUND, `音阶不存在: ${id}`, 404);
  return scaleView(row);
}

export function listScales(db: DatabaseSync): ScaleView[] {
  const rows = db.prepare('SELECT * FROM scales ORDER BY id').all() as unknown as ScaleRow[];
  return rows.map(scaleView);
}

/**
 * 创建映射配置。同一音阶每次创建生成新的 version，旧配置保留可查询。
 */
export function createConfig(
  db: DatabaseSync,
  scaleId: number,
  periodKey: number,
  refKey: number,
  refHz: number
): ConfigView {
  getScale(db, scaleId);
  for (const [label, v] of [['periodKey', periodKey], ['refKey', refKey]] as const) {
    if (!Number.isInteger(v)) throw new ApiError(ERR.BAD_PARAM, `${label} 必须是整数`);
  }
  if (!(typeof refHz === 'number' && Number.isFinite(refHz) && refHz > 0)) {
    throw new ApiError(ERR.BAD_PARAM, `refHz 必须是正有限数: ${refHz}`);
  }
  const prev = db
    .prepare('SELECT MAX(version) AS v FROM configs WHERE scale_id = ?')
    .get(scaleId) as { v: number | null };
  const version = (prev.v ?? 0) + 1;
  const res = db
    .prepare(
      `INSERT INTO configs (scale_id, period_key, ref_key, ref_hz, version, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(scaleId, periodKey, refKey, refHz, version, new Date().toISOString());
  return getConfig(db, Number(res.lastInsertRowid));
}

export function getConfig(db: DatabaseSync, id: number): ConfigView {
  const row = db.prepare('SELECT * FROM configs WHERE id = ?').get(id) as ConfigRow | undefined;
  if (!row) throw new ApiError(ERR.CONFIG_NOT_FOUND, `配置不存在: ${id}`, 404);
  return configView(row);
}

export function listConfigs(db: DatabaseSync): ConfigView[] {
  const rows = db.prepare('SELECT * FROM configs ORDER BY id').all() as unknown as ConfigRow[];
  return rows.map(configView);
}

function mappingOf(cfg: ConfigView): MappingConfig {
  return { periodKey: cfg.periodKey, refKey: cfg.refKey, refHz: cfg.refHz };
}

export function pitch(db: DatabaseSync, configId: number, key: number): PitchResult {
  const cfg = getConfig(db, configId);
  const scale = getScale(db, cfg.scaleId);
  return pitchForKey(scale.ratios, scale.period, scale.count, mappingOf(cfg), key);
}

function checkSpan(from: number, to: number): void {
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) {
    throw new ApiError(ERR.BAD_PARAM, `区间参数无效: from=${from}, to=${to}`);
  }
  if (to - from + 1 > MAX_SPAN) {
    throw new ApiError(ERR.RANGE_TOO_LARGE, `区间过大：一次最多 ${MAX_SPAN} 个键`);
  }
}

export function pitchRange(db: DatabaseSync, configId: number, from: number, to: number): PitchResult[] {
  checkSpan(from, to);
  const out: PitchResult[] = [];
  for (let k = from; k <= to; k++) out.push(pitch(db, configId, k));
  return out;
}

export interface CompareRow {
  key: number;
  a: PitchResult;
  b: PitchResult;
  /** b 相对 a 的音分差 */
  centsDiff: number;
}

export function compareConfigs(
  db: DatabaseSync,
  configA: number,
  configB: number,
  from: number,
  to: number
): CompareRow[] {
  checkSpan(from, to);
  const rows: CompareRow[] = [];
  for (let k = from; k <= to; k++) {
    const a = pitch(db, configA, k);
    const b = pitch(db, configB, k);
    rows.push({ key: k, a, b, centsDiff: 1200 * Math.log2(b.frequency / a.frequency) });
  }
  return rows;
}

/** 导出调律表（CSV 文本）。 */
export function exportTuningTable(db: DatabaseSync, configId: number, from: number, to: number): string {
  const rows = pitchRange(db, configId, from, to);
  const lines = ['key,frequency_hz,period_index,degree,ratio,cents_from_ref'];
  for (const r of rows) {
    lines.push(
      [r.key, r.frequency, r.periodIndex, r.degree, r.ratio, r.centsFromRef].join(',')
    );
  }
  return lines.join('\n') + '\n';
}

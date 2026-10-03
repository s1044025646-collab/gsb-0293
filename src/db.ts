import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fail } from "./errors.js";
import { parseScale, type ParsedScale } from "./scl.js";
import type { MappingConfig } from "./mapper.js";

export const RESULT_VERSION = 1;

export interface ScaleRecord {
  id: number;
  name: string;
  description: string;
  rawText: string;
  count: number;
  period: number;
  normalized: ParsedIntervalRow[];
  resultVersion: number;
  createdAt: string;
}

export interface ParsedIntervalRow {
  index: number;
  token: string;
  ratio: number;
  cents: number;
  kind: string;
}

export interface ConfigRecord {
  id: number;
  scaleId: number;
  name: string;
  originKey: number;
  referenceKey: number;
  referenceHz: number;
  resultVersion: number;
  createdAt: string;
}

export function openDatabase(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS scales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      count INTEGER NOT NULL,
      period REAL NOT NULL,
      normalized_json TEXT NOT NULL,
      result_version INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scale_id INTEGER NOT NULL REFERENCES scales(id),
      name TEXT NOT NULL,
      origin_key INTEGER NOT NULL,
      reference_key INTEGER NOT NULL,
      reference_hz REAL NOT NULL,
      result_version INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (scale_id, name)
    );
  `);
  return db;
}

/**
 * 原子导入：先完整解析，再在事务中写入。解析失败不会插入任何记录，
 * 因此绝不可能留下“音程数量不足却标为可用”的音阶。
 */
export function insertScale(
  db: DatabaseSync,
  name: string,
  rawText: string
): ScaleRecord {
  if (!name || !name.trim()) fail("VALIDATION_ERROR", "音阶名称不能为空");
  const parsed = parseScale(rawText); // 失败即抛出，无副作用
  const normalized: ParsedIntervalRow[] = parsed.intervals.map((iv, i) => ({
    index: i + 1,
    token: iv.token,
    ratio: iv.ratio,
    cents: iv.cents,
    kind: iv.kind
  }));

  const exists = db.prepare("SELECT id FROM scales WHERE name = ?").get(name.trim());
  if (exists) fail("CONFLICT", `音阶名称已存在：${name.trim()}`);

  const insert = db.prepare(`
    INSERT INTO scales (name, description, raw_text, count, period, normalized_json, result_version)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  let info: { lastInsertRowid: number | bigint };
  try {
    db.exec("BEGIN");
    info = insert.run(
      name.trim(),
      parsed.description,
      rawText,
      parsed.count,
      parsed.period,
      JSON.stringify(normalized),
      RESULT_VERSION
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return getScale(db, Number(info.lastInsertRowid))!;
}

interface ScaleRow {
  id: number;
  name: string;
  description: string;
  raw_text: string;
  count: number;
  period: number;
  normalized_json: string;
  result_version: number;
  created_at: string;
}

function rowToScale(row: ScaleRow): ScaleRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    rawText: row.raw_text,
    count: row.count,
    period: row.period,
    normalized: JSON.parse(row.normalized_json) as ParsedIntervalRow[],
    resultVersion: row.result_version,
    createdAt: row.created_at
  };
}

export function getScale(db: DatabaseSync, id: number): ScaleRecord | null {
  const row = db.prepare("SELECT * FROM scales WHERE id = ?").get(id) as
    | ScaleRow
    | undefined;
  return row ? rowToScale(row) : null;
}

export function findScaleByName(db: DatabaseSync, name: string): ScaleRecord | null {
  const row = db.prepare("SELECT * FROM scales WHERE name = ?").get(name) as
    | ScaleRow
    | undefined;
  return row ? rowToScale(row) : null;
}

export function requireScale(db: DatabaseSync, id: number): ScaleRecord {
  const scale = getScale(db, id);
  if (!scale) fail("NOT_FOUND", `不存在的音阶 id=${id}`);
  return scale;
}

export function listScales(db: DatabaseSync): ScaleRecord[] {
  const rows = db.prepare("SELECT * FROM scales ORDER BY id").all() as unknown as ScaleRow[];
  return rows.map(rowToScale);
}

/** 从存储记录重建可计算的 ParsedScale（原始文本是事实来源，重新解析保证一致）。 */
export function loadParsedScale(db: DatabaseSync, id: number): ParsedScale {
  const scale = requireScale(db, id);
  return parseScale(scale.rawText);
}

/** 创建映射配置（新版本配置，不改动旧配置）。 */
export function insertConfig(
  db: DatabaseSync,
  scaleId: number,
  name: string,
  config: MappingConfig
): ConfigRecord {
  requireScale(db, scaleId);
  if (!name || !name.trim()) fail("VALIDATION_ERROR", "配置名称不能为空");
  if (
    !Number.isInteger(config.originKey) ||
    !Number.isInteger(config.referenceKey) ||
    !(config.referenceHz > 0) ||
    !Number.isFinite(config.referenceHz)
  ) {
    fail("VALIDATION_ERROR", "配置参数非法：K、R 为整数，参考 Hz 为正有限数");
  }
  const dup = db
    .prepare("SELECT id FROM configs WHERE scale_id = ? AND name = ?")
    .get(scaleId, name.trim());
  if (dup) fail("CONFLICT", `该音阶下配置名称已存在：${name.trim()}`);

  const info = db
    .prepare(`
      INSERT INTO configs (scale_id, name, origin_key, reference_key, reference_hz, result_version)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      scaleId,
      name.trim(),
      config.originKey,
      config.referenceKey,
      config.referenceHz,
      RESULT_VERSION
    );
  return getConfig(db, Number(info.lastInsertRowid))!;
}

interface ConfigRow {
  id: number;
  scale_id: number;
  name: string;
  origin_key: number;
  reference_key: number;
  reference_hz: number;
  result_version: number;
  created_at: string;
}

function rowToConfig(row: ConfigRow): ConfigRecord {
  return {
    id: row.id,
    scaleId: row.scale_id,
    name: row.name,
    originKey: row.origin_key,
    referenceKey: row.reference_key,
    referenceHz: row.reference_hz,
    resultVersion: row.result_version,
    createdAt: row.created_at
  };
}

export function getConfig(db: DatabaseSync, id: number): ConfigRecord | null {
  const row = db.prepare("SELECT * FROM configs WHERE id = ?").get(id) as
    | ConfigRow
    | undefined;
  return row ? rowToConfig(row) : null;
}

export function listConfigs(db: DatabaseSync, scaleId?: number): ConfigRecord[] {
  const rows = scaleId
    ? (db
        .prepare("SELECT * FROM configs WHERE scale_id = ? ORDER BY id")
        .all(scaleId) as unknown as ConfigRow[])
    : (db.prepare("SELECT * FROM configs ORDER BY id").all() as unknown as ConfigRow[]);
  return rows.map(rowToConfig);
}

export function requireConfig(db: DatabaseSync, id: number): ConfigRecord {
  const config = getConfig(db, id);
  if (!config) fail("NOT_FOUND", `不存在的配置 id=${id}`);
  return config;
}

export function configToMapping(row: ConfigRecord): MappingConfig {
  return {
    originKey: row.originKey,
    referenceKey: row.referenceKey,
    referenceHz: row.referenceHz
  };
}


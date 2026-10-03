import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ScaleRow {
  id: number;
  name: string;
  description: string;
  scl_text: string;
  count: number;
  ratios: string; // JSON number[]
  period: number;
  created_at: string;
}

export interface ConfigRow {
  id: number;
  scale_id: number;
  period_key: number;
  ref_key: number;
  ref_hz: number;
  version: number;
  created_at: string;
}

export function defaultDataDir(): string {
  return process.env.SCL_DATA_DIR || path.join(process.cwd(), 'data');
}

export function openDb(dbPath?: string): DatabaseSync {
  const file = dbPath || path.join(defaultDataDir(), 'scl.db');
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS scales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      scl_text TEXT NOT NULL,
      count INTEGER NOT NULL,
      ratios TEXT NOT NULL,
      period REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scale_id INTEGER NOT NULL REFERENCES scales(id),
      period_key INTEGER NOT NULL,
      ref_key INTEGER NOT NULL,
      ref_hz REAL NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

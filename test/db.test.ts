import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  openDatabase,
  insertScale,
  insertConfig,
  loadParsedScale,
  listScales,
  listConfigs,
  configToMapping
} from "../src/db.js";
import { frequencyOf } from "../src/mapper.js";
import { ScaleError } from "../src/errors.js";

describe("SQLite 持久化", () => {
  const dir = mkdtempSync(join(tmpdir(), "microtonal-"));
  const dbPath = join(dir, "test.sqlite");

  beforeEach(() => {
    const db = openDatabase(dbPath);
    db.exec("DELETE FROM configs; DELETE FROM scales;");
    db.close();
  });

  it("原子导入：解析失败不留半成品音阶", () => {
    const db = openDatabase(dbPath);
    insertScale(db, "ok", "d\n 2\n3/2\n2/1\n");
    const before = listScales(db).length;
    expect(() => insertScale(db, "broken", "d\n 3\n3/2\n2/1\n")).toThrow(ScaleError);
    expect(listScales(db).length).toBe(before);
    db.close();
  });

  it("重名音阶冲突", () => {
    const db = openDatabase(dbPath);
    insertScale(db, "dup", "d\n 1\n2\n");
    expect(() => insertScale(db, "dup", "d\n 1\n3\n")).toThrowError(
      expect.objectContaining({ code: "CONFLICT" })
    );
    db.close();
  });

  it("重启后读取原始文本并重算，旧配置仍可查询", () => {
    let db = openDatabase(dbPath);
    const scale = insertScale(db, "pyth", "Pyth\n 2\n3/2\n2/1\n");
    insertConfig(db, scale.id, "c440", { originKey: 0, referenceKey: 0, referenceHz: 440 });
    insertConfig(db, scale.id, "c880", { originKey: 0, referenceKey: 0, referenceHz: 880 });
    db.close();

    db = openDatabase(dbPath);
    const parsed = loadParsedScale(db, scale.id);
    const [c440, c880] = listConfigs(db, scale.id);
    expect(frequencyOf(parsed, configToMapping(c440), 1).frequency).toBeCloseTo(660, 6);
    expect(frequencyOf(parsed, configToMapping(c880), 1).frequency).toBeCloseTo(1320, 6);
    expect(frequencyOf(parsed, configToMapping(c440), -1).frequency).toBeCloseTo(330, 6);
    db.close();
  });
});

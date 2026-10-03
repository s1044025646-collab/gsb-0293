import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseScale, validateScale } from "./scl.js";
import {
  compareScales,
  frequencyOf,
  frequencyRange,
  tuningTable
} from "./mapper.js";
import { freqClose, centsClose } from "./mathUtil.js";
import {
  configToMapping,
  insertConfig,
  insertScale,
  listConfigs,
  listScales,
  loadParsedScale,
  openDatabase
} from "./db.js";
import { ScaleError } from "./errors.js";

let passed = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok =
    typeof actual === "number" && typeof expected === "number"
      ? freqClose(actual, expected)
      : actual === expected;
  if (!ok) throw new Error(`断言失败：${label}，实际=${actual}，期望=${expected}`);
  passed++;
  console.log(`  ✓ ${label} = ${String(actual)}`);
}

function expectError(code: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    if (err instanceof ScaleError && err.code === code) {
      passed++;
      console.log(`  ✓ 正确拒绝 [${code}] ${err.message}`);
      return;
    }
    throw err;
  }
  throw new Error(`期望错误 ${code} 但未抛出`);
}

const PYTH = `Pythagorean-style 2-tone scale
  2
3/2
2/1
`;

export async function runDemo(dbPath: string): Promise<void> {
  console.log("=== 微分音音阶服务离线演示 ===\n");

  console.log("[1] 基本映射：N=2（3/2、2/1），K=R=0，参考 440Hz");
  const pyth = parseScale(PYTH);
  check("N", pyth.count, 2);
  check("周期", pyth.period, 2);
  const cfg = { originKey: 0, referenceKey: 0, referenceHz: 440 };
  check("键1（3/2）", frequencyOf(pyth, cfg, 1).frequency, 660);
  check("键2（周期）", frequencyOf(pyth, cfg, 2).frequency, 880);
  check("键-1（负周期，2^-1）", frequencyOf(pyth, cfg, -1).frequency, 330);
  check("键3（跨周期*3/2）", frequencyOf(pyth, cfg, 3).frequency, 1320);
  check("键-2", frequencyOf(pyth, cfg, -2).frequency, 220);
  check("键-3（负多周期）", frequencyOf(pyth, cfg, -3).frequency, 165);

  console.log("\n[2] 负向周期使用 floor 而非截断");
  check("键-1 周期序号 q", frequencyOf(pyth, cfg, -1).periodIndex, -1);
  check("键-1 级数 r", frequencyOf(pyth, cfg, -1).degree, 1);
  check("键-3 周期序号 q", frequencyOf(pyth, cfg, -3).periodIndex, -2);
  check("键-3 级数 r", frequencyOf(pyth, cfg, -3).degree, 1);

  console.log("\n[3] 改变参考键（R 不是周期起点），按同一比值归一");
  const cfgR1 = { originKey: 0, referenceKey: 1, referenceHz: 660 };
  check("键0（参考=键1=660）", frequencyOf(pyth, cfgR1, 0).frequency, 440);
  check("键2", frequencyOf(pyth, cfgR1, 2).frequency, 880);
  check("键-1", frequencyOf(pyth, cfgR1, -1).frequency, 330);

  console.log("\n[4] 周期为三比一，N=1");
  const triple = parseScale(`Tripling N=1\n 1\n3/1\n`);
  check("N=1", triple.count, 1);
  check("周期=3", triple.period, 3);
  const cfg3 = { originKey: 0, referenceKey: 0, referenceHz: 100 };
  check("键1=300", frequencyOf(triple, cfg3, 1).frequency, 300);
  check("键-1=100/3", frequencyOf(triple, cfg3, -1).frequency, 100 / 3);

  console.log("\n[5] 分数与小数音分等价表示");
  const tripleCents = parseScale(`Tripling cents\n 1\n1901.9550008653875\n`);
  if (!freqClose(tripleCents.period, 3, 1e-9)) {
    throw new Error("音分表示与 3/1 不等价");
  }
  if (!centsClose(tripleCents.intervals[0].cents, 1901.9550008653875)) {
    throw new Error("音分往返不一致");
  }
  passed++;
  console.log("  ✓ 2^(1901.955.../1200) ≈ 3，与 3/1 等价");

  console.log("\n[6] 相隔 N 键频率比恰为周期；更换参考 Hz 只等比缩放");
  for (const k of [-5, 0, 7, 12]) {
    const a = frequencyOf(pyth, cfg, k).frequency;
    const b = frequencyOf(pyth, cfg, k + 2).frequency;
    check(`键 ${k} 与 ${k + 2} 之比=2`, b / a, 2);
  }
  const cfg880 = { ...cfg, referenceHz: 880 };
  check("Hz 翻倍->键1", frequencyOf(pyth, cfg880, 1).frequency, 1320);
  check("Hz 翻倍->键-1", frequencyOf(pyth, cfg880, -1).frequency, 660);

  console.log("\n[7] 注释与空行被忽略");
  const withComments = `! 顶行注释\n\n描述行!\n  2  ! 计数行尾注释\n\n3/2  纯五度\n2/1\n`;
  check("带注释解析 N", parseScale(withComments).count, 2);

  console.log("\n[8] 非法音阶明确拒绝");
  expectError("SCL_COUNT_MISMATCH", () => parseScale("d\n 3\n3/2\n2/1\n"));
  expectError("SCL_ZERO_DENOMINATOR", () => parseScale("d\n 2\n3/0\n2/1\n"));
  expectError("SCL_NOT_STRICTLY_INCREASING", () => parseScale("d\n 2\n2/1\n3/2\n"));
  expectError("SCL_PERIOD_NOT_GREATER_THAN_ONE", () => parseScale("d\n 1\n1/1\n"));
  expectError("SCL_NON_POSITIVE", () => parseScale("d\n 1\n0/1\n"));
  expectError("SCL_UNSUPPORTED_SYNTAX", () => parseScale("d\n 1\n2^3\n"));
  expectError("VALIDATION_ERROR", () => parseScale("d\n 0\n"));

  console.log("\n[9] 溢出/下溢诊断（不返回正常成功值）");
  expectError("FREQUENCY_OVERFLOW", () => frequencyOf(triple, cfg3, 100000));
  expectError("FREQUENCY_UNDERFLOW", () => frequencyOf(triple, cfg3, -100000));

  console.log("\n[10] SQLite 持久化 + 原子导入 + 重启读取");
  const db1 = openDatabase(dbPath);
  insertScale(db1, "pyth", PYTH);
  insertScale(db1, "triple", "Tripling\n 1\n3/1\n");
  insertConfig(db1, 1, "p440", cfg);
  insertConfig(db1, 1, "p880", cfg880);
  // 非法导入失败后，库中音阶数量不变（无半成品）
  const before = listScales(db1).length;
  expectError("SCL_COUNT_MISMATCH", () =>
    insertScale(db1, "broken", "d\n 3\n3/2\n2/1\n")
  );
  check("失败导入不留记录", listScales(db1).length, before);
  db1.close();

  const db2 = openDatabase(dbPath); // “重启”
  const reloaded = loadParsedScale(db2, 1);
  const storedCfg = configToMapping(requireExistingConfig(db2, "p440"));
  check("重启后键1", frequencyOf(reloaded, storedCfg, 1).frequency, 660);
  check("重启后键-1", frequencyOf(reloaded, storedCfg, -1).frequency, 330);
  const oldCfg = configToMapping(requireExistingConfig(db2, "p880"));
  check("旧配置 p880 仍可查询", frequencyOf(reloaded, oldCfg, 1).frequency, 1320);
  db2.close();

  console.log("\n[11] 十二平均律 vs 微分音（同一键区间差异）");
  const eq12 = parseScale(readFileSync(join(process.cwd(), "scales", "equal12.scl"), "utf8"));
  const just = parseScale(readFileSync(join(process.cwd(), "scales", "just12.scl"), "utf8"));
  const comparison = compareScales(
    { name: "12-TET", parsed: eq12, config: cfg },
    { name: "just", parsed: just, config: cfg },
    0,
    12
  );
  for (const row of comparison.rows.slice(1, 6)) {
    console.log(
      `  k=${row.key}: TET=${row.leftHz.toFixed(3)}Hz  微分=${row.rightHz.toFixed(
        3
      )}Hz  差=${row.centsDifference.toFixed(3)} cent`
    );
  }

  console.log("\n[12] 导出调律表片段（键 -1..2）");
  const table = tuningTable(pyth, cfg, -1, 2);
  for (const row of table.rows) {
    console.log(
      `  k=${row.key} q=${row.periodIndex} r=${row.degree} f=${row.frequency.toFixed(2)}Hz`
    );
  }

  console.log(`\n全部 ${passed} 项断言通过。`);
}

function requireExistingConfig(db: ReturnType<typeof openDatabase>, name: string) {
  const found = listConfigs(db).find((c) => c.name === name);
  if (!found) throw new Error(`缺少配置 ${name}`);
  return found;
}

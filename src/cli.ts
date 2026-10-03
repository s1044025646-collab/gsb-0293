#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { ScaleError } from "./errors.js";
import {
  configToMapping,
  findScaleByName,
  insertConfig,
  insertScale,
  listConfigs,
  listScales,
  loadParsedScale,
  openDatabase,
  requireConfig,
  requireScale
} from "./db.js";
import {
  compareScales,
  frequencyOf,
  frequencyRange,
  tuningTable
} from "./mapper.js";
import { validateScale } from "./scl.js";
import { startServer, DEFAULT_DB_PATH } from "./server.js";

interface Args {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const command = argv[0] ?? "help";
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next != null && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { command, positional, flags };
}

function flag(flags: Record<string, string | boolean>, key: string, fallback?: string): string {
  const value = flags[key];
  if (typeof value === "string") return value;
  if (fallback !== undefined) return fallback;
  throw new ScaleError("VALIDATION_ERROR", `缺少必填参数 --${key}`);
}

function flagInt(flags: Record<string, string | boolean>, key: string, fallback?: number): number {
  if (!(key in flags)) {
    if (fallback !== undefined) return fallback;
    throw new ScaleError("VALIDATION_ERROR", `缺少必填参数 --${key}`);
  }
  const raw = flag(flags, key);
  if (!/^-?\d+$/.test(raw)) {
    throw new ScaleError("VALIDATION_ERROR", `--${key} 必须是整数，实际为 ${raw}`);
  }
  return Number(raw);
}

function flagHz(flags: Record<string, string | boolean>): number {
  const raw = flag(flags, "hz");
  const hz = Number(raw);
  if (!(hz > 0) || !Number.isFinite(hz)) {
    throw new ScaleError("VALIDATION_ERROR", `--hz 必须是正有限数，实际为 ${raw}`);
  }
  return hz;
}

function readScl(flags: Record<string, string | boolean>): string {
  if (typeof flags.scl === "string") return flags.scl;
  if (typeof flags.file === "string") {
    const path = isAbsolute(flags.file) ? flags.file : resolve(process.cwd(), flags.file);
    return readFileSync(path, "utf8");
  }
  throw new ScaleError("VALIDATION_ERROR", "需通过 --scl 直接提供文本或 --file 指向 .scl 文件");
}

function resolveScaleId(db: ReturnType<typeof openDatabase>, flags: Args["flags"]): number {
  if (typeof flags.scale === "string") {
    const scale = findScaleByName(db, flags.scale);
    if (!scale) throw new ScaleError("NOT_FOUND", `不存在的音阶：${flags.scale}`);
    return scale.id;
  }
  if (typeof flags["scale-id"] === "string") return Number(flags["scale-id"]);
  throw new ScaleError("VALIDATION_ERROR", "需通过 --scale <名称> 或 --scale-id <id> 指定音阶");
}

function resolveMapping(
  db: ReturnType<typeof openDatabase>,
  flags: Args["flags"]
): { scaleId: number; config: ReturnType<typeof configToMapping> } {
  if (typeof flags.config === "string") {
    const cfg =
      listConfigs(db).find((c) => c.name === flags.config) ??
      (typeof flags["config-id"] === "string"
        ? requireConfig(db, Number(flags["config-id"]))
        : undefined);
    if (!cfg) throw new ScaleError("NOT_FOUND", `不存在的配置：${String(flags.config)}`);
    return { scaleId: cfg.scaleId, config: configToMapping(cfg) };
  }
  if (typeof flags["config-id"] === "string") {
    const cfg = requireConfig(db, Number(flags["config-id"]));
    return { scaleId: cfg.scaleId, config: configToMapping(cfg) };
  }
  const scaleId = resolveScaleId(db, flags);
  return {
    scaleId,
    config: {
      originKey: flagInt(flags, "origin", 0),
      referenceKey: flagInt(flags, "reference", 0),
      referenceHz: flagHz(flags)
    }
  };
}

const HELP = `
微分音音阶映射 CLI（离线、仅计算音高关系）

用法：
  node dist/cli.js <命令> [参数]

命令：
  validate   校验 SCL 文本（--scl "<文本>" 或 --file path.scl）
  import     导入音阶（--name <名称> 与 SCL 来源）
  list       列出已导入音阶（加 --configs 同时列出配置）
  config     创建映射配置（--name、--scale、--origin、--reference、--hz）
  key        查询单键（--config 或音阶+参考参数，--k <键号>）
  range      查询闭区间（--from、--to）
  explain    查看单键的周期与级数解释（--k）
  table      导出调律表（--from、--to，可选 --out 文件，否则打印 JSON）
  compare    比较两套音阶（--left-config、--right-config、--from、--to）
  serve      启动 HTTP API（--port，默认选空闲端口）
  demo       运行内置离线演示并重启读取 SQLite 验证持久化

通用：--db <路径> 指定 SQLite 文件（默认 ./data/microtonal.sqlite）
示例：
  node dist/cli.js validate --file scales/pythagorean.scl
  node dist/cli.js import --name pyth --file scales/pythagorean.scl
  node dist/cli.js config --name p440 --scale pyth --origin 0 --reference 0 --hz 440
  node dist/cli.js key --config p440 --k -1
  node dist/cli.js range --config p440 --from -2 --to 3
  node dist/cli.js serve --port 4321
`.trim();

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dbPath =
    typeof args.flags.db === "string"
      ? isAbsolute(args.flags.db)
        ? args.flags.db
        : resolve(process.cwd(), args.flags.db)
      : DEFAULT_DB_PATH;

  if (args.command === "help" || args.command === "--help" || args.command === "-h") {
    console.log(HELP);
    return;
  }

  if (args.command === "serve") {
    const port = flagInt(args.flags, "port", 0);
    const started = await startServer(dbPath, port);
    console.log(`HTTP API 已启动：http://localhost:${started.port}`);
    console.log("健康检查：GET /health；按 Ctrl+C 退出。");
    process.on("SIGINT", () => {
      started.close();
      process.exit(0);
    });
    return;
  }

  if (args.command === "demo") {
    const { runDemo } = await import("./demo.js");
    await runDemo(dbPath);
    return;
  }

  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openDatabase(dbPath);
  try {
    switch (args.command) {
      case "validate": {
        console.log(JSON.stringify(validateScale(readScl(args.flags)), null, 2));
        break;
      }
      case "import": {
        const record = insertScale(db, flag(args.flags, "name"), readScl(args.flags));
        console.log(`已导入音阶 id=${record.id} name=${record.name} N=${record.count} 周期=${record.period}`);
        break;
      }
      case "list": {
        const scales = listScales(db);
        for (const s of scales) {
          console.log(`#${s.id} ${s.name}  N=${s.count} 周期=${s.period}  “${s.description}”`);
        }
        if (args.flags.configs) {
          for (const c of listConfigs(db)) {
            console.log(
              `  配置 #${c.id} ${c.name} scaleId=${c.scaleId} K=${c.originKey} R=${c.referenceKey} Hz=${c.referenceHz}`
            );
          }
        }
        break;
      }
      case "config": {
        const scaleId = resolveScaleId(db, args.flags);
        const record = insertConfig(db, scaleId, flag(args.flags, "name"), {
          originKey: flagInt(args.flags, "origin", 0),
          referenceKey: flagInt(args.flags, "reference", 0),
          referenceHz: flagHz(args.flags)
        });
        console.log(`已创建配置 id=${record.id} name=${record.name}`);
        break;
      }
      case "key": {
        const ctx = resolveMapping(db, args.flags);
        const key = flagInt(args.flags, "k");
        console.log(JSON.stringify(frequencyOf(loadParsedScale(db, ctx.scaleId), ctx.config, key), null, 2));
        break;
      }
      case "range": {
        const ctx = resolveMapping(db, args.flags);
        const from = flagInt(args.flags, "from");
        const to = flagInt(args.flags, "to");
        const result = frequencyRange(loadParsedScale(db, ctx.scaleId), ctx.config, from, to);
        for (const row of result.results) {
          console.log(
            `k=${row.key}\tq=${row.periodIndex}\tr=${row.degree}\tf=${row.frequency.toFixed(6)} Hz`
          );
        }
        break;
      }
      case "explain": {
        const ctx = resolveMapping(db, args.flags);
        const key = flagInt(args.flags, "k");
        const parsed = loadParsedScale(db, ctx.scaleId);
        const row = frequencyOf(parsed, ctx.config, key);
        console.log(
          `键 ${row.key}：d=${row.delta}，q=floor(d/${parsed.count})=${row.periodIndex}，r=${row.degree}，` +
            `第 ${row.periodIndex} 周期第 ${row.degree} 级，频率 ${row.frequency.toFixed(6)} Hz`
        );
        break;
      }
      case "table": {
        const ctx = resolveMapping(db, args.flags);
        const table = tuningTable(
          loadParsedScale(db, ctx.scaleId),
          ctx.config,
          flagInt(args.flags, "from"),
          flagInt(args.flags, "to")
        );
        const json = JSON.stringify(table, null, 2);
        if (typeof args.flags.out === "string") {
          const outPath = isAbsolute(args.flags.out)
            ? args.flags.out
            : resolve(process.cwd(), args.flags.out);
          writeFileSync(outPath, json, "utf8");
          console.log(`调律表已写入 ${outPath}`);
        } else {
          console.log(json);
        }
        break;
      }
      case "compare": {
        const left = resolveConfigRef(db, args.flags, "left");
        const right = resolveConfigRef(db, args.flags, "right");
        const result = compareScales(
          { name: left.name, parsed: loadParsedScale(db, left.scaleId), config: left.config },
          { name: right.name, parsed: loadParsedScale(db, right.scaleId), config: right.config },
          flagInt(args.flags, "from"),
          flagInt(args.flags, "to")
        );
        for (const row of result.rows) {
          console.log(
            `k=${row.key}\t左=${row.leftHz.toFixed(4)}\t右=${row.rightHz.toFixed(4)}\t差=${row.centsDifference.toFixed(4)} cent`
          );
        }
        break;
      }
      default:
        console.error(`未知命令：${args.command}\n\n${HELP}`);
        process.exitCode = 2;
    }
  } finally {
    db.close();
  }
}

function resolveConfigRef(
  db: ReturnType<typeof openDatabase>,
  flags: Args["flags"],
  prefix: string
): { name: string; scaleId: number; config: ReturnType<typeof configToMapping> } {
  const cfgFlag = flags[`${prefix}-config`];
  if (typeof cfgFlag !== "string") {
    throw new ScaleError("VALIDATION_ERROR", `比较需提供 --${prefix}-config <配置名>`);
  }
  const cfg = listConfigs(db).find((c) => c.name === cfgFlag);
  if (!cfg) throw new ScaleError("NOT_FOUND", `不存在的配置：${cfgFlag}`);
  return { name: cfgFlag, scaleId: cfg.scaleId, config: configToMapping(cfg) };
}

main().catch((err: unknown) => {
  if (err instanceof ScaleError) {
    console.error(`错误 [${err.code}] ${err.message}`);
    if (err.details !== undefined) console.error("详情：", JSON.stringify(err.details));
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
});

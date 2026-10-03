import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
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
} from "./db.js";
import {
  compareScales,
  frequencyOf,
  frequencyRange,
  tuningTable,
  validateConfig
} from "./mapper.js";
import { validateScale } from "./scl.js";
import { TOLERANCE } from "./mathUtil.js";

type Database = ReturnType<typeof openDatabase>;

const HTTP_STATUS: Record<string, number> = {
  VALIDATION_ERROR: 400,
  SCL_PARSE_ERROR: 400,
  SCL_COUNT_MISMATCH: 400,
  SCL_INVALID_INTERVAL: 400,
  SCL_ZERO_DENOMINATOR: 400,
  SCL_NON_POSITIVE: 400,
  SCL_NOT_STRICTLY_INCREASING: 400,
  SCL_PERIOD_NOT_GREATER_THAN_ONE: 400,
  SCL_UNSUPPORTED_SYNTAX: 400,
  SCL_EMPTY: 400,
  RANGE_TOO_LARGE: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  FREQUENCY_OVERFLOW: 422,
  FREQUENCY_UNDERFLOW: 422,
  FREQUENCY_NON_FINITE: 422
};

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        reject(new ScaleError("VALIDATION_ERROR", "请求体超过 4MB 上限"));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on("end", () => {
      if (raw.trim() === "") return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ScaleError("VALIDATION_ERROR", "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function intParam(url: URL, key: string): number | undefined {
  const v = url.searchParams.get(key);
  if (v == null) return undefined;
  if (!/^-?\d+$/.test(v)) {
    throw new ScaleError("VALIDATION_ERROR", `查询参数 ${key} 必须是整数`);
  }
  return Number(v);
}

function resolveScaleRef(db: Database, body: any, url: URL) {
  const byName = body.scaleName ?? url.searchParams.get("scaleName");
  const byId =
    body.scaleId ??
    (url.searchParams.get("scaleId") != null
      ? Number(url.searchParams.get("scaleId"))
      : undefined);
  let id: number | undefined = byId;
  if (byName != null) {
    const scale = findScaleByName(db, String(byName));
    if (!scale) throw new ScaleError("NOT_FOUND", `不存在的音阶：${byName}`);
    id = scale.id;
  }
  if (id == null) throw new ScaleError("VALIDATION_ERROR", "必须提供 scaleId 或 scaleName");
  return id;
}

function resolveConfig(db: Database, body: any, url: URL) {
  const configId =
    body.configId ??
    (url.searchParams.get("configId") != null
      ? Number(url.searchParams.get("configId"))
      : undefined);
  if (configId != null) {
    const row = requireConfig(db, configId);
    return { scaleId: row.scaleId, config: configToMapping(row), configId: row.id };
  }
  const scaleId = resolveScaleRef(db, body, url);
  const config = {
    originKey: num(body.originKey ?? url.searchParams.get("originKey"), "originKey"),
    referenceKey: num(body.referenceKey ?? url.searchParams.get("referenceKey"), "referenceKey"),
    referenceHz: num(body.referenceHz ?? url.searchParams.get("referenceHz"), "referenceHz")
  };
  validateConfig(config);
  return { scaleId, config, configId: undefined };
}

function num(value: unknown, name: string): number {
  if (value == null || value === "") {
    throw new ScaleError("VALIDATION_ERROR", `缺少参数 ${name}`);
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new ScaleError("VALIDATION_ERROR", `参数 ${name} 必须是有限数`);
  }
  return n;
}

export interface StartedServer {
  server: Server;
  port: number;
  close: () => void;
}

export function startServer(dbPath: string, preferredPort = 0): Promise<StartedServer> {
  const db = openDatabase(dbPath);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const route = `${req.method} ${url.pathname}`;

      if (route === "GET /health") {
        return json(res, 200, { ok: true, tolerance: TOLERANCE, resultVersion: 1 });
      }

      if (route === "POST /scales/validate") {
        const body = await readJson(req);
        return json(res, 200, validateScale(String(body.scl ?? "")));
      }

      if (route === "POST /scales" && req.method === "POST") {
        const body = await readJson(req);
        const record = insertScale(db, String(body.name ?? ""), String(body.scl ?? ""));
        return json(res, 201, record);
      }

      if (route === "GET /scales") {
        return json(res, 200, { scales: listScales(db) });
      }

      if (route === "POST /configs") {
        const body = await readJson(req);
        const scaleId = resolveScaleRef(db, body, url);
        const record = insertConfig(db, scaleId, String(body.name ?? ""), {
          originKey: num(body.originKey, "originKey"),
          referenceKey: num(body.referenceKey, "referenceKey"),
          referenceHz: num(body.referenceHz, "referenceHz")
        });
        return json(res, 201, record);
      }

      if (route === "GET /configs") {
        const scaleId = url.searchParams.get("scaleId");
        return json(res, 200, { configs: listConfigs(db, scaleId ? Number(scaleId) : undefined) });
      }

      const queryContext = async (body: any) => {
        const { scaleId, config } = resolveConfig(db, body ?? {}, url);
        return { parsed: loadParsedScale(db, scaleId), config };
      };

      if (route === "GET /keys/one" || route === "POST /keys/one") {
        const body = req.method === "POST" ? await readJson(req) : {};
        const key =
          body.key ?? intParam(url, "key") ?? (() => {
            throw new ScaleError("VALIDATION_ERROR", "缺少参数 key");
          })();
        const ctx = await queryContext(body);
        return json(res, 200, frequencyOf(ctx.parsed, ctx.config, Number(key)));
      }

      if (route === "GET /keys/range" || route === "POST /keys/range") {
        const body = req.method === "POST" ? await readJson(req) : {};
        const from = body.from ?? intParam(url, "from");
        const to = body.to ?? intParam(url, "to");
        if (from == null || to == null) {
          throw new ScaleError("VALIDATION_ERROR", "必须提供 from 与 to");
        }
        const ctx = await queryContext(body);
        return json(res, 200, frequencyRange(ctx.parsed, ctx.config, Number(from), Number(to)));
      }

      if (route === "GET /keys/explain" || route === "POST /keys/explain") {
        const body = req.method === "POST" ? await readJson(req) : {};
        const key = body.key ?? intParam(url, "key");
        if (key == null) throw new ScaleError("VALIDATION_ERROR", "缺少参数 key");
        const ctx = await queryContext(body);
        const result = frequencyOf(ctx.parsed, ctx.config, Number(key));
        const explanation = {
          ...result,
          explanation:
            `键 ${result.key} 位于第 ${result.periodIndex} 个周期、周期内第 ${result.degree} 级；` +
            `d=${result.delta}，q=floor(d/${ctx.parsed.count})=${result.periodIndex}，r=${result.degree}。`
        };
        return json(res, 200, explanation);
      }

      if (route === "POST /tuning-table") {
        const body = await readJson(req);
        const ctx = await queryContext(body);
        return json(
          res,
          200,
          tuningTable(ctx.parsed, ctx.config, num(body.from, "from"), num(body.to, "to"))
        );
      }

      if (route === "POST /compare") {
        const body = await readJson(req);
        const left = await queryContext(body.left ?? {});
        const right = await queryContext(body.right ?? {});
        return json(
          res,
          200,
          compareScales(
            { name: body.left?.name ?? "left", parsed: left.parsed, config: left.config },
            { name: body.right?.name ?? "right", parsed: right.parsed, config: right.config },
            num(body.from, "from"),
            num(body.to, "to")
          )
        );
      }

      return json(res, 404, { error: { code: "NOT_FOUND", message: `未知路由：${route}` } });
    } catch (err) {
      if (err instanceof ScaleError) {
        const status = HTTP_STATUS[err.code] ?? 500;
        return json(res, status, { error: { code: err.code, message: err.message, details: err.details } });
      }
      return json(res, 500, {
        error: { code: "DB_ERROR", message: err instanceof Error ? err.message : String(err) }
      });
    }
  });

  return new Promise((resolve) => {
    server.listen(preferredPort, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : preferredPort;
      resolve({
        server,
        port,
        close: () => {
          server.close();
          db.close();
        }
      });
    });
  });
}

export const DEFAULT_DATA_DIR = join(process.cwd(), "data");
export const DEFAULT_DB_PATH = join(DEFAULT_DATA_DIR, "microtonal.sqlite");

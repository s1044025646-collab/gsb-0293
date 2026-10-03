import * as http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { ApiError, ERR } from './errors';
import * as core from './core';

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => {
      buf += c;
      if (buf.length > 1_000_000) reject(new ApiError(ERR.BAD_PARAM, '请求体过大'));
    });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

function intParam(url: URL, name: string): number {
  const raw = url.searchParams.get(name);
  if (raw === null || !/^-?\d+$/.test(raw)) {
    throw new ApiError(ERR.BAD_PARAM, `参数 ${name} 必须是整数: ${raw}`);
  }
  return Number(raw);
}

export function createServer(db: DatabaseSync): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      const method = req.method || 'GET';
      const json = async () => {
        const raw = await readBody(req);
        try {
          return raw ? JSON.parse(raw) : {};
        } catch {
          throw new ApiError(ERR.BAD_PARAM, '请求体不是合法 JSON');
        }
      };

      // POST /scales/validate  {text}
      if (method === 'POST' && parts[0] === 'scales' && parts[1] === 'validate') {
        const body = await json();
        const parsed = core.validateScale(String(body.text ?? ''));
        return sendJson(res, 200, { ok: true, ...parsed });
      }
      // POST /scales  {name, text}
      if (method === 'POST' && parts[0] === 'scales' && parts.length === 1) {
        const body = await json();
        return sendJson(res, 201, core.importScale(db, String(body.name ?? ''), String(body.text ?? '')));
      }
      // GET /scales
      if (method === 'GET' && parts[0] === 'scales' && parts.length === 1) {
        return sendJson(res, 200, core.listScales(db));
      }
      // GET /scales/:id
      if (method === 'GET' && parts[0] === 'scales' && parts.length === 2) {
        return sendJson(res, 200, core.getScale(db, Number(parts[1])));
      }
      // POST /configs  {scaleId, periodKey, refKey, refHz}
      if (method === 'POST' && parts[0] === 'configs' && parts.length === 1) {
        const body = await json();
        return sendJson(
          res,
          201,
          core.createConfig(db, Number(body.scaleId), Number(body.periodKey), Number(body.refKey), Number(body.refHz))
        );
      }
      // GET /configs
      if (method === 'GET' && parts[0] === 'configs' && parts.length === 1) {
        return sendJson(res, 200, core.listConfigs(db));
      }
      if (parts[0] === 'configs' && parts.length >= 2) {
        const id = Number(parts[1]);
        // GET /configs/:id
        if (method === 'GET' && parts.length === 2) return sendJson(res, 200, core.getConfig(db, id));
        // GET /configs/:id/pitch?key=
        if (method === 'GET' && parts[2] === 'pitch') {
          return sendJson(res, 200, core.pitch(db, id, intParam(url, 'key')));
        }
        // GET /configs/:id/pitches?from=&to=
        if (method === 'GET' && parts[2] === 'pitches') {
          return sendJson(res, 200, core.pitchRange(db, id, intParam(url, 'from'), intParam(url, 'to')));
        }
        // GET /configs/:id/explain?key=
        if (method === 'GET' && parts[2] === 'explain') {
          const p = core.pitch(db, id, intParam(url, 'key'));
          return sendJson(res, 200, {
            key: p.key,
            periodIndex: p.periodIndex,
            degree: p.degree,
            ratio: p.ratio,
            frequency: p.frequency,
            centsFromRef: p.centsFromRef,
            text: `键 ${p.key} 落在第 ${p.periodIndex} 个周期、级数 ${p.degree}` +
              `（比值 ${p.ratio}，频率 ${p.frequency} Hz）`
          });
        }
        // GET /configs/:id/export?from=&to=  （CSV 调律表）
        if (method === 'GET' && parts[2] === 'export') {
          const csv = core.exportTuningTable(db, id, intParam(url, 'from'), intParam(url, 'to'));
          res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' });
          return res.end(csv);
        }
      }
      // GET /compare?a=&b=&from=&to=
      if (method === 'GET' && parts[0] === 'compare') {
        return sendJson(
          res,
          200,
          core.compareConfigs(db, intParam(url, 'a'), intParam(url, 'b'), intParam(url, 'from'), intParam(url, 'to'))
        );
      }
      throw new ApiError(ERR.NOT_FOUND, `路由不存在: ${method} ${url.pathname}`, 404);
    } catch (e) {
      if (e instanceof ApiError) {
        sendJson(res, e.status, { error: { code: e.code, message: e.message } });
      } else {
        sendJson(res, 500, { error: { code: ERR.INTERNAL, message: String(e) } });
      }
    }
  });
}

/** 启动服务；port 为 0 时由系统分配空闲端口（默认）。 */
export function serve(db: DatabaseSync, port: number): Promise<number> {
  const server = createServer(db);
  return new Promise((resolve) => {
    server.listen(port, () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      console.log(`SCL 音高服务已启动: http://127.0.0.1:${actual}`);
      resolve(actual);
    });
  });
}

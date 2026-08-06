import http from 'node:http';
import { URL } from 'node:url';
import type { ObjectStore } from './store.js';
import { ObjectSetService } from './oss.js';
import { ActionService } from './actions.js';
import { FunctionService } from './functions.js';
import { parseFilterExpr } from './filter-parse.js';
import type { Value } from './types.js';

/**
 * 题材无关的 REST API（node:http 零依赖）。
 * 元数据驱动：路由里的类型/动作/函数名运行时经 OMS 白名单解析，未注册即 400。
 */
export function createApiServer(store: ObjectStore): http.Server {
  const oss = new ObjectSetService(store);
  const actions = new ActionService(store);
  const fns = new FunctionService(store);
  const registry = store.registry;

  /** schema 的可 JSON 化视图（函数字段剔除，声明字段保留）。 */
  const schemaView = () => ({
    apiName: registry.schema.apiName,
    displayName: registry.schema.displayName,
    objectTypes: registry.objectTypes(),
    linkTypes: registry.linkTypes(),
    actionTypes: registry.actionTypes().map(a => ({
      apiName: a.apiName,
      displayName: a.displayName,
      system: a.system ?? false,
      parameters: a.parameters,
      criteria: a.criteria.map(c => ({ apiName: c.apiName, displayName: c.displayName, message: c.message })),
    })),
    functions: registry.functions().map(f => ({ apiName: f.apiName, displayName: f.displayName })),
  });

  const json = (res: http.ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify(body));
  };

  const readBody = (req: http.IncomingMessage): Promise<{ params?: Record<string, Value> }> =>
    new Promise((resolve, reject) => {
      let data = '';
      req.on('data', c => (data += c));
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          reject(new Error('invalid JSON body'));
        }
      });
      req.on('error', reject);
    });

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
        });
        res.end();
        return;
      }
      if (parts[0] !== 'api') return json(res, 404, { error: 'not found' });

      // GET /api/schema
      if (req.method === 'GET' && parts[1] === 'schema' && parts.length === 2)
        return json(res, 200, schemaView());

      // GET /api/objects/:type[?where=..&orderBy=&desc=&limit=]
      // GET /api/objects/:type/:pk
      // GET /api/objects/:type/:pk/links/:name
      if (req.method === 'GET' && parts[1] === 'objects') {
        const type = parts[2];
        if (parts.length === 3) {
          const filters = url.searchParams.getAll('where').map(parseFilterExpr);
          const orderBy = url.searchParams.get('orderBy') ?? undefined;
          const desc = url.searchParams.get('desc') !== null;
          const limitRaw = url.searchParams.get('limit');
          const rows = oss.query(type, filters, {
            orderBy, desc, limit: limitRaw ? Number(limitRaw) : undefined,
          });
          return json(res, 200, rows);
        }
        if (parts.length === 4) {
          const row = store.get(type, decodeURIComponent(parts[3]));
          return row ? json(res, 200, row) : json(res, 404, { error: 'object not found' });
        }
        if (parts.length === 6 && parts[4] === 'links')
          return json(res, 200, oss.traverse(type, decodeURIComponent(parts[3]), parts[5]));
      }

      // GET /api/count/:type[?by=]
      if (req.method === 'GET' && parts[1] === 'count' && parts.length === 3) {
        const by = url.searchParams.get('by');
        return json(res, 200, by ? oss.aggregateCount(parts[2], by) : { count: store.count(parts[2]) });
      }

      // POST /api/actions/:name  { params }
      if (req.method === 'POST' && parts[1] === 'actions' && parts.length === 3) {
        const body = await readBody(req);
        const result = actions.execute(parts[2], body.params ?? {});
        return json(res, 200, result); // 业务拒绝也是 200——结构化结果透传，HTTP 层不翻译业务语义
      }

      // POST /api/functions/:name  { params }
      if (req.method === 'POST' && parts[1] === 'functions' && parts.length === 3) {
        const body = await readBody(req);
        return json(res, 200, fns.call(parts[2], body.params ?? {}));
      }

      // GET /api/audit?limit= / GET /api/notifications
      if (req.method === 'GET' && parts[1] === 'audit')
        return json(res, 200, store.listAudit(Number(url.searchParams.get('limit') ?? 20)));
      if (req.method === 'GET' && parts[1] === 'notifications')
        return json(res, 200, store.listNotifications(Number(url.searchParams.get('limit') ?? 20)));

      return json(res, 404, { error: 'not found' });
    } catch (e) {
      return json(res, 400, { error: (e as Error).message });
    }
  });
}

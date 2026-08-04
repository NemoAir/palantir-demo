import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { loadOntology } from '../src/oms.js';
import { ObjectStore } from '../src/store.js';
import { createApiServer } from '../src/server.js';
import { zoo } from './fixtures/zoo.js';

let server: http.Server;
let base: string;

beforeAll(async () => {
  const store = new ObjectStore(new Database(':memory:'), loadOntology(zoo));
  store.init();
  store.upsertMany('Keeper', [{ id: 'K1', fullName: '张三' }]);
  store.upsertMany('Animal', [
    { tag: 'A1', name: '大象', weightKg: 3000, keeperId: 'K1' },
    { tag: 'A2', name: '企鹅', weightKg: 30, keeperId: 'K1' },
  ]);
  server = createApiServer(store);
  await new Promise<void>(r => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>(r => server.close(() => r())));

describe('HTTP API', () => {
  it('GET /api/schema 返回可 JSON 化元数据（函数字段被剔除）', async () => {
    const s = await (await fetch(`${base}/api/schema`)).json();
    expect(s.objectTypes.length).toBe(3);
    expect(s.actionTypes[0].apiName).toBe('feedAnimal');
    expect(s.actionTypes[0].criteria[0]).toEqual({
      apiName: 'animalExists', displayName: '动物存在', message: '找不到该编号的动物',
    });
    expect(s.functions[0].apiName).toBe('heaviestAnimal');
  });

  it('GET /api/objects/:type 过滤排序 + /:pk + 链接遍历', async () => {
    const rows = await (await fetch(`${base}/api/objects/Animal?where=weightKg>=100&orderBy=weightKg&desc=1`)).json();
    expect(rows.map((r: { tag: string }) => r.tag)).toEqual(['A1']);
    const one = await (await fetch(`${base}/api/objects/Animal/A1`)).json();
    expect(one.name).toBe('大象');
    const keeper = await (await fetch(`${base}/api/objects/Animal/A1/links/keeper`)).json();
    expect(keeper[0].fullName).toBe('张三');
  });

  it('POST /api/actions/:name 成功与 criteria 拒绝（结构化透传）', async () => {
    const ok = await (await fetch(`${base}/api/actions/feedAnimal`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ params: { tag: 'A1', foodKg: 5 } }),
    })).json();
    expect(ok.ok).toBe(true);

    const rejected = await (await fetch(`${base}/api/actions/feedAnimal`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ params: { tag: 'GHOST', foodKg: 5 } }),
    })).json();
    expect(rejected).toMatchObject({ ok: false, failedCriterion: 'animalExists' });
  });

  it('POST /api/functions/:name 与 GET /api/audit', async () => {
    const heaviest = await (await fetch(`${base}/api/functions/heaviestAnimal`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ params: {} }),
    })).json();
    expect(heaviest.tag).toBe('A1');
    const audit = await (await fetch(`${base}/api/audit?limit=5`)).json();
    expect(audit.length).toBe(1);
    expect(audit[0].action).toBe('feedAnimal');
  });

  it('404 未知路由 / 400 非法查询', async () => {
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
    expect((await fetch(`${base}/api/objects/Ghost`)).status).toBe(400);
  });
});

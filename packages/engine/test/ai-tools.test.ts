import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { loadOntology } from '../src/oms.js';
import { ObjectStore } from '../src/store.js';
import { buildTools } from '../src/ai-tools.js';
import { zoo } from './fixtures/zoo.js';
import type { OntologySchema } from '../src/types.js';

describe('ai-tools：本体 → AI 工具（OAG）', () => {
  let store: ObjectStore;

  beforeEach(() => {
    store = new ObjectStore(new Database(':memory:'), loadOntology(zoo));
    store.init();
    store.upsertMany('Animal', [{ tag: 'A1', name: '大象', weightKg: 3000, keeperId: null }]);
  });

  it('工具清单 = 基础工具 + 每个 Action + 每个 Function（schema 驱动零胶水）', () => {
    const { tools } = buildTools(store);
    const names = tools.map(t => t.name);
    expect(names).toContain('query_objects');
    expect(names).toContain('get_object');
    expect(names).toContain('traverse_link');
    expect(names).toContain('list_audit');
    expect(names).toContain('action_feedAnimal');   // Action 自动成为工具
    expect(names).toContain('fn_heaviestAnimal');   // Function 自动成为工具
    const feed = tools.find(t => t.name === 'action_feedAnimal')!;
    expect(feed.inputSchema.properties).toHaveProperty('tag');
    expect(feed.inputSchema.properties).toHaveProperty('foodKg');
    expect(feed.inputSchema.required).toEqual(['tag', 'foodKg']);
    expect(feed.description).toContain('投喂');
  });

  it('call：查询 / Action 成功 / criteria 拒绝结构化返回', () => {
    const { call } = buildTools(store);
    const rows = call('query_objects', { type: 'Animal' }) as unknown[];
    expect(rows.length).toBe(1);

    const ok = call('action_feedAnimal', { tag: 'A1', foodKg: 5 }) as { ok: boolean };
    expect(ok.ok).toBe(true);
    expect(store.get('Animal', 'A1')?.weightKg).toBe(3005);

    const rejected = call('action_feedAnimal', { tag: 'GHOST', foodKg: 5 }) as { ok: boolean; failedCriterion?: string };
    expect(rejected).toMatchObject({ ok: false, failedCriterion: 'animalExists' });

    expect(() => call('nope', {})).toThrowError(/unknown tool/);
  });

  it('enum 参数进 JSON Schema 的 enum 字段（AI 端点选而非瞎猜）', () => {
    const extended: OntologySchema = {
      ...zoo,
      actionTypes: [{
        apiName: 'setMood', displayName: '设定情绪',
        parameters: [
          { apiName: 'tag', displayName: '编号', type: 'string' },
          {
            apiName: 'mood', displayName: '情绪', type: 'string',
            editor: { kind: 'enum', options: [{ value: '开心', label: '开心' }, { value: '低落', label: '低落' }] },
          },
        ],
        criteria: [],
        apply: (_c, p) => [{ kind: 'set', objectType: 'Animal', pk: p.tag as string, property: 'mood', value: p.mood }],
      }],
    };
    const store2 = new ObjectStore(new Database(':memory:'), loadOntology(extended));
    store2.init();
    const { tools } = buildTools(store2);
    const t = tools.find(x => x.name === 'action_setMood')!;
    expect((t.inputSchema.properties.mood as { enum?: string[] }).enum).toEqual(['开心', '低落']);
  });

  it('schema 新增 Action → 工具列表自动多一个（元模型驱动）', () => {
    const extended: OntologySchema = {
      ...zoo,
      actionTypes: [
        ...(zoo.actionTypes ?? []),
        {
          apiName: 'renameAnimal', displayName: '改名',
          parameters: [
            { apiName: 'tag', displayName: '编号', type: 'string' },
            { apiName: 'newName', displayName: '新名字', type: 'string' },
          ],
          criteria: [],
          apply: (_ctx, p) => [{ kind: 'set', objectType: 'Animal', pk: p.tag as string, property: 'name', value: p.newName }],
        },
      ],
    };
    const store2 = new ObjectStore(new Database(':memory:'), loadOntology(extended));
    store2.init();
    const { tools } = buildTools(store2);
    expect(tools.map(t => t.name)).toContain('action_renameAnimal');
  });
});

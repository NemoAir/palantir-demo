import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { loadOntology } from '../src/oms.js';
import { ObjectStore } from '../src/store.js';
import { zoo } from './fixtures/zoo.js';

describe('ObjectStore', () => {
  let store: ObjectStore;

  beforeEach(() => {
    store = new ObjectStore(new Database(':memory:'), loadOntology(zoo));
    store.init();
  });

  it('init 为每个对象类型建表（含纯编辑型），布尔/数字列类型正确', () => {
    const tables = store.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'obj_%' ORDER BY name`)
      .all() as { name: string }[];
    expect(tables.map(t => t.name)).toEqual(['obj_Animal', 'obj_Keeper', 'obj_Note']);
  });

  it('upsertMany 插入与更新计数正确，get 取回', () => {
    const r1 = store.upsertMany('Animal', [
      { tag: 'A1', name: '大象', weightKg: 3000, keeperId: 'K1' },
      { tag: 'A2', name: '企鹅', weightKg: 30, keeperId: 'K1' },
    ]);
    expect(r1).toEqual({ inserted: 2, updated: 0 });

    const r2 = store.upsertMany('Animal', [
      { tag: 'A2', name: '帝企鹅', weightKg: 31, keeperId: 'K1' },
    ]);
    expect(r2).toEqual({ inserted: 0, updated: 1 });

    expect(store.count('Animal')).toBe(2);
    expect(store.get('Animal', 'A2')?.name).toBe('帝企鹅');
  });

  it('拒绝未注册类型与未注册属性（元数据白名单）', () => {
    expect(() => store.upsertMany('Ghost', [{ id: 'x' }])).toThrowError(/unknown object type/);
    expect(() => store.upsertMany('Animal', [{ tag: 'A9', hacked: 1 }])).toThrowError(/unknown property/);
  });

  it('nullable 属性可存 null，非空缺失报错', () => {
    store.upsertMany('Animal', [{ tag: 'A3', name: '树懒', weightKg: null, keeperId: null }]);
    expect(store.get('Animal', 'A3')?.weightKg).toBeNull();
    expect(() => store.upsertMany('Animal', [{ tag: 'A4', name: null }])).toThrowError(/not nullable/);
  });
});

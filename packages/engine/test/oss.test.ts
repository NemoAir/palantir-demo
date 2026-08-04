import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { loadOntology } from '../src/oms.js';
import { ObjectStore } from '../src/store.js';
import { ObjectSetService } from '../src/oss.js';
import { zoo } from './fixtures/zoo.js';

describe('ObjectSetService', () => {
  let oss: ObjectSetService;
  beforeEach(() => {
    const store = new ObjectStore(new Database(':memory:'), loadOntology(zoo));
    store.init();
    store.upsertMany('Keeper', [
      { id: 'K1', fullName: '张三' },
      { id: 'K2', fullName: '李四' },
    ]);
    store.upsertMany('Animal', [
      { tag: 'A1', name: '大象', weightKg: 3000, keeperId: 'K1' },
      { tag: 'A2', name: '企鹅', weightKg: 30, keeperId: 'K1' },
      { tag: 'A3', name: '树懒', weightKg: null, keeperId: 'K2' },
    ]);
    oss = new ObjectSetService(store);
  });

  it('无条件 query 返回全部，limit/orderBy 生效', () => {
    expect(oss.query('Animal').length).toBe(3);
    const top = oss.query('Animal', [], { orderBy: 'weightKg', desc: true, limit: 1 });
    expect(top[0].tag).toBe('A1');
  });

  it('比较/isNull 过滤', () => {
    expect(oss.query('Animal', [{ property: 'weightKg', op: 'lt', value: 100 }]).map(r => r.tag)).toEqual(['A2']);
    expect(oss.query('Animal', [{ property: 'weightKg', op: 'isNull' }]).map(r => r.tag)).toEqual(['A3']);
    expect(oss.query('Animal', [{ property: 'name', op: 'contains', value: '企' }]).map(r => r.tag)).toEqual(['A2']);
  });

  it('多条件为 AND 语义', () => {
    const rows = oss.query('Animal', [
      { property: 'keeperId', op: 'eq', value: 'K1' },
      { property: 'weightKg', op: 'gte', value: 100 },
    ]);
    expect(rows.map(r => r.tag)).toEqual(['A1']);
  });

  it('aggregateCount 分组计数（含 null 组）', () => {
    const agg = oss.aggregateCount('Animal', 'keeperId');
    expect(agg).toEqual(
      expect.arrayContaining([
        { key: 'K1', count: 2 },
        { key: 'K2', count: 1 },
      ]),
    );
  });

  it('traverse 正向（多对一）与反向（一对多）', () => {
    const keeper = oss.traverse('Animal', 'A1', 'keeper');
    expect(keeper.length).toBe(1);
    expect(keeper[0].fullName).toBe('张三');

    const animals = oss.traverse('Keeper', 'K1', 'animals');
    expect(animals.map(a => a.tag).sort()).toEqual(['A1', 'A2']);
  });

  it('未注册属性/遍历名报错（白名单）', () => {
    expect(() => oss.query('Animal', [{ property: 'hacked', op: 'eq', value: 1 }])).toThrowError(/unknown property/);
    expect(() => oss.traverse('Animal', 'A1', 'nope')).toThrowError(/no traversal/);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadOntology } from '../src/oms.js';
import { ObjectStore } from '../src/store.js';
import { materializeAll, materializeCsv } from '../src/funnel.js';
import { zoo } from './fixtures/zoo.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('funnel', () => {
  let store: ObjectStore;
  beforeEach(() => {
    store = new ObjectStore(new Database(':memory:'), loadOntology(zoo));
    store.init();
  });

  it('物化 CSV：计数/置空/跳过报告正确', () => {
    const r = materializeCsv(store, 'Animal', join(fixtures, 'animals.csv'));
    expect(r.totalRows).toBe(5);
    expect(r.inserted).toBe(4);            // A1 A2 A3 A5
    expect(r.skipped).toEqual([{ row: 4, reason: "missing primary key 'tag'" }]);
    expect(r.nulled).toEqual([
      { row: 3, property: 'weightKg', raw: '' },
      { row: 5, property: 'weightKg', raw: 'abc' },
    ]);
    expect(store.get('Animal', 'A3')?.weightKg).toBeNull();
    expect(store.count('Animal')).toBe(4);
  });

  it('幂等：重跑 count 不变、全部转为 updated', () => {
    materializeCsv(store, 'Animal', join(fixtures, 'animals.csv'));
    const r2 = materializeCsv(store, 'Animal', join(fixtures, 'animals.csv'));
    expect(r2.inserted).toBe(0);
    expect(r2.updated).toBe(4);
    expect(store.count('Animal')).toBe(4);
  });

  it('非空字符串列的空值整行跳过（如 name 为空）', () => {
    const r = materializeCsv(store, 'Keeper', join(fixtures, 'keepers.csv'));
    expect(r.inserted).toBe(2);
    expect(r.skipped).toEqual([]);
  });

  it('materializeAll 只处理带 datasource 的类型（Note 无 datasource 不报告）', () => {
    const reports = materializeAll(store, fixtures);
    expect(reports.map(r => r.objectType).sort()).toEqual(['Animal', 'Keeper']);
  });
});

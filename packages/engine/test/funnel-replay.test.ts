import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadOntology } from '../src/oms.js';
import { ObjectStore } from '../src/store.js';
import { materializeCsv } from '../src/funnel.js';
import { zoo } from './fixtures/zoo.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const animalsCsv = join(fixtures, 'animals.csv');

describe('funnel 重放与缺列容忍', () => {
  let store: ObjectStore;
  beforeEach(() => {
    store = new ObjectStore(new Database(':memory:'), loadOntology(zoo));
    store.init();
  });

  it('重物化自动重放编辑（Apply User Edits 端到端）', () => {
    materializeCsv(store, 'Animal', animalsCsv);
    store.applyEdits(
      [
        { kind: 'set', objectType: 'Animal', pk: 'A1', property: 'weightKg', value: 3005 },
        { kind: 'set', objectType: 'Animal', pk: 'A1', property: 'mood', value: '开心' },
      ],
      { action: 'feedAnimal', params: {} },
    );
    // 重物化：CSV 源值 weightKg=3000 覆盖 → 重放后编辑值胜出
    materializeCsv(store, 'Animal', animalsCsv);
    const a1 = store.get('Animal', 'A1')!;
    expect(a1.weightKg).toBe(3005);
    expect(a1.mood).toBe('开心');
  });

  it('schema 属性无 CSV 列：报 missingColumns，不计 nulled，值为 null', () => {
    const r = materializeCsv(store, 'Animal', animalsCsv);
    expect(r.missingColumns).toEqual(['mood']);
    expect(r.nulled.every(n => n.property !== 'mood')).toBe(true);
    expect(store.get('Animal', 'A1')?.mood).toBeNull();
  });
});

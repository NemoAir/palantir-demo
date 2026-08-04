import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { loadOntology } from '../src/oms.js';
import { ObjectStore } from '../src/store.js';
import { zoo } from './fixtures/zoo.js';

describe('ObjectStore edits/audit（写时合并）', () => {
  let store: ObjectStore;

  beforeEach(() => {
    store = new ObjectStore(new Database(':memory:'), loadOntology(zoo));
    store.init();
    store.upsertMany('Animal', [
      { tag: 'A1', name: '大象', weightKg: 3000, keeperId: 'K1' },
    ]);
  });

  it('set 编辑：物化表即时更新 + 账本落账 + 审计一条', () => {
    store.applyEdits(
      [{ kind: 'set', objectType: 'Animal', pk: 'A1', property: 'weightKg', value: 3005 }],
      { action: 'feedAnimal', params: { tag: 'A1', foodKg: 5 } },
    );
    expect(store.get('Animal', 'A1')?.weightKg).toBe(3005);   // 读己之写
    expect(store.editsFor('Animal').length).toBe(1);
    const audit = store.listAudit(10);
    expect(audit.length).toBe(1);
    expect(audit[0].action).toBe('feedAnimal');
  });

  it('create 编辑：纯编辑型对象被创建', () => {
    store.applyEdits(
      [{ kind: 'create', objectType: 'Note', pk: 'N1', values: { noteId: 'N1', text: '大象状态良好' } }],
      { action: 'writeNote', params: {} },
    );
    expect(store.get('Note', 'N1')?.text).toBe('大象状态良好');
    expect(store.count('Note')).toBe(1);
  });

  it('原子性：一批中有坏 edit 全部回滚（物化/账本/审计均无痕）', () => {
    expect(() =>
      store.applyEdits(
        [
          { kind: 'set', objectType: 'Animal', pk: 'A1', property: 'weightKg', value: 1 },
          { kind: 'set', objectType: 'Animal', pk: 'A1', property: 'hacked', value: 1 },
        ],
        { action: 'bad', params: {} },
      ),
    ).toThrowError(/unknown property/);
    expect(store.get('Animal', 'A1')?.weightKg).toBe(3000);
    expect(store.editsFor('Animal').length).toBe(0);
    expect(store.listAudit(10).length).toBe(0);
  });

  it('set 到不存在的对象报错', () => {
    expect(() =>
      store.applyEdits(
        [{ kind: 'set', objectType: 'Animal', pk: 'GHOST', property: 'weightKg', value: 1 }],
        { action: 'bad', params: {} },
      ),
    ).toThrowError(/does not exist/);
  });

  it('replayEdits：源数据覆盖后重放恢复编辑值（Apply User Edits）', () => {
    store.applyEdits(
      [{ kind: 'set', objectType: 'Animal', pk: 'A1', property: 'weightKg', value: 3005 }],
      { action: 'feedAnimal', params: {} },
    );
    // 模拟 Funnel 重物化：源数据把 weightKg 覆盖回 3000、name 更新
    store.upsertMany('Animal', [{ tag: 'A1', name: '亚洲象', weightKg: 3000, keeperId: 'K1' }]);
    store.replayEdits('Animal');
    const row = store.get('Animal', 'A1')!;
    expect(row.name).toBe('亚洲象');      // 源字段更新生效
    expect(row.weightKg).toBe(3005);      // 编辑字段以编辑为准
  });
});

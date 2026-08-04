import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { loadOntology } from '../src/oms.js';
import { ObjectStore } from '../src/store.js';
import { ActionService } from '../src/actions.js';
import { zoo } from './fixtures/zoo.js';

describe('ActionService 执行管线', () => {
  let store: ObjectStore;
  let actions: ActionService;

  beforeEach(() => {
    store = new ObjectStore(new Database(':memory:'), loadOntology(zoo));
    store.init();
    store.upsertMany('Animal', [{ tag: 'A1', name: '大象', weightKg: 3000, keeperId: 'K1' }]);
    actions = new ActionService(store);
  });

  it('成功路径：edits 应用 + 审计 + 副作用通知', () => {
    const r = actions.execute('feedAnimal', { tag: 'A1', foodKg: 5 });
    expect(r.ok).toBe(true);
    expect(store.get('Animal', 'A1')?.weightKg).toBe(3005);
    expect(store.listAudit(10).length).toBe(1);
    expect(store.listAudit(10)[0].action).toBe('feedAnimal');
    expect(store.listNotifications(10).length).toBe(1);
    expect(store.listNotifications(10)[0].message).toContain('A1');
  });

  it('参数校验：缺必填 / 类型错 / 未知参数（结构化 stage=params）', () => {
    const r1 = actions.execute('feedAnimal', { tag: 'A1' });
    expect(r1).toMatchObject({ ok: false, stage: 'params' });
    const r2 = actions.execute('feedAnimal', { tag: 'A1', foodKg: '五' });
    expect(r2).toMatchObject({ ok: false, stage: 'params' });
    const r3 = actions.execute('feedAnimal', { tag: 'A1', foodKg: 5, hacked: 1 });
    expect(r3).toMatchObject({ ok: false, stage: 'params' });
  });

  it('criteria 拒绝：返回失败判据名，不落库不留审计', () => {
    const r = actions.execute('feedAnimal', { tag: 'GHOST', foodKg: 5 });
    expect(r).toMatchObject({ ok: false, stage: 'criteria', failedCriterion: 'animalExists' });
    const r2 = actions.execute('feedAnimal', { tag: 'A1', foodKg: -1 });
    expect(r2).toMatchObject({ ok: false, stage: 'criteria', failedCriterion: 'foodAmountPositive' });
    expect(store.get('Animal', 'A1')?.weightKg).toBe(3000);
    expect(store.listAudit(10).length).toBe(0);
  });

  it('未知 action 抛错（编程错误而非用户输入错误）', () => {
    expect(() => actions.execute('nope', {})).toThrowError(/unknown action/);
  });
});

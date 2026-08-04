import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { loadOntology } from '../src/oms.js';
import { ObjectStore } from '../src/store.js';
import { FunctionService } from '../src/functions.js';
import { zoo } from './fixtures/zoo.js';

describe('FunctionService', () => {
  it('调用注册函数（只读上下文）', () => {
    const store = new ObjectStore(new Database(':memory:'), loadOntology(zoo));
    store.init();
    store.upsertMany('Animal', [
      { tag: 'A1', name: '大象', weightKg: 3000, keeperId: 'K1' },
      { tag: 'A2', name: '企鹅', weightKg: 30, keeperId: 'K1' },
    ]);
    const fns = new FunctionService(store);
    const heaviest = fns.call('heaviestAnimal', {}) as { tag: string };
    expect(heaviest.tag).toBe('A1');
    expect(() => fns.call('nope', {})).toThrowError(/unknown function/);
  });
});

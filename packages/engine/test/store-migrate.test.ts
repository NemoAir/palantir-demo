import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { loadOntology } from '../src/oms.js';
import { ObjectStore } from '../src/store.js';
import { zoo } from './fixtures/zoo.js';
import type { OntologySchema } from '../src/types.js';

const cloneSchema = (): OntologySchema => ({
  ...zoo,
  objectTypes: structuredClone(zoo.objectTypes),
  linkTypes: structuredClone(zoo.linkTypes),
});

/** 本体演进：schema 加属性后，旧库上 init 要能自动补列（纯编辑型对象没有重物化兜底，全靠这里）。 */
describe('本体演进：init 自动补列（schema migration）', () => {
  it('新增 nullable 属性：init 自动 ALTER 补列，旧数据保留、新列为 NULL、可写入', () => {
    const db = new Database(':memory:');
    const v1 = new ObjectStore(db, loadOntology(zoo));
    v1.init();
    v1.upsertMany('Keeper', [{ id: 'K1', fullName: '张三' }]);

    const evolved = cloneSchema();
    evolved.objectTypes.find(o => o.apiName === 'Keeper')!.properties.push(
      { apiName: 'phone', displayName: '电话', type: 'string', nullable: true },
    );
    const v2 = new ObjectStore(db, loadOntology(evolved));
    v2.init();

    const row = v2.get('Keeper', 'K1')!;
    expect(row.fullName).toBe('张三');
    expect(row.phone).toBeNull();

    v2.upsertMany('Keeper', [{ id: 'K1', fullName: '张三', phone: '13800000000' }]);
    expect(v2.get('Keeper', 'K1')?.phone).toBe('13800000000');
  });

  it('新增非空属性无法安全补默认值（不造数）：init 指名报错', () => {
    const db = new Database(':memory:');
    new ObjectStore(db, loadOntology(zoo)).init();

    const evolved = cloneSchema();
    evolved.objectTypes.find(o => o.apiName === 'Keeper')!.properties.push(
      { apiName: 'badge', displayName: '工牌', type: 'string' },
    );
    expect(() => new ObjectStore(db, loadOntology(evolved)).init()).toThrowError(/badge/);
  });
});

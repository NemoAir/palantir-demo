import { describe, it, expect } from 'vitest';
import { loadOntology, OntologyValidationError } from '../src/oms.js';
import { zoo } from './fixtures/zoo.js';
import type { OntologySchema } from '../src/types.js';

/** 深克隆声明部分；动能部分（actionTypes/functions 含函数）保持引用——structuredClone 不能克隆函数。 */
const clone = (): OntologySchema => ({
  ...zoo,
  objectTypes: structuredClone(zoo.objectTypes),
  linkTypes: structuredClone(zoo.linkTypes),
});

describe('loadOntology', () => {
  it('合法 schema 注册成功，可按名取回', () => {
    const reg = loadOntology(zoo);
    expect(reg.objectTypes().length).toBe(3);
    expect(reg.objectType('Animal').displayName).toBe('动物');
    expect(reg.linkTypes().length).toBe(1);
  });

  it('拒绝非法 apiName（SQL 标识符防线）', () => {
    const s = clone();
    s.objectTypes[0].apiName = 'Animal; DROP TABLE--';
    expect(() => loadOntology(s)).toThrowError(OntologyValidationError);
  });

  it('拒绝重复对象类型 apiName，报错带定位', () => {
    const s = clone();
    s.objectTypes.push(structuredClone(s.objectTypes[0]));
    try {
      loadOntology(s);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(OntologyValidationError);
      expect((e as OntologyValidationError).path).toContain('Animal');
    }
  });

  it('拒绝主键不在属性表/主键 nullable', () => {
    const s1 = clone();
    s1.objectTypes[0].primaryKey = 'nope';
    expect(() => loadOntology(s1)).toThrowError(/primaryKey/);

    const s2 = clone();
    s2.objectTypes[0].properties[0].nullable = true; // tag 是主键
    expect(() => loadOntology(s2)).toThrowError(/nullable/);
  });

  it('拒绝链接指向不存在的类型 / 外键属性不存在', () => {
    const s1 = clone();
    s1.linkTypes[0].target = 'Ghost';
    expect(() => loadOntology(s1)).toThrowError(/Ghost/);

    const s2 = clone();
    s2.linkTypes[0].mapping.property = 'ghostFk';
    expect(() => loadOntology(s2)).toThrowError(/ghostFk/);
  });

  it('拒绝外键属性类型与 target 主键类型不一致', () => {
    const s = clone();
    // keeperId 改成 number，而 Keeper 主键 id 是 string
    const fk = s.objectTypes[0].properties.find(p => p.apiName === 'keeperId')!;
    fk.type = 'number';
    expect(() => loadOntology(s)).toThrowError(/type/i);
  });

  it('拒绝同一对象类型上的重复遍历名', () => {
    const s = clone();
    s.objectTypes[0].properties.push({ apiName: 'keeper2Id', displayName: '副饲养员', type: 'string', nullable: true });
    s.linkTypes.push({
      apiName: 'caredBy2', displayName: '由…副照料',
      source: 'Animal', target: 'Keeper',
      sourceToTargetName: 'keeper',  // 与 caredBy 撞名
      targetToSourceName: 'animals2',
      cardinality: 'MANY_TO_ONE',
      mapping: { kind: 'foreignKey', property: 'keeper2Id' },
    });
    expect(() => loadOntology(s)).toThrowError(/duplicate traversal/);
  });

  it('titleProperty：指向存在属性通过，指向不存在属性被拒', () => {
    const ok = clone();
    ok.objectTypes[0].titleProperty = 'name';
    expect(() => loadOntology(ok)).not.toThrow();

    const bad = clone();
    bad.objectTypes[0].titleProperty = 'ghostTitle';
    expect(() => loadOntology(bad)).toThrowError(/titleProperty/);
  });

  it('属性 format 引用未注册对象类型被拒', () => {
    const s = clone();
    s.objectTypes[0].properties.push({
      apiName: 'cond', displayName: '条件', type: 'string', nullable: true,
      format: { kind: 'filterExpr', objectType: 'Ghost' },
    });
    expect(() => loadOntology(s)).toThrowError(/Ghost/);
  });

  it('linkByTraverseName 双向解析', () => {
    const reg = loadOntology(zoo);
    const a = reg.linkByTraverseName('Animal', 'keeper');
    expect(a.direction).toBe('sourceToTarget');
    const b = reg.linkByTraverseName('Keeper', 'animals');
    expect(b.direction).toBe('targetToSource');
    expect(() => reg.linkByTraverseName('Animal', 'nope')).toThrowError();
  });
});

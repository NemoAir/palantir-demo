import { describe, it, expect } from 'vitest';
import { loadOntology } from '../src/oms.js';
import { astock } from '../../../ontology/astock.ontology.js';

describe('astock schema', () => {
  it('通过 OMS 校验，注册 6 对象类型 5 链接类型', () => {
    const reg = loadOntology(astock);
    expect(reg.objectTypes().map(o => o.apiName).sort()).toEqual(
      ['Alert', 'Industry', 'Portfolio', 'Position', 'ResearchNote', 'Stock'],
    );
    expect(reg.linkTypes().length).toBe(5);
  });

  it('关键遍历名可双向解析', () => {
    const reg = loadOntology(astock);
    expect(reg.linkByTraverseName('Stock', 'industry').direction).toBe('sourceToTarget');
    expect(reg.linkByTraverseName('Industry', 'stocks').direction).toBe('targetToSource');
    expect(reg.linkByTraverseName('Portfolio', 'positions').direction).toBe('targetToSource');
    expect(reg.linkByTraverseName('Position', 'stock').direction).toBe('sourceToTarget');
  });

  it('PE/PB 为 nullable（科创板含未盈利企业）', () => {
    const reg = loadOntology(astock);
    const pe = reg.objectType('Stock').properties.find(p => p.apiName === 'pe')!;
    expect(pe.nullable).toBe(true);
  });
});

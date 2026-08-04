import { describe, it, expect } from 'vitest';
import { parseFilterExpr } from '../src/filter-parse.js';

describe('parseFilterExpr', () => {
  it('比较/空值/包含语法', () => {
    expect(parseFilterExpr('weightKg<100')).toEqual({ property: 'weightKg', op: 'lt', value: 100 });
    expect(parseFilterExpr('weightKg>=3000')).toEqual({ property: 'weightKg', op: 'gte', value: 3000 });
    expect(parseFilterExpr('name~企')).toEqual({ property: 'name', op: 'contains', value: '企' });
    expect(parseFilterExpr('weightKg=null')).toEqual({ property: 'weightKg', op: 'isNull' });
    expect(parseFilterExpr('weightKg!=null')).toEqual({ property: 'weightKg', op: 'notNull' });
    expect(parseFilterExpr('tag=A1')).toEqual({ property: 'tag', op: 'eq', value: 'A1' });
  });

  it('非法表达式报错', () => {
    expect(() => parseFilterExpr('!!!')).toThrowError(/bad filter/);
    expect(() => parseFilterExpr('weightKg>null')).toThrowError(/null/);
  });
});

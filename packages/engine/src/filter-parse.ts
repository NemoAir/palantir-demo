import type { Filter } from './types.js';

/**
 * 把 "pe<50" / "pe=null" / "pe!=null" / "name~芯" 风格表达式解析为 Filter。
 * 通用字符串→过滤器工具（CLI、条件表达式类属性共用）。
 */
export function parseFilterExpr(expr: string): Filter {
  const m = expr.match(/^(\w+)\s*(!=|>=|<=|=|<|>|~)\s*(.+)$/);
  if (!m) throw new Error(`bad filter expression: ${expr}`);
  const [, property, opRaw, rawValue] = m;
  if (rawValue === 'null') {
    if (opRaw === '=') return { property, op: 'isNull' };
    if (opRaw === '!=') return { property, op: 'notNull' };
    throw new Error(`bad null comparison: ${expr}`);
  }
  const num = Number(rawValue);
  const value = Number.isFinite(num) && rawValue.trim() !== '' ? num : rawValue;
  const op = ({ '=': 'eq', '!=': 'neq', '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte', '~': 'contains' } as const)[opRaw]!;
  return { property, op, value } as Filter;
}

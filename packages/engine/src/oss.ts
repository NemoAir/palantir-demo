import type { ObjectRow, ObjectStore } from './store.js';

export type Filter =
  | { property: string; op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains'; value: string | number | boolean }
  | { property: string; op: 'isNull' | 'notNull' };

const OP_SQL: Record<string, string> = {
  eq: '=', neq: '!=', lt: '<', lte: '<=', gt: '>', gte: '>=',
};

export interface QueryOptions {
  orderBy?: string;
  desc?: boolean;
  limit?: number;
}

export class ObjectSetService {
  constructor(private readonly store: ObjectStore) {}

  private assertProperty(typeApiName: string, property: string): void {
    const ot = this.store.registry.objectType(typeApiName);
    if (!ot.properties.some(p => p.apiName === property))
      throw new Error(`unknown property '${property}' on '${typeApiName}'`);
  }

  query(typeApiName: string, filters: Filter[] = [], opts: QueryOptions = {}): ObjectRow[] {
    const ot = this.store.registry.objectType(typeApiName);
    const where: string[] = [];
    const params: (string | number)[] = [];

    for (const f of filters) {
      this.assertProperty(ot.apiName, f.property);
      if (f.op === 'isNull') where.push(`${f.property} IS NULL`);
      else if (f.op === 'notNull') where.push(`${f.property} IS NOT NULL`);
      else if (f.op === 'contains') {
        where.push(`${f.property} LIKE ?`);
        params.push(`%${String(f.value)}%`);
      } else {
        where.push(`${f.property} ${OP_SQL[f.op]} ?`);
        params.push(typeof f.value === 'boolean' ? (f.value ? 1 : 0) : f.value);
      }
    }

    let sql = `SELECT * FROM obj_${ot.apiName}`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    if (opts.orderBy) {
      this.assertProperty(ot.apiName, opts.orderBy);
      sql += ` ORDER BY ${opts.orderBy}${opts.desc ? ' DESC' : ' ASC'}`;
    }
    if (opts.limit !== undefined) {
      sql += ` LIMIT ?`;
      params.push(opts.limit);
    }
    return this.store.db.prepare(sql).all(...params) as ObjectRow[];
  }

  aggregateCount(typeApiName: string, groupBy: string): { key: string | number | null; count: number }[] {
    const ot = this.store.registry.objectType(typeApiName);
    this.assertProperty(ot.apiName, groupBy);
    const rows = this.store.db
      .prepare(`SELECT ${groupBy} AS key, COUNT(*) AS count FROM obj_${ot.apiName} GROUP BY ${groupBy}`)
      .all() as { key: string | number | null; count: number }[];
    return rows;
  }

  traverse(typeApiName: string, pk: string | number, traverseName: string): ObjectRow[] {
    const { link, direction } = this.store.registry.linkByTraverseName(typeApiName, traverseName);
    if (direction === 'sourceToTarget') {
      // 本对象是 source（多方）：读自身 FK 值 → 取 target 单对象
      const self = this.store.get(link.source, pk);
      if (!self) return [];
      const fkValue = self[link.mapping.property];
      if (fkValue === null || fkValue === undefined) return [];
      const target = this.store.get(link.target, fkValue as string | number);
      return target ? [target] : [];
    }
    // 本对象是 target（一方）：查 source 表 where FK = pk
    return this.store.db
      .prepare(`SELECT * FROM obj_${link.source} WHERE ${link.mapping.property} = ?`)
      .all(pk) as ObjectRow[];
  }
}

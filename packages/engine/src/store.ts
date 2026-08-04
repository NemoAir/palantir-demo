import type Database from 'better-sqlite3';
import type { OntologyRegistry } from './oms.js';
import type { ObjectTypeDef, PropertyType } from './types.js';

export type ObjectRow = Record<string, string | number | boolean | null>;

const SQL_TYPE: Record<PropertyType, string> = {
  string: 'TEXT',
  number: 'REAL',
  boolean: 'INTEGER',
  date: 'TEXT',
};

/** 把 JS 值编码为 SQLite 存储值（boolean → 0/1）。 */
function encode(v: string | number | boolean | null): string | number | null {
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

export class ObjectStore {
  constructor(
    public readonly db: Database.Database,
    public readonly registry: OntologyRegistry,
  ) {}

  /** 元数据驱动 DDL：每对象类型一张表；链接的外键列建索引（遍历走索引）。 */
  init(): void {
    for (const ot of this.registry.objectTypes()) {
      this.db.exec(this.ddlFor(ot));
    }
    for (const link of this.registry.linkTypes()) {
      this.db.exec(
        `CREATE INDEX IF NOT EXISTS idx_${link.source}_${link.mapping.property}
         ON obj_${link.source} (${link.mapping.property})`,
      );
    }
  }

  private ddlFor(ot: ObjectTypeDef): string {
    const cols = ot.properties.map(p => {
      const notNull = p.apiName === ot.primaryKey || !p.nullable ? ' NOT NULL' : '';
      return `${p.apiName} ${SQL_TYPE[p.type]}${notNull}`;
    });
    return `CREATE TABLE IF NOT EXISTS obj_${ot.apiName} (
      ${cols.join(',\n      ')},
      PRIMARY KEY (${ot.primaryKey})
    )`;
  }

  upsertMany(typeApiName: string, rows: ObjectRow[]): { inserted: number; updated: number } {
    const ot = this.registry.objectType(typeApiName); // throws unknown object type
    const propNames = ot.properties.map(p => p.apiName);
    const propSet = new Set(propNames);

    let inserted = 0;
    let updated = 0;
    const exists = this.db.prepare(
      `SELECT 1 FROM obj_${ot.apiName} WHERE ${ot.primaryKey} = ?`,
    );
    const upsert = this.db.prepare(
      `INSERT INTO obj_${ot.apiName} (${propNames.join(', ')})
       VALUES (${propNames.map(n => `@${n}`).join(', ')})
       ON CONFLICT(${ot.primaryKey}) DO UPDATE SET
       ${propNames.filter(n => n !== ot.primaryKey).map(n => `${n} = excluded.${n}`).join(', ')}`,
    );

    const tx = this.db.transaction((batch: ObjectRow[]) => {
      for (const row of batch) {
        for (const key of Object.keys(row)) {
          if (!propSet.has(key)) throw new Error(`unknown property '${key}' on '${ot.apiName}'`);
        }
        const bound: Record<string, string | number | null> = {};
        for (const p of ot.properties) {
          const raw = row[p.apiName] ?? null;
          if (raw === null && !p.nullable && p.apiName !== ot.primaryKey) {
            throw new Error(`property '${p.apiName}' on '${ot.apiName}' is not nullable`);
          }
          if (raw === null && p.apiName === ot.primaryKey) {
            throw new Error(`primary key '${p.apiName}' on '${ot.apiName}' is not nullable`);
          }
          bound[p.apiName] = encode(raw);
        }
        const was = exists.get(bound[ot.primaryKey]);
        upsert.run(bound);
        if (was) updated += 1;
        else inserted += 1;
      }
    });
    tx(rows);
    return { inserted, updated };
  }

  get(typeApiName: string, pk: string | number): ObjectRow | undefined {
    const ot = this.registry.objectType(typeApiName);
    return this.db
      .prepare(`SELECT * FROM obj_${ot.apiName} WHERE ${ot.primaryKey} = ?`)
      .get(pk) as ObjectRow | undefined;
  }

  count(typeApiName: string): number {
    const ot = this.registry.objectType(typeApiName);
    const r = this.db.prepare(`SELECT COUNT(*) AS c FROM obj_${ot.apiName}`).get() as { c: number };
    return r.c;
  }
}

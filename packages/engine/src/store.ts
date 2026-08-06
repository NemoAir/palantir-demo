import type Database from 'better-sqlite3';
import type { OntologyRegistry } from './oms.js';
import type { Edit, ObjectTypeDef, PropertyType, Value } from './types.js';

export type ObjectRow = Record<string, string | number | boolean | null>;

export interface AuditEntry {
  action: string;
  params: Record<string, Value>;
}

export interface AuditRecord extends AuditEntry {
  id: number;
  edits: Edit[];
  at: string;
}

export interface EditRecord {
  objectType: string;
  pk: string;
  property: string;
  kind: 'set' | 'create';
  value: Value | Record<string, Value>;
  editedAt: string;
}

/** create 编辑在 EAV 账本中的 property 占位（真实属性名不可能与之冲突——OMS 禁止非字母开头）。 */
const CREATE_SLOT = '__create__';

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

  /** 元数据驱动 DDL：每对象类型一张表；链接的外键列建索引（遍历走索引）；引擎系统表（账本/审计/通知）。 */
  init(): void {
    for (const ot of this.registry.objectTypes()) {
      this.db.exec(this.ddlFor(ot));
      this.migrateTable(ot);
    }
    for (const link of this.registry.linkTypes()) {
      this.db.exec(
        `CREATE INDEX IF NOT EXISTS idx_${link.source}_${link.mapping.property}
         ON obj_${link.source} (${link.mapping.property})`,
      );
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS object_edits (
      objectType TEXT NOT NULL,
      pk TEXT NOT NULL,
      property TEXT NOT NULL,
      kind TEXT NOT NULL,
      value_json TEXT,
      edited_at TEXT NOT NULL,
      PRIMARY KEY (objectType, pk, property)
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      params_json TEXT NOT NULL,
      edits_json TEXT NOT NULL,
      at TEXT NOT NULL
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message TEXT NOT NULL,
      at TEXT NOT NULL
    )`);
    // 轻量迁移：旧库补 link_json 列（重复执行会报"duplicate column"，忽略即可）
    try {
      this.db.exec(`ALTER TABLE notifications ADD COLUMN link_json TEXT`);
    } catch {
      /* 列已存在 */
    }
  }

  /**
   * 原子应用一批 edits（Action 提交的唯一入口）：
   * 同事务 ① 写物化表（读己之写）② upsert EAV 账本（重物化重放源）③ 落审计。
   * 任一 edit 非法则整批回滚。
   */
  applyEdits(edits: Edit[], audit: AuditEntry): void {
    const now = new Date().toISOString();
    const upsertLedger = this.db.prepare(
      `INSERT INTO object_edits (objectType, pk, property, kind, value_json, edited_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(objectType, pk, property) DO UPDATE SET
         kind = excluded.kind, value_json = excluded.value_json, edited_at = excluded.edited_at`,
    );
    const tx = this.db.transaction(() => {
      for (const e of edits) {
        const ot = this.registry.objectType(e.objectType);
        if (e.kind === 'set') {
          const prop = ot.properties.find(p => p.apiName === e.property);
          if (!prop) throw new Error(`unknown property '${e.property}' on '${ot.apiName}'`);
          if (e.value === null && (!prop.nullable || prop.apiName === ot.primaryKey))
            throw new Error(`property '${e.property}' on '${ot.apiName}' is not nullable`);
          const res = this.db
            .prepare(`UPDATE obj_${ot.apiName} SET ${prop.apiName} = ? WHERE ${ot.primaryKey} = ?`)
            .run(encode(e.value), e.pk);
          if (res.changes === 0)
            throw new Error(`object '${e.pk}' of type '${ot.apiName}' does not exist`);
          upsertLedger.run(ot.apiName, String(e.pk), prop.apiName, 'set', JSON.stringify(e.value), now);
        } else {
          this.insertRow(ot, e.values); // 完整行校验 + INSERT（已存在则主键冲突报错）
          upsertLedger.run(ot.apiName, String(e.pk), CREATE_SLOT, 'create', JSON.stringify(e.values), now);
        }
      }
      this.db
        .prepare(`INSERT INTO audit_log (action, params_json, edits_json, at) VALUES (?, ?, ?, ?)`)
        .run(audit.action, JSON.stringify(audit.params), JSON.stringify(edits), now);
    });
    tx();
  }

  /** Funnel 重物化后调用：按时间序重放该类型账本（create 重建、set 覆盖）→ Apply User Edits。 */
  replayEdits(typeApiName: string): void {
    const ot = this.registry.objectType(typeApiName);
    const rows = this.db
      .prepare(`SELECT * FROM object_edits WHERE objectType = ? ORDER BY edited_at, rowid`)
      .all(ot.apiName) as { pk: string; property: string; kind: string; value_json: string }[];
    const tx = this.db.transaction(() => {
      for (const r of rows) {
        if (r.kind === 'create') {
          const values = JSON.parse(r.value_json) as Record<string, Value>;
          const exists = this.get(ot.apiName, r.pk);
          if (!exists) this.insertRow(ot, values);
        } else {
          const prop = ot.properties.find(p => p.apiName === r.property);
          if (!prop) continue; // schema 演进后已删除的属性：跳过
          this.db
            .prepare(`UPDATE obj_${ot.apiName} SET ${prop.apiName} = ? WHERE ${ot.primaryKey} = ?`)
            .run(encode(JSON.parse(r.value_json) as Value), r.pk);
        }
      }
    });
    tx();
  }

  editsFor(typeApiName: string): EditRecord[] {
    const ot = this.registry.objectType(typeApiName);
    const rows = this.db
      .prepare(`SELECT * FROM object_edits WHERE objectType = ? ORDER BY edited_at, rowid`)
      .all(ot.apiName) as { objectType: string; pk: string; property: string; kind: 'set' | 'create'; value_json: string; edited_at: string }[];
    return rows.map(r => ({
      objectType: r.objectType, pk: r.pk, property: r.property, kind: r.kind,
      value: JSON.parse(r.value_json) as Value | Record<string, Value>, editedAt: r.edited_at,
    }));
  }

  listAudit(limit = 50, offset = 0): AuditRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(limit, offset) as { id: number; action: string; params_json: string; edits_json: string; at: string }[];
    return rows.map(r => ({
      id: r.id, action: r.action, at: r.at,
      params: JSON.parse(r.params_json) as Record<string, Value>,
      edits: JSON.parse(r.edits_json) as Edit[],
    }));
  }

  addNotification(message: string, link?: { objectType: string; pk: string | number }): void {
    this.db
      .prepare(`INSERT INTO notifications (message, at, link_json) VALUES (?, ?, ?)`)
      .run(message, new Date().toISOString(), link ? JSON.stringify(link) : null);
  }

  listNotifications(limit = 50, offset = 0): { id: number; message: string; at: string; link?: { objectType: string; pk: string | number } }[] {
    const rows = this.db
      .prepare(`SELECT * FROM notifications ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(limit, offset) as { id: number; message: string; at: string; link_json: string | null }[];
    return rows.map(r => ({
      id: r.id, message: r.message, at: r.at,
      ...(r.link_json ? { link: JSON.parse(r.link_json) as { objectType: string; pk: string | number } } : {}),
    }));
  }

  /** 完整行校验 + INSERT（供 create 编辑与重放复用）。 */
  private insertRow(ot: ObjectTypeDef, values: Record<string, Value>): void {
    const propSet = new Set(ot.properties.map(p => p.apiName));
    for (const key of Object.keys(values)) {
      if (!propSet.has(key)) throw new Error(`unknown property '${key}' on '${ot.apiName}'`);
    }
    const bound: Record<string, string | number | null> = {};
    for (const p of ot.properties) {
      const raw = values[p.apiName] ?? null;
      if (raw === null && (!p.nullable || p.apiName === ot.primaryKey))
        throw new Error(`property '${p.apiName}' on '${ot.apiName}' is not nullable`);
      bound[p.apiName] = encode(raw);
    }
    const propNames = ot.properties.map(p => p.apiName);
    this.db
      .prepare(`INSERT INTO obj_${ot.apiName} (${propNames.join(', ')}) VALUES (${propNames.map(n => `@${n}`).join(', ')})`)
      .run(bound);
  }

  /**
   * 本体演进的轻量迁移：schema 新增的 nullable 属性自动 ALTER 补列（现存行取值 NULL）。
   * 纯编辑型对象没有重物化兜底，全靠这里。非空新列无法安全补默认值（不造数），
   * 指名报错，让调用方走回填/重建流程。标识符均来自已过 OMS 防线的注册元数据。
   */
  private migrateTable(ot: ObjectTypeDef): void {
    const existing = new Set(
      (this.db.prepare(`PRAGMA table_info(obj_${ot.apiName})`).all() as { name: string }[]).map(c => c.name),
    );
    for (const p of ot.properties) {
      if (existing.has(p.apiName)) continue;
      if (p.apiName === ot.primaryKey || !p.nullable)
        throw new Error(
          `cannot auto-migrate: new property '${p.apiName}' on '${ot.apiName}' is NOT NULL (backfill/rebuild required)`,
        );
      this.db.exec(`ALTER TABLE obj_${ot.apiName} ADD COLUMN ${p.apiName} ${SQL_TYPE[p.type]}`);
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

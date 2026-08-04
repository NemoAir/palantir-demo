import Database from 'better-sqlite3';
import { loadOntology } from './oms.js';
import { ObjectStore } from './store.js';
import type { OntologySchema } from './types.js';

/** 一步打开对象库：加载校验 schema → 打开/建库 → 建表。SDK/应用层的标准入口。 */
export function openStore(schema: OntologySchema, dbPath: string): ObjectStore {
  const store = new ObjectStore(new Database(dbPath), loadOntology(schema));
  store.init();
  return store;
}

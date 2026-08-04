import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { loadOntology } from './src/oms.js';
import { ObjectStore } from './src/store.js';
import { materializeAll } from './src/funnel.js';
import { ObjectSetService } from './src/oss.js';
import { parseFilterExpr } from './src/filter-parse.js';
import { astock } from '../../ontology/astock.ontology.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB_PATH = join(root, 'ontology.db');
const DATASETS = join(root, 'datasets');

function open(): { store: ObjectStore; oss: ObjectSetService } {
  const store = new ObjectStore(new Database(DB_PATH), loadOntology(astock));
  store.init();
  return { store, oss: new ObjectSetService(store) };
}

const [cmd, ...rest] = process.argv.slice(2);

switch (cmd) {
  case 'load': {
    const reg = loadOntology(astock);
    console.log(`本体: ${reg.schema.displayName} (${reg.schema.apiName})`);
    console.log(`对象类型 ${reg.objectTypes().length} 个:`);
    for (const ot of reg.objectTypes()) {
      const ds = ot.datasource ? `datasource=${ot.datasource.path}` : '纯编辑型';
      console.log(`  - ${ot.apiName}（${ot.displayName}）属性 ${ot.properties.length} 个, 主键 ${ot.primaryKey}, ${ds}`);
    }
    console.log(`链接类型 ${reg.linkTypes().length} 个:`);
    for (const lt of reg.linkTypes())
      console.log(`  - ${lt.apiName}: ${lt.source} --${lt.sourceToTargetName}--> ${lt.target} (反向 ${lt.targetToSourceName})`);
    break;
  }
  case 'materialize': {
    const { store } = open();
    for (const r of materializeAll(store, DATASETS)) {
      console.log(`${r.objectType}: 共 ${r.totalRows} 行 → 新增 ${r.inserted} 更新 ${r.updated}`);
      for (const s of r.skipped) console.log(`  [跳过] 第 ${s.row} 行: ${s.reason}`);
      for (const n of r.nulled) console.log(`  [置空] 第 ${n.row} 行 ${n.property}='${n.raw}'`);
    }
    break;
  }
  case 'query': {
    const { values, positionals } = parseArgs({
      args: rest, allowPositionals: true,
      options: { where: { type: 'string', multiple: true }, 'order-by': { type: 'string' }, desc: { type: 'boolean' }, limit: { type: 'string' } },
    });
    const { oss } = open();
    const rows = oss.query(positionals[0], (values.where ?? []).map(parseFilterExpr), {
      orderBy: values['order-by'], desc: values.desc, limit: values.limit ? Number(values.limit) : undefined,
    });
    console.table(rows);
    console.log(`${rows.length} 行`);
    break;
  }
  case 'get': {
    const { store } = open();
    console.log(store.get(rest[0], rest[1]) ?? '(不存在)');
    break;
  }
  case 'traverse': {
    const { oss } = open();
    console.table(oss.traverse(rest[0], rest[1], rest[2]));
    break;
  }
  case 'count': {
    const { values, positionals } = parseArgs({
      args: rest, allowPositionals: true, options: { by: { type: 'string' } },
    });
    const { store, oss } = open();
    if (values.by) console.table(oss.aggregateCount(positionals[0], values.by));
    else console.log(store.count(positionals[0]));
    break;
  }
  default:
    console.log(`用法: pnpm cli <load|materialize|query|get|traverse|count>
  load                                    查看本体注册摘要
  materialize                             物化 datasets/ 全部数据集（含报告）
  query <Type> [--where "pe<50"]... [--order-by pe] [--desc] [--limit 10]
  get <Type> <主键>
  traverse <Type> <主键> <遍历名>          如 traverse Stock 688981 industry
  count <Type> [--by <属性>]`);
}

import type { ObjectTypeDef, OntologySchema, PropertyType } from './types.js';

/**
 * OSDK 复刻：从本体 schema 生成类型化 TypeScript 客户端源码。
 * 生成物用"业务自身的语言"（对象/动作名）编程，属性拼错在编译期报错。
 * 生成器本身题材无关——它只读元数据。
 */

const TS_TYPE: Record<PropertyType, string> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  date: 'string',
};

const pascal = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function propTs(name: string, type: PropertyType, nullable: boolean | undefined): string {
  return `  ${name}: ${TS_TYPE[type]}${nullable ? ' | null' : ''};`;
}

export interface CodegenOptions {
  /** 生成文件到 engine src 目录的相对 import 前缀（如 '../../src' 或 '../packages/engine/src'） */
  enginePath: string;
}

export function generateClient(schema: OntologySchema, opts: CodegenOptions): string {
  const e = opts.enginePath;
  const lines: string[] = [];
  const w = (s = ''): void => { lines.push(s); };

  w(`// 自动生成：本体 '${schema.apiName}' 的类型化客户端（engine codegen）。不要手改——重新生成覆盖。`);
  w(`import { openStore } from '${e}/open.js';`);
  w(`import { type ObjectRow } from '${e}/store.js';`);
  w(`import { ObjectSetService } from '${e}/oss.js';`);
  w(`import { ActionService, type ActionResult } from '${e}/actions.js';`);
  w(`import { FunctionService } from '${e}/functions.js';`);
  w(`import type { Filter, QueryOptions, OntologySchema, Value } from '${e}/types.js';`);
  w();
  w(`export type { ActionResult };`);
  w();

  // 对象类型 interface + boolean 解码器（SQLite 布尔存 0/1，SDK 层还原业务类型）
  for (const ot of schema.objectTypes) {
    w(`/** ${ot.displayName} */`);
    w(`export interface ${ot.apiName} {`);
    for (const p of ot.properties) w(propTs(p.apiName, p.type, p.nullable));
    w(`}`);
    w();
  }

  // 属性名字面量化的过滤/排序类型（编译期锁定属性名——OSDK 防线的关键一环）
  for (const ot of schema.objectTypes) {
    const propUnion = ot.properties.map(p => `'${p.apiName}'`).join(' | ');
    w(`export type ${ot.apiName}Filter =`);
    w(`  | { property: ${propUnion}; op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains'; value: string | number | boolean }`);
    w(`  | { property: ${propUnion}; op: 'isNull' | 'notNull' };`);
    w(`export interface ${ot.apiName}QueryOptions { orderBy?: ${propUnion}; desc?: boolean; limit?: number; }`);
    w();
  }

  for (const ot of schema.objectTypes) {
    const boolProps = ot.properties.filter(p => p.type === 'boolean');
    w(`function decode${ot.apiName}(row: ObjectRow): ${ot.apiName} {`);
    if (boolProps.length === 0) {
      w(`  return row as unknown as ${ot.apiName};`);
    } else {
      w(`  const out = { ...row } as Record<string, unknown>;`);
      for (const p of boolProps)
        w(`  if (out.${p.apiName} !== null && out.${p.apiName} !== undefined) out.${p.apiName} = out.${p.apiName} === 1 || out.${p.apiName} === true;`);
      w(`  return out as unknown as ${ot.apiName};`);
    }
    w(`}`);
    w();
  }

  // Action 参数 interface
  for (const a of schema.actionTypes ?? []) {
    w(`/** ${a.displayName} 的参数 */`);
    w(`export interface ${pascal(a.apiName)}Params {`);
    for (const p of a.parameters) w(`  ${p.apiName}${p.required === false ? '?' : ''}: ${TS_TYPE[p.type]};`);
    w(`}`);
    w();
  }

  // 每对象类型的遍历名字面量联合
  const traverseNames = new Map<string, string[]>();
  for (const lt of schema.linkTypes) {
    traverseNames.set(lt.source, [...(traverseNames.get(lt.source) ?? []), lt.sourceToTargetName]);
    traverseNames.set(lt.target, [...(traverseNames.get(lt.target) ?? []), lt.targetToSourceName]);
  }

  w(`export function createClient(schema: OntologySchema, dbPath: string) {`);
  w(`  const store = openStore(schema, dbPath);`);
  w(`  const oss = new ObjectSetService(store);`);
  w(`  const actionSvc = new ActionService(store);`);
  w(`  const fnSvc = new FunctionService(store);`);
  w(`  return {`);
  w(`    store,`);
  w(`    objects: {`);
  for (const ot of schema.objectTypes) {
    const pkProp = ot.properties.find(p => p.apiName === ot.primaryKey)!;
    const pkTs = TS_TYPE[pkProp.type];
    const names = traverseNames.get(ot.apiName) ?? [];
    const linkUnion = names.length ? names.map(n => `'${n}'`).join(' | ') : 'never';
    w(`      ${ot.apiName}: {`);
    w(`        query(filters?: ${ot.apiName}Filter[], opts?: ${ot.apiName}QueryOptions): ${ot.apiName}[] {`);
    w(`          return oss.query('${ot.apiName}', filters as Filter[] | undefined, opts as QueryOptions | undefined).map(decode${ot.apiName});`);
    w(`        },`);
    w(`        get(pk: ${pkTs}): ${ot.apiName} | undefined {`);
    w(`          const row = store.get('${ot.apiName}', pk);`);
    w(`          return row ? decode${ot.apiName}(row) : undefined;`);
    w(`        },`);
    w(`        traverse(pk: ${pkTs}, link: ${linkUnion}): ObjectRow[] {`);
    w(`          return oss.traverse('${ot.apiName}', pk, link);`);
    w(`        },`);
    w(`        count(): number { return store.count('${ot.apiName}'); },`);
    w(`      },`);
  }
  w(`    },`);
  w(`    actions: {`);
  for (const a of schema.actionTypes ?? []) {
    w(`      /** ${a.displayName} */`);
    w(`      ${a.apiName}(params: ${pascal(a.apiName)}Params): ActionResult {`);
    w(`        return actionSvc.execute('${a.apiName}', params as unknown as Record<string, Value>);`);
    w(`      },`);
  }
  w(`    },`);
  w(`    functions: {`);
  for (const f of schema.functions ?? []) {
    w(`      /** ${f.displayName} */`);
    w(`      ${f.apiName}(params: Record<string, Value>): unknown { return fnSvc.call('${f.apiName}', params); },`);
  }
  w(`    },`);
  w(`  };`);
  w(`}`);
  w();
  return lines.join('\n');
}

import type { ObjectStore } from './store.js';
import { ObjectSetService } from './oss.js';
import { ActionService } from './actions.js';
import { FunctionService } from './functions.js';
import { parseFilterExpr } from './filter-parse.js';
import type { PropertyType, Value } from './types.js';

/**
 * OAG（Ontology-Augmented Generation）复刻：把本体的数据/逻辑/行动原语
 * 暴露为 AI 可调用的工具集。schema 驱动零胶水——新增 Action/Function，
 * 工具列表自动多一个；AI 的每次写入照走 Action 管线（criteria/审计不因调用者是 AI 而放松）。
 * 题材无关：一切从 OMS 元数据生成。协议接线（MCP/其他）由外层薄壳完成。
 */

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required: string[];
  };
}

const JSON_TYPE: Record<PropertyType, string> = {
  string: 'string', number: 'number', boolean: 'boolean', date: 'string',
};

export function buildTools(store: ObjectStore): {
  tools: ToolDef[];
  call: (name: string, args: Record<string, unknown>) => unknown;
} {
  const registry = store.registry;
  const oss = new ObjectSetService(store);
  const actions = new ActionService(store);
  const fns = new FunctionService(store);

  const typeNames = registry.objectTypes().map(o => o.apiName).join(' | ');

  const tools: ToolDef[] = [
    {
      name: 'query_objects',
      description: `查询本体对象集。type 可选：${typeNames}。where 为过滤表达式数组（如 "pe<50"、"pe!=null"、"name~芯"）。`,
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', description: '对象类型 apiName' },
          where: { type: 'array' as unknown as string, description: '过滤表达式数组（可选）' },
          orderBy: { type: 'string', description: '排序属性（可选）' },
          desc: { type: 'boolean', description: '降序（可选）' },
          limit: { type: 'number', description: '条数上限（可选）' },
        },
        required: ['type'],
      },
    },
    {
      name: 'get_object',
      description: `按主键取单个对象。type 可选：${typeNames}。`,
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string' }, pk: { type: 'string', description: '主键值' },
        },
        required: ['type', 'pk'],
      },
    },
    {
      name: 'traverse_link',
      description: `沿链接遍历相关对象（如 Stock 的 industry/positions/researchNotes/alerts）。`,
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string' }, pk: { type: 'string' },
          link: { type: 'string', description: '遍历名（见 schema 的链接定义）' },
        },
        required: ['type', 'pk', 'link'],
      },
    },
    {
      name: 'aggregate_count',
      description: '按属性分组计数。',
      inputSchema: {
        type: 'object',
        properties: { type: { type: 'string' }, by: { type: 'string', description: '分组属性' } },
        required: ['type', 'by'],
      },
    },
    {
      name: 'list_audit',
      description: '查看审计流（最近的决策记录，含 Action 名/参数/编辑数）。',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number' } },
        required: [],
      },
    },
  ];

  /** ParamDef[] → JSON Schema（editor 元数据转成 enum 约束与引用说明）。 */
  const paramsToSchema = (params: readonly import('./types.js').ParamDef[]): { properties: ToolDef['inputSchema']['properties']; required: string[] } => {
    const properties: ToolDef['inputSchema']['properties'] = {};
    const required: string[] = [];
    for (const p of params) {
      let description = p.displayName;
      let enumValues: string[] | undefined;
      if (p.editor?.kind === 'enum') {
        enumValues = p.editor.options.map(o => o.value);
      } else if (p.editor?.kind === 'objectRef') {
        description += `（${p.editor.objectType} 对象的主键，可先用 query_objects 查找）`;
      } else if (p.editor?.kind === 'filterExpr') {
        description += `（过滤表达式，只能引用 ${p.editor.objectType} 的注册属性，如 "latestPrice<100"）`;
      }
      properties[p.apiName] = { type: JSON_TYPE[p.type], description, ...(enumValues ? { enum: enumValues } : {}) };
      if (p.required !== false) required.push(p.apiName);
    }
    return { properties, required };
  };

  // 每个 Action → 一个工具（写路径，照走完整治理管线）
  for (const a of registry.actionTypes()) {
    const { properties, required } = paramsToSchema(a.parameters);
    const criteriaDesc = a.criteria.map(c => c.displayName).join('、');
    tools.push({
      name: `action_${a.apiName}`,
      description: `执行 Action「${a.displayName}」（受治理写操作，提交前提：${criteriaDesc || '无'}；不满足会结构化拒绝且不落库）。`,
      inputSchema: { type: 'object', properties, required },
    });
  }

  // 每个 Function → 一个工具（只读逻辑；有参数声明则给出精确 schema）
  for (const f of registry.functions()) {
    const { properties, required } = paramsToSchema(f.parameters ?? []);
    tools.push({
      name: `fn_${f.apiName}`,
      description: `调用本体函数「${f.displayName}」（只读计算）。`,
      inputSchema: { type: 'object', properties, required },
    });
  }

  const call = (name: string, args: Record<string, unknown>): unknown => {
    if (name === 'query_objects') {
      const where = ((args.where as string[] | undefined) ?? []).map(parseFilterExpr);
      return oss.query(String(args.type), where, {
        orderBy: args.orderBy as string | undefined,
        desc: Boolean(args.desc),
        limit: args.limit === undefined ? undefined : Number(args.limit),
      });
    }
    if (name === 'get_object') return store.get(String(args.type), String(args.pk)) ?? null;
    if (name === 'traverse_link') return oss.traverse(String(args.type), String(args.pk), String(args.link));
    if (name === 'aggregate_count') return oss.aggregateCount(String(args.type), String(args.by));
    if (name === 'list_audit') return store.listAudit(args.limit === undefined ? 20 : Number(args.limit));
    if (name.startsWith('action_')) return actions.execute(name.slice('action_'.length), args as Record<string, Value>);
    if (name.startsWith('fn_')) return fns.call(name.slice('fn_'.length), args as Record<string, Value>);
    throw new Error(`unknown tool: ${name}`);
  };

  return { tools, call };
}

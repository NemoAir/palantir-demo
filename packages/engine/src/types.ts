/** 属性值类型。date 以 ISO 字符串存取。 */
export type PropertyType = 'string' | 'number' | 'boolean' | 'date';

export interface PropertyDef {
  apiName: string;
  displayName: string;
  type: PropertyType;
  /** 默认 false。主键属性必须为非 nullable（OMS 校验）。 */
  nullable?: boolean;
  /**
   * 受限取值集（含展示标签与色调）。消费端据此渲染徽章/下拉；
   * tone 为通用视觉语义：up/down（涨跌向）、info/danger/muted。
   */
  enumOptions?: { value: string; label: string; tone?: 'up' | 'down' | 'info' | 'danger' | 'muted' }[];
  /** 内容格式提示：filterExpr = 该属性存的是过滤表达式（引用 objectType 的注册属性），消费端可解析后可读化展示。 */
  format?: { kind: 'filterExpr'; objectType: string };
}

export interface CsvDatasource {
  kind: 'csv';
  /** 相对 datasets 目录的文件名，如 'animals.csv' */
  path: string;
}

export interface ObjectTypeDef {
  apiName: string;
  displayName: string;
  /** 必须指向 properties 中的一个非 nullable 属性 */
  primaryKey: string;
  /** 标题属性：实例的人类可读名（如名称列）。消费端在展示外键/引用时可据此把主键值翻成名字。 */
  titleProperty?: string;
  properties: PropertyDef[];
  /** 无 datasource 的类型为纯编辑型（M2 起才有对象产生），M1 仅建空表 */
  datasource?: CsvDatasource;
}

export interface LinkTypeDef {
  apiName: string;
  displayName: string;
  /** 外键所在侧（多方） */
  source: string;
  /** 被指向侧（一方） */
  target: string;
  /** 从 source 对象遍历到 target 的名字，如 'keeper' */
  sourceToTargetName: string;
  /** 从 target 对象反向遍历到 source 集合的名字，如 'animals' */
  targetToSourceName: string;
  /** v1 仅外键型多对一；多对多（dataset 支撑）超出 M1 范围 */
  cardinality: 'MANY_TO_ONE';
  mapping: {
    kind: 'foreignKey';
    /** source 类型上存放 target 主键值的属性 apiName */
    property: string;
  };
}

/* ============ 动能层（M2）：查询过滤 / 编辑 / Action / Function ============ */

/** 对象属性值。 */
export type Value = string | number | boolean | null;

/** OSS 查询过滤条件（底座类型，oss.ts re-export 以兼容既有 import）。 */
export type Filter =
  | { property: string; op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains'; value: string | number | boolean }
  | { property: string; op: 'isNull' | 'notNull' };

export interface QueryOptions {
  orderBy?: string;
  desc?: boolean;
  limit?: number;
}

/** Action 产出的编辑单元：set=改既有对象属性；create=创建纯编辑型对象。 */
export type Edit =
  | { kind: 'set'; objectType: string; pk: string | number; property: string; value: Value }
  | { kind: 'create'; objectType: string; pk: string | number; values: Record<string, Value> };

export interface SideEffect {
  kind: 'notification';
  message: string;
  /** 可选：通知关联的对象（消费端可据此提供点击直达）。 */
  link?: { objectType: string; pk: string | number };
}

/** 提供给 criteria/apply/function 的只读上下文（读走合并后的物化态）。 */
export interface ReadonlyContext {
  get(objectType: string, pk: string | number): Record<string, Value> | undefined;
  query(objectType: string, filters?: Filter[], opts?: QueryOptions): Record<string, Value>[];
}

/**
 * 参数编辑器元数据：声明参数"怎么填"，各消费端按此渲染——
 * UI 渲染下拉/搜索选择器/条件构造器，AI 工具获得枚举与引用说明。
 */
export type ParamEditor =
  | { kind: 'enum'; options: { value: string; label: string }[] }
  /** 引用某对象类型的实例（按主键）——UI 渲染搜索点选 */
  | { kind: 'objectRef'; objectType: string }
  /** 过滤表达式（filter-parse 语法），只能引用该对象类型的注册属性——UI 渲染条件构造器 */
  | { kind: 'filterExpr'; objectType: string };

export interface ParamDef {
  apiName: string;
  displayName: string;
  type: PropertyType;
  /** 默认必填；显式 false 才可缺省。 */
  required?: boolean;
  editor?: ParamEditor;
  /**
   * 参考值提示：本参数与"另一参数(fromParam)所指 objectType 实例"的 property 相关。
   * 消费端可实时展示该属性现值供参考/一键填入（如成交价旁显示最新价）。
   */
  hint?: { fromParam: string; objectType: string; property: string };
}

/** 提交前提：全部通过才允许应用 edits；失败时引擎报出 apiName 与 message。 */
export interface CriterionDef {
  apiName: string;
  displayName: string;
  message: string;
  check(ctx: ReadonlyContext, params: Record<string, Value>): boolean;
}

/** Action 类型：受治理写操作的 schema（参数/前提/编辑规则/副作用）。 */
export interface ActionTypeDef {
  apiName: string;
  displayName: string;
  /** 一句话说明"这个动词是干嘛的、什么时候用"——各消费端（UI/AI 工具）展示。 */
  docs?: string;
  /** 系统 Action：由自动化/AI 流程调用（如巡逻触发），UI 折叠展示、不进常用面板。 */
  system?: boolean;
  parameters: ParamDef[];
  criteria: CriterionDef[];
  /** 纯函数：产出本次要应用的 edits，不直接写库（写入由引擎原子提交）。 */
  apply(ctx: ReadonlyContext, params: Record<string, Value>): Edit[];
  sideEffects?(ctx: ReadonlyContext, params: Record<string, Value>, edits: Edit[]): SideEffect[];
}

/** Function：本体原生只读逻辑（算不做——写入必须经 Action）。 */
export interface FunctionDef {
  apiName: string;
  displayName: string;
  /** 一句话说明"这个函数算什么、为什么要跑"——各消费端展示。 */
  docs?: string;
  /**
   * 结果键的展示名（apiName→人类可读）。返回值是自由形状，schema 管不到——
   * 由函数自己声明；消费端渲染时优先用它，其次查对象属性 displayName，最后原样。
   */
  resultLabels?: Record<string, string>;
  /** 参数声明（可选）：供 UI 表单与 AI 工具描述使用；运行时传参仍为宽松对象。 */
  parameters?: ParamDef[];
  logic(ctx: ReadonlyContext, params: Record<string, Value>): unknown;
}

export interface OntologySchema {
  apiName: string;
  displayName: string;
  objectTypes: ObjectTypeDef[];
  linkTypes: LinkTypeDef[];
  actionTypes?: ActionTypeDef[];
  functions?: FunctionDef[];
}

/** 恒等函数：让 schema 文件获得完整类型检查与编辑器提示。 */
export function defineOntology(schema: OntologySchema): OntologySchema {
  return schema;
}

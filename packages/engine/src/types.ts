/** 属性值类型。date 以 ISO 字符串存取。 */
export type PropertyType = 'string' | 'number' | 'boolean' | 'date';

export interface PropertyDef {
  apiName: string;
  displayName: string;
  type: PropertyType;
  /** 默认 false。主键属性必须为非 nullable（OMS 校验）。 */
  nullable?: boolean;
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
}

/** 提供给 criteria/apply/function 的只读上下文（读走合并后的物化态）。 */
export interface ReadonlyContext {
  get(objectType: string, pk: string | number): Record<string, Value> | undefined;
  query(objectType: string, filters?: Filter[], opts?: QueryOptions): Record<string, Value>[];
}

export interface ParamDef {
  apiName: string;
  displayName: string;
  type: PropertyType;
  /** 默认必填；显式 false 才可缺省。 */
  required?: boolean;
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

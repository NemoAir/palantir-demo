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

export interface OntologySchema {
  apiName: string;
  displayName: string;
  objectTypes: ObjectTypeDef[];
  linkTypes: LinkTypeDef[];
}

/** 恒等函数：让 schema 文件获得完整类型检查与编辑器提示。 */
export function defineOntology(schema: OntologySchema): OntologySchema {
  return schema;
}

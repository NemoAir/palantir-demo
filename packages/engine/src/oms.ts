import type { ActionTypeDef, FunctionDef, LinkTypeDef, ObjectTypeDef, OntologySchema } from './types.js';

const API_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export class OntologyValidationError extends Error {
  constructor(public path: string, message: string) {
    super(`[${path}] ${message}`);
    this.name = 'OntologyValidationError';
  }
}

export class OntologyRegistry {
  private objTypes = new Map<string, ObjectTypeDef>();
  private links: LinkTypeDef[] = [];
  private actions = new Map<string, ActionTypeDef>();
  private fns = new Map<string, FunctionDef>();

  constructor(public readonly schema: OntologySchema) {
    for (const ot of schema.objectTypes) this.objTypes.set(ot.apiName, ot);
    this.links = [...schema.linkTypes];
    for (const a of schema.actionTypes ?? []) this.actions.set(a.apiName, a);
    for (const f of schema.functions ?? []) this.fns.set(f.apiName, f);
  }

  actionType(apiName: string): ActionTypeDef {
    const a = this.actions.get(apiName);
    if (!a) throw new Error(`unknown action type: ${apiName}`);
    return a;
  }

  actionTypes(): ActionTypeDef[] {
    return [...this.actions.values()];
  }

  functionDef(apiName: string): FunctionDef {
    const f = this.fns.get(apiName);
    if (!f) throw new Error(`unknown function: ${apiName}`);
    return f;
  }

  functions(): FunctionDef[] {
    return [...this.fns.values()];
  }

  objectType(apiName: string): ObjectTypeDef {
    const ot = this.objTypes.get(apiName);
    if (!ot) throw new Error(`unknown object type: ${apiName}`);
    return ot;
  }

  objectTypes(): ObjectTypeDef[] {
    return [...this.objTypes.values()];
  }

  linkTypes(): LinkTypeDef[] {
    return [...this.links];
  }

  linkByTraverseName(
    objectType: string,
    name: string,
  ): { link: LinkTypeDef; direction: 'sourceToTarget' | 'targetToSource' } {
    for (const link of this.links) {
      if (link.source === objectType && link.sourceToTargetName === name)
        return { link, direction: 'sourceToTarget' };
      if (link.target === objectType && link.targetToSourceName === name)
        return { link, direction: 'targetToSource' };
    }
    throw new Error(`no traversal '${name}' from object type '${objectType}'`);
  }
}

function assertApiName(path: string, value: string): void {
  if (!API_NAME_RE.test(value))
    throw new OntologyValidationError(path, `invalid apiName '${value}' (must match ${API_NAME_RE})`);
}

export function loadOntology(schema: OntologySchema): OntologyRegistry {
  assertApiName('apiName', schema.apiName);

  const seenTypes = new Set<string>();
  for (const ot of schema.objectTypes) {
    const base = `objectTypes.${ot.apiName}`;
    assertApiName(base, ot.apiName);
    if (seenTypes.has(ot.apiName))
      throw new OntologyValidationError(base, `duplicate object type '${ot.apiName}'`);
    seenTypes.add(ot.apiName);

    const seenProps = new Set<string>();
    for (const p of ot.properties) {
      const ppath = `${base}.properties.${p.apiName}`;
      assertApiName(ppath, p.apiName);
      if (seenProps.has(p.apiName))
        throw new OntologyValidationError(ppath, `duplicate property '${p.apiName}'`);
      seenProps.add(p.apiName);
    }

    const pk = ot.properties.find(p => p.apiName === ot.primaryKey);
    if (!pk)
      throw new OntologyValidationError(`${base}.primaryKey`, `primaryKey '${ot.primaryKey}' not found in properties`);
    if (pk.nullable)
      throw new OntologyValidationError(`${base}.primaryKey`, `primaryKey '${ot.primaryKey}' must not be nullable`);
  }

  const typeMap = new Map(schema.objectTypes.map(ot => [ot.apiName, ot]));
  const seenLinks = new Set<string>();
  for (const link of schema.linkTypes) {
    const base = `linkTypes.${link.apiName}`;
    assertApiName(base, link.apiName);
    assertApiName(`${base}.sourceToTargetName`, link.sourceToTargetName);
    assertApiName(`${base}.targetToSourceName`, link.targetToSourceName);
    if (seenLinks.has(link.apiName))
      throw new OntologyValidationError(base, `duplicate link type '${link.apiName}'`);
    seenLinks.add(link.apiName);

    const source = typeMap.get(link.source);
    if (!source) throw new OntologyValidationError(`${base}.source`, `unknown object type '${link.source}'`);
    const target = typeMap.get(link.target);
    if (!target) throw new OntologyValidationError(`${base}.target`, `unknown object type '${link.target}'`);

    const fk = source.properties.find(p => p.apiName === link.mapping.property);
    if (!fk)
      throw new OntologyValidationError(`${base}.mapping.property`, `property '${link.mapping.property}' not found on '${link.source}'`);
    const targetPk = target.properties.find(p => p.apiName === target.primaryKey)!;
    if (fk.type !== targetPk.type)
      throw new OntologyValidationError(
        `${base}.mapping.property`,
        `foreign key type '${fk.type}' does not match target primary key type '${targetPk.type}'`,
      );
  }

  // 动能层校验：action / function 的 apiName 合法且去重；action 参数与 criteria 各自去重
  const seenActions = new Set<string>();
  for (const a of schema.actionTypes ?? []) {
    const base = `actionTypes.${a.apiName}`;
    assertApiName(base, a.apiName);
    if (seenActions.has(a.apiName))
      throw new OntologyValidationError(base, `duplicate action type '${a.apiName}'`);
    seenActions.add(a.apiName);

    const seenParams = new Set<string>();
    for (const p of a.parameters) {
      assertApiName(`${base}.parameters.${p.apiName}`, p.apiName);
      if (seenParams.has(p.apiName))
        throw new OntologyValidationError(`${base}.parameters.${p.apiName}`, `duplicate parameter '${p.apiName}'`);
      seenParams.add(p.apiName);
    }

    const seenCriteria = new Set<string>();
    for (const c of a.criteria) {
      assertApiName(`${base}.criteria.${c.apiName}`, c.apiName);
      if (seenCriteria.has(c.apiName))
        throw new OntologyValidationError(`${base}.criteria.${c.apiName}`, `duplicate criterion '${c.apiName}'`);
      seenCriteria.add(c.apiName);
    }
  }

  const seenFns = new Set<string>();
  for (const f of schema.functions ?? []) {
    const base = `functions.${f.apiName}`;
    assertApiName(base, f.apiName);
    if (seenFns.has(f.apiName))
      throw new OntologyValidationError(base, `duplicate function '${f.apiName}'`);
    seenFns.add(f.apiName);
  }

  // 同一对象类型上的遍历名必须唯一（一个类型挂多条链接时，出/入遍历名不得撞名）
  const traverseNames = new Map<string, Set<string>>();
  const addTraverse = (typeName: string, name: string, path: string) => {
    let set = traverseNames.get(typeName);
    if (!set) { set = new Set(); traverseNames.set(typeName, set); }
    if (set.has(name))
      throw new OntologyValidationError(path, `duplicate traversal name '${name}' on object type '${typeName}'`);
    set.add(name);
  };
  for (const link of schema.linkTypes) {
    addTraverse(link.source, link.sourceToTargetName, `linkTypes.${link.apiName}.sourceToTargetName`);
    addTraverse(link.target, link.targetToSourceName, `linkTypes.${link.apiName}.targetToSourceName`);
  }

  return new OntologyRegistry(schema);
}

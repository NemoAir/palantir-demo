import { describe, it, expect } from 'vitest';
import { loadOntology, OntologyValidationError } from '../src/oms.js';
import { zoo } from './fixtures/zoo.js';
import type { OntologySchema } from '../src/types.js';

const clone = (): OntologySchema => ({
  ...zoo,
  objectTypes: structuredClone(zoo.objectTypes),
  linkTypes: structuredClone(zoo.linkTypes),
  actionTypes: zoo.actionTypes ? [...zoo.actionTypes] : undefined,
  functions: zoo.functions ? [...zoo.functions] : undefined,
});

describe('OMS 动能层扩展', () => {
  it('注册 action/function，可按名取回', () => {
    const reg = loadOntology(zoo);
    expect(reg.actionTypes().length).toBe(1);
    expect(reg.actionType('feedAnimal').displayName).toBe('投喂');
    expect(reg.functions().length).toBe(1);
    expect(reg.functionDef('heaviestAnimal').displayName).toBe('最重动物');
    expect(() => reg.actionType('nope')).toThrowError(/unknown action/);
    expect(() => reg.functionDef('nope')).toThrowError(/unknown function/);
  });

  it('拒绝非法 action apiName 与重复注册', () => {
    const s1 = clone();
    s1.actionTypes = [{ ...s1.actionTypes![0], apiName: 'bad name!' }];
    expect(() => loadOntology(s1)).toThrowError(OntologyValidationError);

    const s2 = clone();
    s2.actionTypes = [s2.actionTypes![0], s2.actionTypes![0]];
    expect(() => loadOntology(s2)).toThrowError(/duplicate action/);
  });

  it('拒绝 action 参数重名与非法参数名', () => {
    const base = clone().actionTypes![0];
    const s = clone();
    s.actionTypes = [{
      ...base,
      parameters: [...base.parameters, { ...base.parameters[0] }],
    }];
    expect(() => loadOntology(s)).toThrowError(/duplicate parameter/);
  });

  it('拒绝 action 内 criteria 重名', () => {
    const base = clone().actionTypes![0];
    const s = clone();
    s.actionTypes = [{ ...base, criteria: [...base.criteria, { ...base.criteria[0] }] }];
    expect(() => loadOntology(s)).toThrowError(/duplicate criterion/);
  });
});

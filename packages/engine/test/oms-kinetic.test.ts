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

  it('参数 editor：objectRef/filterExpr 指向未注册类型被拒，enum 空选项被拒', () => {
    const base = clone().actionTypes![0];
    const withEditor = (editor: unknown) => {
      const s = clone();
      s.actionTypes = [{
        ...base,
        parameters: [{ ...base.parameters[0], editor: editor as never }, base.parameters[1]],
      }];
      return s;
    };
    expect(() => loadOntology(withEditor({ kind: 'objectRef', objectType: 'Ghost' }))).toThrowError(/Ghost/);
    expect(() => loadOntology(withEditor({ kind: 'filterExpr', objectType: 'Ghost' }))).toThrowError(/Ghost/);
    expect(() => loadOntology(withEditor({ kind: 'enum', options: [] }))).toThrowError(/enum/);
    // 合法的通过
    expect(() => loadOntology(withEditor({ kind: 'objectRef', objectType: 'Keeper' }))).not.toThrow();
  });

  it('参数 hint：fromParam 必须是同 Action 的参数、引用的类型与属性必须存在', () => {
    const base = clone().actionTypes![0];
    const withHint = (hint: unknown) => {
      const s = clone();
      s.actionTypes = [{
        ...base,
        parameters: [base.parameters[0], { ...base.parameters[1], hint: hint as never }],
      }];
      return s;
    };
    expect(() => loadOntology(withHint({ fromParam: 'ghost', objectType: 'Keeper', property: 'id' }))).toThrowError(/fromParam/);
    expect(() => loadOntology(withHint({ fromParam: 'tag', objectType: 'Ghost', property: 'x' }))).toThrowError(/Ghost/);
    expect(() => loadOntology(withHint({ fromParam: 'tag', objectType: 'Animal', property: 'ghostProp' }))).toThrowError(/ghostProp/);
    expect(() => loadOntology(withHint({ fromParam: 'tag', objectType: 'Animal', property: 'weightKg' }))).not.toThrow();
  });

  it('Function 可声明 parameters（含 editor），注册后可取回', () => {
    const s = clone();
    s.functions = [{
      ...s.functions![0],
      parameters: [{ apiName: 'minWeight', displayName: '最小体重', type: 'number', required: false }],
    }];
    const reg = loadOntology(s);
    expect(reg.functionDef('heaviestAnimal').parameters?.[0].apiName).toBe('minWeight');
  });
});

import { defineOntology } from '../../src/types.js';
import type { Edit } from '../../src/types.js';

/** 题材无关测试本体：动物园。引擎测试禁用金融词汇（题材无关约束的自我验证）。 */
export const zoo = defineOntology({
  apiName: 'zoo',
  displayName: '动物园',
  objectTypes: [
    {
      apiName: 'Animal',
      displayName: '动物',
      primaryKey: 'tag',
      properties: [
        { apiName: 'tag', displayName: '编号', type: 'string' },
        { apiName: 'name', displayName: '名字', type: 'string' },
        { apiName: 'weightKg', displayName: '体重', type: 'number', nullable: true },
        { apiName: 'keeperId', displayName: '饲养员ID', type: 'string', nullable: true },
        // 编辑属性：CSV 无此列（Funnel 应报 missingColumns 而非 nulled），值只由 Action 编辑产生
        { apiName: 'mood', displayName: '情绪', type: 'string', nullable: true },
      ],
      datasource: { kind: 'csv', path: 'animals.csv' },
    },
    {
      apiName: 'Keeper',
      displayName: '饲养员',
      primaryKey: 'id',
      properties: [
        { apiName: 'id', displayName: 'ID', type: 'string' },
        { apiName: 'fullName', displayName: '姓名', type: 'string' },
      ],
      datasource: { kind: 'csv', path: 'keepers.csv' },
    },
    {
      apiName: 'Note',
      displayName: '观察笔记',
      primaryKey: 'noteId',
      properties: [
        { apiName: 'noteId', displayName: '笔记ID', type: 'string' },
        { apiName: 'text', displayName: '内容', type: 'string' },
      ],
      // 无 datasource：纯编辑型
    },
  ],
  linkTypes: [
    {
      apiName: 'caredBy',
      displayName: '由…照料',
      source: 'Animal',
      target: 'Keeper',
      sourceToTargetName: 'keeper',
      targetToSourceName: 'animals',
      cardinality: 'MANY_TO_ONE',
      mapping: { kind: 'foreignKey', property: 'keeperId' },
    },
  ],
  actionTypes: [
    {
      apiName: 'feedAnimal',
      displayName: '投喂',
      parameters: [
        { apiName: 'tag', displayName: '动物编号', type: 'string' },
        { apiName: 'foodKg', displayName: '投喂量(kg)', type: 'number' },
      ],
      criteria: [
        {
          apiName: 'animalExists',
          displayName: '动物存在',
          message: '找不到该编号的动物',
          check: (ctx, p) => ctx.get('Animal', p.tag as string) !== undefined,
        },
        {
          apiName: 'foodAmountPositive',
          displayName: '投喂量为正',
          message: '投喂量必须大于 0',
          check: (_ctx, p) => (p.foodKg as number) > 0,
        },
      ],
      apply: (ctx, p): Edit[] => {
        const animal = ctx.get('Animal', p.tag as string)!;
        const current = (animal.weightKg as number | null) ?? 0;
        return [{
          kind: 'set', objectType: 'Animal', pk: p.tag as string,
          property: 'weightKg', value: current + (p.foodKg as number),
        }];
      },
      sideEffects: (_ctx, p) => [{ kind: 'notification', message: `已投喂 ${p.tag} ${p.foodKg}kg` }],
    },
  ],
  functions: [
    {
      apiName: 'heaviestAnimal',
      displayName: '最重动物',
      logic: (ctx) => ctx.query('Animal', [], { orderBy: 'weightKg', desc: true, limit: 1 })[0] ?? null,
    },
  ],
});

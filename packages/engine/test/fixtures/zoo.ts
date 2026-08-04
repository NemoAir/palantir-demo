import { defineOntology } from '../../src/types.js';

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
});

import { defineOntology } from '../packages/engine/src/types.js';
import { astockActions } from './astock.actions.js';
import { astockFunctions } from './astock.functions.js';

/**
 * A股投研运营台本体 v1（语义层 + 动能层）。
 * 数据域：科创板50 成分股。
 * 语义元素：6 对象类型 + 5 链接类型（企业的"名词"）；
 * 动能元素：6 Action + 3 Function（企业的"动词"，见 astock.actions/functions）。
 */
export const astock = defineOntology({
  apiName: 'astock',
  displayName: 'A股投研运营台',
  objectTypes: [
    {
      apiName: 'Stock',
      displayName: '股票',
      primaryKey: 'code',
      properties: [
        { apiName: 'code', displayName: '股票代码', type: 'string' },
        { apiName: 'name', displayName: '名称', type: 'string' },
        { apiName: 'industryCode', displayName: '行业代码', type: 'string', nullable: true },
        { apiName: 'latestPrice', displayName: '最新价', type: 'number', nullable: true },
        { apiName: 'marketCapYi', displayName: '总市值(亿)', type: 'number', nullable: true },
        { apiName: 'pe', displayName: '市盈率PE(TTM)', type: 'number', nullable: true },
        { apiName: 'pb', displayName: '市净率PB', type: 'number', nullable: true },
        // 编辑属性：CSV 无此列（Funnel 报 missingColumns），值只由 addToWatchlist Action 产生
        { apiName: 'isWatched', displayName: '自选', type: 'boolean', nullable: true },
      ],
      datasource: { kind: 'csv', path: 'stocks.csv' },
    },
    {
      apiName: 'Industry',
      displayName: '申万一级行业',
      primaryKey: 'code',
      properties: [
        { apiName: 'code', displayName: '行业代码', type: 'string' },
        { apiName: 'name', displayName: '行业名称', type: 'string' },
      ],
      datasource: { kind: 'csv', path: 'industries.csv' },
    },
    {
      apiName: 'Portfolio',
      displayName: '模拟组合',
      primaryKey: 'id',
      properties: [
        { apiName: 'id', displayName: '组合ID', type: 'string' },
        { apiName: 'name', displayName: '组合名称', type: 'string' },
        { apiName: 'initialCash', displayName: '初始资金', type: 'number' },
        { apiName: 'cash', displayName: '现金余额', type: 'number' },
      ],
      datasource: { kind: 'csv', path: 'portfolios.csv' },
    },
    {
      apiName: 'Position',
      displayName: '持仓',
      primaryKey: 'id',
      properties: [
        { apiName: 'id', displayName: '持仓ID', type: 'string' },
        { apiName: 'portfolioId', displayName: '组合ID', type: 'string' },
        { apiName: 'stockCode', displayName: '股票代码', type: 'string' },
        { apiName: 'quantity', displayName: '数量(股)', type: 'number' },
        { apiName: 'costPrice', displayName: '成本价', type: 'number' },
      ],
      datasource: { kind: 'csv', path: 'positions.csv' },
    },
    {
      apiName: 'ResearchNote',
      displayName: '研判笔记',
      primaryKey: 'id',
      properties: [
        { apiName: 'id', displayName: '笔记ID', type: 'string' },
        { apiName: 'stockCode', displayName: '股票代码', type: 'string' },
        { apiName: 'stance', displayName: '结论', type: 'string' },
        { apiName: 'reason', displayName: '理由', type: 'string' },
        { apiName: 'createdAt', displayName: '创建时间', type: 'date' },
      ],
      // 纯编辑型：M2 由 writeResearchNote Action 创建
    },
    {
      apiName: 'Alert',
      displayName: '预警规则',
      primaryKey: 'id',
      properties: [
        { apiName: 'id', displayName: '预警ID', type: 'string' },
        { apiName: 'stockCode', displayName: '股票代码', type: 'string' },
        { apiName: 'condition', displayName: '条件表达式', type: 'string' },
        { apiName: 'status', displayName: '状态', type: 'string' },
        { apiName: 'createdAt', displayName: '创建时间', type: 'date' },
      ],
      // 纯编辑型：M2 由 setAlert Action 创建
    },
  ],
  linkTypes: [
    {
      apiName: 'stockInIndustry',
      displayName: '属于行业',
      source: 'Stock',
      target: 'Industry',
      sourceToTargetName: 'industry',
      targetToSourceName: 'stocks',
      cardinality: 'MANY_TO_ONE',
      mapping: { kind: 'foreignKey', property: 'industryCode' },
    },
    {
      apiName: 'positionInPortfolio',
      displayName: '属于组合',
      source: 'Position',
      target: 'Portfolio',
      sourceToTargetName: 'portfolio',
      targetToSourceName: 'positions',
      cardinality: 'MANY_TO_ONE',
      mapping: { kind: 'foreignKey', property: 'portfolioId' },
    },
    {
      apiName: 'positionOfStock',
      displayName: '持仓对应股票',
      source: 'Position',
      target: 'Stock',
      sourceToTargetName: 'stock',
      targetToSourceName: 'positions',
      cardinality: 'MANY_TO_ONE',
      mapping: { kind: 'foreignKey', property: 'stockCode' },
    },
    {
      apiName: 'noteAboutStock',
      displayName: '研判关于股票',
      source: 'ResearchNote',
      target: 'Stock',
      sourceToTargetName: 'stock',
      targetToSourceName: 'researchNotes',
      cardinality: 'MANY_TO_ONE',
      mapping: { kind: 'foreignKey', property: 'stockCode' },
    },
    {
      apiName: 'alertOnStock',
      displayName: '预警盯住股票',
      source: 'Alert',
      target: 'Stock',
      sourceToTargetName: 'stock',
      targetToSourceName: 'alerts',
      cardinality: 'MANY_TO_ONE',
      mapping: { kind: 'foreignKey', property: 'stockCode' },
    },
  ],
  actionTypes: astockActions,
  functions: astockFunctions,
});

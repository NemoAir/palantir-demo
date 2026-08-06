import type { ActionTypeDef, Edit, ReadonlyContext, Value } from '../packages/engine/src/types.js';
import { parseFilterExpr } from '../packages/engine/src/filter-parse.js';

/** 金额圆整到分（浮点误差防线）。 */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** 组合内某股的持仓行 ID（一组合一股一行）。 */
const positionId = (portfolioId: string, stockCode: string): string => `POS-${portfolioId}-${stockCode}`;

/** 按前缀数一数已有对象，生成递增 ID（单机确定性够用）。 */
const nextId = (ctx: ReadonlyContext, objectType: string, prefix: string): string =>
  `${prefix}-${ctx.query(objectType).length + 1}`;

/** Alert 条件表达式对指定股票求值（条件语法同 CLI where，如 latestPrice<150）。 */
const conditionHits = (ctx: ReadonlyContext, condition: string, stockCode: string): boolean => {
  const filter = parseFilterExpr(condition);
  return ctx.query('Stock', [filter, { property: 'code', op: 'eq', value: stockCode }], { limit: 1 }).length > 0;
};

export const astockActions: ActionTypeDef[] = [
  {
    apiName: 'addToWatchlist',
    displayName: '加自选',
    parameters: [{ apiName: 'stockCode', displayName: '股票', type: 'string', editor: { kind: 'objectRef', objectType: 'Stock' } }],
    criteria: [
      {
        apiName: 'stockExists', displayName: '股票存在', message: '找不到该股票',
        check: (ctx, p) => ctx.get('Stock', p.stockCode as string) !== undefined,
      },
      {
        apiName: 'notYetWatched', displayName: '尚未自选', message: '该股票已在自选中',
        check: (ctx, p) => {
          const watched = ctx.get('Stock', p.stockCode as string)?.isWatched;
          return watched !== true && watched !== 1;
        },
      },
    ],
    apply: (_ctx, p): Edit[] => [
      { kind: 'set', objectType: 'Stock', pk: p.stockCode as string, property: 'isWatched', value: true },
    ],
    sideEffects: (ctx, p) => [
      { kind: 'notification', message: `已将 ${ctx.get('Stock', p.stockCode as string)?.name}(${p.stockCode}) 加入自选` },
    ],
  },
  {
    apiName: 'tradeStock',
    displayName: '模拟调仓',
    parameters: [
      { apiName: 'portfolioId', displayName: '组合', type: 'string', editor: { kind: 'objectRef', objectType: 'Portfolio' } },
      { apiName: 'stockCode', displayName: '股票', type: 'string', editor: { kind: 'objectRef', objectType: 'Stock' } },
      { apiName: 'side', displayName: '方向', type: 'string', editor: { kind: 'enum', options: [{ value: 'buy', label: '买入' }, { value: 'sell', label: '卖出' }] } },
      { apiName: 'quantity', displayName: '数量(股)', type: 'number' },
      { apiName: 'price', displayName: '成交价', type: 'number' },
    ],
    criteria: [
      {
        apiName: 'portfolioExists', displayName: '组合存在', message: '找不到该组合',
        check: (ctx, p) => ctx.get('Portfolio', p.portfolioId as string) !== undefined,
      },
      {
        apiName: 'stockExists', displayName: '股票存在', message: '找不到该股票',
        check: (ctx, p) => ctx.get('Stock', p.stockCode as string) !== undefined,
      },
      {
        apiName: 'sideValid', displayName: '方向合法', message: 'side 只能是 buy 或 sell',
        check: (_ctx, p) => p.side === 'buy' || p.side === 'sell',
      },
      {
        apiName: 'quantityPositive', displayName: '数量为正', message: '数量必须大于 0',
        check: (_ctx, p) => (p.quantity as number) > 0,
      },
      {
        apiName: 'pricePositive', displayName: '价格为正', message: '价格必须大于 0',
        check: (_ctx, p) => (p.price as number) > 0,
      },
      {
        apiName: 'cashSufficient', displayName: '现金充足', message: '现金余额不足以完成买入',
        check: (ctx, p) => {
          if (p.side !== 'buy') return true;
          const cash = (ctx.get('Portfolio', p.portfolioId as string)?.cash as number) ?? 0;
          return cash >= round2((p.quantity as number) * (p.price as number));
        },
      },
      {
        apiName: 'positionSufficient', displayName: '持仓充足', message: '持仓数量不足以完成卖出',
        check: (ctx, p) => {
          if (p.side !== 'sell') return true;
          const pos = ctx.get('Position', positionId(p.portfolioId as string, p.stockCode as string));
          return ((pos?.quantity as number) ?? 0) >= (p.quantity as number);
        },
      },
    ],
    apply: (ctx, p): Edit[] => {
      const pid = p.portfolioId as string;
      const code = p.stockCode as string;
      const qty = p.quantity as number;
      const price = p.price as number;
      const amount = round2(qty * price);
      const cash = ctx.get('Portfolio', pid)!.cash as number;
      const posId = positionId(pid, code);
      const pos = ctx.get('Position', posId);
      const edits: Edit[] = [];

      if (p.side === 'buy') {
        if (pos) {
          const oldQty = pos.quantity as number;
          const oldCost = pos.costPrice as number;
          const newQty = oldQty + qty;
          const newCost = round2((oldQty * oldCost + qty * price) / newQty);
          edits.push({ kind: 'set', objectType: 'Position', pk: posId, property: 'quantity', value: newQty });
          edits.push({ kind: 'set', objectType: 'Position', pk: posId, property: 'costPrice', value: newCost });
        } else {
          edits.push({
            kind: 'create', objectType: 'Position', pk: posId,
            values: { id: posId, portfolioId: pid, stockCode: code, quantity: qty, costPrice: price },
          });
        }
        edits.push({ kind: 'set', objectType: 'Portfolio', pk: pid, property: 'cash', value: round2(cash - amount) });
      } else {
        const newQty = (pos!.quantity as number) - qty;
        edits.push({ kind: 'set', objectType: 'Position', pk: posId, property: 'quantity', value: newQty });
        edits.push({ kind: 'set', objectType: 'Portfolio', pk: pid, property: 'cash', value: round2(cash + amount) });
      }
      return edits;
    },
    sideEffects: (ctx, p) => [
      {
        kind: 'notification',
        message: `${p.side === 'buy' ? '买入' : '卖出'} ${ctx.get('Stock', p.stockCode as string)?.name}(${p.stockCode}) ${p.quantity}股 @ ${p.price}`,
      },
    ],
  },
  {
    apiName: 'writeResearchNote',
    displayName: '写研判',
    parameters: [
      { apiName: 'stockCode', displayName: '股票', type: 'string', editor: { kind: 'objectRef', objectType: 'Stock' } },
      { apiName: 'stance', displayName: '结论', type: 'string', editor: { kind: 'enum', options: [{ value: '看多', label: '看多' }, { value: '看空', label: '看空' }, { value: '中性', label: '中性' }] } },
      { apiName: 'reason', displayName: '理由', type: 'string' },
    ],
    criteria: [
      {
        apiName: 'stockExists', displayName: '股票存在', message: '找不到该股票',
        check: (ctx, p) => ctx.get('Stock', p.stockCode as string) !== undefined,
      },
      {
        apiName: 'stanceValid', displayName: '结论合法', message: '结论只能是 看多/看空/中性',
        check: (_ctx, p) => ['看多', '看空', '中性'].includes(p.stance as string),
      },
    ],
    apply: (ctx, p): Edit[] => {
      const id = nextId(ctx, 'ResearchNote', 'RN');
      return [{
        kind: 'create', objectType: 'ResearchNote', pk: id,
        values: {
          id, stockCode: p.stockCode as string, stance: p.stance as string,
          reason: p.reason as string, createdAt: new Date().toISOString(),
        },
      }];
    },
  },
  {
    apiName: 'setAlert',
    displayName: '设预警',
    parameters: [
      { apiName: 'stockCode', displayName: '股票', type: 'string', editor: { kind: 'objectRef', objectType: 'Stock' } },
      { apiName: 'condition', displayName: '触发条件', type: 'string', editor: { kind: 'filterExpr', objectType: 'Stock' } },
    ],
    criteria: [
      {
        apiName: 'stockExists', displayName: '股票存在', message: '找不到该股票',
        check: (ctx, p) => ctx.get('Stock', p.stockCode as string) !== undefined,
      },
      {
        apiName: 'conditionValid', displayName: '条件合法', message: '条件表达式无法解析（示例：latestPrice<150）',
        check: (ctx, p) => {
          try {
            conditionHits(ctx, p.condition as string, p.stockCode as string);
            return true;
          } catch {
            return false;
          }
        },
      },
    ],
    apply: (ctx, p): Edit[] => {
      const id = nextId(ctx, 'Alert', 'AL');
      return [{
        kind: 'create', objectType: 'Alert', pk: id,
        values: {
          id, stockCode: p.stockCode as string, condition: p.condition as string,
          status: 'armed', createdAt: new Date().toISOString(),
        },
      }];
    },
  },
  {
    apiName: 'resolveAlert',
    displayName: '处理预警',
    parameters: [{ apiName: 'alertId', displayName: '预警', type: 'string', editor: { kind: 'objectRef', objectType: 'Alert' } }],
    criteria: [
      {
        apiName: 'alertExists', displayName: '预警存在', message: '找不到该预警',
        check: (ctx, p) => ctx.get('Alert', p.alertId as string) !== undefined,
      },
      {
        apiName: 'alertTriggered', displayName: '处于触发态', message: '只有已触发的预警可以标记处理',
        check: (ctx, p) => ctx.get('Alert', p.alertId as string)?.status === 'triggered',
      },
    ],
    apply: (_ctx, p): Edit[] => [
      { kind: 'set', objectType: 'Alert', pk: p.alertId as string, property: 'status', value: 'resolved' },
    ],
    sideEffects: (_ctx, p) => [{ kind: 'notification', message: `预警 ${p.alertId} 已处理` }],
  },
  {
    // 系统 Action：由 checkAlerts 的调用方（自动化/AI）触发，
    // 走完整管线（criteria/审计/副作用）——Foundry 自动化同样经 Action 写回。
    apiName: 'markAlertTriggered',
    displayName: '标记预警触发',
    system: true,
    parameters: [{ apiName: 'alertId', displayName: '预警', type: 'string', editor: { kind: 'objectRef', objectType: 'Alert' } }],
    criteria: [
      {
        apiName: 'alertExists', displayName: '预警存在', message: '找不到该预警',
        check: (ctx, p) => ctx.get('Alert', p.alertId as string) !== undefined,
      },
      {
        apiName: 'alertArmed', displayName: '处于待命态', message: '只有待命中的预警可被触发',
        check: (ctx, p) => ctx.get('Alert', p.alertId as string)?.status === 'armed',
      },
      {
        apiName: 'conditionMet', displayName: '条件满足', message: '该预警的条件当前并不满足',
        check: (ctx, p) => {
          const alert = ctx.get('Alert', p.alertId as string);
          if (!alert) return false;
          return conditionHits(ctx, alert.condition as string, alert.stockCode as string);
        },
      },
    ],
    apply: (_ctx, p): Edit[] => [
      { kind: 'set', objectType: 'Alert', pk: p.alertId as string, property: 'status', value: 'triggered' },
    ],
    sideEffects: (ctx, p) => {
      const alert = ctx.get('Alert', p.alertId as string)!;
      return [{ kind: 'notification', message: `预警触发：${alert.stockCode} 满足 ${alert.condition}` }];
    },
  },
];

export type { Value };

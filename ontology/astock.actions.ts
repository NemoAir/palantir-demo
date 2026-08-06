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
    apiName: 'createPortfolio',
    displayName: '新建组合',
    docs: '开一个新的模拟组合（虚拟资金账户）。后续的调仓、估值、盈亏都以组合为单位进行。',
    parameters: [
      { apiName: 'name', displayName: '组合名称', type: 'string' },
      { apiName: 'initialCash', displayName: '初始资金', type: 'number' },
    ],
    criteria: [
      {
        apiName: 'nameNotEmpty', displayName: '名称非空', message: '组合名称不能为空',
        check: (_ctx, p) => String(p.name ?? '').trim().length > 0,
      },
      {
        apiName: 'cashPositive', displayName: '资金为正', message: '初始资金必须大于 0',
        check: (_ctx, p) => (p.initialCash as number) > 0,
      },
    ],
    apply: (ctx, p): Edit[] => {
      const id = `P${ctx.query('Portfolio').length + 1}`;
      return [{
        kind: 'create', objectType: 'Portfolio', pk: id,
        values: { id, name: String(p.name).trim(), initialCash: p.initialCash, cash: p.initialCash },
      }];
    },
    sideEffects: (_ctx, p, edits) => [{
      kind: 'notification',
      message: `已新建组合「${String(p.name).trim()}」`,
      link: { objectType: 'Portfolio', pk: edits[0].pk },
    }],
  },
  {
    apiName: 'updateResearchNote',
    displayName: '改研判',
    docs: '修改已有研判笔记。研判是活文档——观点变了就更新，改动同样过治理管线、留审计。',
    parameters: [
      { apiName: 'noteId', displayName: '研判笔记', type: 'string', editor: { kind: 'objectRef', objectType: 'ResearchNote' } },
      { apiName: 'stance', displayName: '结论', type: 'string', editor: { kind: 'enum', options: [{ value: '看多', label: '看多' }, { value: '看空', label: '看空' }, { value: '中性', label: '中性' }] } },
      { apiName: 'reason', displayName: '理由', type: 'string' },
    ],
    criteria: [
      {
        apiName: 'noteExists', displayName: '笔记存在', message: '找不到该研判笔记',
        check: (ctx, p) => ctx.get('ResearchNote', p.noteId as string) !== undefined,
      },
      {
        apiName: 'stanceValid', displayName: '结论合法', message: '结论只能是 看多/看空/中性',
        check: (_ctx, p) => ['看多', '看空', '中性'].includes(p.stance as string),
      },
    ],
    apply: (_ctx, p): Edit[] => [
      { kind: 'set', objectType: 'ResearchNote', pk: p.noteId as string, property: 'stance', value: p.stance },
      { kind: 'set', objectType: 'ResearchNote', pk: p.noteId as string, property: 'reason', value: p.reason },
    ],
  },
  {
    apiName: 'addToWatchlist',
    displayName: '加自选',
    docs: '把某只股票标记为自选（isWatched=true）——最小的一次"编辑属性"写入示例。',
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
      {
        kind: 'notification',
        message: `已将 ${ctx.get('Stock', p.stockCode as string)?.name}(${p.stockCode}) 加入自选`,
        link: { objectType: 'Stock', pk: p.stockCode as string },
      },
    ],
  },
  {
    apiName: 'tradeStock',
    displayName: '模拟调仓',
    docs: '在模拟组合内买入/卖出一只股票：先校验现金或持仓是否足够，再原子更新持仓与现金余额。',
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
        link: { objectType: 'Stock', pk: p.stockCode as string },
      },
    ],
  },
  {
    apiName: 'writeResearchNote',
    displayName: '写研判',
    docs: '对某只股票记录你的投资观点（看多/看空/中性 + 理由），沉淀为可追溯的决策依据。',
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
    docs: '给股票挂一个盯盘条件（如 latestPrice<150）。挂上后处于待命(armed)，由"预警扫描"巡逻发现是否满足。',
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
    docs: '把已触发(triggered)的预警标记为已处理(resolved)——人工认领并关闭这单提醒。',
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
    sideEffects: (_ctx, p) => [{ kind: 'notification', message: `预警 ${p.alertId} 已处理`, link: { objectType: 'Alert', pk: p.alertId as string } }],
  },
  {
    // 系统 Action：由 checkAlerts 的调用方（自动化/AI）触发，
    // 走完整管线（criteria/审计/副作用）——Foundry 自动化同样经 Action 写回。
    apiName: 'markAlertTriggered',
    displayName: '标记预警触发',
    docs: '【系统动词】"预警扫描"发现条件满足后，由自动化调用本动词把状态落账为 triggered——发现与落账分离，落账才进审计。',
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
      return [{ kind: 'notification', message: `预警触发：${alert.stockCode} 满足 ${alert.condition}`, link: { objectType: 'Alert', pk: p.alertId as string } }];
    },
  },
];

export type { Value };

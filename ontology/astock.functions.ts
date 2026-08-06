import type { FunctionDef } from '../packages/engine/src/types.js';
import { parseFilterExpr } from '../packages/engine/src/filter-parse.js';

const round2 = (n: number): number => Math.round(n * 100) / 100;

export const astockFunctions: FunctionDef[] = [
  {
    apiName: 'portfolioValuation',
    displayName: '组合估值',
    docs: '把组合的现金、每笔持仓的市值与盈亏，按最新行情算成一张估值快照——调仓前看它、复盘看它。做成 Function 的意义：UI/CLI/AI 谁来问都是同一套口径。',
    resultLabels: {
      portfolioId: '组合ID', name: '名称', cash: '现金', totalMarketValue: '持仓市值',
      totalAssets: '总资产', totalPnl: '浮动盈亏', positions: '持仓明细',
      stockCode: '股票代码', quantity: '数量(股)', costPrice: '成本价',
      latestPrice: '最新价', marketValue: '市值', pnl: '盈亏',
    },
    parameters: [{ apiName: 'portfolioId', displayName: '组合', type: 'string', editor: { kind: 'objectRef', objectType: 'Portfolio' } }],
    logic: (ctx, params) => {
      const pid = params.portfolioId as string;
      const portfolio = ctx.get('Portfolio', pid);
      if (!portfolio) throw new Error(`portfolio '${pid}' not found`);
      const positions = ctx
        .query('Position', [
          { property: 'portfolioId', op: 'eq', value: pid },
          { property: 'quantity', op: 'gt', value: 0 },
        ])
        .map(pos => {
          const stock = ctx.get('Stock', pos.stockCode as string);
          const qty = pos.quantity as number;
          const cost = pos.costPrice as number;
          const price = (stock?.latestPrice as number | null) ?? null;
          const marketValue = price === null ? null : round2(qty * price);
          const pnl = price === null ? null : round2((price - cost) * qty);
          return {
            stockCode: pos.stockCode, name: stock?.name ?? null,
            quantity: qty, costPrice: cost, latestPrice: price, marketValue, pnl,
          };
        });
      const totalMarketValue = round2(positions.reduce((s, p) => s + (p.marketValue ?? 0), 0));
      const cash = portfolio.cash as number;
      return {
        portfolioId: pid,
        name: portfolio.name,
        cash,
        totalMarketValue,
        totalAssets: round2(cash + totalMarketValue),
        totalPnl: round2(positions.reduce((s, p) => s + (p.pnl ?? 0), 0)),
        positions,
      };
    },
  },
  {
    apiName: 'screenStocks',
    displayName: '条件选股',
    docs: '按条件筛出股票清单。保存的是"条件"而非"名单"（动态对象集）——每次运行都在最新数据上重算。',
    parameters: [{ apiName: 'where', displayName: '筛选条件', type: 'string', editor: { kind: 'filterExpr', objectType: 'Stock' } }],
    logic: (ctx, params) => {
      // 动态对象集：保存的是条件而非名单——每次求值都在最新数据上重算
      const exprs = String(params.where ?? '').split(',').map(s => s.trim()).filter(Boolean);
      const filters = exprs.map(parseFilterExpr);
      return ctx.query('Stock', filters, { orderBy: 'marketCapYi', desc: true });
    },
  },
  {
    apiName: 'checkAlerts',
    displayName: '预警扫描',
    docs: '巡逻员：逐个核对待命(armed)预警的条件是否已被最新行情满足，返回命中清单。只有眼睛没有手——发现不等于落账，落账走系统动词"标记预警触发"。',
    resultLabels: { alertId: '预警ID', stockCode: '股票代码', condition: '条件表达式' },
    parameters: [],
    logic: (ctx) => {
      // 只读扫描：返回条件命中的待命预警；状态写入由调用方经 markAlertTriggered（Action）完成
      const armed = ctx.query('Alert', [{ property: 'status', op: 'eq', value: 'armed' }]);
      const hits: { alertId: string; stockCode: string; condition: string }[] = [];
      for (const a of armed) {
        try {
          const filter = parseFilterExpr(a.condition as string);
          const matched = ctx.query('Stock', [filter, { property: 'code', op: 'eq', value: a.stockCode as string }], { limit: 1 });
          if (matched.length > 0)
            hits.push({ alertId: a.id as string, stockCode: a.stockCode as string, condition: a.condition as string });
        } catch {
          // 条件表达式解析失败的历史脏数据：跳过（setAlert 的 conditionValid 已挡新增）
        }
      }
      return hits;
    },
  },
];

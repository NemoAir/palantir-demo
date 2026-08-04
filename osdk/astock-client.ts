// 自动生成：本体 'astock' 的类型化客户端（engine codegen）。不要手改——重新生成覆盖。
import { openStore } from '../packages/engine/src/open.js';
import { type ObjectRow } from '../packages/engine/src/store.js';
import { ObjectSetService } from '../packages/engine/src/oss.js';
import { ActionService, type ActionResult } from '../packages/engine/src/actions.js';
import { FunctionService } from '../packages/engine/src/functions.js';
import type { Filter, QueryOptions, OntologySchema, Value } from '../packages/engine/src/types.js';

export type { ActionResult };

/** 股票 */
export interface Stock {
  code: string;
  name: string;
  industryCode: string | null;
  latestPrice: number | null;
  marketCapYi: number | null;
  pe: number | null;
  pb: number | null;
  isWatched: boolean | null;
}

/** 申万一级行业 */
export interface Industry {
  code: string;
  name: string;
}

/** 模拟组合 */
export interface Portfolio {
  id: string;
  name: string;
  initialCash: number;
  cash: number;
}

/** 持仓 */
export interface Position {
  id: string;
  portfolioId: string;
  stockCode: string;
  quantity: number;
  costPrice: number;
}

/** 研判笔记 */
export interface ResearchNote {
  id: string;
  stockCode: string;
  stance: string;
  reason: string;
  createdAt: string;
}

/** 预警规则 */
export interface Alert {
  id: string;
  stockCode: string;
  condition: string;
  status: string;
  createdAt: string;
}

export type StockFilter =
  | { property: 'code' | 'name' | 'industryCode' | 'latestPrice' | 'marketCapYi' | 'pe' | 'pb' | 'isWatched'; op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains'; value: string | number | boolean }
  | { property: 'code' | 'name' | 'industryCode' | 'latestPrice' | 'marketCapYi' | 'pe' | 'pb' | 'isWatched'; op: 'isNull' | 'notNull' };
export interface StockQueryOptions { orderBy?: 'code' | 'name' | 'industryCode' | 'latestPrice' | 'marketCapYi' | 'pe' | 'pb' | 'isWatched'; desc?: boolean; limit?: number; }

export type IndustryFilter =
  | { property: 'code' | 'name'; op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains'; value: string | number | boolean }
  | { property: 'code' | 'name'; op: 'isNull' | 'notNull' };
export interface IndustryQueryOptions { orderBy?: 'code' | 'name'; desc?: boolean; limit?: number; }

export type PortfolioFilter =
  | { property: 'id' | 'name' | 'initialCash' | 'cash'; op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains'; value: string | number | boolean }
  | { property: 'id' | 'name' | 'initialCash' | 'cash'; op: 'isNull' | 'notNull' };
export interface PortfolioQueryOptions { orderBy?: 'id' | 'name' | 'initialCash' | 'cash'; desc?: boolean; limit?: number; }

export type PositionFilter =
  | { property: 'id' | 'portfolioId' | 'stockCode' | 'quantity' | 'costPrice'; op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains'; value: string | number | boolean }
  | { property: 'id' | 'portfolioId' | 'stockCode' | 'quantity' | 'costPrice'; op: 'isNull' | 'notNull' };
export interface PositionQueryOptions { orderBy?: 'id' | 'portfolioId' | 'stockCode' | 'quantity' | 'costPrice'; desc?: boolean; limit?: number; }

export type ResearchNoteFilter =
  | { property: 'id' | 'stockCode' | 'stance' | 'reason' | 'createdAt'; op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains'; value: string | number | boolean }
  | { property: 'id' | 'stockCode' | 'stance' | 'reason' | 'createdAt'; op: 'isNull' | 'notNull' };
export interface ResearchNoteQueryOptions { orderBy?: 'id' | 'stockCode' | 'stance' | 'reason' | 'createdAt'; desc?: boolean; limit?: number; }

export type AlertFilter =
  | { property: 'id' | 'stockCode' | 'condition' | 'status' | 'createdAt'; op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains'; value: string | number | boolean }
  | { property: 'id' | 'stockCode' | 'condition' | 'status' | 'createdAt'; op: 'isNull' | 'notNull' };
export interface AlertQueryOptions { orderBy?: 'id' | 'stockCode' | 'condition' | 'status' | 'createdAt'; desc?: boolean; limit?: number; }

function decodeStock(row: ObjectRow): Stock {
  const out = { ...row } as Record<string, unknown>;
  if (out.isWatched !== null && out.isWatched !== undefined) out.isWatched = out.isWatched === 1 || out.isWatched === true;
  return out as unknown as Stock;
}

function decodeIndustry(row: ObjectRow): Industry {
  return row as unknown as Industry;
}

function decodePortfolio(row: ObjectRow): Portfolio {
  return row as unknown as Portfolio;
}

function decodePosition(row: ObjectRow): Position {
  return row as unknown as Position;
}

function decodeResearchNote(row: ObjectRow): ResearchNote {
  return row as unknown as ResearchNote;
}

function decodeAlert(row: ObjectRow): Alert {
  return row as unknown as Alert;
}

/** 加自选 的参数 */
export interface AddToWatchlistParams {
  stockCode: string;
}

/** 模拟调仓 的参数 */
export interface TradeStockParams {
  portfolioId: string;
  stockCode: string;
  side: string;
  quantity: number;
  price: number;
}

/** 写研判 的参数 */
export interface WriteResearchNoteParams {
  stockCode: string;
  stance: string;
  reason: string;
}

/** 设预警 的参数 */
export interface SetAlertParams {
  stockCode: string;
  condition: string;
}

/** 处理预警 的参数 */
export interface ResolveAlertParams {
  alertId: string;
}

/** 标记预警触发（系统） 的参数 */
export interface MarkAlertTriggeredParams {
  alertId: string;
}

export function createClient(schema: OntologySchema, dbPath: string) {
  const store = openStore(schema, dbPath);
  const oss = new ObjectSetService(store);
  const actionSvc = new ActionService(store);
  const fnSvc = new FunctionService(store);
  return {
    store,
    objects: {
      Stock: {
        query(filters?: StockFilter[], opts?: StockQueryOptions): Stock[] {
          return oss.query('Stock', filters as Filter[] | undefined, opts as QueryOptions | undefined).map(decodeStock);
        },
        get(pk: string): Stock | undefined {
          const row = store.get('Stock', pk);
          return row ? decodeStock(row) : undefined;
        },
        traverse(pk: string, link: 'industry' | 'positions' | 'researchNotes' | 'alerts'): ObjectRow[] {
          return oss.traverse('Stock', pk, link);
        },
        count(): number { return store.count('Stock'); },
      },
      Industry: {
        query(filters?: IndustryFilter[], opts?: IndustryQueryOptions): Industry[] {
          return oss.query('Industry', filters as Filter[] | undefined, opts as QueryOptions | undefined).map(decodeIndustry);
        },
        get(pk: string): Industry | undefined {
          const row = store.get('Industry', pk);
          return row ? decodeIndustry(row) : undefined;
        },
        traverse(pk: string, link: 'stocks'): ObjectRow[] {
          return oss.traverse('Industry', pk, link);
        },
        count(): number { return store.count('Industry'); },
      },
      Portfolio: {
        query(filters?: PortfolioFilter[], opts?: PortfolioQueryOptions): Portfolio[] {
          return oss.query('Portfolio', filters as Filter[] | undefined, opts as QueryOptions | undefined).map(decodePortfolio);
        },
        get(pk: string): Portfolio | undefined {
          const row = store.get('Portfolio', pk);
          return row ? decodePortfolio(row) : undefined;
        },
        traverse(pk: string, link: 'positions'): ObjectRow[] {
          return oss.traverse('Portfolio', pk, link);
        },
        count(): number { return store.count('Portfolio'); },
      },
      Position: {
        query(filters?: PositionFilter[], opts?: PositionQueryOptions): Position[] {
          return oss.query('Position', filters as Filter[] | undefined, opts as QueryOptions | undefined).map(decodePosition);
        },
        get(pk: string): Position | undefined {
          const row = store.get('Position', pk);
          return row ? decodePosition(row) : undefined;
        },
        traverse(pk: string, link: 'portfolio' | 'stock'): ObjectRow[] {
          return oss.traverse('Position', pk, link);
        },
        count(): number { return store.count('Position'); },
      },
      ResearchNote: {
        query(filters?: ResearchNoteFilter[], opts?: ResearchNoteQueryOptions): ResearchNote[] {
          return oss.query('ResearchNote', filters as Filter[] | undefined, opts as QueryOptions | undefined).map(decodeResearchNote);
        },
        get(pk: string): ResearchNote | undefined {
          const row = store.get('ResearchNote', pk);
          return row ? decodeResearchNote(row) : undefined;
        },
        traverse(pk: string, link: 'stock'): ObjectRow[] {
          return oss.traverse('ResearchNote', pk, link);
        },
        count(): number { return store.count('ResearchNote'); },
      },
      Alert: {
        query(filters?: AlertFilter[], opts?: AlertQueryOptions): Alert[] {
          return oss.query('Alert', filters as Filter[] | undefined, opts as QueryOptions | undefined).map(decodeAlert);
        },
        get(pk: string): Alert | undefined {
          const row = store.get('Alert', pk);
          return row ? decodeAlert(row) : undefined;
        },
        traverse(pk: string, link: 'stock'): ObjectRow[] {
          return oss.traverse('Alert', pk, link);
        },
        count(): number { return store.count('Alert'); },
      },
    },
    actions: {
      /** 加自选 */
      addToWatchlist(params: AddToWatchlistParams): ActionResult {
        return actionSvc.execute('addToWatchlist', params as unknown as Record<string, Value>);
      },
      /** 模拟调仓 */
      tradeStock(params: TradeStockParams): ActionResult {
        return actionSvc.execute('tradeStock', params as unknown as Record<string, Value>);
      },
      /** 写研判 */
      writeResearchNote(params: WriteResearchNoteParams): ActionResult {
        return actionSvc.execute('writeResearchNote', params as unknown as Record<string, Value>);
      },
      /** 设预警 */
      setAlert(params: SetAlertParams): ActionResult {
        return actionSvc.execute('setAlert', params as unknown as Record<string, Value>);
      },
      /** 处理预警 */
      resolveAlert(params: ResolveAlertParams): ActionResult {
        return actionSvc.execute('resolveAlert', params as unknown as Record<string, Value>);
      },
      /** 标记预警触发（系统） */
      markAlertTriggered(params: MarkAlertTriggeredParams): ActionResult {
        return actionSvc.execute('markAlertTriggered', params as unknown as Record<string, Value>);
      },
    },
    functions: {
      /** 组合估值 */
      portfolioValuation(params: Record<string, Value>): unknown { return fnSvc.call('portfolioValuation', params); },
      /** 条件选股 */
      screenStocks(params: Record<string, Value>): unknown { return fnSvc.call('screenStocks', params); },
      /** 预警扫描 */
      checkAlerts(params: Record<string, Value>): unknown { return fnSvc.call('checkAlerts', params); },
    },
  };
}

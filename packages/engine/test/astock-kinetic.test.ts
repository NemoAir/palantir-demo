import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { loadOntology } from '../src/oms.js';
import { ObjectStore } from '../src/store.js';
import { ObjectSetService } from '../src/oss.js';
import { ActionService } from '../src/actions.js';
import { FunctionService } from '../src/functions.js';
import { astock } from '../../../ontology/astock.ontology.js';

describe('astock 动能层（6 Action + 3 Function）', () => {
  let store: ObjectStore;
  let actions: ActionService;
  let fns: FunctionService;
  let oss: ObjectSetService;

  beforeEach(() => {
    store = new ObjectStore(new Database(':memory:'), loadOntology(astock));
    store.init();
    store.upsertMany('Industry', [{ code: 'sw_dianzi', name: '电子' }]);
    store.upsertMany('Stock', [
      { code: '688981', name: '中芯国际', industryCode: 'sw_dianzi', latestPrice: 100, marketCapYi: 8000, pe: 120, pb: 4, isWatched: null },
      { code: '688111', name: '金山办公', industryCode: 'sw_dianzi', latestPrice: 260, marketCapYi: 1200, pe: 55, pb: 8, isWatched: null },
    ]);
    store.upsertMany('Portfolio', [{ id: 'P1', name: '演示组合', initialCash: 1000000, cash: 1000000 }]);
    actions = new ActionService(store);
    fns = new FunctionService(store);
    oss = new ObjectSetService(store);
  });

  it('tradeStock 买入新股：创建持仓、现金减少、审计+1', () => {
    const r = actions.execute('tradeStock', { portfolioId: 'P1', stockCode: '688981', side: 'buy', quantity: 500, price: 100 });
    expect(r.ok).toBe(true);
    const pos = store.get('Position', 'POS-P1-688981')!;
    expect(pos.quantity).toBe(500);
    expect(pos.costPrice).toBe(100);
    expect(store.get('Portfolio', 'P1')?.cash).toBe(950000);
    expect(store.listAudit(5)[0].action).toBe('tradeStock');
  });

  it('tradeStock 加仓：加权平均成本', () => {
    actions.execute('tradeStock', { portfolioId: 'P1', stockCode: '688981', side: 'buy', quantity: 500, price: 100 });
    const r = actions.execute('tradeStock', { portfolioId: 'P1', stockCode: '688981', side: 'buy', quantity: 500, price: 110 });
    expect(r.ok).toBe(true);
    const pos = store.get('Position', 'POS-P1-688981')!;
    expect(pos.quantity).toBe(1000);
    expect(pos.costPrice).toBe(105); // (500*100+500*110)/1000
  });

  it('tradeStock 现金不足拒绝（cashSufficient）', () => {
    const r = actions.execute('tradeStock', { portfolioId: 'P1', stockCode: '688111', side: 'buy', quantity: 5000, price: 260 });
    expect(r).toMatchObject({ ok: false, stage: 'criteria', failedCriterion: 'cashSufficient' });
  });

  it('tradeStock 卖出超持仓拒绝（positionSufficient）', () => {
    actions.execute('tradeStock', { portfolioId: 'P1', stockCode: '688981', side: 'buy', quantity: 100, price: 100 });
    const r = actions.execute('tradeStock', { portfolioId: 'P1', stockCode: '688981', side: 'sell', quantity: 200, price: 100 });
    expect(r).toMatchObject({ ok: false, stage: 'criteria', failedCriterion: 'positionSufficient' });
  });

  it('tradeStock 卖出：持仓减、现金增', () => {
    actions.execute('tradeStock', { portfolioId: 'P1', stockCode: '688981', side: 'buy', quantity: 500, price: 100 });
    const r = actions.execute('tradeStock', { portfolioId: 'P1', stockCode: '688981', side: 'sell', quantity: 200, price: 120 });
    expect(r.ok).toBe(true);
    expect(store.get('Position', 'POS-P1-688981')?.quantity).toBe(300);
    expect(store.get('Portfolio', 'P1')?.cash).toBe(974000); // 1000000-50000+24000
  });

  it('addToWatchlist：置自选；重复加被拒（notYetWatched）', () => {
    expect(actions.execute('addToWatchlist', { stockCode: '688981' }).ok).toBe(true);
    expect(store.get('Stock', '688981')?.isWatched).toBe(1); // SQLite 布尔存 1
    const r2 = actions.execute('addToWatchlist', { stockCode: '688981' });
    expect(r2).toMatchObject({ ok: false, failedCriterion: 'notYetWatched' });
  });

  it('writeResearchNote：创建笔记且沿链接可遍历', () => {
    const r = actions.execute('writeResearchNote', { stockCode: '688981', stance: '看多', reason: '先进制程扩产' });
    expect(r.ok).toBe(true);
    const notes = oss.traverse('Stock', '688981', 'researchNotes');
    expect(notes.length).toBe(1);
    expect(notes[0].stance).toBe('看多');
  });

  it('writeResearchNote 非法结论拒绝（stanceValid）', () => {
    const r = actions.execute('writeResearchNote', { stockCode: '688981', stance: '梭哈', reason: 'x' });
    expect(r).toMatchObject({ ok: false, failedCriterion: 'stanceValid' });
  });

  it('预警状态机：setAlert(armed) → checkAlerts → markAlertTriggered → resolveAlert', () => {
    const r1 = actions.execute('setAlert', { stockCode: '688981', condition: 'latestPrice<150' });
    expect(r1.ok).toBe(true);
    const alerts = oss.query('Alert', [{ property: 'status', op: 'eq', value: 'armed' }]);
    expect(alerts.length).toBe(1);
    const alertId = alerts[0].id as string;

    // checkAlerts：latestPrice=100 < 150 → 命中
    const hits = fns.call('checkAlerts', {}) as { alertId: string }[];
    expect(hits.map(h => h.alertId)).toEqual([alertId]);

    const r2 = actions.execute('markAlertTriggered', { alertId });
    expect(r2.ok).toBe(true);
    expect(store.get('Alert', alertId)?.status).toBe('triggered');
    // 已触发的不再出现在 checkAlerts
    expect((fns.call('checkAlerts', {}) as unknown[]).length).toBe(0);

    const r3 = actions.execute('resolveAlert', { alertId });
    expect(r3.ok).toBe(true);
    expect(store.get('Alert', alertId)?.status).toBe('resolved');
    // resolve 只接受 triggered 态
    const r4 = actions.execute('resolveAlert', { alertId });
    expect(r4).toMatchObject({ ok: false, failedCriterion: 'alertTriggered' });
  });

  it('setAlert 非法条件表达式拒绝（conditionValid）', () => {
    const r = actions.execute('setAlert', { stockCode: '688981', condition: '!!!' });
    expect(r).toMatchObject({ ok: false, failedCriterion: 'conditionValid' });
  });

  it('portfolioValuation：市值/成本/盈亏与手工计算一致', () => {
    actions.execute('tradeStock', { portfolioId: 'P1', stockCode: '688981', side: 'buy', quantity: 500, price: 90 });
    const v = fns.call('portfolioValuation', { portfolioId: 'P1' }) as {
      cash: number; totalMarketValue: number; totalAssets: number; totalPnl: number;
      positions: { stockCode: string; marketValue: number; pnl: number }[];
    };
    expect(v.cash).toBe(955000);
    expect(v.totalMarketValue).toBe(50000);   // 500 × 100(最新价)
    expect(v.totalAssets).toBe(1005000);
    expect(v.totalPnl).toBe(5000);            // (100-90)×500
    expect(v.positions[0].stockCode).toBe('688981');
  });

  it('createPortfolio：新建组合（cash=initialCash），空名/非正资金拒绝', () => {
    const r = actions.execute('createPortfolio', { name: '打新组合', initialCash: 500000 });
    expect(r.ok).toBe(true);
    const p2 = store.get('Portfolio', 'P2')!;
    expect(p2.name).toBe('打新组合');
    expect(p2.cash).toBe(500000);
    expect(actions.execute('createPortfolio', { name: '  ', initialCash: 1 }))
      .toMatchObject({ ok: false, failedCriterion: 'nameNotEmpty' });
    expect(actions.execute('createPortfolio', { name: 'x', initialCash: 0 }))
      .toMatchObject({ ok: false, failedCriterion: 'cashPositive' });
  });

  it('updateResearchNote：修改结论与理由（留审计）', () => {
    actions.execute('writeResearchNote', { stockCode: '688981', stance: '看多', reason: '初判' });
    const r = actions.execute('updateResearchNote', { noteId: 'RN-1', stance: '中性', reason: '估值已到位' });
    expect(r.ok).toBe(true);
    const note = store.get('ResearchNote', 'RN-1')!;
    expect(note.stance).toBe('中性');
    expect(note.reason).toBe('估值已到位');
    expect(store.listAudit(5)[0].action).toBe('updateResearchNote');
    expect(actions.execute('updateResearchNote', { noteId: 'GHOST', stance: '看多', reason: 'x' }))
      .toMatchObject({ ok: false, failedCriterion: 'noteExists' });
  });

  it('screenStocks 与直接 query 等价', () => {
    const byFn = fns.call('screenStocks', { where: 'pe<100' }) as { code: string }[];
    const direct = oss.query('Stock', [{ property: 'pe', op: 'lt', value: 100 }]);
    expect(byFn.map(s => s.code)).toEqual(direct.map(d => d.code));
  });
});

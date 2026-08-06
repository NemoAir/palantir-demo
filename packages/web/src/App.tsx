import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api, type ActionResult, type ActionTypeView, type AuditRecord, type ObjectRow,
  type ObjectTypeDef, type SchemaView, type Value,
} from './api';

/* ---------- 视图状态机 ---------- */
type View =
  | { kind: 'list'; type: string }
  | { kind: 'detail'; type: string; pk: Value }
  | { kind: 'action'; name: string; prefill?: Record<string, Value> };

/* ---------- 工具 ---------- */
const fmt = (v: Value): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
};

/** 通用预填启发：参数名包含对象类型名（小写）→ 填入该对象主键值。 */
const prefillFor = (action: ActionTypeView, typeApiName: string, pk: Value): Record<string, Value> => {
  const out: Record<string, Value> = {};
  for (const p of action.parameters) {
    if (p.apiName.toLowerCase().includes(typeApiName.toLowerCase())) out[p.apiName] = pk;
  }
  return out;
};

export function App() {
  const [schema, setSchema] = useState<SchemaView | null>(null);
  const [view, setViewState] = useState<View>(() => (window.history.state as View | null) ?? { kind: 'list', type: 'Stock' });
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [lineagePlay, setLineagePlay] = useState(0);
  const [auditKey, setAuditKey] = useState(0);
  const [fatal, setFatal] = useState<string | null>(null);

  /** 导航 = 压入浏览器历史（前进/后退键、返回按钮全部可用）。
   * pushState 必须在 updater 之外：StrictMode 会双调用 updater，副作用放里面会把历史压重。 */
  const setView = useCallback((v: View) => {
    if (JSON.stringify(window.history.state) !== JSON.stringify(v)) {
      window.history.pushState(v, '');
    }
    setViewState(v);
  }, []);

  useEffect(() => {
    if (!window.history.state) window.history.replaceState({ kind: 'list', type: 'Stock' } satisfies View, '');
    const onPop = (e: PopStateEvent) => { if (e.state) setViewState(e.state as View); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const refreshCounts = useCallback((s: SchemaView) => {
    for (const ot of s.objectTypes) {
      api.count(ot.apiName).then(c => {
        if (!Array.isArray(c)) setCounts(prev => ({ ...prev, [ot.apiName]: c.count }));
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    api.schema().then(s => { setSchema(s); refreshCounts(s); })
      .catch(e => setFatal(`无法连接本体 API（先运行 pnpm --filter engine serve）：${(e as Error).message}`));
  }, [refreshCounts]);

  const onActionDone = useCallback(() => {
    setLineagePlay(n => n + 1);
    setAuditKey(n => n + 1);
    if (schema) refreshCounts(schema);
  }, [schema, refreshCounts]);

  if (fatal) return <div className="error-banner" style={{ margin: 40 }}>{fatal}</div>;
  if (!schema) return <div className="empty" style={{ paddingTop: 80 }}>加载本体元数据…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <span className="diamond">◆</span>A股投研运营台
          <span className="sub">迷你 Foundry · 本体 {schema.apiName}</span>
        </span>
        <span className="spacer" />
        <span className="legend">
          <span title="semantic elements：对象/属性/链接——世界里'有什么'（企业的名词）"><span className="dot dot-semantic" />语义（名词）对象 {schema.objectTypes.length} · 链接 {schema.linkTypes.length}</span>
          <span title="kinetic elements：Action/Function——对世界'能做什么'（企业的动词）"><span className="dot dot-kinetic" />动能（动词）Action {schema.actionTypes.length} · Function {schema.functions.length}</span>
        </span>
      </header>

      <div className="main">
        <nav className="sidenav">
          <div className="group-label">语义层 · 对象</div>
          {schema.objectTypes.map(ot => (
            <button
              key={ot.apiName}
              className={`nav-item ${view.kind !== 'action' && view.type === ot.apiName ? 'active' : ''}`}
              onClick={() => setView({ kind: 'list', type: ot.apiName })}
            >
              <span className="dot dot-semantic" />{ot.displayName}
              <span className="count">{counts[ot.apiName] ?? ''}</span>
            </button>
          ))}
          <div className="group-label" style={{ marginTop: 14 }} title="动能元素（kinetic elements）：Action 动词与 Function 函数——对世界'能做什么'">动能层 · Action</div>
          {schema.actionTypes.filter(a => !a.system).map(a => (
            <button
              key={a.apiName}
              className={`nav-item kinetic ${view.kind === 'action' && view.name === a.apiName ? 'active' : ''}`}
              onClick={() => setView({ kind: 'action', name: a.apiName })}
            >
              <span className="dot dot-kinetic" />{a.displayName}
            </button>
          ))}
          <details className="system-group">
            <summary title="系统 Action：由自动化/AI 流程调用（写入照走治理管线），人一般不手点">系统 Action</summary>
            {schema.actionTypes.filter(a => a.system).map(a => (
              <button
                key={a.apiName}
                className={`nav-item kinetic ${view.kind === 'action' && view.name === a.apiName ? 'active' : ''}`}
                onClick={() => setView({ kind: 'action', name: a.apiName })}
              >
                <span className="dot dot-kinetic" style={{ opacity: 0.5 }} />{a.displayName}
              </button>
            ))}
          </details>
        </nav>

        <main className="content">
          {view.kind !== 'list' && (
            <button className="back-btn" onClick={() => window.history.back()}>← 返回</button>
          )}
          {view.kind === 'list' && (
            <ObjectList
              key={view.type}
              schema={schema}
              type={view.type}
              onOpen={pk => setView({ kind: 'detail', type: view.type, pk })}
            />
          )}
          {view.kind === 'detail' && (
            <ObjectDetail
              key={`${view.type}:${String(view.pk)}`}
              schema={schema}
              type={view.type}
              pk={view.pk}
              refreshSignal={auditKey}
              onBack={() => setView({ kind: 'list', type: view.type })}
              onJump={(t, pk) => setView({ kind: 'detail', type: t, pk })}
              onAction={(name, prefill) => setView({ kind: 'action', name, prefill })}
            />
          )}
          {view.kind === 'action' && (
            <ActionPanel
              key={view.name + JSON.stringify(view.prefill ?? {})}
              schema={schema}
              name={view.name}
              prefill={view.prefill}
              onDone={onActionDone}
            />
          )}
        </main>

        <AuditRail refreshSignal={auditKey} schema={schema} />
      </div>

      <LineageBar play={lineagePlay} />
    </div>
  );
}

/* ---------- 对象列表 ---------- */
function ObjectList({ schema, type, onOpen }: {
  schema: SchemaView; type: string; onOpen: (pk: Value) => void;
}) {
  const ot = schema.objectTypes.find(o => o.apiName === type)!;
  const [rows, setRows] = useState<ObjectRow[] | null>(null);
  const [where, setWhere] = useState<string[]>([]);
  const [orderBy, setOrderBy] = useState<{ prop: string; desc: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fProp, setFProp] = useState(ot.properties[0].apiName);
  const [fOp, setFOp] = useState('<');
  const [fVal, setFVal] = useState('');

  // 运算符按属性类型收窄：文本给包含/等值，数字日期给比较，布尔给等值
  const OPS_BY_TYPE: Record<string, string[]> = {
    string: ['~', '=', '!=', '=null', '!=null'],
    date: ['<', '<=', '>', '>=', '=', '!=', '=null', '!=null'],
    number: ['<', '<=', '>', '>=', '=', '!=', '=null', '!=null'],
    boolean: ['=', '!=', '=null', '!=null'],
  };
  const fPropType = ot.properties.find(p => p.apiName === fProp)?.type ?? 'string';
  const ops = OPS_BY_TYPE[fPropType];
  const changeProp = (name: string) => {
    setFProp(name);
    const t = ot.properties.find(p => p.apiName === name)?.type ?? 'string';
    if (!OPS_BY_TYPE[t].includes(fOp)) setFOp(OPS_BY_TYPE[t][0]);
  };

  useEffect(() => {
    setErr(null);
    api.objects(type, { where, orderBy: orderBy?.prop, desc: orderBy?.desc, limit: 200 })
      .then(setRows)
      .catch(e => setErr((e as Error).message));
  }, [type, where, orderBy]);

  const addFilter = () => {
    if (!fVal.trim() && fOp !== '=null' && fOp !== '!=null') return;
    const expr = fOp === '=null' || fOp === '!=null' ? `${fProp}${fOp.replace('null', '')}null` : `${fProp}${fOp}${fVal.trim()}`;
    setWhere(w => [...w, expr]);
    setFVal('');
  };

  return (
    <>
      <h2>{ot.displayName} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>Object Set</span></h2>
      <div className="subtitle">
        {ot.datasource ? `backing dataset: ${ot.datasource.path}（Funnel 物化）` : '纯编辑型——对象只由 Action 创建'}
      </div>
      <div className="filter-bar">
        <select value={fProp} onChange={e => changeProp(e.target.value)}>
          {ot.properties.map(p => <option key={p.apiName} value={p.apiName}>{p.displayName}</option>)}
        </select>
        <select value={fOp} onChange={e => setFOp(e.target.value)}>
          {ops.map(o => <option key={o} value={o}>{o === '~' ? '~ 包含' : o === '=null' ? '为空' : o === '!=null' ? '非空' : o}</option>)}
        </select>
        {fOp !== '=null' && fOp !== '!=null' && (
          <input value={fVal} onChange={e => setFVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && addFilter()} placeholder="值" />
        )}
        <button className="btn-kinetic" style={{ background: 'var(--semantic)', color: '#0b1524' }} onClick={addFilter}>过滤</button>
        {where.map((w, i) => (
          <span className="chip" key={i}>{w}<button onClick={() => setWhere(ws => ws.filter((_, j) => j !== i))}>×</button></span>
        ))}
      </div>
      {err && <div className="error-banner">{err}</div>}
      {rows === null ? <div className="empty">加载中…</div> : rows.length === 0 ? (
        <div className="empty">没有符合条件的对象{ot.datasource ? '' : '——用左侧对应的 Action 创建第一个'}</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              {ot.properties.map(p => (
                <th
                  key={p.apiName}
                  className={p.type === 'number' ? 'num' : ''}
                  onClick={() => setOrderBy(o => ({ prop: p.apiName, desc: o?.prop === p.apiName ? !o.desc : true }))}
                >
                  {p.displayName}
                  {orderBy?.prop === p.apiName && <span className="arrow">{orderBy.desc ? '↓' : '↑'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={String(r[ot.primaryKey])} onClick={() => onOpen(r[ot.primaryKey])}>
                {ot.properties.map(p => <td key={p.apiName} className={p.type === 'number' ? 'num' : ''}>{cell(r[p.apiName], p.apiName)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="subtitle" style={{ marginTop: 8 }}>{rows ? `${rows.length} 个对象` : ''}</div>
    </>
  );
}

function cell(v: Value, prop: string) {
  if (prop === 'isWatched') return v === 1 || v === true ? <span className="watched">★ 自选</span> : <span className="null">—</span>;
  if (v === null || v === undefined) return <span className="null">—</span>;
  return fmt(v);
}

/* ---------- 对象详情（属性 + 链接遍历 + 相关动作） ---------- */
function ObjectDetail({ schema, type, pk, onBack, onJump, onAction, refreshSignal }: {
  schema: SchemaView; type: string; pk: Value; refreshSignal: number;
  onBack: () => void;
  onJump: (type: string, pk: Value) => void;
  onAction: (name: string, prefill: Record<string, Value>) => void;
}) {
  const ot = schema.objectTypes.find(o => o.apiName === type)!;
  const [row, setRow] = useState<ObjectRow | null>(null);
  const [linkResults, setLinkResults] = useState<Record<string, ObjectRow[]>>({});

  const links = useMemo(() => schema.linkTypes.flatMap(lt => {
    const out: { name: string; targetType: string; label: string }[] = [];
    if (lt.source === type) out.push({ name: lt.sourceToTargetName, targetType: lt.target, label: `${lt.displayName} →` });
    if (lt.target === type) out.push({ name: lt.targetToSourceName, targetType: lt.source, label: `← ${lt.displayName}（反向）` });
    return out;
  }), [schema, type]);

  useEffect(() => {
    api.object(type, pk).then(setRow).catch(() => setRow(null));
    for (const l of links) {
      api.links(type, pk, l.name).then(rs => setLinkResults(prev => ({ ...prev, [l.name]: rs }))).catch(() => {});
    }
  }, [type, pk, links, refreshSignal]);

  const relatedActions = schema.actionTypes
    .filter(a => !a.system)
    .map(a => ({ a, prefill: prefillFor(a, type, pk) }))
    .filter(x => Object.keys(x.prefill).length > 0);

  // Function 的 UI 落地：组合详情内嵌估值卡（portfolioValuation 实时计算）
  const [valuation, setValuation] = useState<{
    cash: number; totalMarketValue: number; totalAssets: number; totalPnl: number;
    positions: { stockCode: Value; name: Value; quantity: number; costPrice: number; latestPrice: number | null; marketValue: number | null; pnl: number | null }[];
  } | null>(null);
  useEffect(() => {
    if (type !== 'Portfolio') { setValuation(null); return; }
    api.fn('portfolioValuation', { portfolioId: pk })
      .then(v => setValuation(v as typeof valuation))
      .catch(() => setValuation(null));
  }, [type, pk, refreshSignal]);

  if (!row) return <div className="empty">对象不存在或已被源数据移除</div>;

  return (
    <>
      <div className="crumb"><button onClick={onBack}>{ot.displayName}</button> / <span style={{ fontFamily: 'var(--mono)' }}>{String(pk)}</span></div>
      <h2>{String(row.name ?? pk)} <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>{ot.displayName}</span></h2>
      <div className="section-label">属性（Properties）</div>
      <div className="detail-grid">
        {ot.properties.map(p => (
          <div className="prop-card" key={p.apiName}>
            <div className="label">{p.displayName}</div>
            <div className="value">{cell(row[p.apiName], p.apiName)}</div>
          </div>
        ))}
      </div>
      {valuation && (
        <>
          <div className="section-label" style={{ color: 'var(--kinetic)' }}>组合估值（Function: portfolioValuation 实时计算）</div>
          <div className="valuation-kpis">
            <div className="kpi"><div className="label">总资产</div><div className="value">{valuation.totalAssets.toLocaleString()}</div></div>
            <div className="kpi"><div className="label">现金</div><div className="value">{valuation.cash.toLocaleString()}</div></div>
            <div className="kpi"><div className="label">持仓市值</div><div className="value">{valuation.totalMarketValue.toLocaleString()}</div></div>
            <div className="kpi"><div className="label">浮动盈亏</div>
              <div className={`value ${valuation.totalPnl >= 0 ? 'pnl-up' : 'pnl-down'}`}>
                {valuation.totalPnl >= 0 ? '+' : ''}{valuation.totalPnl.toLocaleString()}
              </div>
            </div>
          </div>
          <table className="data-table" style={{ marginBottom: 16 }}>
            <thead><tr><th>股票</th><th className="num">数量</th><th className="num">成本</th><th className="num">现价</th><th className="num">市值</th><th className="num">盈亏</th></tr></thead>
            <tbody>
              {valuation.positions.map(p => (
                <tr key={String(p.stockCode)} onClick={() => onJump('Stock', p.stockCode)}>
                  <td>{String(p.name ?? p.stockCode)}</td>
                  <td className="num">{p.quantity}</td>
                  <td className="num">{p.costPrice.toFixed(2)}</td>
                  <td className="num">{p.latestPrice?.toFixed(2) ?? '—'}</td>
                  <td className="num">{p.marketValue?.toLocaleString() ?? '—'}</td>
                  <td className={`num ${p.pnl !== null && p.pnl >= 0 ? 'pnl-up' : 'pnl-down'}`}>{p.pnl !== null ? `${p.pnl >= 0 ? '+' : ''}${p.pnl.toLocaleString()}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="section-label">链接遍历（Links）</div>
      {links.length === 0 && <div className="subtitle">该类型没有链接</div>}
      {links.map(l => (
        <div className="link-group" key={l.name}>
          <div className="link-name">{l.label} <span style={{ fontFamily: 'var(--mono)', opacity: 0.7 }}>{l.name}</span></div>
          <div className="link-items">
            {(linkResults[l.name] ?? []).length === 0 && <span className="null">（空）</span>}
            {(linkResults[l.name] ?? []).map(r => {
              const tOt = schema.objectTypes.find(o => o.apiName === l.targetType)!;
              const tPk = r[tOt.primaryKey];
              return (
                <button className="link-pill" key={String(tPk)} onClick={() => onJump(l.targetType, tPk)}>
                  {String(r.name ?? tPk)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {relatedActions.length > 0 && <>
        <div className="section-label" style={{ color: 'var(--kinetic)' }}>相关动作（Actions）</div>
        <div className="action-row">
          {relatedActions.map(({ a, prefill }) => (
            <button className="btn-kinetic" key={a.apiName} onClick={() => onAction(a.apiName, prefill)}>{a.displayName}</button>
          ))}
        </div>
      </>}
    </>
  );
}

/* ---------- Action 面板（schema 驱动动态表单） ---------- */
function ActionPanel({ schema, name, prefill, onDone }: {
  schema: SchemaView; name: string; prefill?: Record<string, Value>; onDone: () => void;
}) {
  const action = schema.actionTypes.find(a => a.apiName === name)!;
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const p of action.parameters) init[p.apiName] = prefill?.[p.apiName] !== undefined ? String(prefill[p.apiName]) : '';
    return init;
  });
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setResult(null);
    const params: Record<string, Value> = {};
    for (const p of action.parameters) {
      const raw = values[p.apiName];
      if (raw === '' && p.required === false) continue;
      params[p.apiName] = p.type === 'number' ? Number(raw) : p.type === 'boolean' ? raw === 'true' : raw;
    }
    try {
      const r = await api.action(name, params);
      setResult(r);
      if (r.ok) onDone();
    } catch (e) {
      setResult({ ok: false, stage: 'params', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const failedCriterion = result && !result.ok && result.stage === 'criteria' ? result.failedCriterion : null;

  return (
    <div className="action-panel">
      <div className="panel-head">
        <h2>{action.displayName}</h2>
        <span className="api-name">{action.apiName}</span>
      </div>
      <div className="subtitle">Action Type——受治理的写操作：参数校验 → 提交前提 → 原子提交 → 审计</div>
      {action.parameters.map(p => (
        <div className="form-field" key={p.apiName}>
          <label>{p.displayName}{p.required === false ? '（可选）' : ''} <span style={{ fontFamily: 'var(--mono)', opacity: 0.6 }}>{p.apiName}: {p.type}</span></label>
          {p.type === 'boolean' ? (
            <select value={values[p.apiName]} onChange={e => setValues(v => ({ ...v, [p.apiName]: e.target.value }))}>
              <option value="">—</option><option value="true">true</option><option value="false">false</option>
            </select>
          ) : (
            <input
              type={p.type === 'number' ? 'number' : 'text'}
              value={values[p.apiName]}
              onChange={e => setValues(v => ({ ...v, [p.apiName]: e.target.value }))}
            />
          )}
        </div>
      ))}
      <div className="criteria-list">
        <div className="head">提交前提（Submission Criteria）——不满足即拒绝</div>
        {action.criteria.map(c => (
          <div className={`criterion ${failedCriterion === c.apiName ? 'failed' : result?.ok ? 'passed' : ''}`} key={c.apiName}>
            <span className="mark">{failedCriterion === c.apiName ? '✕' : result?.ok ? '✓' : '○'}</span>
            <span>{c.displayName}</span>
            <span style={{ color: 'var(--muted)', marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 11 }}>{c.apiName}</span>
          </div>
        ))}
      </div>
      <div className="submit-row">
        <button className="btn-submit" onClick={submit} disabled={busy}>{busy ? '提交中…' : '提交 Action'}</button>
        {result?.ok && <span className="result-ok">✓ 已提交（{result.edits.length} 项编辑已原子写入，审计在案）</span>}
        {result && !result.ok && <span className="result-err">✕ {result.message}</span>}
      </div>
      {result?.ok && result.sideEffects.length > 0 && (
        <div className="subtitle" style={{ marginTop: 10 }}>副作用：{result.sideEffects.map(s => s.message).join('；')}</div>
      )}
    </div>
  );
}

/* ---------- 右栏：审计流 + 通知 ---------- */
const fmtTime = (iso: string): string =>
  new Date(iso).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function AuditRail({ refreshSignal, schema }: { refreshSignal: number; schema: SchemaView }) {
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [notifs, setNotifs] = useState<{ id: number; message: string; at: string }[]>([]);
  const lastTop = useRef<number>(0);
  const actionMeta = useMemo(() => new Map(schema.actionTypes.map(a => [a.apiName, a])), [schema]);

  /** 参数按 schema 的 displayName 渲染成可读键值行（替代 raw JSON）。 */
  const readableParams = (action: string, params: Record<string, Value>): { label: string; value: string }[] => {
    const meta = actionMeta.get(action);
    return Object.entries(params).map(([k, v]) => ({
      label: meta?.parameters.find(p => p.apiName === k)?.displayName ?? k,
      value: String(v),
    }));
  };

  useEffect(() => {
    let live = true;
    const load = () => {
      api.audit(30).then(a => { if (live) setAudit(a); }).catch(() => {});
      api.notifications(15).then(n => { if (live) setNotifs(n); }).catch(() => {});
    };
    load();
    const t = setInterval(load, 5000);
    return () => { live = false; clearInterval(t); };
  }, [refreshSignal]);

  useEffect(() => {
    if (audit.length > 0) lastTop.current = Math.max(lastTop.current, audit[0].id);
  }, [audit]);

  return (
    <aside className="audit-rail">
      <div className="rail-title">审计流 AUDIT TRAIL</div>
      {audit.length === 0 && <div className="empty" style={{ padding: '10px 0' }}>还没有决策记录</div>}
      {audit.map(a => (
        <div className={`audit-item ${a.id === lastTop.current && refreshSignal > 0 ? 'fresh' : ''}`} key={a.id}>
          <div className="head">
            <span className="action-name">{actionMeta.get(a.action)?.displayName ?? a.action}</span>
            <span className="id">#{a.id}</span>
          </div>
          <div className="time-full">{fmtTime(a.at)}</div>
          <div className="params-grid">
            {readableParams(a.action, a.params).map(p => (
              <span className="param-pair" key={p.label}><span className="param-label">{p.label}</span>{p.value}</span>
            ))}
          </div>
        </div>
      ))}
      <div className="rail-title" style={{ marginTop: 18 }}>通知 NOTIFICATIONS</div>
      {notifs.map(n => (
        <div className="notif-item" key={n.id}>
          <div>{n.message}</div>
          <div className="time-full">{fmtTime(n.at)}</div>
        </div>
      ))}
    </aside>
  );
}

/* ---------- 签名元素：闭环血缘条 ---------- */
const LINEAGE_NODES = [
  { label: '数据集', cls: 'semantic', tip: 'datasets/*.csv——真实科创板50 行情（问财拉取落盘）' },
  { label: 'Funnel 物化', cls: 'semantic', tip: '引擎搬运工：CSV 按 schema 映射进对象库（幂等/脏行报告/编辑重放）' },
  { label: '本体·对象/链接', cls: 'semantic', tip: '50 只股票成为有身份有关系的对象——世界的语义表示' },
  { label: 'Action 决策', cls: 'kinetic', tip: '受治理的写操作：参数校验→提交前提→原子提交' },
  { label: '写回·编辑账本', cls: 'kinetic', tip: '编辑单独记账——行情刷新重物化后你的编辑仍在（Apply User Edits）' },
  { label: '审计', cls: 'kinetic', tip: '每个决策不可篡改留痕——右栏审计流' },
];

function LineageBar({ play }: { play: number }) {
  const [lit, setLit] = useState(-1);

  useEffect(() => {
    if (play === 0) return;
    let i = 2; // Action 触发的闭环从"本体"起步点亮到审计
    setLit(i);
    const t = setInterval(() => {
      i += 1;
      if (i >= LINEAGE_NODES.length) {
        clearInterval(t);
        setTimeout(() => setLit(-1), 1600);
      } else {
        setLit(i);
      }
    }, 220);
    return () => clearInterval(t);
  }, [play]);

  return (
    <footer className="lineage-bar">
      <span className="lineage-title">CLOSED LOOP</span>
      {LINEAGE_NODES.map((n, i) => (
        <span key={n.label} style={{ display: 'contents' }}>
          {i > 0 && <span className="lineage-arrow">→</span>}
          <span title={n.tip} className={`lineage-node ${n.cls} ${lit >= 0 && i <= lit && i >= 2 ? 'lit' : ''}`}>
            <span className="ring" />{n.label}
          </span>
        </span>
      ))}
    </footer>
  );
}

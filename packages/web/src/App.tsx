import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api, type ActionResult, type ActionTypeView, type AuditRecord, type ObjectRow,
  type ObjectTypeDef, type SchemaView, type Value,
} from './api';

/* ---------- 视图状态机 ---------- */
type View =
  | { kind: 'list'; type: string }
  | { kind: 'detail'; type: string; pk: Value }
  | { kind: 'action'; name: string; prefill?: Record<string, Value> }
  | { kind: 'fn'; name: string; prefill?: Record<string, Value> };

/** 运算符按属性类型收窄（列表过滤与条件构造器共用）。 */
const OPS_BY_TYPE: Record<string, string[]> = {
  string: ['~', '=', '!=', '=null', '!=null'],
  date: ['<', '<=', '>', '>=', '=', '!=', '=null', '!=null'],
  number: ['<', '<=', '>', '>=', '=', '!=', '=null', '!=null'],
  boolean: ['=', '!=', '=null', '!=null'],
};
const OP_LABEL = (o: string): string => (o === '~' ? '~ 包含' : o === '=null' ? '为空' : o === '!=null' ? '非空' : o);

/* ---------- 工具 ---------- */
const fmt = (v: Value): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
};

/* ---------- 引用/枚举/表达式的可读化（全部由 schema 元数据驱动） ---------- */
/** objectType→pk→标题名 的缓存（由链接目标类型的 titleProperty 生成）。 */
type TitleMap = Record<string, Record<string, string>>;

/** 属性若是某外键链接的源端且目标声明了 titleProperty，返回目标类型定义。 */
const fkTarget = (schema: SchemaView, type: string, prop: string): ObjectTypeDef | undefined => {
  const lt = schema.linkTypes.find(l => l.source === type && l.mapping?.property === prop);
  if (!lt) return undefined;
  const target = schema.objectTypes.find(o => o.apiName === lt.target);
  return target?.titleProperty ? target : undefined;
};

const OP_CN: Record<string, string> = { '<': '低于', '<=': '不高于', '>': '高于', '>=': '不低于', '=': '等于', '!=': '不等于', '~': '包含' };

/** 过滤表达式的中文说明（解析正则镜像 engine/filter-parse）。解析失败返回 null，原样展示。 */
const explainFilter = (schema: SchemaView, objectType: string, expr: string): string | null => {
  const m = expr.match(/^(\w+)\s*(!=|>=|<=|=|<|>|~)\s*(.+)$/);
  if (!m) return null;
  const [, prop, op, val] = m;
  const dn = schema.objectTypes.find(o => o.apiName === objectType)?.properties.find(p => p.apiName === prop)?.displayName ?? prop;
  if (val === 'null') return op === '=' ? `${dn}为空` : op === '!=' ? `${dn}非空` : null;
  return `${dn} ${OP_CN[op] ?? op} ${val}`;
};

/** 单元格渲染：枚举→彩色徽章；filterExpr→原文+中文；外键→主键+名称；其余按类型格式化。 */
function renderCell(schema: SchemaView, titles: TitleMap, ot: ObjectTypeDef, propName: string, v: Value) {
  if (propName === 'isWatched') return v === 1 || v === true ? <span className="watched">★ 自选</span> : <span className="null">—</span>;
  if (v === null || v === undefined) return <span className="null">—</span>;
  const p = ot.properties.find(pp => pp.apiName === propName);
  if (p?.enumOptions) {
    const o = p.enumOptions.find(e => e.value === String(v));
    if (o) return <span className={`badge tone-${o.tone ?? 'info'}`}>{o.label}</span>;
  }
  if (p?.format?.kind === 'filterExpr') {
    const cn = explainFilter(schema, p.format.objectType, String(v));
    return <span className="cond"><code>{String(v)}</code>{cn && <span className="cond-cn">{cn}</span>}</span>;
  }
  const target = fkTarget(schema, ot.apiName, propName);
  if (target) {
    const title = titles[target.apiName]?.[String(v)];
    if (title) return <span className="ref-cell"><span className="ref-pk">{fmt(v)}</span><span className="ref-name">{title}</span></span>;
  }
  return fmt(v);
}

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
  /** 血缘条播放哪半环：Action 提交=右半环（本体→审计），重物化=左半环（数据集→本体）。 */
  const [lineageMode, setLineageMode] = useState<'action' | 'materialize'>('action');
  const [auditKey, setAuditKey] = useState(0);
  const [fatal, setFatal] = useState<string | null>(null);
  const [showConcepts, setShowConcepts] = useState(false);

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

  /** 预载"被链接指向且有 titleProperty"的类型全量，建 pk→标题名缓存（外键翻名用）。 */
  const [titles, setTitles] = useState<TitleMap>({});
  const refreshTitles = useCallback((s: SchemaView) => {
    const targets = new Set<string>();
    for (const lt of s.linkTypes) {
      if (s.objectTypes.find(o => o.apiName === lt.target)?.titleProperty) targets.add(lt.target);
    }
    for (const t of targets) {
      const ot = s.objectTypes.find(o => o.apiName === t)!;
      api.objects(t, { limit: 1000 }).then(rows => {
        const m: Record<string, string> = {};
        for (const r of rows) {
          const title = r[ot.titleProperty!];
          if (title !== null && title !== undefined) m[String(r[ot.primaryKey])] = String(title);
        }
        setTitles(prev => ({ ...prev, [t]: m }));
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    api.schema().then(s => { setSchema(s); refreshCounts(s); refreshTitles(s); })
      .catch(e => setFatal(`无法连接本体 API（先运行 pnpm --filter engine serve）：${(e as Error).message}`));
  }, [refreshCounts, refreshTitles]);

  const onActionDone = useCallback(() => {
    setLineageMode('action');
    setLineagePlay(n => n + 1);
    setAuditKey(n => n + 1);
    if (schema) { refreshCounts(schema); refreshTitles(schema); }
  }, [schema, refreshCounts, refreshTitles]);

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
        <RematerializeButton onDone={() => {
          setLineageMode('materialize');
          setLineagePlay(n => n + 1);
          setAuditKey(n => n + 1);
          if (schema) { refreshCounts(schema); refreshTitles(schema); }
        }} />
        <span className="legend">
          <span title="semantic elements：对象/属性/链接——世界里'有什么'（企业的名词）"><span className="dot dot-semantic" />语义（名词）对象 {schema.objectTypes.length} · 链接 {schema.linkTypes.length}</span>
          <span title="kinetic elements：Action/Function——对世界'能做什么'（企业的动词）"><span className="dot dot-kinetic" />动能（动词）Action {schema.actionTypes.length} · Function {schema.functions.length}</span>
        </span>
        <button className="concept-btn" onClick={() => setShowConcepts(true)} title="这套系统的核心概念与闭环——一页讲清">◈ 概念地图</button>
      </header>
      {showConcepts && <ConceptMap onClose={() => setShowConcepts(false)} />}

      <div className="main">
        <nav className="sidenav">
          <details open className="nav-group">
            <summary className="group-title semantic" title="semantic elements（语义元素）：对象/属性/链接——世界里'有什么'，企业的名词">语义元素 · 名词</summary>
            {schema.objectTypes.map(ot => (
              <button
                key={ot.apiName}
                className={`nav-item ${(view.kind === 'list' || view.kind === 'detail') && view.type === ot.apiName ? 'active' : ''}`}
                onClick={() => setView({ kind: 'list', type: ot.apiName })}
              >
                <span className="dot dot-semantic" />{ot.displayName}
                <span className="count">{counts[ot.apiName] ?? ''}</span>
              </button>
            ))}
          </details>
          <details open className="nav-group">
            <summary className="group-title kinetic" title="kinetic elements（动能元素）：Action 与 Function——对世界'能做什么'，企业的动词">动能元素 · 动词</summary>
            <div className="group-label" title="Action：改变世界的动词——受治理的写操作（参数校验→提交前提→原子写入→审计）">Action · 写入</div>
            {schema.actionTypes.filter(a => !a.system).map(a => (
              <button
                key={a.apiName}
                className={`nav-item kinetic ${view.kind === 'action' && view.name === a.apiName ? 'active' : ''}`}
                onClick={() => setView({ kind: 'action', name: a.apiName })}
              >
                <span className="dot dot-kinetic" />{a.displayName}
              </button>
            ))}
            <div className="group-label" style={{ marginTop: 10 }} title="Function：只读的动词——托管计算（算不做，写入必须经 Action）">Function · 只读计算</div>
            {schema.functions.map(f => (
              <button
                key={f.apiName}
                className={`nav-item kinetic ${view.kind === 'fn' && view.name === f.apiName ? 'active' : ''}`}
                onClick={() => setView({ kind: 'fn', name: f.apiName })}
              >
                <span className="dot dot-kinetic" style={{ borderRadius: 2 }} />{f.displayName}
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
              titles={titles}
              type={view.type}
              onOpen={pk => setView({ kind: 'detail', type: view.type, pk })}
            />
          )}
          {view.kind === 'detail' && (
            <ObjectDetail
              key={`${view.type}:${String(view.pk)}`}
              schema={schema}
              titles={titles}
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
              titles={titles}
              name={view.name}
              prefill={view.prefill}
              onDone={onActionDone}
            />
          )}
          {view.kind === 'fn' && (
            <FunctionPanel key={view.name} schema={schema} titles={titles} name={view.name} prefill={view.prefill} onDone={onActionDone} />
          )}
        </main>

        <AuditRail refreshSignal={auditKey} schema={schema} titles={titles} onJump={(t, pk) => setView({ kind: 'detail', type: t, pk })} />
      </div>

      <LineageBar play={lineagePlay} mode={lineageMode} />
    </div>
  );
}

/* ---------- 对象列表 ---------- */
function ObjectList({ schema, titles, type, onOpen }: {
  schema: SchemaView; titles: TitleMap; type: string; onOpen: (pk: Value) => void;
}) {
  const ot = schema.objectTypes.find(o => o.apiName === type)!;
  const [rows, setRows] = useState<ObjectRow[] | null>(null);
  const [where, setWhere] = useState<string[]>([]);
  const [orderBy, setOrderBy] = useState<{ prop: string; desc: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fProp, setFProp] = useState(ot.properties[0].apiName);
  const [fOp, setFOp] = useState('<');
  const [fVal, setFVal] = useState('');

  const fPropDef = ot.properties.find(p => p.apiName === fProp);
  const fPropType = fPropDef?.type ?? 'string';
  const fRefTarget = fkTarget(schema, type, fProp);
  const ops = OPS_BY_TYPE[fPropType];
  const changeProp = (name: string) => {
    setFProp(name);
    setFVal('');
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
          {ops.map(o => <option key={o} value={o}>{OP_LABEL(o)}</option>)}
        </select>
        {fOp !== '=null' && fOp !== '!=null' && (
          fPropDef?.enumOptions ? (
            <select value={fVal} onChange={e => setFVal(e.target.value)}>
              <option value="">— 选值 —</option>
              {fPropDef.enumOptions.map(o => <option key={o.value} value={o.value}>{o.label}{o.label !== o.value ? `（${o.value}）` : ''}</option>)}
            </select>
          ) : fRefTarget ? (
            <span className="filter-ref" key={`${fProp}:${where.length}`}>
              <ObjectRefPicker schema={schema} objectType={fRefTarget.apiName} value={fVal} onChange={setFVal} />
            </span>
          ) : (
            <input
              type={fPropType === 'number' ? 'number' : 'text'}
              value={fVal} onChange={e => setFVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && addFilter()} placeholder="值"
            />
          )
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
                {ot.properties.map(p => <td key={p.apiName} className={p.type === 'number' ? 'num' : ''}>{renderCell(schema, titles, ot, p.apiName, r[p.apiName])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="subtitle" style={{ marginTop: 8 }}>{rows ? `${rows.length} 个对象` : ''}</div>
    </>
  );
}

/* ---------- 对象详情（属性 + 链接遍历 + 相关动作） ---------- */
function ObjectDetail({ schema, titles, type, pk, onBack, onJump, onAction, refreshSignal }: {
  schema: SchemaView; titles: TitleMap; type: string; pk: Value; refreshSignal: number;
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
      <h2>{String((ot.titleProperty ? row[ot.titleProperty] : null) ?? row.name ?? pk)} <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>{ot.displayName}</span></h2>
      <div className="section-label">属性（Properties）</div>
      <div className="detail-grid">
        {ot.properties.map(p => (
          <div className="prop-card" key={p.apiName}>
            <div className="label">{p.displayName}</div>
            <div className="value">{renderCell(schema, titles, ot, p.apiName, row[p.apiName])}</div>
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
function ActionPanel({ schema, titles, name, prefill, onDone }: {
  schema: SchemaView; titles: TitleMap; name: string; prefill?: Record<string, Value>; onDone: () => void;
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

  const formBody = (
    <>
      {action.parameters.map(p => (
        <ParamField
          key={p.apiName}
          schema={schema}
          titles={titles}
          param={p}
          value={values[p.apiName]}
          allValues={values}
          onChange={val => setValues(v => ({ ...v, [p.apiName]: val }))}
        />
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
    </>
  );

  return (
    <div className="action-panel">
      <div className="panel-head">
        <h2>{action.displayName}</h2>
        <span className="api-name">{action.apiName}</span>
      </div>
      <div className="subtitle">Action Type——受治理的写操作：参数校验 → 提交前提 → 原子提交 → 审计</div>
      {action.docs && <div className="docs-note">{action.docs}</div>}
      {action.system ? (
        <>
          <div className="system-note">
            ⚙ 这是系统动词——正常路径由自动化调用，人不手填：跑「预警扫描」得到命中清单，
            在结果行点「标记预警触发」即模拟自动化落账（同一治理管线，审计标系统动词）。
            人工要做的是处理已触发的预警，请用「处理预警」。
          </div>
          <details className="system-manual">
            <summary>演示用：手动执行一次（观察审计里系统动词的记录）</summary>
            {formBody}
          </details>
        </>
      ) : formBody}
    </div>
  );
}

/* ---------- 参数渲染器：editor 元数据 → 下拉 / 对象搜索点选 / 条件构造器 ---------- */
function ParamField({ schema, titles, param, value, allValues, onChange }: {
  schema: SchemaView; titles?: TitleMap; param: import('./api').ParamDef; value: string;
  allValues?: Record<string, string>; onChange: (v: string) => void;
}) {
  // hint 元数据：另一参数选定对象后，实时取该对象的参考属性值，可一键填入
  const hint = param.hint;
  const fromVal = hint ? (allValues?.[hint.fromParam] ?? '') : '';
  const [hintVal, setHintVal] = useState<Value | null>(null);
  useEffect(() => {
    if (!hint || !fromVal) { setHintVal(null); return; }
    let live = true;
    api.object(hint.objectType, fromVal)
      .then(r => { if (live) setHintVal(r[hint.property] ?? null); })
      .catch(() => { if (live) setHintVal(null); });
    return () => { live = false; };
  }, [hint, fromVal]);
  const hintLabel = hint
    ? schema.objectTypes.find(o => o.apiName === hint.objectType)?.properties.find(p => p.apiName === hint.property)?.displayName ?? hint.property
    : '';

  const label = (
    <label>
      {param.displayName}{param.required === false ? '（可选）' : ''}{' '}
      <span style={{ fontFamily: 'var(--mono)', opacity: 0.6 }}>{param.apiName}: {param.type}</span>
    </label>
  );
  const e = param.editor;
  return (
    <div className="form-field">
      {label}
      {e?.kind === 'enum' ? (
        <select value={value} onChange={ev => onChange(ev.target.value)}>
          <option value="">— 请选择 —</option>
          {e.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : e?.kind === 'objectRef' ? (
        <ObjectRefPicker schema={schema} objectType={e.objectType} value={value} onChange={onChange} />
      ) : e?.kind === 'filterExpr' ? (
        <FilterExprBuilder schema={schema} objectType={e.objectType} value={value} onChange={onChange} />
      ) : param.type === 'boolean' ? (
        <select value={value} onChange={ev => onChange(ev.target.value)}>
          <option value="">—</option><option value="true">true</option><option value="false">false</option>
        </select>
      ) : (
        <input type={param.type === 'number' ? 'number' : 'text'} value={value} onChange={ev => onChange(ev.target.value)} />
      )}
      {hint && hintVal !== null && (
        <button type="button" className="hint-fill" onClick={() => onChange(String(hintVal))}>
          当前{hintLabel}：<b>{fmt(hintVal)}</b>（点击填入）
        </button>
      )}
      {e?.kind === 'objectRef' && value && (
        <RefPreview schema={schema} titles={titles ?? {}} objectType={e.objectType} pk={value} />
      )}
    </div>
  );
}

/** objectRef 已选对象的当前内容预览——改研判看原文、处理预警看条件、调仓看行情，全 editor 通用。 */
function RefPreview({ schema, titles, objectType, pk }: {
  schema: SchemaView; titles: TitleMap; objectType: string; pk: string;
}) {
  const ot = schema.objectTypes.find(o => o.apiName === objectType)!;
  const [row, setRow] = useState<ObjectRow | null>(null);
  useEffect(() => {
    let live = true;
    api.object(objectType, pk).then(r => { if (live) setRow(r); }).catch(() => { if (live) setRow(null); });
    return () => { live = false; };
  }, [objectType, pk]);
  if (!row) return null;
  return (
    <div className="ref-preview">
      <div className="ref-preview-head">当前内容 · {ot.displayName} <span style={{ fontFamily: 'var(--mono)' }}>{pk}</span></div>
      <div className="ref-preview-grid">
        {ot.properties.filter(p => p.apiName !== ot.primaryKey).map(p => (
          <span className="param-pair" key={p.apiName}>
            <span className="param-label">{p.displayName}</span>
            {renderCell(schema, titles, ot, p.apiName, row[p.apiName])}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 对象引用选择器：输入代码/名称模糊过滤，点选候选（值=主键）。 */
function ObjectRefPicker({ schema, objectType, value, onChange }: {
  schema: SchemaView; objectType: string; value: string; onChange: (v: string) => void;
}) {
  const ot = schema.objectTypes.find(o => o.apiName === objectType)!;
  const [all, setAll] = useState<ObjectRow[] | null>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);

  // 实例的展示名取自 titleProperty 元数据（无声明时回退 name 字段）
  const rowTitle = useCallback((r: ObjectRow) => {
    const t = ot.titleProperty ? r[ot.titleProperty] : r.name;
    return t !== null && t !== undefined ? String(t) : '';
  }, [ot.titleProperty]);

  const rowLabel = useCallback((r: ObjectRow) => {
    const pk = String(r[ot.primaryKey]);
    const name = rowTitle(r);
    return name && name !== pk ? `${name}（${pk}）` : pk;
  }, [ot.primaryKey, rowTitle]);

  useEffect(() => {
    api.objects(objectType, { limit: 500 }).then(rows => {
      setAll(rows);
      // 预填值回显为可读标签
      if (value && !text) {
        const hit = rows.find(r => String(r[ot.primaryKey]) === String(value));
        if (hit) setText(rowLabel(hit));
      }
    }).catch(() => setAll([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectType]);

  const q = text.trim().toLowerCase();
  const selectedLabel = value ? (all ?? []).find(r => String(r[ot.primaryKey]) === String(value)) : undefined;
  const candidates = (all ?? [])
    .filter(r => {
      if (!q || (selectedLabel && text === rowLabel(selectedLabel))) return true;
      return String(r[ot.primaryKey]).toLowerCase().includes(q) || rowTitle(r).toLowerCase().includes(q);
    })
    .slice(0, 8);

  return (
    <div className="ref-picker">
      <input
        value={text}
        placeholder={`输入${ot.displayName}代码或名称点选`}
        onFocus={() => setOpen(true)}
        onChange={ev => { setText(ev.target.value); setOpen(true); onChange(''); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && candidates.length > 0 && (
        <div className="ref-dropdown">
          {candidates.map(r => {
            const pk = String(r[ot.primaryKey]);
            return (
              <button key={pk} onMouseDown={() => { onChange(pk); setText(rowLabel(r)); setOpen(false); }}>
                {rowLabel(r)}
              </button>
            );
          })}
        </div>
      )}
      {value && (
        <div className="ref-selected">
          已选：{value}{selectedLabel && rowTitle(selectedLabel) && rowTitle(selectedLabel) !== String(value) ? ` ${rowTitle(selectedLabel)}` : ''}
        </div>
      )}
    </div>
  );
}

/** 条件构造器：属性/运算符/值三段点选拼出表达式——"条件只能引用本体里存在的东西"的界面化。 */
function FilterExprBuilder({ schema, objectType, value, onChange }: {
  schema: SchemaView; objectType: string; value: string; onChange: (v: string) => void;
}) {
  const ot = schema.objectTypes.find(o => o.apiName === objectType)!;
  const [prop, setProp] = useState(ot.properties.find(p => p.type === 'number')?.apiName ?? ot.properties[0].apiName);
  const propType = ot.properties.find(p => p.apiName === prop)?.type ?? 'string';
  const ops = OPS_BY_TYPE[propType];
  const [op, setOp] = useState(ops[0]);
  const [val, setVal] = useState('');

  const emit = (np: string, no: string, nv: string) => {
    if (no === '=null' || no === '!=null') onChange(`${np}${no.replace('null', '')}null`);
    else if (nv.trim() !== '') onChange(`${np}${no}${nv.trim()}`);
    else onChange('');
  };

  return (
    <div className="expr-builder">
      <div className="expr-row">
        <select value={prop} onChange={ev => {
          const np = ev.target.value;
          setProp(np);
          const t = ot.properties.find(p => p.apiName === np)?.type ?? 'string';
          const no = OPS_BY_TYPE[t].includes(op) ? op : OPS_BY_TYPE[t][0];
          setOp(no);
          emit(np, no, val);
        }}>
          {ot.properties.map(p => <option key={p.apiName} value={p.apiName}>{p.displayName}</option>)}
        </select>
        <select value={op} onChange={ev => { setOp(ev.target.value); emit(prop, ev.target.value, val); }}>
          {ops.map(o => <option key={o} value={o}>{OP_LABEL(o)}</option>)}
        </select>
        {op !== '=null' && op !== '!=null' && (
          <input
            type={propType === 'number' ? 'number' : 'text'}
            value={val}
            placeholder="值"
            onChange={ev => { setVal(ev.target.value); emit(prop, op, ev.target.value); }}
          />
        )}
      </div>
      <div className="expr-preview">{value ? <>表达式：<code>{value}</code></> : '选择属性与条件后自动生成表达式'}</div>
    </div>
  );
}

/* ---------- Function 运行面板 ---------- */
function FunctionPanel({ schema, titles, name, prefill, onDone }: {
  schema: SchemaView; titles: TitleMap; name: string; prefill?: Record<string, Value>; onDone?: () => void;
}) {
  const fn = schema.functions.find(f => f.apiName === name)!;
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const p of fn.parameters) init[p.apiName] = prefill?.[p.apiName] !== undefined ? String(prefill[p.apiName]) : '';
    return init;
  });
  const [result, setResult] = useState<unknown>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true); setErr(null);
    const params: Record<string, Value> = {};
    for (const p of fn.parameters) {
      const raw = values[p.apiName];
      if (raw === '') continue;
      params[p.apiName] = p.type === 'number' ? Number(raw) : raw;
    }
    try {
      setResult(await api.fn(name, params));
    } catch (e) {
      setErr((e as Error).message); setResult(undefined);
    } finally {
      setBusy(false);
    }
  };

  /** 通用行动作启发：结果行的键能覆盖某系统 Action 的全部必填参数 → 提供一键执行。
   * 这就是"自动化"的最小形态：Function 发现 → 结果行携带参数 → 系统动词落账。 */
  const rowSystemActions = (row: Record<string, Value>) =>
    schema.actionTypes.filter(a =>
      a.system && a.parameters.filter(p => p.required !== false).every(p => row[p.apiName] !== undefined));

  const runRowAction = async (a: ActionTypeView, row: Record<string, Value>) => {
    setBusy(true); setErr(null);
    try {
      const params: Record<string, Value> = {};
      for (const p of a.parameters) if (row[p.apiName] !== undefined) params[p.apiName] = row[p.apiName];
      const r = await api.action(a.apiName, params);
      if (!r.ok) { setErr(`${a.displayName}：${r.message}`); return; }
      onDone?.();
      await run(); // 重跑本 Function：落账后的世界是什么样，当场看见
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="action-panel" style={{ maxWidth: 640 }}>
      <div className="panel-head">
        <h2>{fn.displayName}</h2>
        <span className="api-name">fn: {fn.apiName}</span>
      </div>
      <div className="subtitle">Function——本体原生只读逻辑（算不做；要落地写入需经 Action）</div>
      {fn.docs && <div className="docs-note">{fn.docs}</div>}
      {fn.parameters.map(p => (
        <ParamField key={p.apiName} schema={schema} titles={titles} param={p} value={values[p.apiName]} allValues={values} onChange={v => setValues(s => ({ ...s, [p.apiName]: v }))} />
      ))}
      <div className="submit-row">
        <button className="btn-submit" onClick={run} disabled={busy}>{busy ? '计算中…' : '运行 Function'}</button>
        {err && <span className="result-err">✕ {err}</span>}
      </div>
      {result !== undefined && (
        <ResultView
          data={result}
          rowExtra={row => {
            const acts = rowSystemActions(row);
            if (acts.length === 0) return null;
            return acts.map(a => (
              <button key={a.apiName} className="row-action" disabled={busy} title={a.docs ?? a.displayName} onClick={() => runRowAction(a, row)}>
                ⚙ {a.displayName}
              </button>
            ));
          }}
        />
      )}
    </div>
  );
}

/* 数字展示：千分位；键名含 pnl 的红涨绿跌并带正号 */
const fmtNum = (n: number): string =>
  Number.isInteger(n) ? n.toLocaleString('zh-CN') : n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isPnlKey = (k: string): boolean => k.toLowerCase().includes('pnl');
const numCell = (k: string, v: number) => (
  <span className={isPnlKey(k) ? (v >= 0 ? 'pnl-up' : 'pnl-down') : ''}>
    {isPnlKey(k) && v > 0 ? '+' : ''}{fmtNum(v)}
  </span>
);

/** 通用结果展示（纯形状驱动，不特判具体 Function）：
 * 对象数组→表格（可挂行动作列）；对象→标量 KPI 卡 + 数组字段子表格；其余→JSON。 */
function ResultView({ data, rowExtra }: {
  data: unknown; rowExtra?: (row: Record<string, Value>) => import('react').ReactNode;
}) {
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
    const rows = data as Record<string, Value>[];
    const cols = Object.keys(rows[0]);
    const hasExtra = rowExtra !== undefined && rows.some(r => rowExtra(r));
    return (
      <table className="data-table" style={{ marginTop: 10 }}>
        <thead><tr>{cols.map(c => <th key={c} className={typeof rows[0][c] === 'number' ? 'num' : ''}>{c}</th>)}{hasExtra && <th />}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map(c => (
                <td key={c} className={typeof r[c] === 'number' ? 'num' : ''}>
                  {r[c] === null ? '—' : typeof r[c] === 'number' ? numCell(c, r[c] as number) : String(r[c])}
                </td>
              ))}
              {hasExtra && <td className="row-action-cell">{rowExtra!(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (Array.isArray(data) && data.length === 0) return <div className="empty">（空结果）</div>;
  if (data !== null && typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    const scalars = entries.filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v));
    const arrays = entries.filter(([, v]) => Array.isArray(v));
    if (scalars.length > 0 || arrays.length > 0) {
      return (
        <div style={{ marginTop: 14 }}>
          <div className="valuation-kpis">
            {scalars.map(([k, v]) => (
              <div className="kpi" key={k}>
                <div className="label">{k}</div>
                <div className="value" style={{ fontSize: typeof v === 'number' ? undefined : 14 }}>
                  {v === null ? '—' : typeof v === 'number' ? numCell(k, v) : String(v)}
                </div>
              </div>
            ))}
          </div>
          {arrays.map(([k, v]) => (
            <div key={k}>
              <div className="section-label">{k}（{(v as unknown[]).length}）</div>
              <ResultView data={v} rowExtra={rowExtra} />
            </div>
          ))}
        </div>
      );
    }
  }
  return <pre className="result-json">{JSON.stringify(data, null, 2)}</pre>;
}

/* ---------- 右栏：审计流 + 通知 ---------- */
const fmtTime = (iso: string): string =>
  new Date(iso).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** 顶栏：重新物化数据集（只处理本地 CSV，不联网拉新行情——拉行情走对话让 Claude 重取）。 */
function RematerializeButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const run = async () => {
    setBusy(true);
    try {
      const reports = await api.materialize();
      const total = reports.reduce((s, r) => s + r.inserted + r.updated, 0);
      const nulled = reports.reduce((s, r) => s + r.nulled.length, 0);
      setMsg(`已物化 ${total} 对象（置空 ${nulled}），编辑已重放保留`);
      onDone();
    } catch (e) {
      setMsg(`失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(''), 6000);
    }
  };
  return (
    <span className="remat">
      <button
        className="remat-btn"
        title="重新物化 datasets/*.csv（Funnel 重跑 + 编辑账本重放）。不联网：要拉最新行情，请在对话里让 Claude 重取数据"
        onClick={run}
        disabled={busy}
      >
        {busy ? '物化中…' : '⟳ 重新物化数据集'}
      </button>
      {msg && <span className="remat-msg">{msg}</span>}
    </span>
  );
}

function AuditRail({ refreshSignal, schema, titles, onJump }: {
  refreshSignal: number; schema: SchemaView; titles: TitleMap; onJump: (type: string, pk: Value) => void;
}) {
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [notifs, setNotifs] = useState<{ id: number; message: string; at: string; link?: { objectType: string; pk: Value } }[]>([]);
  const lastTop = useRef<number>(0);
  const actionMeta = useMemo(() => new Map(schema.actionTypes.map(a => [a.apiName, a])), [schema]);

  /** 参数按 schema 的 displayName 渲染成可读键值行；对象引用翻名、枚举翻标签。 */
  const readableParams = (action: string, params: Record<string, Value>): { label: string; value: string }[] => {
    const meta = actionMeta.get(action);
    return Object.entries(params).map(([k, v]) => {
      const pdef = meta?.parameters.find(p => p.apiName === k);
      let value = String(v);
      if (pdef?.editor?.kind === 'objectRef') {
        const t = titles[pdef.editor.objectType]?.[String(v)];
        if (t && t !== value) value = `${value} ${t}`;
      } else if (pdef?.editor?.kind === 'enum') {
        const o = pdef.editor.options.find(op => op.value === String(v));
        if (o && o.label !== o.value) value = o.label;
      }
      return { label: pdef?.displayName ?? k, value };
    });
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
        <div className={`notif-item ${n.link ? 'linked' : ''}`} key={n.id}
          onClick={n.link ? () => onJump(n.link!.objectType, n.link!.pk) : undefined}
          title={n.link ? `点击查看 ${n.link.objectType}/${n.link.pk}` : undefined}
        >
          <div><span className="notif-text">{n.message}</span>{n.link && <span className="notif-arrow"> → 点击查看</span>}</div>
          <div className="time-full">{fmtTime(n.at)}</div>
        </div>
      ))}
    </aside>
  );
}

/* ---------- 概念地图：核心术语与闭环的集中解释 ---------- */
const CONCEPT_SECTIONS: { title: string; items: { term: string; en: string; cls: 'semantic' | 'kinetic' | 'flow'; body: string }[] }[] = [
  {
    title: '本体 = 名词 + 动词',
    items: [
      {
        term: '本体', en: 'Ontology', cls: 'flow',
        body: '把业务世界建模成「名词 + 动词」的一张活地图。数据不再是死表格，而是有身份、有关系、可操作的对象。左侧导航的两个分组就是它的全部：语义元素（名词）+ 动能元素（动词）。',
      },
      {
        term: '语义元素', en: 'semantic elements', cls: 'semantic',
        body: '世界里"有什么"：对象类型（股票/组合/持仓…）、属性（最新价/PE…）、链接（持仓↔股票）。官方就叫 semantic elements（语义元素），本站蓝色一律代表它。',
      },
      {
        term: '动能元素', en: 'kinetic elements', cls: 'kinetic',
        body: '对世界"能做什么"，分两种动词：Action（写入动词——受治理地改状态：调仓/设预警，走 参数校验→提交前提→原子写入→审计）；Function（只读动词——托管计算：估值/扫描，算不做）。注意：Action 和 Function 同属动能元素，没有第三层——区别只是一个"做"、一个"算"。金色一律代表动能。',
      },
    ],
  },
  {
    title: '数据怎么进来（血缘条左半段）',
    items: [
      {
        term: '数据接入', en: 'ingestion', cls: 'flow',
        body: '真实行情（科创板50）由对话里的 Claude 从数据源拉取、整理落成 datasets/*.csv。本系统引擎自身不联网——所以"拉新行情"要走对话，页面按钮管不了这一步。',
      },
      {
        term: 'Funnel 物化', en: 'materialization', cls: 'semantic',
        body: 'Funnel 直译"漏斗"——Palantir 里把数据集灌成本体对象的管道服务，宽口进原始数据、窄口出规整对象。物化 = 把 CSV 按 schema 搬进对象库：类型校验、脏值报告（14 家未盈利公司的 PE 如实置空、不造数）、幂等可重跑。为什么要这一步：CSV 只是碰巧对齐的文本，物化后才有主键身份、类型契约、链接关系，才能被安全地查询与写回。',
      },
    ],
  },
  {
    title: '决策怎么落地（血缘条右半段）',
    items: [
      {
        term: '写时合并 + 编辑重放', en: 'Apply User Edits', cls: 'kinetic',
        body: '你经 Action 做的每笔修改都记入编辑账本（底层 CSV 不动）。重新物化会重建底表、然后把账本一条条重放回来——所以行情换血后，你的组合/研判/预警一个不丢。',
      },
      {
        term: '审计', en: 'audit trail', cls: 'kinetic',
        body: '每次 Action 提交都留痕：谁、何时、什么参数、改了哪几条。右栏审计流就是它——决策可回放、可追责。',
      },
      {
        term: '闭环', en: 'closing the loop', cls: 'flow',
        body: '底部血缘条：数据集 → Funnel 物化 → 本体对象 → Action 决策 → 写回账本 → 审计。提交任何 Action 时它会流动点亮一次。"写回"这半环正是运营系统与纯分析系统（只读报表）的分界线。',
      },
    ],
  },
];

function ConceptMap({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="concept-overlay" onClick={onClose}>
      <div className="concept-drawer" onClick={e => e.stopPropagation()}>
        <div className="concept-head">
          <h2>◈ 概念地图</h2>
          <span className="subtitle" style={{ margin: 0 }}>Palantir Ontology 的核心词汇，与本页面各区域的对应</span>
          <button className="concept-close" onClick={onClose}>✕ 关闭</button>
        </div>
        {CONCEPT_SECTIONS.map(sec => (
          <div key={sec.title}>
            <div className="section-label">{sec.title}</div>
            {sec.items.map(c => (
              <div className={`concept-card ${c.cls}`} key={c.term}>
                <div className="concept-term">
                  <span className={`dot ${c.cls === 'kinetic' ? 'dot-kinetic' : 'dot-semantic'}`} style={c.cls === 'flow' ? { background: 'var(--muted)' } : undefined} />
                  {c.term}<span className="concept-en">{c.en}</span>
                </div>
                <div className="concept-body">{c.body}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
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

function LineageBar({ play, mode }: { play: number; mode: 'action' | 'materialize' }) {
  const [lit, setLit] = useState(-1);
  // 只点亮真实发生的半环，避免歧义：重物化=数据集→Funnel→本体；Action=本体→决策→写回→审计
  const [start, end] = mode === 'materialize' ? [0, 2] : [2, LINEAGE_NODES.length - 1];

  useEffect(() => {
    if (play === 0) return;
    let i = start;
    setLit(i);
    const t = setInterval(() => {
      i += 1;
      if (i > end) {
        clearInterval(t);
        setTimeout(() => setLit(-1), 1600);
      } else {
        setLit(i);
      }
    }, 240);
    return () => clearInterval(t);
  }, [play, start, end]);

  return (
    <footer className="lineage-bar">
      <span className="lineage-title">CLOSED LOOP</span>
      {LINEAGE_NODES.map((n, i) => {
        const nodeLit = lit >= 0 && i >= start && i <= lit;
        const arrowFlowing = lit >= 0 && i > start && i <= lit; // 箭头 i 连接节点 i-1 → i
        return (
          <span key={n.label} style={{ display: 'contents' }}>
            {i > 0 && (
              <span className={`lineage-arrow ${arrowFlowing ? `flowing ${mode === 'materialize' ? 'semantic-flow' : ''}` : ''}`}>→</span>
            )}
            <span title={n.tip} className={`lineage-node ${n.cls} ${nodeLit ? 'lit' : ''}`}>
              <span className="ring" />{n.label}
            </span>
          </span>
        );
      })}
    </footer>
  );
}

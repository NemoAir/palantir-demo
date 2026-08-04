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
  const [view, setView] = useState<View>({ kind: 'list', type: 'Stock' });
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [lineagePlay, setLineagePlay] = useState(0);
  const [auditKey, setAuditKey] = useState(0);
  const [fatal, setFatal] = useState<string | null>(null);

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
          <span><span className="dot dot-semantic" />语义（名词）对象 {schema.objectTypes.length} · 链接 {schema.linkTypes.length}</span>
          <span><span className="dot dot-kinetic" />动能（动词）Action {schema.actionTypes.length} · Function {schema.functions.length}</span>
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
          <div className="group-label" style={{ marginTop: 14 }}>动能层 · Action</div>
          {schema.actionTypes.map(a => (
            <button
              key={a.apiName}
              className={`nav-item kinetic ${view.kind === 'action' && view.name === a.apiName ? 'active' : ''}`}
              onClick={() => setView({ kind: 'action', name: a.apiName })}
            >
              <span className="dot dot-kinetic" />{a.displayName}
            </button>
          ))}
        </nav>

        <main className="content">
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

        <AuditRail refreshSignal={auditKey} />
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
        <select value={fProp} onChange={e => setFProp(e.target.value)}>
          {ot.properties.map(p => <option key={p.apiName} value={p.apiName}>{p.displayName}</option>)}
        </select>
        <select value={fOp} onChange={e => setFOp(e.target.value)}>
          {['<', '<=', '>', '>=', '=', '!=', '~', '=null', '!=null'].map(o => <option key={o}>{o}</option>)}
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
    .map(a => ({ a, prefill: prefillFor(a, type, pk) }))
    .filter(x => Object.keys(x.prefill).length > 0);

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
function AuditRail({ refreshSignal }: { refreshSignal: number }) {
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [notifs, setNotifs] = useState<{ id: number; message: string; at: string }[]>([]);
  const lastTop = useRef<number>(0);

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
            <span className="action-name">{a.action}</span>
            <span className="id">#{a.id}</span>
            <span className="time">{a.at.slice(11, 19)}</span>
          </div>
          <div className="params">{JSON.stringify(a.params)}</div>
        </div>
      ))}
      <div className="rail-title" style={{ marginTop: 18 }}>通知 NOTIFICATIONS</div>
      {notifs.map(n => <div className="notif-item" key={n.id}>{n.message}</div>)}
    </aside>
  );
}

/* ---------- 签名元素：闭环血缘条 ---------- */
const LINEAGE_NODES = [
  { label: '数据集', cls: 'semantic' },
  { label: 'Funnel 物化', cls: 'semantic' },
  { label: '本体·对象/链接', cls: 'semantic' },
  { label: 'Action 决策', cls: 'kinetic' },
  { label: '写回·编辑账本', cls: 'kinetic' },
  { label: '审计', cls: 'kinetic' },
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
          <span className={`lineage-node ${n.cls} ${lit >= 0 && i <= lit && i >= 2 ? 'lit' : ''}`}>
            <span className="ring" />{n.label}
          </span>
        </span>
      ))}
    </footer>
  );
}

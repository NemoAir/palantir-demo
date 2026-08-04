# M2 动能层 验收证据

- 验收日期：2026-08-04（深夜，连续执行模式）
- 自动化：**56 测试全绿** + `tsc --noEmit` 通过 + 引擎题材无关 grep 通过
- 验收依据：spec §9.3 M2 清单 5 项
- 结论：**5/5 通过**（含一处种子数据修正，见附录）

## 逐项证据（真实库 + 科创板50 真实数据）

### #1 tradeStock 买入 ✅

```
$ pnpm cli action tradeStock --param portfolioId=P1 --param stockCode=688012 --param side=buy --param quantity=100 --param price=317.74
✅ 模拟调仓 提交成功（2 项编辑）
  [create] Position/POS-P1-688012
  [set] Portfolio/P1.cash = 832487        # 864261 − 31774 = 832487 ✓
  [通知] 买入 中微公司(688012) 100股 @ 317.74
audit: #1 tradeStock edits=2
```

### #2 卖出超持仓拒绝 ✅

```
$ pnpm cli action tradeStock ... side=sell quantity=1000   （种子仅 500 股）
❌ 提交被拒（criteria: positionSufficient）：持仓数量不足以完成卖出
```

### #3 编辑在重物化后保全（Apply User Edits 端到端） ✅

```
addToWatchlist 688981 → ✅
改 stocks.csv：688981 价格改 999.99（模拟行情刷新）→ materialize（更新 50）
$ pnpm cli get Stock 688981
  latestPrice: 999.99,   # 源字段更新生效
  isWatched: 1           # 用户编辑仍在
（验收后 CSV 已 git checkout 还原真实数据并重物化）
```

### #4 portfolioValuation 与手工计算一致 ✅

```
引擎: cash=832487 mv=174659 assets=1007146 pnl=7146
手工: cash=832487.0 mv=174659.0 assets=1007146.0 pnl=7146.0   （python 直读 CSV 独立复算）
一致: True
```

### #5 预警链 + 审计 ✅

```
setAlert(688981, latestPrice<200) → ✅ create Alert/AL-1（armed）
fn checkAlerts → [{'alertId': 'AL-1', ...}]                    # 只读扫描命中
action markAlertTriggered AL-1 → ✅ status='triggered' + 通知   # 写入经系统 Action
audit: #4 markAlertTriggered / #3 setAlert / #2 addToWatchlist / #1 tradeStock  # 全程在案
```

## 附录：验收过程发现与修正

- **种子持仓 ID 与 Action 契约不一致**：positions.csv 原 id `POS1/POS2`，而 tradeStock 的持仓行约定 `POS-{组合}-{代码}`（一组合一股一行）——卖出种子持仓会因查不到持仓行被误拒。修正种子 id 为 `POS-P1-688981`/`POS-P1-688111`。教训：ID 生成约定是本体契约的一部分，种子数据必须遵守。

## M2 交付物清单

| 模块 | 文件 | 机制 |
|---|---|---|
| 类型扩展 | engine/src/types.ts | ActionTypeDef/FunctionDef/Edit/Criterion/ReadonlyContext |
| OMS 扩展 | engine/src/oms.ts | action/function 校验注册 |
| 编辑账本 | engine/src/store.ts | applyEdits 写时合并（物化+EAV 账本+审计同事务）、replayEdits |
| Funnel 挂钩 | engine/src/funnel.ts | 重物化自动重放 + missingColumns 缺列容忍 |
| Action 执行器 | engine/src/actions.ts | 参数→criteria→apply→原子提交→副作用 |
| Function 运行时 | engine/src/functions.ts | 只读逻辑托管 |
| 表达式解析 | engine/src/filter-parse.ts | CLI 与条件属性共用 |
| 题材动能层 | ontology/astock.actions.ts / astock.functions.ts | 6 Action + 3 Function |
| CLI | engine/cli.ts | action/fn/audit/notifications 命令 |

# M2 动能层 实现计划（精简版）

> 形式说明：用户授权 M2-M5 连续一次性执行，本计划做任务分解+接口契约+验收标准（不含全量代码，代码在 TDD 实现中产生并逐任务 commit——与 M1 全代码计划的差异是执行模式差异所致，行为契约同样由"先失败测试"锁定）。

**Goal:** 引擎获得受治理的写路径（Action 管线：参数校验→submission criteria→edits→原子事务→审计→副作用）与只读逻辑层（Function 运行时）；编辑与源数据分离、重物化不丢编辑；astock 本体挂上 6 Action + 3 Function；通过 spec §9.3 M2 五项验收。

**核心架构决策——写时合并 + 重放（对应 Foundry OSv2"编辑直接索引进后端"）：**
- Action 产生的 edits **同事务**做两件事：① 记入 `object_edits` 账本（EAV：objectType/pk/property/value，主键三元组，后写覆盖）② 直接 UPDATE/INSERT `obj_<Type>` 物化表。
- 查询路径（OSS/store.get）**零改动**——物化表永远是合并后的最新状态（读己之写天然成立）。
- Funnel 重物化时对每个类型：源数据 upsert 后**重放**该类型全部 edits 覆盖 → "Apply User Edits"语义（已编辑属性以编辑为准，无论源数据怎么刷新）。
- 纯编辑型对象（无 datasource）：创建 = INSERT 物化表 + 账本记 create 类型 edits；不受重物化影响（无源数据覆盖）。
- 审计 `audit_log`：每次 Action 提交一条（actionApiName/params JSON/edits 明细 JSON/时间戳），与 edits 同事务。

## 任务分解（每任务 TDD + commit）

| # | 任务 | 接口契约（Produces） | 测试要点 |
|---|---|---|---|
| 1 | types+OMS 扩展 | `ActionTypeDef{apiName,displayName,parameters:ParamDef[],criteria:CriterionDef[],apply,sideEffects?}`、`FunctionDef{apiName,displayName,parameters,logic}`；`OntologySchema` 增 `actionTypes?/functions?`；OMS 校验（apiName 规则/重名/参数名合法）注册 `actionType()/functionDef()` | zoo 夹具加 feedAnimal action + heaviestAnimal function；非法 action 名被拒 |
| 2 | store edits+audit | `applyEdits(edits: Edit[], audit: AuditEntry): void`（同事务：账本 EAV upsert + 物化表写入 + audit_log 插入）；`Edit = {objectType,pk,property,value} \| {kind:'create',objectType,pk,values}`；`listAudit(limit)`；`editsFor(objectType)` | 编辑落账本+物化表同步；create 建新对象；事务原子性（坏 edit 全回滚） |
| 3 | Funnel 重放 | `materializeCsv` 完成 upsert 后调用 `store.replayEdits(objectType)`（账本按 updatedAt 顺序覆盖物化表） | 编辑后改 CSV 重物化：源字段更新、编辑字段保持（Apply User Edits 实证） |
| 4 | actions 执行器 | `ActionService.execute(apiName, params): ActionResult`；管线：参数类型/必填校验 → criteria 逐条求值（fail 返回 `{ok:false, failedCriterion, message}` 不落库）→ `apply(ctx,params)` 产 edits → `store.applyEdits` → sideEffects（通知落 `notifications` 表）；`ActionContext = {get, query}` 只读 | 成功路径/参数类型错/criteria 拒绝（返回名称）/副作用落表 |
| 5 | functions 运行时 | `FunctionService.call(apiName, params): unknown`；只读 ctx；未注册报错 | 注册函数可调、拿到正确计算结果 |
| 6 | astock 动能层 | `ontology/astock.actions.ts`（6 Action：addToWatchlist/tradeStock/writeResearchNote/setAlert/resolveAlert/markAlertTriggered）+ `ontology/astock.functions.ts`（3 Function：portfolioValuation/screenStocks/checkAlerts）；Stock 增 `isWatched` 编辑属性（nullable boolean，无源列——源 CSV 无此列，Funnel 需容忍 schema 属性缺列=全 null） | tradeStock 买/卖资金持仓校验、researchNote 创建带链接可遍历、alert 状态机 |
| 7 | CLI 扩展 + M2 验收 | `pnpm cli action <name> --param k=v`、`pnpm cli fn <name>`、`pnpm cli audit`；spec §9.3 M2 五项逐项执行附证据归档 `docs/acceptance/m2-evidence.md` | 五项验收全过 |

## 显式简化
- 通知（side effect）只落 `notifications` 表不真推送（spec §6 既定）。
- 无 scenario 沙箱/权限（spec §6 既定）。
- Funnel 容忍"schema 属性在 CSV 无对应列"（新增编辑属性场景）：该列全 null，不计 nulled 报告（列缺失≠单元格脏值，记入 report 新字段 `missingColumns`）。

## M2 验收标准（spec §9.3 M2，五项）
1. tradeStock 买入某科创股 → Position 新增、Portfolio 现金相应减少、审计 +1
2. tradeStock 卖出超持仓数量 → 拒绝提交，返回未通过的 criteria 名称
3. 改 stocks.csv 某股价格后重物化 → 行情更新，且此前用户编辑（isWatched 等）仍在
4. portfolioValuation 输出与手工计算一致
5. checkAlerts → markAlertTriggered：满足条件的 Alert 状态变为已触发且有审计

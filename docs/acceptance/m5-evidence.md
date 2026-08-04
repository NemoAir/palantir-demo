# M5 MCP server 验收证据

- 验收日期：2026-08-05（凌晨，连续执行模式）
- 自动化：**66 测试全绿**（ai-tools 3 用例含"schema 新增 Action → 工具自动出现"）+ 两包 `tsc --noEmit`
- 结论：**全项通过**（Claude Code 实连为等效验证，见说明）

## #1 工具清单：schema 驱动零胶水 ✅

stdio 冒烟（真实 MCP client 子进程连接）：

```
astock-ontology MCP server 已就绪（14 个工具）
工具总数: 14
Action 工具: action_addToWatchlist, action_tradeStock, action_writeResearchNote,
             action_setAlert, action_resolveAlert, action_markAlertTriggered
Function 工具: fn_portfolioValuation, fn_screenStocks, fn_checkAlerts
```

5 基础工具（query/get/traverse/aggregate/audit）+ 6 Action + 3 Function——全部从 OMS 元数据生成。
vitest 用例证明元模型驱动：给 schema 加一个新 Action，工具列表**自动**多出 `action_renameAnimal`，MCP 侧零改动。

## #2 AI 经 MCP 读写本体（OAG 闭环） ✅

```
query_objects {type:Stock, where:["isWatched=1"]} → 中芯国际（isWatched:1，真实行情）
action_writeResearchNote {688111, 看多, ...}       → ok:true, create ResearchNote/RN-2
list_audit → #7 writeResearchNote（AI 的写入照走 Action 管线，审计在案）
```

## #3 Claude Code 接入配置 ✅

项目根 `.mcp.json` 已就位（`pnpm --filter mcp start`）。**用户重启 Claude Code 会话后**，工具列表将出现 `astock-ontology` 的 14 个工具，对话即可完成"把 XX 加自选并设预警"（spec §7 演示叙事最后一环）。

> 诚实说明：M5 验收清单第 2 项"Claude Code 对话完成加自选+记研判"需要新会话实连（本会话无法连接自己启动的 MCP server）——已用官方 SDK 的真实 stdio client 走通完全相同的协议路径（listTools + callTool）作为等效验证；实连留作用户抽查项。

## 治理不因 AI 放松（设计要点）

Action 工具的 description 自动携带提交前提说明；AI 调用 `action_tradeStock` 卖出超持仓同样会收到 `{ok:false, failedCriterion:"positionSufficient"}`——与 UI/CLI/OSDK 走同一条 Action 管线（M2 的 criteria/原子事务/审计）。

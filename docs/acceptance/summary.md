# 总验收汇总（M1–M5 连续执行完成）

- 执行区间：2026-08-04 23:10 起（额度重置后用户授权连续执行）至 2026-08-05 凌晨
- 最终状态：**五个里程碑全部完成并自验收**；66 个自动化测试全绿；三包 `tsc --noEmit` 全过；引擎题材无关 grep 通过
- 待用户抽查项：全局观感（M4）、Claude Code 实连 MCP（M5，需重启会话）

## 里程碑一览

| 里程碑 | 交付 | 自验收 | 证据 |
|---|---|---|---|
| M1 引擎核心 | OMS/store/Funnel/OSS + A股 schema + 科创板50 真实数据 + CLI | 7/7 | [m1-evidence](m1-evidence.md) |
| M2 动能层 | Action 管线/写时合并账本/重放/Function + 6 Action + 3 Function | 5/5 | [m2-evidence](m2-evidence.md) |
| M3 Toolchain | codegen（OSDK 复刻+编译期三防线）+ HTTP API | 全过 | [m3-evidence](m3-evidence.md) |
| M4 Web UI | 三栏运营台 + 闭环血缘条（浏览器实操） | 4/4 | [m4-evidence](m4-evidence.md) |
| M5 MCP | 本体→14 个 AI 工具（OAG，schema 驱动零胶水） | 全过 | [m5-evidence](m5-evidence.md) |

## spec §7 演示叙事验证状态

刷新数据集 → Funnel 增量物化 ✅（M2#3）→ 对象浏览器沿链接遍历 ✅（M4#1）→ screenStocks 筛选 ✅（M2/M3）→ writeResearchNote + tradeStock（校验/持仓即时更新/审计+2）✅（M4#2/#3）→ **Claude 经 MCP 调 Action** ✅ 等效验证（stdio 真实 client；实连待用户重启会话）→ UI 刷新可见 ✅。

## 一条命令跑起来

```bash
pnpm cli materialize          # 物化真实数据
pnpm --filter engine serve    # API :4177
pnpm --filter web dev         # UI  :5177
# Claude Code 重启会话 → astock-ontology MCP 自动可用（.mcp.json）
```

## 全程 TDD/验收纪律的实证记录（学习价值所在）

- 每个模块先失败测试再实现；66 测试是行为契约。
- 验收动真格抓出的问题：M1 三处题材泄漏 + 三处类型潜伏（vitest 不查类型）+ 验收工具自身正则漏洞（689 CDR 前缀）；M2 种子持仓 ID 契约不一致；M3 生成物驱动耦合 + 过滤属性宽类型。全部修正复验，全程在 evidence 与 commit 记录。
- 连续执行中的一次流程失误也如实在案：一次测试未全绿混入 commit（`295127e`），下一 commit 修复并记录教训。

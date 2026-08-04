# CLAUDE.md — palantir-demo（A股投研运营台 · 迷你 Foundry）

> 项目级规则，叠加于全局 `~/.claude/CLAUDE.md`（实质完成原则 / 工具返回真实性 / 状态记忆层全部适用，此处不重复）。

## 项目是什么

本地复刻 Palantir Foundry Ontology 思想的学习+演示项目：**声明式 Schema + 题材无关本体引擎 + React UI + MCP AI 层**，题材为 A股投研（数据域：科创板50 成分股，真实数据）。核心学习目标：跑通"数据→本体→决策→Action 写回→状态更新"闭环（运营系统 vs 分析系统的分界）。

## 会话必读与按需文档

- `PROGRESS.md` —— 当前焦点/任务树/游标（warm-up 首读，全局规则已要求）
- `docs/superpowers/specs/2026-08-04-astock-ontology-design.md` —— 设计规格（§4 本体模型、§9 验收清单）
- `docs/superpowers/plans/` —— 当前里程碑实现计划（逐任务 TDD，含完整代码）
- `docs/ontology-research.md` —— Ontology 调研报告（概念的一手依据，✔3=对抗验证）
- `docs/learning/01-engine-modules.md` —— 引擎模块详解（术语表在文末）

## 硬约束（违反即返工）

1. **引擎题材无关**：`packages/engine/src` 禁止出现任何题材词汇（stock/portfolio/industry 等）——题材只存在于 `ontology/` 与 `datasets/`；验收含 grep 检查。
2. **标识符防线**：所有 schema `apiName` 必须匹配 `^[A-Za-z][A-Za-z0-9_]*$`（OMS 强制）；动态 SQL 标识符只取自注册元数据，值一律参数绑定。
3. **脏数据不静默丢弃**：Funnel 对缺主键/坏值必须产出 `skipped`/`nulled` 报告；科创板未盈利企业 PE 空值是真实数据，如实置空、不造数。
4. **TDD**：先写失败测试→确认失败→最小实现→确认通过→commit；实现计划中的测试是行为契约，不得为凑通过改测试。
5. **验收流程**（spec §9.1）：自动化测试全绿 → 逐项人工验收附证据（`docs/acceptance/`）→ 用户抽查 → 才在 PROGRESS 标 ✅。
6. **数据接入边界**：真实数据只由 Claude 会话拉取、落 `datasets/*.csv`——渠道：本机金融技能（hithink/mx 系列）为主，问财 OpenAPI 为备（`IWENCAI_BASE_URL`/`IWENCAI_API_KEY` 见 `~/Documents/Projects/NemoAir/claude-config/secrets/investment-research.env`，经环境变量使用、**key 永不写入本仓库**）；引擎代码不做任何网络请求。

## 常用命令

```bash
pnpm --filter engine test      # 引擎全部测试
pnpm cli load                  # 本体注册摘要
pnpm cli materialize           # 物化 datasets/（含脏行报告）
pnpm cli query Stock --where "pe<50" --order-by pe
pnpm cli traverse Stock 688981 industry
```

## git 规范

中文 commit message：标题写"改了什么"（带 m1/m2 里程碑前缀，如 `feat(m1):`），正文写"为什么+关键结论"；atomic commit，一任务一提交；一律 `--no-pager`（仓库已设 `core.pager=cat`）。

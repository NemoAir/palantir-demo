# PROGRESS — palantir-demo（Palantir 本体论学习与实战）

## 当前焦点
阶段 4 前置：writing-plans 制定实现计划（spec 已获用户审阅通过并按反馈修订）。计划产出后按 M1→M5 里程碑实现。

## 全景任务清单
- ✅ ① 调研 Palantir Ontology（139 论断 → 25 条对抗验证 75 票 0 反对 → 9 组 high 置信发现；骨架页亲验；报告 `docs/ontology-research.md`）
- ✅ ② 题材拍板：A股投研运营台 + 迷你 Foundry 全栈（引擎+Web UI+MCP AI 层）——用户 2026-08-04 选定
- ✅ ③ 实战方案设计：brainstorming 逐节确认 → spec 落盘 → 用户审阅并反馈三点（数据域改科创板50 / 引擎详解学习笔记 / 验收方案细化）→ 已全部修订入库（4e5d643）
- 🔄 ④ writing-plans 制定实现计划（进行中）
- ⬜ ⑤ M1 引擎核心（OMS + store + funnel + oss + CLI 冒烟）
- ⬜ ⑥ M2 动能层（actions + edits 分离/合并 + 审计 + functions）
- ⬜ ⑦ M3 Toolchain（codegen + HTTP API）
- ⬜ ⑧ M4 Web UI（对象浏览器/Action 面板/审计流）
- ⬜ ⑨ M5 MCP server（Claude Code 直连，OAG 演示）

## 关键决策与依据（全记录见 spec §2）
- 技术栈：TypeScript 全栈（Node 引擎 + React UI + SQLite）——用户为 iOS 开发者，TS 与 Swift 类型系统同构；与 OSDK 官方语言一致。
- 架构：声明式 Schema + 题材无关通用引擎——Palantir 精髓是元模型驱动（OMS 存 schema）；engine 不得出现题材词汇。
- AI 层：MCP server——复刻官方 Ontology MCP（2026-01）与 OAG 思想；Claude Code 直连免 API key。
- 数据域：**科创板50 成分股**（用户 2026-08-04 由沪深300前50 改定）+ 申万一级行业；含未盈利企业（PE 空值）是 Funnel 脏数据处理的天然素材。
- 验收：每里程碑"自动化测试全绿 → 逐项人工验收附证据 → 用户抽查 → 才 commit 标 ✅"（spec §9 有逐项清单）。
- 调研阶段补救决策：验证限额全灭后先亲验骨架页+置信分级落盘，用户升级套餐后 resume 补全对抗验证。

## 已验证结论
- core-concepts / why-ontology 两骨架页逐字亲验通过；resume 后 108/108 验证代理成功，75 票 0 反对——2026-08-04 实查。
- 验证带回并已并入报告的新一手信息：官方明确否认"薄语义层"、Language/Engine/Toolchain 三分、OAG、cybernetic enterprise / decision graph、决策数据。
- deep-research journal 可复用：resumeFromRunId=wf_16751943-8db。

## 未决 / 坑
- 【环境坑】macOS TCC：Claude.app（com.anthropic.claudefordesktop）对"文稿文件夹"的授权在应用重启后曾丢失（整个 ~/Documents EPERM）→ 修复：系统设置开完全磁盘访问 / `tccutil reset SystemPolicyDocumentsFolder com.anthropic.claudefordesktop` 后重授权。再遇 EPERM 先查这里。
- 数据拉取依赖会话内金融技能（hithink/mx 系列）：仅 Claude 会话可调，产出落 `datasets/*.csv`；引擎侧不做任何网络拉数。

## 下一步 / 游标
1. writing-plans 产出实现计划（含每任务验证步骤）→ 用户过目
2. M1 动工（按计划逐任务 TDD）

## 关键文件索引
- `docs/ontology-research.md` —— 调研报告（对抗验证版，✔3/✅/◐/○ 置信分级）
- `docs/superpowers/specs/2026-08-04-astock-ontology-design.md` —— 设计规格（科创板50 修订版，§9 验收清单）
- `docs/learning/01-engine-modules.md` —— 引擎六模块详解学习笔记（业务小白版 + iOS 类比 + 术语表）

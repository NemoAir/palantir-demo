# PROGRESS — palantir-demo（Palantir 本体论学习与实战）

## 当前焦点
阶段 1：调研报告初稿已落盘 `docs/ontology-research.md`；deep-research 验证阶段 resume 中（首跑时 75 个验证代理因账号限额全灭，用户升级套餐后重跑），结果回来后升级报告置信标注。

## 全景任务清单
- 🔄 ① 调研 Palantir Ontology（搜索/抓取 ✅ 139 条论断；骨架页亲验 ✅；对抗验证 resume 中）
- ⬜ ② 选定实战题材（候选已备：A股投研 / 航空运营 / Titan 供应链，需用户拍板）
- ⬜ ③ 实战方案设计（本体建模 + 技术选型 + 验收标准）
- ⬜ ④ 分阶段实现与验证

## 关键决策与依据
- 验证阶段限额全灭后的补救：不盲信抓取结果，亲验两个骨架页（core-concepts、why-ontology 逐字核对）+ 报告按 ✅/◐/○ 显式标注置信度；用户指示后再 resume 完整验证。
- 修正一处过度表述：官方并未逐字写"Ontology 不是语义层"，准确表述为避免自称 semantic layer + Akshay 博客的 not a "thin semantic layer"。

## 已验证结论
- 项目为全新空仓库（仅 .git，无提交）——2026-08-04 实查。
- core-concepts 页概念定义与 Dataset↔Object type 映射表逐字核验通过；why-ontology 页决策四要素/行动闭环/名词动词隐喻逐字核验通过——2026-08-04 WebFetch 亲验。
- deep-research 工作流 journal 可复用：34 个成功代理结果在 `journal.jsonl`，resumeFromRunId=wf_16751943-8db。

## 未决 / 坑
- 实战题材未定：需结合研究结论 + 用户兴趣对齐（用户环境装有大量 A 股/港股金融数据技能，金融题材有真实数据源加持；Palantir 官方经典案例为供应链 Titan、航空 Skywise 等）。
- 实战形态未定：纯本地复刻（自建迷你 ontology 引擎）vs 概念学习文档 vs 交互式演示应用——待题材确定后一并对齐。

## 下一步 / 游标
1. 等 deep-research 完成 → 报告落盘 `docs/ontology-research.md`
2. 基于报告提出题材候选 → 用户拍板
3. 认知对齐（unknowns 体检）→ 实战方案设计

## 关键文件索引
- `docs/ontology-research.md` —— Ontology 调研报告（待生成）

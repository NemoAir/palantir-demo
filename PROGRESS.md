# PROGRESS — palantir-demo（Palantir 本体论学习与实战）

## 当前焦点
🏁 M1–M5 + 迭代批 A–O 三轮全部完成（2026-08-06 深夜）。第三轮批J–O：血缘分段动画、决策活动页（offset 分页）、概念页+SQLite 数据流图、objectRef 预览卡、Function 结果 KPI 化、**Web AI 对话入口**（chat-bridge 双驱动：无 key→本机 claude CLI 订阅 / 有 ANTHROPIC_API_KEY→SDK runloop，curl 实测 2 次全通）、根 README（本体论思考 8 条+架构图，为 public 就绪、全仓无求职表述）。77 测试全绿。本会话另实证 MCP 链条（RN-5 写入+审计 #23）。

## 全景任务清单
- ✅ ① 调研 Palantir Ontology（139 论断 → 25 条对抗验证 75 票 0 反对 → 9 组 high 置信发现；骨架页亲验；报告 `docs/ontology-research.md`）
- ✅ ② 题材拍板：A股投研运营台 + 迷你 Foundry 全栈（引擎+Web UI+MCP AI 层）——用户 2026-08-04 选定
- ✅ ③ 实战方案设计：brainstorming 逐节确认 → spec 落盘 → 用户审阅并反馈三点（数据域改科创板50 / 引擎详解学习笔记 / 验收方案细化）→ 已全部修订入库（4e5d643）
- ✅ ④ writing-plans 制定 M1 实现计划（068ac98，10 任务 TDD 全代码）
- ✅ ⑤ M1 引擎核心（Task1-10 全部完成：脚手架/类型/OMS/schema/store/Funnel/OSS/真实数据/CLI/验收 7/7；26 测试全绿 + tsc 全量通过；待用户抽查）
- ✅ ⑥ M2 动能层：Action 管线/写时合并账本/重放/Function 运行时/6 Action+3 Function/CLI 扩展——56 测试全绿，验收 5/5（`docs/acceptance/m2-evidence.md`）
- ✅ ⑦ M3 Toolchain：codegen（类型化 OSDK+编译期三防线）+ HTTP API（题材无关 REST）——63 测试全绿（`docs/acceptance/m3-evidence.md`）
- ✅ ⑧ M4 Web UI：三栏运营台（对象浏览器/详情链接遍历/Action 动态表单/审计流/闭环血缘条）——浏览器实操验收 4/4（`docs/acceptance/m4-evidence.md`，观感待用户终审）
- ✅ ⑨ M5 MCP：ai-tools（题材无关 OAG 核心，engine 测试覆盖）+ MCP 薄壳 + .mcp.json——14 工具 stdio 冒烟全通（`docs/acceptance/m5-evidence.md`）
- ✅ ⑩ 迭代批 A–E（第一轮反馈 11+10 条）：UI 修正/editor 元模型/新动词/通知与重物化/api-agent 示例——git 0ee700a..1d6f3b8
- ✅ ⑪ 迭代批 F–I（第二轮反馈 15 条）：概念自解释/引用可读化（titleProperty 等四元数据）/本体演进+自动迁移/活系统 claude -p 实跑——`docs/acceptance/iter-fghi-evidence.md`
- ✅ ⑫ 迭代批 J–O（第三轮反馈 9 条）：血缘分段动画/决策活动页(分页)/概念页+数据流图/引用预览卡/Function 结果友好化/Web AI 对话入口(双驱动桥实测)/根 README——`docs/acceptance/iter-jko-evidence.md`
- ✅ ⑬ 迭代批 P–Q（第四轮反馈 3 条）：Function 结果中文化(resultLabels 三级回退)/chat 桥收紧为纯操作员(disableAllHooks+disallowedTools+strict-mcp，修用户抓到的'子会话继承开发环境'缺陷)/多轮对话(conversationId 实测代词记忆)——evidence 同文件补录

## 关键决策与依据（全记录见 spec §2）
- 技术栈：TypeScript 全栈（Node 引擎 + React UI + SQLite）——用户为 iOS 开发者，TS 与 Swift 类型系统同构；与 OSDK 官方语言一致。
- 架构：声明式 Schema + 题材无关通用引擎——Palantir 精髓是元模型驱动（OMS 存 schema）；engine 不得出现题材词汇。
- AI 层：MCP server——复刻官方 Ontology MCP（2026-01）与 OAG 思想；Claude Code 直连免 API key。
- 数据域：**科创板50 成分股**（用户 2026-08-04 由沪深300前50 改定）+ 申万一级行业；含未盈利企业（PE 空值）是 Funnel 脏数据处理的天然素材。
- 验收：每里程碑"自动化测试全绿 → 逐项人工验收附证据 → 用户抽查 → 才 commit 标 ✅"（spec §9 有逐项清单）。
- 调研阶段补救决策：验证限额全灭后先亲验骨架页+置信分级落盘，用户升级套餐后 resume 补全对抗验证。

## 已验证结论
- M1 重做验收 7/7 通过（2026-08-04 晚，证据文档含命令实录）：50 只科创板50 真实数据物化、14 只亏损股 PE 置空走 nulled 报告、查询与 CSV 独立复算逐位一致、双向遍历正确、幂等、引擎零题材词汇。
- 验收抓出三处题材泄漏（含 cli.ts 位置的结构性问题）+ tsc 暴露三处类型问题，均修正复验（dc8ca00）——"验收清单真的能抓问题"得到实证。
- core-concepts / why-ontology 两骨架页逐字亲验通过；resume 后 108/108 验证代理成功，75 票 0 反对——2026-08-04 实查。
- 验证带回并已并入报告的新一手信息：官方明确否认"薄语义层"、Language/Engine/Toolchain 三分、OAG、cybernetic enterprise / decision graph、决策数据。
- deep-research journal 可复用：resumeFromRunId=wf_16751943-8db。

## 未决 / 坑
- 【回滚记录】2026-08-04 用户指令：reset --hard 068ac98 + git clean（丢弃 545c57b..c156339 共 11 个实施 commit，reflog 可恢复）；CLAUDE.md 按原内容重建并补问财备用数据源条款。
- 问财 OpenAPI 备用数据源：key 在 `claude-config/secrets/investment-research.env`（IWENCAI_BASE_URL/IWENCAI_API_KEY），经环境变量用、永不入库。
- 【环境坑】macOS TCC：Claude.app（com.anthropic.claudefordesktop）对"文稿文件夹"的授权在应用重启后曾丢失（整个 ~/Documents EPERM）→ 修复：系统设置开完全磁盘访问 / `tccutil reset SystemPolicyDocumentsFolder com.anthropic.claudefordesktop` 后重授权。再遇 EPERM 先查这里。
- 数据拉取依赖会话内金融技能（hithink/mx 系列）：仅 Claude 会话可调，产出落 `datasets/*.csv`；引擎侧不做任何网络拉数。

## 下一步 / 游标
1. 用户体验批 F–I 成果（刷新 :5177；看概念地图/预警列表可读化/调仓最新价提示/预警扫描一键落账）
2. 用户可选亲手激活：`./examples/daily-patrol.sh` 首跑（含写入，耗订阅额度）；launchd 定时（README 有命令）
3. 可选深化：行情自动拉取脚本（问财 OpenAPI，key 走环境变量）、spec §6 远期项（Interface 多态 / scenario 沙箱 / 权限）、api-agent.ts 实跑（需 API 凭据）

## 关键文件索引
- `docs/ontology-research.md` —— 调研报告（对抗验证版，✔3/✅/◐/○ 置信分级）
- `docs/superpowers/specs/2026-08-04-astock-ontology-design.md` —— 设计规格（科创板50 修订版，§9 验收清单）
- `docs/learning/01-engine-modules.md` —— 引擎六模块详解学习笔记（业务小白版 + iOS 类比 + 术语表）

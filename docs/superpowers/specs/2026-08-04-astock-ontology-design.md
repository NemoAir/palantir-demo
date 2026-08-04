# 设计规格：A股投研运营台（迷你 Foundry / Palantir Ontology 复刻）

> 状态：已经用户逐节确认（2026-08-04 头脑风暴），待用户审阅本文档。
> 依据：[docs/ontology-research.md](../../ontology-research.md)（deep-research 对抗验证版调研报告）。

## 1. 背景与目标

用本地项目复刻 Palantir Foundry Ontology 的思想与核心机制，题材为 A股投研运营台。

**用途定位（用户拍板）**：学习深度优先 + 演示分享兼顾——每个 Ontology 机制亲手实现一遍；数据小而真（**科创板50 成分股**——上证科创板50成份指数（000688）的 50 只成分股 + 申万一级行业，经本机金融技能拉真实数据，后续可增删），不追求每日更新；界面要有观感、能承载概念叙事。

数据特性说明（科创板50，2026-08-04 用户改定）：成分集中于半导体、生物医药、新能源、高端装备等硬科技行业；**部分公司未盈利（PE 为负或缺失）**——这是 Funnel 缺失值/脏数据处理路径的天然真实素材（学习点，见 §9 M1 验收）；科创板涨跌幅限制 ±20%，仅作背景知识、不影响建模。

**成功标准**：跑通完整的 closed-loop 演示叙事（见 §7）——依据调研结论"闭合行动回路是运营系统区别于分析系统的分界线"，只建对象与关系不算复刻，闭环才算。

## 2. 已拍板决策

| 决策点 | 结论 | 依据 |
|---|---|---|
| 题材 | A股投研运营台 | 用户环境有整套 A股/港股数据技能，可喂真实数据；实体多/关系密/动作真 |
| 形态 | 迷你 Foundry 全栈（引擎+UI+AI 层） | 学习最完整 |
| 技术栈 | TypeScript 全栈：Node 引擎 + React（Vite）UI + SQLite | 用户为 iOS 开发者，TS 类型系统与 Swift 同构；与 OSDK 官方语言一致；一种语言贯穿 |
| 架构路线 | 声明式 Schema + 题材无关通用引擎 | Palantir 精髓：Ontology 是元模型（OMS 存 schema，引擎题材无关） |
| AI 层 | MCP server（本体查询 + Action 自动导出为工具） | 复刻官方 Ontology MCP（2026-01）与 OAG 思想；Claude Code 直连；免 API key |
| 存储 | SQLite（better-sqlite3） | 调研显示 Palantir 后端本质是重物化重索引的对象库而非图库；零依赖 |

## 3. 系统架构（对应官方 Language / Engine / Toolchain 三分）

```
palantir-demo/
├── ontology/                    # 【Language 层】声明式本体定义
│   └── astock.ontology.ts       #   对象/属性/链接/Action/Function 类型定义（纯声明）
├── packages/
│   ├── engine/                  # 【Engine 层】题材无关通用引擎
│   │   ├── oms/                 #   元数据服务：schema 加载/校验/注册
│   │   ├── store/               #   对象库：SQLite 物化存储（对象/链接/编辑/审计）
│   │   ├── funnel/              #   索引管道：datasets 文件 → 对象物化（幂等+增量）
│   │   ├── oss/                 #   查询服务：过滤/搜索/聚合/链接遍历/对象集
│   │   ├── actions/             #   Action 执行器：校验→提交→审计→副作用
│   │   └── functions/           #   Function 运行时：注册/执行 TS 业务逻辑
│   ├── codegen/                 # 【Toolchain 层】schema → 类型化 TS 客户端（OSDK 复刻）
│   ├── server/                  #   HTTP API（供 web 与外部消费）
│   ├── mcp/                     #   MCP server（查询 + Action 工具自动导出）
│   └── web/                     #   React UI：对象浏览器/详情/链接遍历/Action 面板/审计流
├── datasets/                    # 数据集区：CSV/JSON（真实数据落盘处）
└── docs/
```

约束：`engine` 不得 import 任何题材词汇——所有"股票"概念只存在于 `ontology/` 与 `datasets/`。换题材 = 换一份 schema + 一批数据集。

**数据接入方式**：用户环境的金融技能（hithink/mx 系列）是 Claude 会话内技能。实战时由 Claude 在会话中调技能拉真实数据、落成 `datasets/*.csv`；引擎 Funnel 从文件物化。这复刻了 Foundry 的 Data Connection → Dataset → Ontology 链路（Claude 会话扮演数据接入层）。

## 4. A股投研本体 v1（数据域：科创板50 成分股）

**对象类型（6）**

| 对象类型 | 主键 | 关键属性 | backing dataset |
|---|---|---|---|
| Stock | 股票代码 | 名称、行业码、最新价、市值、PE（可空——科创板含未盈利企业）、PB、自选标记 | stocks.csv（技能拉取科创板50成分股实况） |
| Industry | 行业码 | 申万一级行业名 | industries.csv（覆盖科创板50涉及的行业） |
| Portfolio | 组合 ID | 名称、初始资金、现金余额 | portfolios.csv（种子） |
| Position | 持仓 ID | 组合 ID、股票代码、数量、成本价 | positions.csv（种子，此后由 Action 编辑演化） |
| ResearchNote | 笔记 ID | 股票代码、结论（看多/看空/中性）、理由、日期 | 无源数据集——纯 Action 创建（学习点：object 可以只由编辑产生） |
| Alert | 预警 ID | 股票代码、条件表达式、阈值、状态 | 同上 |

**链接类型（5，全部双向、两侧有独立 API name）**：Stock→属于→Industry；Portfolio→持有→Position；Position→对应→Stock；ResearchNote→关于→Stock；Alert→盯住→Stock。
建模学习点：Position 是"带属性的多对多关系物化为中间对象"的经典手法。

**Action 类型（5，均含 parameters / submission criteria / rules / side effects 完整结构）**

| Action | 关键 submission criteria | edits | side effects |
|---|---|---|---|
| addToWatchlist | 股票存在且未在自选 | Stock.自选标记=true | 通知记录 |
| tradeStock（买/卖） | 买：现金 ≥ 金额；卖：持仓 ≥ 数量 | 增/改 Position、改 Portfolio.现金 | 通知记录 |
| writeResearchNote | 股票存在、结论合法 | 新建 ResearchNote + 链接 | — |
| setAlert | 条件表达式合法 | 新建 Alert + 链接 | — |
| resolveAlert | Alert 处于触发态 | Alert.状态=已处理 | 通知记录 |
| markAlertTriggered（系统） | Alert 处于待命态且条件满足 | Alert.状态=已触发 | 通知记录 |

Alert 状态机：`armed（待命）→ triggered（已触发）→ resolved（已处理）`。`markAlertTriggered` 是系统 Action：不出现在 UI 的用户 Action 面板，但走完整 Action 管线（校验/审计/副作用）——学习点：Foundry 的自动化同样经 Action 写回（调研报告 §3.5"受信流程可自动闭合行动回路"）。

**Function（3，全部只读计算，写入一律经 Action）**：portfolioValuation（组合估值：持仓×最新价 → 市值/收益）；screenStocks（条件选股 → 动态对象集）；checkAlerts（扫描预警，返回条件满足的 Alert 列表——由调用方对每条执行 markAlertTriggered）。

## 5. 核心机制复刻清单（学习点对照调研报告）

1. **元模型驱动**（报告 §3.0）：引擎行为全部由 OMS 加载的 schema 元数据驱动，不认识任何题材词汇。
2. **Funnel 物化**（§2.1 §3.2）：按官方映射表 Dataset→Object type、Row→Object、Column→Property、Join→Link type 物化；重跑幂等；增量刷新不丢用户编辑。
3. **编辑与源分离 + Apply User Edits**（§3.3）：编辑存独立 edits 表，永不改写源数据；合并视图按官方默认策略——已编辑属性以用户编辑为准；每笔编辑带审计（时间/Action/变更明细）。
4. **Action 完整结构**（§2.2）：parameters 类型校验 → submission criteria 不满足拒绝 → rules 产出 edits → 原子事务提交 → side effects。
5. **Function 运行时**（§1.2）：TS 函数注册进本体、可读对象集、被 UI/MCP 调用。
6. **OSDK codegen**（§3.4）：从 schema 生成 `client.objects.Stock.where(...)` / `client.actions.tradeStock({...})` 风格类型化客户端。
7. **OAG / MCP**（§3.5）：查询与全部 Action 自动导出为 MCP 工具；schema 新增 Action，Claude 端自动多一个工具。

## 6. 显式简化（YAGNI，文档注明对应官方机制，列为远期）

- 多用户权限 / Roles / dynamic security（单机单用户）
- 流式数据源、CDC（只做批式 Funnel）
- scenario 分支模拟、Interface 多态（v1 不做；Interface 若后续做可给 Stock/Fund 抽象"可交易标的"）
- 通知只落表不真推送

## 7. 端到端演示叙事（最终验收场景）

刷新科创板50行情数据集 → Funnel 增量物化 → Web 对象浏览器看 Stock（如中芯国际 688981），沿链接跳行业/持仓 → 跑 screenStocks 筛候选 → 对某股 writeResearchNote + tradeStock（校验通过，持仓即时更新，审计流 +2）→ Claude Code 对话"把 XX 加自选并设预警" → Claude 经 MCP 调 Action 完成 → UI 刷新可见。

## 8. 里程碑（每步独立验收，验收即 commit）

| 里程碑 | 内容 | 验收标准 |
|---|---|---|
| M1 引擎核心 | OMS + store + funnel + oss + CLI 冒烟 | 真实股票 CSV 物化进本体；CLI 查对象/遍历链接 |
| M2 动能层 | actions + edits 分离/合并 + 审计 + functions | 调仓闭环跑通；重物化后编辑仍在；非法提交被拒 |
| M3 Toolchain | codegen + HTTP API | 类型化 client 编译通过；demo 脚本走完查询+Action |
| M4 Web UI | 浏览器/详情/链接遍历/Action 面板/审计流 | 浏览器走完演示叙事前半段 |
| M5 MCP | MCP server + Claude Code 连接 | 对话完成"加自选+记研判"，UI 可见 |

## 9. 测试与验收方案（每个里程碑必过验收才算完成）

### 9.1 验收流程约定（对齐"实质完成原则"）

每个里程碑完成时：**① 自动化测试全绿 → ② 我逐项执行该里程碑的人工验收清单并附证据（命令输出/截图）→ ③ 交你抽查 → ④ 通过后 commit 并在 PROGRESS 标 ✅**。未过验收不进下一里程碑；验收失败的项如实报告、修复后重验。

### 9.2 自动化测试（vitest）

- 单测：schema 校验（非法 schema 报错带定位）、物化幂等、Apply User Edits 合并策略、Action 拒绝路径、Function 求值。
- 端到端：种子数据 → 调仓 → 断言合并视图与审计流。
- 每个里程碑合入前全量测试通过。

### 9.3 里程碑人工验收清单

**M1 引擎核心**
| # | 操作 | 预期 |
|---|---|---|
| 1 | `pnpm test` | 全绿 |
| 2 | CLI 加载本体 | 列出 6 个对象类型、5 个链接类型的注册摘要 |
| 3 | CLI 物化 datasets | 报告 50 只 Stock、N 个 Industry；脏行报告列出未盈利企业 PE 空值的处理方式（置空，非丢行） |
| 4 | CLI 条件查询（如 PE 有值且 <50） | 结果与 CSV 手工核对一致 |
| 5 | CLI 链接遍历：某 Stock → 所属 Industry | 正确返回 |
| 6 | 重跑物化 | 对象数不变（幂等） |

**M2 动能层**
| # | 操作 | 预期 |
|---|---|---|
| 1 | tradeStock 买入某科创股 | Position 新增、Portfolio 现金相应减少、审计 +1 |
| 2 | tradeStock 卖出超持仓数量 | 拒绝提交，返回未通过的 criteria 名称 |
| 3 | 改 stocks.csv 某股价格后重物化 | 行情更新，且此前的用户编辑（自选标记等）仍在（合并策略生效） |
| 4 | portfolioValuation | 输出与手工计算一致 |
| 5 | checkAlerts → markAlertTriggered | 满足条件的 Alert 状态变为已触发且有审计 |

**M3 Toolchain**
| # | 操作 | 预期 |
|---|---|---|
| 1 | codegen 后 `tsc` | 生成的类型化 client 编译通过 |
| 2 | demo 脚本（类型化查询 + 执行 Action） | 跑通，类型错误在编译期暴露（演示：故意写错属性名编译报错） |
| 3 | HTTP API curl 冒烟 | 查询与 Action 端点正常 |

**M4 Web UI**
| # | 操作 | 预期 |
|---|---|---|
| 1 | 对象浏览器 | 列表/筛选/详情正常，链接可点击跳转 |
| 2 | Action 面板 | 成功路径与失败路径（校验拒绝提示原因）都正确呈现 |
| 3 | 审计流 | 实时反映最近操作 |
| 4 | 观感 | 你亲自过目认可（演示分享标准） |

**M5 MCP**
| # | 操作 | 预期 |
|---|---|---|
| 1 | Claude Code 连接 MCP server | 工具列表含对象查询 + 全部 6 个 Action |
| 2 | 对话："把 XX 加自选并设 20 日均线预警" | Claude 调工具完成，Web UI 刷新可见 |
| 3 | schema 新增一个测试 Action 后重启 | MCP 工具列表自动多一个（元模型驱动终极演示） |

**最终验收** = §7 演示叙事一镜到底走通。

### 9.4 错误处理原则

schema 加载 fail-fast 带定位；Action 失败返回结构化原因（哪条 criteria 未过）；Funnel 脏行/缺失值（如科创板未盈利企业的空 PE）按 schema 声明的空值策略处理并出报告，不静默丢弃。

## 10. 非目标

不做实盘交易、不接实时行情推送、不做投资建议功能——组合为模拟盘，定位是本体论学习载体。

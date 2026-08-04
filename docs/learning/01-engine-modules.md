# 学习笔记 01：引擎六模块详解（业务小白版）

> 配套设计规格 §3。目标：不写一行代码之前，先把每个模块"是什么、为什么、对应 Palantir 什么"讲透。
> 读者设定：熟悉 iOS 开发（Swift/Core Data），不熟后端与数据工程——所以每个概念都给"生活比喻 + iOS 类比"双通道。

## 0. 一条数据的完整旅程（先看全景再看模块)

```
【科创板50 CSV 文件】                        （原料仓库）
      │
      ▼  Funnel 搬运+规整（按 schema 映射）
【对象库 store】Stock/Industry 对象           （规整后的货架）
      │
      ▼  OSS 查询（过滤/聚合/沿链接走）
【Web UI / CLI / MCP】你看到并操作            （店面）
      │
      ▼  你点"买入" → Action 执行器
【校验 → 记 edits → 审计留痕】                （收银台+监控录像）
      │
      ▼  合并视图（源数据 + 你的编辑）
【下一次查询看到的就是最新状态】               （闭环完成）
```

一句话分工：**schema 定义世界 → OMS 看管定义 → Funnel 搬数据 → store 存数据 → OSS 管读 → actions 管写 → functions 管算**。

## 1. 先解释贯穿一切的词：schema（模式/蓝图）

- **是什么**：对"数据长什么样"的正式定义。比喻：Excel 表的**表头 + 填表须知**——"这张表叫 Stock，有代码、名称、价格三列，代码不能重复不能空（主键）"。schema 不含数据本身，只含规则。
- **本项目**：`ontology/astock.ontology.ts` 一个文件，用声明的方式写下全部对象类型、属性、链接类型、Action 类型。
- **iOS 类比**：Core Data 的 `.xcdatamodeld` 模型文件——你在 Xcode 里拖 Entity/Attribute/Relationship，框架据此建表。我们的 schema 就是它的纯代码版。
- **对应 Palantir**：Ontology Language（官方三分法的"语言"层——描述语义元素 + 动能元素的语言）。
- **主键（primary key）**：唯一身份证。Stock 的主键是股票代码（688981 全世界只有一个中芯国际）。Funnel 靠它判断"这行 CSV 是新对象还是老对象的更新"。

## 2. OMS —— Ontology Metadata Service（本体元数据服务）

- **是什么**：schema 的看管者。启动时读取 schema 文件 → 检查合法性（每个对象类型有主键吗？链接两端指向的类型存在吗？Action 引用的属性拼对了吗？）→ 注册进系统，供其他模块随时查询"世界上有哪些类型"。
- **元数据（metadata）**："关于数据的数据"。中芯国际股价 85 元是**数据**；"Stock 有个属性叫最新价、类型是数字"是**元数据**。
- **为什么要单独一个模块**：这是"引擎题材无关"的命门。store 建表前问 OMS、Funnel 搬数前问 OMS、UI 渲染表单前问 OMS——**所有模块都照着元数据干活，没有一行代码写死"股票"**。哪天想换成航空题材，换一份 schema 引擎照跑。
- **iOS 类比**：`NSManagedObjectModel` 的加载与校验——Core Data 启动时读模型文件，模型不合法直接崩给你看（我们也一样：fail-fast）。
- **对应 Palantir**：同名服务 OMS（调研报告 §3.2 微服务五件套之一，"定义对象/链接/操作类型等本体实体元数据"）。

## 3. store —— 对象库（存储层）

- **是什么**：真正保存数据的地方（一个 SQLite 文件）。分四个区：**对象区**（Funnel 搬进来的源数据）、**链接区**（对象间关系）、**编辑区 edits**（你通过 Action 做的每一笔改动）、**审计区 audit**（谁在什么时候干了什么）。
- **最重要的设计：源数据与编辑分开存**。你把中芯国际标为自选，不是改写"对象区"里的那一行，而是在"编辑区"记一笔"688981.自选=true"。读取时把两区**合并**给你看。为什么？——下次行情数据刷新重跑 Funnel，对象区被新数据覆盖，**你的编辑毫发无损**。这就是 Palantir writeback 机制的地基（官方默认合并策略就叫 **Apply User Edits**：已编辑的属性永远以你的编辑为准）。
- **物化（materialization）**：把数据真实地存成可快速查询的形态（而不是每次用时现从 CSV 算）。比喻：把散装原料预先分装上货架，随取随用。调研结论：Palantir 后端本质是"重物化、重索引的对象库"，我们跟随。
- **iOS 类比**：Core Data 的 SQLite persistent store。"编辑区"思想类似 `NSManagedObjectContext` 里未落盘的变更——只不过我们把"变更"永久留存为一等公民。
- **对应 Palantir**：Object Databases（存储索引化对象数据）。

## 4. Funnel —— 索引管道（数据搬运工）

- **名字由来**：Palantir 原版服务就叫 Funnel（漏斗）——多个数据源从漏斗口倒进去，出来的是规整统一的对象。
- **是什么**：读 `datasets/*.csv` → 按 schema 声明的映射规则转换 → 写入 store。映射规则即官方对照表：**Dataset→对象类型、Row→对象、Column→属性、单元格→属性值、Join→链接**。
- **两个关键性质**：
  - **幂等（idempotent）**：同一份数据跑一次和跑十次，结果一模一样（靠主键去重更新，不会插出 500 只重复股票）。比喻：电梯按钮按几次都只是叫一次电梯。
  - **增量（incremental）**：行情更新后重跑，只更新变化的行，并且（见 store）不碰你的编辑。
- **脏数据处理**：科创板50 里有未盈利公司，PE 是空的——Funnel 按 schema 声明的空值策略处理（置空而非丢行），并输出一份报告"哪些行有什么问题、怎么处理的"，**绝不静默丢弃**。
- **iOS 类比**：想象一个把服务器 JSON 批量导入 Core Data 的同步器：按主键 upsert、可重复执行、冲突有策略。
- **对应 Palantir**：Object Data Funnel（写入编排：从 Foundry 数据源读取并索引进对象库、保持最新）。

## 5. OSS —— Object Set Service（对象集/查询服务）

- **是什么**：一切**读**操作的入口：条件过滤（"PE 有值且小于 50 的股票"）、搜索、聚合（"按行业数一数各几只"）、**链接遍历**（从组合 → 走到持仓 → 走到股票——图一样地"顺藤摸瓜"）。
- **Object Set（对象集）**：一次查询圈出来的一组对象，本体世界的基本操作单位。两种：
  - **静态集**：拍立得照片——存的是当时圈中的主键名单，之后数据再变名单不变；
  - **动态集**：实时监控画面——存的是**条件**（PE<50），明天有新股票满足条件就自动进来。`screenStocks` 选股函数产出的就是动态集。
- **为什么读写分开两个模块**：读追求快和灵活（各种过滤聚合），写追求严和可控（校验、事务、审计）——性能特征和安全要求完全不同，分开各自做好。Palantir 也是这么切的（OSS 管读、Actions 服务管写）。
- **iOS 类比**：`NSFetchRequest` + `NSPredicate`（条件查询），关系遍历就像 Core Data 顺着 relationship 拿对象。
- **对应 Palantir**：Object Set Service（"专责读路径：搜索、过滤、聚合、加载对象"）。

## 6. actions —— Action 执行器（一切"写"的唯一大门）

- **是什么**：想改任何数据？没有第二条路，必须提交一个 **Action**（如"买入 tradeStock"）。执行器把它走完五步管线：
  1. **参数校验**：股票代码存在吗？数量是正整数吗？（类型层面）
  2. **submission criteria（提交前提）**：业务层面的"准入检查"——卖出数量 ≤ 当前持仓吗？买入金额 ≤ 现金余额吗？**不满足直接拒绝**，并告诉你败在哪条。比喻：ATM 取款前先查余额。
  3. **rules 产出 edits**：通过后，算出这次要改哪些对象的哪些属性（买入 = 新增一条 Position + 减少 Portfolio 现金）。
  4. **原子事务提交（atomic transaction）**：一组改动**要么全部生效、要么全不生效**。比喻：转账 = 扣款 + 入账必须同生共死，不存在"钱扣了没到账"。
  5. **审计 + side effects（副作用）**：留一条不可篡改的记录（何时/哪个 Action/改了什么），再执行附带动作（记通知等）。
- **为什么把"写"做这么重**：这正是调研的核心结论落地——Palantir 建模的是**决策**而非数据库操作。"买入中芯国际 500 股"是一个有前提、有后果、可回溯的**业务决策**，不是一句裸 UPDATE。审计流让每个决策可复盘——这是"运营系统"和"分析系统"的分界。
- **iOS 类比**：一个带完整业务校验的 ViewModel 方法 + `context.save()`；或者更贴切：**GitHub 的 PR**——改动打包提交、检查（CI）通过才能合入、永远留有记录、可回溯。
- **对应 Palantir**：Actions 服务 + Action Type 完整结构（parameters/submission criteria/rules/side effects——官方文档原样照抄的四件套）。

## 7. functions —— Function 运行时（业务逻辑的家）

- **是什么**：注册和执行"读取本体、计算结果"的 TS 函数——组合估值（持仓×最新价）、条件选股、预警扫描。**只读不写**；算出来的结论要落地，必须经 Action（例如 checkAlerts 发现触发，由调用方执行 markAlertTriggered 这个系统 Action 写状态）。
- **运行时（runtime）**：负责托管、调度、执行这些函数的环境（函数注册进来，UI/MCP/CLI 都能按名调用）。
- **为什么和 actions 分开**：调研报告的决策四要素——Data / **Logic** / **Action** / Security。**算（Logic）和做（Action）是决策的两个不同要素**，Palantir 明确分开建模：Function 是"评估决策的计算过程"，Action 是"执行决策的编排"。官方航空案例就是标准示范：`calculateOptimalSwaps`（Function 算最优换机方案）→ `swapAircraft`（Action 写回执行）。我们照此把"选股"和"下单"分开。
- **iOS 类比**：无副作用的纯函数/计算属性；或注册进系统的 `Intent`（可被 Siri/快捷指令按名调用——正如我们的 Function 可被 UI/MCP 按名调用）。
- **对应 Palantir**：Functions（"接收输入参数并返回输出的代码逻辑，原生集成于本体"；底层逻辑可为业务规则/ML 模型/LLM 函数——我们先做最朴素的业务规则档）。

## 8. 编外两员：codegen 与 MCP（不在 engine 里，但同属复刻核心）

### codegen —— code generation（代码生成，OSDK 复刻）

- **是什么**：一个工具，读取 schema，**自动生成**一套类型化的 TypeScript 客户端代码。此后写业务代码是这样的体验：`client.objects.Stock.where(s => s.pe.lessThan(50))`、`client.actions.tradeStock({stockId, qty})`——编辑器自动补全你的业务词汇，拼错属性名**编译期就报错**。
- **比喻**：从 Excel 表头自动生成一台"专用遥控器"，每个按钮上印的都是你的业务词汇，按错形状的按钮根本按不下去。
- **iOS 类比**（这个你天天用）：Xcode 从 `.xcdatamodeld` 自动生成 `NSManagedObject` 子类——**一模一样的思想**：模型定义变了，重新生成，用错的地方编译报错。
- **对应 Palantir**：OSDK（官方定位"业务的 SDK"——不是给平台一个通用 API，而是为你的企业生成以业务自身语言表达的 API）。

### MCP server —— 本体的 AI 接口（OAG 复刻）

- **是什么**：把本体的查询能力 + 全部 Action **自动**暴露为 MCP（Model Context Protocol，Claude 等 AI 连接外部工具的标准协议）工具。schema 里加一个新 Action，Claude 那头自动多一个可调用的工具——零胶水代码。
- **为什么是复刻精髓**：调研发现官方 2026-01 就把 Ontology 做成了 MCP server；官方称此思想为 **OAG（Ontology-Augmented Generation）**——比 RAG（只给 AI 喂数据）更进一步，AI 直接调用**数据/逻辑/行动**三类原语，且每次写入都走 Action 管线（校验+审计照常生效，AI 乱来也过不了 submission criteria——治理不因调用者是 AI 而放松）。

## 9. 设计原则总结（为什么这样切六块）

1. **对照 Palantir 真实架构**：OMS / Object Databases / OSS / Actions / Funnel 五件套 + Functions，与调研报告 §3.2 一一对应——学完这个项目，读 Palantir 官方架构文档会有"都见过"的熟悉感。
2. **三条分离**：元数据与数据分离（OMS vs store）、读与写分离（OSS vs actions）、算与做分离（functions vs actions）。
3. **单一职责**：每块回答一个问题——"世界上有什么类型？"（OMS）"数据放哪？"（store）"数据怎么进来？"（Funnel）"怎么查？"（OSS）"怎么改？"（actions）"怎么算？"（functions）。每块可独立测试。

## 10. 术语速查表

| 术语 | 全称/读法 | 一句话 |
|---|---|---|
| schema | 模式/蓝图 | "数据长什么样"的正式定义，只含规则不含数据 |
| ontology | 本体（论） | 一套"世界上有哪些东西、什么关系、能做什么动作"的完整定义 |
| OMS | Ontology Metadata Service | schema 的看管者与注册中心 |
| metadata | 元数据 | 关于数据的数据（"价格是数字"vs"价格是 85"） |
| primary key | 主键 | 对象的唯一身份证（股票代码） |
| materialization | 物化 | 预先算好存成可快速查询的形态 |
| Funnel | 漏斗（Palantir 服务名） | 把数据源规整、搬进对象库的管道 |
| idempotent | 幂等 | 重复执行结果不变 |
| incremental | 增量 | 只处理变化的部分 |
| OSS | Object Set Service | 查询服务（一切读操作） |
| object set | 对象集 | 一次查询圈出的一组对象（静态=快照/动态=存条件） |
| Action | 动作 | 受治理的业务写操作（一等公民） |
| submission criteria | 提交前提 | 不满足就拒绝提交的业务检查 |
| atomic transaction | 原子事务 | 一组改动要么全成要么全不成 |
| edits | 编辑记录 | 用户/AI 的改动，与源数据分开存 |
| Apply User Edits | 编辑优先策略 | 合并时已编辑属性以用户编辑为准 |
| audit | 审计 | 每笔写入的不可篡改留痕 |
| side effect | 副作用 | Action 提交后附带执行的动作（通知等） |
| Function | 函数 | 本体原生的只读业务逻辑（算不做） |
| runtime | 运行时 | 托管并执行代码的环境 |
| codegen | code generation | 从 schema 自动生成类型化客户端（OSDK 思想） |
| OSDK | Ontology SDK | Palantir 官方"业务的 SDK" |
| MCP | Model Context Protocol | AI 连接外部工具的标准协议 |
| OAG | Ontology-Augmented Generation | AI 经本体调用数据/逻辑/行动（超越 RAG） |
| writeback | 写回 | 决策结果写回数据层/源系统，闭环的落地机制 |
| closed-loop | 闭环 | 看见→决策→行动→影响写回→再看见 |

# M3 Toolchain 验收证据

- 验收日期：2026-08-04（深夜，连续执行模式）
- 自动化：**63 测试全绿**（含 codegen 2 用例、server 5 用例）+ `tsc --noEmit`（生成物在编译范围内）
- 结论：**全项通过**

## #1 codegen（题材无关生成器） ✅

vitest：用动物园本体生成客户端 → 动态 import → 类型化查询/遍历/Action/Function 全链断言通过。

## #2 生成 astock OSDK + 编译期防线 ✅

`pnpm --filter engine gen-osdk` → `osdk/astock-client.ts`；demo 实跑输出（真实数据）：

```
688111 金山办公 PE=35.09 自选=false
...（PE<60 列表）
--- 688981 所属行业 --- 电子
--- writeResearchNote --- 提交成功（1 项编辑）
--- P1 总资产 --- 1007146        # 与 M2 验收 #4 估值一致
```

三类故意错误全部**编译期报错**（写坏文件跑 tsc 实测后删除）：

| 错误 | tsc 结果 |
|---|---|
| 过滤属性拼错 `'pee'` | TS2322 not assignable（属性名字面量化补强后） |
| Action 缺参数 `price` | TS2345 not assignable to TradeStockParams |
| 遍历名拼错 `'industryy'` | TS2345 not assignable to 'industry' \| 'positions' \| ... |

## #3 HTTP API ✅

vitest 集成（随机端口 + node fetch）：schema 元数据可 JSON 化（函数字段剔除）、过滤/遍历、Action 成功与 criteria 拒绝结构化透传、audit、404/400。

curl 冒烟（真实库）：

```
GET /api/schema                → 对象 6 链接 5 action 6 fn 3
GET /api/objects/Stock?where=pe<40&orderBy=pe → 12 只（中国通号…柏楚电子）
POST /api/actions/addToWatchlist {688981}     → {"ok":false,"stage":"criteria","failedCriterion":"notYetWatched",...}
```

## 实施发现（计划外修正）

- 生成物直接 import better-sqlite3 在根目录解析失败 → 引擎新增 `openStore` 工厂，SDK 与驱动解耦（`6cc944a`）。
- 首版防线演示暴露过滤属性仍为宽 string → codegen 补强为 per-type 字面量联合（`510ad6c`）——防线自测抓到了防线自己的洞。

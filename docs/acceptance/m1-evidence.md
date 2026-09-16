# M1 引擎核心 验收证据

- 验收日期：2026-08-04（晚）
- 验收时 HEAD：`dc8ca00`（fix(m1): 验收发现三处题材泄漏修正 + tsc 类型修正）
- 验收依据：spec §9.3 M1 清单 6 项 + 计划 Task 10 追加的题材无关检查 = 共 7 项
- 结论：**7/7 通过**（含一项验收方法自身的修正，见附录 B）

## 逐项证据

### #1 自动化测试全绿 ✅

```
$ pnpm --filter engine test
Test Files  6 passed (6)
     Tests  26 passed (26)
```

### #2 本体注册摘要 ✅

```
$ pnpm cli load
本体: A股投研运营台 (astock)
对象类型 6 个:（Stock/Industry/Portfolio/Position 带 datasource；ResearchNote/Alert 纯编辑型）
链接类型 5 个:（stockInIndustry/positionInPortfolio/positionOfStock/noteAboutStock/alertOnStock，均双向带反向遍历名）
```

对象+链接共 11 条目，与 schema 一致。

### #3 物化与脏行报告 ✅

```
$ pnpm cli materialize   （干净库首跑）
Stock: 共 50 行 → 新增 50 更新 0
  [置空] 第 7 行 pe=''
  [置空] 第 15 行 pe=''
  ...（共 14 条 [置空]，对应 datasets/README.md 亏损清单 14 只）
Industry: 共 10 行 → 新增 10；Portfolio: 1；Position: 2
```

PE 空值走 [置空] 路径而非丢行；skipped=0（真实数据无缺主键行）。

### #4 条件查询与独立核对 ✅

```
$ pnpm cli query Stock --where "pe!=null" --where "pe<50" --order-by pe
引擎: 688009 688187 688169 688578 689009 688036 688472 688525 688213 688111 688617 688188 688099 688122 688271
核对: （python 直读 stocks.csv 独立复算+排序）
逐位一致: True （15 vs 15）
```

### #5 双向链接遍历 ✅

```
$ pnpm cli traverse Stock 688981 industry    → sw_dianzi 电子
$ pnpm cli traverse Industry sw_dianzi stocks → 29 只（与 count --by industryCode 的电子组 29 一致）
```

### #6 幂等 ✅

```
$ pnpm cli materialize   （重跑）
Stock: 共 50 行 → 新增 0 更新 50
$ pnpm cli count Stock
50
```

### #7 引擎题材无关 ✅

```
$ grep -rniE "stock|astock|portfolio|industry" packages/engine/src/
（无输出，退出码 1）
```

## 附录 A：验收过程发现与修正（先发现失败→修正→复验通过）

首轮验收 #7 **失败**，grep 抓到三处题材泄漏；顺手加严跑 `tsc --noEmit` 又暴露三处类型问题（vitest/esbuild 转译不查类型，测试绿不代表类型干净）：

| # | 发现 | 修正 |
|---|---|---|
| 1 | types.ts 注释示例用金融词（'stocks.csv'/'industry'/'stocks'） | 改动物园词汇（与测试夹具一致） |
| 2 | oms.ts 注释示例用金融词（Stock 的 positions/...） | 改题材中性表述 |
| 3 | **cli.ts 在 src/ 内 import 具体本体 astock**（结构性耦合） | 移出 `src/` 至包根 [`packages/engine/cli.ts`](../../packages/engine/cli.ts)——CLI 是"组装引擎+本体"的应用层，不属题材无关引擎 |
| 4 | oss.ts Filter 联合类型在 else 链尾部否定收窄失败（tsc 报错） | 改 `'value' in f` 判别（in 收窄机制最稳） |
| 5 | ontology/ 文件超出 engine tsconfig 的 rootDir | 去掉 rootDir 限制 |
| 6 | 根包无 `type: module`，ontology/ 被判 CJS | 根 package.json 补 `"type": "module"` |

修正 commit：`dc8ca00`。复验后 7/7 通过 + `tsc --noEmit` 通过（加严项，超出清单）。

## 附录 B：验收方法自身的修正

#4 首轮比对差 1 只（引擎 14 vs 核对 15）：差异股 `689009`（九号公司，CDR）——**验收命令的 grep 正则 `688[0-9]+` 漏了 689 前缀**，引擎输出本身正确。修正正则为 `68[89][0-9]{3}` 后逐位一致。教训：核对工具自身也要核对。

## 计划外偏差记录（实施与计划的差异，均已记入对应 commit）

1. pnpm 10 默认拦截依赖构建脚本 → 根包增加 `pnpm.onlyBuiltDependencies` 放行 better-sqlite3（`057fb45`）。
2. Funnel nulled 收集按计划内置提示重构为单趟（`001f6b7`）。
3. 数据源对未盈利企业返回**负 PE** 而非空 → 数据准备层置空并在 datasets/README.md 记录 14 只清单（`73f2d1f`）。
4. CLI get 分支去掉计划代码中的冗余双重 open（`1c0c71e`）。

# M3 Toolchain 实现计划（精简版）

**Goal:** 复刻 OSDK 思想——从 schema 生成类型化 TS 客户端（"用业务语言编程"+编译期防线）；HTTP API 供 M4 UI 与外部消费。

## 架构决策（与 spec §3 目录的偏差及理由）

- **codegen 并入 engine**（`engine/src/codegen.ts`，题材无关的代码生成器）而非独立 `packages/codegen` 包——省 monorepo 配置成本，Toolchain 层语义不变；生成物落**项目根 [`osdk/`](../../../osdk/)**（题材相关，与 ontology/ 平级，不进引擎 src 的 grep 防线范围）。
- **HTTP server 放 `engine/server.ts`**（包根，与 cli.ts 同级的应用层——组装引擎+astock 本体）而非独立 `packages/server` 包；node:http 零依赖 + 手写路由 + CORS。

## 任务

| # | 任务 | 验收 |
|---|---|---|
| 1 | codegen 生成器（题材无关）：schema → 对象 interface + 类型化 client 源码 | vitest：用 zoo 生成、动态 import、类型化查询/Action 跑通 |
| 2 | 生成 [`osdk/astock-client.ts`](../../../osdk/astock-client.ts) + [`osdk/demo.ts`](../../../osdk/demo.ts) | 生成物 tsc 编译过；demo 走完"类型化查询+Action"；故意写错属性名编译报错（演示） |
| 3 | `engine/server.ts`：REST API（schema/objects/links/count/actions/functions/audit/notifications）+ CORS | vitest 集成测试（node fetch）+ curl 冒烟 |
| 4 | 验收归档 [`docs/acceptance/m3-evidence.md`](../../acceptance/m3-evidence.md) + PROGRESS | 全项通过 |

## API 面（M4 UI 的后端契约）

```
GET  /api/schema                          # 全量元数据（UI 动态渲染依据）
GET  /api/objects/:type?where&orderBy&desc&limit
GET  /api/objects/:type/:pk
GET  /api/objects/:type/:pk/links/:name   # 链接遍历
GET  /api/count/:type?by=prop             # 聚合
POST /api/actions/:name    {params}       # 执行 Action（结构化 ActionResult 透传）
POST /api/functions/:name  {params}
GET  /api/audit?limit  /  GET /api/notifications
```

# examples — 让本体"活起来"的三条驱动路径

对话里的 Claude 能操作本体（MCP），但对话要人发起。这里回答的是："没有人守着，
系统怎么每天自己转一圈？" 三条路干的是同一件事——**一个 runloop 拿着本体的工具集
（查询/Function/Action）循环调用**，区别只在循环由谁执行、账记在哪。

| 路径 | 循环由谁跑 | 凭据/计费 | 适合 |
|---|---|---|---|
| ① `daily-patrol.sh`（claude -p） | claude CLI 内置 runloop | 本机 Claude Code 登录态，走订阅额度，**零 API key** | 本机日常/演示（推荐起步） |
| ② `api-agent.ts`（Anthropic SDK） | 你手写的 while 循环 | `ANTHROPIC_API_KEY`，按 token 计费 | 生产服务器部署 |
| ③ Claude 定时任务（App 内） | Claude Desktop 调度会话 | 订阅额度 | 不想碰 launchd/cron 时 |

三条路的治理完全一致：**AI 的每次写入都走 Action 管线**（提交前提校验、原子提交、
审计留痕）——自动化不享受任何后门，这正是本体的意义。

## ① 本机每日巡逻（零 API key）

已实测通过（2026-08-06）：headless `claude -p` 在本项目目录直接用 `.mcp.json` 里的
astock-ontology 工具，`--allowedTools` 白名单就是治理边界。

```bash
# 手动跑一次
./examples/daily-patrol.sh
```

定时化（launchd，macOS 原生 cron）：

```bash
# 1. 安装（复制模板到 LaunchAgents 并加载）
cp examples/launchd/com.nemoair.astock-patrol.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.nemoair.astock-patrol.plist

# 2. 之后每个交易日 15:35 自动巡逻；日志在 ~/Library/Logs/astock-patrol.log
# 立即试跑一次：launchctl start com.nemoair.astock-patrol
# 卸载：launchctl unload ~/Library/LaunchAgents/com.nemoair.astock-patrol.plist
```

> 缺的最后一环是"行情自动更新"：按项目数据接入边界（CLAUDE.md），真实行情由对话内
> Claude 拉取落 `datasets/*.csv`，引擎不联网。要全自动可另写问财 OpenAPI 独立取数
> 脚本（key 走环境变量）插到巡逻脚本第 1 步之前——需要时在对话里说一声。

## ② 生产形态：手写 runloop（api-agent.ts）

`api-agent.ts` 用 Anthropic SDK 手写了同一个循环（教学用，能看见循环本体）：
`buildTools(store)` 产出工具清单 → 作为 `tools` 参数发给模型 → 模型回 `tool_use` →
本进程执行 `call()`（写入照走 Action 管线）→ 结果作为 `tool_result` 回传 → 循环。

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # 按量计费
pnpm --filter engine exec tsx ../../examples/api-agent.ts
```

订阅登录态**不能**合规地用于裸 SDK——官方支持的订阅通道是 claude CLI / Claude
Agent SDK（CI 场景用 `claude setup-token`）。所以：本机用①，服务器用②。

## ③ Claude 定时任务

Claude 桌面版自带定时任务（Scheduled Tasks）：建一个每天定时的任务，提示词写
巡逻指令（同 daily-patrol.sh 第 2 步），到点自动开会话执行。不用碰任何配置文件，
适合把"每天巡逻"完全交给 Claude App 管理。

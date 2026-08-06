#!/usr/bin/env bash
# 每日巡逻 runloop：让本体"活起来"的最小驱动器（零 API key 版）。
#
# 链路：重物化（本地 CSV→对象库，编辑经账本重放保留）
#       → Claude headless 巡检（claude -p 内部就是 tool-use 循环；用本机 Claude Code
#         登录态，走订阅额度，不需要 ANTHROPIC_API_KEY）
#
# 与 examples/api-agent.ts 的关系：干的是同一件事——api-agent.ts 手写循环给你看原理
# （生产服务器形态，需 API key 按量计费）；本脚本把循环交给 claude CLI（本机日常形态）。
#
# 依赖：已登录的 claude CLI；本体至少物化过一次（pnpm cli materialize）。
# 定时运行：见 examples/launchd/README.md（launchd 每交易日 15:35 触发）。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== [1/2] 重物化数据集（Funnel 重跑 + 编辑账本重放）=="
pnpm cli materialize

# 拉新行情（可选人工步）：真实行情由对话里的 Claude 拉取落 datasets/*.csv——
# 项目数据接入边界：引擎自身不联网（CLAUDE.md）。要全自动，可再接一个
# 问财 OpenAPI 独立取数脚本（key 走环境变量、不入库），放在本步之前。

echo "== [2/2] Claude 巡检（headless runloop；工具白名单 = 治理边界）=="
claude -p "对 astock 本体做每日巡检：
1) 跑 fn_checkAlerts 扫描预警；
2) 对每个命中的预警调 action_markAlertTriggered 落账；
3) 跑 fn_portfolioValuation 查组合 P1 的估值；
4) 用 action_writeResearchNote 给持仓市值最大的股票写一条中性研判：标题「每日巡检」，理由一句话概括组合状态与预警情况。
最后输出一段简短的巡检报告（预警命中数、总资产、盈亏）。" \
  --allowedTools "mcp__astock-ontology__fn_checkAlerts,mcp__astock-ontology__action_markAlertTriggered,mcp__astock-ontology__fn_portfolioValuation,mcp__astock-ontology__action_writeResearchNote,mcp__astock-ontology__query_objects,mcp__astock-ontology__get_object"

echo "== 巡逻完成。写入全部经 Action 管线，打开 Web UI 审计流可见每一笔。=="

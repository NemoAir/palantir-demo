/**
 * 生产接入示例：用 Claude API（tool use）驱动本体的 agent runloop。
 *
 * 回答的问题："对话里 Claude 能操作本体，生产中用大模型 API 怎么实现同样的事？"
 *
 * 链路（与 MCP 完全同构，只是换了协议接线）：
 *   buildTools(store) 产出工具清单+分发器（引擎能力，题材无关）
 *     → 工具清单作为 API 请求的 tools 参数发给模型
 *     → 模型返回 tool_use（它决定调哪个工具、传什么参数）
 *     → 本进程执行 call(name, input)——写入照走 Action 治理管线（criteria/审计）
 *     → 结果作为 tool_result 回传 → 循环，直到模型不再调工具
 *
 * 这里手写 while 循环是为了教学（看见循环本体）；生产可用 SDK 的
 * client.beta.messages.toolRunner() 把循环收掉，语义相同。
 *
 * 运行前提：
 *   1. pnpm add -w -D @anthropic-ai/sdk   （已在根 devDependencies）
 *   2. 环境有 Claude API 凭据（ANTHROPIC_API_KEY，或 `ant auth login` 的配置文件）
 *   3. 本体已物化（pnpm cli materialize）
 * 运行：pnpm --filter engine exec tsx ../../examples/api-agent.ts
 */
import Anthropic from '@anthropic-ai/sdk';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openStore } from '../packages/engine/src/open.js';
import { buildTools } from '../packages/engine/src/ai-tools.js';
import { astock } from '../ontology/astock.ontology.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// ---------- 1. 打开本体，取出 AI 工具集（与 MCP server 用的是同一份） ----------
const store = openStore(astock, join(root, 'ontology.db'));
const { tools, call } = buildTools(store);

// ToolDef → Claude API 工具定义（字段一一对应，只是 inputSchema → input_schema）
const apiTools: Anthropic.Beta.BetaTool[] = tools.map(t => ({
  name: t.name,
  description: t.description,
  input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
}));

// ---------- 2. agent runloop ----------
const client = new Anthropic(); // 凭据取自环境（ANTHROPIC_API_KEY / ant auth 配置）

async function runAgent(task: string): Promise<void> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: 'user', content: task },
  ];

  for (let turn = 1; turn <= 15; turn++) { // 轮次上限：失控保险
    const response = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      // 安全分类器可能拒答（stop_reason: "refusal"）；服务端 fallback 自动换模型重试
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      tools: apiTools,
      messages,
    });

    if (response.stop_reason === 'refusal') {
      console.error('请求被安全分类器拒绝（含 fallback 链）——调整任务描述后重试');
      return;
    }

    // 模型这一轮说的话（工具调用之间的叙述）
    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) console.log(`\n[Claude] ${block.text}`);
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
    );

    // 不再调工具 = 任务完成，循环自然结束
    if (toolUses.length === 0) return;

    // 保留完整 assistant 内容（含 tool_use 块），再补一条 user 消息装全部工具结果
    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map(tu => {
      console.log(`  [工具] ${tu.name} ${JSON.stringify(tu.input)}`);
      try {
        // 关键行：模型的意图落到本体——写入照走 Action 管线（criteria 校验、原子提交、审计）
        const result = call(tu.name, tu.input as Record<string, unknown>);
        return { type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) };
      } catch (e) {
        return { type: 'tool_result', tool_use_id: tu.id, content: `错误：${(e as Error).message}`, is_error: true };
      }
    });
    messages.push({ role: 'user', content: results });
  }
  console.warn('达到轮次上限，停止。');
}

// ---------- 3. 驱动方式 ----------
// 一次性任务（人驱动，等价于你在对话里说一句话）：
await runAgent(
  '看一下组合 P1 当前的估值和持仓盈亏；然后扫描一遍预警，若有触发的就标记触发；最后用一句话总结组合状态并写进一条中性研判（挂在持仓市值最大的股票上）。',
);

// "活系统"= 把上面这行放进定时器（cron / setInterval / launchd），如：
//   每个交易日 15:30 收盘后：拉新行情（对话让 Claude 重取，或独立取数脚本）
//   → POST /api/materialize 重物化 → runAgent('巡检预警并写当日总结')
// 数据更新不会推送给模型——它每轮用查询工具主动读最新状态；
// 治理不因自动化放松：它的每次写入都过 criteria 并留审计。

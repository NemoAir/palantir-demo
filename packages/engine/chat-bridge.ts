/**
 * 对话桥（部署组装层，与 serve.ts/cli.ts 同级，不属于引擎核心 src/）：
 * 把"一句话任务"交给 AI runloop 对本体执行，返回完整过程（工具调用时间线）+ 最终回答。
 *
 * 两个驱动，运行时自动选择（前端零感知，便于迁移）：
 *   - 'api'       ：环境有 ANTHROPIC_API_KEY → 进程内 SDK runloop（复用 buildTools，生产形态）
 *   - 'claude-cli'：否则 spawn 本机已登录的 claude CLI（headless -p，订阅计费、零 API key）
 * CHAT_DRIVER=api|claude-cli 可显式覆盖；CHAT_MODEL 可换 api 驱动的模型。
 *
 * 治理与隐私边界：
 *   - 两条路的写入全部走 Action 管线（criteria/原子提交/审计）——AI 没有旁门；
 *   - 密钥只存在环境变量 / 本机 Claude Code 登录态，永不写入仓库；
 *   - 引擎核心 src/ 不发网络请求（数据接入边界）；本文件的出站调用只面向 LLM，不拉业务数据。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type AnthropicNS from '@anthropic-ai/sdk';
import type { ObjectStore } from './src/store.js';
import { buildTools } from './src/ai-tools.js';
import type { Value } from './src/types.js';

export interface ChatEvent {
  kind: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  tool?: string;
  input?: unknown;
  output?: string;
  isError?: boolean;
}

export interface ChatResult {
  driver: 'api' | 'claude-cli';
  events: ChatEvent[];
  final: string;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const clip = (s: string, n = 800): string => (s.length > n ? `${s.slice(0, n)} …（截断，共 ${s.length} 字）` : s);

export function chatDriver(): 'api' | 'claude-cli' {
  const forced = process.env.CHAT_DRIVER;
  if (forced === 'api' || forced === 'claude-cli') return forced;
  return process.env.ANTHROPIC_API_KEY ? 'api' : 'claude-cli';
}

export async function runChat(
  store: ObjectStore,
  prompt: string,
  opts: { mcpServerName: string },
): Promise<ChatResult> {
  return chatDriver() === 'api' ? runViaApi(store, prompt) : runViaClaudeCli(prompt, opts.mcpServerName);
}

/* ---------- 驱动 A：本机 claude CLI（订阅计费，零 API key） ---------- */

function runViaClaudeCli(prompt: string, mcpServerName: string): Promise<ChatResult> {
  return new Promise((resolve, reject) => {
    const events: ChatEvent[] = [];
    let final = '';
    let stderrTail = '';
    // stream-json 每行一个事件：assistant（含 text/tool_use）、user（tool_result）、result（最终）
    const child = spawn(
      'claude',
      ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--allowedTools', `mcp__${mcpServerName}`],
      { cwd: ROOT, env: process.env },
    );
    const timer = setTimeout(() => { child.kill(); reject(new Error('claude CLI 超时（240s）')); }, 240_000);

    let buf = '';
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try { ingestCliEvent(JSON.parse(line)); } catch { /* 非 JSON 行忽略 */ }
      }
    });
    child.stderr.on('data', (d: Buffer) => { stderrTail = (stderrTail + d.toString()).slice(-2000); });
    child.on('error', e => { clearTimeout(timer); reject(new Error(`无法启动 claude CLI（是否已安装并登录？）：${e.message}`)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ driver: 'claude-cli', events, final });
      else reject(new Error(`claude CLI 退出码 ${code}：${clip(stderrTail, 400)}`));
    });

    const ingestCliEvent = (ev: Record<string, unknown>): void => {
      if (ev.type === 'assistant' || ev.type === 'user') {
        const message = ev.message as { content?: unknown } | undefined;
        const content = Array.isArray(message?.content) ? message.content as Record<string, unknown>[] : [];
        for (const block of content) {
          if (block.type === 'text' && typeof block.text === 'string' && block.text.trim())
            events.push({ kind: 'text', text: block.text });
          if (block.type === 'tool_use')
            events.push({ kind: 'tool_use', tool: String(block.name), input: block.input });
          if (block.type === 'tool_result') {
            const c = block.content;
            const text = typeof c === 'string'
              ? c
              : Array.isArray(c) ? c.map(p => (p as { text?: string }).text ?? '').join('') : JSON.stringify(c);
            events.push({ kind: 'tool_result', output: clip(text), isError: block.is_error === true });
          }
        }
      }
      if (ev.type === 'result' && typeof ev.result === 'string') final = ev.result;
    };
  });
}

/* ---------- 驱动 B：Anthropic SDK 进程内 runloop（需 ANTHROPIC_API_KEY） ---------- */

async function runViaApi(store: ObjectStore, prompt: string): Promise<ChatResult> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk'); // 动态导入：无 key 场景不加载
  const client = new Anthropic();
  const { tools, call } = buildTools(store);
  const apiTools = tools.map(t => ({
    name: t.name, description: t.description,
    input_schema: t.inputSchema as AnthropicNS.Tool.InputSchema,
  }));

  const events: ChatEvent[] = [];
  const messages: AnthropicNS.MessageParam[] = [{ role: 'user', content: prompt }];
  let final = '';

  for (let turn = 0; turn < 12; turn++) {
    const resp = await client.messages.create({
      model: process.env.CHAT_MODEL ?? 'claude-opus-5',
      max_tokens: 4096,
      tools: apiTools,
      messages,
    });
    const toolUses: AnthropicNS.ToolUseBlock[] = [];
    for (const block of resp.content) {
      if (block.type === 'text' && block.text.trim()) { events.push({ kind: 'text', text: block.text }); final = block.text; }
      if (block.type === 'tool_use') { toolUses.push(block); events.push({ kind: 'tool_use', tool: block.name, input: block.input }); }
    }
    if (toolUses.length === 0) break;

    messages.push({ role: 'assistant', content: resp.content });
    const results: AnthropicNS.ToolResultBlockParam[] = toolUses.map(tu => {
      try {
        const out = JSON.stringify(call(tu.name, tu.input as Record<string, Value>));
        events.push({ kind: 'tool_result', tool: tu.name, output: clip(out) });
        return { type: 'tool_result', tool_use_id: tu.id, content: out };
      } catch (e) {
        const msg = (e as Error).message;
        events.push({ kind: 'tool_result', tool: tu.name, output: msg, isError: true });
        return { type: 'tool_result', tool_use_id: tu.id, content: msg, is_error: true };
      }
    });
    messages.push({ role: 'user', content: results });
  }
  return { driver: 'api', events, final };
}

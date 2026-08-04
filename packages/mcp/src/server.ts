// MCP 薄壳：把引擎的 AI 工具集（ai-tools，OAG 核心）接上 Model Context Protocol。
// 复刻 Palantir Ontology MCP（2026-01）：外部 AI（Claude Code 等）可发现并消费本体——
// 读对象、执行受治理的 Action、调用 Function；治理不因调用者是 AI 而放松。
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openStore } from '../../engine/src/open.js';
import { buildTools } from '../../engine/src/ai-tools.js';
import { astock } from '../../../ontology/astock.ontology.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const store = openStore(astock, join(root, 'ontology.db'));
const { tools, call } = buildTools(store);

const server = new Server(
  { name: 'astock-ontology', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async req => {
  try {
    const result = call(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `错误：${(e as Error).message}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
console.error(`astock-ontology MCP server 已就绪（${tools.length} 个工具）`);

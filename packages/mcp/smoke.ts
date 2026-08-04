// stdio 端到端冒烟：起真实 MCP server 子进程，走一轮 listTools + 查询 + Action。
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: 'smoke', version: '0.0.1' });
await client.connect(new StdioClientTransport({
  command: 'pnpm',
  args: ['exec', 'tsx', 'src/server.ts'],
  cwd: here,
}));

const { tools } = await client.listTools();
console.log(`工具总数: ${tools.length}`);
console.log('Action 工具:', tools.filter(t => t.name.startsWith('action_')).map(t => t.name).join(', '));
console.log('Function 工具:', tools.filter(t => t.name.startsWith('fn_')).map(t => t.name).join(', '));

const q = await client.callTool({ name: 'query_objects', arguments: { type: 'Stock', where: ['isWatched=1'], limit: 5 } });
console.log('自选股查询:', (q.content as { text: string }[])[0].text.slice(0, 200));

const act = await client.callTool({
  name: 'action_writeResearchNote',
  arguments: { stockCode: '688111', stance: '看多', reason: 'MCP 冒烟：AI 经受治理 Action 写回本体' },
});
console.log('Action 执行:', (act.content as { text: string }[])[0].text.slice(0, 160));

const audit = await client.callTool({ name: 'list_audit', arguments: { limit: 1 } });
console.log('最新审计:', (audit.content as { text: string }[])[0].text.slice(0, 160));

await client.close();

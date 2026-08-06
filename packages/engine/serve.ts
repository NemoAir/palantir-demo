// 应用层启动脚本：astock 本体 API 服务（M4 Web UI 的后端）。
// 用法：pnpm --filter engine serve   （默认端口 4177，PORT 环境变量可改）
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openStore } from './src/open.js';
import { createApiServer } from './src/server.js';
import { runChat, chatDriver } from './chat-bridge.js';
import { astock } from '../../ontology/astock.ontology.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const store = openStore(astock, join(root, 'ontology.db'));
const port = Number(process.env.PORT ?? 4177);
createApiServer(store, {
  datasetsDir: join(root, 'datasets'),
  // Web 对话入口：驱动自动选择（有 ANTHROPIC_API_KEY 走 SDK，否则走本机 claude CLI 订阅）
  chat: (prompt, conversationId) => runChat(store, prompt, { mcpServerName: 'astock-ontology', conversationId }),
}).listen(port, () => {
  console.log(`astock 本体 API: http://localhost:${port}/api/schema（chat 驱动：${chatDriver()}）`);
});

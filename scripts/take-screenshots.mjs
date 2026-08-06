/**
 * 全功能截图脚本：驱动本机 Chrome 遍历运营台各视图，产出 docs/screenshots/*.png。
 *
 * 用法：先起 API（pnpm --filter engine serve）与 Web（pnpm --filter web dev），然后
 *   node scripts/take-screenshots.mjs [webUrl]
 * webUrl 缺省 http://localhost:5177。含一步真实 AI 对话（走本机对话桥，耗时约 1 分钟），
 * 不想跑加 --skip-chat。
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'screenshots');
mkdirSync(OUT, { recursive: true });

const WEB = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://localhost:5177';
const SKIP_CHAT = process.argv.includes('--skip-chat');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  channel: 'chrome',
  headless: 'new',
  args: ['--force-device-scale-factor=2'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto(WEB, { waitUntil: 'networkidle0' });
await sleep(800);

const shot = async name => {
  await sleep(400);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log('✓', name);
};
/** 点击文本匹配的元素（与 UI 的 schema 驱动渲染解耦，选择器不写死）。 */
const clickText = (selector, text) => page.evaluate((sel, t) => {
  const el = [...document.querySelectorAll(sel)].find(e => e.textContent.includes(t));
  if (!el) throw new Error(`not found: ${sel} "${t}"`);
  el.click();
}, selector, text);
const nav = async text => { await clickText('.sidenav .nav-item', text); await sleep(600); };

// 1. 对象浏览器：股票列表（真实科创板50 + 过滤栏 + 右栏审计流 + 血缘条）
await nav('股票');
await shot('01-stock-list');

// 2. 对象详情：中芯国际（属性卡 + 链接遍历 + 相关动作）
await page.evaluate(() => {
  [...document.querySelectorAll('.data-table tbody tr')]
    .find(r => r.textContent.includes('中芯国际'))?.click();
});
await sleep(700);
await shot('02-stock-detail');

// 3. 组合详情：P1（内嵌估值卡）
await nav('模拟组合');
await page.evaluate(() => document.querySelector('.data-table tbody tr')?.click());
await sleep(800);
await shot('03-portfolio-detail');

// 4. 预警规则列表（外键翻名 + 状态徽章 + 条件中文化）
await nav('预警规则');
await shot('04-alert-list');

// 5. 研判笔记列表（标题列 + 结论徽章）
await nav('研判笔记');
await shot('05-note-list');

// 6. 模拟调仓表单（对象搜索选择器 + 最新价提示 + 提交前提）
await nav('模拟调仓');
await page.evaluate(() => {
  const input = document.querySelectorAll('.action-panel .ref-picker input')[1];
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(input, '中芯');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('focus', { bubbles: true }));
});
await sleep(400);
await page.evaluate(() => {
  [...document.querySelectorAll('.ref-dropdown button')]
    .find(b => b.textContent.includes('中芯国际'))
    ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
});
await sleep(700); // 等最新价 hint 与预览卡
await shot('06-trade-form');

// 7. 组合估值 Function（KPI 卡 + 持仓明细子表，全中文标签）
await nav('组合估值');
await page.evaluate(() => {
  const input = document.querySelector('.action-panel .ref-picker input');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(input, 'P1');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('focus', { bubbles: true }));
});
await sleep(400);
await page.evaluate(() => {
  [...document.querySelectorAll('.ref-dropdown button')]
    .find(b => b.textContent.includes('P1'))
    ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
});
await sleep(500);
await clickText('.btn-submit', '运行');
await sleep(900);
await shot('07-valuation-function');

// 8. 预警扫描（命中清单 + 行尾"标记预警触发"一键落账按钮）
await nav('预警扫描');
await clickText('.btn-submit', '运行');
await sleep(900);
await shot('08-check-alerts');

// 9. 决策活动页（全部审计 + 分页）
await page.evaluate(() => document.querySelector('.rail-all')?.click());
await sleep(700);
await shot('09-activity-audit');

// 10. 概念地图页上半：本体核心词汇
await page.evaluate(() => document.querySelector('.concept-btn')?.click());
await sleep(600);
await shot('10-concepts');

// 11. 概念地图页下半：数据流向图
await page.evaluate(() => {
  const c = document.querySelector('.content');
  c.scrollTo({ top: c.scrollHeight });
});
await sleep(400);
await shot('11-dataflow');

// 12. AI 对话（真实跑一轮只读示例，展示工具调用时间线；--skip-chat 跳过）
await page.evaluate(() => document.querySelector('.chat-fab')?.click());
await sleep(400);
if (SKIP_CHAT) {
  await shot('12-ai-chat'); // 空态：示例任务 + 数据路径说明
} else {
  await clickText('.chat-example', '值多少钱');
  console.log('… AI 对话进行中（约 1 分钟）');
  await page.waitForSelector('.chat-tool', { timeout: 240_000 });
  await sleep(1200);
  await shot('12-ai-chat');
}

await browser.close();
console.log(`完成 → ${OUT}`);

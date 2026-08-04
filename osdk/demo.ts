// OSDK 演示：用"业务自身的语言"编程——类型化查询 + Action（编译期即校验属性/参数名）。
// 用法：pnpm --filter engine exec tsx ../../osdk/demo.ts
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from './astock-client.js';
import { astock } from '../ontology/astock.ontology.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const client = createClient(astock, join(root, 'ontology.db'));

// 1. 类型化查询：PE 有值且 < 60 的股票，按 PE 升序（编辑器对属性名有补全）
const cheap = client.objects.Stock.query(
  [
    { property: 'pe', op: 'notNull' },
    { property: 'pe', op: 'lt', value: 60 },
  ],
  { orderBy: 'pe' },
);
console.log('--- PE < 60 ---');
for (const s of cheap) console.log(`${s.code} ${s.name} PE=${s.pe} 自选=${s.isWatched ?? false}`);

// 2. 类型化链接遍历
const industry = client.objects.Stock.traverse('688981', 'industry');
console.log('--- 688981 所属行业 ---', industry[0]?.name);

// 3. 类型化 Action：参数结构编译期锁定
const r = client.actions.writeResearchNote({
  stockCode: '688981',
  stance: '中性',
  reason: 'OSDK demo 自动写入：估值与制程进展观察中',
});
console.log('--- writeResearchNote ---', r.ok ? `提交成功（${r.edits.length} 项编辑）` : r);

// 4. Function 调用
const valuation = client.functions.portfolioValuation({ portfolioId: 'P1' }) as { totalAssets: number };
console.log('--- P1 总资产 ---', valuation.totalAssets);

// 应用层脚本：为 astock 本体生成 OSDK 客户端 → osdk/astock-client.ts
// 用法：pnpm --filter engine exec tsx generate-osdk.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateClient } from './src/codegen.js';
import { astock } from '../../ontology/astock.ontology.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'osdk');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'astock-client.ts');
writeFileSync(outFile, generateClient(astock, { enginePath: '../packages/engine/src' }));
console.log(`已生成 ${outFile}`);

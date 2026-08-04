import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateClient } from '../src/codegen.js';
import { zoo } from './fixtures/zoo.js';

const here = dirname(fileURLToPath(import.meta.url));
const genDir = join(here, 'generated');
const genFile = join(genDir, 'zoo-client.ts');

describe('codegen：schema → 类型化客户端', () => {
  beforeAll(() => {
    mkdirSync(genDir, { recursive: true });
    // 生成物在 test/generated/，到 engine src 的相对前缀是 ../../src
    writeFileSync(genFile, generateClient(zoo, { enginePath: '../../src' }));
  });

  it('生成物可加载，类型化查询/遍历/Action/Function 全链可用', async () => {
    const mod = await import(genFile);
    const client = mod.createClient(zoo, ':memory:');
    client.store.upsertMany('Keeper', [{ id: 'K1', fullName: '张三' }]);
    client.store.upsertMany('Animal', [
      { tag: 'A1', name: '大象', weightKg: 3000, keeperId: 'K1' },
      { tag: 'A2', name: '企鹅', weightKg: 30, keeperId: 'K1' },
    ]);

    const heavy = client.objects.Animal.query([{ property: 'weightKg', op: 'gte', value: 100 }]);
    expect(heavy.map((a: { tag: string }) => a.tag)).toEqual(['A1']);

    const keeper = client.objects.Animal.traverse('A1', 'keeper');
    expect(keeper[0].fullName).toBe('张三');

    const r = client.actions.feedAnimal({ tag: 'A1', foodKg: 5 });
    expect(r.ok).toBe(true);
    expect(client.objects.Animal.get('A1')?.weightKg).toBe(3005);

    const heaviest = client.functions.heaviestAnimal({});
    expect((heaviest as { tag: string }).tag).toBe('A1');
  });

  it('生成物包含对象 interface 与 Action 参数 interface（源码断言）', () => {
    const src = generateClient(zoo, { enginePath: '../../src' });
    expect(src).toContain('export interface Animal {');
    expect(src).toContain('weightKg: number | null;');
    expect(src).toContain('export interface FeedAnimalParams {');
    expect(src).toContain('foodKg: number;');
    expect(src).toContain("traverse(pk: string, link: 'keeper')");
  });
});

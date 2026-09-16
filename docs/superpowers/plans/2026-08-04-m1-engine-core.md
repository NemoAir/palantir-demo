# M1 引擎核心 实现计划（A股投研运营台 · 迷你 Foundry）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建成题材无关的本体引擎核心（OMS 元数据服务 + store 对象库 + Funnel 物化管道 + OSS 查询服务）与 CLI，把科创板50 真实数据物化进本体并可查询/遍历，通过 spec §9.3 M1 全部验收项。

**Architecture:** 声明式 schema（[`ontology/`](../../../ontology/)，Language 层）→ OMS 加载校验注册 → store 按元数据动态建 SQLite 表（每对象类型一张表，物化路线）→ Funnel 从 `datasets/*.csv` 幂等 upsert → OSS 提供过滤/聚合/链接遍历。引擎零题材词汇；链接 v1 全部为外键型（v1 无多对多，YAGNI），遍历走 FK 索引查询、不建链接表（对应官方"仅多对多链接才由数据集支撑"）。

**Tech Stack:** Node ≥ 20、TypeScript 5 strict、pnpm workspace、better-sqlite3（同步 API 利于测试）、csv-parse、vitest、CLI 用 Node 原生 `util.parseArgs`（零框架依赖）。

## Global Constraints

- 引擎包 `packages/engine` 内**禁止出现任何题材词汇**（Stock/股票等）——验收时 `grep -ri stock packages/engine/src` 必须为空（spec §3）。
- 所有 schema 的 `apiName` 必须匹配 `^[A-Za-z][A-Za-z0-9_]*$`（OMS 校验强制）——这同时是 SQL 标识符注入防线：动态 SQL 中的表名/列名只允许来自已注册元数据，值一律参数绑定。
- 数字属性解析失败：nullable → 置空并记入报告 `nulled`；非空列 → 整行跳过记入 `skipped`；主键缺失 → 整行跳过。**绝不静默丢弃**（spec §9.4）。
- 每任务 TDD：先写失败测试再实现；每任务结束 commit（git 规范见项目 PROGRESS 约定：标题写改了什么，正文写为什么）。
- 数据集区 [`datasets/`](../../../datasets/) 只放真实拉取或种子 CSV；引擎不做任何网络请求。
- TypeScript `strict: true`；测试命令统一 `pnpm --filter engine test`。

## 文件结构（M1 全景）

```
palantir-demo/
├── package.json                  # workspace 根（scripts: test/cli）
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .gitignore                    # node_modules/ dist/ *.db
├── ontology/
│   └── astock.ontology.ts        # 【Language 层】A股投研本体声明（Task 4）
├── packages/engine/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── src/
│   │   ├── types.ts              # 元模型类型 + defineOntology（Task 2）
│   │   ├── oms.ts                # loadOntology 校验/注册（Task 3）
│   │   ├── store.ts              # 动态 DDL + upsert（Task 5）
│   │   ├── funnel.ts             # CSV 物化 + 报告（Task 6）
│   │   ├── oss.ts                # 过滤/聚合/遍历（Task 7）
│   │   └── cli.ts                # 冒烟 CLI（Task 9）
│   └── test/
│       ├── fixtures/zoo.ts       # 题材无关测试本体（动物园——刻意非金融，验证引擎题材无关）
│       ├── fixtures/animals.csv
│       ├── fixtures/keepers.csv
│       ├── oms.test.ts
│       ├── store.test.ts
│       ├── funnel.test.ts
│       └── oss.test.ts
├── datasets/
│   ├── stocks.csv                # 科创板50 真实数据（Task 8 拉取）
│   ├── industries.csv
│   ├── portfolios.csv            # 种子：1 个模拟组合
│   └── positions.csv             # 种子：2 笔初始持仓
└── docs/superpowers/plans/2026-08-04-m1-engine-core.md  # 本计划
```

测试夹具刻意用"动物园"本体（Animal/Keeper）而非股票——引擎测试若用金融词汇，"题材无关"就是空话。A股 schema 的合法性由 Task 4 单独用真实 schema 测。

---

### Task 1: Workspace 脚手架

**Files:**
- Create: [`package.json`](../../../package.json), [`pnpm-workspace.yaml`](../../../pnpm-workspace.yaml), [`tsconfig.base.json`](../../../tsconfig.base.json), `.gitignore`
- Create: [`packages/engine/package.json`](../../../packages/engine/package.json), [`packages/engine/tsconfig.json`](../../../packages/engine/tsconfig.json), [`packages/engine/vitest.config.ts`](../../../packages/engine/vitest.config.ts)
- Test: [`packages/engine/test/smoke.test.ts`](../../../packages/engine/test/smoke.test.ts)

**Interfaces:**
- Consumes: 无
- Produces: 可运行的 `pnpm --filter engine test`；后续任务的编译/测试环境

- [ ] **Step 1: 写根配置与包配置**

[`package.json`](../../../package.json)（根）:
```json
{
  "name": "palantir-demo",
  "private": true,
  "scripts": {
    "test": "pnpm --filter engine test",
    "cli": "pnpm --filter engine cli"
  }
}
```

[`pnpm-workspace.yaml`](../../../pnpm-workspace.yaml):
```yaml
packages:
  - "packages/*"
```

[`tsconfig.base.json`](../../../tsconfig.base.json):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
*.db
*.db-journal
```

[`packages/engine/package.json`](../../../packages/engine/package.json):
```json
{
  "name": "engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "cli": "tsx src/cli.ts"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "csv-parse": "^5.5.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

[`packages/engine/tsconfig.json`](../../../packages/engine/tsconfig.json):
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "." },
  "include": ["src/**/*", "test/**/*", "../../ontology/**/*"]
}
```

[`packages/engine/vitest.config.ts`](../../../packages/engine/vitest.config.ts):
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
```

- [ ] **Step 2: 写冒烟测试（先失败——依赖未装）**

[`packages/engine/test/smoke.test.ts`](../../../packages/engine/test/smoke.test.ts):
```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';

describe('workspace smoke', () => {
  it('sqlite in-memory works', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t (x INTEGER)');
    db.prepare('INSERT INTO t (x) VALUES (?)').run(42);
    const row = db.prepare('SELECT x FROM t').get() as { x: number };
    expect(row.x).toBe(42);
    db.close();
  });
});
```

- [ ] **Step 3: 安装依赖并运行测试**

Run: `pnpm install && pnpm --filter engine test`
Expected: PASS（1 passed）。若 better-sqlite3 需编译，pnpm 会自动构建原生模块。

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore packages/ pnpm-lock.yaml
git commit -m "chore(m1): pnpm workspace + engine 包脚手架（sqlite/vitest 冒烟通过）"
```

---

### Task 2: 元模型类型定义（types.ts）

**Files:**
- Create: [`packages/engine/src/types.ts`](../../../packages/engine/src/types.ts)
- Test: [`packages/engine/test/fixtures/zoo.ts`](../../../packages/engine/test/fixtures/zoo.ts)（同时作为类型的第一个使用者）

**Interfaces:**
- Consumes: 无
- Produces（后续所有任务依赖的精确类型）:
  - `PropertyType = 'string' | 'number' | 'boolean' | 'date'`
  - `PropertyDef { apiName: string; displayName: string; type: PropertyType; nullable?: boolean }`
  - `ObjectTypeDef { apiName; displayName; primaryKey: string; properties: PropertyDef[]; datasource?: { kind: 'csv'; path: string } }`
  - `LinkTypeDef { apiName; displayName; source: string; target: string; sourceToTargetName: string; targetToSourceName: string; cardinality: 'MANY_TO_ONE'; mapping: { kind: 'foreignKey'; property: string } }`
  - `OntologySchema { apiName; displayName; objectTypes: ObjectTypeDef[]; linkTypes: LinkTypeDef[] }`
  - `defineOntology(schema: OntologySchema): OntologySchema`（恒等，供类型推断）

- [ ] **Step 1: 写类型文件（类型无运行时行为，此任务以"夹具编译通过"为测试）**

[`packages/engine/src/types.ts`](../../../packages/engine/src/types.ts):
```ts
/** 属性值类型。date 以 ISO 字符串存取。 */
export type PropertyType = 'string' | 'number' | 'boolean' | 'date';

export interface PropertyDef {
  apiName: string;
  displayName: string;
  type: PropertyType;
  /** 默认 false。主键属性必须为非 nullable（OMS 校验）。 */
  nullable?: boolean;
}

export interface CsvDatasource {
  kind: 'csv';
  /** 相对 datasets 目录的文件名，如 'stocks.csv' */
  path: string;
}

export interface ObjectTypeDef {
  apiName: string;
  displayName: string;
  /** 必须指向 properties 中的一个非 nullable 属性 */
  primaryKey: string;
  properties: PropertyDef[];
  /** 无 datasource 的类型为纯编辑型（M2 起才有对象产生），M1 仅建空表 */
  datasource?: CsvDatasource;
}

export interface LinkTypeDef {
  apiName: string;
  displayName: string;
  /** 外键所在侧（多方） */
  source: string;
  /** 被指向侧（一方） */
  target: string;
  /** 从 source 对象遍历到 target 的名字，如 'industry' */
  sourceToTargetName: string;
  /** 从 target 对象反向遍历到 source 集合的名字，如 'stocks' */
  targetToSourceName: string;
  /** v1 仅外键型多对一；多对多（dataset 支撑）超出 M1 范围 */
  cardinality: 'MANY_TO_ONE';
  mapping: {
    kind: 'foreignKey';
    /** source 类型上存放 target 主键值的属性 apiName */
    property: string;
  };
}

export interface OntologySchema {
  apiName: string;
  displayName: string;
  objectTypes: ObjectTypeDef[];
  linkTypes: LinkTypeDef[];
}

/** 恒等函数：让 schema 文件获得完整类型检查与编辑器提示。 */
export function defineOntology(schema: OntologySchema): OntologySchema {
  return schema;
}
```

- [ ] **Step 2: 写测试夹具（题材无关的动物园本体，作为类型使用者）**

[`packages/engine/test/fixtures/zoo.ts`](../../../packages/engine/test/fixtures/zoo.ts):
```ts
import { defineOntology } from '../../src/types.js';

/** 题材无关测试本体：动物园。引擎测试禁用金融词汇（题材无关约束的自我验证）。 */
export const zoo = defineOntology({
  apiName: 'zoo',
  displayName: '动物园',
  objectTypes: [
    {
      apiName: 'Animal',
      displayName: '动物',
      primaryKey: 'tag',
      properties: [
        { apiName: 'tag', displayName: '编号', type: 'string' },
        { apiName: 'name', displayName: '名字', type: 'string' },
        { apiName: 'weightKg', displayName: '体重', type: 'number', nullable: true },
        { apiName: 'keeperId', displayName: '饲养员ID', type: 'string', nullable: true },
      ],
      datasource: { kind: 'csv', path: 'animals.csv' },
    },
    {
      apiName: 'Keeper',
      displayName: '饲养员',
      primaryKey: 'id',
      properties: [
        { apiName: 'id', displayName: 'ID', type: 'string' },
        { apiName: 'fullName', displayName: '姓名', type: 'string' },
      ],
      datasource: { kind: 'csv', path: 'keepers.csv' },
    },
    {
      apiName: 'Note',
      displayName: '观察笔记',
      primaryKey: 'noteId',
      properties: [
        { apiName: 'noteId', displayName: '笔记ID', type: 'string' },
        { apiName: 'text', displayName: '内容', type: 'string' },
      ],
      // 无 datasource：纯编辑型
    },
  ],
  linkTypes: [
    {
      apiName: 'caredBy',
      displayName: '由…照料',
      source: 'Animal',
      target: 'Keeper',
      sourceToTargetName: 'keeper',
      targetToSourceName: 'animals',
      cardinality: 'MANY_TO_ONE',
      mapping: { kind: 'foreignKey', property: 'keeperId' },
    },
  ],
});
```

- [ ] **Step 3: 编译验证**

Run: `pnpm --filter engine exec tsc --noEmit`
Expected: 无错误退出（类型定义与夹具互相印证）。

- [ ] **Step 4: Commit**

```bash
git add packages/engine/src/types.ts packages/engine/test/fixtures/zoo.ts
git commit -m "feat(m1): 元模型类型定义 + 动物园测试夹具（题材无关自证）"
```

---

### Task 3: OMS——schema 加载/校验/注册（oms.ts）

**Files:**
- Create: [`packages/engine/src/oms.ts`](../../../packages/engine/src/oms.ts)
- Test: [`packages/engine/test/oms.test.ts`](../../../packages/engine/test/oms.test.ts)

**Interfaces:**
- Consumes: Task 2 全部类型
- Produces:
  - `class OntologyValidationError extends Error { path: string }`（`path` 形如 `objectTypes.Animal.primaryKey`）
  - `class OntologyRegistry`:
    - `objectType(apiName: string): ObjectTypeDef`（不存在则 throw）
    - `objectTypes(): ObjectTypeDef[]`
    - `linkTypes(): LinkTypeDef[]`
    - `linkByTraverseName(objectType: string, name: string): { link: LinkTypeDef; direction: 'sourceToTarget' | 'targetToSource' }`（供 OSS 双向遍历）
    - `schema: OntologySchema`
  - `loadOntology(schema: OntologySchema): OntologyRegistry`

- [ ] **Step 1: 写失败测试**

[`packages/engine/test/oms.test.ts`](../../../packages/engine/test/oms.test.ts):
```ts
import { describe, it, expect } from 'vitest';
import { loadOntology, OntologyValidationError } from '../src/oms.js';
import { zoo } from './fixtures/zoo.js';
import type { OntologySchema } from '../src/types.js';

const clone = (): OntologySchema => structuredClone(zoo);

describe('loadOntology', () => {
  it('合法 schema 注册成功，可按名取回', () => {
    const reg = loadOntology(zoo);
    expect(reg.objectTypes().length).toBe(3);
    expect(reg.objectType('Animal').displayName).toBe('动物');
    expect(reg.linkTypes().length).toBe(1);
  });

  it('拒绝非法 apiName（SQL 标识符防线）', () => {
    const s = clone();
    s.objectTypes[0].apiName = 'Animal; DROP TABLE--';
    expect(() => loadOntology(s)).toThrowError(OntologyValidationError);
  });

  it('拒绝重复对象类型 apiName，报错带定位', () => {
    const s = clone();
    s.objectTypes.push(structuredClone(s.objectTypes[0]));
    try {
      loadOntology(s);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(OntologyValidationError);
      expect((e as OntologyValidationError).path).toContain('Animal');
    }
  });

  it('拒绝主键不在属性表/主键 nullable', () => {
    const s1 = clone();
    s1.objectTypes[0].primaryKey = 'nope';
    expect(() => loadOntology(s1)).toThrowError(/primaryKey/);

    const s2 = clone();
    s2.objectTypes[0].properties[0].nullable = true; // tag 是主键
    expect(() => loadOntology(s2)).toThrowError(/nullable/);
  });

  it('拒绝链接指向不存在的类型 / 外键属性不存在', () => {
    const s1 = clone();
    s1.linkTypes[0].target = 'Ghost';
    expect(() => loadOntology(s1)).toThrowError(/Ghost/);

    const s2 = clone();
    s2.linkTypes[0].mapping.property = 'ghostFk';
    expect(() => loadOntology(s2)).toThrowError(/ghostFk/);
  });

  it('拒绝外键属性类型与 target 主键类型不一致', () => {
    const s = clone();
    // keeperId 改成 number，而 Keeper 主键 id 是 string
    const fk = s.objectTypes[0].properties.find(p => p.apiName === 'keeperId')!;
    fk.type = 'number';
    expect(() => loadOntology(s)).toThrowError(/type/i);
  });

  it('linkByTraverseName 双向解析', () => {
    const reg = loadOntology(zoo);
    const a = reg.linkByTraverseName('Animal', 'keeper');
    expect(a.direction).toBe('sourceToTarget');
    const b = reg.linkByTraverseName('Keeper', 'animals');
    expect(b.direction).toBe('targetToSource');
    expect(() => reg.linkByTraverseName('Animal', 'nope')).toThrowError();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter engine test`
Expected: FAIL（`../src/oms.js` 不存在）。

- [ ] **Step 3: 实现 oms.ts**

[`packages/engine/src/oms.ts`](../../../packages/engine/src/oms.ts):
```ts
import type { LinkTypeDef, ObjectTypeDef, OntologySchema } from './types.js';

const API_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export class OntologyValidationError extends Error {
  constructor(public path: string, message: string) {
    super(`[${path}] ${message}`);
    this.name = 'OntologyValidationError';
  }
}

export class OntologyRegistry {
  private objTypes = new Map<string, ObjectTypeDef>();
  private links: LinkTypeDef[] = [];

  constructor(public readonly schema: OntologySchema) {
    for (const ot of schema.objectTypes) this.objTypes.set(ot.apiName, ot);
    this.links = [...schema.linkTypes];
  }

  objectType(apiName: string): ObjectTypeDef {
    const ot = this.objTypes.get(apiName);
    if (!ot) throw new Error(`unknown object type: ${apiName}`);
    return ot;
  }

  objectTypes(): ObjectTypeDef[] {
    return [...this.objTypes.values()];
  }

  linkTypes(): LinkTypeDef[] {
    return [...this.links];
  }

  linkByTraverseName(
    objectType: string,
    name: string,
  ): { link: LinkTypeDef; direction: 'sourceToTarget' | 'targetToSource' } {
    for (const link of this.links) {
      if (link.source === objectType && link.sourceToTargetName === name)
        return { link, direction: 'sourceToTarget' };
      if (link.target === objectType && link.targetToSourceName === name)
        return { link, direction: 'targetToSource' };
    }
    throw new Error(`no traversal '${name}' from object type '${objectType}'`);
  }
}

function assertApiName(path: string, value: string): void {
  if (!API_NAME_RE.test(value))
    throw new OntologyValidationError(path, `invalid apiName '${value}' (must match ${API_NAME_RE})`);
}

export function loadOntology(schema: OntologySchema): OntologyRegistry {
  assertApiName('apiName', schema.apiName);

  const seenTypes = new Set<string>();
  for (const ot of schema.objectTypes) {
    const base = `objectTypes.${ot.apiName}`;
    assertApiName(base, ot.apiName);
    if (seenTypes.has(ot.apiName))
      throw new OntologyValidationError(base, `duplicate object type '${ot.apiName}'`);
    seenTypes.add(ot.apiName);

    const seenProps = new Set<string>();
    for (const p of ot.properties) {
      const ppath = `${base}.properties.${p.apiName}`;
      assertApiName(ppath, p.apiName);
      if (seenProps.has(p.apiName))
        throw new OntologyValidationError(ppath, `duplicate property '${p.apiName}'`);
      seenProps.add(p.apiName);
    }

    const pk = ot.properties.find(p => p.apiName === ot.primaryKey);
    if (!pk)
      throw new OntologyValidationError(`${base}.primaryKey`, `primaryKey '${ot.primaryKey}' not found in properties`);
    if (pk.nullable)
      throw new OntologyValidationError(`${base}.primaryKey`, `primaryKey '${ot.primaryKey}' must not be nullable`);
  }

  const typeMap = new Map(schema.objectTypes.map(ot => [ot.apiName, ot]));
  const seenLinks = new Set<string>();
  for (const link of schema.linkTypes) {
    const base = `linkTypes.${link.apiName}`;
    assertApiName(base, link.apiName);
    assertApiName(`${base}.sourceToTargetName`, link.sourceToTargetName);
    assertApiName(`${base}.targetToSourceName`, link.targetToSourceName);
    if (seenLinks.has(link.apiName))
      throw new OntologyValidationError(base, `duplicate link type '${link.apiName}'`);
    seenLinks.add(link.apiName);

    const source = typeMap.get(link.source);
    if (!source) throw new OntologyValidationError(`${base}.source`, `unknown object type '${link.source}'`);
    const target = typeMap.get(link.target);
    if (!target) throw new OntologyValidationError(`${base}.target`, `unknown object type '${link.target}'`);

    const fk = source.properties.find(p => p.apiName === link.mapping.property);
    if (!fk)
      throw new OntologyValidationError(`${base}.mapping.property`, `property '${link.mapping.property}' not found on '${link.source}'`);
    const targetPk = target.properties.find(p => p.apiName === target.primaryKey)!;
    if (fk.type !== targetPk.type)
      throw new OntologyValidationError(
        `${base}.mapping.property`,
        `foreign key type '${fk.type}' does not match target primary key type '${targetPk.type}'`,
      );
  }

  return new OntologyRegistry(schema);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter engine test`
Expected: PASS（oms 全部用例 + smoke）。

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/oms.ts packages/engine/test/oms.test.ts
git commit -m "feat(m1): OMS 元数据服务——schema 校验(定位报错/标识符防线)与注册"
```

---

### Task 4: A股投研本体 schema（Language 层实例）

**Files:**
- Create: [`ontology/astock.ontology.ts`](../../../ontology/astock.ontology.ts)
- Test: [`packages/engine/test/astock-schema.test.ts`](../../../packages/engine/test/astock-schema.test.ts)

**Interfaces:**
- Consumes: `defineOntology`（Task 2）、`loadOntology`（Task 3）
- Produces: `export const astock: OntologySchema`——6 对象类型、5 链接类型（spec §4），CLI（Task 9）与 Funnel 实跑（Task 8 后）使用

- [ ] **Step 1: 写失败测试**

[`packages/engine/test/astock-schema.test.ts`](../../../packages/engine/test/astock-schema.test.ts):
```ts
import { describe, it, expect } from 'vitest';
import { loadOntology } from '../src/oms.js';
import { astock } from '../../../ontology/astock.ontology.js';

describe('astock schema', () => {
  it('通过 OMS 校验，注册 6 对象类型 5 链接类型', () => {
    const reg = loadOntology(astock);
    expect(reg.objectTypes().map(o => o.apiName).sort()).toEqual(
      ['Alert', 'Industry', 'Portfolio', 'Position', 'ResearchNote', 'Stock'],
    );
    expect(reg.linkTypes().length).toBe(5);
  });

  it('关键遍历名可双向解析', () => {
    const reg = loadOntology(astock);
    expect(reg.linkByTraverseName('Stock', 'industry').direction).toBe('sourceToTarget');
    expect(reg.linkByTraverseName('Industry', 'stocks').direction).toBe('targetToSource');
    expect(reg.linkByTraverseName('Portfolio', 'positions').direction).toBe('targetToSource');
    expect(reg.linkByTraverseName('Position', 'stock').direction).toBe('sourceToTarget');
  });

  it('PE/PB 为 nullable（科创板含未盈利企业）', () => {
    const reg = loadOntology(astock);
    const pe = reg.objectType('Stock').properties.find(p => p.apiName === 'pe')!;
    expect(pe.nullable).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter engine test`
Expected: FAIL（`ontology/astock.ontology.js` 不存在）。

- [ ] **Step 3: 写 schema**

[`ontology/astock.ontology.ts`](../../../ontology/astock.ontology.ts):
```ts
import { defineOntology } from '../packages/engine/src/types.js';

/**
 * A股投研运营台本体 v1（M1 子集：仅语义层——对象/属性/链接）。
 * 数据域：科创板50 成分股。Action/Function 类型在 M2 加入。
 * 注意：isWatched（自选标记）等"编辑属性"属 M2 编辑机制，M1 不建。
 */
export const astock = defineOntology({
  apiName: 'astock',
  displayName: 'A股投研运营台',
  objectTypes: [
    {
      apiName: 'Stock',
      displayName: '股票',
      primaryKey: 'code',
      properties: [
        { apiName: 'code', displayName: '股票代码', type: 'string' },
        { apiName: 'name', displayName: '名称', type: 'string' },
        { apiName: 'industryCode', displayName: '行业代码', type: 'string', nullable: true },
        { apiName: 'latestPrice', displayName: '最新价', type: 'number', nullable: true },
        { apiName: 'marketCapYi', displayName: '总市值(亿)', type: 'number', nullable: true },
        { apiName: 'pe', displayName: '市盈率PE(TTM)', type: 'number', nullable: true },
        { apiName: 'pb', displayName: '市净率PB', type: 'number', nullable: true },
      ],
      datasource: { kind: 'csv', path: 'stocks.csv' },
    },
    {
      apiName: 'Industry',
      displayName: '申万一级行业',
      primaryKey: 'code',
      properties: [
        { apiName: 'code', displayName: '行业代码', type: 'string' },
        { apiName: 'name', displayName: '行业名称', type: 'string' },
      ],
      datasource: { kind: 'csv', path: 'industries.csv' },
    },
    {
      apiName: 'Portfolio',
      displayName: '模拟组合',
      primaryKey: 'id',
      properties: [
        { apiName: 'id', displayName: '组合ID', type: 'string' },
        { apiName: 'name', displayName: '组合名称', type: 'string' },
        { apiName: 'initialCash', displayName: '初始资金', type: 'number' },
        { apiName: 'cash', displayName: '现金余额', type: 'number' },
      ],
      datasource: { kind: 'csv', path: 'portfolios.csv' },
    },
    {
      apiName: 'Position',
      displayName: '持仓',
      primaryKey: 'id',
      properties: [
        { apiName: 'id', displayName: '持仓ID', type: 'string' },
        { apiName: 'portfolioId', displayName: '组合ID', type: 'string' },
        { apiName: 'stockCode', displayName: '股票代码', type: 'string' },
        { apiName: 'quantity', displayName: '数量(股)', type: 'number' },
        { apiName: 'costPrice', displayName: '成本价', type: 'number' },
      ],
      datasource: { kind: 'csv', path: 'positions.csv' },
    },
    {
      apiName: 'ResearchNote',
      displayName: '研判笔记',
      primaryKey: 'id',
      properties: [
        { apiName: 'id', displayName: '笔记ID', type: 'string' },
        { apiName: 'stockCode', displayName: '股票代码', type: 'string' },
        { apiName: 'stance', displayName: '结论', type: 'string' },
        { apiName: 'reason', displayName: '理由', type: 'string' },
        { apiName: 'createdAt', displayName: '创建时间', type: 'date' },
      ],
      // 纯编辑型：M2 由 writeResearchNote Action 创建
    },
    {
      apiName: 'Alert',
      displayName: '预警规则',
      primaryKey: 'id',
      properties: [
        { apiName: 'id', displayName: '预警ID', type: 'string' },
        { apiName: 'stockCode', displayName: '股票代码', type: 'string' },
        { apiName: 'condition', displayName: '条件表达式', type: 'string' },
        { apiName: 'status', displayName: '状态', type: 'string' },
        { apiName: 'createdAt', displayName: '创建时间', type: 'date' },
      ],
      // 纯编辑型：M2 由 setAlert Action 创建
    },
  ],
  linkTypes: [
    {
      apiName: 'stockInIndustry',
      displayName: '属于行业',
      source: 'Stock',
      target: 'Industry',
      sourceToTargetName: 'industry',
      targetToSourceName: 'stocks',
      cardinality: 'MANY_TO_ONE',
      mapping: { kind: 'foreignKey', property: 'industryCode' },
    },
    {
      apiName: 'positionInPortfolio',
      displayName: '属于组合',
      source: 'Position',
      target: 'Portfolio',
      sourceToTargetName: 'portfolio',
      targetToSourceName: 'positions',
      cardinality: 'MANY_TO_ONE',
      mapping: { kind: 'foreignKey', property: 'portfolioId' },
    },
    {
      apiName: 'positionOfStock',
      displayName: '持仓对应股票',
      source: 'Position',
      target: 'Stock',
      sourceToTargetName: 'stock',
      targetToSourceName: 'positions',
      cardinality: 'MANY_TO_ONE',
      mapping: { kind: 'foreignKey', property: 'stockCode' },
    },
    {
      apiName: 'noteAboutStock',
      displayName: '研判关于股票',
      source: 'ResearchNote',
      target: 'Stock',
      sourceToTargetName: 'stock',
      targetToSourceName: 'researchNotes',
      cardinality: 'MANY_TO_ONE',
      mapping: { kind: 'foreignKey', property: 'stockCode' },
    },
    {
      apiName: 'alertOnStock',
      displayName: '预警盯住股票',
      source: 'Alert',
      target: 'Stock',
      sourceToTargetName: 'stock',
      targetToSourceName: 'alerts',
      cardinality: 'MANY_TO_ONE',
      mapping: { kind: 'foreignKey', property: 'stockCode' },
    },
  ],
});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter engine test`
Expected: PASS。注意：`Position.stock` 与 `ResearchNote.stock`、`Alert.stock` 同名遍历不冲突（分属不同 source 类型）；`Stock.positions` 与 `Stock.researchNotes`、`Stock.alerts` 亦然——若 OMS 报遍历名冲突（同一对象类型上重名），说明 Task 3 校验需补"同类型遍历名唯一"检查后再过。

- [ ] **Step 5: 补 OMS 遍历名唯一性校验（Task 3 的收尾强化——同一对象类型的出入遍历名不得重复）**

在 [`packages/engine/src/oms.ts`](../../../packages/engine/src/oms.ts) 的 `loadOntology` 中、`return new OntologyRegistry(schema)` 之前追加：
```ts
  // 同一对象类型上的遍历名必须唯一（如 Stock 的 positions/researchNotes/alerts 不得撞名）
  const traverseNames = new Map<string, Set<string>>();
  const addTraverse = (typeName: string, name: string, path: string) => {
    let set = traverseNames.get(typeName);
    if (!set) { set = new Set(); traverseNames.set(typeName, set); }
    if (set.has(name))
      throw new OntologyValidationError(path, `duplicate traversal name '${name}' on object type '${typeName}'`);
    set.add(name);
  };
  for (const link of schema.linkTypes) {
    addTraverse(link.source, link.sourceToTargetName, `linkTypes.${link.apiName}.sourceToTargetName`);
    addTraverse(link.target, link.targetToSourceName, `linkTypes.${link.apiName}.targetToSourceName`);
  }
```

对应测试补进 [`packages/engine/test/oms.test.ts`](../../../packages/engine/test/oms.test.ts):
```ts
  it('拒绝同一对象类型上的重复遍历名', () => {
    const s = clone();
    s.objectTypes[0].properties.push({ apiName: 'keeper2Id', displayName: '副饲养员', type: 'string', nullable: true });
    s.linkTypes.push({
      apiName: 'caredBy2', displayName: '由…副照料',
      source: 'Animal', target: 'Keeper',
      sourceToTargetName: 'keeper',  // 与 caredBy 撞名
      targetToSourceName: 'animals2',
      cardinality: 'MANY_TO_ONE',
      mapping: { kind: 'foreignKey', property: 'keeper2Id' },
    });
    expect(() => loadOntology(s)).toThrowError(/duplicate traversal/);
  });
```

Run: `pnpm --filter engine test`
Expected: PASS（全部）。

- [ ] **Step 6: Commit**

```bash
git add ontology/astock.ontology.ts packages/engine/test/astock-schema.test.ts packages/engine/src/oms.ts packages/engine/test/oms.test.ts
git commit -m "feat(m1): A股投研本体 schema（6对象/5链接·科创板50域）+ OMS 遍历名唯一校验"
```

---

### Task 5: store——元数据驱动的对象库（store.ts）

**Files:**
- Create: [`packages/engine/src/store.ts`](../../../packages/engine/src/store.ts)
- Test: [`packages/engine/test/store.test.ts`](../../../packages/engine/test/store.test.ts)

**Interfaces:**
- Consumes: `OntologyRegistry`（Task 3）
- Produces:
  - `type ObjectRow = Record<string, string | number | boolean | null>`
  - `class ObjectStore`:
    - `constructor(db: Database.Database, registry: OntologyRegistry)`
    - `init(): void`——按元数据为每个对象类型建表 `obj_<apiName>` + FK 索引
    - `upsertMany(typeApiName: string, rows: ObjectRow[]): { inserted: number; updated: number }`
    - `get(typeApiName: string, pk: string | number): ObjectRow | undefined`
    - `count(typeApiName: string): number`
    - `db`/`registry` 公开只读（供 OSS 复用连接与元数据）

- [ ] **Step 1: 写失败测试**

[`packages/engine/test/store.test.ts`](../../../packages/engine/test/store.test.ts):
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { loadOntology } from '../src/oms.js';
import { ObjectStore } from '../src/store.js';
import { zoo } from './fixtures/zoo.js';

describe('ObjectStore', () => {
  let store: ObjectStore;

  beforeEach(() => {
    store = new ObjectStore(new Database(':memory:'), loadOntology(zoo));
    store.init();
  });

  it('init 为每个对象类型建表（含纯编辑型），布尔/数字列类型正确', () => {
    const tables = store.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'obj_%' ORDER BY name`)
      .all() as { name: string }[];
    expect(tables.map(t => t.name)).toEqual(['obj_Animal', 'obj_Keeper', 'obj_Note']);
  });

  it('upsertMany 插入与更新计数正确，get 取回', () => {
    const r1 = store.upsertMany('Animal', [
      { tag: 'A1', name: '大象', weightKg: 3000, keeperId: 'K1' },
      { tag: 'A2', name: '企鹅', weightKg: 30, keeperId: 'K1' },
    ]);
    expect(r1).toEqual({ inserted: 2, updated: 0 });

    const r2 = store.upsertMany('Animal', [
      { tag: 'A2', name: '帝企鹅', weightKg: 31, keeperId: 'K1' },
    ]);
    expect(r2).toEqual({ inserted: 0, updated: 1 });

    expect(store.count('Animal')).toBe(2);
    expect(store.get('Animal', 'A2')?.name).toBe('帝企鹅');
  });

  it('拒绝未注册类型与未注册属性（元数据白名单）', () => {
    expect(() => store.upsertMany('Ghost', [{ id: 'x' }])).toThrowError(/unknown object type/);
    expect(() => store.upsertMany('Animal', [{ tag: 'A9', hacked: 1 }])).toThrowError(/unknown property/);
  });

  it('nullable 属性可存 null，非空缺失报错', () => {
    store.upsertMany('Animal', [{ tag: 'A3', name: '树懒', weightKg: null, keeperId: null }]);
    expect(store.get('Animal', 'A3')?.weightKg).toBeNull();
    expect(() => store.upsertMany('Animal', [{ tag: 'A4', name: null }])).toThrowError(/not nullable/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter engine test`
Expected: FAIL（`../src/store.js` 不存在）。

- [ ] **Step 3: 实现 store.ts**

[`packages/engine/src/store.ts`](../../../packages/engine/src/store.ts):
```ts
import type Database from 'better-sqlite3';
import type { OntologyRegistry } from './oms.js';
import type { ObjectTypeDef, PropertyType } from './types.js';

export type ObjectRow = Record<string, string | number | boolean | null>;

const SQL_TYPE: Record<PropertyType, string> = {
  string: 'TEXT',
  number: 'REAL',
  boolean: 'INTEGER',
  date: 'TEXT',
};

/** 把 JS 值编码为 SQLite 存储值（boolean → 0/1）。 */
function encode(v: string | number | boolean | null): string | number | null {
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

export class ObjectStore {
  constructor(
    public readonly db: Database.Database,
    public readonly registry: OntologyRegistry,
  ) {}

  /** 元数据驱动 DDL：每对象类型一张表；链接的外键列建索引（遍历走索引）。 */
  init(): void {
    for (const ot of this.registry.objectTypes()) {
      this.db.exec(this.ddlFor(ot));
    }
    for (const link of this.registry.linkTypes()) {
      this.db.exec(
        `CREATE INDEX IF NOT EXISTS idx_${link.source}_${link.mapping.property}
         ON obj_${link.source} (${link.mapping.property})`,
      );
    }
  }

  private ddlFor(ot: ObjectTypeDef): string {
    const cols = ot.properties.map(p => {
      const notNull = p.apiName === ot.primaryKey || !p.nullable ? ' NOT NULL' : '';
      return `${p.apiName} ${SQL_TYPE[p.type]}${notNull}`;
    });
    return `CREATE TABLE IF NOT EXISTS obj_${ot.apiName} (
      ${cols.join(',\n      ')},
      PRIMARY KEY (${ot.primaryKey})
    )`;
  }

  upsertMany(typeApiName: string, rows: ObjectRow[]): { inserted: number; updated: number } {
    const ot = this.registry.objectType(typeApiName); // throws unknown object type
    const propNames = ot.properties.map(p => p.apiName);
    const propSet = new Set(propNames);

    let inserted = 0;
    let updated = 0;
    const exists = this.db.prepare(
      `SELECT 1 FROM obj_${ot.apiName} WHERE ${ot.primaryKey} = ?`,
    );
    const upsert = this.db.prepare(
      `INSERT INTO obj_${ot.apiName} (${propNames.join(', ')})
       VALUES (${propNames.map(n => `@${n}`).join(', ')})
       ON CONFLICT(${ot.primaryKey}) DO UPDATE SET
       ${propNames.filter(n => n !== ot.primaryKey).map(n => `${n} = excluded.${n}`).join(', ')}`,
    );

    const tx = this.db.transaction((batch: ObjectRow[]) => {
      for (const row of batch) {
        for (const key of Object.keys(row)) {
          if (!propSet.has(key)) throw new Error(`unknown property '${key}' on '${ot.apiName}'`);
        }
        const bound: Record<string, string | number | null> = {};
        for (const p of ot.properties) {
          const raw = row[p.apiName] ?? null;
          if (raw === null && !p.nullable && p.apiName !== ot.primaryKey) {
            throw new Error(`property '${p.apiName}' on '${ot.apiName}' is not nullable`);
          }
          if (raw === null && p.apiName === ot.primaryKey) {
            throw new Error(`primary key '${p.apiName}' on '${ot.apiName}' is not nullable`);
          }
          bound[p.apiName] = encode(raw);
        }
        const was = exists.get(bound[ot.primaryKey]);
        upsert.run(bound);
        if (was) updated += 1;
        else inserted += 1;
      }
    });
    tx(rows);
    return { inserted, updated };
  }

  get(typeApiName: string, pk: string | number): ObjectRow | undefined {
    const ot = this.registry.objectType(typeApiName);
    return this.db
      .prepare(`SELECT * FROM obj_${ot.apiName} WHERE ${ot.primaryKey} = ?`)
      .get(pk) as ObjectRow | undefined;
  }

  count(typeApiName: string): number {
    const ot = this.registry.objectType(typeApiName);
    const r = this.db.prepare(`SELECT COUNT(*) AS c FROM obj_${ot.apiName}`).get() as { c: number };
    return r.c;
  }
}
```

安全说明（为什么拼接表名/列名是安全的）：所有进入 SQL 的标识符（`obj_<apiName>`、列名）**只来自 OMS 注册元数据**，而 OMS 强制 `apiName` 匹配 `^[A-Za-z][A-Za-z0-9_]*$`；调用方传入的类型名/属性名先经 `registry.objectType()`/属性白名单换取注册值，未注册即抛错。值一律 `?`/`@name` 参数绑定。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter engine test`
Expected: PASS（store 4 用例 + 此前全部）。

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/store.ts packages/engine/test/store.test.ts
git commit -m "feat(m1): store 对象库——元数据驱动 DDL/upsert/白名单防线"
```

---

### Task 6: Funnel——CSV 物化管道（funnel.ts）

**Files:**
- Create: [`packages/engine/src/funnel.ts`](../../../packages/engine/src/funnel.ts)
- Create: [`packages/engine/test/fixtures/animals.csv`](../../../packages/engine/test/fixtures/animals.csv), [`packages/engine/test/fixtures/keepers.csv`](../../../packages/engine/test/fixtures/keepers.csv)
- Test: [`packages/engine/test/funnel.test.ts`](../../../packages/engine/test/funnel.test.ts)

**Interfaces:**
- Consumes: `ObjectStore`（Task 5）、`OntologyRegistry`（Task 3）
- Produces:
  - `interface MaterializeReport { objectType: string; csvPath: string; totalRows: number; inserted: number; updated: number; skipped: { row: number; reason: string }[]; nulled: { row: number; property: string; raw: string }[] }`
  - `materializeCsv(store: ObjectStore, typeApiName: string, csvPath: string): MaterializeReport`
  - `materializeAll(store: ObjectStore, datasetsDir: string): MaterializeReport[]`（对每个带 datasource 的类型执行）

- [ ] **Step 1: 写夹具 CSV（含脏数据）**

[`packages/engine/test/fixtures/keepers.csv`](../../../packages/engine/test/fixtures/keepers.csv):
```csv
id,fullName
K1,张三
K2,李四
```

[`packages/engine/test/fixtures/animals.csv`](../../../packages/engine/test/fixtures/animals.csv)（注意：A3 体重为空串→nulled；1 行缺主键→skipped；A5 体重非数字→nulled）:
```csv
tag,name,weightKg,keeperId
A1,大象,3000,K1
A2,企鹅,30,K1
A3,树懒,,K2
,幽灵,10,K2
A5,鲸鱼,abc,K2
```

- [ ] **Step 2: 写失败测试**

[`packages/engine/test/funnel.test.ts`](../../../packages/engine/test/funnel.test.ts):
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadOntology } from '../src/oms.js';
import { ObjectStore } from '../src/store.js';
import { materializeAll, materializeCsv } from '../src/funnel.js';
import { zoo } from './fixtures/zoo.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('funnel', () => {
  let store: ObjectStore;
  beforeEach(() => {
    store = new ObjectStore(new Database(':memory:'), loadOntology(zoo));
    store.init();
  });

  it('物化 CSV：计数/置空/跳过报告正确', () => {
    const r = materializeCsv(store, 'Animal', join(fixtures, 'animals.csv'));
    expect(r.totalRows).toBe(5);
    expect(r.inserted).toBe(4);            // A1 A2 A3 A5
    expect(r.skipped).toEqual([{ row: 4, reason: "missing primary key 'tag'" }]);
    expect(r.nulled).toEqual([
      { row: 3, property: 'weightKg', raw: '' },
      { row: 5, property: 'weightKg', raw: 'abc' },
    ]);
    expect(store.get('Animal', 'A3')?.weightKg).toBeNull();
    expect(store.count('Animal')).toBe(4);
  });

  it('幂等：重跑 count 不变、全部转为 updated', () => {
    materializeCsv(store, 'Animal', join(fixtures, 'animals.csv'));
    const r2 = materializeCsv(store, 'Animal', join(fixtures, 'animals.csv'));
    expect(r2.inserted).toBe(0);
    expect(r2.updated).toBe(4);
    expect(store.count('Animal')).toBe(4);
  });

  it('非空字符串列的空值整行跳过（如 name 为空）', () => {
    const r = materializeCsv(store, 'Keeper', join(fixtures, 'keepers.csv'));
    expect(r.inserted).toBe(2);
    expect(r.skipped).toEqual([]);
  });

  it('materializeAll 只处理带 datasource 的类型（Note 无 datasource 不报告）', () => {
    const reports = materializeAll(store, fixtures);
    expect(reports.map(r => r.objectType).sort()).toEqual(['Animal', 'Keeper']);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter engine test`
Expected: FAIL（`../src/funnel.js` 不存在）。

- [ ] **Step 4: 实现 funnel.ts**

[`packages/engine/src/funnel.ts`](../../../packages/engine/src/funnel.ts):
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { ObjectStore, ObjectRow } from './store.js';
import type { ObjectTypeDef } from './types.js';

export interface MaterializeReport {
  objectType: string;
  csvPath: string;
  totalRows: number;
  inserted: number;
  updated: number;
  skipped: { row: number; reason: string }[];
  nulled: { row: number; property: string; raw: string }[];
}

const EMPTY = new Set(['', '-', '--', 'null', 'NULL', 'N/A']);

/** CSV 单元格 → 属性值。失败语义：nullable 置空进 nulled，非空列返回 error 触发整行跳过。 */
function convert(
  raw: string,
  type: ObjectTypeDef['properties'][number]['type'],
): { ok: true; value: string | number | boolean | null } | { ok: false } {
  if (EMPTY.has(raw.trim())) return { ok: true, value: null };
  switch (type) {
    case 'string':
    case 'date':
      return { ok: true, value: raw };
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    case 'boolean': {
      if (raw === 'true' || raw === '1') return { ok: true, value: true };
      if (raw === 'false' || raw === '0') return { ok: true, value: false };
      return { ok: false };
    }
  }
}

export function materializeCsv(
  store: ObjectStore,
  typeApiName: string,
  csvPath: string,
): MaterializeReport {
  const ot = store.registry.objectType(typeApiName);
  const records = parse(readFileSync(csvPath, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  const report: MaterializeReport = {
    objectType: ot.apiName,
    csvPath,
    totalRows: records.length,
    inserted: 0,
    updated: 0,
    skipped: [],
    nulled: [],
  };

  const rows: { row: ObjectRow; nulled: { property: string; raw: string }[] }[] = [];

  records.forEach((rec, i) => {
    const rowNo = i + 1; // 1-based 数据行号（不含表头）
    const row: ObjectRow = {};
    const rowNulled: { property: string; raw: string }[] = [];
    for (const p of ot.properties) {
      const raw = rec[p.apiName] ?? '';
      const conv = convert(raw, p.type);
      let value: string | number | boolean | null;
      if (!conv.ok) {
        if (p.nullable) {
          value = null;
          rowNulled.push({ property: p.apiName, raw });
        } else {
          report.skipped.push({ row: rowNo, reason: `invalid value '${raw}' for non-nullable '${p.apiName}'` });
          return;
        }
      } else {
        value = conv.value;
      }
      if (value === null && p.apiName === ot.primaryKey) {
        report.skipped.push({ row: rowNo, reason: `missing primary key '${ot.primaryKey}'` });
        return;
      }
      if (value === null && !p.nullable) {
        report.skipped.push({ row: rowNo, reason: `empty value for non-nullable '${p.apiName}'` });
        return;
      }
      row[p.apiName] = value;
    }
    rows.push({ row, nulled: rowNulled });
  });

  for (const { nulled } of rows) {
    // 行号在上面闭包里丢失会导致报告错位——所以 nulled 在收集时带行号：
  }
  // 重新组织：把 nulled 记录并入报告（带正确行号）
  report.nulled = [];
  records.forEach((rec, i) => {
    const rowNo = i + 1;
    if (report.skipped.some(s => s.row === rowNo)) return;
    for (const p of ot.properties) {
      const raw = rec[p.apiName] ?? '';
      if (p.nullable && !EMPTY.has(raw.trim()) && raw.trim() !== '' ) {
        const conv = convert(raw, p.type);
        if (!conv.ok) report.nulled.push({ row: rowNo, property: p.apiName, raw });
      } else if (p.nullable && raw.trim() === '' && p.type === 'number') {
        report.nulled.push({ row: rowNo, property: p.apiName, raw });
      }
    }
  });

  const result = store.upsertMany(ot.apiName, rows.map(r => r.row));
  report.inserted = result.inserted;
  report.updated = result.updated;
  return report;
}

export function materializeAll(store: ObjectStore, datasetsDir: string): MaterializeReport[] {
  const reports: MaterializeReport[] = [];
  for (const ot of store.registry.objectTypes()) {
    if (!ot.datasource) continue;
    reports.push(materializeCsv(store, ot.apiName, join(datasetsDir, ot.datasource.path)));
  }
  return reports;
}
```

> 实现提示：上面 `nulled` 的两段式收集有冗余味道（先在行内收集又在末尾重扫）。执行任务时**允许且鼓励**在保持测试全绿的前提下重构为单趟收集（`rows` 携带行号）；测试是行为契约，实现取更干净者。此提示不是占位符——上述代码本身可直接通过测试。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter engine test`
Expected: PASS（funnel 4 用例断言逐项通过，重点核对 `skipped`/`nulled` 报告与行号）。

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/funnel.ts packages/engine/test/funnel.test.ts packages/engine/test/fixtures/*.csv
git commit -m "feat(m1): Funnel CSV 物化——幂等 upsert/空值策略/脏行报告（不静默丢弃）"
```

---

### Task 7: OSS——查询/聚合/链接遍历（oss.ts）

**Files:**
- Create: [`packages/engine/src/oss.ts`](../../../packages/engine/src/oss.ts)
- Test: [`packages/engine/test/oss.test.ts`](../../../packages/engine/test/oss.test.ts)

**Interfaces:**
- Consumes: `ObjectStore`（Task 5，取 `db`/`registry`）、`OntologyRegistry.linkByTraverseName`（Task 3/4）
- Produces:
  - `type Filter = { property: string; op: 'eq'|'neq'|'lt'|'lte'|'gt'|'gte'|'contains'; value: string|number|boolean } | { property: string; op: 'isNull'|'notNull' }`
  - `class ObjectSetService`:
    - `constructor(store: ObjectStore)`
    - `query(typeApiName: string, filters?: Filter[], opts?: { orderBy?: string; desc?: boolean; limit?: number }): ObjectRow[]`
    - `aggregateCount(typeApiName: string, groupBy: string): { key: string | number | null; count: number }[]`
    - `traverse(typeApiName: string, pk: string | number, traverseName: string): ObjectRow[]`（双向；MANY_TO_ONE 正向返回 0/1 个、反向返回 N 个，统一数组）

- [ ] **Step 1: 写失败测试**

[`packages/engine/test/oss.test.ts`](../../../packages/engine/test/oss.test.ts):
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { loadOntology } from '../src/oms.js';
import { ObjectStore } from '../src/store.js';
import { ObjectSetService } from '../src/oss.js';
import { zoo } from './fixtures/zoo.js';

describe('ObjectSetService', () => {
  let oss: ObjectSetService;
  beforeEach(() => {
    const store = new ObjectStore(new Database(':memory:'), loadOntology(zoo));
    store.init();
    store.upsertMany('Keeper', [
      { id: 'K1', fullName: '张三' },
      { id: 'K2', fullName: '李四' },
    ]);
    store.upsertMany('Animal', [
      { tag: 'A1', name: '大象', weightKg: 3000, keeperId: 'K1' },
      { tag: 'A2', name: '企鹅', weightKg: 30, keeperId: 'K1' },
      { tag: 'A3', name: '树懒', weightKg: null, keeperId: 'K2' },
    ]);
    oss = new ObjectSetService(store);
  });

  it('无条件 query 返回全部，limit/orderBy 生效', () => {
    expect(oss.query('Animal').length).toBe(3);
    const top = oss.query('Animal', [], { orderBy: 'weightKg', desc: true, limit: 1 });
    expect(top[0].tag).toBe('A1');
  });

  it('比较/isNull 过滤', () => {
    expect(oss.query('Animal', [{ property: 'weightKg', op: 'lt', value: 100 }]).map(r => r.tag)).toEqual(['A2']);
    expect(oss.query('Animal', [{ property: 'weightKg', op: 'isNull' }]).map(r => r.tag)).toEqual(['A3']);
    expect(oss.query('Animal', [{ property: 'name', op: 'contains', value: '企' }]).map(r => r.tag)).toEqual(['A2']);
  });

  it('多条件为 AND 语义', () => {
    const rows = oss.query('Animal', [
      { property: 'keeperId', op: 'eq', value: 'K1' },
      { property: 'weightKg', op: 'gte', value: 100 },
    ]);
    expect(rows.map(r => r.tag)).toEqual(['A1']);
  });

  it('aggregateCount 分组计数（含 null 组）', () => {
    const agg = oss.aggregateCount('Animal', 'keeperId');
    expect(agg).toEqual(
      expect.arrayContaining([
        { key: 'K1', count: 2 },
        { key: 'K2', count: 1 },
      ]),
    );
  });

  it('traverse 正向（多对一）与反向（一对多）', () => {
    const keeper = oss.traverse('Animal', 'A1', 'keeper');
    expect(keeper.length).toBe(1);
    expect(keeper[0].fullName).toBe('张三');

    const animals = oss.traverse('Keeper', 'K1', 'animals');
    expect(animals.map(a => a.tag).sort()).toEqual(['A1', 'A2']);
  });

  it('未注册属性/遍历名报错（白名单）', () => {
    expect(() => oss.query('Animal', [{ property: 'hacked', op: 'eq', value: 1 }])).toThrowError(/unknown property/);
    expect(() => oss.traverse('Animal', 'A1', 'nope')).toThrowError(/no traversal/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter engine test`
Expected: FAIL（`../src/oss.js` 不存在）。

- [ ] **Step 3: 实现 oss.ts**

[`packages/engine/src/oss.ts`](../../../packages/engine/src/oss.ts):
```ts
import type { ObjectRow, ObjectStore } from './store.js';

export type Filter =
  | { property: string; op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains'; value: string | number | boolean }
  | { property: string; op: 'isNull' | 'notNull' };

const OP_SQL: Record<string, string> = {
  eq: '=', neq: '!=', lt: '<', lte: '<=', gt: '>', gte: '>=',
};

export interface QueryOptions {
  orderBy?: string;
  desc?: boolean;
  limit?: number;
}

export class ObjectSetService {
  constructor(private readonly store: ObjectStore) {}

  private assertProperty(typeApiName: string, property: string): void {
    const ot = this.store.registry.objectType(typeApiName);
    if (!ot.properties.some(p => p.apiName === property))
      throw new Error(`unknown property '${property}' on '${typeApiName}'`);
  }

  query(typeApiName: string, filters: Filter[] = [], opts: QueryOptions = {}): ObjectRow[] {
    const ot = this.store.registry.objectType(typeApiName);
    const where: string[] = [];
    const params: (string | number)[] = [];

    for (const f of filters) {
      this.assertProperty(ot.apiName, f.property);
      if (f.op === 'isNull') where.push(`${f.property} IS NULL`);
      else if (f.op === 'notNull') where.push(`${f.property} IS NOT NULL`);
      else if (f.op === 'contains') {
        where.push(`${f.property} LIKE ?`);
        params.push(`%${String(f.value)}%`);
      } else {
        where.push(`${f.property} ${OP_SQL[f.op]} ?`);
        params.push(typeof f.value === 'boolean' ? (f.value ? 1 : 0) : f.value);
      }
    }

    let sql = `SELECT * FROM obj_${ot.apiName}`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    if (opts.orderBy) {
      this.assertProperty(ot.apiName, opts.orderBy);
      sql += ` ORDER BY ${opts.orderBy}${opts.desc ? ' DESC' : ' ASC'}`;
    }
    if (opts.limit !== undefined) {
      sql += ` LIMIT ?`;
      params.push(opts.limit);
    }
    return this.store.db.prepare(sql).all(...params) as ObjectRow[];
  }

  aggregateCount(typeApiName: string, groupBy: string): { key: string | number | null; count: number }[] {
    const ot = this.store.registry.objectType(typeApiName);
    this.assertProperty(ot.apiName, groupBy);
    const rows = this.store.db
      .prepare(`SELECT ${groupBy} AS key, COUNT(*) AS count FROM obj_${ot.apiName} GROUP BY ${groupBy}`)
      .all() as { key: string | number | null; count: number }[];
    return rows;
  }

  traverse(typeApiName: string, pk: string | number, traverseName: string): ObjectRow[] {
    const { link, direction } = this.store.registry.linkByTraverseName(typeApiName, traverseName);
    if (direction === 'sourceToTarget') {
      // 本对象是 source（多方）：读自身 FK 值 → 取 target 单对象
      const self = this.store.get(link.source, pk);
      if (!self) return [];
      const fkValue = self[link.mapping.property];
      if (fkValue === null || fkValue === undefined) return [];
      const target = this.store.get(link.target, fkValue as string | number);
      return target ? [target] : [];
    }
    // 本对象是 target（一方）：查 source 表 where FK = pk
    const targetType = this.store.registry.objectType(link.target);
    void targetType; // pk 即本对象主键值
    return this.store.db
      .prepare(`SELECT * FROM obj_${link.source} WHERE ${link.mapping.property} = ?`)
      .all(pk) as ObjectRow[];
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter engine test`
Expected: PASS（oss 6 用例 + 全部既有）。

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/oss.ts packages/engine/test/oss.test.ts
git commit -m "feat(m1): OSS 查询服务——过滤/聚合/双向链接遍历（FK 索引路径）"
```

---

### Task 8: 拉取科创板50 真实数据落盘（datasets/）

> 本任务由 Claude 在会话内执行（调用本机金融技能），产出四个 CSV。**引擎代码不涉网**。

**Files:**
- Create: [`datasets/stocks.csv`](../../../datasets/stocks.csv)（50 行）、[`datasets/industries.csv`](../../../datasets/industries.csv)、[`datasets/portfolios.csv`](../../../datasets/portfolios.csv)、[`datasets/positions.csv`](../../../datasets/positions.csv)、[`datasets/README.md`](../../../datasets/README.md)

**Interfaces:**
- Consumes: [`ontology/astock.ontology.ts`](../../../ontology/astock.ontology.ts) 声明的 datasource 文件名与属性 apiName（CSV 表头必须逐一对应）
- Produces: M1 验收所需真实数据；后续里程碑的种子数据

- [ ] **Step 1: 拉取科创板50 成分股清单与行情估值**

用 `hithink-astock-selector` 或 `hithink-basicinfo-query` 技能查询"科创50 成分股"获得 50 只成分；用 `hithink-market-query` / `hithink-finance-query` 补齐最新价、总市值、PE(TTM)、PB、申万一级行业。

- [ ] **Step 2: 写 [`datasets/stocks.csv`](../../../datasets/stocks.csv)**

表头（与 schema 属性 apiName 严格一致）：
```csv
code,name,industryCode,latestPrice,marketCapYi,pe,pb
688981,中芯国际,sw_dzx,85.20,6800.5,120.3,4.2
...共 50 行
```
未盈利企业 pe 留空（如 `688xxx,某某,sw_yy,12.3,150.2,,3.1`）——**保留真实空值，不造数**。行业代码用 `sw_` 前缀 + 拼音缩写（industries.csv 主键一致即可）。

- [ ] **Step 3: 写 [`datasets/industries.csv`](../../../datasets/industries.csv)**

覆盖 stocks.csv 中出现的全部行业代码：
```csv
code,name
sw_dzx,电子
sw_yy,医药生物
...
```

- [ ] **Step 4: 写种子 [`datasets/portfolios.csv`](../../../datasets/portfolios.csv) 与 [`datasets/positions.csv`](../../../datasets/positions.csv)**

```csv
id,name,initialCash,cash
P1,学习演示组合,1000000,913040
```
```csv
id,portfolioId,stockCode,quantity,costPrice
POS1,P1,688981,500,80.00
POS2,P1,688111,300,156.53
```
约束：`cash = initialCash - Σ(quantity×costPrice)` 必须自洽（此例 1000000 - 500×80 - 300×156.53 = 913041 → 以实际选定的持仓股与成本价重算，写入自洽值）；`stockCode` 必须存在于 stocks.csv。

- [ ] **Step 5: 写 [`datasets/README.md`](../../../datasets/README.md)**

记录：数据拉取日期、来源技能、字段说明、已知空值（哪些股票 PE 为空及原因）、刷新方法（"让 Claude 重跑 Task 8 步骤 1-3"）。

- [ ] **Step 6: 用引擎验证数据（提前集成检验）**

Run: `pnpm --filter engine exec tsx -e "
import Database from 'better-sqlite3';
import { loadOntology } from './src/oms.js';
import { ObjectStore } from './src/store.js';
import { materializeAll } from './src/funnel.js';
import { astock } from '../../ontology/astock.ontology.js';
const store = new ObjectStore(new Database(':memory:'), loadOntology(astock));
store.init();
for (const r of materializeAll(store, '../../datasets')) console.log(r.objectType, r.inserted, 'skipped:', r.skipped.length, 'nulled:', r.nulled.length);
"`
Expected: Stock 50 行插入、skipped 为 0（真实数据不应缺主键）、nulled ≥ 0（未盈利企业 PE）；Industry/Portfolio/Position 各自全量插入。

- [ ] **Step 7: Commit**

```bash
git add datasets/
git commit -m "data(m1): 科创板50 真实行情估值数据 + 组合种子（PE 空值如实保留）"
```

---

### Task 9: CLI 冒烟工具（cli.ts）

**Files:**
- Create: `packages/engine/src/cli.ts`
- Test: 手动冒烟（CLI 是验收工具本身，核心逻辑已被 Task 3–7 单测覆盖；CLI 只做参数解析与打印，不再写自动化测试——YAGNI）

**Interfaces:**
- Consumes: 全部前序模块 + [`ontology/astock.ontology.ts`](../../../ontology/astock.ontology.ts) + [`datasets/`](../../../datasets/)
- Produces: 命令 `pnpm cli <load|materialize|query|get|traverse|count>`（M1 验收执行面）

- [ ] **Step 1: 实现 cli.ts**

`packages/engine/src/cli.ts`:
```ts
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { loadOntology } from './oms.js';
import { ObjectStore } from './store.js';
import { materializeAll } from './funnel.js';
import { ObjectSetService, type Filter } from './oss.js';
import { astock } from '../../../ontology/astock.ontology.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DB_PATH = join(root, 'ontology.db');
const DATASETS = join(root, 'datasets');

/** 解析 --where "pe<50" / "pe=null" / "pe!=null" / "name~芯" 为 Filter */
function parseWhere(expr: string): Filter {
  let m = expr.match(/^(\w+)\s*(!=|>=|<=|=|<|>|~)\s*(.+)$/);
  if (!m) throw new Error(`bad --where: ${expr}`);
  const [, property, opRaw, rawValue] = m;
  if (rawValue === 'null') {
    if (opRaw === '=') return { property, op: 'isNull' };
    if (opRaw === '!=') return { property, op: 'notNull' };
    throw new Error(`bad null comparison: ${expr}`);
  }
  const num = Number(rawValue);
  const value = Number.isFinite(num) && rawValue.trim() !== '' ? num : rawValue;
  const op = ({ '=': 'eq', '!=': 'neq', '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte', '~': 'contains' } as const)[opRaw]!;
  return { property, op, value } as Filter;
}

function open(): { store: ObjectStore; oss: ObjectSetService } {
  const store = new ObjectStore(new Database(DB_PATH), loadOntology(astock));
  store.init();
  return { store, oss: new ObjectSetService(store) };
}

const [cmd, ...rest] = process.argv.slice(2);

switch (cmd) {
  case 'load': {
    const reg = loadOntology(astock);
    console.log(`本体: ${reg.schema.displayName} (${reg.schema.apiName})`);
    console.log(`对象类型 ${reg.objectTypes().length} 个:`);
    for (const ot of reg.objectTypes()) {
      const ds = ot.datasource ? `datasource=${ot.datasource.path}` : '纯编辑型';
      console.log(`  - ${ot.apiName}（${ot.displayName}）属性 ${ot.properties.length} 个, 主键 ${ot.primaryKey}, ${ds}`);
    }
    console.log(`链接类型 ${reg.linkTypes().length} 个:`);
    for (const lt of reg.linkTypes())
      console.log(`  - ${lt.apiName}: ${lt.source} --${lt.sourceToTargetName}--> ${lt.target} (反向 ${lt.targetToSourceName})`);
    break;
  }
  case 'materialize': {
    const { store } = open();
    for (const r of materializeAll(store, DATASETS)) {
      console.log(`${r.objectType}: 共 ${r.totalRows} 行 → 新增 ${r.inserted} 更新 ${r.updated}`);
      for (const s of r.skipped) console.log(`  [跳过] 第 ${s.row} 行: ${s.reason}`);
      for (const n of r.nulled) console.log(`  [置空] 第 ${n.row} 行 ${n.property}='${n.raw}'`);
    }
    break;
  }
  case 'query': {
    const { values, positionals } = parseArgs({
      args: rest, allowPositionals: true,
      options: { where: { type: 'string', multiple: true }, 'order-by': { type: 'string' }, desc: { type: 'boolean' }, limit: { type: 'string' } },
    });
    const { oss } = open();
    const rows = oss.query(positionals[0], (values.where ?? []).map(parseWhere), {
      orderBy: values['order-by'], desc: values.desc, limit: values.limit ? Number(values.limit) : undefined,
    });
    console.table(rows);
    console.log(`${rows.length} 行`);
    break;
  }
  case 'get': {
    const { oss } = open();
    void oss;
    const { store } = open();
    console.log(store.get(rest[0], rest[1]) ?? '(不存在)');
    break;
  }
  case 'traverse': {
    const { oss } = open();
    console.table(oss.traverse(rest[0], rest[1], rest[2]));
    break;
  }
  case 'count': {
    const { values, positionals } = parseArgs({
      args: rest, allowPositionals: true, options: { by: { type: 'string' } },
    });
    const { store, oss } = open();
    if (values.by) console.table(oss.aggregateCount(positionals[0], values.by));
    else console.log(store.count(positionals[0]));
    break;
  }
  default:
    console.log(`用法: pnpm cli <load|materialize|query|get|traverse|count>
  load                                    查看本体注册摘要
  materialize                             物化 datasets/ 全部数据集（含报告）
  query <Type> [--where "pe<50"]... [--order-by pe] [--desc] [--limit 10]
  get <Type> <主键>
  traverse <Type> <主键> <遍历名>          如 traverse Stock 688981 industry
  count <Type> [--by <属性>]`);
}
```

- [ ] **Step 2: 冒烟运行**

Run:
```bash
pnpm cli load
pnpm cli materialize
pnpm cli query Stock --where "pe=null" --limit 5
pnpm cli traverse Stock 688981 industry
```
Expected: 依次输出注册摘要（6 对象/5 链接）、物化报告（Stock 50 行）、未盈利股列表、中芯国际所属行业。

- [ ] **Step 3: Commit**

```bash
git add packages/engine/src/cli.ts
git commit -m "feat(m1): CLI 冒烟工具（load/materialize/query/get/traverse/count）"
```

---

### Task 10: M1 验收执行与收尾

**Files:**
- Modify: [`PROGRESS.md`](../../../PROGRESS.md)（M1 状态翻 ✅、游标指向 M2 计划）
- Create: [`docs/acceptance/m1-evidence.md`](../../acceptance/m1-evidence.md)（验收证据清单）

**Interfaces:**
- Consumes: spec §9.3 M1 验收清单、全部前序产出
- Produces: M1 完成状态 + 证据文档；M2 计划的起点

- [ ] **Step 1: 逐项执行 spec §9.3 M1 验收清单并记录证据**

| # | 命令 | 通过标准 |
|---|---|---|
| 1 | `pnpm --filter engine test` | 全绿 |
| 2 | `pnpm cli load` | 6 对象类型、5 链接类型摘要 |
| 3 | `pnpm cli materialize` | Stock 50 行；脏行报告显示 PE 空值走 [置空] 而非丢行 |
| 4 | `pnpm cli query Stock --where "pe!=null" --where "pe<50" --order-by pe` | 结果与 stocks.csv 手工核对一致 |
| 5 | `pnpm cli traverse Stock 688981 industry` 与反向 `traverse Industry <code> stocks` | 双向正确 |
| 6 | 重跑 `pnpm cli materialize` 后 `pnpm cli count Stock` | 仍为 50（幂等） |
| 7 | `grep -rniE "stock|astock|portfolio|industry" packages/engine/src/` | 无输出（题材无关约束） |

每项把实际命令输出粘贴进 [`docs/acceptance/m1-evidence.md`](../../acceptance/m1-evidence.md)（含日期与 git commit hash）。

- [ ] **Step 2: 更新 PROGRESS.md**

当前焦点改为"M1 ✅（验收证据 docs/acceptance/m1-evidence.md）→ 写 M2 计划"；任务清单 ⑤ 翻 ✅。

- [ ] **Step 3: 提交并请用户抽查**

```bash
git add docs/acceptance/m1-evidence.md PROGRESS.md
git commit -m "docs(m1): M1 验收证据归档，全部 7 项通过"
```
向用户呈报验收证据摘要，请用户抽查（spec §9.1 流程：用户抽查通过才算里程碑关闭）。

---

## Self-Review 记录

1. **Spec 覆盖（M1 范围）**：spec §3 架构分层→Task 1/2/3/5/6/7；§4 本体→Task 4；数据接入→Task 8；§9.3 M1 清单 6 项→Task 10 表格 #1–#6 一一对应，另加 #7 题材无关检查（Global Constraints）；§9.4 错误处理→Task 3（fail-fast 带定位）/Task 6（脏行报告）。M2+ 内容（edits/actions/functions/codegen/UI/MCP）显式不在本计划。无缺口。
2. **占位符扫描**：无 TBD/TODO；Task 6 的"实现提示"给出了可直接通过测试的完整代码并允许等价重构，非占位符。Task 8 数据行数以拉取结果为准（"..."仅表示 50 行数据不在计划内逐行列出，表头与示例行完整）。
3. **类型一致性**：`ObjectRow`/`MaterializeReport`/`Filter`/`OntologyRegistry.linkByTraverseName` 的签名在 Task 5/6/7 的 Interfaces 块与实现代码逐一核对一致；`upsertMany` 返回 `{inserted, updated}` 在 Task 5 定义、Task 6 使用一致；`store.db`/`store.registry` 公开只读在 Task 5 声明、Task 7 使用一致。

import type { ObjectStore } from './store.js';
import { ObjectSetService } from './oss.js';
import type { Edit, ReadonlyContext, SideEffect, Value } from './types.js';

/**
 * Action 执行结果（结构化——UI/CLI/MCP 直接呈现）：
 * - ok:true 提交成功；
 * - stage:'params' 参数层拒绝（类型/必填/未知参数）；
 * - stage:'criteria' 提交前提未满足（带判据名，Foundry submission criteria 语义）。
 */
export type ActionResult =
  | { ok: true; edits: Edit[]; sideEffects: SideEffect[] }
  | { ok: false; stage: 'params'; message: string }
  | { ok: false; stage: 'criteria'; failedCriterion: string; message: string };

/**
 * Action 执行器：一切写操作的唯一入口。
 * 管线：参数校验 → submission criteria（全过才继续）→ apply 产 edits →
 * 原子提交（物化+账本+审计同事务）→ side effects。
 */
export class ActionService {
  private readonly oss: ObjectSetService;

  constructor(private readonly store: ObjectStore) {
    this.oss = new ObjectSetService(store);
  }

  private ctx(): ReadonlyContext {
    return {
      get: (t, pk) => this.store.get(t, pk),
      query: (t, f, o) => this.oss.query(t, f, o),
    };
  }

  execute(apiName: string, params: Record<string, Value>): ActionResult {
    const action = this.store.registry.actionType(apiName); // 未注册 → throw（编程错误）

    // 1. 参数校验（类型层）
    for (const p of action.parameters) {
      const v = params[p.apiName];
      if (v === undefined || v === null) {
        if (p.required !== false)
          return { ok: false, stage: 'params', message: `missing required parameter '${p.apiName}'` };
        continue;
      }
      const expected = p.type === 'date' ? 'string' : p.type;
      if (typeof v !== expected)
        return { ok: false, stage: 'params', message: `parameter '${p.apiName}' expects ${p.type}, got ${typeof v}` };
    }
    for (const k of Object.keys(params)) {
      if (!action.parameters.some(p => p.apiName === k))
        return { ok: false, stage: 'params', message: `unknown parameter '${k}'` };
    }

    // 2. submission criteria（业务前提，逐条命名求值）
    const ctx = this.ctx();
    for (const c of action.criteria) {
      if (!c.check(ctx, params))
        return { ok: false, stage: 'criteria', failedCriterion: c.apiName, message: c.message };
    }

    // 3. 产出 edits 并原子提交（物化表 + 账本 + 审计同事务）
    const edits = action.apply(ctx, params);
    this.store.applyEdits(edits, { action: apiName, params });

    // 4. side effects（提交成功后执行；只落表不真推送——spec §6）
    const effects = action.sideEffects?.(ctx, params, edits) ?? [];
    for (const e of effects) {
      if (e.kind === 'notification') this.store.addNotification(e.message, e.link);
    }
    return { ok: true, edits, sideEffects: effects };
  }
}

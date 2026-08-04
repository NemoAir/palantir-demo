import type { ObjectStore } from './store.js';
import { ObjectSetService } from './oss.js';
import type { ReadonlyContext, Value } from './types.js';

/**
 * Function 运行时：本体原生只读逻辑的托管与执行。
 * 算与做分离（决策四要素的 Logic vs Action）：Function 只读，写入必须经 Action。
 */
export class FunctionService {
  private readonly oss: ObjectSetService;

  constructor(private readonly store: ObjectStore) {
    this.oss = new ObjectSetService(store);
  }

  call(apiName: string, params: Record<string, Value>): unknown {
    const fn = this.store.registry.functionDef(apiName); // 未注册 → throw
    const ctx: ReadonlyContext = {
      get: (t, pk) => this.store.get(t, pk),
      query: (t, f, o) => this.oss.query(t, f, o),
    };
    return fn.logic(ctx, params);
  }
}

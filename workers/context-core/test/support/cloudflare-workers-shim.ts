// ZX5 Lane E E1 — vitest shim for `cloudflare:workers` virtual module.
// 与 workers/agent-core/test/support/cloudflare-workers-shim.ts 完全一致;
// 复制是 deliberate(每 worker 自带 shim 避免跨 worker test 依赖)。
export class WorkerEntrypoint<Env> {
  protected readonly env: Env;

  constructor(ctxOrEnv?: unknown, maybeEnv?: Env) {
    this.env = (maybeEnv ?? ctxOrEnv ?? {}) as Env;
  }
}

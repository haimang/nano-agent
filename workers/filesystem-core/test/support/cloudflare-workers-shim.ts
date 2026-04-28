// ZX5 Lane E E2 — vitest shim for `cloudflare:workers` virtual module.
// 与 E1 context-core / agent-core 的 shim 完全一致。
export class WorkerEntrypoint<Env> {
  protected readonly env: Env;

  constructor(ctxOrEnv?: unknown, maybeEnv?: Env) {
    this.env = (maybeEnv ?? ctxOrEnv ?? {}) as Env;
  }
}

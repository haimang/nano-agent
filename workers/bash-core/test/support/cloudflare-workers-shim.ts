export class WorkerEntrypoint<Env> {
  protected readonly env: Env;

  constructor(ctxOrEnv?: unknown, maybeEnv?: Env) {
    this.env = (maybeEnv ?? ctxOrEnv ?? {}) as Env;
  }
}

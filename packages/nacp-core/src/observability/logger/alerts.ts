import type { Logger } from "./types.js";
import { tryEmitSystemError } from "./system-error.js";

export interface EmitObservabilityAlertInput {
  readonly logger: Logger;
  readonly source_worker: string;
  readonly alert_kind: "d1-write-failed" | "rpc-parity-failed" | "r2-write-failed" | "audit-persist-failed";
  readonly message: string;
  readonly detail?: Record<string, unknown>;
  readonly emitSystemError?: Parameters<typeof tryEmitSystemError>[0]["emit"];
}

export async function emitObservabilityAlert(input: EmitObservabilityAlertInput): Promise<void> {
  const ctx = {
    alert_kind: input.alert_kind,
    ...(input.detail ?? {}),
  };
  input.logger.critical(input.message, {
    code: input.alert_kind === "rpc-parity-failed" ? "rpc-parity-failed" : "internal-error",
    ctx,
  });
  if (!input.emitSystemError) return;
  await tryEmitSystemError({
    code: input.alert_kind === "rpc-parity-failed" ? "rpc-parity-failed" : "internal-error",
    source_worker: input.source_worker,
    message: input.message,
    detail: ctx,
    critical: true,
    emit: input.emitSystemError,
  });
}

import type { ExecutionRequest } from "../../request-builder.js";

export interface DeepSeekAdapterSkeleton {
  execute(exec: ExecutionRequest): Promise<never>;
}

export async function executeDeepSeekSkeleton(_exec: ExecutionRequest): Promise<never> {
  throw new Error(
    "DeepSeek adapter not implemented in zero-to-real first wave; Workers AI remains the only default runtime path.",
  );
}

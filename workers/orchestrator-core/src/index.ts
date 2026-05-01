import { attachServerTimings, buildFacadeServerTimings } from "@haimang/nacp-core/logger";
import { dispatchFacadeRoute } from "./facade/route-registry.js";
import { NanoOrchestratorUserDO } from "./user-do.js";
import type { OrchestratorCoreEnv } from "./facade/env.js";

const worker = {
  async fetch(request: Request, env: OrchestratorCoreEnv): Promise<Response> {
    const startedAt = Date.now();
    const response = await dispatchFacadeRoute(request, env);
    const totalMs = Date.now() - startedAt;
    return attachServerTimings(response, buildFacadeServerTimings({ totalMs }));
  },
};

export type { OrchestratorCoreEnv } from "./facade/env.js";
export { NanoOrchestratorUserDO };
export { worker };
export default worker;

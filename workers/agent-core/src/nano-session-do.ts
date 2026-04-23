import type { AgentCoreDoResponse, AgentCoreEnv } from "./types.js";

function createDoResponse(): AgentCoreDoResponse {
  return {
    worker: "agent-core",
    role: "session-do-stub",
    status: "shell",
  };
}

export class NanoSessionDO {
  constructor(_state: DurableObjectState, _env: AgentCoreEnv) {}

  async fetch(_request: Request): Promise<Response> {
    return Response.json(createDoResponse());
  }
}

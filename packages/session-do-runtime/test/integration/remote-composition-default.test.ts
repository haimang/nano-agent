/**
 * Integration test: `NanoSessionDO` default path picks the right
 * composition factory based on env bindings, and the remote `hooks`
 * handle is actually consumed when `emitHook` fires.
 *
 * A4-A5 review R3 / Kimi R5 follow-up:
 *   - Without v1 bindings → `SubsystemHandles.profile` is all-local.
 *   - With `HOOK_WORKER` → profile.hooks=remote, `handles.hooks.emit`
 *     exists, and calling it reaches the fake binding's `fetch`.
 */

import { describe, it, expect } from "vitest";
import { NanoSessionDO } from "../../src/do/nano-session-do.js";
import type { ServiceBindingLike } from "../../src/env.js";

describe("NanoSessionDO default composition selection (A4-A5 review R3)", () => {
  it("picks the local factory when no v1 bindings are present", () => {
    const doInstance = new NanoSessionDO({}, { TEAM_UUID: "team-local" });
    const s = doInstance.getSubsystems();
    expect(s.profile).toEqual({
      capability: "local",
      hooks: "local",
      provider: "local",
    });
    expect(s.hooks).toBeUndefined();
  });

  it("picks the remote factory when HOOK_WORKER is bound, and emitHook goes through the fake binding", async () => {
    const seen: Request[] = [];
    const hookBinding: ServiceBindingLike = {
      async fetch(input: RequestInfo | URL, init?: RequestInit) {
        const req = input instanceof Request ? input : new Request(input as string, init);
        seen.push(req);
        return new Response(
          JSON.stringify({ kind: "continue", reason: "ok" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    };

    const doInstance = new NanoSessionDO(
      {},
      {
        TEAM_UUID: "team-remote",
        HOOK_WORKER: hookBinding,
      },
    );

    const s = doInstance.getSubsystems();
    expect(s.profile.hooks).toBe("remote");
    const hooks = s.hooks as
      | { emit?: (e: string, p: unknown, c?: unknown) => Promise<unknown> }
      | undefined;
    expect(hooks?.emit).toBeDefined();
    await hooks!.emit!("UserPromptSubmit", { text: "hi" }, {});
    expect(seen).toHaveLength(1);
    const body = (await seen[0]!.json()) as {
      event?: string;
      emitBody?: { text?: string };
    };
    expect(body.event).toBe("UserPromptSubmit");
    expect(body.emitBody?.text).toBe("hi");
  });

  it("picks the remote factory when only CAPABILITY_WORKER is bound", () => {
    const capBinding: ServiceBindingLike = {
      async fetch() {
        return new Response("{}", { status: 200 });
      },
    };
    const doInstance = new NanoSessionDO(
      {},
      {
        TEAM_UUID: "team-cap",
        CAPABILITY_WORKER: capBinding,
      },
    );
    const s = doInstance.getSubsystems();
    expect(s.profile.capability).toBe("remote");
    const cap = s.capability as
      | { serviceBindingTransport?: unknown }
      | undefined;
    expect(cap?.serviceBindingTransport).toBeDefined();
  });
});

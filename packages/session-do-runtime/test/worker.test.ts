/**
 * Tests for the Worker fetch entry.
 *
 * Verifies that:
 *   - Non-matching URL shapes short-circuit to 404 without touching the
 *     DO namespace.
 *   - Matching shapes forward to the DO stub selected by sessionId.
 */

import { describe, it, expect, vi } from "vitest";
import workerEntry from "../src/worker.js";
import type { WorkerEnv } from "../src/worker.js";

function makeEnv() {
  const fetch = vi.fn(async (req: Request) =>
    new Response(JSON.stringify({ ok: true, sessionPath: new URL(req.url).pathname }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  const idFromName = vi.fn((name: string) => ({ __id: name }));
  const get = vi.fn((id: unknown) => ({ fetch, __id: (id as { __id: string }).__id }));

  const env: WorkerEnv = {
    SESSION_DO: { idFromName, get },
  };
  return { env, idFromName, get, fetch };
}

describe("worker fetch entry", () => {
  it("forwards /sessions/:id/:action requests to the DO stub", async () => {
    const { env, idFromName, get, fetch } = makeEnv();
    const req = new Request("https://example.com/sessions/abc-123/status");

    const res = await workerEntry.fetch(req, env);
    expect(res.status).toBe(200);

    expect(idFromName).toHaveBeenCalledWith("abc-123");
    expect(get).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for off-spec paths without touching the DO namespace", async () => {
    const { env, idFromName, get, fetch } = makeEnv();
    const req = new Request("https://example.com/totally/unknown/path");

    const res = await workerEntry.fetch(req, env);
    expect(res.status).toBe(404);

    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("derives the session id from the `/sessions/:id/...` pattern for WebSocket upgrades too", async () => {
    const { env, idFromName } = makeEnv();
    const req = new Request("https://example.com/sessions/ws-session/ws", {
      headers: { upgrade: "websocket" },
    });

    const res = await workerEntry.fetch(req, env);
    expect(res.status).toBe(200);
    expect(idFromName).toHaveBeenCalledWith("ws-session");
  });
});

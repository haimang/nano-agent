/**
 * ProbeDO — Durable Object class for spike-do-storage.
 *
 * P1-03 skeleton: minimal class definition so wrangler can validate the
 * `durable_objects.bindings` declaration in wrangler.jsonc. Real
 * transactional probe handlers (V1-storage-DO-transactional, etc.) are
 * implemented in Phase 2.
 *
 * NOTE: This class uses SQLite-backed storage (declared as
 * `new_sqlite_classes` in the migration v1). This is required for D1-style
 * transactional get/put behavior on Workers Durable Objects.
 */
export class ProbeDO {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_state: DurableObjectState, _env: unknown) {
    // Phase 2 will wire real probe handlers here.
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      return Response.json({
        ok: true,
        do: "ProbeDO",
        version: "0.0.0-spike-p1-03",
      });
    }
    return new Response(
      "ProbeDO skeleton (P1-03). Phase 2 will add transactional probes.",
      { status: 404 },
    );
  }
}

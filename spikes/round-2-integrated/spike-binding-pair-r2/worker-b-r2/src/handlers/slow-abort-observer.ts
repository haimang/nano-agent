/**
 * /slow — callee-side observation of caller-initiated abort (binding-F01
 * follow-up). The handler sleeps up to N ms and emits a structured log
 * line on abort so `wrangler tail` captures `[slow] abort observed`.
 *
 * This is the core B7 binding-F01 proof: worker-a aborts, worker-b MUST
 * observe it via the request's `signal`. Round 1 stopped at "abort
 * from caller works"; B7 closes the loop by confirming the callee sees
 * the signal too, which is the contract needed for real cross-worker
 * cancellation propagation in B8 worker-matrix.
 */

interface SlowParams {
  readonly sleepMs?: number;
  readonly tag?: string;
}

export async function handleSlow(request: Request): Promise<Response> {
  const body: SlowParams = (await request.json().catch(() => ({}))) as SlowParams;
  const sleepMs = typeof body.sleepMs === "number" ? body.sleepMs : 2000;
  const tag = body.tag ?? "slow-default";

  const startedAt = new Date().toISOString();

  try {
    await new Promise<void>((resolve, reject) => {
      const signal = request.signal;
      const timer = setTimeout(() => resolve(), sleepMs);
      if (signal.aborted) {
        clearTimeout(timer);
        reject(new DOMException("aborted before start", "AbortError"));
        return;
      }
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("aborted mid-request", "AbortError"));
      });
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      const log = {
        level: "info",
        emitter: "slow-abort-observer",
        message: "[slow] abort observed",
        tag,
        startedAt,
        abortedAt: new Date().toISOString(),
      };
      console.log(JSON.stringify(log));
      return Response.json(
        {
          ok: false,
          aborted: true,
          tag,
          startedAt,
          abortedAt: log.abortedAt,
        },
        { status: 499 }, // Nginx's "Client Closed Request"; carries same intent
      );
    }
    throw err;
  }

  return Response.json({
    ok: true,
    aborted: false,
    tag,
    startedAt,
    completedAt: new Date().toISOString(),
  });
}

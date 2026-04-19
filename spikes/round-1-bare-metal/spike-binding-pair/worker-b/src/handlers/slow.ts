/**
 * worker-b /handle/slow — controllable-latency target for cancellation
 * probing.
 *
 * Used by V3-binding-latency-cancellation to test whether worker-a's
 * abort signal propagates and cuts the callee mid-response.
 *
 * The handler logs (to console) progress checkpoints so wrangler tail
 * can confirm whether the long sleep was actually interrupted.
 */

export async function handleSlow(
  request: Request,
  delayMs: number,
): Promise<Response> {
  const t0 = Date.now();
  console.log(`[slow] start delayMs=${delayMs} t0=${t0}`);

  // Use AbortSignal-aware sleep so cancellation can land.
  const signal = (request as Request & { signal?: AbortSignal }).signal;
  let aborted = false;

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      console.log(`[slow] timer fired t=${Date.now() - t0}ms`);
      resolve();
    }, delayMs);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          console.log(`[slow] abort observed t=${Date.now() - t0}ms`);
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    }
  });

  return Response.json(
    {
      ok: true,
      handler: "slow",
      requestedDelayMs: delayMs,
      actualDurationMs: Date.now() - t0,
      aborted,
    },
    { headers: { "x-spike-handler": "slow" } },
  );
}

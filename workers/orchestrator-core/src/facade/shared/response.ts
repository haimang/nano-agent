import type { FacadeErrorCode } from "@haimang/orchestrator-auth-contract";

export async function wrapSessionResponse(
  response: Response,
  traceUuid: string,
): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return response;
  }
  let body: unknown = null;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  const obj =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  const looksFacadeSuccess = obj?.ok === true && "data" in obj;
  const looksFacadeError = obj?.ok === false && obj.error !== undefined && typeof obj.error === "object";
  const looksLegacyDoAck = obj?.ok === true && typeof obj.action === "string";
  if (obj && (looksFacadeSuccess || looksFacadeError || looksLegacyDoAck)) {
    if (typeof obj.trace_uuid !== "string" || obj.trace_uuid.length === 0) {
      obj.trace_uuid = traceUuid;
    }
    return Response.json(obj, {
      status: response.status,
      headers: { "x-trace-uuid": traceUuid },
    });
  }
  if (response.ok) {
    return Response.json(
      { ok: true, data: body, trace_uuid: traceUuid },
      { status: response.status, headers: { "x-trace-uuid": traceUuid } },
    );
  }
  const errObj = (body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {}) as { error?: string; message?: string; code?: string };
  const code = (errObj.code ?? errObj.error ?? "internal-error") as FacadeErrorCode;
  const message = errObj.message ?? errObj.error ?? "session route returned an error";
  return Response.json(
    {
      ok: false,
      error: {
        code,
        status: response.status,
        message,
      },
      trace_uuid: traceUuid,
    },
    { status: response.status, headers: { "x-trace-uuid": traceUuid } },
  );
}

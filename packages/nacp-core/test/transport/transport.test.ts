import { describe, it, expect, vi } from "vitest";
import { ServiceBindingTransport, type ServiceBindingTarget } from "../../src/transport/service-binding.js";
import { DoRpcTransport, buildDoIdName, type DoNamespaceLike } from "../../src/transport/do-rpc.js";
import { QueueProducer, handleQueueMessage, type QueueLike, type QueueMessageLike, type QueueConsumerOptions } from "../../src/transport/queue.js";
import { encodeEnvelope, type NacpEnvelope } from "../../src/envelope.js";
import { NacpValidationError } from "../../src/errors.js";
import { NACP_VERSION } from "../../src/version.js";
import type { TenantBoundaryContext } from "../../src/tenancy/boundary.js";
import "../../src/messages/index.js";

const UUID = "11111111-1111-1111-1111-111111111111";
const TEAM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SENT = "2026-04-16T00:00:00.000+00:00";
const BOUNDARY: TenantBoundaryContext = { serving_team_uuid: TEAM, accept_delegation: false };

function makeToolRequest(): NacpEnvelope {
  return { header: { schema_version: NACP_VERSION, message_uuid: UUID, message_type: "tool.call.request", delivery_kind: "command", sent_at: SENT, producer_role: "session", producer_key: "nano-agent.session.do@v1", priority: "normal" }, authority: { team_uuid: TEAM, plan_level: "pro", stamped_by_key: "nano-agent.platform.ingress@v1", stamped_at: SENT }, trace: { trace_uuid: UUID, session_uuid: UUID }, body: { tool_name: "bash", tool_input: { command: "ls" } } } as NacpEnvelope;
}
function makeToolResponse(): NacpEnvelope {
  return { header: { schema_version: NACP_VERSION, message_uuid: "22222222-2222-2222-2222-222222222222", message_type: "tool.call.response", delivery_kind: "response", sent_at: SENT, producer_role: "capability", producer_key: "nano-agent.capability.bash@v1", priority: "normal" }, authority: { team_uuid: TEAM, plan_level: "pro", stamped_by_key: "nano-agent.platform.ingress@v1", stamped_at: SENT }, trace: { trace_uuid: UUID, session_uuid: UUID }, control: { reply_to_message_uuid: UUID }, body: { status: "ok", output: "file.txt\n" } } as NacpEnvelope;
}

describe("ServiceBindingTransport", () => {
  it("sends with pipeline and receives response", async () => {
    const resp = makeToolResponse();
    const target: ServiceBindingTarget = { handleNacp: vi.fn().mockResolvedValue(resp) };
    const transport = new ServiceBindingTransport({ target, boundary: BOUNDARY });
    const result = await transport.send(makeToolRequest());
    expect(target.handleNacp).toHaveBeenCalledOnce();
    expect((result as NacpEnvelope).header.message_type).toBe("tool.call.response");
  });

  it("rejects wrong producer role before reaching target", async () => {
    const target: ServiceBindingTarget = { handleNacp: vi.fn() };
    const transport = new ServiceBindingTransport({ target, boundary: BOUNDARY });
    const badEnv = makeToolRequest();
    badEnv.header.producer_role = "skill";
    try { await transport.send(badEnv); expect.fail("should throw"); }
    catch (e: unknown) { expect((e as NacpValidationError).code).toBe("NACP_PRODUCER_ROLE_MISMATCH"); }
    expect(target.handleNacp).not.toHaveBeenCalled();
  });

  it("rejects tenant mismatch before reaching target", async () => {
    const target: ServiceBindingTarget = { handleNacp: vi.fn() };
    const transport = new ServiceBindingTransport({ target, boundary: { serving_team_uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", accept_delegation: false } });
    try { await transport.send(makeToolRequest()); expect.fail("should throw"); }
    catch (e: unknown) { expect((e as NacpValidationError).code).toBe("NACP_TENANT_MISMATCH"); }
    expect(target.handleNacp).not.toHaveBeenCalled();
  });

  it("sendWithProgress returns response + progress stream", async () => {
    const stream = new ReadableStream<NacpEnvelope>({ start(c) { c.close(); } });
    const target: ServiceBindingTarget = { handleNacp: vi.fn().mockResolvedValue({ response: makeToolResponse(), progress: stream }) };
    const transport = new ServiceBindingTransport({ target, boundary: BOUNDARY });
    const result = await transport.sendWithProgress(makeToolRequest());
    expect(result.response.header.message_type).toBe("tool.call.response");
    expect(result.progress).toBeDefined();
  });

  it("returns void when target returns nothing", async () => {
    const target: ServiceBindingTarget = { handleNacp: vi.fn().mockResolvedValue(undefined) };
    const transport = new ServiceBindingTransport({ target, boundary: BOUNDARY });
    const result = await transport.send(makeToolRequest());
    expect(result).toBeUndefined();
  });
});

describe("DoRpcTransport", () => {
  it("builds correct DO id name", () => {
    expect(buildDoIdName("team-abc", "session-xyz")).toBe("team:team-abc:session-xyz");
  });

  it("sends with pipeline to the correct DO stub", async () => {
    const resp = makeToolResponse();
    const stubHandleNacp = vi.fn().mockResolvedValue(resp);
    const namespace: DoNamespaceLike = { idFromName: vi.fn().mockReturnValue({ toString: () => "id-1" }), get: vi.fn().mockReturnValue({ handleNacp: stubHandleNacp }) };
    const transport = new DoRpcTransport({ namespace, teamUuid: TEAM, suffix: "session-xyz", boundary: BOUNDARY });
    const result = await transport.send(makeToolRequest());
    expect(namespace.idFromName).toHaveBeenCalledWith(`team:${TEAM}:session-xyz`);
    expect((result as NacpEnvelope).header.message_type).toBe("tool.call.response");
  });

  it("R2: rejects when route team differs from envelope authority team", async () => {
    const stubHandleNacp = vi.fn();
    const namespace: DoNamespaceLike = { idFromName: vi.fn(), get: vi.fn().mockReturnValue({ handleNacp: stubHandleNacp }) };
    // Transport constructed with TEAM_B but envelope carries TEAM_A
    const transport = new DoRpcTransport({ namespace, teamUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", suffix: "s", boundary: { serving_team_uuid: "any", accept_delegation: false } });
    try { await transport.send(makeToolRequest()); expect.fail("should throw"); }
    catch (e: unknown) { expect((e as NacpValidationError).code).toBe("NACP_TENANT_MISMATCH"); }
    expect(namespace.get).not.toHaveBeenCalled();
  });

  it("rejects on tenant mismatch before reaching DO", async () => {
    const namespace: DoNamespaceLike = { idFromName: vi.fn(), get: vi.fn() };
    const transport = new DoRpcTransport({ namespace, teamUuid: TEAM, suffix: "s", boundary: { serving_team_uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", accept_delegation: false } });
    try { await transport.send(makeToolRequest()); expect.fail("should throw"); }
    catch (e: unknown) { expect((e as NacpValidationError).code).toBe("NACP_TENANT_MISMATCH"); }
    expect(namespace.get).not.toHaveBeenCalled();
  });
});

describe("QueueProducer", () => {
  it("sends encoded envelope", async () => {
    const queue: QueueLike = { send: vi.fn().mockResolvedValue(undefined) };
    const producer = new QueueProducer(queue);
    await producer.send(makeToolRequest());
    expect(queue.send).toHaveBeenCalledOnce();
  });
});

describe("handleQueueMessage", () => {
  function mockMsg(env: NacpEnvelope): QueueMessageLike {
    return { body: encodeEnvelope(env), ack: vi.fn(), retry: vi.fn() };
  }
  const opts: QueueConsumerOptions = { boundary: BOUNDARY };

  it("happy path: validates, calls handler, acks", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const msg = mockMsg(makeToolRequest());
    await handleQueueMessage(msg, handler, opts);
    expect(handler).toHaveBeenCalledOnce();
    expect(msg.ack).toHaveBeenCalledOnce();
  });

  it("tenant mismatch: DLQ, no retry (security = non-retryable)", async () => {
    const dlq = { put: vi.fn().mockResolvedValue(undefined) };
    const msg = mockMsg(makeToolRequest());
    await handleQueueMessage(msg, vi.fn(), { boundary: { serving_team_uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", accept_delegation: false }, dlqBucket: dlq });
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
    expect(dlq.put).toHaveBeenCalledOnce();
  });

  it("unknown handler error: retries", async () => {
    const msg = mockMsg(makeToolRequest());
    await handleQueueMessage(msg, vi.fn().mockRejectedValue(new Error("boom")), opts);
    expect(msg.retry).toHaveBeenCalledOnce();
  });

  it("invalid JSON: ack + DLQ", async () => {
    const dlq = { put: vi.fn().mockResolvedValue(undefined) };
    const msg: QueueMessageLike = { body: "not-json", ack: vi.fn(), retry: vi.fn() };
    await handleQueueMessage(msg, vi.fn(), { boundary: BOUNDARY, dlqBucket: dlq });
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(dlq.put).toHaveBeenCalledOnce();
  });
});

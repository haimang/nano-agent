import { describe, expect, it, vi } from "vitest";
import ContextCoreEntrypoint from "../src/index.js";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const TRACE_UUID = "33333333-3333-4333-8333-333333333360";
const JOB_UUID = "55555555-5555-4555-8555-555555555555";

function makeState(totalTokens = 500) {
  return {
    snapshot: {
      conversation_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      session_uuid: SESSION_UUID,
      team_uuid: TEAM_UUID,
      actor_user_uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      trace_uuid: TRACE_UUID,
      session_status: "active",
      started_at: "2026-04-30T00:00:00.000Z",
      ended_at: null,
      last_phase: "attached",
      last_event_seq: 12,
      message_count: 8,
      activity_count: 3,
      latest_turn_uuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    },
    history: [
      {
        message_uuid: "m1",
        turn_uuid: "t1",
        trace_uuid: TRACE_UUID,
        role: "user" as const,
        kind: "user.input.text",
        body: { text: "hello" },
        created_at: "2026-04-30T00:00:01.000Z",
      },
      {
        message_uuid: "m2",
        turn_uuid: "t1",
        trace_uuid: TRACE_UUID,
        role: "assistant" as const,
        kind: "assistant.message",
        body: { text: "<model_switch>fallback</model_switch> response one" },
        created_at: "2026-04-30T00:00:02.000Z",
      },
      {
        message_uuid: "m3",
        turn_uuid: "t2",
        trace_uuid: TRACE_UUID,
        role: "user" as const,
        kind: "user.input.text",
        body: { text: "follow up" },
        created_at: "2026-04-30T00:00:03.000Z",
      },
      {
        message_uuid: "m4",
        turn_uuid: "t2",
        trace_uuid: TRACE_UUID,
        role: "assistant" as const,
        kind: "assistant.message",
        body: {
          text: "latest response",
          parts: [{ kind: "artifact_ref", artifact_uuid: "file-1", summary: "report.txt" }],
        },
        created_at: "2026-04-30T00:00:04.000Z",
      },
    ],
    usage: {
      llm_input_tokens: totalTokens,
      llm_output_tokens: 0,
      tool_calls: 0,
      subrequest_used: 0,
      subrequest_budget: null,
      estimated_cost_usd: null,
    },
    context_snapshots: [
      {
        snapshot_uuid: "snap-initial",
        turn_uuid: "t1",
        snapshot_kind: "initial-context",
        summary_ref: null,
        prompt_token_estimate: 40,
        payload: { project: "nano-agent", branch: "main" },
        created_at: "2026-04-30T00:00:00.000Z",
      },
    ],
    latest_compact_boundary: null,
    latest_compact_notify: null,
    model: {
      model_id: "@cf/ibm-granite/granite-4.0-h-micro",
      context_window: 1024,
      effective_context_pct: 0.5,
      auto_compact_token_limit: 200,
      base_instructions_suffix: "Keep answers concise.",
      max_output_tokens: 128,
    },
  };
}

function makeEntrypoint(totalTokens = 500) {
  const binding = {
    readContextDurableState: vi.fn().mockResolvedValue(makeState(totalTokens)),
    createContextSnapshot: vi.fn().mockResolvedValue({
      session_uuid: SESSION_UUID,
      team_uuid: TEAM_UUID,
      snapshot_id: "snap-created",
      created_at: "2026-04-30T00:10:00.000Z",
      snapshot_kind: "manual-snapshot",
    }),
    commitContextCompact: vi.fn().mockResolvedValue({
      session_uuid: SESSION_UUID,
      team_uuid: TEAM_UUID,
      job_id: JOB_UUID,
      checkpoint_uuid: JOB_UUID,
      context_snapshot_uuid: "snap-compact",
      status: "completed",
      tokens_before: 500,
      tokens_after: 120,
      created_at: "2026-04-30T00:11:00.000Z",
      message_high_watermark: "m2",
      latest_event_seq: 13,
      summary_text: "compact-boundary summary",
      protected_fragment_kinds: ["model_switch"],
      compacted_message_count: 2,
      kept_message_count: 2,
    }),
    readContextCompactJob: vi.fn().mockResolvedValue({
      session_uuid: SESSION_UUID,
      team_uuid: TEAM_UUID,
      job_id: JOB_UUID,
      status: "completed",
    }),
  };
  return {
    ep: new ContextCoreEntrypoint({
      ENVIRONMENT: "preview",
      ORCHESTRATOR_CORE: binding,
    } as never),
    binding,
  };
}

describe("context-core HP3 control-plane rpc", () => {
  it("returns a durable probe instead of the legacy stub shape", async () => {
    const { ep } = makeEntrypoint();
    const body = await ep.getContextSnapshot(SESSION_UUID, TEAM_UUID, {
      trace_uuid: TRACE_UUID,
      team_uuid: TEAM_UUID,
    });
    expect(body.phase).toBe("durable");
    expect(body.need_compact).toBe(true);
    expect(body.summary).toContain("context probe ready");
  });

  it("builds canonical layers from durable state", async () => {
    const { ep } = makeEntrypoint();
    const body = await ep.getContextLayers(SESSION_UUID, TEAM_UUID, {
      trace_uuid: TRACE_UUID,
      team_uuid: TEAM_UUID,
    });
    expect(Array.isArray(body.layers)).toBe(true);
    expect(body.layers[0]).toMatchObject({ kind: "system" });
    expect(body.layers.map((layer) => layer.kind)).toContain("recent_transcript");
  });

  it("provides a compact preview with a durable job template hint", async () => {
    const { ep } = makeEntrypoint();
    const body = await ep.previewCompact(SESSION_UUID, TEAM_UUID, {
      trace_uuid: TRACE_UUID,
      team_uuid: TEAM_UUID,
    });
    expect(body.need_compact).toBe(true);
    expect(body.summary_preview).toContain("compact-boundary summary");
    expect(body.would_create_job_template).toMatchObject({
      checkpoint_kind: "compact_boundary",
    });
  });

  it("writes a manual snapshot through orchestrator-core", async () => {
    const { ep, binding } = makeEntrypoint();
    const body = await ep.triggerContextSnapshot(SESSION_UUID, TEAM_UUID, {
      trace_uuid: TRACE_UUID,
      team_uuid: TEAM_UUID,
    });
    expect(body.snapshot_id).toBe("snap-created");
    expect(binding.createContextSnapshot).toHaveBeenCalled();
  });

  it("honest-degrades compact when the budget says no compaction is needed", async () => {
    const { ep, binding } = makeEntrypoint(50);
    const body = await ep.triggerCompact(SESSION_UUID, TEAM_UUID, {
      trace_uuid: TRACE_UUID,
      team_uuid: TEAM_UUID,
    });
    expect(body.compacted).toBe(false);
    expect(body.reason).toBe("compact-not-needed");
    expect(binding.commitContextCompact).not.toHaveBeenCalled();
  });

  it("reads a compact job through orchestrator-core", async () => {
    const { ep, binding } = makeEntrypoint();
    const body = await ep.getCompactJob(SESSION_UUID, TEAM_UUID, JOB_UUID, {
      trace_uuid: TRACE_UUID,
      team_uuid: TEAM_UUID,
    });
    expect(body.job_id).toBe(JOB_UUID);
    expect(binding.readContextCompactJob).toHaveBeenCalledWith(
      SESSION_UUID,
      TEAM_UUID,
      JOB_UUID,
      expect.objectContaining({ trace_uuid: TRACE_UUID }),
    );
  });
});

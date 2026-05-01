import { ContextAssembler } from "./context-assembler.js";
import type { ContextLayer } from "./context-layers.js";

const DEFAULT_CONTEXT_WINDOW = 131_072;
const DEFAULT_EFFECTIVE_CONTEXT_PCT = 0.75;
const DEFAULT_MAX_OUTPUT_TOKENS = 1_024;
const DEFAULT_RECENT_MESSAGE_COUNT = 6;
const PROTECTED_FRAGMENT_TAGS = ["model_switch", "state_snapshot"] as const;

export interface ContextHistoryMessage {
  readonly message_uuid: string;
  readonly turn_uuid: string | null;
  readonly trace_uuid: string;
  readonly role: "user" | "assistant" | "system";
  readonly kind: string;
  readonly body: Record<string, unknown>;
  readonly created_at: string;
}

export interface ContextDurableSnapshot {
  readonly conversation_uuid: string;
  readonly session_uuid: string;
  readonly team_uuid: string;
  readonly actor_user_uuid: string;
  readonly trace_uuid: string;
  readonly session_status: string;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly last_phase: string | null;
  readonly last_event_seq: number;
  readonly message_count: number;
  readonly activity_count: number;
  readonly latest_turn_uuid: string | null;
}

export interface ContextUsageSnapshot {
  readonly llm_input_tokens: number;
  readonly llm_output_tokens: number;
  readonly tool_calls: number;
  readonly subrequest_used: number;
  readonly subrequest_budget: number | null;
  readonly estimated_cost_usd: number | null;
}

export interface ContextSnapshotRecord {
  readonly snapshot_uuid: string;
  readonly turn_uuid: string | null;
  readonly snapshot_kind: string;
  readonly summary_ref: string | null;
  readonly prompt_token_estimate: number | null;
  readonly payload: Record<string, unknown>;
  readonly created_at: string;
}

export interface ContextCompactBoundaryRecord {
  readonly checkpoint_uuid: string;
  readonly turn_uuid: string | null;
  readonly checkpoint_kind: string;
  readonly label: string | null;
  readonly message_high_watermark: string | null;
  readonly latest_event_seq: number | null;
  readonly context_snapshot_uuid: string | null;
  readonly file_snapshot_status: string;
  readonly created_by: string;
  readonly created_at: string;
  readonly expires_at: string | null;
}

export interface ContextCompactNotifyProjection {
  readonly status: "started" | "completed" | "failed";
  readonly tokens_before: number | null;
  readonly tokens_after: number | null;
}

export interface ContextModelProfile {
  readonly model_id: string;
  readonly context_window: number;
  readonly effective_context_pct: number;
  readonly auto_compact_token_limit: number | null;
  readonly base_instructions_suffix: string | null;
  readonly max_output_tokens: number;
}

export interface ContextDurableState {
  readonly snapshot: ContextDurableSnapshot;
  readonly history: ReadonlyArray<ContextHistoryMessage>;
  readonly usage: ContextUsageSnapshot | null;
  readonly context_snapshots: ReadonlyArray<ContextSnapshotRecord>;
  readonly latest_compact_boundary: ContextCompactBoundaryRecord | null;
  readonly latest_compact_notify: ContextCompactNotifyProjection | null;
  readonly model: ContextModelProfile | null;
}

export interface CompactPreviewResult {
  readonly tokens_before: number;
  readonly estimated_tokens_after: number;
  readonly compacted_message_count: number;
  readonly kept_message_count: number;
  readonly protected_recent_turns: number;
  readonly high_watermark: string | null;
  readonly summary_text: string | null;
  readonly protected_fragment_kinds: ReadonlyArray<string>;
  readonly need_compact: boolean;
  readonly would_create_job_template: Record<string, unknown> | null;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function stringifyPayload(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return JSON.stringify({});
  }
}

function bodyText(body: Record<string, unknown>): string {
  if (typeof body.text === "string" && body.text.length > 0) return body.text;
  if (Array.isArray(body.parts)) {
    const parts = body.parts
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const record = part as Record<string, unknown>;
        if (record.kind === "text" && typeof record.text === "string") return record.text;
        if (record.kind === "artifact_ref") {
          const summary =
            typeof record.summary === "string" && record.summary.length > 0
              ? record.summary
              : typeof record.artifact_uuid === "string"
                ? record.artifact_uuid
                : "artifact";
          return `[artifact] ${summary}`;
        }
        return "";
      })
      .filter((value) => value.length > 0);
    if (parts.length > 0) return parts.join("\n");
  }
  return stringifyPayload(body);
}

function extractProtectedKinds(text: string): string[] {
  const found = new Set<string>();
  for (const tag of PROTECTED_FRAGMENT_TAGS) {
    if (text.includes(`<${tag}`) || text.includes(`</${tag}>`)) {
      found.add(tag);
    }
  }
  return [...found];
}

function findLatestSnapshotByKind(
  snapshots: ReadonlyArray<ContextSnapshotRecord>,
  kind: string,
): ContextSnapshotRecord | null {
  return snapshots.find((snapshot) => snapshot.snapshot_kind === kind) ?? null;
}

function resolveModelProfile(model: ContextModelProfile | null): ContextModelProfile {
  return {
    model_id: model?.model_id ?? "@cf/ibm-granite/granite-4.0-h-micro",
    context_window: model?.context_window ?? DEFAULT_CONTEXT_WINDOW,
    effective_context_pct: model?.effective_context_pct ?? DEFAULT_EFFECTIVE_CONTEXT_PCT,
    auto_compact_token_limit: model?.auto_compact_token_limit ?? null,
    base_instructions_suffix: model?.base_instructions_suffix ?? null,
    max_output_tokens: model?.max_output_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  };
}

function resolveBudget(state: ContextDurableState) {
  const model = resolveModelProfile(state.model);
  const compactTriggerTokens =
    typeof model.auto_compact_token_limit === "number" && model.auto_compact_token_limit > 0
      ? model.auto_compact_token_limit
      : Math.floor(model.context_window * model.effective_context_pct);
  const totalTokens =
    (state.usage?.llm_input_tokens ?? 0) + (state.usage?.llm_output_tokens ?? 0);
  return {
    model,
    totalTokens,
    compactTriggerTokens,
    responseReserveTokens: Math.max(1, model.max_output_tokens),
    usagePct:
      compactTriggerTokens > 0 ? Number((totalTokens / compactTriggerTokens).toFixed(4)) : 0,
    headroomTokens: Math.max(0, compactTriggerTokens - totalTokens),
    needCompact: totalTokens >= compactTriggerTokens,
    thresholdSource:
      typeof model.auto_compact_token_limit === "number" && model.auto_compact_token_limit > 0
        ? "auto_compact_token_limit"
        : "effective_context_pct",
  };
}

function buildArtifactSummary(messages: ReadonlyArray<ContextHistoryMessage>): string | null {
  const artifacts: string[] = [];
  for (const message of messages) {
    const parts = message.body.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const record = part as Record<string, unknown>;
      if (record.kind !== "artifact_ref") continue;
      const summary =
        typeof record.summary === "string" && record.summary.length > 0
          ? record.summary
          : typeof record.artifact_uuid === "string"
            ? record.artifact_uuid
            : "artifact";
      artifacts.push(summary);
    }
  }
  if (artifacts.length === 0) return null;
  return `artifacts (${artifacts.length})\n${artifacts.slice(0, 8).map((item) => `- ${item}`).join("\n")}`;
}

function buildRecentTranscript(messages: ReadonlyArray<ContextHistoryMessage>): string | null {
  const transcript = messages
    .filter((message) => message.kind !== "stream-event")
    .slice(-DEFAULT_RECENT_MESSAGE_COUNT)
    .map((message) => `[${message.role}/${message.kind}] ${truncate(bodyText(message.body), 240)}`);
  return transcript.length > 0 ? transcript.join("\n") : null;
}

function buildBoundarySummary(snapshot: ContextSnapshotRecord | null): string | null {
  if (!snapshot) return null;
  const summaryText =
    typeof snapshot.payload.summary_text === "string" && snapshot.payload.summary_text.length > 0
      ? snapshot.payload.summary_text
      : null;
  if (!summaryText) return null;
  return `compact-boundary ${snapshot.snapshot_uuid}\n${summaryText}`;
}

function buildLayers(state: ContextDurableState): ContextLayer[] {
  const budget = resolveBudget(state);
  const layers: ContextLayer[] = [];
  const latestInitialContext = findLatestSnapshotByKind(state.context_snapshots, "initial-context");
  const latestCompactBoundarySnapshot = findLatestSnapshotByKind(
    state.context_snapshots,
    "compact-boundary",
  );
  const systemContent =
    state.model?.base_instructions_suffix && state.model.base_instructions_suffix.length > 0
      ? `nano-agent runtime system prompt\n\n${state.model.base_instructions_suffix}`
      : "nano-agent runtime system prompt";
  layers.push({
    kind: "system",
    priority: 0,
    content: systemContent,
    tokenEstimate: estimateTokens(systemContent),
    required: true,
  });
  if (latestInitialContext) {
    const content = stringifyPayload(latestInitialContext.payload);
    layers.push({
      kind: "session",
      priority: 10,
      content,
      tokenEstimate: estimateTokens(content),
      required: true,
    });
  }
  const artifactSummary = buildArtifactSummary(state.history);
  if (artifactSummary) {
    layers.push({
      kind: "artifact_summary",
      priority: 30,
      content: artifactSummary,
      tokenEstimate: estimateTokens(artifactSummary),
      required: false,
    });
  }
  const recentTranscript = buildRecentTranscript(state.history);
  if (recentTranscript) {
    layers.push({
      kind: "recent_transcript",
      priority: 40,
      content: recentTranscript,
      tokenEstimate: estimateTokens(recentTranscript),
      required: false,
    });
  }
  const boundarySummary = buildBoundarySummary(latestCompactBoundarySnapshot);
  if (boundarySummary) {
    layers.push({
      kind: "injected",
      priority: 50,
      content: boundarySummary,
      tokenEstimate: estimateTokens(boundarySummary),
      required: false,
    });
  }
  const assembler = new ContextAssembler({
    maxTokens: budget.model.context_window,
    reserveForResponse: budget.responseReserveTokens,
    layers: [],
  });
  return assembler.assemble(layers).assembled;
}

function buildCompactPreview(state: ContextDurableState): CompactPreviewResult {
  const budget = resolveBudget(state);
  const transcriptMessages = state.history.filter((message) => message.kind !== "stream-event");
  if (transcriptMessages.length === 0) {
    return {
      tokens_before: budget.totalTokens,
      estimated_tokens_after: budget.totalTokens,
      compacted_message_count: 0,
      kept_message_count: 0,
      protected_recent_turns: 0,
      high_watermark: null,
      summary_text: null,
      protected_fragment_kinds: [],
      need_compact: false,
      would_create_job_template: null,
    };
  }
  const reservedSummaryTokens = Math.max(
    128,
    Math.min(2_048, Math.floor(budget.compactTriggerTokens * 0.15)),
  );
  const targetTailBudget = Math.max(1, budget.compactTriggerTokens - reservedSummaryTokens);
  let accumulated = 0;
  let splitIndex = transcriptMessages.length;
  for (let index = transcriptMessages.length - 1; index >= 0; index -= 1) {
    const message = transcriptMessages[index]!;
    const tokens = estimateTokens(bodyText(message.body));
    if (accumulated + tokens > targetTailBudget) break;
    accumulated += tokens;
    splitIndex = index;
  }
  splitIndex = Math.max(1, splitIndex);
  const compacted = budget.needCompact ? transcriptMessages.slice(0, splitIndex) : [];
  const kept = budget.needCompact ? transcriptMessages.slice(splitIndex) : transcriptMessages;
  const protectedKinds = new Set<string>();
  const summaryLines = compacted.slice(-24).map((message) => {
    const text = bodyText(message.body);
    for (const kind of extractProtectedKinds(text)) {
      protectedKinds.add(kind);
    }
    return `[${message.role}/${message.kind}] ${truncate(text, 180)}`;
  });
  const summaryText =
    compacted.length > 0
      ? `compact-boundary summary\n${summaryLines.join("\n")}`
      : null;
  const estimatedTokensAfter =
    kept.reduce((sum, message) => sum + estimateTokens(bodyText(message.body)), 0) +
    (summaryText ? estimateTokens(summaryText) : 0);
  const protectedRecentTurns = new Set(
    kept.map((message) => message.turn_uuid).filter((value): value is string => typeof value === "string"),
  ).size;
  const highWatermark = compacted.at(-1)?.message_uuid ?? null;
  return {
    tokens_before: budget.totalTokens,
    estimated_tokens_after: estimatedTokensAfter,
    compacted_message_count: compacted.length,
    kept_message_count: kept.length,
    protected_recent_turns: protectedRecentTurns,
    high_watermark: highWatermark,
    summary_text: summaryText,
    protected_fragment_kinds: [...protectedKinds],
    need_compact: budget.needCompact && compacted.length > 0,
    would_create_job_template:
      budget.needCompact && highWatermark
        ? {
            checkpoint_kind: "compact_boundary",
            created_by: "compact",
            message_high_watermark: highWatermark,
          }
        : null,
  };
}

export function buildContextProbe(state: ContextDurableState) {
  const budget = resolveBudget(state);
  const layers = buildLayers(state);
  const preview = buildCompactPreview(state);
  return {
    session_uuid: state.snapshot.session_uuid,
    team_uuid: state.snapshot.team_uuid,
    status: state.snapshot.session_status,
    phase: state.snapshot.last_phase,
    summary: `context probe ready (${layers.length} layers, ${state.context_snapshots.length} snapshots)`,
    artifacts_count: state.history.reduce((count, message) => {
      const parts = message.body.parts;
      if (!Array.isArray(parts)) return count;
      return (
        count +
        parts.filter(
          (part) =>
            part &&
            typeof part === "object" &&
            (part as Record<string, unknown>).kind === "artifact_ref",
        ).length
      );
    }, 0),
    need_compact: budget.needCompact,
    phase_marker: "durable",
    model: {
      model_id: budget.model.model_id,
      context_window: budget.model.context_window,
      effective_context_pct: budget.model.effective_context_pct,
      auto_compact_token_limit: budget.model.auto_compact_token_limit,
      max_output_tokens: budget.model.max_output_tokens,
      threshold_source: budget.thresholdSource,
    },
    usage: {
      total_tokens: budget.totalTokens,
      compact_trigger_tokens: budget.compactTriggerTokens,
      usage_pct: budget.usagePct,
      headroom_tokens: budget.headroomTokens,
      estimate_basis: "durable-usage-aggregate",
    },
    layers: {
      count: layers.length,
      kinds: layers.map((layer) => layer.kind),
    },
    snapshots: {
      count: state.context_snapshots.length,
      latest_snapshot_id: state.context_snapshots[0]?.snapshot_uuid ?? null,
      latest_boundary_job_id: state.latest_compact_boundary?.checkpoint_uuid ?? null,
    },
    compact: {
      latest_notify: state.latest_compact_notify,
      preview: {
        compacted_message_count: preview.compacted_message_count,
        kept_message_count: preview.kept_message_count,
        protected_recent_turns: preview.protected_recent_turns,
        would_create_job_template: preview.would_create_job_template,
      },
      protected_fragment_kinds: [...PROTECTED_FRAGMENT_TAGS],
    },
  };
}

export function buildContextLayersResponse(state: ContextDurableState) {
  const layers = buildLayers(state);
  return {
    session_uuid: state.snapshot.session_uuid,
    team_uuid: state.snapshot.team_uuid,
    layers: layers.map((layer) => ({
      kind: layer.kind,
      token_estimate: layer.tokenEstimate,
      required: layer.required,
      preview: truncate(layer.content, 256),
    })),
  };
}

export function buildContextSnapshotPayload(state: ContextDurableState) {
  const probe = buildContextProbe(state);
  const layers = buildContextLayersResponse(state);
  return {
    kind: "manual-snapshot",
    probe,
    layers,
  };
}

// HP3-D5 — preview cache (Q12 frozen): same session + same high-watermark
// within `PREVIEW_CACHE_TTL_MS` reuses the previous compute. Long
// conversations frequently call `/preview` from UI; without cache each
// preview triggers a full D1 query + token estimate. Cache key is
// `session_uuid:high_watermark` so that any new message invalidates
// the cached preview implicitly. `high_watermark` is the last
// compacted message UUID (string|null); we serialise null → "" so the
// key remains stable.
const PREVIEW_CACHE_TTL_MS = 60_000;
type PreviewCacheEntry = {
  readonly session_uuid: string;
  readonly high_watermark: string | null;
  readonly computed_at: number;
  readonly response: Record<string, unknown>;
};
const PREVIEW_CACHE = new Map<string, PreviewCacheEntry>();

export function resetPreviewCache(): void {
  PREVIEW_CACHE.clear();
}

function previewCacheKey(sessionUuid: string, highWatermark: string | null): string {
  return `${sessionUuid}:${highWatermark ?? ""}`;
}

function readFreshPreviewCache(
  sessionUuid: string,
  highWatermark: string | null,
  now: number,
): Record<string, unknown> | null {
  const key = previewCacheKey(sessionUuid, highWatermark);
  const entry = PREVIEW_CACHE.get(key);
  if (!entry) return null;
  if (now - entry.computed_at > PREVIEW_CACHE_TTL_MS) {
    PREVIEW_CACHE.delete(key);
    return null;
  }
  return entry.response;
}

function writePreviewCache(
  sessionUuid: string,
  highWatermark: string | null,
  response: Record<string, unknown>,
  now: number,
): void {
  PREVIEW_CACHE.set(previewCacheKey(sessionUuid, highWatermark), {
    session_uuid: sessionUuid,
    high_watermark: highWatermark,
    computed_at: now,
    response,
  });
}

export function buildCompactPreviewResponse(
  state: ContextDurableState,
  options?: { readonly nowMs?: number },
) {
  const now = options?.nowMs ?? Date.now();
  const budget = resolveBudget(state);
  // Cheap pre-compute: derive the high-watermark from the durable state
  // without running the full preview path. The cache key uses
  // `(session_uuid, message_high_watermark)`, so any new message
  // invalidates the cached entry implicitly without an explicit invalidation
  // hook.
  const previewForKey = buildCompactPreview(state);
  const sessionUuid = state.snapshot.session_uuid;
  const highWatermark = previewForKey.high_watermark;
  const cached = readFreshPreviewCache(sessionUuid, highWatermark, now);
  if (cached) {
    return { ...cached, cached: true };
  }
  const preview = previewForKey;
  const response = {
    session_uuid: sessionUuid,
    team_uuid: state.snapshot.team_uuid,
    model: {
      model_id: budget.model.model_id,
      context_window: budget.model.context_window,
      compact_trigger_tokens: budget.compactTriggerTokens,
    },
    need_compact: preview.need_compact,
    latest_boundary: state.latest_compact_boundary
      ? {
          job_id: state.latest_compact_boundary.checkpoint_uuid,
          created_at: state.latest_compact_boundary.created_at,
        }
      : null,
    tokens_before: preview.tokens_before,
    estimated_tokens_after: preview.estimated_tokens_after,
    compacted_message_count: preview.compacted_message_count,
    kept_message_count: preview.kept_message_count,
    protected_recent_turns: preview.protected_recent_turns,
    high_watermark: preview.high_watermark,
    protected_fragment_kinds: preview.protected_fragment_kinds,
    summary_preview: preview.summary_text ? truncate(preview.summary_text, 512) : null,
    would_create_job_template: preview.would_create_job_template,
    cached: false,
  };
  writePreviewCache(sessionUuid, highWatermark, response, now);
  return response;
}

export function buildCompactCommitInput(state: ContextDurableState) {
  const preview = buildCompactPreview(state);
  return {
    session_uuid: state.snapshot.session_uuid,
    team_uuid: state.snapshot.team_uuid,
    tokens_before: preview.tokens_before,
    tokens_after: preview.estimated_tokens_after,
    prompt_token_estimate: preview.estimated_tokens_after,
    summary_text: preview.summary_text ?? "",
    message_high_watermark: preview.high_watermark,
    protected_fragment_kinds: preview.protected_fragment_kinds,
    compacted_message_count: preview.compacted_message_count,
    kept_message_count: preview.kept_message_count,
    need_compact: preview.need_compact,
  };
}

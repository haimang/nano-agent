# Changelog — @nano-agent/llm-wrapper

## Unreleased — 2026-04-23 (worker-matrix P5/D09 DEPRECATED)

### Deprecated

- Full runtime ownership absorbed into `workers/agent-core/src/llm/` as A3 per worker-matrix D01 (P1.A-sub2). Package is now a **coexistence duplicate**. `LLMExecutor` / canonical model / `OpenAIChatAdapter` / adapter & provider & model registry / stream normalizer / attachment planner / session-stream bridge canonically owned by `workers/agent-core`. README banner added.
- Coexistence-period bug-fix discipline unchanged (W3 pattern §6).
- No runtime / public-API changes in this entry — code is byte-identical to prior.

## 0.1.0 — 2026-04-17

Initial v1 implementation + post-review corrections.

### Added

- Canonical model types: `CanonicalMessage`, `CanonicalContentPart`,
  `CanonicalLLMRequest`, `CanonicalLLMResult`, `NormalizedLLMEvent` (with
  new `llm.request.started` lifecycle anchor).
- `ProviderRegistry` with explicit `rotateApiKey()` / `currentApiKey()` API
  for `on-429` support.
- `ModelRegistry` with capability flags.
- `OpenAIChatAdapter` — OpenAI-compatible Chat Completions adapter with
  SSE parsing including multi-tool-call handling.
- `LLMExecutor`:
  - provider-wins retry-policy resolution (maxRetries, baseDelayMs),
  - `Retry-After` header handling,
  - `on-429` key rotation via an injected `ProviderRegistry`,
  - `llm.request.started` emitted at the start of `executeStream()`.
- `AttachmentPlanner` with worker-native route names
  (`inline | signed-url | proxy-url | prepared-text | reject`).
- `PreparedArtifactRef` aligned with
  `@nano-agent/workspace-context-artifacts`'s `PreparedArtifactRefSchema`
  (plus a wrapper-only `textContent` convenience).
- `session-stream-adapter.ts` bodies now strictly parse under
  `@haimang/nacp-session`'s `SessionStreamEventBodySchema` (9-kind
  catalog, no invented `llm.tool_call` kind; `system.notify` uses
  `severity`, not `level`).
- `test/canonical.test.ts` + `fixtures/` (provider profiles, SSE, non-stream JSON).
- Integration tests: `local-fetch-stream.test.ts`, `retry-timeout.test.ts`,
  `prepared-artifact-routing.test.ts`.
- README + CHANGELOG.

### Changed

- `AttachmentRoute` values `inline-text` / `image-url` renamed to
  `inline` / `signed-url` respectively; `proxy-url` added for future
  staged delivery. The old names are preserved as
  `LegacyAttachmentRoute` for migration reference only.
- `SessionEventBody.body` now includes the discriminator `kind` field
  inside the body so callers can forward straight to
  `SessionStreamEventBodySchema.parse()`.

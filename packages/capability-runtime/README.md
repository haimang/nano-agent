# @nano-agent/capability-runtime

Typed capability execution layer for nano-agent. Translates bash-shaped
command strings and structured tool calls into validated
`CapabilityPlan`s, runs them against pluggable execution targets
(in-process TypeScript, remote service bindings, headless browser), and
returns normalised results.

Design goals:
- Never shell out to a real process. All "commands" are dispatched
  through typed handlers so they can run safely in a V8 isolate.
- No silent success. If a command can't be executed, the runtime
  returns a structured error — it does NOT fabricate an output.
- Cancellation and timeouts are first-class: executions are tagged by
  `requestId` and can be cancelled externally. Timeouts abort the
  underlying handler via `AbortSignal`.
- Protocol-agnostic result objects that map cleanly onto the NACP
  `tool.call.*` message schemas from `@nano-agent/nacp-core`.

## Supported commands (B3, 21 total)

The minimal command pack registered by `registerMinimalCommands`. The
`local-ts` target is shared by every entry; `Target` is omitted from
the table for brevity.

**12-pack baseline (A8 / A9 / A10 — pre-B3):**

| Command   | Kind       | Policy |
| --------- | ---------- | ------ |
| `pwd`     | filesystem | allow  |
| `ls`      | filesystem | allow  |
| `cat`     | filesystem | allow  |
| `write`   | filesystem | ask    |
| `mkdir`   | filesystem | ask    |
| `rm`      | filesystem | ask    |
| `mv`      | filesystem | ask    |
| `cp`      | filesystem | ask    |
| `rg`      | search     | allow  |
| `curl`    | network    | ask    |
| `ts-exec` | exec       | ask    |
| `git`     | vcs        | allow  |

**B3 wave 1 — text-processing core (after-foundations Phase 2):**

| Command | Kind       | Policy | Bash form              | Subset                                     |
| ------- | ---------- | ------ | ---------------------- | ------------------------------------------ |
| `wc`    | filesystem | allow  | `wc <path>`            | POSIX `lines words bytes path`             |
| `head`  | filesystem | allow  | `head <path>`          | First 10 lines (default); `{ lines, bytes }` via structured tool call |
| `tail`  | filesystem | allow  | `tail <path>`          | Last 10 lines (default); `{ lines, bytes }` via structured tool call  |
| `jq`    | filesystem | allow  | `jq <query> <path>`    | `. / .field / .a[N] / .a[] / keys / length` |
| `sed`   | filesystem | allow  | `sed <expr> <path>`    | Single `s/PATTERN/REPLACEMENT/[gi]`         |
| `awk`   | filesystem | allow  | `awk <program> <path>` | `{ print $N }`, `NR == K { … }`, `/PAT/ { … }` |

**B3 wave 2 — text-processing aux:**

| Command | Kind       | Policy | Bash form              | Notes |
| ------- | ---------- | ------ | ---------------------- | ----- |
| `sort`  | filesystem | allow  | `sort <path>`          | Default lexicographic; structured `{ reverse, numeric, unique }` |
| `uniq`  | filesystem | allow  | `uniq <path>`          | POSIX adjacent-dedup; structured `{ count }`                     |
| `diff`  | filesystem | allow  | `diff <left> <right>`  | LCS-based unified-style minimal-context output                   |

The 9 text-processing commands share a 64 KiB UTF-8 output cap with a
deterministic `text-output-truncated` marker (`TEXT_OUTPUT_MAX_BYTES` /
`TEXT_OUTPUT_TRUNCATED_NOTE`). The bash path for these commands is
intentionally **file/path-first** — any leading `-flag` is rejected
with `text-processing-bash-narrow-use-structured` (B3 Phase 1 freeze;
mirrors the Q17 `curl <url>` narrow surface). Richer options travel
through the structured tool call only.

`write` consumes the B2 typed `ValueTooLargeError` shape **structurally**
(no `@nano-agent/storage-topology` import) and emits a
`write-oversize-rejected` disclosure. `curl` accepts an optional
per-turn `SubrequestBudget` (`createSubrequestBudget({ subrequests,
responseBytes })`) — exhausting it raises a typed error with
`curl-budget-exhausted` (no new `CapabilityEventKind`; surfaced via
existing error path per Phase 1 P1-03 freeze).

Everything outside this list is rejected. Dangerous or OS-bound
commands (e.g. `sudo`, `docker`, `npm`, `ssh`) are in
`UNSUPPORTED_COMMANDS`. Archive/compression tools that can OOM the V8
isolate (`tar`, `gzip`, `unzip`, `xz`, ...) are in `OOM_RISK_COMMANDS`
and return error code `oom-risk-blocked`.

## Execution targets

- **`local-ts`** — `LocalTsTarget`. Runs handler functions in-process.
  This is the reference target used by the minimal command pack.
- **`service-binding`** — `ServiceBindingTarget`. Stub that returns
  `not-connected`. Reserved for Cloudflare service-binding-based
  remote execution.
- **`browser-rendering`** — `BrowserRenderingTarget`. Stub that returns
  `not-connected`. Reserved for headless-browser capabilities
  (screenshot, PDF, JS-heavy scraping).

All targets implement:

```ts
interface TargetHandler {
  execute(plan: CapabilityPlan, signal?: AbortSignal): Promise<CapabilityResult>;
}
```

## Cancel / abort

`CapabilityExecutor` tracks in-flight executions by `requestId`. To
cancel, call `executor.cancel(requestId)`. The executor aborts the
associated `AbortController`, which the handler observes via its
`signal` parameter. On timeout, the executor also aborts — so a
well-written handler never keeps working past either boundary.

`LocalTsTarget` checks `signal.aborted` before and after invoking the
handler and returns a `cancelled` result in either case.

## Event stream

`executor.executeStream(plan)` returns an
`AsyncIterable<CapabilityEvent>`. The stream yields exactly one
`started` event up front, then terminates with one of:

- `completed` — handler returned `kind: "inline"` or `"promoted"`
- `cancelled` — signal was aborted (e.g. via `cancel()`)
- `timeout` — the executor's timeout fired
- `error` — policy denied, no target, or handler threw

Progress events (`kind: "progress"`) are modelled in the type system;
the current executor only emits terminal events beyond `started`.
Progress emission is wired through the handler's own side-channels in
target implementations.

## Tool-call bridge

`buildToolCallRequest(plan)` produces the BODY (not the envelope) for
a `tool.call.request` NACP message:

```ts
{ tool_name: string, tool_input: Record<string, unknown> }
```

Non-object plan inputs are wrapped as `{ value: ... }` so the body
always satisfies the `Record<string, unknown>` schema.

`parseToolCallResponse(body)` consumes the NACP response body:

```ts
{ status: "ok" | "error", output?: string, error?: { code, message } }
```

`status: "ok"` → `CapabilityResult.kind = "inline"`.
`status: "error"` → `CapabilityResult.kind = "error"`.

`buildToolCallCancelBody(reason?)` returns `{ reason }` or `{}`.

## Minimal example

```ts
import {
  InMemoryCapabilityRegistry,
  registerMinimalCommands,
  LocalTsTarget,
  CapabilityExecutor,
  CapabilityPolicyGate,
  FakeBashBridge,
  planFromBashCommand,
  createFilesystemHandlers,
} from "@nano-agent/capability-runtime";

// 1. Registry + command set
const registry = new InMemoryCapabilityRegistry();
registerMinimalCommands(registry);

// 2. Target + handlers
const localTs = new LocalTsTarget();
for (const [name, handler] of createFilesystemHandlers({ workspacePath: "/ws" })) {
  localTs.registerHandler(name, handler);
}

// 3. Executor
const policy = new CapabilityPolicyGate(registry);
const executor = new CapabilityExecutor(
  new Map([["local-ts", localTs]]),
  policy,
  { timeoutMs: 30_000 },
);

// 4a. Direct: plan + execute
const plan = planFromBashCommand("ls /ws", registry)!;
const result = await executor.execute(plan);

// 4b. Bash-shaped: via FakeBashBridge
const bridge = new FakeBashBridge(registry, planFromBashCommand, executor);
const result2 = await bridge.execute("pwd");

// 4c. Streaming
for await (const evt of executor.executeStream(plan)) {
  console.log(evt.kind, evt.timestamp);
}
```

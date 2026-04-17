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

## Supported commands (v1, 12 total)

The minimal command pack registered by `registerMinimalCommands`:

| Command   | Kind       | Target    | Policy |
| --------- | ---------- | --------- | ------ |
| `pwd`     | filesystem | local-ts  | allow  |
| `ls`      | filesystem | local-ts  | allow  |
| `cat`     | filesystem | local-ts  | allow  |
| `write`   | filesystem | local-ts  | ask    |
| `mkdir`   | filesystem | local-ts  | ask    |
| `rm`      | filesystem | local-ts  | ask    |
| `mv`      | filesystem | local-ts  | ask    |
| `cp`      | filesystem | local-ts  | ask    |
| `rg`      | search     | local-ts  | allow  |
| `curl`    | network    | local-ts  | ask    |
| `ts-exec` | exec       | local-ts  | ask    |
| `git`     | vcs        | local-ts  | allow  |

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

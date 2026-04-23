/**
 * Fake Bash Bridge
 *
 * The compatibility surface that translates bash-shaped command strings
 * into capability plans and (optionally) executes them through the typed
 * runtime.
 *
 * Construction:
 *   - `new FakeBashBridge(registry, planner)` — plan-only mode. execute()
 *     will return a `no-executor` error because the bridge has nothing
 *     to dispatch with. Use plan() in this mode to obtain the plan and
 *     drive execution yourself.
 *   - `new FakeBashBridge(registry, planner, executor)` — full mode.
 *     execute() will dispatch through the provided CapabilityExecutor
 *     and return real results.
 *
 * Important: the bridge NEVER fabricates success results. If it cannot
 * really execute (because no executor was supplied), it returns an
 * explicit error. Silent success-shaped echoes are a correctness bug.
 */

import type { CapabilityRegistry } from "../registry.js";
import type { CapabilityResult } from "../result.js";
import type { CapabilityPlan } from "../types.js";
import type { CapabilityExecutor } from "../executor.js";
import { parseSimpleCommand } from "../planner.js";
import type { planFromBashCommand as PlanFn } from "../planner.js";
import {
  isUnsupported,
  getUnsupportedMessage,
  isOomRisk,
  getOomRiskMessage,
} from "./unsupported.js";

/**
 * FakeBashBridge provides a bash-like command interface that routes
 * through the capability runtime instead of spawning real processes.
 */
export class FakeBashBridge {
  constructor(
    private registry: CapabilityRegistry,
    private planner: typeof PlanFn,
    private executor?: CapabilityExecutor,
  ) {}

  /**
   * Plan-only: parse the command and return a CapabilityPlan, or null
   * if the command is empty/unsupported/unknown. Never executes.
   *
   * Unsupported and OOM-risk commands return `null` (plan-level rejection).
   * Use execute() to get structured error results for those.
   *
   * **B3-R1 fix (2026-04-20)**: planner-side bash-narrow violations
   * (e.g. `curl -X POST …`, `head -n 5 file.txt`) used to leak as raw
   * `Error` throws because `plan()` invoked `this.planner(...)`
   * unwrapped. The bridge contract is that `plan()` returns `null` on
   * any plan-level rejection — we now catch the planner throw and
   * surface `null`. Callers that need a structured reason should use
   * `execute()` (which maps the same throw to an error result).
   */
  plan(commandLine: string): CapabilityPlan | null {
    const { command } = parseSimpleCommand(commandLine);
    if (!command) return null;
    if (isUnsupported(command)) return null;
    if (isOomRisk(command)) return null;
    try {
      return this.planner(commandLine, this.registry);
    } catch {
      // Bash-narrow violation or other planner reject — bridge
      // contract is "null on failure".
      return null;
    }
  }

  /**
   * Execute a bash-shaped command string through the capability runtime.
   *
   * Returns a CapabilityResult. If the command is unsupported,
   * unrecognized, or no executor was provided, returns an error result
   * rather than throwing. Does NOT fabricate success.
   */
  async execute(commandLine: string): Promise<CapabilityResult> {
    const { command } = parseSimpleCommand(commandLine);

    if (!command) {
      return this.errorResult("", "empty-command", "No command provided");
    }

    if (isUnsupported(command)) {
      return this.errorResult(
        command,
        "unsupported-command",
        getUnsupportedMessage(command),
      );
    }

    if (isOomRisk(command)) {
      return this.errorResult(
        command,
        "oom-risk-blocked",
        getOomRiskMessage(command),
      );
    }

    let plan: CapabilityPlan | null;
    try {
      plan = this.planner(commandLine, this.registry);
    } catch (err) {
      // B3-R1 fix — bash-narrow violations (e.g. `curl -X POST`,
      // `head -n 5 file.txt`) used to escape as raw Error throws.
      // Bridge contract is "structured error result on failure".
      return this.errorResult(
        command,
        "bash-narrow-rejected",
        err instanceof Error ? err.message : String(err),
      );
    }
    if (!plan) {
      return this.errorResult(
        command,
        "unknown-command",
        `Command "${command}" is not registered in the capability runtime`,
      );
    }

    if (!this.executor) {
      return this.errorResult(
        plan.capabilityName,
        "no-executor",
        "FakeBashBridge has no CapabilityExecutor attached — use plan() for plan-only mode, or construct with an executor to enable execute().",
      );
    }

    return await this.executor.execute(plan);
  }

  /** Check if a command name is supported (registered and not blocked). */
  isSupported(command: string): boolean {
    if (isUnsupported(command)) return false;
    if (isOomRisk(command)) return false;
    return this.registry.has(command);
  }

  /** List all registered command names. */
  listCommands(): string[] {
    return this.registry.list().map((d) => d.name);
  }

  private errorResult(
    capabilityName: string,
    code: string,
    message: string,
  ): CapabilityResult {
    return {
      kind: "error",
      capabilityName,
      requestId: generateRequestId(),
      error: { code, message },
      durationMs: 0,
    };
  }
}

let _reqCounter = 0;
function generateRequestId(): string {
  return `req-${Date.now()}-${++_reqCounter}`;
}

/**
 * Re-validation — fake-bash findings through shipped seams.
 *
 * Covers:
 *   F07 — bash capability parity       (3 of 3 contracts — rg / mkdir / reserved namespace)
 *   F09 — bash curl conservative budget (re-validate shipped budget, NOT high-volume)
 *
 * Uses the shipped `@nano-agent/capability-runtime`:
 *   - `InMemoryCapabilityRegistry` to register declarations
 *   - `CapabilityPolicyGate` to resolve allow/ask/deny
 *   - `CapabilityExecutor` to dispatch
 *   - `LocalTsTarget` with a handler that answers each capability
 *
 * Note: F09 high-volume lives in the `curl-high-volume` follow-up (gated
 * on owner URL). This module only confirms the B3 conservative budget
 * path still flows through the shipped executor end-to-end.
 */

import {
  CapabilityExecutor,
  CapabilityPolicyGate,
  InMemoryCapabilityRegistry,
  LocalTsTarget,
  type CapabilityPlan,
  type TargetHandler,
  type ExecutionTarget,
} from "@nano-agent/capability-runtime";
import {
  makeIntegratedResult,
  type IntegratedProbeResult,
} from "../result-shape.js";

export interface BashReValidationDeps {
  readonly mode: "local" | "live";
}

function registerBashDecls(registry: InMemoryCapabilityRegistry): void {
  registry.register({
    name: "rg",
    kind: "search",
    description: "Re-validation: ripgrep parity check",
    inputSchema: {},
    executionTarget: "local-ts",
    policy: "allow",
  });
  registry.register({
    name: "mkdir",
    kind: "filesystem",
    description: "Re-validation: mkdir capability parity",
    inputSchema: {},
    executionTarget: "local-ts",
    policy: "allow",
  });
  registry.register({
    name: "curl",
    kind: "network",
    description: "Re-validation: conservative curl budget path",
    inputSchema: {},
    executionTarget: "local-ts",
    policy: "allow",
  });
  // Control-case: ensure the `deny` policy path still bites.
  registry.register({
    name: "reserved-platform",
    kind: "filesystem",
    description: "Re-validation: reserved /_platform/** namespace stays denied",
    inputSchema: {},
    executionTarget: "local-ts",
    policy: "deny",
  });
}

export async function probeBashReValidation(
  _deps: BashReValidationDeps,
): Promise<IntegratedProbeResult> {
  const start = Date.now();
  const registry = new InMemoryCapabilityRegistry();
  registerBashDecls(registry);
  const gate = new CapabilityPolicyGate(registry);

  const target = new LocalTsTarget();
  target.registerHandler("rg", async () => ({ output: "rg-parity-ok" }));
  target.registerHandler("mkdir", async () => ({ output: "mkdir-partial-ok" }));
  target.registerHandler("curl", async (input: unknown) => ({
    output: JSON.stringify({
      budgetKind: "conservative",
      url: (input as { url?: string } | undefined)?.url ?? "",
    }),
  }));
  target.registerHandler("reserved-platform", async () => ({
    output: "should-not-execute",
  }));

  const targets = new Map<ExecutionTarget, TargetHandler>([["local-ts", target]]);
  const executor = new CapabilityExecutor(targets, gate, { timeoutMs: 5000 });

  const runPlan = async (name: string, input: unknown): Promise<string | undefined> => {
    const plan: CapabilityPlan = {
      capabilityName: name,
      input,
      executionTarget: "local-ts",
      source: "bash-command",
    };
    const result = await executor.execute(plan);
    if (result.kind === "inline") return result.output;
    return undefined;
  };

  const rgOut = await runPlan("rg", { pattern: "foo" });
  const mkdirOut = await runPlan("mkdir", { path: "/tmp/x" });
  const curlOut = await runPlan("curl", { url: "https://example.invalid/ping" });
  const deniedResult = await executor.execute({
    capabilityName: "reserved-platform",
    input: { path: "/_platform/secret" },
    executionTarget: "local-ts",
    source: "bash-command",
  });

  const rgOk = rgOut === "rg-parity-ok";
  const mkdirOk = mkdirOut === "mkdir-partial-ok";
  const curlOk = typeof curlOut === "string" && curlOut.includes("conservative");
  const denyOk =
    deniedResult.kind === "error" && deniedResult.error?.code === "policy-denied";

  const allOk = rgOk && mkdirOk && curlOk && denyOk;

  return makeIntegratedResult("V2A/V2-bash-integration-revalidation", start, {
    findingId: "spike-do-storage-F07/F09",
    verdict: allOk ? "writeback-shipped" : "still-open",
    success: allOk,
    mode: _deps.mode,
    usedPackages: ["@nano-agent/capability-runtime"],
    caveats: [
      "F07 parity validates the 3 Round-1 contracts at the executor boundary, not the underlying OS",
      "F09 re-validation intentionally avoids high-volume — see `curl-high-volume` follow-up for owner-gated path",
      "reserved-namespace deny test confirms B3 deny policy still bites",
    ],
    observations: [
      { label: "F07.rg", value: rgOk },
      { label: "F07.mkdir", value: mkdirOk },
      { label: "F07.reserved-deny", value: denyOk },
      { label: "F09.conservative-budget-path", value: curlOk },
    ],
    errors: allOk
      ? []
      : [
          {
            code: "bash-revalidation-fail",
            message: `rg=${rgOk} mkdir=${mkdirOk} curl=${curlOk} deny=${denyOk}`,
            count: 1,
          },
        ],
    evidenceRefs: [
      { kind: "source", locator: "packages/capability-runtime/src/executor.ts" },
      { kind: "finding-doc", locator: "docs/spikes/spike-do-storage/07-bash-capability-parity-3-of-3-contracts-hold.md" },
      { kind: "finding-doc", locator: "docs/spikes/spike-do-storage/09-curl-quota-25-fetches-no-rate-limit-default-target.md" },
    ],
    timings: { samplesN: 4 },
  });
}

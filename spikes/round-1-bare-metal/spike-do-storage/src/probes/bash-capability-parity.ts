/**
 * V2A-bash-capability-parity probe.
 *
 * Validation goal (per P0-spike-do-storage-design r2 §4.7):
 *   Verify that current `packages/capability-runtime/src/capabilities/`
 *   handler CONTRACTS still hold under real Cloudflare DO runtime.
 *
 * This probe does NOT execute capability-runtime code (纪律 7). It
 * mirrors the contract behaviors against the real DO storage so finding
 * §3 Package Impact can name specific files when a contract diverges.
 *
 * Contract reference points (capability-runtime real source):
 *   - filesystem.ts:9      `/_platform/**` is a reserved namespace
 *   - filesystem.ts:53     MKDIR_PARTIAL_NOTE = "mkdir-partial-no-directory-entity"
 *   - filesystem.ts:120-127 mkdir is "ack-create prefix only", no directory entity
 *   - search.ts            rg recursive listDir/readFile, inline cap 200 lines / 32 KB
 *   - workspace-truth.ts   resolveWorkspacePath() normalizes paths
 */

import { makeResult, type ProbeResult } from "../result-shape.js";

const RESERVED_PREFIX = "/_platform/";
const RG_INLINE_LINE_CAP = 200;
const RG_INLINE_BYTE_CAP = 32 * 1024;

interface ContractCheck {
  readonly contract: string;
  readonly source: string;
  readonly expected: unknown;
  readonly observed: unknown;
  readonly holds: boolean;
}

export async function probeBashCapabilityParity(
  doNs: DurableObjectNamespace,
  _params: Record<string, unknown>,
): Promise<ProbeResult> {
  const start = Date.now();
  const observations: ProbeResult["observations"] = [];
  const errors: ProbeResult["errors"] = [];
  const checks: ContractCheck[] = [];

  // We exercise contract checks by routing through ProbeDO which
  // emulates the WorkspaceFsLike API on top of DO state.storage.
  const id = doNs.idFromName("capability-parity-probe");
  const stub = doNs.get(id);

  // Contract C1: mkdir on a normal path returns the partial note;
  // backend does NOT create a directory entity (subsequent listDir of
  // that prefix returns empty).
  try {
    const res = await stub.fetch(
      new Request("https://probe-do/cap-mkdir-partial", {
        method: "POST",
        body: JSON.stringify({ path: "/work/mkdir-probe-1/" }),
        headers: { "content-type": "application/json" },
      }),
    );
    const body = (await res.json()) as { note: string; listAfter: string[] };
    checks.push({
      contract: "mkdir partial-no-directory-entity",
      source: "packages/capability-runtime/src/capabilities/filesystem.ts:53,120-127",
      expected: { note: "mkdir-partial-no-directory-entity", listAfterEmpty: true },
      observed: body,
      holds:
        body.note === "mkdir-partial-no-directory-entity" &&
        body.listAfter.length === 0,
    });
  } catch (err) {
    errors.push({
      code: "CapMkdirProbeFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
  }

  // Contract C2: writes under /_platform/ are rejected (reserved namespace).
  try {
    const res = await stub.fetch(
      new Request("https://probe-do/cap-reserved-namespace", {
        method: "POST",
        body: JSON.stringify({ path: `${RESERVED_PREFIX}should-fail`, content: "x" }),
        headers: { "content-type": "application/json" },
      }),
    );
    const body = (await res.json()) as { rejected: boolean; errorKind?: string };
    checks.push({
      contract: "reserved-namespace /_platform/** rejection",
      source: "packages/capability-runtime/src/capabilities/filesystem.ts:9",
      expected: { rejected: true },
      observed: body,
      holds: body.rejected === true,
    });
  } catch (err) {
    errors.push({
      code: "CapReservedNsProbeFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
  }

  // Contract C3: rg-style recursive read with inline cap.
  // Seed 250 lines / 50 KB into a DO-backed file, then ask the probe to
  // emulate the rg cap behavior and verify truncation.
  try {
    // Build a payload that exceeds both 200-line and 32-KB caps.
    const lines: string[] = [];
    for (let i = 0; i < 250; i++) {
      lines.push(`line-${String(i).padStart(4, "0")}-` + "x".repeat(120));
    }
    const payload = lines.join("\n");
    const res = await stub.fetch(
      new Request("https://probe-do/cap-rg-cap", {
        method: "POST",
        body: JSON.stringify({
          path: "/work/rg-probe.txt",
          content: payload,
          lineCap: RG_INLINE_LINE_CAP,
          byteCap: RG_INLINE_BYTE_CAP,
          pattern: "line-",
        }),
        headers: { "content-type": "application/json" },
      }),
    );
    const body = (await res.json()) as {
      truncated: boolean;
      returnedLines: number;
      returnedBytes: number;
    };
    checks.push({
      contract: "rg inline output cap (200 lines / 32 KB)",
      source: "packages/capability-runtime/src/capabilities/search.ts",
      expected: {
        truncated: true,
        returnedLinesLte: RG_INLINE_LINE_CAP,
        returnedBytesLte: RG_INLINE_BYTE_CAP,
      },
      observed: body,
      holds:
        body.truncated === true &&
        body.returnedLines <= RG_INLINE_LINE_CAP &&
        body.returnedBytes <= RG_INLINE_BYTE_CAP,
    });
  } catch (err) {
    errors.push({
      code: "CapRgProbeFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
  }

  observations.push({ label: "contract_checks", value: checks });
  observations.push({
    label: "summary",
    value: {
      total: checks.length,
      holding: checks.filter((c) => c.holds).length,
      diverging: checks.filter((c) => !c.holds).map((c) => c.contract),
    },
  });

  return makeResult("V2A-bash-capability-parity", start, {
    success: errors.length === 0,
    observations,
    errors,
    timings: { samplesN: checks.length },
  });
}

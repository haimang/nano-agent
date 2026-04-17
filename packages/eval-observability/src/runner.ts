/**
 * @nano-agent/eval-observability — Scenario runner.
 *
 * Executes a ScenarioSpec against a ScenarioSession, collecting
 * step-by-step results and producing a ScenarioResult summary.
 */

import type { ScenarioSpec, ScenarioResult, StepFailure } from "./scenario.js";

/**
 * Abstraction over a live or simulated session that the runner
 * drives during scenario execution.
 */
export interface ScenarioSession {
  /** Send a message to the session. */
  send(message: unknown): Promise<void>;
  /** Receive the next message from the session. */
  receive(): Promise<unknown>;
  /** Create a checkpoint (snapshot) of session state. */
  checkpoint(): Promise<void>;
  /** Resume from the most recent checkpoint. */
  resume(): Promise<void>;
}

/**
 * Runs a scenario specification step-by-step against a session.
 */
export class ScenarioRunner {
  /**
   * Execute all steps in the scenario spec against the provided session.
   *
   * - "send": calls session.send(step.detail)
   * - "expect": calls session.receive() and deep-compares against step.detail
   * - "wait": pauses for the number of milliseconds in step.detail
   * - "checkpoint": calls session.checkpoint()
   * - "resume": calls session.resume()
   *
   * Execution continues through all steps even after failures so the
   * full result set is available for debugging.
   */
  async run(spec: ScenarioSpec, session: ScenarioSession): Promise<ScenarioResult> {
    const failures: StepFailure[] = [];
    let stepsCompleted = 0;
    const startTime = Date.now();

    for (let i = 0; i < spec.steps.length; i++) {
      const step = spec.steps[i];

      try {
        switch (step.action) {
          case "send":
            await session.send(step.detail);
            break;

          case "expect": {
            const received = await session.receive();
            if (!deepEqual(received, step.detail)) {
              failures.push({
                stepIndex: i,
                expected: step.detail,
                actual: received,
                message: `Step ${i}: expected value did not match received value`,
              });
            }
            break;
          }

          case "wait": {
            const ms = typeof step.detail === "number" ? step.detail : 0;
            await delay(ms);
            break;
          }

          case "checkpoint":
            await session.checkpoint();
            break;

          case "resume":
            await session.resume();
            break;
        }

        stepsCompleted++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push({
          stepIndex: i,
          expected: step.detail,
          actual: null,
          message: `Step ${i} threw: ${message}`,
        });
        stepsCompleted++;
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      name: spec.name,
      passed: failures.length === 0,
      stepsCompleted,
      stepsTotal: spec.steps.length,
      failures,
      durationMs,
    };
  }
}

/** Simple structural deep equality check. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);

    if (aKeys.length !== bKeys.length) return false;

    for (const key of aKeys) {
      if (!deepEqual(aObj[key], bObj[key])) return false;
    }
    return true;
  }

  return false;
}

/** Promise-based delay. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

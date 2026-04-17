/**
 * @nano-agent/eval-observability — Scenario DSL types.
 *
 * Defines the data shapes for scripted session testing scenarios.
 * A scenario is a sequence of steps (send, expect, wait, checkpoint, resume)
 * that can be executed against a session to verify behavior.
 */

/** A single step in a scenario script. */
export interface ScenarioStep {
  readonly action: "send" | "expect" | "wait" | "checkpoint" | "resume";
  readonly detail: unknown;
}

/**
 * A named scenario specification consisting of ordered steps.
 * The name is used for identification in test reports.
 */
export interface ScenarioSpec {
  readonly name: string;
  readonly description?: string;
  readonly steps: ScenarioStep[];
}

/** Describes a single step failure within a scenario run. */
export interface StepFailure {
  readonly stepIndex: number;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly message: string;
}

/**
 * The result of executing a scenario against a session.
 * Reports pass/fail status, completion progress, individual step
 * failures, and total duration.
 */
export interface ScenarioResult {
  readonly name: string;
  readonly passed: boolean;
  readonly stepsCompleted: number;
  readonly stepsTotal: number;
  readonly failures: StepFailure[];
  readonly durationMs: number;
}

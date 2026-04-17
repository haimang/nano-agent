/**
 * Tests for ScenarioRunner and Scenario DSL types.
 */

import { describe, it, expect, vi } from "vitest";
import { ScenarioRunner } from "../src/runner.js";
import type { ScenarioSession } from "../src/runner.js";
import type { ScenarioSpec } from "../src/scenario.js";

/** Create a mock session with configurable receive responses. */
function createMockSession(
  receiveQueue: unknown[] = [],
): ScenarioSession & {
  sentMessages: unknown[];
  checkpointCalls: number;
  resumeCalls: number;
} {
  const sentMessages: unknown[] = [];
  let receiveIndex = 0;
  let checkpointCalls = 0;
  let resumeCalls = 0;

  return {
    sentMessages,
    get checkpointCalls() {
      return checkpointCalls;
    },
    get resumeCalls() {
      return resumeCalls;
    },
    async send(message: unknown) {
      sentMessages.push(message);
    },
    async receive(): Promise<unknown> {
      if (receiveIndex < receiveQueue.length) {
        return receiveQueue[receiveIndex++];
      }
      return undefined;
    },
    async checkpoint() {
      checkpointCalls++;
    },
    async resume() {
      resumeCalls++;
    },
  };
}

describe("ScenarioRunner", () => {
  const runner = new ScenarioRunner();

  it("runs a simple send/expect scenario that passes", async () => {
    const spec: ScenarioSpec = {
      name: "echo test",
      steps: [
        { action: "send", detail: "hello" },
        { action: "expect", detail: "hello back" },
      ],
    };

    const session = createMockSession(["hello back"]);
    const result = await runner.run(spec, session);

    expect(result.name).toBe("echo test");
    expect(result.passed).toBe(true);
    expect(result.stepsCompleted).toBe(2);
    expect(result.stepsTotal).toBe(2);
    expect(result.failures).toEqual([]);
    expect(session.sentMessages).toEqual(["hello"]);
  });

  it("reports failure when expect does not match", async () => {
    const spec: ScenarioSpec = {
      name: "mismatch test",
      steps: [
        { action: "send", detail: "hello" },
        { action: "expect", detail: { status: "ok" } },
      ],
    };

    const session = createMockSession([{ status: "error" }]);
    const result = await runner.run(spec, session);

    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].stepIndex).toBe(1);
    expect(result.failures[0].expected).toEqual({ status: "ok" });
    expect(result.failures[0].actual).toEqual({ status: "error" });
    expect(result.stepsCompleted).toBe(2);
  });

  it("continues executing steps after a failure", async () => {
    const spec: ScenarioSpec = {
      name: "continue after failure",
      steps: [
        { action: "expect", detail: "wrong" },
        { action: "send", detail: "after-failure" },
      ],
    };

    const session = createMockSession(["actual"]);
    const result = await runner.run(spec, session);

    expect(result.passed).toBe(false);
    expect(result.stepsCompleted).toBe(2);
    expect(session.sentMessages).toEqual(["after-failure"]);
  });

  it("handles checkpoint and resume steps", async () => {
    const spec: ScenarioSpec = {
      name: "checkpoint test",
      steps: [
        { action: "checkpoint", detail: null },
        { action: "resume", detail: null },
        { action: "checkpoint", detail: null },
      ],
    };

    const session = createMockSession();
    const result = await runner.run(spec, session);

    expect(result.passed).toBe(true);
    expect(result.stepsCompleted).toBe(3);
    expect(session.checkpointCalls).toBe(2);
    expect(session.resumeCalls).toBe(1);
  });

  it("handles wait steps", async () => {
    const spec: ScenarioSpec = {
      name: "wait test",
      steps: [{ action: "wait", detail: 0 }],
    };

    const session = createMockSession();
    const result = await runner.run(spec, session);

    expect(result.passed).toBe(true);
    expect(result.stepsCompleted).toBe(1);
  });

  it("captures exceptions from session methods as failures", async () => {
    const spec: ScenarioSpec = {
      name: "error test",
      steps: [{ action: "send", detail: "boom" }],
    };

    const session: ScenarioSession = {
      async send() {
        throw new Error("connection lost");
      },
      async receive() {
        return undefined;
      },
      async checkpoint() {},
      async resume() {},
    };

    const result = await runner.run(spec, session);

    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].message).toContain("connection lost");
    expect(result.stepsCompleted).toBe(1);
  });

  it("reports durationMs", async () => {
    const spec: ScenarioSpec = {
      name: "timing test",
      steps: [{ action: "send", detail: "x" }],
    };

    const session = createMockSession();
    const result = await runner.run(spec, session);

    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("handles an empty scenario", async () => {
    const spec: ScenarioSpec = {
      name: "empty",
      steps: [],
    };

    const session = createMockSession();
    const result = await runner.run(spec, session);

    expect(result.passed).toBe(true);
    expect(result.stepsCompleted).toBe(0);
    expect(result.stepsTotal).toBe(0);
  });

  it("deep-compares objects in expect steps", async () => {
    const spec: ScenarioSpec = {
      name: "deep equal test",
      steps: [
        { action: "expect", detail: { a: 1, b: { c: 2 } } },
      ],
    };

    const session = createMockSession([{ a: 1, b: { c: 2 } }]);
    const result = await runner.run(spec, session);

    expect(result.passed).toBe(true);
  });
});

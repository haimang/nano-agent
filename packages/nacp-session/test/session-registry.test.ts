import { describe, it, expect } from "vitest";
import { SESSION_ROLE_REQUIREMENTS, assertSessionRoleAllowed, assertSessionPhaseAllowed, isSessionMessageAllowedInPhase } from "../src/session-registry.js";
import { NacpSessionError } from "../src/errors.js";

describe("SESSION_ROLE_REQUIREMENTS", () => {
  it("client can produce session.start", () => {
    expect(SESSION_ROLE_REQUIREMENTS.client.producer.has("session.start")).toBe(true);
  });
  it("client cannot produce session.end", () => {
    expect(SESSION_ROLE_REQUIREMENTS.client.producer.has("session.end")).toBe(false);
  });
  it("session can produce session.end", () => {
    expect(SESSION_ROLE_REQUIREMENTS.session.producer.has("session.end")).toBe(true);
  });
  it("session can produce session.stream.event", () => {
    expect(SESSION_ROLE_REQUIREMENTS.session.producer.has("session.stream.event")).toBe(true);
  });
});

describe("assertSessionRoleAllowed", () => {
  it("allows client to produce session.start", () => {
    expect(() => assertSessionRoleAllowed("client", "session.start", "produce")).not.toThrow();
  });
  it("blocks client from producing session.end", () => {
    expect(() => assertSessionRoleAllowed("client", "session.end", "produce")).toThrow(NacpSessionError);
  });
  it("allows unknown roles to pass through", () => {
    expect(() => assertSessionRoleAllowed("unknown-future-role", "session.start", "produce")).not.toThrow();
  });
});

describe("session phase gate", () => {
  it("session.start allowed in unattached", () => {
    expect(isSessionMessageAllowedInPhase("unattached", "session.start")).toBe(true);
  });
  it("session.start blocked in turn_running", () => {
    expect(isSessionMessageAllowedInPhase("turn_running", "session.start")).toBe(false);
  });
  it("session.cancel allowed in turn_running", () => {
    expect(isSessionMessageAllowedInPhase("turn_running", "session.cancel")).toBe(true);
  });
  it("non-session message returns false", () => {
    expect(isSessionMessageAllowedInPhase("attached", "tool.call.request")).toBe(false);
  });
  it("assertSessionPhaseAllowed throws on illegal transition", () => {
    expect(() => assertSessionPhaseAllowed("ended", "session.start")).toThrow(NacpSessionError);
  });

  // Phase 0 widened surface coverage (Q1 + Q8)
  it("session.followup_input allowed in attached", () => {
    expect(isSessionMessageAllowedInPhase("attached", "session.followup_input")).toBe(true);
  });
  it("session.followup_input allowed in turn_running", () => {
    expect(isSessionMessageAllowedInPhase("turn_running", "session.followup_input")).toBe(true);
  });
  it("session.followup_input blocked in unattached", () => {
    expect(isSessionMessageAllowedInPhase("unattached", "session.followup_input")).toBe(false);
  });
  it("session.followup_input blocked in ended", () => {
    expect(isSessionMessageAllowedInPhase("ended", "session.followup_input")).toBe(false);
  });
  it("client is allowed to produce session.followup_input", () => {
    expect(SESSION_ROLE_REQUIREMENTS.client.producer.has("session.followup_input")).toBe(true);
    expect(() => assertSessionRoleAllowed("client", "session.followup_input", "produce")).not.toThrow();
  });
  it("session role does not produce session.followup_input", () => {
    expect(SESSION_ROLE_REQUIREMENTS.session.producer.has("session.followup_input")).toBe(false);
  });
});

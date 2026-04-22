import { describe, expect, it } from "vitest";
import {
  CROSS_SEAM_HEADERS,
  buildCrossSeamHeaders,
  readCrossSeamHeaders,
  validateCrossSeamAnchor,
  type CrossSeamAnchor,
} from "../../src/transport/cross-seam.js";

const ANCHOR: CrossSeamAnchor = {
  traceUuid: "11111111-1111-4111-8111-111111111111",
  sessionUuid: "22222222-2222-4222-8222-222222222222",
  teamUuid: "team-x",
  requestUuid: "33333333-3333-4333-8333-333333333333",
  sourceRole: "session",
  sourceKey: "nano-agent.session.do@v1",
  deadlineMs: 5000,
};

describe("cross-seam propagation truth", () => {
  it("round-trips every anchor field through headers", () => {
    const headers = buildCrossSeamHeaders(ANCHOR);
    expect(headers[CROSS_SEAM_HEADERS.trace]).toBe(ANCHOR.traceUuid);
    expect(headers[CROSS_SEAM_HEADERS.session]).toBe(ANCHOR.sessionUuid);
    expect(headers[CROSS_SEAM_HEADERS.team]).toBe(ANCHOR.teamUuid);
    expect(headers[CROSS_SEAM_HEADERS.request]).toBe(ANCHOR.requestUuid);
    expect(headers[CROSS_SEAM_HEADERS.sourceRole]).toBe(ANCHOR.sourceRole);
    expect(headers[CROSS_SEAM_HEADERS.deadline]).toBe("5000");

    const recovered = readCrossSeamHeaders(new Headers(headers));
    expect(recovered.traceUuid).toBe(ANCHOR.traceUuid);
    expect(recovered.requestUuid).toBe(ANCHOR.requestUuid);
    expect(recovered.deadlineMs).toBe(5000);
  });

  it("reports each missing required field", () => {
    expect(validateCrossSeamAnchor({ traceUuid: ANCHOR.traceUuid })).toEqual([
      "sessionUuid",
      "teamUuid",
      "requestUuid",
    ]);
  });
});

import type {
  CancelBody,
  CloseBody,
  DeleteSessionBody,
  FollowupBody,
  StartSessionBody,
  TitlePatchBody,
  VerifyBody,
} from "../../session-lifecycle.js";
import { handleInput } from "./input.js";
import { handleStart } from "./start.js";
import type { UserDoSessionFlowContext } from "./types.js";
import { handleCancel, handleClose, handleDelete, handleTitle } from "./lifecycle.js";
import { hydrateSessionFromDurableTruth, requireReadableSession } from "./hydrate.js";
import { handleRead, handleVerify } from "./verify-read.js";

export function createUserDoSessionFlow(ctx: UserDoSessionFlowContext) {
  return {
    async hydrateSessionFromDurableTruth(sessionUuid: string) {
      return hydrateSessionFromDurableTruth(ctx, sessionUuid);
    },

    async requireReadableSession(sessionUuid: string) {
      return requireReadableSession(ctx, sessionUuid);
    },

    async handleStart(sessionUuid: string, body: StartSessionBody): Promise<Response> {
      return handleStart(ctx, sessionUuid, body);
    },

    async handleInput(sessionUuid: string, body: FollowupBody): Promise<Response> {
      return handleInput(ctx, sessionUuid, body);
    },

    async handleCancel(sessionUuid: string, body: CancelBody): Promise<Response> {
      return handleCancel(ctx, sessionUuid, body);
    },

    async handleClose(sessionUuid: string, body: CloseBody): Promise<Response> {
      return handleClose(ctx, sessionUuid, body);
    },

    async handleDelete(sessionUuid: string, body: DeleteSessionBody): Promise<Response> {
      return handleDelete(ctx, sessionUuid, body);
    },

    async handleTitle(sessionUuid: string, body: TitlePatchBody): Promise<Response> {
      return handleTitle(ctx, sessionUuid, body);
    },

    async handleVerify(sessionUuid: string, body: VerifyBody): Promise<Response> {
      return handleVerify(ctx, sessionUuid, body);
    },

    async handleRead(
      sessionUuid: string,
      action: "status" | "timeline" | "history",
    ): Promise<Response> {
      return handleRead(ctx, sessionUuid, action);
    },
  };
}

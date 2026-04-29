export const NANO_SESSION_DO_CANONICAL_SYSTEM_NOTIFY_MARKER = {
  kind: "system.notify",
} as const;

export {
  NanoSessionDO,
  type DurableObjectStateLike,
} from "./session-do-runtime.js";

import {
  NACP_CORE_TYPE_DIRECTION_MATRIX,
  NACP_VERSION,
  validateEnvelope,
} from "@haimang/nacp-core";
import {
  NACP_SESSION_VERSION,
  validateSessionFrame,
} from "@haimang/nacp-session";

if (typeof validateEnvelope !== "function") {
  throw new Error("validateEnvelope export is unavailable");
}

if (typeof validateSessionFrame !== "function") {
  throw new Error("validateSessionFrame export is unavailable");
}

console.log(
  JSON.stringify(
    {
      nacpCoreVersion: NACP_VERSION,
      nacpSessionVersion: NACP_SESSION_VERSION,
      coreTypeCount: Object.keys(NACP_CORE_TYPE_DIRECTION_MATRIX).length,
    },
    null,
    2,
  ),
);

export { verifyTenantBoundary } from "./boundary.js";
export type { TenantBoundaryContext } from "./boundary.js";

export {
  tenantR2Put,
  tenantR2Get,
  tenantR2Head,
  tenantR2List,
  tenantR2Delete,
  tenantKvGet,
  tenantKvPut,
  tenantKvDelete,
  tenantDoStorageGet,
  tenantDoStoragePut,
  tenantDoStorageDelete,
} from "./scoped-io.js";
export type {
  R2BucketLike,
  KVNamespaceLike,
  DoStorageLike,
} from "./scoped-io.js";

export {
  createDelegationSignature,
  verifyDelegationSignature,
} from "./delegation.js";

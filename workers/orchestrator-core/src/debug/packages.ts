import type { NanoPackageManifest } from "../generated/package-manifest.js";

const REGISTRY_URL = "https://npm.pkg.github.com";
const CACHE_TTL_MS = 10_000;

interface PackageDebugEnv {
  readonly NODE_AUTH_TOKEN?: string;
  readonly GITHUB_TOKEN?: string;
}

interface RegistryPackageState {
  readonly name: string;
  readonly status: "ok" | "auth-not-available-in-runtime" | "http-error" | "fetch-error" | "invalid-json";
  readonly registry_latest_version: string | null;
  readonly registry_version: string | null;
  readonly registry_published_at: string | null;
  readonly checked_at: string;
  readonly http_status?: number;
  readonly error?: string;
}

interface CacheEntry {
  readonly expires_at: number;
  readonly cache_key: string;
  readonly value: readonly RegistryPackageState[];
}

let registryCache: CacheEntry | null = null;

function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const stripped = v.split("-")[0]?.split("+")[0] ?? v;
    return stripped.split(".").map((n) => Number.parseInt(n, 10) || 0);
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function packageUrl(name: string): string {
  const shortName = name.startsWith("@haimang/") ? name.slice("@haimang/".length) : name;
  return `${REGISTRY_URL}/@haimang%2F${shortName}`;
}

async function fetchRegistryPackage(
  pkg: NanoPackageManifest["packages"][number],
  env: PackageDebugEnv,
): Promise<RegistryPackageState> {
  const checkedAt = new Date().toISOString();
  const token = env.NODE_AUTH_TOKEN ?? env.GITHUB_TOKEN;
  if (!token) {
    return {
      name: pkg.name,
      status: "auth-not-available-in-runtime",
      registry_latest_version: null,
      registry_version: null,
      registry_published_at: null,
      checked_at: checkedAt,
    };
  }
  let response: Response;
  try {
    response = await fetch(packageUrl(pkg.name), {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
    });
  } catch (error) {
    return {
      name: pkg.name,
      status: "fetch-error",
      registry_latest_version: null,
      registry_version: null,
      registry_published_at: null,
      checked_at: checkedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (!response.ok) {
    return {
      name: pkg.name,
      status: "http-error",
      registry_latest_version: null,
      registry_version: null,
      registry_published_at: null,
      checked_at: checkedAt,
      http_status: response.status,
    };
  }
  let meta: Record<string, unknown>;
  try {
    meta = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    return {
      name: pkg.name,
      status: "invalid-json",
      registry_latest_version: null,
      registry_version: null,
      registry_published_at: null,
      checked_at: checkedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const distTags = meta["dist-tags"] as Record<string, unknown> | undefined;
  const latest = typeof distTags?.latest === "string" ? distTags.latest : null;
  const versions = meta.versions && typeof meta.versions === "object"
    ? (meta.versions as Record<string, unknown>)
    : {};
  const time = meta.time && typeof meta.time === "object"
    ? (meta.time as Record<string, unknown>)
    : {};
  const workspaceVersion = pkg.workspace_version;
  return {
    name: pkg.name,
    status: "ok",
    registry_latest_version: latest,
    registry_version: Object.prototype.hasOwnProperty.call(versions, workspaceVersion)
      ? workspaceVersion
      : null,
    registry_published_at: typeof time[workspaceVersion] === "string" ? time[workspaceVersion] : null,
    checked_at: checkedAt,
  };
}

export async function buildDebugPackagesResponse(
  manifest: NanoPackageManifest,
  env: PackageDebugEnv,
): Promise<Record<string, unknown>> {
  const now = Date.now();
  const cacheKey = env.NODE_AUTH_TOKEN || env.GITHUB_TOKEN ? "registry-auth" : "registry-no-auth";
  let registry = registryCache?.cache_key === cacheKey && registryCache.expires_at > now
    ? registryCache.value
    : null;
  if (!registry) {
    registry = await Promise.all(manifest.packages.map((pkg) => fetchRegistryPackage(pkg, env)));
    registryCache = { value: registry, expires_at: now + CACHE_TTL_MS, cache_key: cacheKey };
  }
  const registryByName = new Map(registry.map((pkg) => [pkg.name, pkg]));
  const drift = manifest.packages.map((pkg) => {
    const live = registryByName.get(pkg.name);
    const registryComparable = live?.status === "ok";
    const driftFlag = registryComparable
      ? live?.registry_version !== pkg.workspace_version ||
        live?.registry_latest_version !== pkg.workspace_version
      : false;
    // RHX2 review-of-reviews fix (DeepSeek R7): annotate which side moved
    // so an oncall reading `/debug/packages` doesn't have to compare three
    // version columns by eye.
    let driftDirection:
      | "aligned"
      | "workspace_ahead"
      | "workspace_behind"
      | "workspace_not_published"
      | "registry_unreachable" = "aligned";
    if (!registryComparable) {
      driftDirection = "registry_unreachable";
    } else if (!driftFlag) {
      driftDirection = "aligned";
    } else if (live?.registry_version === null) {
      driftDirection = "workspace_not_published";
    } else if (
      live?.registry_latest_version &&
      live.registry_latest_version !== pkg.workspace_version
    ) {
      driftDirection =
        compareSemver(pkg.workspace_version, live.registry_latest_version) > 0
          ? "workspace_ahead"
          : "workspace_behind";
    } else {
      driftDirection = "workspace_ahead";
    }
    return {
      name: pkg.name,
      workspace_version: pkg.workspace_version,
      deployed_registry_version: pkg.registry_version,
      live_registry_version: live?.registry_version ?? null,
      live_latest_version: live?.registry_latest_version ?? null,
      registry_status: live?.status ?? "fetch-error",
      drift: driftFlag,
      drift_direction: driftDirection,
    };
  });
  return {
    deployed: manifest,
    registry,
    drift,
    drift_detected: drift.some((entry) => entry.drift),
    cache_ttl_ms: CACHE_TTL_MS,
  };
}

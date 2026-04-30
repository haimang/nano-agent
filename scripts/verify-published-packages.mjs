#!/usr/bin/env node
/**
 * RHX2 P1-08 — published-packages source-of-truth gate.
 *
 * Owner立场 (RHX2 design v0.5 §3.7 / Q-Obs13):
 *   "我们仅能依靠一个唯一真相: 要么是线上 package, 要么是本库内 package.
 *    不能存在任何模糊空间."
 *
 * Run as a `predeploy` step on every nano-agent worker. For each of the
 * three published packages:
 *   1. Read `packages/<basename>/package.json` to get the workspace
 *      version (workspace truth).
 *   2. GET https://npm.pkg.github.com/@haimang%2F<basename> — read the
 *      `versions` map (registry truth).
 *   3. Verify workspace-version exists in the registry **and matches
 *      registry latest**. Otherwise fail with a precise actionable
 *      message and exit non-zero.
 *
 * Failure modes that BLOCK deploy:
 *   - registry returns 404                       → package never published
 *   - registry HTTP error (after retries)        → cannot prove truth
 *   - workspace version not in registry versions → published version drifted
 *   - workspace version !== registry latest      → workspace/install drifted
 *
 * Soft outputs (printed to stderr only, do not block by default):
 *   - workspace dist SHA256          — recorded into manifest for RHX2/RHX3
 *                                      drift investigation
 *
 * Side effects: writes
 * `<repo>/.nano-agent/package-manifest.json` so the build-time
 * injector (P1-09) can pick it up. The file is .gitignored.
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SELF_DIR, "..");

const REGISTRY = "https://npm.pkg.github.com";
const SCOPE = "@haimang";

/** The single source of truth for "which packages must be published". */
const PUBLISHED_PACKAGES = ["nacp-core", "nacp-session", "jwt-shared"];

function log(level, msg) {
  const prefix = level === "ERR" ? "[31m[verify-published-packages][ERR][0m" : `[verify-published-packages][${level}]`;
  process.stderr.write(`${prefix} ${msg}\n`);
}

async function fetchRegistry(name, attempt = 1) {
  const url = `${REGISTRY}/${SCOPE}%2F${name}`;
  const headers = { Accept: "application/json" };
  const token = process.env.NODE_AUTH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    if (attempt < 3) {
      log("WARN", `${name}: fetch error (attempt ${attempt}): ${err?.message ?? err}; retrying`);
      await new Promise((r) => setTimeout(r, 500 * attempt));
      return fetchRegistry(name, attempt + 1);
    }
    throw err;
  }

  if (res.status === 503 && attempt < 3) {
    log("WARN", `${name}: registry 503 (attempt ${attempt}); retrying`);
    await new Promise((r) => setTimeout(r, 500 * attempt));
    return fetchRegistry(name, attempt + 1);
  }

  return res;
}

function readWorkspaceVersion(name) {
  const path = resolve(REPO_ROOT, "packages", name, "package.json");
  const text = readFileSync(path, "utf8");
  const json = JSON.parse(text);
  if (!json.version || typeof json.version !== "string") {
    throw new Error(`${name}: package.json has no .version`);
  }
  return json.version;
}

function hashDistDir(name) {
  const dir = resolve(REPO_ROOT, "packages", name, "dist");
  if (!existsSync(dir)) return null;

  const hash = createHash("sha256");
  const files = [];
  function walk(d) {
    for (const ent of readdirSync(d).sort()) {
      const full = resolve(d, ent);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else files.push(full);
    }
  }
  walk(dir);
  for (const f of files.sort()) {
    hash.update(f.slice(dir.length));
    hash.update(readFileSync(f));
  }
  return hash.digest("hex");
}

async function verifyOne(name) {
  const workspaceVersion = readWorkspaceVersion(name);
  const distSha256 = hashDistDir(name);

  const res = await fetchRegistry(name);
  if (res.status === 404) {
    throw Object.assign(
      new Error(
        `${SCOPE}/${name}: registry returned 404 — package has never been published.\n` +
          `        Run 'pnpm --filter ${SCOPE}/${name} run build && (cd packages/${name} && npm publish)'\n` +
          `        BEFORE deploying any worker that consumes this package.`,
      ),
      { code: "NEVER_PUBLISHED", pkg: name },
    );
  }
  if (!res.ok) {
    throw new Error(`${SCOPE}/${name}: registry HTTP ${res.status} ${res.statusText}`);
  }
  const meta = await res.json();
  const versions = Object.keys(meta.versions ?? {});
  const latest = (meta["dist-tags"] && meta["dist-tags"].latest) ?? versions[versions.length - 1];
  const publishedAt = meta.time?.[workspaceVersion];

  if (!versions.includes(workspaceVersion)) {
    throw Object.assign(
      new Error(
        `${SCOPE}/${name}: workspace version ${workspaceVersion} is NOT in the registry.\n` +
          `        Registry latest: ${latest}\n` +
          `        Available versions: ${versions.join(", ")}\n` +
          `        Either bump the workspace package.json to the latest registry version,\n` +
          `        or 'npm publish' the workspace version. Deploy is BLOCKED until match.`,
      ),
      { code: "WORKSPACE_REGISTRY_DRIFT", pkg: name, workspaceVersion, latest },
    );
  }

  if (latest !== workspaceVersion) {
    throw Object.assign(
      new Error(
        `${SCOPE}/${name}: workspace version ${workspaceVersion} is published, but registry latest is ${latest}.\n` +
          `        RHX2 package-truth gate does not allow stale workspace installs.\n` +
          `        Either publish ${workspaceVersion} as the new latest, or align the workspace package.json / install graph to ${latest}.`,
      ),
      { code: "WORKSPACE_NOT_LATEST", pkg: name, workspaceVersion, latest },
    );
  }

  return {
    name: `${SCOPE}/${name}`,
    workspace_version: workspaceVersion,
    registry_version: workspaceVersion,
    registry_latest_version: latest,
    registry_published_at: publishedAt,
    dist_sha256: distSha256,
    resolved_from: "registry",
    match: true,
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  log("INFO", `verifying ${PUBLISHED_PACKAGES.length} published packages against ${REGISTRY}`);

  const results = [];
  let blocked = false;

  for (const name of PUBLISHED_PACKAGES) {
    try {
      const r = await verifyOne(name);
      results.push(r);
      log(
        "OK",
        `${r.name}: workspace=${r.workspace_version} ≡ registry; latest=${r.registry_latest_version}`,
      );
    } catch (err) {
      blocked = true;
      log("ERR", err.message);
    }
  }

  if (blocked) {
    log("ERR", "Aborting: package source-of-truth gate failed. See messages above.");
    process.exit(1);
  }

  // Persist manifest so build-time injection (P1-09) can pick it up.
  const manifestDir = resolve(REPO_ROOT, ".nano-agent");
  mkdirSync(manifestDir, { recursive: true });
  const manifest = { build_at: startedAt, packages: results };
  writeFileSync(
    resolve(manifestDir, "package-manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  log("INFO", `manifest written to .nano-agent/package-manifest.json`);
}

main().catch((err) => {
  log("ERR", err?.stack ?? String(err));
  process.exit(1);
});

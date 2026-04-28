import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const PKG = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

test("ZX3 post-cutover root test scripts pin canonical test/ tree", () => {
  // After ZX3 Phase 4-5 cutover: test:contracts points to test/root-guardians/
  // not the deleted test-legacy/ tree.
  assert.equal(
    PKG.scripts["test:contracts"],
    "node --test test/root-guardians/*.test.mjs",
  );
  assert.equal(
    PKG.scripts["test:e2e"],
    "node --test test/package-e2e/**/*.test.mjs test/cross-e2e/**/*.test.mjs",
  );
  assert.equal(
    PKG.scripts["test:cross"],
    "node --test test/package-e2e/**/*.test.mjs test/cross-e2e/**/*.test.mjs",
  );
  assert.equal(
    PKG.scripts["test:package-e2e"],
    "node --test test/package-e2e/**/*.test.mjs",
  );
  assert.equal(
    PKG.scripts["test:cross-e2e"],
    "node --test test/cross-e2e/**/*.test.mjs",
  );
});

test("test:legacy:* scripts have been removed after ZX3 P5-01", () => {
  // ZX3 deleted test-legacy/ entirely; legacy script aliases should not exist.
  assert.equal(
    PKG.scripts["test:legacy:contracts"],
    undefined,
    "test:legacy:contracts should be removed after ZX3 cutover",
  );
  assert.equal(
    PKG.scripts["test:legacy:e2e"],
    undefined,
    "test:legacy:e2e should be removed after ZX3 cutover",
  );
  assert.equal(
    PKG.scripts["test:legacy:cross"],
    undefined,
    "test:legacy:cross should be removed after ZX3 cutover",
  );
});

test("canonical test/ tree carries 4 layers: shared / root-guardians / package-e2e / cross-e2e", () => {
  const layers = readdirSync(new URL("../", import.meta.url), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(layers, [
    "cross-e2e",
    "package-e2e",
    "root-guardians",
    "shared",
  ]);
});

test("root-guardians carries surviving cross-cutting contract tests", () => {
  const guardians = readdirSync(new URL("./", import.meta.url)).filter((name) =>
    name.endsWith(".test.mjs"),
  );
  assert.ok(
    guardians.length >= 5,
    `expected at least 5 root guardians, got ${guardians.length}`,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const PKG = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("root test scripts pin legacy contracts and new live e2e/cross cutover", () => {
  assert.equal(PKG.scripts["test:contracts"], "node --test test-legacy/*.test.mjs");
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

test("legacy test tree still carries both contract and e2e suites", () => {
  const rootTests = readdirSync(new URL("./", import.meta.url)).filter((name) =>
    name.endsWith(".test.mjs"),
  );
  const e2eTests = readdirSync(new URL("./e2e/", import.meta.url)).filter((name) =>
    name.endsWith(".test.mjs"),
  );

  assert.ok(rootTests.length >= 1, "expected at least one root contract test");
  assert.ok(e2eTests.length >= 1, "expected at least one root e2e test");
});

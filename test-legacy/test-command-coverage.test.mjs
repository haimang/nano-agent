import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const PKG = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("root test scripts pin the after-skeleton contracts/e2e/cross split", () => {
  assert.equal(PKG.scripts["test:contracts"], "node --test test/*.test.mjs");
  assert.equal(PKG.scripts["test:e2e"], "node --test test/e2e/*.test.mjs");
  assert.equal(
    PKG.scripts["test:cross"],
    "node --test test/*.test.mjs test/e2e/*.test.mjs",
  );
});

test("root test tree still carries both contract and e2e suites", () => {
  const rootTests = readdirSync(new URL("./", import.meta.url)).filter((name) =>
    name.endsWith(".test.mjs"),
  );
  const e2eTests = readdirSync(new URL("./e2e/", import.meta.url)).filter((name) =>
    name.endsWith(".test.mjs"),
  );

  assert.ok(rootTests.length >= 1, "expected at least one root contract test");
  assert.ok(e2eTests.length >= 1, "expected at least one root e2e test");
});

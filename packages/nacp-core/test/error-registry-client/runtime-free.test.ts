import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(TEST_DIR, "..", "..");

describe("error-codes-client runtime-free contract", () => {
  it("source data table does not runtime-import the server registry", () => {
    const source = readFileSync(
      resolve(PACKAGE_ROOT, "src/error-registry-client/data.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/from\s+["']\.\.\/error-registry\.js["']/);
    expect(source).not.toMatch(/import\s+\{\s*listErrorMetas/);
  });

  it("built client data module does not reference ../error-registry.js", () => {
    const built = readFileSync(
      resolve(PACKAGE_ROOT, "dist/error-registry-client/data.js"),
      "utf8",
    );
    expect(built).not.toMatch(/from\s+["']\.\.\/error-registry\.js["']/);
    expect(built).not.toContain("listErrorMetas(");
  });
});

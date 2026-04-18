/**
 * Minimal ambient shim for Node-only globals used by the scripts
 * (trace-substrate-benchmark / export-schema / gen-trace-doc). Added
 * for the A2-A3 review R3 scripts typecheck; we don't pull in full
 * `@types/node` because the runtime package does not otherwise depend
 * on Node types.
 */

// eslint-disable-next-line @typescript-eslint/no-empty-interface
declare module "node:fs" {
  export function writeFileSync(
    path: string,
    data: string,
    options?: unknown,
  ): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
}

declare module "node:perf_hooks" {
  export const performance: { now(): number };
}

declare module "node:path" {
  export function dirname(p: string): string;
  export function join(...segments: string[]): string;
  export function resolve(...segments: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare const process: {
  argv: readonly string[];
  exit(code?: number): never;
  exitCode?: number;
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
};

declare const Buffer: {
  byteLength(input: string, encoding?: string): number;
  from(input: string): { length: number };
};

/**
 * Text-Processing Capability Handlers (B3 — After-Foundations Phase 2).
 *
 * Hosts the 9 text/JSON commands ported from the just-bash inventory:
 *   - Wave 1: `wc / head / tail / jq / sed / awk`
 *   - Wave 2: `sort / uniq / diff`
 *
 * The implementations are written from scratch (per `docs/design/after-foundations/P2-fake-bash-extension-policy.md`
 * §3.3 — borrow algorithms, do NOT import `context/just-bash`). They are
 * deliberately a **worker-safe subset**: file/path-first, no shell features
 * (pipes/redirects/heredoc/stdin), no flags via bash argv. Richer options
 * are only accessible via the structured tool-call shape.
 *
 * Source findings (B1 round 1):
 *   - F07 (`docs/spikes/spike-do-storage/07-…`): existing 12-pack handler
 *     contracts hold; safe to extend without touching them.
 *
 * All handlers share a UTF-8 byte cap (`TEXT_OUTPUT_MAX_BYTES = 64 KiB`)
 * with a deterministic `text-output-truncated` marker so isolate memory
 * cannot be drowned by `sort`/`uniq`/`diff`/`jq` outputs.
 *
 * Path law (`/_platform/**` reserved, workspace-root escape rejection)
 * is consumed via `resolveWorkspacePath` from `workspace-truth.ts` — the
 * same single source of truth `filesystem.ts` and `search.ts` use, so
 * the three surfaces never disagree about what a path means.
 */

import type { LocalCapabilityHandler } from "../targets/local-ts.js";
import {
  DEFAULT_WORKSPACE_ROOT,
  resolveWorkspacePath,
  type WorkspaceFsLike,
} from "./workspace-truth.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Shared caps and disclosure markers
// ═══════════════════════════════════════════════════════════════════

/** Hard upper bound for any single text-processing handler output. */
export const TEXT_OUTPUT_MAX_BYTES = 64 * 1024;

/** Disclosure marker appended when text output is truncated. */
export const TEXT_OUTPUT_TRUNCATED_NOTE = "text-output-truncated";

/** Disclosure marker for unsupported `sed` script forms. */
export const SED_UNSUPPORTED_NOTE = "sed-unsupported-script-form";

/** Disclosure marker for unsupported `awk` program forms. */
export const AWK_UNSUPPORTED_NOTE = "awk-unsupported-program-form";

/** Disclosure marker for unsupported `jq` query forms. */
export const JQ_UNSUPPORTED_NOTE = "jq-unsupported-query-form";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8");

/**
 * Truncate a text body so its UTF-8 encoded byte length fits within
 * `cap`, walking back to a code-point boundary. Returns the original
 * body untouched when it already fits. Same algorithm as the curl
 * handler's `truncateBody`, kept self-contained here so text-processing
 * does not couple to network details.
 */
function applyOutputCap(text: string): { body: string; truncated: boolean } {
  const encoded = TEXT_ENCODER.encode(text);
  if (encoded.byteLength <= TEXT_OUTPUT_MAX_BYTES) {
    return { body: text, truncated: false };
  }
  let end = TEXT_OUTPUT_MAX_BYTES;
  while (end > 0 && (encoded[end]! & 0xc0) === 0x80) {
    end -= 1;
  }
  return {
    body: TEXT_DECODER.decode(encoded.slice(0, end)),
    truncated: true,
  };
}

function withCap(body: string): { output: string } {
  const { body: capped, truncated } = applyOutputCap(body);
  if (!truncated) return { output: capped };
  return {
    output: `${capped}\n[${TEXT_OUTPUT_TRUNCATED_NOTE}: output capped at ${TEXT_OUTPUT_MAX_BYTES} bytes]`,
  };
}

// ═══════════════════════════════════════════════════════════════════
// §2 — Config + handler factory shape (mirrors filesystem.ts)
// ═══════════════════════════════════════════════════════════════════

interface TextProcessingHandlersConfig {
  workspacePath?: string;
  namespace?: WorkspaceFsLike;
}

function isTextProcessingHandlersConfig(
  value: unknown,
): value is TextProcessingHandlersConfig {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (
    "workspacePath" in candidate &&
    candidate.workspacePath !== undefined &&
    typeof candidate.workspacePath !== "string"
  ) {
    return false;
  }
  if (!("namespace" in candidate) || candidate.namespace === undefined) {
    return true;
  }
  if (!candidate.namespace || typeof candidate.namespace !== "object") {
    return false;
  }
  const ns = candidate.namespace as Record<string, unknown>;
  return (
    typeof ns.readFile === "function" &&
    typeof ns.writeFile === "function" &&
    typeof ns.listDir === "function" &&
    typeof ns.deleteFile === "function"
  );
}

// ═══════════════════════════════════════════════════════════════════
// §3 — Shared file-read helpers
// ═══════════════════════════════════════════════════════════════════

function resolveOrThrow(prefix: string, base: string, raw: string): string {
  const result = resolveWorkspacePath(base, raw);
  if (result.ok) return result.path;
  if (result.error?.reason === "reserved-namespace") {
    throw new Error(
      `${prefix}: path '${result.error.path}' is in the reserved /_platform namespace`,
    );
  }
  throw new Error(`${prefix}: path '${raw}' escapes the workspace root`);
}

async function readFileOrThrow(
  workspace: WorkspaceFsLike,
  prefix: string,
  resolved: string,
): Promise<string> {
  const content = await workspace.readFile(resolved);
  if (content === null) {
    throw new Error(`${prefix}: ${resolved}: No such file`);
  }
  return content;
}

// ═══════════════════════════════════════════════════════════════════
// §4 — Input shapes
// ═══════════════════════════════════════════════════════════════════

interface PathInput {
  path?: string;
}

interface HeadTailInput {
  path?: string;
  lines?: number;
  bytes?: number;
}

interface JqInput {
  query?: string;
  path?: string;
}

interface SedInput {
  expression?: string;
  path?: string;
}

interface AwkInput {
  program?: string;
  path?: string;
}

interface SortInput {
  path?: string;
  reverse?: boolean;
  numeric?: boolean;
  unique?: boolean;
}

interface UniqInput {
  path?: string;
  count?: boolean;
}

interface DiffInput {
  left?: string;
  right?: string;
}

// ═══════════════════════════════════════════════════════════════════
// §5 — Wave 1 commands: wc / head / tail / jq / sed / awk
// ═══════════════════════════════════════════════════════════════════

function countWcStats(content: string): {
  lines: number;
  words: number;
  bytes: number;
} {
  const bytes = TEXT_ENCODER.encode(content).byteLength;
  // POSIX wc: `lines` = number of newline characters; matches `wc -l`.
  let lines = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) lines += 1;
  }
  const words = content.length === 0
    ? 0
    : content.split(/\s+/).filter((w) => w.length > 0).length;
  return { lines, words, bytes };
}

function headLines(content: string, n: number): string {
  if (n <= 0) return "";
  const lines = content.split("\n");
  // If the file ends with a newline, splitting yields a trailing "".
  // Drop it so `head -n 10` of a 10-line file does NOT add a blank.
  const hasTrailingNewline = content.endsWith("\n");
  const usable = hasTrailingNewline ? lines.slice(0, -1) : lines;
  const taken = usable.slice(0, n);
  if (taken.length === 0) return "";
  return taken.join("\n") + (taken.length < usable.length ? "" : hasTrailingNewline ? "\n" : "");
}

function headBytes(content: string, n: number): string {
  if (n <= 0) return "";
  const encoded = TEXT_ENCODER.encode(content);
  if (encoded.byteLength <= n) return content;
  let end = n;
  while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end -= 1;
  return TEXT_DECODER.decode(encoded.slice(0, end));
}

function tailLines(content: string, n: number): string {
  if (n <= 0) return "";
  const lines = content.split("\n");
  const hasTrailingNewline = content.endsWith("\n");
  const usable = hasTrailingNewline ? lines.slice(0, -1) : lines;
  if (usable.length === 0) return "";
  const taken = usable.slice(Math.max(0, usable.length - n));
  return taken.join("\n") + (hasTrailingNewline ? "\n" : "");
}

function tailBytes(content: string, n: number): string {
  if (n <= 0) return "";
  const encoded = TEXT_ENCODER.encode(content);
  if (encoded.byteLength <= n) return content;
  let start = encoded.byteLength - n;
  while (start < encoded.byteLength && (encoded[start]! & 0xc0) === 0x80) {
    start += 1;
  }
  return TEXT_DECODER.decode(encoded.slice(start));
}

/**
 * Worker-safe `jq` subset.
 *
 * Supported queries (file-first form `jq <query> <path>`):
 *   - `.`                   identity (returns the parsed JSON pretty-printed)
 *   - `.field`              object field access
 *   - `.field.sub`          nested field access (any depth)
 *   - `.array[N]`           array index (positive integer)
 *   - `.array[]`            iterate array → newline-separated values
 *   - `keys`                keys of the top-level object
 *   - `length`              length of array / string / object keys
 *
 * Anything else throws with marker `JQ_UNSUPPORTED_NOTE`. The intent
 * (per P2 design) is "covers the highest-frequency LLM-driven JSON
 * read paths"; richer query algebra is deliberately deferred — agents
 * that need full jq must be told `no` honestly rather than seeing a
 * silent partial answer.
 */
function applyJqQuery(query: string, parsed: unknown): unknown {
  const trimmed = query.trim();
  if (trimmed === "." || trimmed === "") return parsed;
  if (trimmed === "keys") {
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(
        `jq: 'keys' requires an object; got ${typeNameOf(parsed)} (${JQ_UNSUPPORTED_NOTE})`,
      );
    }
    return Object.keys(parsed as Record<string, unknown>).sort();
  }
  if (trimmed === "length") {
    if (Array.isArray(parsed)) return parsed.length;
    if (typeof parsed === "string") return parsed.length;
    if (parsed !== null && typeof parsed === "object") {
      return Object.keys(parsed as Record<string, unknown>).length;
    }
    throw new Error(
      `jq: 'length' not defined for ${typeNameOf(parsed)} (${JQ_UNSUPPORTED_NOTE})`,
    );
  }

  // Path query starting with `.`
  if (!trimmed.startsWith(".")) {
    throw new Error(
      `jq: query '${query}' is not supported (${JQ_UNSUPPORTED_NOTE}); the worker-safe subset accepts '.', '.field', '.array[N]', '.array[]', 'keys', 'length'.`,
    );
  }

  return walkJqPath(trimmed, parsed);
}

function walkJqPath(query: string, root: unknown): unknown {
  // Tokenise into segments: `.field`, `[N]`, `[]`.
  const segments = parseJqPath(query);
  let current: unknown = root;
  let iterating = false;
  let collected: unknown[] = [];

  const visit = (value: unknown, segs: typeof segments): void => {
    let cur = value;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]!;
      if (seg.kind === "field") {
        const fieldName = seg.name ?? "";
        if (cur === null || typeof cur !== "object" || Array.isArray(cur)) {
          throw new Error(
            `jq: cannot access field '${fieldName}' on ${typeNameOf(cur)} (${JQ_UNSUPPORTED_NOTE})`,
          );
        }
        cur = (cur as Record<string, unknown>)[fieldName];
      } else if (seg.kind === "index") {
        if (!Array.isArray(cur)) {
          throw new Error(
            `jq: cannot index non-array (${typeNameOf(cur)}) (${JQ_UNSUPPORTED_NOTE})`,
          );
        }
        cur = cur[seg.index ?? 0];
      } else {
        // iterate
        if (!Array.isArray(cur)) {
          throw new Error(
            `jq: cannot iterate non-array (${typeNameOf(cur)}) (${JQ_UNSUPPORTED_NOTE})`,
          );
        }
        for (const item of cur) {
          visit(item, segs.slice(i + 1));
        }
        iterating = true;
        return;
      }
    }
    collected.push(cur);
  };

  visit(current, segments);
  if (iterating) return collected;
  return collected.length === 1 ? collected[0] : collected;
}

interface JqSegment {
  kind: "field" | "index" | "iterate";
  name?: string;
  index?: number;
}

function parseJqPath(query: string): JqSegment[] {
  const segs: JqSegment[] = [];
  let i = 0;
  // Leading `.` is required (we already checked).
  if (query[i] !== ".") {
    throw new Error(
      `jq: malformed query '${query}' (${JQ_UNSUPPORTED_NOTE})`,
    );
  }
  i += 1;
  while (i < query.length) {
    if (query[i] === "[") {
      const close = query.indexOf("]", i);
      if (close === -1) {
        throw new Error(
          `jq: malformed bracket in query '${query}' (${JQ_UNSUPPORTED_NOTE})`,
        );
      }
      const inside = query.slice(i + 1, close);
      if (inside === "") {
        segs.push({ kind: "iterate" });
      } else if (/^\d+$/.test(inside)) {
        segs.push({ kind: "index", index: Number(inside) });
      } else {
        throw new Error(
          `jq: bracket form '[${inside}]' not supported; only [N] and [] (${JQ_UNSUPPORTED_NOTE})`,
        );
      }
      i = close + 1;
      continue;
    }
    if (query[i] === ".") {
      i += 1;
      continue;
    }
    // Field name: alphanumeric / underscore / digit
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(query.slice(i));
    if (!m) {
      throw new Error(
        `jq: unexpected character at position ${i} in '${query}' (${JQ_UNSUPPORTED_NOTE})`,
      );
    }
    segs.push({ kind: "field", name: m[0] });
    i += m[0].length;
  }
  return segs;
}

function typeNameOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function formatJqResult(value: unknown): string {
  if (Array.isArray(value)) {
    // Per the iterate semantics: emit each element on its own line.
    return value.map(formatJqValue).join("\n");
  }
  return formatJqValue(value);
}

function formatJqValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "null";
  return JSON.stringify(value, null, 2) ?? "null";
}

/**
 * Worker-safe `sed` subset.
 *
 * Supported expression: a single substitution form
 *   `s/PATTERN/REPLACEMENT/[flags]`
 *
 * Flags:
 *   - `g` (global) → replace all matches per line; default replaces first only
 *   - `i` (case-insensitive)
 *
 * The delimiter MUST be `/`. Addresses, ranges, multi-statement scripts,
 * `;`-separated commands, and other sed commands (`d / p / q / n / a / i / c / y / =`)
 * all reject with `SED_UNSUPPORTED_NOTE`. This subset is intentionally
 * tiny — it covers the highest-frequency LLM use case (single-line search
 * & replace) without dragging in a full sed parser.
 */
function applySedExpression(expression: string, content: string): string {
  const trimmed = expression.trim();
  if (!trimmed.startsWith("s/")) {
    throw new Error(
      `sed: expression '${expression}' not supported (${SED_UNSUPPORTED_NOTE}); the worker-safe subset accepts a single 's/PATTERN/REPLACEMENT/[gi]' substitution.`,
    );
  }
  // Manual scan to find unescaped `/`.
  const parts: string[] = [];
  let cur = "";
  let i = 2; // past `s/`
  let escaping = false;
  while (i < trimmed.length && parts.length < 2) {
    const ch = trimmed[i]!;
    if (escaping) {
      cur += ch;
      escaping = false;
    } else if (ch === "\\") {
      escaping = true;
      cur += ch;
    } else if (ch === "/") {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
    i += 1;
  }
  // Read flag tail
  let flagsTail = "";
  while (i < trimmed.length) {
    if (trimmed[i] === "/") {
      // unexpected extra delimiter
      throw new Error(
        `sed: unsupported expression '${expression}' (${SED_UNSUPPORTED_NOTE}); only a single 's/PATTERN/REPLACEMENT/[gi]' substitution is recognised.`,
      );
    }
    flagsTail += trimmed[i];
    i += 1;
  }
  if (parts.length !== 2) {
    throw new Error(
      `sed: malformed substitution '${expression}' (${SED_UNSUPPORTED_NOTE}); expected 's/PATTERN/REPLACEMENT/[gi]'.`,
    );
  }
  const [pattern, replacement] = parts;
  const flags = flagsTail.trim();
  for (const f of flags) {
    if (f !== "g" && f !== "i") {
      throw new Error(
        `sed: flag '${f}' not supported (${SED_UNSUPPORTED_NOTE}); recognised flags: g, i.`,
      );
    }
  }
  // B3-R2 fix (2026-04-20) — sed `s/foo/bar/` is **per-line** first
  // match, not whole-string first match. Apply the replace on each
  // line individually so a multi-line file gets every line touched.
  // The `g` flag still means "all matches within a line".
  let regex: RegExp;
  try {
    regex = new RegExp(pattern!, flags.includes("g")
      ? (flags.includes("i") ? "gi" : "g")
      : (flags.includes("i") ? "i" : ""));
  } catch (err) {
    throw new Error(
      `sed: invalid pattern '${pattern}': ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const hasTrailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  const usable = hasTrailingNewline ? lines.slice(0, -1) : lines;
  const replaced = usable.map((line) => line.replace(regex, replacement!));
  return replaced.join("\n") + (hasTrailingNewline ? "\n" : "");
}

/**
 * Worker-safe `awk` subset.
 *
 * Supported program forms (file-first form `awk <program> <path>`):
 *   - `{ print $N }`            — print field N (1-based; `$0` = whole line)
 *   - `{ print $1, $2, ... }`   — print multiple fields separated by spaces
 *   - `NR == K { print }`       — print line K (1-based)
 *   - `NR == K { print $N }`    — print field N of line K
 *   - `/PATTERN/ { print }`     — print lines matching regex (anchors via `^` / `$` ok)
 *
 * Field separator: whitespace (default; matches POSIX awk default `FS`).
 * Anything else (BEGIN / END blocks, multi-statement bodies, user-defined
 * functions, getline, gsub, printf format strings, NF, $NF, etc.) is
 * honest-rejected with `AWK_UNSUPPORTED_NOTE`.
 */
function applyAwkProgram(program: string, content: string): string {
  const trimmed = program.trim();
  // Parse into [{ matcher, action }]
  const pattern = /^(?:(NR\s*==\s*\d+|\/[^/]+\/))?\s*\{(.*)\}\s*$/;
  const match = trimmed.match(pattern);
  if (!match) {
    throw new Error(
      `awk: program '${program}' not supported (${AWK_UNSUPPORTED_NOTE}); the worker-safe subset accepts '{ print $N }', 'NR == K { print [...] }', or '/PATTERN/ { print [...] }'.`,
    );
  }
  const matcher = match[1]?.trim();
  const body = match[2]!.trim();

  // Body must be `print` or `print <expr>[, <expr>]*`
  if (body !== "print" && !body.startsWith("print ") && !body.startsWith("print\t")) {
    throw new Error(
      `awk: action '{ ${body} }' not supported (${AWK_UNSUPPORTED_NOTE}); only print-actions are accepted.`,
    );
  }
  const printExpr = body === "print" ? "" : body.slice("print".length).trim();
  const printFields = printExpr === "" ? null : parseAwkPrintFields(printExpr, program);

  // Build per-line predicate from matcher
  let predicate: (line: string, nr: number) => boolean;
  if (matcher === undefined) {
    predicate = () => true;
  } else if (matcher.startsWith("NR")) {
    const m = matcher.match(/^NR\s*==\s*(\d+)$/);
    if (!m) {
      throw new Error(
        `awk: matcher '${matcher}' not supported (${AWK_UNSUPPORTED_NOTE}).`,
      );
    }
    const target = Number(m[1]);
    predicate = (_line, nr) => nr === target;
  } else if (matcher.startsWith("/") && matcher.endsWith("/")) {
    const pat = matcher.slice(1, -1);
    let re: RegExp;
    try {
      re = new RegExp(pat);
    } catch (err) {
      throw new Error(
        `awk: invalid regex /${pat}/: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    predicate = (line) => re.test(line);
  } else {
    throw new Error(
      `awk: matcher '${matcher}' not supported (${AWK_UNSUPPORTED_NOTE}).`,
    );
  }

  const lines = content.split("\n");
  const hasTrailingNewline = content.endsWith("\n");
  const usable = hasTrailingNewline ? lines.slice(0, -1) : lines;

  const out: string[] = [];
  for (let i = 0; i < usable.length; i++) {
    const nr = i + 1;
    const line = usable[i]!;
    if (!predicate(line, nr)) continue;
    if (printFields === null) {
      out.push(line);
    } else {
      const fields = line.split(/\s+/).filter((f) => f.length > 0);
      const printed = printFields.map((field) =>
        field === 0 ? line : (fields[field - 1] ?? ""),
      );
      out.push(printed.join(" "));
    }
  }
  return out.join("\n") + (out.length > 0 && hasTrailingNewline ? "\n" : "");
}

function parseAwkPrintFields(expr: string, program: string): number[] {
  const tokens = expr.split(",").map((t) => t.trim());
  const fields: number[] = [];
  for (const token of tokens) {
    const m = token.match(/^\$(\d+)$/);
    if (!m) {
      throw new Error(
        `awk: print expression '${token}' in '${program}' not supported (${AWK_UNSUPPORTED_NOTE}); only '$0' / '$N' field references are accepted.`,
      );
    }
    fields.push(Number(m[1]));
  }
  return fields;
}

// ═══════════════════════════════════════════════════════════════════
// §6 — Wave 2 commands: sort / uniq / diff
// ═══════════════════════════════════════════════════════════════════

function sortLines(
  content: string,
  opts: { reverse?: boolean; numeric?: boolean; unique?: boolean },
): string {
  const lines = content.split("\n");
  const hasTrailingNewline = content.endsWith("\n");
  const usable = hasTrailingNewline ? lines.slice(0, -1) : lines;

  let sorted = [...usable];
  if (opts.numeric) {
    sorted.sort((a, b) => {
      const na = numericKey(a);
      const nb = numericKey(b);
      if (Number.isNaN(na) && Number.isNaN(nb)) return a.localeCompare(b);
      if (Number.isNaN(na)) return -1;
      if (Number.isNaN(nb)) return 1;
      return na - nb;
    });
  } else {
    sorted.sort((a, b) => a.localeCompare(b));
  }
  if (opts.reverse) sorted.reverse();
  if (opts.unique) {
    const seen = new Set<string>();
    sorted = sorted.filter((l) => {
      if (seen.has(l)) return false;
      seen.add(l);
      return true;
    });
  }
  return sorted.join("\n") + (sorted.length > 0 && hasTrailingNewline ? "\n" : "");
}

function numericKey(line: string): number {
  // POSIX-ish numeric sort: parse leading numeric token only.
  const m = line.match(/^\s*(-?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : Number.NaN;
}

function uniqAdjacent(
  content: string,
  opts: { count?: boolean },
): string {
  const lines = content.split("\n");
  const hasTrailingNewline = content.endsWith("\n");
  const usable = hasTrailingNewline ? lines.slice(0, -1) : lines;

  const out: string[] = [];
  let prev: string | undefined;
  let count = 0;
  for (const line of usable) {
    if (line === prev) {
      count += 1;
      continue;
    }
    if (prev !== undefined) {
      out.push(opts.count ? `${count.toString().padStart(7, " ")} ${prev}` : prev);
    }
    prev = line;
    count = 1;
  }
  if (prev !== undefined) {
    out.push(opts.count ? `${count.toString().padStart(7, " ")} ${prev}` : prev);
  }
  return out.join("\n") + (out.length > 0 && hasTrailingNewline ? "\n" : "");
}

/**
 * Worker-safe `diff` — produces deterministic unified-style output.
 *
 * Algorithm: longest-common-subsequence (LCS) on lines, emitted as a
 * minimal-context unified diff (no `--unified=N` knob; each hunk is
 * emitted with 0 context lines so the output is bounded by the size of
 * the changes themselves). Output cap still applies via `withCap`.
 *
 * Output shape:
 *   --- a {leftPath}
 *   +++ b {rightPath}
 *   @@ -{leftLine},{leftCount} +{rightLine},{rightCount} @@
 *   -line removed from left
 *   +line added in right
 */
function diffUnified(
  leftPath: string,
  rightPath: string,
  leftContent: string,
  rightContent: string,
): string {
  if (leftContent === rightContent) return "";

  const a = leftContent.split("\n");
  const b = rightContent.split("\n");
  // Drop trailing empty when content ends with newline (treat as N lines).
  if (leftContent.endsWith("\n")) a.pop();
  if (rightContent.endsWith("\n")) b.pop();

  const ops = lcsDiff(a, b);

  const lines: string[] = [`--- a ${leftPath}`, `+++ b ${rightPath}`];
  // Emit hunks: contiguous runs of non-equal ops.
  let i = 0;
  while (i < ops.length) {
    if (ops[i]!.kind === "eq") {
      i += 1;
      continue;
    }
    let j = i;
    let leftStart = ops[i]!.aIdx;
    let rightStart = ops[i]!.bIdx;
    let leftCount = 0;
    let rightCount = 0;
    const hunk: string[] = [];
    while (j < ops.length && ops[j]!.kind !== "eq") {
      const op = ops[j]!;
      if (op.kind === "del") {
        hunk.push(`-${op.line}`);
        leftCount += 1;
      } else {
        hunk.push(`+${op.line}`);
        rightCount += 1;
      }
      j += 1;
    }
    lines.push(
      `@@ -${leftStart + 1},${leftCount} +${rightStart + 1},${rightCount} @@`,
    );
    lines.push(...hunk);
    i = j;
  }
  return lines.join("\n") + "\n";
}

interface DiffOp {
  kind: "eq" | "del" | "add";
  line: string;
  aIdx: number;
  bIdx: number;
}

function lcsDiff(a: string[], b: string[]): DiffOp[] {
  // Standard O(n*m) LCS table. Bounded by output cap downstream; for
  // pathological inputs, callers are expected to keep diffs reasonably
  // sized (cap is 64 KiB per hunk-rendered output).
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j]
        ? dp[i + 1]![j + 1]! + 1
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ kind: "eq", line: a[i]!, aIdx: i, bIdx: j });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ kind: "del", line: a[i]!, aIdx: i, bIdx: j });
      i += 1;
    } else {
      ops.push({ kind: "add", line: b[j]!, aIdx: i, bIdx: j });
      j += 1;
    }
  }
  while (i < m) {
    ops.push({ kind: "del", line: a[i]!, aIdx: i, bIdx: j });
    i += 1;
  }
  while (j < n) {
    ops.push({ kind: "add", line: b[j]!, aIdx: i, bIdx: j });
    j += 1;
  }
  return ops;
}

// ═══════════════════════════════════════════════════════════════════
// §7 — Public factory
// ═══════════════════════════════════════════════════════════════════

/**
 * Create the 9 text-processing capability handlers, scoped to the
 * provided workspace. When no `namespace` is supplied, every handler
 * returns a deterministic "[<cmd>] not connected" stub so the package
 * stays usable in offline test environments (mirrors the
 * `createFilesystemHandlers` no-namespace fallback).
 */
export function createTextProcessingHandlers(
  config?: unknown,
): Map<string, LocalCapabilityHandler> {
  const cfg = isTextProcessingHandlersConfig(config) ? config : undefined;
  const base = cfg?.workspacePath ?? DEFAULT_WORKSPACE_ROOT;
  const workspace = cfg?.namespace;

  const handlers = new Map<string, LocalCapabilityHandler>();

  handlers.set("wc", async (input) => {
    const { path = "" } = (input ?? {}) as PathInput;
    if (!path) throw new Error("wc: no file path provided");
    const resolved = resolveOrThrow("wc", base, path);
    if (!workspace) {
      return { output: `[wc] reading: ${resolved} (not connected)` };
    }
    const content = await readFileOrThrow(workspace, "wc", resolved);
    const stats = countWcStats(content);
    return withCap(`${stats.lines} ${stats.words} ${stats.bytes} ${resolved}`);
  });

  handlers.set("head", async (input) => {
    const { path = "", lines, bytes } = (input ?? {}) as HeadTailInput;
    if (!path) throw new Error("head: no file path provided");
    const resolved = resolveOrThrow("head", base, path);
    if (!workspace) {
      return { output: `[head] reading: ${resolved} (not connected)` };
    }
    const content = await readFileOrThrow(workspace, "head", resolved);
    const out = typeof bytes === "number"
      ? headBytes(content, bytes)
      : headLines(content, typeof lines === "number" ? lines : 10);
    return withCap(out);
  });

  handlers.set("tail", async (input) => {
    const { path = "", lines, bytes } = (input ?? {}) as HeadTailInput;
    if (!path) throw new Error("tail: no file path provided");
    const resolved = resolveOrThrow("tail", base, path);
    if (!workspace) {
      return { output: `[tail] reading: ${resolved} (not connected)` };
    }
    const content = await readFileOrThrow(workspace, "tail", resolved);
    const out = typeof bytes === "number"
      ? tailBytes(content, bytes)
      : tailLines(content, typeof lines === "number" ? lines : 10);
    return withCap(out);
  });

  handlers.set("jq", async (input) => {
    const { query = "", path = "" } = (input ?? {}) as JqInput;
    if (!path) throw new Error("jq: no file path provided");
    if (!query) throw new Error("jq: no query provided");
    const resolved = resolveOrThrow("jq", base, path);
    if (!workspace) {
      return { output: `[jq] reading: ${resolved} (not connected)` };
    }
    const content = await readFileOrThrow(workspace, "jq", resolved);
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new Error(
        `jq: invalid JSON in ${resolved}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const result = applyJqQuery(query, parsed);
    return withCap(formatJqResult(result));
  });

  handlers.set("sed", async (input) => {
    const { expression = "", path = "" } = (input ?? {}) as SedInput;
    if (!path) throw new Error("sed: no file path provided");
    if (!expression) throw new Error("sed: no expression provided");
    const resolved = resolveOrThrow("sed", base, path);
    if (!workspace) {
      return { output: `[sed] reading: ${resolved} (not connected)` };
    }
    const content = await readFileOrThrow(workspace, "sed", resolved);
    return withCap(applySedExpression(expression, content));
  });

  handlers.set("awk", async (input) => {
    const { program = "", path = "" } = (input ?? {}) as AwkInput;
    if (!path) throw new Error("awk: no file path provided");
    if (!program) throw new Error("awk: no program provided");
    const resolved = resolveOrThrow("awk", base, path);
    if (!workspace) {
      return { output: `[awk] reading: ${resolved} (not connected)` };
    }
    const content = await readFileOrThrow(workspace, "awk", resolved);
    return withCap(applyAwkProgram(program, content));
  });

  handlers.set("sort", async (input) => {
    const { path = "", reverse, numeric, unique } = (input ?? {}) as SortInput;
    if (!path) throw new Error("sort: no file path provided");
    const resolved = resolveOrThrow("sort", base, path);
    if (!workspace) {
      return { output: `[sort] reading: ${resolved} (not connected)` };
    }
    const content = await readFileOrThrow(workspace, "sort", resolved);
    return withCap(sortLines(content, { reverse, numeric, unique }));
  });

  handlers.set("uniq", async (input) => {
    const { path = "", count } = (input ?? {}) as UniqInput;
    if (!path) throw new Error("uniq: no file path provided");
    const resolved = resolveOrThrow("uniq", base, path);
    if (!workspace) {
      return { output: `[uniq] reading: ${resolved} (not connected)` };
    }
    const content = await readFileOrThrow(workspace, "uniq", resolved);
    return withCap(uniqAdjacent(content, { count }));
  });

  handlers.set("diff", async (input) => {
    const { left = "", right = "" } = (input ?? {}) as DiffInput;
    if (!left || !right) {
      throw new Error("diff: left and right paths required");
    }
    const resolvedL = resolveOrThrow("diff", base, left);
    const resolvedR = resolveOrThrow("diff", base, right);
    if (!workspace) {
      return {
        output: `[diff] comparing: ${resolvedL} <-> ${resolvedR} (not connected)`,
      };
    }
    const a = await readFileOrThrow(workspace, "diff", resolvedL);
    const b = await readFileOrThrow(workspace, "diff", resolvedR);
    return withCap(diffUnified(resolvedL, resolvedR, a, b));
  });

  return handlers;
}

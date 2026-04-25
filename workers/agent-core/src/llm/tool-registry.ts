export interface LlmToolDeclaration {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

function objectSchema(properties: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "object", properties };
}

export const LLM_TOOL_DECLARATIONS: readonly LlmToolDeclaration[] = [
  { name: "pwd", description: "Print current working directory", inputSchema: objectSchema() },
  { name: "ls", description: "List directory contents", inputSchema: objectSchema({ path: { type: "string" } }) },
  { name: "cat", description: "Read file contents", inputSchema: objectSchema({ path: { type: "string" } }) },
  { name: "write", description: "Write content to a file", inputSchema: objectSchema({ path: { type: "string" }, content: { type: "string" } }) },
  { name: "mkdir", description: "Create a directory", inputSchema: objectSchema({ path: { type: "string" } }) },
  { name: "rm", description: "Remove a file or directory", inputSchema: objectSchema({ path: { type: "string" } }) },
  { name: "mv", description: "Move or rename a file", inputSchema: objectSchema({ source: { type: "string" }, destination: { type: "string" } }) },
  { name: "cp", description: "Copy a file", inputSchema: objectSchema({ source: { type: "string" }, destination: { type: "string" } }) },
  { name: "rg", description: "Search file contents using pattern matching", inputSchema: objectSchema({ pattern: { type: "string" }, path: { type: "string" } }) },
  { name: "curl", description: "Fetch a URL", inputSchema: objectSchema({ url: { type: "string" } }) },
  { name: "ts-exec", description: "Execute TypeScript code in a controlled sandbox", inputSchema: objectSchema({ code: { type: "string" } }) },
  { name: "git", description: "Run a limited subset of git subcommands (status, diff, log)", inputSchema: objectSchema({ subcommand: { type: "string" }, args: { type: "array", items: { type: "string" } } }) },
  { name: "wc", description: "Print line, word, and byte counts for a file", inputSchema: objectSchema({ path: { type: "string" } }) },
  { name: "head", description: "Print the first lines of a file", inputSchema: objectSchema({ path: { type: "string" }, lines: { type: "integer" }, bytes: { type: "integer" } }) },
  { name: "tail", description: "Print the last lines of a file", inputSchema: objectSchema({ path: { type: "string" }, lines: { type: "integer" }, bytes: { type: "integer" } }) },
  { name: "jq", description: "Worker-safe JSON query subset", inputSchema: objectSchema({ query: { type: "string" }, path: { type: "string" } }) },
  { name: "sed", description: "Worker-safe sed substitution subset", inputSchema: objectSchema({ expression: { type: "string" }, path: { type: "string" } }) },
  { name: "awk", description: "Worker-safe awk print/filter subset", inputSchema: objectSchema({ program: { type: "string" }, path: { type: "string" } }) },
  { name: "sort", description: "Sort lines of a file", inputSchema: objectSchema({ path: { type: "string" }, reverse: { type: "boolean" }, numeric: { type: "boolean" }, unique: { type: "boolean" } }) },
  { name: "uniq", description: "Collapse adjacent duplicate lines", inputSchema: objectSchema({ path: { type: "string" }, count: { type: "boolean" } }) },
  { name: "diff", description: "Unified-style diff between two workspace files", inputSchema: objectSchema({ left: { type: "string" }, right: { type: "string" } }) },
];

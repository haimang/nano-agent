// ZX5 Lane D D2 — catalog content registry.
//
// 静态 per-deploy registry,被 `index.ts:handleCatalog` 直接消费。每个 entry
// 有 name / description / version / status,前端 catalog 视图据此拼界面。
// 后续 ZX5+ 若 owner 需要,registry 可改为从 D1 表 / KV / R2 加载,接口形状不变。
//
// **每个 entry 必须 facade-http-v1 envelope 包装**(handleCatalog 已做)。
//
// 内容口径(per Q5 owner direction):
// - skills:agent 在执行过程中可调用的能力(例如 reasoning / planning helper)
// - commands:面向终端用户的高层级命令(例如 /reset / /summary)
// - agents:可挂载的 nested agent profile(例如 router / specialist)
// 当前 ZX5 阶段填初始 baseline,后续 plan 按需扩展。

export interface CatalogEntry {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly status: "stable" | "preview" | "experimental";
}

export const CATALOG_SKILLS: CatalogEntry[] = [
  {
    name: "context-assembly",
    description:
      "把 initial-context layer / pending layers / session memory 汇合成 LLM prompt",
    version: "1.0.0",
    status: "stable",
  },
  {
    name: "filesystem-host-local",
    description: "agent 在 host-local 文件系统读写,facade 经 capability seam 中转",
    version: "1.0.0",
    status: "stable",
  },
  {
    name: "bash-tool-call",
    description: "agent 通过 bash-core 调用受控 capability(`pwd` / `__px_sleep` 等)",
    version: "1.0.0",
    status: "stable",
  },
  {
    name: "permission-gate",
    description:
      "PermissionRequest hook;agent runtime 可发 server frame 等待用户决定(ZX5 Lane F1)",
    version: "1.0.0-preview",
    status: "preview",
  },
];

export const CATALOG_COMMANDS: CatalogEntry[] = [
  {
    name: "/start",
    description: "POST /sessions/{id}/start 起始一个 session(facade public endpoint)",
    version: "1.0.0",
    status: "stable",
  },
  {
    name: "/input",
    description:
      "POST /sessions/{id}/input — text-only 后续 turn(per Q8 是 /messages text-only 子集的 alias)",
    version: "1.0.0",
    status: "stable",
  },
  {
    name: "/messages",
    description:
      "POST /sessions/{id}/messages — 多模态 message 输入(ZX5 Lane D D3,/input 的多模态超集)",
    version: "1.0.0-preview",
    status: "preview",
  },
  {
    name: "/cancel",
    description: "POST /sessions/{id}/cancel — 取消当前 turn",
    version: "1.0.0",
    status: "stable",
  },
  {
    name: "/files",
    description: "GET /sessions/{id}/files — artifact 拉取(ZX5 Lane D D4)",
    version: "1.0.0-preview",
    status: "preview",
  },
];

export const CATALOG_AGENTS: CatalogEntry[] = [
  {
    name: "nano-default",
    description: "默认 agent profile;mainline LLM + bash-core capability + filesystem host-local",
    version: "1.0.0",
    status: "stable",
  },
  {
    name: "nano-preview-verify",
    description: "verify 用 agent profile;capability-call / capability-cancel / initial-context 等 verification harness",
    version: "1.0.0",
    status: "preview",
  },
];

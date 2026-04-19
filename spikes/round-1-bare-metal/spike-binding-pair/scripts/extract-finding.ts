#!/usr/bin/env -S node --experimental-strip-types
/**
 * extract-finding.ts — turn .out/{date}.json into per-finding doc drafts
 * under docs/spikes/spike-binding-pair/{NN}-{slug}.md
 *
 * Aligned with docs/templates/_TEMPLATE-spike-finding.md.
 *
 * Usage:
 *   node --experimental-strip-types scripts/extract-finding.ts .out/2026-04-19T12-00-00Z.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SPIKE_DIR = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(SPIKE_DIR, "../../..");
const TEMPLATE_PATH = resolve(REPO_ROOT, "docs/templates/_TEMPLATE-spike-finding.md");
const FINDING_DIR = resolve(REPO_ROOT, "docs/spikes/spike-binding-pair");

interface BindingProbeResult {
  validationItemId: string;
  success: boolean;
  transportScope: string;
  observations: { label: string; value: unknown }[];
  errors: { code: string; message: string }[];
  timings: { p50Ms?: number; p99Ms?: number; samplesN: number; totalDurationMs: number };
  capturedAt: string;
}

interface CombinedOut {
  capturedAt: string;
  base: string;
  transportScope: string;
  results: BindingProbeResult[];
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function severityFromResult(r: BindingProbeResult): string {
  if (r.errors.length > 0) return "high";
  return "informational";
}

function buildFinding(
  r: BindingProbeResult,
  idx: number,
  base: string,
  transportScope: string,
): { path: string; body: string } {
  const slug = slugify(r.validationItemId);
  const num = String(idx).padStart(2, "0");
  const filename = `${num}-${slug}.md`;
  const status = r.success ? "open" : "open";
  const severity = severityFromResult(r);
  const observationsBlock = r.observations
    .map((o) => `- **${o.label}**: \`${JSON.stringify(o.value)}\``)
    .join("\n");

  const probePath = r.validationItemId.replace(/^V[0-9A-Z]*-/, "");
  const body = `# Spike Finding — \`${r.validationItemId}\`

> **Finding ID**: \`spike-binding-pair-F${num}\`
> **Spike**: \`spike-binding-pair\`
> **Validation item**: \`${r.validationItemId}\`
> **Transport scope**: \`${transportScope}\`
> **Discovered**: ${r.capturedAt.slice(0, 10)}
> **Author**: extract-finding.ts (auto-seeded)
> **Severity**: \`${severity}\` _(initial guess; reviewer must confirm)_
> **Status**: \`${status}\`

---

## 0. 摘要（一句话）

> _(TODO: human author — write 1-2 sentence summary.)_

> **重要**：本 finding 仅描述 fetch-based service binding seam 的真相；
> RPC \`handleNacp\` transport 不在本 spike 验证范围内（详见
> \`docs/design/after-foundations/P0-spike-binding-pair-design.md\` §0）。

---

## 1. 现象（Phenomenon）

### 1.1 复现步骤

\`\`\`bash
curl -sS -X POST "${base}/probe/${probePath}" \\
  -H "content-type: application/json" --data '{}'
\`\`\`

### 1.2 实际观测

${observationsBlock || "(no observations)"}

### 1.3 期望与实际的差距

_(TODO)_

---

## 2. 根因（Root Cause）

### 2.1 直接原因

_(TODO)_

### 2.2 平台/协议/SDK 引用

_(TODO)_

### 2.3 与 packages/ 当前假设的差异

_(TODO — reference \`packages/session-do-runtime/src/remote-bindings.ts\` 与 \`packages/session-do-runtime/src/cross-seam.ts\` 等 fetch-based seam 实现)_

---

## 3. 对 packages/ 的影响（Package Impact）

### 3.1 受影响文件

| 文件路径 | 行号 | 影响类型 | 说明 |
|---|---|---|---|
| _(TODO)_ | | | |

### 3.2 受影响的接口契约

- [ ] Breaking change
- [ ] Non-breaking addition
- [ ] 内部实现修改

### 3.3 是否需要协议层改动

- [ ] 仅 packages/ 内部
- [ ] 需要新增 NACP message kind
- [ ] 需要扩展现有 NACP message 字段

---

## 4. 对 worker matrix 阶段的影响（Worker-Matrix Impact）

### 4.1 哪些下一阶段 worker 会受影响

- [ ] agent.core
- [ ] bash.core
- [ ] filesystem.core
- [ ] context.core
- [ ] reserved skill.core

### 4.2 影响形态

- [ ] 阻塞
- [ ] 漂移
- [ ] 性能
- [ ] 可观测性
- [ ] 仅 documentation

---

## 5. 写回行动（Writeback Action）

### 5.1 推荐写回路径

| 行动 | 目标 phase | 目标文件 / 模块 | 责任 owner |
|---|---|---|---|
| _(TODO)_ | | | |

### 5.2 写回完成的判定

- [ ] 对应 packages/ 文件已 ship
- [ ] 对应 contract test 已新增
- [ ] 对应 spike Round 2 integrated test 已跑通
- [ ] 修订对应 design doc

### 5.3 dismissed-with-rationale 的判定

- [ ] Finding 在更广 context 下不成立
- [ ] Cost-benefit 不划算
- [ ] 延后到 worker matrix 阶段或更后阶段

---

## 6. 验证证据（Evidence）

### 6.1 原始日志 / 输出

\`\`\`json
${JSON.stringify({ timings: r.timings, errors: r.errors }, null, 2)}
\`\`\`

### 6.2 复现脚本位置

- \`spikes/round-1-bare-metal/spike-binding-pair/scripts/run-all-probes.sh\`

---

## 7. 关联关系

| 关联 finding | 关系类型 | 说明 |
|---|---|---|
| _(TODO)_ | | |

| 文档 | 章节 | 关系 |
|---|---|---|
| \`docs/plan-after-foundations.md\` | §2.2 V3 | validation item source |
| \`docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md\` | §4.3 | matrix entry |
| \`docs/design/after-foundations/P0-spike-binding-pair-design.md\` | §0 + §4 | probe design + transport scope |

---

## 8. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| ${r.capturedAt.slice(0, 10)} | extract-finding.ts | 自动种子 |
| | | |
`;

  return { path: join(FINDING_DIR, filename), body };
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error("Usage: extract-finding.ts <combined-out.json>");
    process.exit(1);
  }
  const outPath = resolve(argv[0]!);
  const raw = readFileSync(outPath, "utf-8");
  const combined: CombinedOut = JSON.parse(raw);

  if (!existsSync(TEMPLATE_PATH)) {
    console.error(`✗ Template not found at ${TEMPLATE_PATH}`);
    process.exit(2);
  }

  mkdirSync(FINDING_DIR, { recursive: true });

  let i = 0;
  for (const result of combined.results) {
    i++;
    const { path, body } = buildFinding(
      result,
      i,
      combined.base,
      combined.transportScope,
    );
    if (existsSync(path)) {
      console.log(`  · skip existing: ${path}`);
      continue;
    }
    writeFileSync(path, body);
    console.log(`  ✓ wrote ${path}`);
  }
  console.log(`\nDone. ${i} finding draft(s) under ${FINDING_DIR}/.`);
}

main();

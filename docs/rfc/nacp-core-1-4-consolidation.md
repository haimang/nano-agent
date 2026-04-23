# RFC — `nacp-core` 1.4.0 Consolidation

> **RFC ID**: `nacp-core-1-4-consolidation`
> **Status**: `executed`
> **Author**: GPT-5.4
> **Date**: 2026-04-22
> **Driver**: `docs/action-plan/pre-worker-matrix/W0-nacp-consolidation.md`
> **Related design**: `docs/design/pre-worker-matrix/W0-nacp-consolidation.md`
> **Related closure**: `docs/issue/pre-worker-matrix/W0-closure.md`

---

## 1. Summary

W0 的目标不是扩大 `@haimang/nacp-core` 的运行时职责，而是把已经在多个 Tier B package 中被重复声明、又会被 W1-W4 共同依赖的 **Tier A vocabulary / helper-adjacent shape** 物理归位到 `@haimang/nacp-core`。

这次 1.4.0 consolidation 只做四类吸收：

1. `cross-seam` propagation truth
2. `eval sink` contract types + `extractMessageUuid()`
3. 4-stream evidence vocabulary
4. hook event vocabulary + storage-law builders/constants

它**不**搬 runtime class、dispatch loop、storage adapter、failure taxonomy、startup queue、evidence emitter、hook metadata reducer 等逻辑层代码。

---

## 2. Why this version exists

进入 worker-matrix 前，仓库存在一个明确断点：多个相邻 package 都在各自维持一份“像协议、但又不是单一协议源”的 shape truth。

| 分散 truth | 原始位置 | W0 之后的新真理源 |
|---|---|---|
| cross-seam anchor/header law | `session-do-runtime/src/cross-seam.ts` | `nacp-core/src/transport/cross-seam.ts` |
| eval sink contract types | `session-do-runtime/src/eval-sink.ts` | `nacp-core/src/evidence/sink-contract.ts` |
| evidence record shapes | `workspace-context-artifacts/src/evidence-emitters.ts` | `nacp-core/src/evidence/vocabulary.ts` |
| hook event names / payload schema truth | `hooks/src/catalog.ts` | `nacp-core/src/hooks-catalog/index.ts` |
| storage keys / ref builders | `storage-topology/src/{keys.ts,refs.ts}` | `nacp-core/src/storage-law/*` |

如果不先收口，W1 的 cross-worker RFC、W2 的 publish discipline、W3 的 absorption blueprint、W4 的 worker scaffold 都会继续围绕多份事实推进。

---

## 3. Normative scope

### 3.1 `transport/cross-seam.ts`

`@haimang/nacp-core` 新增：

- `CrossSeamAnchor`
- `CROSS_SEAM_HEADERS`
- `buildCrossSeamHeaders()`
- `readCrossSeamHeaders()`
- `validateCrossSeamAnchor()`

**边界说明**：

- 只包含 propagation truth。
- `CrossSeamError` / `CROSS_SEAM_FAILURE_REASONS` / `StartupQueue` 继续留在 `session-do-runtime`。

### 3.2 `evidence/sink-contract.ts`

`@haimang/nacp-core` 新增：

- `EvalSinkEmitArgs`
- `EvalSinkOverflowDisclosure`
- `EvalSinkStats`
- `extractMessageUuid()`

**边界说明**：

- 只冻结 sink-facing contract 与 helper。
- `BoundedEvalSink` class 继续留在 `session-do-runtime`。

### 3.3 `evidence/vocabulary.ts`

`@haimang/nacp-core` 新增：

- `EvidenceAnchorSchema`
- `AssemblyEvidenceRecordSchema`
- `CompactEvidenceRecordSchema`
- `ArtifactEvidenceRecordSchema`
- `SnapshotEvidenceRecordSchema`
- `EvidenceRecordSchema`

这些 schema 的 field 名、phase 划分、optional 字段都按当前 `workspace-context-artifacts` helper 输出 reality 反推，不再让 W1/W5 直接引用 runtime helper 文件本身。

### 3.4 `hooks-catalog/index.ts`

`@haimang/nacp-core` 新增：

- `HOOK_EVENT_NAMES`
- `HookEventNameSchema`
- 18 个 payload schema
- `HOOK_EVENT_PAYLOAD_SCHEMA_NAMES`
- `HOOK_EVENT_PAYLOAD_SCHEMAS`

**边界说明**：

- 这里只吸收 vocabulary truth。
- `HOOK_EVENT_CATALOG` 的 `blocking / allowedOutcomes / redactionHints` 仍由 `@nano-agent/hooks` 拥有。
- `hook.emit` / `hook.outcome` 的 envelope-level wire schema 仍保持现状，不在 W0 引入新的 envelope validation。

### 3.5 `storage-law/*`

`@haimang/nacp-core` 新增：

- `DO_KEYS`
- `KV_KEYS`
- `R2_KEYS`
- `buildDoStorageRef()`
- `buildKvRef()`
- `buildR2Ref()`
- `validateRefKey()`
- `StorageRef` / `BuildRefOptions`

**边界说明**：

- 只搬 key/ref law。
- `taxonomy`、`placement`、`mime gate`、`calibration`、storage adapters 继续属于 `@nano-agent/storage-topology`。

---

## 4. Compatibility decision

这次变更是 **additive minor**，不是 breaking migration。

兼容策略如下：

1. `session-do-runtime/src/cross-seam.ts` 保留 runtime-owned failure/startup logic，并 re-export propagation truth。
2. `session-do-runtime/src/eval-sink.ts` 保留 `BoundedEvalSink`，并 re-export sink contract types + `extractMessageUuid()`。
3. `workspace-context-artifacts/src/evidence-emitters.ts` 继续拥有 builder/emit helper，但其 record type 对齐 `@haimang/nacp-core`。
4. `hooks/src/catalog.ts` 继续拥有 runtime metadata，但 `HookEventName` 与 payload-schema-name truth 改为消费 `@haimang/nacp-core`。
5. `storage-topology/src/{keys.ts,refs.ts}` 改为纯 re-export。

补充说明：

- `StorageRef` 在 `nacp-core` 内通过 `extends NacpRef` 表达，以显式对齐已有 NACP ref truth；其公开字段集合与 pre-W0 的 flat interface 结构等价。
- `validateRefKey()` 保持 pre-W0 的 `StorageRef` 调用签名；实现上仍只验证 `team_uuid` 与 tenant-prefixed `key` 纪律。

---

## 5. Versioning decision

### 5.1 `@haimang/nacp-core`

- `1.3.0 → 1.4.0`
- 原因：新增公开 surface，但不破坏既有 wire 或 consumer path

### 5.2 `@haimang/nacp-session`

- **保持 `1.3.0`**
- 原因：W0 实施中没有新增 `nacp-session` 对这些 consolidated symbol 的 import，也没有 session package surface 变化

---

## 6. Not in scope

本 RFC 明确不包含：

- runtime class migration
- worker-matrix RFC / message family 新增
- hooks runtime metadata hoist
- storage adapter / placement / calibration hoist
- W2/W3/W4 的 publish / absorption / scaffold 工作

---

## 7. Validation snapshot

本次 consolidation 对拍通过的直接验证面：

1. `pnpm --filter @haimang/nacp-core typecheck build test` → `259/259` tests passed
2. `pnpm --filter @haimang/nacp-session typecheck build test` → `119/119` tests passed
3. `pnpm --filter @nano-agent/session-do-runtime typecheck build test` → `357/357` tests passed
4. `pnpm --filter @nano-agent/hooks typecheck build test` → `198/198` tests passed
5. `pnpm --filter @nano-agent/storage-topology typecheck build test` → `169/169` tests passed
6. `pnpm --filter @nano-agent/workspace-context-artifacts typecheck build test` → `192/192` tests passed
7. `node --test test/*.test.mjs` → `98/98` passed
8. `npm run test:cross` → `112/112` passed
9. `node --test test/b7-round2-integrated-contract.test.mjs` → `5/5` passed

最终仓级验证见 `docs/issue/pre-worker-matrix/W0-closure.md`。

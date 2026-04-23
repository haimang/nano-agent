# W0 Closure — NACP Protocol Consolidation

> 阶段: `pre-worker-matrix / W0`
> 状态: `closed`
> 作者: `GPT-5.4`
> 时间: `2026-04-22`
> 对应 action-plan: `docs/action-plan/pre-worker-matrix/W0-nacp-consolidation.md`
> 对应 RFC: `docs/rfc/nacp-core-1-4-consolidation.md`

---

## 1. 结论

W0 已达到 action-plan 约定的关闭条件。

这次实现成功把 **Tier A protocol-adjacent truth** 收束进 `@haimang/nacp-core@1.4.0`，同时维持旧 import path 的 additive / non-breaking 行为。W1-W4 后续可以直接围绕 `nacp-core` 的 consolidated surface 继续推进，不再需要从多个相邻 package 反推同一份 vocabulary。

---

## 2. 实际交付

### 2.1 新增到 `@haimang/nacp-core` 的 surface

1. `transport/cross-seam.ts`
2. `evidence/sink-contract.ts`
3. `evidence/vocabulary.ts`
4. `hooks-catalog/index.ts`
5. `storage-law/{constants.ts,builders.ts,index.ts}`

### 2.2 compat / consumer 对齐

1. `session-do-runtime` 保留 runtime-owned `CrossSeamError` / `StartupQueue` / `BoundedEvalSink`，但把 contract truth 改成 re-export `nacp-core`
2. `workspace-context-artifacts` 的 evidence emitters 继续本地拥有 builder helper，但其 record type 对齐 `nacp-core`
3. `hooks` 继续拥有 `HOOK_EVENT_CATALOG` runtime metadata，但 `HookEventName` 与 payload-schema-name truth 收口到 `nacp-core`
4. `storage-topology` 的 `keys.ts / refs.ts` 现已变成纯 re-export compatibility layer

### 2.3 version 决策

1. `@haimang/nacp-core`: `1.3.0 → 1.4.0`
2. `@haimang/nacp-session`: 维持 `1.3.0`

`nacp-session` 未跟随 bump 的原因很直接：W0 没有让它新增 import，也没有改变 package 自身的 public/session wire surface。

---

## 3. In-Scope / Out-of-Scope verdict

| 项目 | 结果 | 说明 |
|---|---|---|
| cross-seam propagation truth | `done` | 已吸收到 `nacp-core` |
| eval sink contract types + helper | `done` | `BoundedEvalSink` 明确保留原位 |
| 4-stream evidence vocabulary | `done` | 已用 schema 固化 |
| hook event vocabulary + payload schemas | `done` | runtime metadata 未越界搬迁 |
| storage-law builders/constants | `done` | adapters / placement 未越界搬迁 |
| runtime class / dispatcher / adapter migration | `not-done-by-design` | 明确 out-of-scope |
| 新 message family / worker RFC | `not-done-by-design` | 属 W1+ |

---

## 4. 验证结果

### 4.1 基线（改动前）

以下基线在启动 W0 前已通过：

1. `pnpm --filter @haimang/nacp-core typecheck build test`
2. `pnpm --filter @haimang/nacp-session typecheck build test`
3. `pnpm --filter @nano-agent/session-do-runtime typecheck build test`
4. `pnpm --filter @nano-agent/hooks typecheck build test`
5. `pnpm --filter @nano-agent/storage-topology typecheck build test`
6. `pnpm --filter @nano-agent/workspace-context-artifacts typecheck build test`
7. `node --test test/*.test.mjs`
8. `npm run test:cross`

### 4.2 W0 实施后的直接验证

1. `pnpm --filter @haimang/nacp-core typecheck build test` → `18/18` test files, `259/259` tests passed
2. `pnpm --filter @haimang/nacp-session typecheck build test` → `14/14` test files, `119/119` tests passed
3. `pnpm --filter @nano-agent/session-do-runtime typecheck build test` → `29/29` test files, `357/357` tests passed
4. `pnpm --filter @nano-agent/hooks typecheck build test` → `16/16` test files, `198/198` tests passed
5. `pnpm --filter @nano-agent/storage-topology typecheck build test` → `15/15` test files, `169/169` tests passed
6. `pnpm --filter @nano-agent/workspace-context-artifacts typecheck build test` → `17/17` test files, `192/192` tests passed

### 4.3 W0 最终仓级验证

1. `pnpm -r run test` → `11` 个 workspace test targets 全绿；汇总输出共 `2177/2177` tests passed
2. `node --test test/*.test.mjs` → root contract suite `98/98` passed
3. `npm run test:cross` → root contract + e2e cross suite `112/112` passed
4. `node --test test/b7-round2-integrated-contract.test.mjs` → **B7 LIVE contract `5/5` passed**

> 说明：第 4 条是对 B7 LIVE 的显式单独复核。它已经被第 2/3 条的 root suite 覆盖，但为满足 pre-worker-matrix / W0 的收口纪律，这里额外单列结果。

---

## 5. 遗留项与后续交接

### 5.1 已明确不在 W0 收口的项目

1. `CrossSeamError` / `StartupQueue`
2. `BoundedEvalSink`
3. `emit*Evidence()` helper
4. `HOOK_EVENT_CATALOG` runtime metadata
5. storage adapters / placement / calibration

### 5.2 对下游阶段的直接价值

1. **W1** 可以直接围绕 consolidated vocabulary 写 RFC，不再从 Tier B 包里抄 shape
2. **W2** 可以把 publish gate 建立在已经稳定的 core surface 上
3. **W3** 可以把 blueprint / absorption map 对齐到新的 import truth
4. **W4** 可以直接消费 cross-seam / storage-law / evidence vocabulary 作为 scaffold 契约

### 5.3 本轮未按 design 拆成 5 个独立 commit 的 tradeoff 说明

W0 的代码提交最终收束成了“core consolidation 一组 + downstream compat 一组 + docs/test 两组”的较粗粒度历史，而不是 design §6.1 预想的 5 类独立可回滚 commit。

这里的实际取舍是：

1. W0 的 5 类 vocabulary 吸收在代码上高度耦合到同一轮 `nacp-core@1.4.0` surface freeze；若强行拆成 5 组，验证面会被重复扩大到 5 轮全仓回归。
2. 这次选择优先保证 **单轮完整 regression + additive/non-breaking 收口**，而不是为了历史颗粒度去做 5 次重复 build/test。
3. 这一偏离只接受在 W0；后续 W1/W3 若继续做多类文档/blueprint 收口，应恢复“每类独立 commit / 易回滚”的纪律，避免进一步放宽。

---

## 6. 最终 verdict

W0 可以关闭，并且应该被视为 `pre-worker-matrix` 的真实启动前置条件已经兑现的一环：**协议形态的单一真理源已经建立，且没有以“集中化”为名把 runtime 逻辑误搬进 core。**

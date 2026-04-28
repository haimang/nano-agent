# @haimang/orchestrator-auth-contract

Typed RPC contracts for the orchestrator-auth worker, plus the public
`facade-http-v1` envelope and error code surface used by orchestrator-core.

> **Status**: keep-set protocol package(per ZX3 §14.1 + ZX5 Lane C C5)

---

## 0. 包的角色

| 文件 | 公开 surface |
|---|---|
| `src/index.ts` | `AuthErrorCodeSchema` / `AuthErrorCode` / `AccessTokenClaimsSchema` / `AccessTokenClaims` / `AuthRpcRequestSchema` / `OrchestratorAuthRpcService` 等 RPC contract |
| `src/facade-http.ts` | `FacadeErrorCodeSchema` / `FacadeErrorCode` / `FacadeEnvelope<T>` / `FacadeError` / `facadeOk` / `facadeFromAuthEnvelope` 等 façade 公网 wire |

两个文件加起来定义了:
1. orchestrator-auth ↔ orchestrator-core 的内部 RPC contract
2. orchestrator-core 对外 HTTP 公网 facade-http-v1 wire

---

## 1. Envelope 关系总览(ZX5 C5 真相)

> **本节是 ZX5 Lane C C5 owner-frozen 单一真相**。`docs/transport/transport-profiles.md`
> 仅作为索引跳转,不复制本节内容。

```
                 ┌──────────────────────────────────────────────────┐
                 │  @haimang/nacp-core                              │
                 │  ─────────────────────────                       │
                 │  Envelope<T> = OkEnvelope<T> | ErrorEnvelope     │
                 │  RpcErrorCodeSchema / RpcErrorCode               │
                 │  (worker ↔ worker / DO 内部 RPC truth)            │
                 └────────────────┬─────────────────────────────────┘
                                  │ extends(单向约束)
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  @haimang/orchestrator-auth-contract                        │
   │  ─────────────────────────────────────                      │
   │  AuthErrorCodeSchema / AuthErrorCode                        │
   │  (orchestrator-auth ↔ orchestrator-core RPC error subset)    │
   └────────────────┬────────────────────────────────────────────┘
                    │ both extend(双 single-direction subset)
                    ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  facade-http.ts                                             │
   │  ───────────────                                            │
   │  FacadeErrorCodeSchema / FacadeErrorCode                    │
   │  ⊇ AuthErrorCode (per `_authErrorCodesAreFacadeCodes` 断言)  │
   │  ⊇ RpcErrorCode  (per `_rpcErrorCodesAreFacadeCodes` 断言)  │
   │                                                             │
   │  FacadeEnvelope<T> = FacadeSuccessEnvelope<T>               │
   │                    | FacadeErrorEnvelope                    │
   │  (对外公网 HTTP wire,facade-http-v1)                         │
   └─────────────────────────────────────────────────────────────┘
```

### 1.1 单向约束(per ZX4-ZX5 GPT review §3.9)

- **`FacadeErrorCode ⊇ AuthErrorCode`**:任意 auth `Envelope.error.code`
  可以**无翻译**重新 emit 为 facade `error.code`。**反向不要求** —
  facade 可以有 auth 不知道的 code(比如 `invalid-wechat-payload`)。
- **`FacadeErrorCode ⊇ RpcErrorCode`**(ZX5 C4 新增):任意 nacp-core
  RPC `Envelope.error.code` 同样可无翻译 emit 到 facade。**反向不要求** —
  facade 可以有 wire 层不存在的 code(如 `invalid-wechat-payload`)。
- **两个断言都通过 `extends never` TS narrowing 在 facade-http.ts 实现** —
  build-time guard,任何 enum 漂移即为 build break。

### 1.2 三种 envelope 形态

| 形态 | 出处 | 用途 |
|---|---|---|
| `Envelope<T>`(nacp-core) | RPC 内部 | worker ↔ worker / DO 内部 service binding RPC 返回 |
| `OrchestratorAuthRpcResult<T>`(本包) | RPC 内部 | orchestrator-auth ↔ orchestrator-core 的 typed RPC return,实际是 `Envelope<T>` 同 shape |
| `FacadeEnvelope<T>`(本包 facade-http.ts) | 对外公网 | facade-http-v1 公网 HTTP wire(`{ok, data, trace_uuid}` / `{ok:false, error:{code,status,message}, trace_uuid}`) |

**这不是三种独立 envelope** — 后两者**内部**结构与第一者等价,只是 zod schema
名字不同。public wire(`FacadeEnvelope`)需要的额外字段(`trace_uuid`)由
`facadeOk()` / `facadeError()` helper 加上。

### 1.3 helper:auth → facade 重写

`facadeFromAuthEnvelope(authEnvelope, traceUuid)` 接受一个 auth 的
`Envelope<T> | OrchestratorAuthRpcResult<T>`,输出 `FacadeEnvelope<T>`。
内部走 `FacadeErrorCodeSchema.safeParse(authEnvelope.error.code)`:
- 若 code 匹配 facade enum,直接传过去
- 若 code 不匹配(理论上不会发生 — 由 `_authErrorCodesAreFacadeCodes`
  断言保证),fallback 到 `internal-error`

`envelopeFromAuthLike()` 是反向 helper,主要用于把 legacy `{error, message}`
形态包成 `Envelope<T>`(per ZX2 P2-04 包装路径,不在 ZX5 改动)。

---

## 2. 公开 API

```ts
// Imports from this package(façade-http-v1 公网 wire)
import {
  FacadeErrorCodeSchema,
  type FacadeErrorCode,
  type FacadeEnvelope,
  type FacadeError,
  facadeOk,
  facadeError,
  facadeFromAuthEnvelope,
} from "@haimang/orchestrator-auth-contract";

// Imports from this package(internal RPC contract)
import {
  AuthErrorCodeSchema,
  type AuthErrorCode,
  AccessTokenClaimsSchema,
  type AccessTokenClaims,
  type OrchestratorAuthRpcService,
  type OrchestratorAuthRpcResult,
} from "@haimang/orchestrator-auth-contract";
```

---

## 3. 升级 / 演进

修改 `FacadeErrorCodeSchema` 时:
1. **加新 code**:在 enum 数组末尾添加;`_*AreFacadeCodes` 断言不会 break
2. **加新 `RpcErrorCode`**(在 `nacp-core/rpc.ts`):必须**同步**在
   `FacadeErrorCodeSchema` 中加同名 entry,否则
   `_rpcErrorCodesAreFacadeCodes` 在 build 时报 `Type 'X' is not assignable
   to type 'never'`,迫使同步
3. **删 code**:不允许 — 公网 wire 是 backward-compat 契约

---

## 4. 关联文档

- `packages/nacp-core/README.md` — `Envelope<T>` / `RpcErrorCode` 上游 truth
- `docs/transport/transport-profiles.md` — `facade-http-v1` 在 5 大 profile 中的位置
- `docs/action-plan/zero-to-real/ZX5-protocol-hygiene-product-surface-architecture.md` Lane C — 本包的 ZX5 演进背景

---

> 文档版本: ZX5 Lane C C5 — 2026-04-28 — Opus 4.7
> 关联 Q7 owner answer: facade/public envelope 的单一真相放回 contract package 自身

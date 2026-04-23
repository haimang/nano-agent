# W3 Absorption Pattern Spec

> 状态：pre-worker-matrix / W3 配套子文档  
> 配套主文：`W3-absorption-blueprint-and-dryrun.md`、`W3-absorption-map.md`

## 1. 文档目的

map 解决“去哪里”，blueprint 解决“这个代表样本怎么搬”。  
本文件解决的是第三个问题：

**当 worker-matrix 开始真实吸收时，哪些共通模式必须统一，否则不同 worker 会各自发明一套迁移方法。**

## 2. Pattern 1 — owner-first，不做“半吸收半共享”的暧昧状态

每个 absorption unit 在某个时点只能有一个主 owner：

- `agent-core`
- `bash-core`
- `context-core`
- `filesystem-core`

在共存期里，旧 package 可以继续存在，但它只是**迁移来源 / 兼容来源**，不再和目标 worker 共同声称自己是长期 owner。

## 3. Pattern 2 — contract 留在 NACP，runtime 去 worker

worker absorption 期间，不得把以下内容跟着 package 一起私有化：

1. `nacp-core` 的 canonical wire vocabulary
2. `nacp-session` 的 session edge legality
3. W1 RFC 里冻结的跨 worker contract 方向

也就是说：**worker 吸收的是 runtime residual，不是再造协议中心。**

## 4. Pattern 3 — split package 先按职责切，不按文件数量切

`workspace-context-artifacts` 是最典型样本。它的拆分顺序必须是：

1. 先分清 context / filesystem / mixed helper 三类职责
2. 再决定文件挪哪里

不能因为“某个目录文件多”就把它当成一个整体塞给单一 worker。

## 5. Pattern 4 — 直接 import 少，不代表吸收简单

`capability-runtime` 的代表意义就在这里：

- **package.json `dependencies: {}`(实测零)**;src/test 中也没有任何 `@nano-agent/*` 或 `@haimang/*` 形式的 cross-package import
- 但 fake-bash surface、policy gate、partial disclosure、remote target seam、honest-partial 纪律都很重
- source + test LOC 合计 ~9473,体量本身也足够 battle-test 搬迁流水线

所以 worker-matrix 期间不能用 "npm graph 很轻" 或 "dependencies 空" 来判断吸收复杂度。**真正的循环引用 / 跨 worker seam 样本在 `workspace-context-artifacts` split,不在 capability-runtime**。

## 6. Pattern 5 — 共存期 bugfix 先修原包，再同步新落点

只要旧 package 仍是当前 consumer 的真实来源：

1. bugfix 先修原包
2. 如果已有 worker dry-run/landing，再同步过去

不要反过来只修 worker 侧副本，让旧 package 留着已知错误继续服务现有测试与 consumer。

## 7. Pattern 6 — root cross tests 继续留在 root

吸收后不要把所有测试都搬进 worker 包里。至少以下测试类型应继续留在仓库根：

1. protocol contract tests
2. cross-package / cross-worker contract tests
3. end-to-end / verification ladder tests

worker 内适合拥有的是：

- package-local unit tests
- deploy-shaped smoke
- worker-local integration tests

## 8. Pattern 7 — deprecated banner 不是 pre-worker-matrix 的工作

本阶段 blueprint 可以写清楚 deprecated 时机，但**不在现在提前加 banner**。  
真正加 `DEPRECATED` 的时点，应是 worker-matrix 中该 worker 完成真实吸收、consumer path 已切换之后。

## 9. Pattern 8 — honest partial / unsupported 语言必须原封保留

迁移时不能因为进了 worker 就把这些能力自动升格：

1. `mkdir`
2. restricted `curl`
3. `ts-exec`
4. readonly `git`
5. search bounded output

worker landing 只改变 owner 与部署位置，不改变成熟度 truth。

## 10. Pattern 9 — evidence sink owner 与 evidence builder owner 分开看

尤其在 `workspace-context-artifacts` split 场景中：

- evidence builder 可能跟随 context/filesystem slice 吸收
- 但 evidence sink / durable persistence owner 仍更接近 `agent-core` / eval plane

因此不要因为某个 helper 里有 `emit*Evidence()`，就机械断定整块代码都应归 `agent-core`。

## 11. Pattern 10 — blueprint 只解决 landing，不替代 action-plan

blueprint 必须回答：

1. 源路径去哪里
2. 依赖如何分
3. 测试如何承接
4. 哪些风险不在本次处理

但 blueprint **不应**承担：

1. 执行排期
2. phase checklist
3. rollout / rollback 脚本
4. code-review gate

这些属于后续 action-plan。

## 12. Pattern 11 — LOC → 时长经验系数(P1.A 实测回填,2026-04-23)

由 worker-matrix P1.A 批次 5 个 A-unit(A1-A5)的实测搬迁数据汇总:

| unit | src LOC | test LOC | 合计 LOC | 实测搬迁耗时(含 import 改写)|
|------|---------|----------|-----------|-----------------------------|
| A1 session-do-runtime | ~3000+(22 flat + do/ subdir)| ~3500+ | ~6500 | ~5 min(含 sed 双 pattern 路径 bug 修复)|
| A2 agent-runtime-kernel | ~1659 | ~1358(含 scenarios/)| ~3017 | ~3 min |
| A3 llm-wrapper | ~1483(含 adapters/ + registry/)| ~1638(含 integration/)| ~3121 | ~4 min(fixtures 需单独 copy + path refix)|
| A4 hooks | ~1598(含 runtimes/)| ~2839 | ~4437 | ~3 min |
| A5 eval-observability | ~2916(含 sinks/)| ~3895 | ~6811 | ~5 min(含 scripts/ + `TextDecoder ignoreBOM` 微调)|

**合计 P1.A 批次**:~23886 LOC / ~173 文件 / ~20 min 机械搬迁时长(不含 pair review)。

经验系数结论:
1. **机械 cp -r + sed 阶段**:单 session 可在 **~20 min / 20000 LOC** 内完成零跨包 import 的搬家
2. **加 ~30 min test drift 修复**(fixture / scripts / Workers 类型严格性)基本可达 "typecheck + test 全绿"
3. **PR review 往返**:按方案 2(2 sub-PR)估 ~1.5 周;按方案 3(3 sub-PR)估 ~2 周
4. **LOC→时长公式**(仅机械搬家):`≈ LOC × 0.05 ms/line`(cp + sed)+ `≈ LOC × 0.5 ms/line`(config / type drift)
5. **B1(capability-runtime, ~9473 LOC)预估**:机械搬家 ~10 min + fix ~30 min;PR review ~3-5 天(review 负担占大头)

## 13. Pattern 12 — 可执行流水线样板(P1.A 实测回填,2026-04-23)

三段式流水线(bulk copy → sed rewrite → verify):

### 13.1 Stage 1 — bulk copy

```bash
cd /workspace/repo/nano-agent/workers/agent-core
# 删除 W4 stub(仅首 sub-PR,一次性)
rm src/nano-session-do.ts src/types.ts
mkdir -p src/{host,kernel,llm,hooks,eval} test/{host,kernel,llm,hooks,eval}
# 整包 cp -r(保持子目录 do/ adapters/ registry/ runtimes/ sinks/)
cp -r ../../packages/session-do-runtime/src/*   src/host/
cp -r ../../packages/agent-runtime-kernel/src/* src/kernel/
cp -r ../../packages/llm-wrapper/src/*          src/llm/
cp -r ../../packages/hooks/src/*                src/hooks/
cp -r ../../packages/eval-observability/src/*   src/eval/
# tests 对称
cp -r ../../packages/session-do-runtime/test/*   test/host/
# ... (kernel/llm/hooks/eval 同构)
# fixtures + scripts(若原包有)
mkdir -p fixtures/llm && cp -r ../../packages/llm-wrapper/fixtures/* fixtures/llm/
mkdir -p scripts/eval && cp -r ../../packages/eval-observability/scripts/* scripts/eval/
```

### 13.2 Stage 2 — sed 路径改写(避免双 apply)

```bash
# 每个 subdir 独立跑两步 + 修复
for sub in host kernel llm hooks eval; do
  find test/$sub -name "*.ts" -exec sed -i "s|from \"\.\./src/|from \"../../src/$sub/|g" {} +
  find test/$sub -name "*.ts" -exec sed -i "s|from \"\.\./\.\./src/|from \"../../../src/$sub/|g" {} +
  # 修复双 apply 的 $sub/$sub/ 重复
  find test/$sub -name "*.ts" -exec sed -i "s|src/$sub/$sub/|src/$sub/|g" {} +
  # flat 级被误升 3 dots 的场景
  find test/$sub -maxdepth 1 -name "*.test.ts" -exec sed -i "s|\.\./\.\./\.\./src/$sub/|../../src/$sub/|g" {} +
done
# 跨包 import → published scope
find test -name "*.test.ts" -exec sed -i '
  s|from "\.\./\.\./\.\./nacp-session/src/stream-event.js"|from "@haimang/nacp-session"|g
  s|from "\.\./\.\./nacp-session/src/stream-event.js"|from "@haimang/nacp-session"|g
  s|from "\.\./\.\./\.\./nacp-core/src/messages/\(system\|hook\).js"|from "@haimang/nacp-core"|g
  s|from "\.\./\.\./nacp-core/src/messages/\(system\|hook\).js"|from "@haimang/nacp-core"|g
  s|from "\.\./\.\./\.\./workspace-context-artifacts/src/refs.js"|from "@nano-agent/workspace-context-artifacts"|g
' {} +
# fixture / external-seams 根目录引用按深度 +1
sed -i 's|"\.\./\.\./\.\./\.\./test/fixtures/|"../../../../../test/fixtures/|g' test/*/integration/*.test.ts
```

### 13.3 Stage 3 — verify

```bash
cd /workspace/repo/nano-agent && pnpm install          # deps 收敛
cd workers/agent-core
pnpm typecheck                                          # 必须绿
pnpm test                                               # P1.A 实测 92 test files / 992 tests
pnpm deploy:dry-run                                     # wrangler shape + bindings 合法
cd /workspace/repo/nano-agent
node --test test/*.test.mjs                            # root guardians(per R4 不搬)
npm run test:cross && pnpm -r run test                 # 全仓回归
```

### 13.4 P1.A 实测踩坑清单

| 坑 | 症状 | 修复 |
|----|------|------|
| sed 双 pattern 顺序错位 | `src/sub/sub/` 或 flat 级升 3 dots | 分两步 sed + 单独修 flat 级回退 |
| Workers 类型严格性 | `TextDecoder` 少 `ignoreBOM` | 补参数,不改语义 |
| fixtures/scripts 没 cp | `ENOENT fixtures/stream/...` | 单独 cp 到 worker-level |
| smoke test hardcoded W4 shape | `role: session-do-stub` 断言失败 | 更新到 absorbed shape + `absorbed_runtime: true` |
| 跨包 relative path 失效 | `../../../nacp-session/src/...js` | 改 `@haimang/nacp-session` published scope |

## 14. 一句话 verdict

这份 pattern spec 的价值，是让 worker-matrix 的实现从第一天起就建立在统一迁移方法上：**同一套 owner discipline、同一套 test discipline、同一套 partial disclosure discipline、同一套 deprecated timing discipline。** Pattern 11 + 12(P1.A 实测回填)证明该方法论在真实代码层可机械化执行;Pattern 10(循环引用)保留由 P3/P4 WCA split 回填。

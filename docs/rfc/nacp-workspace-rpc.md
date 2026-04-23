# RFC: `workspace.fs.*` Remote RPC（方向性执行版）

> 状态：`executed directional RFC`
> 当前阶段：**W1 只冻结方向，不冻结 wire 实装**
> 直接上游：`docs/design/pre-worker-matrix/W1-cross-worker-protocols.md`
> 关联 RFC：
> - `docs/rfc/remote-compact-delegate.md`
> - `docs/rfc/evidence-envelope-forwarding.md`
> - `docs/rfc/nacp-core-1-4-consolidation.md`
> 直接下游：worker-matrix P0、`filesystem-core` / `bash-core` 细化设计

## 1. 为什么现在要有这份 RFC

`filesystem-core` 已经有真实 substrate：`MountRouter`、`WorkspaceNamespace`、`MemoryBackend`、`ReferenceBackend`、`tenant/ref/key` law，以及 fake-bash consumer 路径都已经存在于仓内代码中。当前缺的不是“文件系统语义”，而是**如果以后把 filesystem 抽成独立 worker，跨 worker 最小 RPC 应该长什么样**。

当前事实锚点（W1 实施时实际对照）：

- `packages/workspace-context-artifacts/src/mounts.ts`
- `packages/workspace-context-artifacts/src/namespace.ts`
- `packages/workspace-context-artifacts/src/backends/memory.ts`
- `packages/workspace-context-artifacts/src/backends/reference.ts`
- `packages/capability-runtime/src/capabilities/filesystem.ts`
- `packages/nacp-core/src/transport/cross-seam.ts`
- `packages/nacp-core/src/storage-law/{constants.ts,builders.ts}`
- `docs/design/pre-worker-matrix/W1-cross-worker-protocols.md`

因此，这份文档只回答一个问题：**未来若 `agent-core / bash-core` 通过 service binding 调 `filesystem-core`，最小 `workspace.fs.*` surface 应如何表达，才能不重发明第二套文件系统语义。**

## 2. Reality 结论

W1 对 workspace seam 的判断只有三条：

1. **今天存在真实 workspace substrate，但不存在已 shipped 的 `workspace.fs.*` NACP family。**
2. **因此 W1 要做的是冻结 future message-family 方向，而不是在 pre-worker-matrix 里提前写 schema / helper / matrix entry。**
3. **未来如果真的代码化，仍必须走 NACP envelope + W0 shipped cross-seam / storage-law，而不是发明 side-channel RPC。**

## 3. 设计原则

1. **RPC 只暴露 namespace truth，不暴露 POSIX 幻觉。**  
    不承诺真实 inode、fd、watcher、symlink、chmod、mtime fidelity。

2. **path law 继续以 workspace namespace 为准。**  
   路径解释、mount 归属、`/_platform/**` 保留命名空间，都由 `WorkspaceNamespace` 语义仲裁，而不是由远端 worker 自行再定义一套 shell 语义。

3. **ref / tenant law 继续沿用现有 NACP / storage truth。**  
   任何大对象、promotion、reference-backed write，都继续遵守现有 `tenant*` / `NacpRef` / storage-topology 约束。

4. **W1 不引入 search / git / bash plan surface。**  
    本 RFC 只关心 `workspace.fs.*`。`rg`、`git`、`curl`、`ts-exec` 仍属于 `bash-core` 或更高层 capability 设计，不塞进 filesystem RPC。

## 4. 建议的最小消息族

> 说明：以下是 **推荐命名**，用于 worker-matrix P0 继续细化；W1 不要求在 `@nano-agent/nacp-core` 立即 ship。

| 家族 | 目标 | 最小 body 关注点 |
|---|---|---|
| `workspace.fs.read.request/response` | 读取文件 | `path`、`encoding?`、`max_bytes?` |
| `workspace.fs.write.request/response` | 写入文件 | `path`、`content` 或 `ref`、`overwrite` |
| `workspace.fs.list.request/response` | 列目录 | `path`、`recursive?`、`limit?` |
| `workspace.fs.stat.request/response` | 查询条目 | `path` |
| `workspace.fs.delete.request/response` | 删除条目 | `path`、`recursive?` |
| `workspace.fs.mkdir.request/response` | 建目录 | `path`、`parents?` |

### 4.1 推荐 body 轮廓

```json
{
  "path": "/workspace/src/index.ts",
  "request_id": "uuid",
  "max_bytes": 65536
}
```

```json
{
  "path": "/workspace/src/index.ts",
  "content_ref": "nacp-ref-or-inline",
  "overwrite": true
}
```

冻结要点只有三条：

1. **path 必须是 canonical workspace path**  
2. **大 payload 优先允许 `ref` 路径，而不是强迫 inline**  
3. **错误必须 honest partial / explicit failure，不允许 success-shaped swallow**

## 5. 与现有代码 substrate 的映射

> 表内"当前最接近的本地 substrate"列严格对照 `packages/workspace-context-artifacts/src/namespace.ts` 的已 shipped 方法;**无现成 substrate 的 op 显式标记为 "W1 proposes new op" 而不是虚构方法名。**

| RPC 动作 | 当前最接近的本地 substrate | 备注 |
|---|---|---|
| read | `WorkspaceNamespace.readFile()` / backend read | 直接映射 |
| write | `WorkspaceNamespace.writeFile()` + `ReferenceBackend` promotion path | 需要保留 `ValueTooLargeError` / ref path |
| list | `WorkspaceNamespace.listDir()` / mount router traversal | 目录语义来自 namespace，不来自 shell |
| stat | `WorkspaceNamespace.stat()` | 继续返回 honest partial metadata |
| delete | `WorkspaceNamespace.deleteFile()` | 删除规则继续受 mount/backend 约束 |
| mkdir | **(W1 proposes new op — 当前 namespace 无对应方法)** | worker-matrix P0 / filesystem-core 实装时需要新增 backend 级 mkdir;本 RFC 只冻结 op 存在方向,不冻结方法名 |

## 6. 为什么 W1 不实装这组协议

1. **缺少 live remote worker 证据。** 现在只有 in-process `WorkspaceNamespace` substrate，没有已部署的 `filesystem-core` worker 来证明第一波究竟需要几个 op、哪些字段、哪些错误码。
2. **W1 的职责是冻结方向，不是替 worker-matrix P0 抢跑。** 如果现在就写 Zod schema / registry / helper，风险是把 today in-process 细节过早固化成远端协议。
3. **W0 已提供需要复用的 protocol truth。** 真正需要先行冻结的只是“未来仍走 NACP envelope + cross-seam + storage-law”，而不是现在就把 `workspace.fs.*` 落成 shipped surface。

## 7. 明确不在本 RFC 中冻结的内容

以下能力**不在**本阶段 `workspace.fs.*` RFC 中承诺：

1. `watch`, `tail -f`, inotify-like stream
2. symlink / hardlink / permission bits / owner bits
3. file descriptor / stream handle / append-only session
4. shell glob expansion
5. `rg` / grep / git / tar / unzip 等 higher-level capability
6. 跨 worker 批量事务写入

## 8. 为什么这样取舍

### 6.1 不是直接暴露 fake bash

因为 fake bash 是给 LLM 的 compatibility surface；`workspace.fs.*` 是给 worker-to-worker 的 typed seam。两者必须分层，否则会把 CLI 幻觉直接冻结成内部协议。

### 6.2 不是一次把所有文件系统能力都协议化

因为现在仓内已有真实 namespace substrate，但还没有独立 deploy 的 `filesystem-core` worker。先冻结最小读写列删建查，能让 worker-matrix P0 有稳定起点，又不会提前把 watcher / stream / POSIX 幻觉写死。

## 9. 进入 worker-matrix P0 前的最低对齐要求

1. 路径 law 以 `WorkspaceNamespace` 为唯一仲裁源  
2. `mkdir` 继续标为 `partial`，不能在 RFC 文本里偷偷升格  
3. `ref` / `tenant` / storage placement 不得重发明第二套 key law  
4. 如果要增 `search`，必须单独起 `workspace.search.*` 或保留在 `bash-core`；不要塞进本 RFC

## 10. 最终判断

这份 RFC 的价值不在于“现在就做远程文件系统”，而在于**先把 filesystem-core 的未来 service-binding seam 限制在一条很窄、很诚实的 typed path 上**。这样 worker-matrix 后续 phase 真正开始 remote split 时，就不会一边复用 `WorkspaceNamespace`，一边又在跨 worker 边界重新发明 shell-shaped file protocol。

# Technical Plan / 技术方案：NTS 节点工具隔离（子 Agent 工具集修复）

## Requirement Baseline / 需求基线

- **对应需求文档**：`requirements.md` §3 类型约束、§4 调度规范
- **前置方案**：`technical-plan.md`（AgentHarness 独立实现，PLS + NTS + delegate）
- **问题来源**：Gateway 实机验证 — 子 Agent 未获得与节点类型匹配的 toolsAllow（叶节点缺 exec/read 等）
- **本方案覆盖范围**：
  1. 节点工具集（NTS）与 core `inheritedToolAllow` 冲突
  2. `nodeDir` 解析对 session `label` 的依赖与脆弱性
  3. hierarchical 内层 delegate 与 core tool policy pipeline 的边界
- **非目标**（本方案不做）：
  - 不重写 core `sessions_spawn` / `subagent-spawn.ts` 主流程
  - 不修改 NTS 四组矩阵定义（root/branch/leaf 权限表已在 requirements 定稿）
  - 不引入 per-node 自定义工具配置文件（仍由 nodeType → group 硬编码）

---

## Problem Statement / 问题陈述

### 设计预期

各节点工具集**相互独立**；子节点可拥有父节点没有的工具（例：leaf 有 `execution`，root 仅有 `dispatch + system`）。

### 观测现象

Gateway 上 spawn 链（root → branch → leaf）运行时，子 session 的工具列表不符合 NTS 矩阵：叶节点看不到 `exec`/`read`，或整链被当成 root/branch 工具集。

### 根因（已代码验证）

#### 根因 A：core inherited 工具继承 vs NTS 扩权（主因）

```
hierarchical.runAttempt
  → listToolNamesForNodeType(leaf) → ctx.toolsAllow (含 exec/read)
  → delegateRunAttempt(..., toolsAllow: ctx.toolsAllow)
       → runEmbeddedAttempt
            → createOpenClawCodingTools()
                 → tool policy pipeline 含 step: inherited tools
                 → 读取 session.inheritedToolAllow（spawn 时写入 ≈ 父节点有效工具面）
                 → 父无 exec → pipeline 先删掉 exec
            → applyEmbeddedAttemptToolsAllow(allTools, ctx.toolsAllow)
                 → 只能过滤「已构造」工具，无法补回被 pipeline 删掉的工具
```

相关代码：

| 位置                                 | 行为                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `src/agents/subagent-spawn.ts`       | spawn 时 `inheritedToolAllowPatch(ctx.inheritedToolAllowlist)` 写入子 session |
| `src/agents/agent-tools.ts`          | pipeline step `{ policy: inheritedToolPolicy, label: "inherited tools" }`     |
| `extensions/hierarchical/harness.ts` | 仅传 `toolsAllow`，未抑制 inherited step                                      |

**结论**：NTS 与 core「子 ⊆ 父工具面」语义冲突；当前实现下 **NTS 不能单独生效**。

#### 根因 B：nodeDir 解析缺 label → 节点类型判错（次因）

`node-path-resolver.ts` 沿 `spawnedBy` 链 walk，**每层必须有 session `label`**；缺失时 `return parent`（停在父节点）。

| 缺失 label 的 session | 解析结果 | NTS 工具集            |
| --------------------- | -------- | --------------------- |
| branch (architect)    | root     | dispatch + system (9) |
| leaf                  | branch   | dispatch + query (8)  |

脆弱点：

- `buildDirectChildSessionPatch` **不写** `label`（仅 `spawnedBy` 等）
- `EmbeddedRunAttemptParams` **无** `label` 字段；harness 未作 fallback
- 仅依赖 `readSession` → `getSessionEntry({ sessionKey })`

自动化测试用 mock `readSession` 且 label 齐全，**未覆盖 Gateway 真实 store 时序**。

---

## Current Architecture（相关事实）

```text
Turn 生命周期（hierarchical session）

  runAgentHarnessAttempt
    → hierarchical.runAttempt          [外层：PLS + NTS + supplement]
         → buildHierarchicalAttemptContext
              → resolveHierarchicalNodeContext (spawnedBy + label)
              → detectNodeType → listToolNamesForNodeType
              → intersectToolAllowLists(nts, config.toolsAllow)
         → delegateRunAttempt
              agentHarnessRuntimeOverride: "openclaw"
              toolsAllow: ctx.toolsAllow
    → runEmbeddedAttempt               [内层：core 原生]
         → createOpenClawCodingTools (inherited pipeline)
         → applyEmbeddedAttemptToolsAllow
```

NTS 矩阵（已定稿）：

| nodeType | dispatch | execution | query | system |
| -------- | -------- | --------- | ----- | ------ |
| root     | ✅       | ❌        | ❌    | ✅     |
| branch   | ✅       | ❌        | ✅    | ❌     |
| leaf     | ❌       | ✅        | ✅    | ❌     |

---

## Solution Options / 方案候选

### 维度 1：如何解决 inherited 与 NTS 冲突

#### 方案 1A（推荐 ✅）：插件 `subagent_spawned` 回写 NTS allow-list

hierarchical 插件注册 `subagent_spawned` hook：

1. 从 event 取 `childSessionKey`、`label`、`requesterSessionKey`
2. 用与 `node-path-resolver` 相同逻辑解析 **子节点** `nodeDir` / `nodeType`
3. `patchSessionEntry`：将子 session 的 `inheritedToolAllow` **覆写为** `listToolNamesForNodeType(nodeType)`（可选清空 `inheritedToolDeny`）

效果：core pipeline 的 inherited step 与 NTS **同表**，不再裁掉 leaf 的 execution 工具。

- **优点**：零 core 改动；与现有 spawn 机制兼容；子 session 持久状态自洽
- **缺点**：依赖 hook 时序（须在 child 首次 turn 的 tool 构造前完成）；需在 hook 内复用 node-path 逻辑
- **风险**：低（hook 失败时 spawn 仍成功，但工具集回退旧行为 — 需日志 + 测试）

#### 方案 1B：hierarchical turn 前临时 patch session 清除 inherited

每次 `runAttempt` 在 delegate 前 `patchSessionEntry` 清空 `inheritedToolAllow`。

- **优点**：不依赖 spawn hook 时序
- **缺点**：篡改持久 session 元数据；与非 hierarchical 路径耦合；并发 turn 有风险
- **结论**：**不采用**

#### 方案 1C：core 增加 `toolAllowlistAuthority: "runtime"`

`EmbeddedRunAttemptParams` 新增可选字段；当 `toolsAllow` 由 harness 注入且 authority=`runtime` 时，`createOpenClawCodingTools` **跳过** inherited/subagent allow pipeline step，仅保留 global deny 安全网。

- **优点**：语义清晰；单一裁决点；不污染 session store
- **缺点**：需改 core `agent-tools.ts` / `attempt.ts`（小 seam）
- **结论**：**最佳长期形态**；可作为 1A 稳定后的 follow-up，或若 1A hook 时序无法保证则升级为此方案

#### 方案 1D：spawn 时不写 inheritedToolAllow（改 core subagent-spawn）

- **缺点**：违反「非目标：不改 spawn 主流程」；影响所有非 hierarchical 子 agent
- **结论**：**废弃**

---

### 维度 2：如何稳定 nodeDir / label

#### 方案 2A（推荐 ✅）：`subagent_spawned` hook 持久化 label

同一 hook 内：若 store 条目缺 `label` 且 event.label 存在 → `patchSessionEntry({ label })`。

- **优点**：与 1A 同 hook、一次 patch；修复 spawn lineage patch 不写 label 的缺口
- **缺点**：仅覆盖 spawn 后；历史 session 需 doctor/手动 patch

#### 方案 2B：hierarchical harness 增加 label fallback

`buildHierarchicalAttemptContext` 增加可选 `label` 参数；`runAttempt` 从以下来源按优先级读取：

1. `readSession(sessionKey).label`
2. params 上游传入（若未来 core 暴露）
3. subagent registry 查询（`childSessionKey` → spawn 记录中的 label）

- **优点**：turn 时双保险
- **缺点**：registry 依赖需验证 API 是否在 plugin runtime 可用
- **结论**：与 2A **组合采用**（2A 为主，2B 为 read fallback）

#### 方案 2C：改 core `buildDirectChildSessionPatch` 写 label

- **优点**：源头修复
- **缺点**：core 改动；label 在 lineage patch 阶段可能尚未 final
- **结论**：可选 follow-up PR core；本方案不阻塞

---

### 维度 3：delegate 边界（文档化 + 测试）

明确 contract：

| 层                      | 职责                                                                             |
| ----------------------- | -------------------------------------------------------------------------------- |
| 外层 hierarchical       | PLS、node 定位、NTS `toolsAllow`、Tool Restrictions 文案                         |
| 内层 openclaw           | 模型调用、tool 执行；**toolsAllow 以 NTS 为权威**（经 1A/1C 保证 pipeline 一致） |
| intersectToolAllowLists | 仅与 **config** `toolsAllow` 求交，不得用 inherited 收窄                         |

---

## Recommended Solution / 推荐方案

**组合：1A + 2A + 2B（插件内闭环）**，必要时 follow-up **1C**。

### 实现概要

#### 新增模块（插件内）

| 文件                                             | 职责                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `extensions/hierarchical/subagent-spawn-hook.ts` | 注册 `subagent_spawned`：解析子 nodeType、patch `label` + `inheritedToolAllow`     |
| `extensions/hierarchical/spawn-node-context.ts`  | 从 `requesterSessionKey` + `childLabel` 解析 `nodeDir`（复用 resolver 逻辑，可测） |

#### 修改模块

| 文件                                            | 变更                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| `extensions/hierarchical/index.ts`              | `register(api)` 内注册 spawn hook                                                      |
| `extensions/hierarchical/harness.ts`            | `runAttempt` 将 `sessionKey` 传入 context（已有）；可选读 registry fallback            |
| `extensions/hierarchical/node-path-resolver.ts` | 导出 `resolveChildNodeContext(parentSessionKey, childLabel, readSession)` 供 hook 使用 |
| `requirements.md`                               | 补充 NTS 权威性与 inherited 关系（见下）                                               |
| `README.md` / `GATEWAY_VALIDATION.md`           | 增加「子 agent 工具集验收」步骤                                                        |

#### hook 伪代码

```typescript
api.registerHook("subagent_spawned", async (event, ctx) => {
  if (!isHierarchicalRequester(ctx.requesterSessionKey)) return;

  const childLabel = event.label?.trim();
  if (!childLabel) return;

  const nodeContext = await resolveChildNodeContext({
    workspaceDir: resolveWorkspaceFromRequester(ctx.requesterSessionKey),
    requesterSessionKey: ctx.requesterSessionKey,
    childLabel,
    readSession: createSessionReader(api.runtime),
  });

  const nodeType = await detectNodeType(nodeContext.nodeDir, nodeContext.workspaceRoot);
  const ntsAllow = listToolNamesForNodeType(nodeType);

  await patchChildSessionForHierarchical({
    childSessionKey: event.childSessionKey,
    label: childLabel,
    inheritedToolAllow: ntsAllow,
    inheritedToolDeny: [], // 或 omit：不继承父 deny
  });
});
```

#### harness delegate（不变）

继续：

```typescript
delegateRunAttempt({
  ...params,
  agentHarnessRuntimeOverride: "openclaw",
  toolsAllow: ctx.toolsAllow,
  extraSystemPrompt: ctx.extraSystemPrompt,
});
```

1A 保证 `ctx.toolsAllow` 与 core pipeline 输入一致。

---

## Requirements Sync / 需求同步（写入 requirements.md）

新增条款（实现前须合并进 `requirements.md`）：

1. **NTS 权威性**：hierarchical harness 管理的 session turn 上，**节点类型对应的工具分组为唯一 allow 来源**；不得因父节点工具面而剥夺子节点 execution/query 等分组。
2. **与 core inherited 的关系**：spawn 时 core 仍可能写入 `inheritedToolAllow`；hierarchical 插件须在子 session 首次 run 前将其**对齐为 NTS**（hook 或等价机制）。
3. **nodeId 持久化**：`sessions_spawn.label`（nodeId）须可在子 session store 上解析；缺失时 hierarchical 须在 spawn hook 或 turn fallback 中补全。
4. **独立矩阵**：root / branch / leaf 工具集无包含关系要求（leaf 可有 root 没有的 execution 工具）。

---

## Test Plan / 验证计划

### 单元测试（插件）

| #   | 场景                         | 断言                                                          |
| --- | ---------------------------- | ------------------------------------------------------------- |
| T1  | hook：architect spawn        | child `inheritedToolAllow` = branch 8 工具；`label=architect` |
| T2  | hook：security-auditor spawn | `inheritedToolAllow` 含 `exec`,`read`；不含 `sessions_spawn`  |
| T3  | hook：无 label               | no-op，不 patch                                               |
| T4  | spawn-node-context           | requester=root + label=architect → nodeDir 正确               |
| T5  | 回归 NTS 矩阵                | root 9 / branch 8 / leaf 19                                   |

### 集成测试

| #   | 场景                                                    | 断言                                                               |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| I1  | `buildHierarchicalAttemptContext` + mock store 无 label | fallback 后 nodeType 正确（2B）                                    |
| I2  | 模拟 inheritedToolAllow=root(9) + leaf nodeType         | delegate 后 effective tools 含 exec（hook 已对齐则 pipeline 通过） |

### Gateway 实机（GATEWAY_VALIDATION.md 增补）

1. spawn `label: "architect"` → 子 turn Tooling 无 exec，有 sessions_spawn
2. architect spawn `label: "security-auditor"` → 子 turn Tooling 有 exec/read，无 sessions_spawn
3. 检查 dev store 子 session 字段：`label`、`inheritedToolAllow` 与 NTS 一致

---

## Implementation Phases / 实施阶段

| 阶段            | 内容                                 | 产出                           |
| --------------- | ------------------------------------ | ------------------------------ |
| **P0 文档**     | 合并 requirements 条款；本方案评审   | requirements + 本文件 approved |
| **P1 hook**     | `subagent_spawned` + session patch   | T1–T4 绿                       |
| **P2 fallback** | harness label/registry fallback      | I1 绿                          |
| **P3 实机**     | GATEWAY_VALIDATION 子 agent 工具清单 | 实机截图/日志                  |
| **P4 可选**     | core `toolAllowlistAuthority`（1C）  | 若 hook 时序仍有问题           |

---

## Risks & Mitigations / 风险

| 风险                                     | 影响                      | 缓解                                                    |
| ---------------------------------------- | ------------------------- | ------------------------------------------------------- |
| hook 晚于 child 首次 tool 构造           | 首 turn 仍错              | 验证 spawn 调用顺序；不行则上 1C                        |
| patch inherited 影响非 hierarchical 混用 | 同 workspace 非层级 spawn | hook 内 `isHierarchicalRequester` 门控                  |
| NTS 新增工具未入 TOOL_GROUP_MAP          | 全节点不可见              | 保持 map 与 requirements 同步；单测 guard               |
| config toolsAllow 与 NTS 求交过窄        | 节点工具被 config 剪掉    | 文档说明；operator 勿对 hierarchical agent 配过窄 allow |

---

## Decision Record / 决策记录

| 决策              | 选择               | 理由                                     |
| ----------------- | ------------------ | ---------------------------------------- |
| inherited vs NTS  | 1A hook 对齐 store | 插件边界、零 core 改动、与 pipeline 兼容 |
| label 持久化      | 2A + 2B            | 修复 store 缺口 + turn fallback          |
| core seam         | 1C 暂缓            | 1A 足够则不做；保留升级路径              |
| 不改 spawn 主流程 | 保持               | 符合 requirements 非目标                 |

---

## References / 参考

- `extensions/hierarchical/node-tool-registry.ts` — NTS 矩阵
- `extensions/hierarchical/node-path-resolver.ts` — spawn 链解析
- `extensions/hierarchical/harness.ts` — delegate 注入点
- `src/agents/subagent-spawn.ts` — inheritedToolAllow 写入
- `src/agents/agent-tools.ts:1153-1184` — inherited pipeline step
- `src/plugins/hook-types.ts` — `subagent_spawned` event（含 `label`）

---

## Approval / 批准

- [ ] 需求条款（NTS 权威性）合并进 `requirements.md`
- [ ] 方案 1A+2A+2B 批准
- [ ] 批准后开始 P1 代码实现

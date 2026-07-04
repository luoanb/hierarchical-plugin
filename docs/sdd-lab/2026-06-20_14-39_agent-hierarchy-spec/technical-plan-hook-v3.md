# Technical Plan / 技术方案：Hook 版层级 Agent（V3）

> **状态**：废案 / Abandoned  
> **废弃日期**：2026-07-04  
> **原因**：不采用 Hook-only V3 方案；继续基于以前的 harness / runtime 方案推进。  
> **后续方向**：回到前置方案，但必须补充并解决 auth 问题后才能进入代码开发。

---

## Requirement Baseline / 需求基线

- **对应需求文档**：`requirements.md`（PLS、NTS、spawn 链、`label` 约定不变）
- **前置方案**：
  - `technical-plan.md`（V2：registerAgentHarness + delegate OpenClaw runner）
  - `technical-plan-nts-runtime-isolation.md`（P1 `subagent_spawned` + P2 turn 前 NTS align）
- **动机**：V2 包装型 harness 引入 plugin harness 空 store、delegate、`discoverAuthStorage` SDK 依赖、auth reload 补丁；与官方 [Agent harness plugins](https://docs.openclaw.ai/plugins/sdk-agent-harness) 边界不符（harness 应用于 native session runtime，而非 prompt/工具策略注入）。
- **本方案覆盖范围**：
  1. 用 **plugin hooks** 替代 harness 实现 PLS + NTS turn 注入
  2. 保留并强化已有 `subagent_spawned` NTS 对齐
  3. 删除 delegate 路径及 `delegate-model-stores` 依赖
  4. **仅改 `extensions/hierarchical/`**，零 core 改动
- **非目标**：
  - 不重写 `sessions_spawn` / `subagent-spawn.ts`
  - 不新增 provider / 不替换 OpenClaw 模型 transport
  - 不在本迭代恢复独立 `agentRuntime.id: "hierarchical"` 开关（见「产品语义变更」）

---

## Decision / 方案决策

| 维度              | V2（现状）                                                      | V3（本方案）                                                |
| ----------------- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| 入口              | `registerAgentHarness` + `agentRuntime.id: "hierarchical"`      | `before_prompt_build` + `subagent_spawned`                  |
| 执行器            | 外层 harness → delegate `runOpenClawEmbeddedAttempt`            | 默认 OpenClaw embedded runner（无 delegate）                |
| PLS 注入          | `harness.runAttempt` → `extraSystemPrompt`                      | `before_prompt_build` → `appendSystemContext`               |
| NTS 工具          | harness 传 `toolsAllow` + session `inheritedToolAllow` 对齐     | **仅** session `inheritedToolAllow` 对齐（spawn + 每 turn） |
| Auth              | 需 reload `authStorage` / `modelRegistry`                       | 无；走标准 OpenClaw discovery                               |
| Core / SDK        | 依赖 `runOpenClawEmbeddedAttempt`、`discoverAuthStorage` export | **无**                                                      |
| `/status` Runtime | 显示 `hierarchical`                                             | 显示 `openclaw`（或当前 model 默认 runtime）                |

**原选定方案**：Hook-only 插件（V3）  
**当前决策**：废弃本方案，不再作为执行依据。  
**废弃理由**：实际推进方向回到以前的 harness / runtime 方案；本方案试图绕开 auth reload / discovery 问题，但不再符合当前路线。auth 问题应在旧方案上被显式建模、设计和验证，而不是通过 Hook-only 改写架构来规避。

---

## Target Architecture / 目标架构

```text
一次 agent turn（任意 session，含 subagent）

  runEmbeddedAgent / channel reply
    → resolve harness = openclaw（默认）
    → resolveModelAsync（完整 discovery，无 skipAgentDiscovery 空 store）
    → runEmbeddedAttempt
         │
         ├─ [hook] before_prompt_build          ← hierarchical 插件
         │     1. workspaceHasHierarchicalLayout? → 否则 no-op
         │     2. resolveHierarchicalNodeContext(sessionKey, spawnedBy, label)
         │     3. buildHierarchicalAttemptContext → supplement
         │     4. alignSessionToolPolicyForNts（turn 前 inherited 对齐）
         │     5. return { appendSystemContext: supplement }
         │
         ├─ createOpenClawCodingTools（inherited step 读已对齐的 inheritedToolAllow）
         └─ 常规模型调用 / 工具执行

  sessions_spawn 完成时
    → [hook] subagent_spawned                   ← 已有 P1
         → patchSessionEntry(inheritedToolAllow = NTS)
```

**与 V2 的关键差异**：不再有 `runAgentHarnessAttempt → hierarchical.runAttempt → delegate` 双层；PLS/NTS 在 OpenClaw 单条 attempt 路径上通过 hook 注入。

---

## Hook 契约

### 1. `before_prompt_build`（新增，PLS + turn 前 NTS）

**官方文档**：[Plugin hooks — Prompt and model hooks](https://docs.openclaw.ai/plugins/hooks)

| 项       | 说明                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------ |
| Event    | `{ prompt, messages }`                                                                                 |
| Context  | `PluginHookAgentContext`：`sessionKey`, `agentId`, `workspaceDir`, `runId`, …                          |
| 返回     | `{ appendSystemContext: supplement }`（推荐；利于 prompt caching，与 `prependContext` 区分）           |
| 启用条件 | `workspaceHasHierarchicalLayout(workspaceDir)` 为 true                                                 |
| 失败策略 | hook 抛错 → core 记录 warn，**不阻断** turn（与现有 hook 行为一致）；插件内部应 catch 读盘错误并 no-op |

**节点上下文解析**（复用现有模块，不新写逻辑）：

```typescript
// 伪代码
const entry = readSessionEntry(ctx.sessionKey);
const nodeContext = await resolveHierarchicalNodeContext({
  workspaceDir: ctx.workspaceDir,
  sessionKey: ctx.sessionKey,
  spawnedBy: entry?.spawnedBy ?? null,
  label: entry?.label,
  readSession,
});
const { supplement, toolsAllow } = await buildHierarchicalAttemptContext({ ... });
await alignSessionToolPolicyForNts({ sessionKey, ntsAllow: toolsAllow, ... });
return { appendSystemContext: supplement };
```

**说明**：`before_prompt_build` **不能**返回 `toolsAllow`。NTS 通过 **session store 的 `inheritedToolAllow`** 与 core inherited pipeline 对齐（与 `technical-plan-nts-runtime-isolation.md` 方案 1A 一致）。V2 harness 额外传 `toolsAllow` 作为双保险；V3 依赖 inherited 对齐充分性（已有 P1+P2 与 I1 E2E 覆盖）。

### 2. `subagent_spawned`（保留，spawn 时 NTS）

已实现：`subagent-spawn-hook.ts` + `handleHierarchicalSubagentSpawned`。V3 **不变**，继续在 child 首次 turn 前写入 NTS `inheritedToolAllow`。

### 3. 不使用的 hook

| Hook                 | 原因                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `before_agent_start` | 已 deprecated；用 `before_prompt_build`                                                                                |
| `before_tool_call`   | 仅能逐工具拦截，无法替代 allow-list 构造期策略；作 NTS 主路径不合适                                                    |
| `agent_turn_prepare` | 可用于 `prependContext`，但无 session entry 读取便利；`before_prompt_build` 时机更合适（工具构造前 + messages 已准备） |

### 4. Manifest / 配置

```json
{
  "id": "hierarchical",
  "activation": {
    "onStartup": false
  },
  "configSchema": {
    "type": "object",
    "properties": {
      "enabled": { "type": "boolean", "default": true }
    }
  }
}
```

- **删除** `onAgentHarnesses: ["hierarchical"]`
- 插件启用 + workspace 含 `hierarchical/prompt/` → 自动生效
- 可选 `plugins.entries.hierarchical.config.enabled: false` 关闭

**对话 hook 权限**：若部署环境对非 bundled 插件限制 prompt hook，需在 `plugins.entries.hierarchical.hooks.allowPromptInjection: true`（见 [hooks.md](https://docs.openclaw.ai/plugins/hooks)）。

---

## 产品语义变更（需确认）

| 项目            | V2                                                                         | V3                                                              |
| --------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 启用方式        | `agents.defaults.models["provider/model"].agentRuntime.id: "hierarchical"` | `plugins enable hierarchical` + workspace 有 `hierarchical/` 树 |
| Runtime 显示    | Hierarchical agent harness                                                 | OpenClaw（默认）                                                |
| 多 runtime 共存 | 与 codex 等按 model 切换                                                   | 与任意 provider/model 组合；hierarchical 为 **横切策略**        |

若必须保留 `agentRuntime.id: "hierarchical"` 显式开关，需 core 支持「策略 harness」或 hook 门控配置，**超出本方案范围**。

---

## 代码变更清单

### 新增

| 文件                                                | 职责                                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `extensions/hierarchical/prompt-build-hook.ts`      | `createBeforePromptBuildHandler(deps)`：布局检测 → context 构建 → NTS align → 返回 `appendSystemContext` |
| `extensions/hierarchical/prompt-build-hook.test.ts` | mock ctx/event；验证 no-op、supplement 注入、NTS patch 调用                                              |

### 修改

| 文件                                            | 变更                                                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `extensions/hierarchical/index.ts`              | 删除 `registerAgentHarness`；注册 `api.on("before_prompt_build", ...)`；保留 `subagent_spawned` |
| `extensions/hierarchical/openclaw.plugin.json`  | 删除 `onAgentHarnesses`；可选 `enabled` config                                                  |
| `extensions/hierarchical/README.md`             | 架构图改为 hook；删除 `agentRuntime` 配置说明                                                   |
| `extensions/hierarchical/GATEWAY_VALIDATION.md` | 删除 `pnpm build` / `runOpenClawEmbeddedAttempt` 依赖；改为 `plugins enable` + workspace 布局   |
| `extensions/hierarchical/VALIDATION.md`         | 更新测试矩阵                                                                                    |

### 删除（或弃用留一版 deprecated 重导出）

| 文件                                                    | 原因                                |
| ------------------------------------------------------- | ----------------------------------- |
| `extensions/hierarchical/harness.ts`                    | 无 harness                          |
| `extensions/hierarchical/harness.test.ts`               | 由 `prompt-build-hook.test.ts` 替代 |
| `extensions/hierarchical/delegate-model-stores.ts`      | 无 delegate                         |
| `extensions/hierarchical/delegate-model-stores.test.ts` | 同上                                |

### 保留（零逻辑变更或仅 import 路径调整）

- `prompt-loader.ts`、`node-tool-registry.ts`、`agent-children-scanner.ts`
- `node-path-resolver.ts`、`harness-context.ts`（可重命名为 `turn-context.ts`，非必须）
- `session-nts-align.ts`、`subagent-spawn-hook.ts`、`session-reader.ts`
- `e2e-spawn-chain.test.ts`、`integration.test.ts`、fixtures

### Core / SDK

- **回滚**（若已合入且仅 hierarchical 消费）：`src/plugin-sdk/agent-harness-runtime.ts` 中 `discoverAuthStorage` / `discoverModels` export
- V3 插件分支 **不依赖** 上述 export

---

## NTS 充分性论证（V3 无 harness `toolsAllow`）

沿用 `technical-plan-nts-runtime-isolation.md` 结论：

1. **Spawn 时**（P1）：`inheritedToolAllow` = `listToolNamesForNodeType(childNodeType)`
2. **每 turn 前**（P2，迁入 `before_prompt_build`）：对当前 session 再次 align，覆盖 label 迟到、store 时序问题
3. **Core pipeline**：`inherited tools` step 与 NTS 同表 → leaf 可保留 `exec`/`read`

V2 harness 的 `toolsAllow` 参数主要解决「inherited 未对齐时的第二道过滤」。P1+P2 正确时，第二道过滤冗余。E2E **I1**（`e2e-spawn-chain.test.ts`）继续作为回归守门。

**风险**：若 config 层 `tools.allow` 过窄，可能在 agent 策略阶段先于 inherited 裁切。缓解：文档说明 hierarchical workspace 不要对叶节点过度限制 `tools.allow`；或在 align 时写 `inheritedToolAllow = intersect(nts, configAllow)`（`harness-context` 已有 `intersectToolAllowLists`）。

---

## 实现步骤

### Phase 1：Hook 入口（可独立验证）

1. 实现 `prompt-build-hook.ts`
2. 改 `index.ts` 注册 hook（**暂保留** harness，双路径 feature flag `config.useHooks: true` 可选；或直接切换）
3. 单测：`prompt-build-hook.test.ts`

### Phase 2：移除 harness

1. 删除 `harness.ts`、`delegate-model-stores.ts` 及测试
2. 更新 manifest、README、GATEWAY_VALIDATION
3. 全量 `extensions/hierarchical/*.test.ts`

### Phase 3：文档与验收

1. 更新 `lifecycle.md` 状态
2. Gateway 实机：demo-workspace + spawn 链（见 GATEWAY_VALIDATION §5.3）
3. 确认 `/status` 不再要求 hierarchical runtime

---

## 验证计划

| ID  | 场景                 | 命令 / 方法                                        | 期望                                      |
| --- | -------------------- | -------------------------------------------------- | ----------------------------------------- |
| H1  | 根节点 PLS           | `prompt-build-hook.test.ts`                        | `appendSystemContext` 含 soul/agents slot |
| H2  | 无 hierarchical 布局 | hook + 空 workspace                                | 返回 void，不 patch session               |
| H3  | 子节点路径           | `e2e-spawn-chain.test.ts`                          | nodeDir / supplement 正确                 |
| H4  | Spawn NTS            | `subagent-spawn-hook` tests                        | child `inheritedToolAllow` = leaf NTS     |
| H5  | Turn NTS             | `prompt-build-hook` + session mock                 | turn 前 patch 与 spawn 一致               |
| H6  | 全量回归             | `npx tsx --test extensions/hierarchical/*.test.ts` | 全绿                                      |
| H7  | Gateway 烟测         | GATEWAY_VALIDATION                                 | 根/枝/叶工具与 prompt 符合矩阵            |

**删除的验证项**（V2 专有）：

- `runOpenClawEmbeddedAttempt is not exported`
- delegate `authStorage` 替换测试（`delegate-model-stores.test.ts`）

---

## 风险与缓解

| 风险                                             | 影响                                            | 缓解                                                                          |
| ------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| 失去 `agentRuntime.id` 显式 opt-in               | 所有启用插件且含 hierarchical 树的 agent 均注入 | `config.enabled` + 布局检测；文档说明                                         |
| hook 时序早于 session label 写入                 | 节点判错                                        | turn 前 align + `subagent_spawned` 写 label；保留 P2                          |
| `before_prompt_build` 超时                       | 大 prompt 目录读盘慢                            | 复用 PLS `maxChars`；manifest 可配 `timeoutMs`                                |
| 与 memory 等插件同写 system context              | 拼接顺序                                        | 使用 `appendSystemContext`；依赖 core 合并顺序（与 active-memory 并存需烟测） |
| operators 仍配置 `agentRuntime.id: hierarchical` | 无 harness 匹配，走 openclaw                    | README 迁移说明；doctor 可选 warn（非本迭代）                                 |

---

## 迁移指南（V2 → V3）

**配置**：删除 model 条目上的：

```json5
agentRuntime: { id: "hierarchical" }
```

**保留**：

```json5
plugins: {
  entries: {
    hierarchical: { enabled: true },
  },
},
agents: {
  list: [{ workspace: "/path/with/hierarchical/tree" }],
}
```

**行为**：spawn、`label`、`sessions_spawn` 约定不变。

---

## Open Questions / 待确认

1. **是否接受** runtime 显示为 OpenClaw 而非 hierarchical？（推荐：是）
2. **是否保留** V2 harness 代码一版 feature flag，还是直接删除？（推荐：直接删除，减少双路径）
3. **是否需要在** `requirements.md` 追加「NTS 权威性」条款？（建议：是，与 NTS 方案同步）

---

## Execute Checkpoint / 执行检查点

- **当前状态**：废案（禁止执行）
- **原批准状态**：已撤销
- **下一步**：回到以前的方案文档，先补齐 auth 问题的规格、技术设计与验证计划
- **代码开发限制**：auth 方案未写入文档且未获确认前，不进入代码开发

**Execution Approval**: `Revoked / Abandoned` — 2026-07-04

# Integration Test Plan — Hierarchical Extension (Automated)

> 不依赖 Gateway。集成测聚焦 `buildHierarchicalAttemptContext`；hook 行为由 `prompt-build-hook.test.ts` 验证。

---

## 方案

### 1. `integration.test.ts` — 上下文组装（10 场景）

通过 `nodeDirOverride` 模拟根/枝/叶节点，验证 PLS / Scanner / NTS / 路径解析（见 `VALIDATION.md`）。

### 2. `prompt-build-hook.test.ts` — before_prompt_build（4 场景）

| #   | 场景                 | 验证点                                         |
| --- | -------------------- | ---------------------------------------------- |
| 1   | demo workspace       | `appendSystemContext` 含 Tool Restrictions     |
| 2   | 无 hierarchical 布局 | 返回 undefined                                 |
| 3   | `enabled: false`     | 返回 undefined                                 |
| 4   | leaf spawn 链        | turn 前 `inheritedToolAllow` 对齐 + supplement |

### 3. `node-path-resolver.test.ts` — spawn 链路径（5 场景）

验证 `spawnedBy` + session `label` 链式解析 nodeDir。

---

## 执行方式

```bash
cd /home/lab/workspace/openclaw
npx tsx --test extensions/hierarchical/*.test.ts
```

## Gateway E2E（可选）

见 `GATEWAY_VALIDATION.md`。

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { HierarchicalSessionReader } from "./node-path-resolver.js";
import { listToolNamesForNodeType } from "./node-tool-registry.js";
import { createBeforePromptBuildHandler } from "./prompt-build-hook.js";
import type { SessionNtsPatch } from "./session-nts-align.js";

const FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/demo-workspace",
);

describe("hierarchical before_prompt_build hook", () => {
  it("returns appendSystemContext with Tool Restrictions for hierarchical workspace", async () => {
    const handler = createBeforePromptBuildHandler({
      resolveWorkspaceDir: () => FIXTURE_ROOT,
    });

    const result = await handler(
      { prompt: "hello", messages: [] },
      { sessionKey: "agent:hier:main", workspaceDir: FIXTURE_ROOT },
    );

    assert.ok(result?.appendSystemContext?.includes("Tool Restrictions"));
  });

  it("no-ops when workspace has no hierarchical layout", async () => {
    const handler = createBeforePromptBuildHandler({
      resolveWorkspaceDir: () => "/tmp/non-hierarchical-workspace",
    });

    const result = await handler(
      { prompt: "hello", messages: [] },
      { workspaceDir: "/tmp/non-hierarchical-workspace" },
    );

    assert.equal(result, undefined);
  });

  it("no-ops when plugin config enabled is false", async () => {
    const handler = createBeforePromptBuildHandler({
      resolveWorkspaceDir: () => FIXTURE_ROOT,
      isEnabled: () => false,
    });

    const result = await handler({ prompt: "hello", messages: [] }, { workspaceDir: FIXTURE_ROOT });

    assert.equal(result, undefined);
  });

  it("aligns inheritedToolAllow before returning supplement on leaf spawn path", async () => {
    const patches: SessionNtsPatch[] = [];
    const demoSessions: Record<
      string,
      { label?: string; spawnedBy?: string; inheritedToolAllow?: string[] }
    > = {
      "agent:hier:subagent:audit": {
        spawnedBy: "agent:hier:subagent:arch",
        label: "security-auditor",
        inheritedToolAllow: listToolNamesForNodeType("root"),
      },
      "agent:hier:subagent:arch": {
        spawnedBy: "agent:hier:main",
        label: "architect",
      },
      "agent:hier:main": {},
    };
    const readSession: HierarchicalSessionReader = async (key) => demoSessions[key];

    const handler = createBeforePromptBuildHandler({
      readSession,
      readSessionEntry: (key) => demoSessions[key],
      patchSession: async (_sessionKey, patch) => {
        patches.push(patch);
      },
      resolveWorkspaceDir: () => FIXTURE_ROOT,
    });

    const result = await handler(
      { prompt: "hello", messages: [] },
      {
        sessionKey: "agent:hier:subagent:audit",
        workspaceDir: FIXTURE_ROOT,
      },
    );

    assert.equal(patches.length, 1);
    assert.deepEqual(patches[0]!.inheritedToolAllow, listToolNamesForNodeType("leaf"));
    assert.ok(result?.appendSystemContext?.includes("Tool Restrictions"));
  });
});

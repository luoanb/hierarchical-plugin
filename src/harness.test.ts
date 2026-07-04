import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  AgentHarnessAttemptParams,
  AgentHarnessAttemptResult,
} from "openclaw/plugin-sdk/agent-harness-runtime";
import { createHierarchicalHarness } from "./harness.js";
import type { HierarchicalSessionReader } from "./node-path-resolver.js";
import { listToolNamesForNodeType } from "./node-tool-registry.js";
import type { SessionNtsPatch } from "./session-nts-align.js";

const FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/demo-workspace",
);

describe("hierarchical harness delegate", () => {
  it("injects extraSystemPrompt, toolsAllow, and openclaw override", async () => {
    let captured: AgentHarnessAttemptParams | undefined;
    const harness = createHierarchicalHarness({
      delegateRunAttempt: async (params) => {
        captured = params;
        return {
          aborted: false,
          externalAbort: false,
          timedOut: false,
          idleTimedOut: false,
          timedOutDuringCompaction: false,
          promptError: null,
          promptErrorSource: null,
          sessionIdUsed: params.sessionId,
          assistantTexts: ["ok"],
          messagesSnapshot: [],
          toolMetas: [],
          lastAssistant: undefined,
          didSendViaMessagingTool: false,
          messagingToolSentTexts: [],
          messagingToolSentMediaUrls: [],
          messagingToolSentTargets: [],
          cloudCodeAssistFormatError: false,
          replayMetadata: {
            mode: "bypass",
            hadPotentialSideEffects: false,
            replaySafe: true,
          },
          itemLifecycle: { interactionId: "", runId: "", sessionId: params.sessionId },
          setTerminalLifecycleMeta: () => {},
        } as unknown as AgentHarnessAttemptResult;
      },
    });

    await harness.runAttempt({
      sessionId: "s1",
      workspaceDir: "/tmp/empty-hierarchical-workspace",
      provider: "test",
      modelId: "test",
      model: { provider: "test", id: "test" } as AgentHarnessAttemptParams["model"],
      messages: [],
      authStorage: {} as AgentHarnessAttemptParams["authStorage"],
      authProfileStore: {} as AgentHarnessAttemptParams["authProfileStore"],
      modelRegistry: {} as AgentHarnessAttemptParams["modelRegistry"],
      thinkLevel: "off",
      sessionFile: "/tmp/s1.jsonl",
      prompt: "hello",
      timeoutMs: 30_000,
      runId: "run-1",
    } as AgentHarnessAttemptParams);

    assert.ok(captured);
    assert.equal(captured!.agentHarnessRuntimeOverride, "openclaw");
    assert.equal(captured!.bootstrapContextMode, "lightweight");
    assert.ok(captured!.extraSystemPrompt?.includes("Tool Restrictions"));
    assert.ok(Array.isArray(captured!.toolsAllow));
  });

  it("aligns inheritedToolAllow before delegate when session has root allow on leaf path", async () => {
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

    let captured: AgentHarnessAttemptParams | undefined;
    const harness = createHierarchicalHarness({
      readSession,
      readSessionEntry: (key) => demoSessions[key],
      patchSession: async (_sessionKey, patch) => {
        patches.push(patch);
      },
      delegateRunAttempt: async (params) => {
        captured = params;
        return {
          aborted: false,
          externalAbort: false,
          timedOut: false,
          idleTimedOut: false,
          timedOutDuringCompaction: false,
          promptError: null,
          promptErrorSource: null,
          sessionIdUsed: params.sessionId,
          assistantTexts: ["ok"],
          messagesSnapshot: [],
          toolMetas: [],
          lastAssistant: undefined,
          didSendViaMessagingTool: false,
          messagingToolSentTexts: [],
          messagingToolSentMediaUrls: [],
          messagingToolSentTargets: [],
          cloudCodeAssistFormatError: false,
          replayMetadata: {
            mode: "bypass",
            hadPotentialSideEffects: false,
            replaySafe: true,
          },
          itemLifecycle: { interactionId: "", runId: "", sessionId: params.sessionId },
          setTerminalLifecycleMeta: () => {},
        } as unknown as AgentHarnessAttemptResult;
      },
    });

    await harness.runAttempt({
      sessionId: "s-leaf",
      sessionKey: "agent:hier:subagent:audit",
      spawnedBy: "agent:hier:subagent:arch",
      workspaceDir: FIXTURE_ROOT,
      provider: "test",
      modelId: "test",
      model: { provider: "test", id: "test" } as AgentHarnessAttemptParams["model"],
      messages: [],
      authStorage: {} as AgentHarnessAttemptParams["authStorage"],
      authProfileStore: {} as AgentHarnessAttemptParams["authProfileStore"],
      modelRegistry: {} as AgentHarnessAttemptParams["modelRegistry"],
      thinkLevel: "off",
      sessionFile: "/tmp/s-leaf.jsonl",
      prompt: "hello",
      timeoutMs: 30_000,
      runId: "run-leaf",
    } as AgentHarnessAttemptParams);

    assert.equal(patches.length, 1);
    assert.deepEqual(patches[0]!.inheritedToolAllow, listToolNamesForNodeType("leaf"));
    assert.ok(captured);
    assert.ok(captured!.toolsAllow.includes("exec"));
  });
});

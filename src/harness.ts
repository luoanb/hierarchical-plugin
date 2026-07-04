/**
 * Hierarchical agent harness — AgentHarness implementation.
 *
 * Architecture (two layers, one turn):
 *   1. Outer runAttempt — preprocessor only: node path, PLS, NTS, supplement.
 *   2. delegateRunAttempt → runOpenClawEmbeddedAttempt — native model/tool loop.
 *
 * Does not hook or replace core sessions_spawn. Spawn writes label/spawnedBy;
 * this harness reads them on each turn via readSession + node-path-resolver.
 *
 * delegateRunAttempt passes:
 *   - extraSystemPrompt / toolsAllow — already enriched by buildHierarchicalAttemptContext
 *   - agentHarnessRuntimeOverride: "openclaw" — inner run must not re-enter hierarchical
 *
 * Registration: api.registerAgentHarness(createHierarchicalHarness(deps))
 * Overview: extensions/hierarchical/README.md
 */

import type {
  AgentHarness,
  AgentHarnessSupportContext,
  AgentHarnessSupport,
  AgentHarnessAttemptParams,
  AgentHarnessAttemptResult,
  AgentHarnessSideQuestionParams,
  AgentHarnessSideQuestionResult,
  AgentHarnessCompactParams,
  AgentHarnessCompactResult,
  AgentHarnessResetParams,
} from "openclaw/plugin-sdk/agent-harness-runtime";
import { buildHierarchicalAttemptContext } from "./harness-context.js";
import type { HierarchicalSessionReader } from "./node-path-resolver.js";
import {
  alignSessionToolPolicyForNts,
  resolveNtsAllowForSpawnedChild,
  type SessionNtsPatcher,
} from "./session-nts-align.js";

export type HierarchicalSessionEntrySnapshot = {
  label?: string;
  spawnedBy?: string | null;
  inheritedToolAllow?: string[];
  inheritedToolDeny?: string[];
};

export type HierarchicalSessionEntryReader = (
  sessionKey: string,
) => HierarchicalSessionEntrySnapshot | undefined;

async function defaultDelegateRunAttempt(
  params: AgentHarnessAttemptParams,
): Promise<AgentHarnessAttemptResult> {
  const mod = (await import("openclaw/plugin-sdk/agent-harness-runtime")) as {
    runOpenClawEmbeddedAttempt?: (
      p: AgentHarnessAttemptParams,
    ) => Promise<AgentHarnessAttemptResult>;
  };
  if (!mod.runOpenClawEmbeddedAttempt) {
    throw new Error(
      "runOpenClawEmbeddedAttempt is not exported; rebuild OpenClaw after upgrading hierarchical plugin",
    );
  }
  return mod.runOpenClawEmbeddedAttempt(params);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HierarchicalHarnessDeps = {
  /** Load session label/spawnedBy for node-path resolution. */
  readSession?: HierarchicalSessionReader;
  /** Read full session entry fields needed for NTS inherited-tool alignment. */
  readSessionEntry?: HierarchicalSessionEntryReader;
  /** Patch session store for NTS inherited-tool alignment (turn-time fallback). */
  patchSession?: SessionNtsPatcher;
  /**
   * Delegate run attempt (defaults to OpenClaw embedded runner).
   * Tests inject a mock here.
   */
  delegateRunAttempt?: (params: AgentHarnessAttemptParams) => Promise<AgentHarnessAttemptResult>;
};

// ---------------------------------------------------------------------------
// Harness factory
// ---------------------------------------------------------------------------

export function createHierarchicalHarness(deps: HierarchicalHarnessDeps = {}): AgentHarness {
  const delegateRunAttempt = deps.delegateRunAttempt ?? defaultDelegateRunAttempt;

  return {
    id: "hierarchical",
    label: "Hierarchical agent harness",
    contextEngineHostCapabilities: [
      "bootstrap",
      "assemble-before-prompt",
      "after-turn",
      "maintain",
    ],

    supports(ctx: AgentHarnessSupportContext): AgentHarnessSupport {
      if (ctx.requestedRuntime === "hierarchical") {
        return { supported: true, priority: 100 };
      }
      return { supported: false };
    },

    runAttempt: async (params: AgentHarnessAttemptParams): Promise<AgentHarnessAttemptResult> => {
      try {
        const sessionEntry =
          params.sessionKey && deps.readSessionEntry
            ? deps.readSessionEntry(params.sessionKey)
            : undefined;
        const spawnedBy = params.spawnedBy ?? sessionEntry?.spawnedBy ?? null;
        const label = sessionEntry?.label;

        if (params.sessionKey && deps.patchSession) {
          const ntsAllow = await resolveNtsAllowForSpawnedChild({
            workspaceDir: params.workspaceDir,
            childSessionKey: params.sessionKey,
            childLabel: label,
            spawnedBy,
            readSession: deps.readSession,
          });
          if (ntsAllow?.length) {
            await alignSessionToolPolicyForNts({
              sessionKey: params.sessionKey,
              workspaceDir: params.workspaceDir,
              label,
              ntsAllow,
              patchSession: deps.patchSession,
              existingLabel: sessionEntry?.label,
              existingInheritedAllow: sessionEntry?.inheritedToolAllow,
              existingInheritedDeny: sessionEntry?.inheritedToolDeny,
            });
          }
        }

        const ctx = await buildHierarchicalAttemptContext({
          workspaceDir: params.workspaceDir,
          sessionKey: params.sessionKey,
          spawnedBy,
          label,
          readSession: deps.readSession,
          toolsAllow: params.toolsAllow,
          extraSystemPrompt: params.extraSystemPrompt,
        });

        // Inner layer: native embedded runner consumes enriched prompt/tools only.
        const delegated = await delegateRunAttempt({
          ...params,
          agentHarnessRuntimeOverride: "openclaw",
          extraSystemPrompt: ctx.extraSystemPrompt,
          toolsAllow: ctx.toolsAllow,
          bootstrapContextMode: params.bootstrapContextMode ?? "lightweight",
        });

        return {
          ...delegated,
          agentHarnessId: "hierarchical",
        };
      } catch (err) {
        return buildErrorAttemptResult(params.sessionId, err);
      }
    },

    runSideQuestion: async (
      _params: AgentHarnessSideQuestionParams,
    ): Promise<AgentHarnessSideQuestionResult> => {
      return { text: "Side questions are not supported in this harness." };
    },

    compact: async (
      _params: AgentHarnessCompactParams,
    ): Promise<AgentHarnessCompactResult | undefined> => {
      return undefined;
    },

    reset(_params: AgentHarnessResetParams): void {
      /* no special cleanup needed */
    },

    dispose(): void {
      /* no special cleanup needed */
    },
  };
}

// ---------------------------------------------------------------------------
// Result builders
// ---------------------------------------------------------------------------

function buildErrorAttemptResult(sessionId: string, error: unknown): AgentHarnessAttemptResult {
  return {
    aborted: false,
    externalAbort: false,
    timedOut: false,
    idleTimedOut: false,
    timedOutDuringCompaction: false,
    promptError: error,
    promptErrorSource: "prompt",
    sessionIdUsed: sessionId,
    messagesSnapshot: [],
    assistantTexts: [],
    toolMetas: [],
    lastAssistant: undefined,
    didSendViaMessagingTool: false,
    messagingToolSentTexts: [],
    messagingToolSentMediaUrls: [],
    messagingToolSentTargets: [],
    cloudCodeAssistFormatError: false,
    replayMetadata: {
      mode: "bypass",
    },
    itemLifecycle: {
      interactionId: "",
      runId: "",
      sessionId,
    },
    setTerminalLifecycleMeta: () => {},
  } as unknown as AgentHarnessAttemptResult;
}

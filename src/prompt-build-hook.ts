/**
 * before_prompt_build hook — PLS supplement + per-turn NTS session alignment.
 *
 * Runs on the default OpenClaw embedded runner path (no harness delegate).
 */

import { buildHierarchicalAttemptContext } from "./harness-context.js";
import type { HierarchicalSessionReader } from "./node-path-resolver.js";
import {
  alignSessionToolPolicyForNts,
  resolveNtsAllowForSpawnedChild,
  workspaceHasHierarchicalLayout,
  type SessionNtsPatcher,
} from "./session-nts-align.js";

export type HierarchicalSessionEntrySnapshot = {
  label?: string;
  spawnedBy?: string | null;
  inheritedToolAllow?: string[];
  inheritedToolDeny?: string[];
};

export type PromptBuildHookContext = {
  sessionKey?: string;
  agentId?: string;
  workspaceDir?: string;
};

export type PromptBuildHookEvent = {
  prompt: string;
  messages: unknown[];
};

export type PromptBuildHookResult = {
  appendSystemContext?: string;
};

export type PromptBuildHookDeps = {
  readSession?: HierarchicalSessionReader;
  readSessionEntry?: (sessionKey: string) => HierarchicalSessionEntrySnapshot | undefined;
  patchSession?: SessionNtsPatcher;
  resolveWorkspaceDir: (agentId?: string) => string | undefined;
  isEnabled?: () => boolean;
};

export function createBeforePromptBuildHandler(
  deps: PromptBuildHookDeps,
): (
  event: PromptBuildHookEvent,
  ctx: PromptBuildHookContext,
) => Promise<PromptBuildHookResult | undefined> {
  return async (_event, ctx) => {
    if (deps.isEnabled?.() === false) {
      return undefined;
    }

    const workspaceDir = ctx.workspaceDir?.trim() || deps.resolveWorkspaceDir(ctx.agentId);
    if (!workspaceDir || !(await workspaceHasHierarchicalLayout(workspaceDir))) {
      return undefined;
    }

    const sessionKey = ctx.sessionKey?.trim();
    const sessionEntry =
      sessionKey && deps.readSessionEntry ? deps.readSessionEntry(sessionKey) : undefined;
    const spawnedBy = sessionEntry?.spawnedBy ?? null;
    const label = sessionEntry?.label;

    if (sessionKey && deps.patchSession && deps.readSession) {
      const ntsAllow = await resolveNtsAllowForSpawnedChild({
        workspaceDir,
        childSessionKey: sessionKey,
        childLabel: label,
        spawnedBy,
        readSession: deps.readSession,
      });
      if (ntsAllow?.length) {
        await alignSessionToolPolicyForNts({
          sessionKey,
          workspaceDir,
          label,
          ntsAllow,
          patchSession: deps.patchSession,
          existingLabel: sessionEntry?.label,
          existingInheritedAllow: sessionEntry?.inheritedToolAllow,
          existingInheritedDeny: sessionEntry?.inheritedToolDeny,
        });
      }
    }

    const attemptContext = await buildHierarchicalAttemptContext({
      workspaceDir,
      sessionKey,
      spawnedBy,
      label,
      readSession: deps.readSession,
    });

    const supplement = attemptContext.supplement.trim();
    if (!supplement) {
      return undefined;
    }

    return { appendSystemContext: supplement };
  };
}

export function isHierarchicalPluginConfigEnabled(pluginConfig: unknown): boolean {
  if (!pluginConfig || typeof pluginConfig !== "object") {
    return true;
  }
  const enabled = (pluginConfig as { enabled?: boolean }).enabled;
  return enabled !== false;
}

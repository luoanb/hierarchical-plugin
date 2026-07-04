/**
 * Session store reader for hierarchical node-path resolution.
 */

import type { PluginRuntime } from "@openclaw/plugin-sdk/core";
import type { HierarchicalSessionReader } from "./node-path-resolver.js";
import type { SessionNtsPatcher } from "./session-nts-align.js";

type SessionRuntime = Pick<PluginRuntime, "agent"> & Partial<Pick<PluginRuntime, "config">>;

export function createSessionReader(runtime: SessionRuntime): HierarchicalSessionReader {
  return async (sessionKey) => {
    const entry = runtime.agent.session.getSessionEntry({ sessionKey });
    if (!entry) {
      return undefined;
    }
    return {
      label: entry.label,
      spawnedBy: entry.spawnedBy,
    };
  };
}

export function createSessionEntryReader(runtime: SessionRuntime) {
  return (sessionKey: string) => runtime.agent.session.getSessionEntry({ sessionKey });
}

export function createSessionNtsPatcher(runtime: SessionRuntime): SessionNtsPatcher {
  return async (sessionKey, patch) => {
    await runtime.agent.session.patchSessionEntry({
      sessionKey,
      update: (entry) => {
        const next: {
          label?: string;
          inheritedToolAllow?: string[];
          inheritedToolDeny?: string[];
        } = {
          inheritedToolAllow: patch.inheritedToolAllow,
          inheritedToolDeny: patch.inheritedToolDeny,
        };
        if (patch.label?.trim() && !entry.label?.trim()) {
          next.label = patch.label.trim();
        }
        return next;
      },
    });
  };
}

export function resolveHarnessWorkspaceDir(
  runtime: SessionRuntime,
  agentId?: string,
): string | undefined {
  const cfg = runtime.config?.current?.();
  if (!cfg || !agentId?.trim()) {
    return undefined;
  }
  type ResolveWorkspaceConfig = Parameters<PluginRuntime["agent"]["resolveAgentWorkspaceDir"]>[0];
  return runtime.agent.resolveAgentWorkspaceDir(cfg as ResolveWorkspaceConfig, agentId.trim());
}

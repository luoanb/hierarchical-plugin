/**
 * Aligns session store tool metadata with hierarchical NTS so core inherited
 * tool policy matches node-type allow lists.
 */

import path from "node:path";
import type { HierarchicalSessionReader } from "./node-path-resolver.js";
import { detectNodeType, listToolNamesForNodeType } from "./node-tool-registry.js";
import { resolveSpawnedChildNodeContext } from "./spawn-node-context.js";

export type SessionNtsPatch = {
  label?: string;
  inheritedToolAllow: string[];
  inheritedToolDeny: string[];
};

export type SessionNtsPatcher = (sessionKey: string, patch: SessionNtsPatch) => Promise<void>;

export function sortedToolNames(names: readonly string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function toolNameSetsEqual(a: readonly string[], b: readonly string[]): boolean {
  const left = sortedToolNames(a);
  const right = sortedToolNames(b);
  if (left.length !== right.length) {
    return false;
  }
  return left.every((name, index) => name === right[index]);
}

export async function workspaceHasHierarchicalLayout(workspaceDir: string): Promise<boolean> {
  const { promises: fs } = await import("node:fs");
  const promptDir = path.join(path.resolve(workspaceDir), "hierarchical", "prompt");
  try {
    return (await fs.stat(promptDir)).isDirectory();
  } catch {
    return false;
  }
}

export async function resolveNtsAllowForSpawnedChild(params: {
  workspaceDir: string;
  childSessionKey?: string;
  childLabel?: string;
  spawnedBy?: string | null;
  readSession?: HierarchicalSessionReader;
}): Promise<string[] | undefined> {
  const nodeContext = await resolveSpawnedChildNodeContext(params);
  const nodeType = await detectNodeType(nodeContext.nodeDir, nodeContext.workspaceRoot);
  return listToolNamesForNodeType(nodeType);
}

/** Persist NTS allow-list (and optional label) on the session entry for core inherited policy. */
export async function alignSessionToolPolicyForNts(params: {
  sessionKey?: string;
  workspaceDir: string;
  label?: string;
  ntsAllow: readonly string[];
  patchSession?: SessionNtsPatcher;
  existingLabel?: string;
  existingInheritedAllow?: readonly string[];
  existingInheritedDeny?: readonly string[];
}): Promise<boolean> {
  if (!params.sessionKey?.trim() || !params.patchSession) {
    return false;
  }
  if (!(await workspaceHasHierarchicalLayout(params.workspaceDir))) {
    return false;
  }

  const ntsAllow = sortedToolNames(params.ntsAllow);
  const label = params.label?.trim();
  const existingLabel = params.existingLabel?.trim();
  const inheritedAllow = params.existingInheritedAllow ?? [];
  const inheritedDeny = params.existingInheritedDeny ?? [];

  const labelNeedsPatch = Boolean(label && !existingLabel);
  const inheritedNeedsPatch =
    !toolNameSetsEqual(inheritedAllow, ntsAllow) || inheritedDeny.length > 0;

  if (!labelNeedsPatch && !inheritedNeedsPatch) {
    return false;
  }

  await params.patchSession(params.sessionKey, {
    inheritedToolAllow: ntsAllow,
    inheritedToolDeny: [],
    ...(labelNeedsPatch && label ? { label } : {}),
  });
  return true;
}

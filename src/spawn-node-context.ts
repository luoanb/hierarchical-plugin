/**
 * Resolves hierarchical node context for a newly spawned child from its parent
 * session and spawn label (nodeId).
 */

import {
  childNodeContext,
  resolveHierarchicalNodeContext,
  type HierarchicalNodeContext,
  type HierarchicalSessionReader,
} from "./node-path-resolver.js";

/** Resolve nodeDir for a child about to run under `requesterSessionKey`. */
export async function resolveChildNodeContext(params: {
  workspaceDir: string;
  requesterSessionKey: string;
  childLabel: string;
  readSession: HierarchicalSessionReader;
}): Promise<HierarchicalNodeContext> {
  const parent = await resolveHierarchicalNodeContext({
    workspaceDir: params.workspaceDir,
    sessionKey: params.requesterSessionKey,
    readSession: params.readSession,
  });
  return childNodeContext(parent, params.childLabel);
}

/**
 * Resolve node context for a spawned child session when label/spawnedBy are
 * known (hook path) or must be read from the child session store (turn path).
 */
export async function resolveSpawnedChildNodeContext(params: {
  workspaceDir: string;
  childSessionKey?: string;
  childLabel?: string;
  spawnedBy?: string | null;
  readSession?: HierarchicalSessionReader;
}): Promise<HierarchicalNodeContext> {
  const label = params.childLabel?.trim();
  const spawnedBy = params.spawnedBy?.trim();

  if (label && spawnedBy && params.readSession) {
    const parent = await resolveHierarchicalNodeContext({
      workspaceDir: params.workspaceDir,
      sessionKey: spawnedBy,
      readSession: params.readSession,
    });
    return childNodeContext(parent, label);
  }

  return resolveHierarchicalNodeContext({
    workspaceDir: params.workspaceDir,
    sessionKey: params.childSessionKey,
    spawnedBy: params.spawnedBy,
    label: params.childLabel,
    readSession: params.readSession,
  });
}

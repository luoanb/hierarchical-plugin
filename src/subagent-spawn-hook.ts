/**
 * subagent_spawned hook — align child session label + inheritedToolAllow with NTS.
 */

import type { HierarchicalSessionReader } from "./node-path-resolver.js";
import {
  alignSessionToolPolicyForNts,
  resolveNtsAllowForSpawnedChild,
  type SessionNtsPatcher,
} from "./session-nts-align.js";

export type HierarchicalSubagentSpawnedEvent = {
  childSessionKey: string;
  label?: string;
};

export type HierarchicalSubagentSpawnedContext = {
  requesterSessionKey?: string;
};

export async function handleHierarchicalSubagentSpawned(params: {
  event: HierarchicalSubagentSpawnedEvent;
  ctx: HierarchicalSubagentSpawnedContext;
  workspaceDir: string;
  readSession: HierarchicalSessionReader;
  patchSession: SessionNtsPatcher;
  readSessionEntry?: (
    sessionKey: string,
  ) => { label?: string; inheritedToolAllow?: string[]; inheritedToolDeny?: string[] } | undefined;
}): Promise<void> {
  const childLabel = params.event.label?.trim();
  const requesterSessionKey = params.ctx.requesterSessionKey?.trim();
  if (!childLabel || !requesterSessionKey) {
    return;
  }

  const ntsAllow = await resolveNtsAllowForSpawnedChild({
    workspaceDir: params.workspaceDir,
    childLabel,
    spawnedBy: requesterSessionKey,
    readSession: params.readSession,
  });
  if (!ntsAllow?.length) {
    return;
  }

  const existing = params.readSessionEntry?.(params.event.childSessionKey);
  await alignSessionToolPolicyForNts({
    sessionKey: params.event.childSessionKey,
    workspaceDir: params.workspaceDir,
    label: childLabel,
    ntsAllow,
    patchSession: params.patchSession,
    existingLabel: existing?.label,
    existingInheritedAllow: existing?.inheritedToolAllow,
    existingInheritedDeny: existing?.inheritedToolDeny,
  });
}

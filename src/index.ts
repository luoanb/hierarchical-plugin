/**
 * Entry point for the hierarchical agent extension.
 *
 * Injects PLS + NTS through plugin hooks on the default OpenClaw embedded runner.
 * Enable the plugin and use a workspace with a `hierarchical/` tree; no agentRuntime pin.
 */

import { definePluginEntry } from "@openclaw/plugin-sdk/plugin-entry";
import {
  createBeforePromptBuildHandler,
  isHierarchicalPluginConfigEnabled,
} from "./prompt-build-hook.js";
import {
  createSessionEntryReader,
  createSessionNtsPatcher,
  createSessionReader,
  resolveHarnessWorkspaceDir,
} from "./session-reader.js";
import { handleHierarchicalSubagentSpawned } from "./subagent-spawn-hook.js";

export default definePluginEntry({
  id: "hierarchical",
  name: "Hierarchical Agent",
  description:
    "Tree-hierarchy agent plugin with inherited prompts (PLS) and node-type tool isolation (NTS).",

  register(api) {
    const readSession = createSessionReader(api.runtime);
    const readSessionEntry = createSessionEntryReader(api.runtime);
    const patchSession = createSessionNtsPatcher(api.runtime);
    const resolveWorkspaceDir = (agentId?: string) =>
      resolveHarnessWorkspaceDir(api.runtime, agentId);
    const isEnabled = () => isHierarchicalPluginConfigEnabled(api.pluginConfig);

    api.on(
      "before_prompt_build",
      createBeforePromptBuildHandler({
        readSession,
        readSessionEntry,
        patchSession,
        resolveWorkspaceDir,
        isEnabled,
      }),
    );

    api.on("subagent_spawned", async (event, ctx) => {
      const workspaceDir = resolveHarnessWorkspaceDir(api.runtime, event.agentId);
      if (!workspaceDir || !isEnabled()) {
        return;
      }
      await handleHierarchicalSubagentSpawned({
        event,
        ctx,
        workspaceDir,
        readSession,
        patchSession,
        readSessionEntry,
      });
    });
  },
});

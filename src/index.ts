/**
 * Entry point for the hierarchical agent extension.
 *
 * Registers the "hierarchical" AgentHarness so that sessions configured with
 * `agentRuntime: { id: "hierarchical" }` are executed by this harness.
 */

import {
  definePluginEntry,
  type OpenClawPluginDefinition,
} from "openclaw/plugin-sdk/plugin-entry";
import { createHierarchicalHarness } from "./harness.js";
import {
  createSessionEntryReader,
  createSessionNtsPatcher,
  createSessionReader,
  resolveHarnessWorkspaceDir,
} from "./session-reader.js";
import { handleHierarchicalSubagentSpawned } from "./subagent-spawn-hook.js";

const plugin: OpenClawPluginDefinition = definePluginEntry({
  id: "hierarchical",
  name: "Hierarchical Agent",
  description:
    "Tree-hierarchy agent harness with inherited prompts (PLS) and node-type tool isolation (NTS).",

  register(api) {
    const readSession = createSessionReader(api.runtime);
    const readSessionEntry = createSessionEntryReader(api.runtime);
    const patchSession = createSessionNtsPatcher(api.runtime);

    api.registerAgentHarness(
      createHierarchicalHarness({
        readSession,
        readSessionEntry,
        patchSession,
      }),
    );

    api.on("subagent_spawned", async (event, ctx) => {
      const workspaceDir = resolveHarnessWorkspaceDir(api.runtime, event.agentId);
      if (!workspaceDir) {
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

export default plugin;

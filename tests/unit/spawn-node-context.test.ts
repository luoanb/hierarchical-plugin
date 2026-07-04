/**
 * Unit tests for spawn-node-context (T4).
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { HierarchicalSessionReader } from "./node-path-resolver.js";
import { resolveChildNodeContext } from "./spawn-node-context.js";

const FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/demo-workspace",
);

const DEMO_SESSIONS: Record<string, { label?: string; spawnedBy?: string | null }> = {
  "agent:hier:main": {},
  "agent:hier:subagent:arch": {
    spawnedBy: "agent:hier:main",
    label: "architect",
  },
};

function demoSessionReader(): HierarchicalSessionReader {
  return async (sessionKey) => DEMO_SESSIONS[sessionKey];
}

describe("resolveChildNodeContext", () => {
  it("requester=root + label=architect resolves branch nodeDir", async () => {
    const ctx = await resolveChildNodeContext({
      workspaceDir: FIXTURE_ROOT,
      requesterSessionKey: "agent:hier:main",
      childLabel: "architect",
      readSession: demoSessionReader(),
    });

    assert.ok(ctx.nodeDir.endsWith(path.join("hierarchical", "children", "architect")));
    assert.equal(ctx.nodeRelPath, path.join("hierarchical", "children", "architect"));
  });

  it("requester=architect + label=security-auditor resolves leaf nodeDir", async () => {
    const ctx = await resolveChildNodeContext({
      workspaceDir: FIXTURE_ROOT,
      requesterSessionKey: "agent:hier:subagent:arch",
      childLabel: "security-auditor",
      readSession: demoSessionReader(),
    });

    assert.ok(
      ctx.nodeDir.endsWith(
        path.join(
          "hierarchical",
          "children",
          "architect",
          "hierarchical",
          "children",
          "security-auditor",
        ),
      ),
    );
  });
});

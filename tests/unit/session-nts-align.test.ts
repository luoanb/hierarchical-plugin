/**
 * Unit tests for session NTS alignment helpers.
 */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import { listToolNamesForNodeType } from "./node-tool-registry.js";
import {
  alignSessionToolPolicyForNts,
  toolNameSetsEqual,
  workspaceHasHierarchicalLayout,
} from "./session-nts-align.js";

describe("session-nts-align", () => {
  let workspaceDir: string;

  before(async () => {
    workspaceDir = await fs.mkdtemp("/tmp/hierarchical-nts-align-");
    await fs.mkdir(path.join(workspaceDir, "hierarchical", "prompt"), { recursive: true });
  });

  after(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("toolNameSetsEqual ignores order", () => {
    assert.equal(toolNameSetsEqual(["exec", "read"], ["read", "exec"]), true);
    assert.equal(toolNameSetsEqual(["exec"], ["read"]), false);
  });

  it("workspaceHasHierarchicalLayout detects hierarchical prompt dir", async () => {
    assert.equal(await workspaceHasHierarchicalLayout(workspaceDir), true);
    assert.equal(await workspaceHasHierarchicalLayout("/tmp/non-hierarchical-workspace"), false);
  });

  it("alignSessionToolPolicyForNts patches inherited allow and label", async () => {
    const leafAllow = listToolNamesForNodeType("leaf");
    const patches: Array<{ sessionKey: string; inheritedToolAllow: string[]; label?: string }> = [];

    const patched = await alignSessionToolPolicyForNts({
      sessionKey: "agent:test:child",
      workspaceDir,
      label: "security-auditor",
      ntsAllow: leafAllow,
      patchSession: async (sessionKey, patch) => {
        patches.push({
          sessionKey,
          inheritedToolAllow: patch.inheritedToolAllow,
          label: patch.label,
        });
      },
      existingInheritedAllow: listToolNamesForNodeType("root"),
      existingInheritedDeny: ["exec"],
    });

    assert.equal(patched, true);
    assert.equal(patches.length, 1);
    assert.deepEqual(patches[0]!.inheritedToolAllow, leafAllow);
    assert.equal(patches[0]!.label, "security-auditor");
  });

  it("alignSessionToolPolicyForNts no-ops when already aligned", async () => {
    const branchAllow = listToolNamesForNodeType("branch");
    let patchCount = 0;
    const patched = await alignSessionToolPolicyForNts({
      sessionKey: "agent:test:child",
      workspaceDir,
      label: "architect",
      ntsAllow: branchAllow,
      patchSession: async () => {
        patchCount += 1;
      },
      existingLabel: "architect",
      existingInheritedAllow: branchAllow,
      existingInheritedDeny: [],
    });
    assert.equal(patched, false);
    assert.equal(patchCount, 0);
  });
});

/**
 * Unit tests for session-reader patchSessionEntry wiring.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionNtsPatcher } from "./session-reader.js";

describe("createSessionNtsPatcher", () => {
  it("calls plugin patchSessionEntry with update on params object", async () => {
    let capturedParams: { sessionKey?: string; update?: unknown } | undefined;
    const patchSession = createSessionNtsPatcher({
      agent: {
        resolveAgentWorkspaceDir: () => "/tmp/ws",
        session: {
          getSessionEntry: () => undefined,
          patchSessionEntry: async (params) => {
            capturedParams = params;
          },
        },
      },
    });

    await patchSession("agent:test:child", {
      label: "architect",
      inheritedToolAllow: ["sessions_spawn"],
      inheritedToolDeny: [],
    });

    assert.equal(capturedParams?.sessionKey, "agent:test:child");
    assert.equal(typeof capturedParams?.update, "function");
    const patch = (
      capturedParams?.update as (entry: { label?: string }) => {
        label?: string;
        inheritedToolAllow?: string[];
      }
    )({ label: "" });
    assert.equal(patch.label, "architect");
    assert.deepEqual(patch.inheritedToolAllow, ["sessions_spawn"]);
  });
});

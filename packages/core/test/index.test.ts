import assert from "node:assert/strict";
import test from "node:test";
import { createScopePolicyAdapter, isWorkspaceRole } from "../dist/index.js";

test("workspace role guard only accepts known roles", () => {
  assert.equal(isWorkspaceRole("admin"), true);
  assert.equal(isWorkspaceRole("viewer"), true);
  assert.equal(isWorkspaceRole("guest"), false);
  assert.equal(isWorkspaceRole(null), false);
});

test("scope policy allows access when no scopes are present", () => {
  const adapter = createScopePolicyAdapter();
  const decision = adapter.authorize({
    action: "dashboard.read",
    resource: { kind: "dashboard", dashboardId: "dash_1" },
    context: { source: "unknown" }
  });

  assert.deepEqual(decision, { allowed: true });
});

test("scope policy rejects missing read scope", () => {
  const adapter = createScopePolicyAdapter();
  const decision = adapter.authorize({
    action: "dataset.read",
    resource: { kind: "dataset", datasetId: "dataset_1" },
    context: { source: "unknown", scopes: ["luminon:dashboard:read"] }
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "Missing required scope for dataset.read");
});

test("scope policy accepts write scope for read actions and resource-specific write scopes", () => {
  const adapter = createScopePolicyAdapter();
  const readDecision = adapter.authorize({
    action: "content.read",
    resource: { kind: "content" },
    context: { source: "unknown", scopes: ["luminon:write"] }
  });
  const writeDecision = adapter.authorize({
    action: "dashboard.write",
    resource: { kind: "dashboard", dashboardId: "dash_1" },
    context: { source: "unknown", scopes: ["luminon:dashboard:write"] }
  });

  assert.equal(readDecision.allowed, true);
  assert.equal(writeDecision.allowed, true);
});

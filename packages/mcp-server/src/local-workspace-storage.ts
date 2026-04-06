import {
  allowAllPolicyAdapter,
  type LocalWorkspaceStorage,
  type PolicyAdapter,
  type RequestContext
} from "../../core/dist/index.js";
import {
  ensureUserDataFiles,
  getDataPaths,
  listDashboards,
  listDatasets,
  removeDashboardFilter,
  renameDashboard,
  setDashboardPublishState,
  updateDataset
} from "./storage.js";
export { createLocalContentRegistry, localContentRegistry } from "./local-content-registry.js";

async function authorizeOrThrow(
  policyAdapter: PolicyAdapter,
  input: Parameters<PolicyAdapter["authorize"]>[0]
): Promise<void> {
  const decision = await policyAdapter.authorize(input);
  if (!decision.allowed) {
    throw new Error(decision.reason ?? `Forbidden: ${input.action}`);
  }
}

export function createLocalWorkspaceStorage(policyAdapter: PolicyAdapter = allowAllPolicyAdapter): LocalWorkspaceStorage {
  return {
    ensureUserDataFiles,
    getDataPaths,
    listDashboards: async (context?: RequestContext) => {
      const dashboards = await listDashboards();
      const allowed: typeof dashboards = [];

      for (const dashboard of dashboards) {
        const decision = await policyAdapter.authorize({
          action: "dashboard.read",
          resource: {
            kind: "dashboard",
            dashboardId: dashboard.id,
            workspaceId: dashboard.workspaceId,
            visibility: dashboard.visibility
          },
          context: context ?? { source: "unknown" }
        });
        if (decision.allowed) {
          allowed.push(dashboard);
        }
      }

      return allowed;
    },
    listDatasets: async (context?: RequestContext) => {
      const datasets = await listDatasets();
      const allowed: typeof datasets = [];

      for (const dataset of datasets) {
        const decision = await policyAdapter.authorize({
          action: "dataset.read",
          resource: {
            kind: "dataset",
            datasetId: dataset.id,
            workspaceId: dataset.workspaceId
          },
          context: context ?? { source: "unknown" }
        });
        if (decision.allowed) {
          allowed.push(dataset);
        }
      }

      return allowed;
    },
    renameDashboard: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: context ?? { source: "unknown" }
      });
      return renameDashboard(input);
    },
    updateDataset: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dataset.write",
        resource: { kind: "dataset", datasetId: input.datasetId },
        context: context ?? { source: "unknown" }
      });
      return updateDataset(input);
    },
    setDashboardPublishState: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: context ?? { source: "unknown" }
      });
      return setDashboardPublishState(input);
    },
    removeDashboardFilter: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: context ?? { source: "unknown" }
      });
      return removeDashboardFilter(input);
    }
  };
}

export const localWorkspaceStorage: LocalWorkspaceStorage = createLocalWorkspaceStorage();

export function createRendererRequestContext(): RequestContext {
  return {
    source: "renderer_api",
    workspaceId: "local",
    role: "owner",
    principalId: "local-renderer"
  };
}

export default localWorkspaceStorage;

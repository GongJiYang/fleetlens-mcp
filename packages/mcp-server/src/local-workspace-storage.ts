import {
  allowAllPolicyAdapter,
  type LocalWorkspaceStorage,
  type ListDashboardsResult,
  type ListDashboardFiltersResult,
  type PolicyAdapter,
  type RequestContext
} from "../../core/dist/index.js";
import {
  addChart,
  addChartToDashboard,
  createChartFromDataset,
  createDashboard,
  createDashboardFromTemplate,
  createDashboardFolder,
  createDashboardGroup,
  createDashboardPage,
  copyDashboardPage,
  importDashboardPages,
  dashboardNl,
  deleteChart,
  deleteDashboard,
  describeDataset,
  ensureUserDataFiles,
  getDataPaths,
  listDashboardFilters,
  listDashboardFolders,
  listDashboardGroups,
  listDashboardPages,
  listDashboardVersions,
  listDashboardsFiltered,
  listDatasetContent,
  listDashboards,
  listDatasets,
  listTemplates,
  listThemePresets,
  removeDashboardFilter,
  removeDashboardGroupItem,
  renameDashboard,
  registerDataset,
  resetChartPresentation,
  restoreDashboardVersion,
  restoreDatasetSnapshot,
  restoreDeletedDashboard,
  setDashboardPublishState,
  setChartPresentation,
  setChartTheme,
  snapshotDashboardTool,
  addDashboardGroupItem,
  undoDashboard,
  updateDashboard,
  updateDashboardPage,
  updateDashboardFilters,
  updateDataset,
  deleteDashboardPage,
  moveChartToPage,
  moveDashboardToFolder
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

function defaultContext(context?: RequestContext): RequestContext {
  return context ?? { source: "unknown" };
}

async function filterDashboardsForRead(
  policyAdapter: PolicyAdapter,
  dashboards: Awaited<ReturnType<typeof listDashboards>>,
  context?: RequestContext
): Promise<typeof dashboards> {
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
      context: defaultContext(context)
    });
    if (decision.allowed) {
      allowed.push(dashboard);
    }
  }

  return allowed;
}

async function filterDatasetsForRead(
  policyAdapter: PolicyAdapter,
  datasets: Awaited<ReturnType<typeof listDatasets>>,
  context?: RequestContext
): Promise<typeof datasets> {
  const allowed: typeof datasets = [];

  for (const dataset of datasets) {
    const decision = await policyAdapter.authorize({
      action: "dataset.read",
      resource: {
        kind: "dataset",
        datasetId: dataset.id,
        workspaceId: dataset.workspaceId
      },
      context: defaultContext(context)
    });
    if (decision.allowed) {
      allowed.push(dataset);
    }
  }

  return allowed;
}

export function createLocalWorkspaceStorage(policyAdapter: PolicyAdapter = allowAllPolicyAdapter): LocalWorkspaceStorage {
  return {
    ensureUserDataFiles,
    getDataPaths,
    listDashboards: async (context?: RequestContext) => filterDashboardsForRead(policyAdapter, await listDashboards(), context),
    listDashboardsFiltered: async (input, context?: RequestContext): Promise<ListDashboardsResult> => {
      const result = await listDashboardsFiltered(input);
      return {
        status: result.status,
        dashboards: await filterDashboardsForRead(
          policyAdapter,
          result.dashboards.map((dashboard) => ("payload" in dashboard ? dashboard.payload : dashboard)),
          context
        ).then((allowed) =>
          result.dashboards.filter((dashboard) =>
            allowed.some((entry) => entry.id === ("payload" in dashboard ? dashboard.payload.id : dashboard.id))
          )
        )
      };
    },
    createDashboard: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", workspaceId: input.workspaceId },
        context: defaultContext(context)
      });
      return createDashboard(input);
    },
    addChart: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return addChart(input);
    },
    addChartToDashboard: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return addChartToDashboard(input);
    },
    updateDashboard: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return updateDashboard(input);
    },
    deleteChart: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return deleteChart(input);
    },
    deleteDashboard: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return deleteDashboard(input);
    },
    listThemePresets: async (context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "content.read",
        resource: { kind: "content" },
        context: defaultContext(context)
      });
      return listThemePresets();
    },
    listTemplates: async (context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "content.read",
        resource: { kind: "content" },
        context: defaultContext(context)
      });
      return listTemplates();
    },
    snapshotDashboard: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return snapshotDashboardTool(input);
    },
    listDashboardVersions: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.read",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return listDashboardVersions(input);
    },
    restoreDashboardVersion: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return restoreDashboardVersion(input);
    },
    undoDashboard: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return undoDashboard(input);
    },
    restoreDeletedDashboard: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return restoreDeletedDashboard(input);
    },
    createDashboardFromTemplate: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", workspaceId: input.workspaceId },
        context: defaultContext(context)
      });
      return createDashboardFromTemplate(input);
    },
    dashboardNl: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", workspaceId: input.workspaceId },
        context: defaultContext(context)
      });
      return dashboardNl(input);
    },
    setChartTheme: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return setChartTheme(input);
    },
    setChartPresentation: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return setChartPresentation(input);
    },
    resetChartPresentation: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return resetChartPresentation(input);
    },
    registerDataset: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dataset.write",
        resource: { kind: "dataset", workspaceId: input.workspaceId },
        context: defaultContext(context)
      });
      return registerDataset(input);
    },
    listDatasets: async (context?: RequestContext) => filterDatasetsForRead(policyAdapter, await listDatasets(), context),
    restoreDatasetSnapshot: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dataset.write",
        resource: { kind: "dataset", datasetId: input.datasetId },
        context: defaultContext(context)
      });
      return restoreDatasetSnapshot(input);
    },
    describeDataset: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dataset.read",
        resource: { kind: "dataset", datasetId: input.datasetId },
        context: defaultContext(context)
      });
      return describeDataset(input);
    },
    listDatasetContent: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dataset.read",
        resource: { kind: "dataset", datasetId: input.datasetId },
        context: defaultContext(context)
      });
      return listDatasetContent(input);
    },
    createChartFromDataset: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return createChartFromDataset(input);
    },
    listDashboardFilters: async (input, context?: RequestContext): Promise<ListDashboardFiltersResult> => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.read",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return listDashboardFilters(input);
    },
    updateDashboardFilters: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return updateDashboardFilters(input);
    },
    renameDashboard: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return renameDashboard(input);
    },
    updateDataset: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dataset.write",
        resource: { kind: "dataset", datasetId: input.datasetId },
        context: defaultContext(context)
      });
      return updateDataset(input);
    },
    setDashboardPublishState: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return setDashboardPublishState(input);
    },
    removeDashboardFilter: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return removeDashboardFilter(input);
    },
    createDashboardPage: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return createDashboardPage(input);
    },
    updateDashboardPage: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return updateDashboardPage(input);
    },
    deleteDashboardPage: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return deleteDashboardPage(input);
    },
    listDashboardPages: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.read",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return listDashboardPages(input);
    },
    moveChartToPage: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.sourceDashboardId },
        context: defaultContext(context)
      });
      return moveChartToPage(input);
    },
    copyDashboardPage: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.sourceDashboardId },
        context: defaultContext(context)
      });
      return copyDashboardPage(input);
    },
    importDashboardPages: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.sourceDashboardId },
        context: defaultContext(context)
      });
      return importDashboardPages(input);
    },
    createDashboardFolder: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", workspaceId: input.workspaceId },
        context: defaultContext(context)
      });
      return createDashboardFolder(input);
    },
    listDashboardFolders: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.read",
        resource: { kind: "dashboard", workspaceId: input?.workspaceId },
        context: defaultContext(context)
      });
      return listDashboardFolders(input);
    },
    createDashboardGroup: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", workspaceId: input.workspaceId },
        context: defaultContext(context)
      });
      return createDashboardGroup(input);
    },
    listDashboardGroups: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.read",
        resource: { kind: "dashboard", workspaceId: input?.workspaceId },
        context: defaultContext(context)
      });
      return listDashboardGroups(input);
    },
    addDashboardGroupItem: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return addDashboardGroupItem(input);
    },
    removeDashboardGroupItem: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return removeDashboardGroupItem(input);
    },
    moveDashboardToFolder: async (input, context?: RequestContext) => {
      await authorizeOrThrow(policyAdapter, {
        action: "dashboard.write",
        resource: { kind: "dashboard", dashboardId: input.dashboardId },
        context: defaultContext(context)
      });
      return moveDashboardToFolder(input);
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

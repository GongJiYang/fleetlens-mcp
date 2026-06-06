import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function loadStorage(tempDir: string) {
  process.env.MCP_DATA_DIR = tempDir;
  return import(`../dist/storage.js?dataDir=${encodeURIComponent(tempDir)}&ts=${Date.now()}`);
}

test("dashboard_nl handles folders, groups, pages and dashboard move flows", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "luminon-nl-"));

  try {
    const storage = await loadStorage(tempDir);
    await storage.ensureUserDataFiles();

    const createDashboardResult = await storage.dashboardNl({
      request: 'create dashboard "Ventas 2026"',
      dashboardName: "Ventas 2026"
    });
    assert.equal(createDashboardResult.action, "create_dashboard");

    const createFolderResult = await storage.dashboardNl({
      request: 'create folder "Finanzas"'
    });
    assert.equal(createFolderResult.action, "create_dashboard_folder");

    const listFoldersResult = await storage.dashboardNl({
      request: "list folders"
    });
    assert.equal(listFoldersResult.action, "list_dashboard_folders");
    assert.ok(Array.isArray(listFoldersResult.result));
    assert.ok(listFoldersResult.result.some((entry: { name: string }) => entry.name === "Finanzas"));

    const moveResult = await storage.dashboardNl({
      request: 'move dashboard to folder "Finanzas"',
      dashboardName: "Ventas 2026"
    });
    assert.equal(moveResult.action, "move_dashboard_to_folder");
    assert.equal(moveResult.result.name, "Ventas 2026");
    assert.ok(moveResult.result.folderId);

    const createGroupResult = await storage.dashboardNl({
      request: 'create group "Weekly Review"'
    });
    assert.equal(createGroupResult.action, "create_dashboard_group");

    const addToGroupResult = await storage.dashboardNl({
      request: 'add dashboard "Ventas 2026" to group "Weekly Review"'
    });
    assert.equal(addToGroupResult.action, "add_dashboard_group_item");
    assert.ok(Array.isArray(addToGroupResult.result.items));
    assert.equal(addToGroupResult.result.items.length, 1);

    const createPageResult = await storage.dashboardNl({
      request: 'create page "Resumen" in dashboard "Ventas 2026"'
    });
    assert.equal(createPageResult.action, "create_dashboard_page");

    const listPagesResult = await storage.dashboardNl({
      request: "list pages",
      dashboardName: "Ventas 2026"
    });
    assert.equal(listPagesResult.action, "list_dashboard_pages");
    assert.ok(Array.isArray(listPagesResult.result));
    assert.ok(listPagesResult.result.length >= 2);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    delete process.env.MCP_DATA_DIR;
  }
});

test("dashboard_nl maps global filter requests to update_dashboard_filters", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "luminon-nl-filters-"));

  try {
    const storage = await loadStorage(tempDir);
    await storage.ensureUserDataFiles();

    const dataset = await storage.registerDataset({
      name: "retail-analytics",
      rows: [
        { year: 2024, month: "January", country: "USA", category: "Electronics", revenue: 100 },
        { year: 2025, month: "February", country: "Canada", category: "Home", revenue: 120 }
      ]
    });

    const dashboard = await storage.createDashboard({
      name: "Retail Analytics Overview",
      layout: { grid: { columns: 3, rows: 3 }, items: [] }
    });

    await storage.createChartFromDataset({
      type: "bar",
      dashboardId: dashboard.id,
      datasetId: dataset.id,
      xField: "country",
      yField: "revenue",
      aggregation: "sum",
      title: "Revenue by Country"
    });

    const result = await storage.dashboardNl({
      dashboardId: dashboard.id,
      request:
        "Agrega filtros globales al dashboard `Retail Analytics Overview` para `Year`, `Month`, `Country` y `Category`. Los filtros deben poder combinarse entre sí en cualquier orden y deben actualizar y recalcular los valores de las otras charts."
    });

    assert.equal(result.action, "update_dashboard_filters");

    const filters = await storage.listDashboardFilters({ dashboardId: dashboard.id });
    assert.equal(filters.filters.length, 4);
    assert.deepEqual(
      filters.filters.map((filter: { field: string; value: string | number | Array<string | number> }) => ({
        field: filter.field,
        value: filter.value
      })),
      [
        { field: "year", value: "" },
        { field: "month", value: "" },
        { field: "country", value: "" },
        { field: "category", value: "" }
      ]
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    delete process.env.MCP_DATA_DIR;
  }
});

test("dashboard_nl maps chart theme requests to set_chart_theme", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "luminon-nl-chart-theme-"));

  try {
    const storage = await loadStorage(tempDir);
    await storage.ensureUserDataFiles();

    const dataset = await storage.registerDataset({
      name: "retail-analytics",
      rows: [
        { year: 2024, month: "January", country: "USA", category: "Electronics", revenue: 100 },
        { year: 2025, month: "February", country: "Canada", category: "Home", revenue: 120 }
      ]
    });

    const dashboard = await storage.createDashboard({
      name: "Retail Analytics Overview",
      layout: { grid: { columns: 3, rows: 3 }, items: [] }
    });

    await storage.createChartFromDataset({
      type: "bar",
      dashboardId: dashboard.id,
      datasetId: dataset.id,
      xField: "country",
      yField: "revenue",
      aggregation: "sum",
      title: "Revenue by Country"
    });

    const result = await storage.dashboardNl({
      dashboardId: dashboard.id,
      request: "Cambia la chart 'Revenue by Country' al tema textured"
    });

    assert.equal(result.action, "set_chart_theme");

    const refreshed = await storage.listDashboardPages({ dashboardId: dashboard.id });
    const chart = refreshed[0]?.charts.find((entry: { title?: string }) => entry.title === "Revenue by Country");
    assert.ok(chart);
    assert.equal(chart.themePreset, "textured");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    delete process.env.MCP_DATA_DIR;
  }
});

test("dashboard_nl maps mixed dashboard and chart theme requests", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "luminon-nl-mixed-theme-"));

  try {
    const storage = await loadStorage(tempDir);
    await storage.ensureUserDataFiles();

    const dataset = await storage.registerDataset({
      name: "retail-analytics",
      rows: [
        { year: 2024, month: "January", country: "USA", category: "Electronics", revenue: 100 },
        { year: 2025, month: "February", country: "Canada", category: "Home", revenue: 120 }
      ]
    });

    const dashboard = await storage.createDashboard({
      name: "Retail Analytics Overview",
      layout: { grid: { columns: 3, rows: 3 }, items: [] }
    });

    await storage.createChartFromDataset({
      type: "bar",
      dashboardId: dashboard.id,
      datasetId: dataset.id,
      xField: "country",
      yField: "revenue",
      aggregation: "sum",
      title: "Revenue by Category"
    });

    const result = await storage.dashboardNl({
      dashboardId: dashboard.id,
      request: 'cambia el dashboard "Retail Analytics Overview" al tema clean y la chart "Revenue by Category" a dark_analytics'
    });

    assert.equal(result.action, "set_dashboard_and_chart_theme");

    const refreshed = await storage.listDashboards();
    const updated = refreshed.find((entry) => entry.id === dashboard.id);
    assert.ok(updated);
    assert.equal(updated?.themePreset, "clean");
    const chart = updated?.pages?.[0]?.charts.find((entry: { title?: string }) => entry.title === "Revenue by Category");
    assert.ok(chart);
    assert.equal(chart?.themePreset, "dark_analytics");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    delete process.env.MCP_DATA_DIR;
  }
});

test("dashboard_nl maps explicit layout requests to set_layout and keeps one-row chart heights", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "luminon-nl-layout-"));

  try {
    const storage = await loadStorage(tempDir);
    await storage.ensureUserDataFiles();

    const dataset = await storage.registerDataset({
      name: "retail-analytics",
      rows: [
        { month: "January", country: "USA", category: "Electronics", revenue: 100 },
        { month: "February", country: "Canada", category: "Home", revenue: 120 }
      ]
    });

    const dashboard = await storage.createDashboard({
      name: "Retail Analytics Overview",
      layout: { grid: { columns: 3, rows: 3 }, items: [] }
    });

    await storage.createChartFromDataset({
      type: "bar",
      dashboardId: dashboard.id,
      datasetId: dataset.id,
      xField: "category",
      yField: "revenue",
      aggregation: "sum",
      title: "Revenue by Category"
    });
    await storage.createChartFromDataset({
      type: "donut",
      dashboardId: dashboard.id,
      datasetId: dataset.id,
      categoryField: "country",
      valueField: "revenue",
      aggregation: "sum",
      title: "Revenue Share"
    });
    await storage.createChartFromDataset({
      type: "kpi_card",
      dashboardId: dashboard.id,
      datasetId: dataset.id,
      valueField: "revenue",
      aggregation: "sum",
      title: "Total Revenue",
      label: "Total Revenue"
    });
    await storage.createChartFromDataset({
      type: "line",
      dashboardId: dashboard.id,
      datasetId: dataset.id,
      xField: "month",
      yField: "revenue",
      aggregation: "sum",
      title: "Monthly Revenue"
    });

    const result = await storage.dashboardNl({
      dashboardId: dashboard.id,
      request:
        "Ajusta Retail Analytics Overview a 3 columnas: Revenue by Category a la izquierda y ocupa 2 columna. Revenue Share a la derecha y ocupa 1 columna. Total Revenue debajo a la izquierda y ocupa 1. Todas las charts ocupan solo una fila."
    });

    assert.equal(result.action, "set_layout");

    const pages = await storage.listDashboardPages({ dashboardId: dashboard.id });
    const primary = pages[0];
    assert.ok(primary);
    assert.equal(primary.layout.grid.columns, 3);
    assert.equal(primary.layout.grid.rows, 2);

    const byTitle = new Map(
      primary.layout.items.map((item: { chart: string; x: number; y: number; w: number; h: number }) => [
        primary.charts.find((chart: { id: string; title?: string }) => chart.id === item.chart)?.title,
        item
      ])
    );
    assert.deepEqual(byTitle.get("Revenue by Category"), { chart: byTitle.get("Revenue by Category")?.chart, x: 0, y: 0, w: 2, h: 1 });
    assert.deepEqual(byTitle.get("Revenue Share"), { chart: byTitle.get("Revenue Share")?.chart, x: 2, y: 0, w: 1, h: 1 });
    assert.deepEqual(byTitle.get("Total Revenue"), { chart: byTitle.get("Total Revenue")?.chart, x: 0, y: 1, w: 1, h: 1 });
    assert.deepEqual(byTitle.get("Monthly Revenue"), { chart: byTitle.get("Monthly Revenue")?.chart, x: 1, y: 1, w: 2, h: 1 });

    const dashboards = await storage.listDashboards();
    const updated = dashboards.find((entry) => entry.id === dashboard.id);
    assert.ok(updated);
    assert.equal(updated?.layout.grid.rows, 2);
    assert.deepEqual(updated?.pages?.[0]?.layout, updated?.layout);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    delete process.env.MCP_DATA_DIR;
  }
});

test("page move/copy/import tools work across dashboards and pages", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "luminon-pages-"));

  try {
    const storage = await loadStorage(tempDir);
    await storage.ensureUserDataFiles();

    const dashboards = await storage.listDashboards();
    const seedSource = dashboards.find((dashboard) => (dashboard.pages?.[0]?.charts?.length ?? dashboard.charts.length) > 0);
    assert.ok(seedSource, "Expected a seeded dashboard with charts");

    const source = await storage.createDashboard({
      name: "Source Dashboard",
      layout: { grid: { columns: 3, rows: 3 }, items: [] }
    });
    await storage.copyDashboardPage({
      sourceDashboardId: seedSource.id,
      targetDashboardId: source.id,
      targetPageName: "Overview"
    });

    const sourcePages = await storage.listDashboardPages({ dashboardId: source.id });
    const sourcePrimary = sourcePages[0];
    assert.ok(sourcePrimary, "Expected a primary page in the source dashboard");
    assert.ok(sourcePrimary.charts.length > 0, "Expected at least one chart in the source primary page");

    const chartToMove = sourcePrimary.charts[0];
    assert.ok(chartToMove, "Expected at least one chart to move");
    const sourceChartCountBefore = sourcePrimary.charts.length;

    const copyTarget = await storage.createDashboard({
      name: "Copy Target",
      layout: { grid: { columns: 3, rows: 3 }, items: [] }
    });
    await storage.copyDashboardPage({
      sourceDashboardId: source.id,
      targetDashboardId: copyTarget.id,
      targetPageName: "Coffee Roastery Lab"
    });
    const copiedPages = await storage.listDashboardPages({ dashboardId: copyTarget.id });
    assert.ok(copiedPages.length >= 1);
    assert.equal(copiedPages[0].charts.length, sourceChartCountBefore);

    const moveTarget = await storage.createDashboard({
      name: "Move Target",
      layout: { grid: { columns: 3, rows: 3 }, items: [] }
    });
    await storage.createDashboardPage({
      dashboardId: moveTarget.id,
      name: "HR Workforce Overview"
    });
    const moveTargetPagesBefore = await storage.listDashboardPages({ dashboardId: moveTarget.id });
    const moveTargetPageId = moveTargetPagesBefore.find((page) => page.name === "HR Workforce Overview")?.id;
    assert.ok(moveTargetPageId, "Expected the move target page to exist");
    await storage.moveChartToPage({
      sourceDashboardId: source.id,
      targetDashboardId: moveTarget.id,
      chartId: chartToMove.id,
      targetPageId: moveTargetPageId
    });
    const movedSourcePages = await storage.listDashboardPages({ dashboardId: source.id });
    const movedTargetPages = await storage.listDashboardPages({ dashboardId: moveTarget.id });
    assert.equal(movedSourcePages[0].charts.length, sourceChartCountBefore - 1);
    assert.ok(movedTargetPages.some((page) => page.name === "HR Workforce Overview" && page.charts.length >= 1));

    await storage.createDashboardPage({
      dashboardId: source.id,
      name: "Secondary Source Page"
    });
    const importTarget = await storage.createDashboard({
      name: "Import Target",
      layout: { grid: { columns: 3, rows: 3 }, items: [] }
    });
    const importResult = await storage.dashboardNl({
      request: `import dashboard "${source.name}" into "${importTarget.name}"`
    });
    assert.equal(importResult.action, "import_dashboard_pages");
    const importedPages = await storage.listDashboardPages({ dashboardId: importTarget.id });
    assert.ok(importedPages.some((page) => page.charts.length > 0), "Expected imported page to keep charts");

    const secondSource = await storage.createDashboard({
      name: "Second Source Dashboard",
      layout: { grid: { columns: 3, rows: 3 }, items: [] }
    });
    await storage.copyDashboardPage({
      sourceDashboardId: seedSource.id,
      targetDashboardId: secondSource.id,
      targetPageName: "Overview"
    });
    const secondImport = await storage.dashboardNl({
      request: `import dashboard "${secondSource.name}" into "${importTarget.name}"`
    });
    assert.equal(secondImport.action, "import_dashboard_pages");
    const importedPagesAfterSecond = await storage.listDashboardPages({ dashboardId: importTarget.id });
    assert.ok(importedPagesAfterSecond.filter((page) => page.charts.length > 0).length >= 2);

    const coffeeSource = await storage.createDashboard({
      name: "Coffee Roastery Lab Custom",
      subtitle: "Coffee Roastery Lab subtitle",
      themePreset: "pastel",
      layout: { grid: { columns: 3, rows: 3 }, items: [] }
    });
    await storage.copyDashboardPage({
      sourceDashboardId: seedSource.id,
      targetDashboardId: coffeeSource.id,
      targetPageName: "Overview"
    });
    const hrSource = await storage.createDashboard({
      name: "HR Workforce Overview Custom",
      subtitle: "HR Workforce Overview subtitle",
      themePreset: "dark_analytics",
      layout: { grid: { columns: 3, rows: 3 }, items: [] }
    });
    await storage.copyDashboardPage({
      sourceDashboardId: seedSource.id,
      targetDashboardId: hrSource.id,
      targetPageName: "Overview"
    });
    const chainedTarget = await storage.createDashboard({
      name: "Coffee Workforce Overview",
      layout: { grid: { columns: 3, rows: 3 }, items: [] }
    });
    const chainedResult = await storage.dashboardNl({
      request: `Import the existing dashboard "${coffeeSource.name}" into "${chainedTarget.name}", then import the existing dashboard "${hrSource.name}" into the same dashboard as the second page.`
    });
    assert.equal(chainedResult.action, "import_dashboard_pages");
    const chainedPages = await storage.listDashboardPages({ dashboardId: chainedTarget.id });
    assert.ok(
      chainedPages.filter((page) => page.charts.length > 0).length >= 2,
      "Expected chained import to create two populated pages"
    );
    assert.equal(chainedPages.length, 2);
    assert.ok(chainedPages[0].charts.length > 0);
    assert.ok(chainedPages[1].charts.length > 0);
    assert.equal(chainedPages[0].subtitle, "Coffee Roastery Lab subtitle");
    assert.equal(chainedPages[1].subtitle, "HR Workforce Overview subtitle");
    assert.equal(chainedPages[0].themePreset, "pastel");
    assert.equal(chainedPages[1].themePreset, "dark_analytics");

    const chainedTargetNoThen = await storage.createDashboard({
      name: "Coffee Workforce Overview v4",
      layout: { grid: { columns: 3, rows: 3 }, items: [] }
    });
    const chainedNoThenResult = await storage.dashboardNl({
      request: `Import the existing dashboard "${coffeeSource.name}" into "${chainedTargetNoThen.name}", import the existing dashboard "${hrSource.name}" into the same dashboard as the second page.`
    });
    assert.equal(chainedNoThenResult.action, "import_dashboard_pages");
    const chainedNoThenPages = await storage.listDashboardPages({ dashboardId: chainedTargetNoThen.id });
    assert.equal(chainedNoThenPages.length, 2);
    assert.ok(chainedNoThenPages[0].charts.length > 0);
    assert.ok(chainedNoThenPages[1].charts.length > 0);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    delete process.env.MCP_DATA_DIR;
  }
});

test("snapshot history keeps up to 10 versions per dashboard and restores latest by default", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "luminon-snapshots-"));

  try {
    const storage = await loadStorage(tempDir);
    await storage.ensureUserDataFiles();

    const dashboard = await storage.createDashboard({
      name: "Snapshot Target",
      layout: { grid: { columns: 3, rows: 3 }, items: [] }
    });

    for (let i = 1; i <= 12; i += 1) {
      await storage.updateDashboard({
        dashboardId: dashboard.id,
        name: `Snapshot Target v${i}`
      });
      await storage.snapshotDashboardTool({
        dashboardId: dashboard.id,
        comment: `manual-${i}`
      });
    }

    const versions = await storage.listDashboardVersions({
      dashboardId: dashboard.id,
      limit: 20,
      offset: 0
    });
    assert.equal(versions.length, 10, "Expected snapshot history to be trimmed to 10");
    assert.ok(
      versions.every((snapshot) => snapshot.payload.id === dashboard.id),
      "Expected snapshots to belong to the same dashboard"
    );
    assert.equal(versions[0]?.payload.name, "Snapshot Target v12");

    await storage.updateDashboard({
      dashboardId: dashboard.id,
      name: "Snapshot Target modified"
    });
    const latestRetainedId = versions[0]?.id;
    assert.ok(latestRetainedId, "Expected latest retained snapshot id");
    const restoredLatest = await storage.restoreDashboardVersion({
      dashboardId: dashboard.id,
      snapshotId: latestRetainedId
    });
    assert.equal(restoredLatest.name, "Snapshot Target v12");

    const versionsAfterRestore = await storage.listDashboardVersions({
      dashboardId: dashboard.id,
      limit: 20,
      offset: 0
    });
    assert.equal(versionsAfterRestore.length, 10, "Expected snapshot history to remain capped at 10");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    delete process.env.MCP_DATA_DIR;
  }
});

test("addBarChartFromDataset syncs dashboard and primary page state", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "luminon-chart-sync-"));

  try {
    const storage = await loadStorage(tempDir);
    await storage.ensureUserDataFiles();

    const dashboard = await storage.createDashboard({
      name: "Dataset Chart Sync",
      layout: { grid: { columns: 3, rows: 3 }, items: [] }
    });

    const updated = await storage.addBarChartFromDataset({
      dashboardId: dashboard.id,
      datasetId: "default_business",
      title: "Sales by Country",
      xField: "country",
      yField: "sales",
      aggregation: "sum"
    });

    assert.equal(updated.charts.length, 1);
    assert.equal(updated.layout.items.length, 1);

    const pages = await storage.listDashboardPages({ dashboardId: dashboard.id });
    assert.equal(pages[0]?.charts.length, 1);
    assert.equal(pages[0]?.layout.items.length, 1);
    assert.equal(pages[0]?.charts[0]?.title, "Sales by Country");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    delete process.env.MCP_DATA_DIR;
  }
});

test("addChartToDashboard syncs dashboard and primary page state", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "luminon-add-chart-sync-"));

  try {
    const storage = await loadStorage(tempDir);
    await storage.ensureUserDataFiles();

    const seeded = await storage.listDashboards();
    const seedDashboard = seeded.find((dashboard) => (dashboard.pages?.[0]?.charts?.length ?? dashboard.charts.length) > 0);
    assert.ok(seedDashboard, "Expected a seeded dashboard with at least one chart");

    const seedPages = await storage.listDashboardPages({ dashboardId: seedDashboard.id });
    const seedChart = structuredClone(seedPages[0]?.charts[0]);
    assert.ok(seedChart, "Expected a seeded chart to clone");
    seedChart.id = "chart_sync_test";

    const dashboard = await storage.createDashboard({
      name: "Manual Chart Sync",
      layout: { grid: { columns: 3, rows: 3 }, items: [] }
    });

    const updated = await storage.addChartToDashboard({
      dashboardId: dashboard.id,
      chart: seedChart,
      placement: { x: 0, y: 0, w: 1, h: 1 }
    });

    assert.equal(updated.charts.length, 1);
    assert.equal(updated.layout.items.length, 1);

    const pages = await storage.listDashboardPages({ dashboardId: dashboard.id });
    assert.equal(pages[0]?.charts.length, 1);
    assert.equal(pages[0]?.layout.items.length, 1);
    assert.equal(pages[0]?.charts[0]?.id, "chart_sync_test");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    delete process.env.MCP_DATA_DIR;
  }
});

test("deleteChart removes charts from dashboard pages and updates counts", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "luminon-delete-chart-"));

  try {
    const storage = await loadStorage(tempDir);
    await storage.ensureUserDataFiles();

    const dashboards = await storage.listDashboards();
    const seedSource = dashboards.find((dashboard) => (dashboard.pages?.[0]?.charts?.length ?? dashboard.charts.length) > 0);
    assert.ok(seedSource, "Expected a seeded dashboard with charts");

    const target = await storage.createDashboard({
      name: "Delete Chart Test",
      layout: { grid: { columns: 3, rows: 3 }, items: [] }
    });

    const initialPages = await storage.listDashboardPages({ dashboardId: target.id });
    const initialPrimary = initialPages[0];
    assert.ok(initialPrimary, "Expected the created dashboard to have a primary page");

    await storage.copyDashboardPage({
      sourceDashboardId: seedSource.id,
      targetDashboardId: target.id,
      targetPageId: initialPrimary.id
    });

    const pagesBefore = await storage.listDashboardPages({ dashboardId: target.id });
    const primaryBefore = pagesBefore[0];
    assert.ok(primaryBefore, "Expected a primary page");
    assert.ok(primaryBefore.charts.length > 0, "Expected copied charts");

    const chartId = primaryBefore.charts[0]!.id;
    const initialCount = primaryBefore.charts.length;

    await storage.deleteChart({
      dashboardId: target.id,
      chartId,
      confirm: "DELETE"
    });

    const dashboardsAfter = await storage.listDashboards();
    const updatedDashboard = dashboardsAfter.find((dashboard) => dashboard.id === target.id);
    assert.ok(updatedDashboard, "Expected dashboard to remain after delete");
    assert.equal(updatedDashboard.charts.length, initialCount - 1);
    assert.ok(updatedDashboard.charts.every((chart) => chart.id !== chartId));

    const pagesAfter = await storage.listDashboardPages({ dashboardId: target.id });
    const primaryAfter = pagesAfter[0];
    assert.ok(primaryAfter, "Expected a primary page after delete");
    assert.equal(primaryAfter.charts.length, initialCount - 1);
    assert.ok(primaryAfter.charts.every((chart) => chart.id !== chartId));
    assert.ok(primaryAfter.layout.items.every((item) => item.chart !== chartId));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    delete process.env.MCP_DATA_DIR;
  }
});

test("dashboard_nl swap uses non-destructive layout mutation for existing charts", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "luminon-swap-"));

  try {
    const storage = await loadStorage(tempDir);
    await storage.ensureUserDataFiles();

    const sales = (await storage.listDashboards()).find((dashboard) => dashboard.name === "Sales Performance Hub");
    assert.ok(sales, "Expected seeded Sales Performance Hub dashboard");

    const pagesBefore = await storage.listDashboardPages({ dashboardId: sales.id });
    const mainBefore = pagesBefore[0];
    assert.ok(mainBefore, "Expected at least one page");
    const chartA = mainBefore.charts.find((chart) => chart.title === "Average Order Value by Country and Channel");
    const chartB = mainBefore.charts.find((chart) => chart.title === "Orders by Category");
    assert.ok(chartA && chartB, "Expected both charts to exist");
    const itemABefore = mainBefore.layout.items.find((item) => item.chart === chartA.id);
    const itemBBefore = mainBefore.layout.items.find((item) => item.chart === chartB.id);
    assert.ok(itemABefore && itemBBefore, "Expected both charts to exist in layout");
    const beforeA = { x: itemABefore.x, y: itemABefore.y, w: itemABefore.w, h: itemABefore.h };
    const beforeB = { x: itemBBefore.x, y: itemBBefore.y, w: itemBBefore.w, h: itemBBefore.h };

    const dashboardBefore = (await storage.listDashboards()).find((dashboard) => dashboard.id === sales.id);
    assert.ok(dashboardBefore, "Expected dashboard snapshot before swap");
    const chartIdsBefore = new Set(dashboardBefore.charts.map((chart) => chart.id));

    const result = await storage.dashboardNl({
      request:
        'Swap the positions of "Average Order Value by Country and Channel" and "Orders by Category" in dashboard "Sales Performance Hub".'
    });
    assert.equal(result.action, "swap_chart_positions");

    const pagesAfter = await storage.listDashboardPages({ dashboardId: sales.id });
    const mainAfter = pagesAfter[0];
    const itemAAfter = mainAfter.layout.items.find((item) => item.chart === chartA.id);
    const itemBAfter = mainAfter.layout.items.find((item) => item.chart === chartB.id);
    assert.ok(itemAAfter && itemBAfter, "Expected both charts in layout after swap");

    assert.equal(itemAAfter.x, beforeB.x);
    assert.equal(itemAAfter.y, beforeB.y);
    assert.equal(itemBAfter.x, beforeA.x);
    assert.equal(itemBAfter.y, beforeA.y);
    assert.equal(itemAAfter.w, beforeA.w);
    assert.equal(itemAAfter.h, beforeA.h);
    assert.equal(itemBAfter.w, beforeB.w);
    assert.equal(itemBAfter.h, beforeB.h);

    const dashboardAfter = (await storage.listDashboards()).find((dashboard) => dashboard.id === sales.id);
    assert.ok(dashboardAfter, "Expected dashboard after swap");
    assert.deepEqual(new Set(dashboardAfter.charts.map((chart) => chart.id)), chartIdsBefore);
    assert.equal(dashboardAfter.charts.length, dashboardBefore.charts.length);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    delete process.env.MCP_DATA_DIR;
  }
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function loadStorage(tempDir: string) {
  process.env.MCP_DATA_DIR = tempDir;
  return import("../dist/storage.js");
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

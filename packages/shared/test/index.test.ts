import assert from "node:assert/strict";
import test from "node:test";
import {
  createChartFromDatasetInputSchema,
  datasetSchema,
  updateDatasetInputSchema
} from "../dist/index.js";

test("dataset schema accepts a valid dataset payload", () => {
  const parsed = datasetSchema.parse({
    id: "dataset_1",
    name: "Sales",
    columns: ["month", "revenue"],
    rows: [
      { month: "2026-01", revenue: 1200 },
      { month: "2026-02", revenue: null }
    ],
    workspaceId: "workspace_1",
    createdBy: "user_1",
    createdAt: "2026-05-04T10:00:00.000Z",
    updatedAt: "2026-05-04T10:00:00.000Z"
  });

  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.columns[1], "revenue");
});

test("update dataset schema defaults to replace mode", () => {
  const parsed = updateDatasetInputSchema.parse({
    datasetId: "dataset_1",
    rows: [{ month: "2026-03", revenue: 1500 }]
  });

  assert.equal(parsed.mode, "replace");
  assert.equal(parsed.allowSchemaChange, undefined);
});

test("create chart from dataset schema validates discriminated chart inputs", () => {
  const parsed = createChartFromDatasetInputSchema.parse({
    type: "bar",
    dashboardId: "dashboard_1",
    datasetId: "dataset_1",
    xField: "month",
    yField: "revenue"
  });

  assert.equal(parsed.type, "bar");
  assert.equal(parsed.aggregation, "sum");
});

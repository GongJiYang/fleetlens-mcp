import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChartDefinition, ContentRegistry, ThemeDefinition } from "../../core/dist/index.js";
import {
  chartTypeSchema,
  templateListSchema,
  type Template
} from "../../shared/dist/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_FILE = path.resolve(__dirname, "..", "..", "shared", "templates.json");

const LOCAL_THEME_DEFINITIONS: ThemeDefinition[] = [
  { id: "clean", description: "Neutral, minimal, default palette." },
  { id: "business", description: "Corporate blue/teal palette for executive dashboards." },
  { id: "dark_analytics", description: "Dark-friendly high-density analytics look." },
  { id: "pastel", description: "Soft pastel palette for presentation-style dashboards." },
  { id: "high_contrast", description: "Strong contrast palette for accessibility and visibility." },
  { id: "textured", description: "Nivo palette with dots/lines patterns for visual distinction." }
];

const CHART_LABELS: Record<(typeof chartTypeSchema)["options"][number], string> = {
  bar: "Bar",
  bar_grouped: "Grouped Bar",
  bar_stacked: "Stacked Bar",
  line: "Line",
  area: "Area",
  scatter: "Scatter",
  radar: "Radar",
  donut: "Donut",
  funnel: "Funnel",
  kpi_card: "KPI Card",
  table: "Table",
  combo: "Combo"
};

let cachedTemplates: Template[] | null = null;

async function loadTemplates(): Promise<Template[]> {
  if (cachedTemplates) return cachedTemplates;
  const raw = await fs.readFile(TEMPLATES_FILE, "utf8");
  const parsed = templateListSchema.parse(JSON.parse(raw));
  cachedTemplates = parsed.templates;
  return parsed.templates;
}

function listLocalCharts(): ChartDefinition[] {
  return chartTypeSchema.options.map((id) => ({
    id,
    label: CHART_LABELS[id],
    premium: false
  }));
}

export function createLocalContentRegistry(): ContentRegistry {
  return {
    listThemes: () => LOCAL_THEME_DEFINITIONS,
    listTemplates: () => loadTemplates(),
    listCharts: () => listLocalCharts()
  };
}

export const localContentRegistry: ContentRegistry = createLocalContentRegistry();

export default localContentRegistry;

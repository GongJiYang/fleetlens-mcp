import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createLuminonMcpServer,
  formatToolModeStartupMessage,
  resolveToolMode
} from "./server.js";

async function main() {
  const toolMode = resolveToolMode(process.env.LUMINON_MCP_MODE);
  console.error(formatToolModeStartupMessage(toolMode));

  const server = createLuminonMcpServer({ toolMode });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP server crashed", error);
  process.exit(1);
});

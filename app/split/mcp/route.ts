import { buildMcpRouteHandler } from '@/lib/mcp/handler';
import {
  registerGetUploadUrlTool,
  registerUploadFileByUrlTool,
  registerGetUserProjectsTool,
  registerSplitFileTool,
} from '@/lib/mcp/tools/tools';

// Split-only MCP server. Endpoint: /split/mcp
const authHandler = buildMcpRouteHandler((server) => {
  registerGetUserProjectsTool(server);
  registerGetUploadUrlTool(server);
  registerUploadFileByUrlTool(server);
  registerSplitFileTool(server);
}, '/split');

export { authHandler as GET, authHandler as POST };

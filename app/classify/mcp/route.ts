import { buildMcpRouteHandler } from '@/lib/mcp/handler';
import {
  registerGetUploadUrlTool,
  registerUploadFileByUrlTool,
  registerGetUserProjectsTool,
  registerClassifyFileTool,
} from '@/lib/mcp/tools/tools';

// Classify-only MCP server. Endpoint: /classify/mcp
const authHandler = buildMcpRouteHandler((server) => {
  registerGetUserProjectsTool(server);
  registerGetUploadUrlTool(server);
  registerUploadFileByUrlTool(server);
  registerClassifyFileTool(server);
}, '/classify');

export { authHandler as GET, authHandler as POST };

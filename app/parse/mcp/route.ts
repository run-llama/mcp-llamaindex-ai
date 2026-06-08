import { buildMcpRouteHandler } from '@/lib/mcp/handler';
import {
  registerGetUploadUrlTool,
  registerUploadFileByUrlTool,
  registerGetUserProjectsTool,
  registerParseFileTool,
} from '@/lib/mcp/tools/tools';

// Parse-only MCP server. Endpoint: /parse/mcp
// Includes parseFile, the file upload helpers it needs, and getUserProjects.
const authHandler = buildMcpRouteHandler((server) => {
  registerGetUserProjectsTool(server);
  registerGetUploadUrlTool(server);
  registerUploadFileByUrlTool(server);
  registerParseFileTool(server);
}, '/parse');

export { authHandler as GET, authHandler as POST };

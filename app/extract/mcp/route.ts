import { buildMcpRouteHandler } from '@/lib/mcp/handler';
import {
  registerGetUploadUrlTool,
  registerUploadFileByUrlTool,
  registerGetUserProjectsTool,
  registerGenerateExtractionConfigTool,
  registerExtractFileTool,
} from '@/lib/mcp/tools/tools';

// Extract-only MCP server. Endpoint: /extract/mcp
// Includes the two extract tools, the file upload helpers and getUserProjects.
const authHandler = buildMcpRouteHandler((server) => {
  registerGetUserProjectsTool(server);
  registerGetUploadUrlTool(server);
  registerUploadFileByUrlTool(server);
  registerGenerateExtractionConfigTool(server);
  registerExtractFileTool(server);
}, '/extract');

export { authHandler as GET, authHandler as POST };

import { buildMcpRouteHandler } from '@/lib/mcp/handler';
import {
  registerGetUploadUrlTool,
  registerUploadFileByUrlTool,
  registerGetUserProjectsTool,
  registerClassifyFileTool,
} from '@/lib/mcp/tools/tools';

// Classify-only MCP server. Endpoint: /classify/mcp
const authHandler = buildMcpRouteHandler(
  (server) => {
    registerGetUserProjectsTool(server);
    registerGetUploadUrlTool(server);
    registerUploadFileByUrlTool(server);
    registerClassifyFileTool(server);
  },
  '/classify',
  {
    serverInfo: {
      name: 'llamacloud-classify-mcp',
      version: '0.1.0',
    },
    instructions:
      'LlamaCloud Classify MCP server for assigning user-defined categories to documents. ' +
      'Upload a file via getUploadUrl + POST the file to the obtained URL, then call classifyFile with an array of ' +
      'categories (lowercase snake_case names and clear descriptions) to get the predicted label. ' +
      'Use getUserProjects to discover available projects.',
  }
);

export { authHandler as GET, authHandler as POST };

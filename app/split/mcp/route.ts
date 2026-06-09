import { buildMcpRouteHandler } from '@/lib/mcp/handler';
import {
  registerGetUploadUrlTool,
  registerUploadFileByUrlTool,
  registerGetUserProjectsTool,
  registerSplitFileTool,
} from '@/lib/mcp/tools/tools';

// Split-only MCP server. Endpoint: /split/mcp
const authHandler = buildMcpRouteHandler(
  (server) => {
    registerGetUserProjectsTool(server);
    registerGetUploadUrlTool(server);
    registerUploadFileByUrlTool(server);
    registerSplitFileTool(server);
  },
  '/split',
  {
    serverInfo: {
      name: 'llamacloud-split-mcp',
      version: '0.1.0',
    },
    instructions:
      'LlamaCloud Split MCP server for splitting a document into category-labelled sections. ' +
      'Upload a file via getUploadUrl + uploadFileByUrl, then call splitFile with an array of ' +
      'categories (lowercase snake_case names and clear descriptions) to get per-section ' +
      'classifications. Use getUserProjects to discover available projects.',
  }
);

export { authHandler as GET, authHandler as POST };

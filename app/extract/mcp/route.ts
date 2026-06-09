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
const authHandler = buildMcpRouteHandler(
  (server) => {
    registerGetUserProjectsTool(server);
    registerGetUploadUrlTool(server);
    registerUploadFileByUrlTool(server);
    registerGenerateExtractionConfigTool(server);
    registerExtractFileTool(server);
  },
  '/extract',
  {
    serverInfo: {
      name: 'llamacloud-extract-mcp',
      version: '0.1.0',
    },
    instructions:
      'LlamaExtract MCP server for pulling structured data out of documents. Typical flow: ' +
      '(1) call generateExtractionConfig with a natural-language description to draft a schema, ' +
      '(2) upload a file via getUploadUrl and POST the file to the obtained URL, ' +
      '(3) call extractFile with the file id and the extraction config to get structured JSON. ' +
      'Use getUserProjects to discover available projects.',
  }
);

export { authHandler as GET, authHandler as POST };

import { buildMcpRouteHandler } from '@/lib/mcp/handler';
import {
  registerGetUploadUrlTool,
  registerUploadFileByUrlTool,
  registerGetUserProjectsTool,
  registerGenerateExtractionConfigTool,
  registerExtractFileTool,
  registerSearchSchemaTemplatesTool,
  registerGetSchemaTemplateTool,
  registerCreateExtractionConfigFromSchemaTool,
} from '@/lib/mcp/tools/tools';

// Extract-only MCP server. Endpoint: /extract/mcp
// Includes the extract tools, the schema-template catalog, the file upload
// helpers and getUserProjects.
const authHandler = buildMcpRouteHandler(
  (server) => {
    registerGetUserProjectsTool(server);
    registerGetUploadUrlTool(server);
    registerUploadFileByUrlTool(server);
    registerSearchSchemaTemplatesTool(server);
    registerGetSchemaTemplateTool(server);
    registerCreateExtractionConfigFromSchemaTool(server);
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
      '(1) get a schema — for a common document type call searchSchemaTemplates, then ' +
      'createExtractionConfigFromSchema with the template id; otherwise call ' +
      'generateExtractionConfig with a natural-language description to draft one, ' +
      '(2) upload a file via getUploadUrl and POST the file to the obtained URL, ' +
      '(3) call extractFile with the file id and the extraction config to get structured JSON. ' +
      'Use getUserProjects to discover available projects.',
  }
);

export { authHandler as GET, authHandler as POST };

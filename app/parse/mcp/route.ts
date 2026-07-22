import { buildMcpRouteHandler } from '@/lib/mcp/handler';
import {
  registerGetUploadUrlTool,
  registerUploadFileByUrlTool,
  registerGetUserProjectsTool,
  registerParseFileTool,
  registerLitIsComplexTool,
  registerLitParseTool,
} from '@/lib/mcp/tools/tools';

// Parse-only MCP server. Endpoint: /parse/mcp
// Includes parseFile, parseFileWithLiteParse, estimateFileComplexity, the file upload helpers it needs, and getUserProjects.
const authHandler = buildMcpRouteHandler(
  (server) => {
    registerGetUserProjectsTool(server);
    registerGetUploadUrlTool(server);
    registerUploadFileByUrlTool(server);
    registerParseFileTool(server);
    registerLitIsComplexTool(server);
    registerLitParseTool(server);
  },
  '/parse',
  {
    serverInfo: {
      name: 'llamacloud-parse-mcp',
      version: '0.1.0',
    },
    instructions:
      'LlamaParse MCP server for converting documents (PDFs, Office files, images, etc.) into ' +
      'structured text/markdown. Typical flow: (1) call getUploadUrl to obtain a signed upload URL, ' +
      '(2) POST your file to that URL (or call uploadFileByUrl to have the server fetch it for you), ' +
      '(3) call parseFile with the returned file id to run LlamaParse. Use getUserProjects to pick ' +
      'a target project when needed.',
  }
);

export { authHandler as GET, authHandler as POST };

import { buildMcpRouteHandler } from '@/lib/mcp/handler';
import { registerLlamaParseTools } from '@/lib/mcp/tools/tools';

// Full MCP server: exposes every LlamaParse tool. Endpoint: /mcp
const authHandler = buildMcpRouteHandler(registerLlamaParseTools, '', {
  serverInfo: {
    name: 'llamacloud-mcp',
    version: '0.1.0',
  },
  instructions:
    'LlamaParse Platform MCP server exposing the full set of Parse, Extract, Split, Classify and Index tools. ' +
    'Use the upload helpers (getUploadUrl, uploadFileByUrl) to push a local file to LlamaCloud, ' +
    'then call parseFile, classifyFile, splitFile, or extractFile to process it. ' +
    'Use getUserProjects to discover available projects, listIndexes to find indexes, and the ' +
    'index tools (findFilesInIndex, readFileFromIndex, grepFileFromIndex, retrieveFromIndex) to ' +
    'search and read documents in an existing index.',
});

export { authHandler as GET, authHandler as POST };

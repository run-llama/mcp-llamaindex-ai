import { buildMcpRouteHandler } from '@/lib/mcp/handler';
import { registerIndexTools } from '@/lib/mcp/tools/tools';

// Index-only MCP server. Endpoint: /index/mcp
// Covers both halves of Index: querying an existing index, and building one.
const authHandler = buildMcpRouteHandler(registerIndexTools, '/index', {
  serverInfo: {
    name: 'llamacloud-index-mcp',
    version: '0.1.0',
  },
  instructions:
    'LlamaCloud Index MCP server for managed knowledge bases. To query an existing index: ' +
    'call listIndexes to find one, then retrieveFromIndex for semantic / hybrid retrieval across ' +
    'it, findFilesInIndex to locate a file by name, readFileFromIndex to fetch a file’s parsed ' +
    'contents, and grepFileFromIndex to search inside a file with a regex/literal pattern. ' +
    'To build a new index: (1) createDirectory, (2) upload files via getUploadUrl or ' +
    'uploadFileByUrl, (3) addFilesToDirectory with the returned file ids, (4) createIndex over ' +
    'that directory. Indexing is asynchronous — poll getIndexStatus until it reports ready ' +
    'before querying, and call syncIndex to pull in files added after the index was built. ' +
    'Use getUserProjects to discover available projects.',
});

export { authHandler as GET, authHandler as POST };

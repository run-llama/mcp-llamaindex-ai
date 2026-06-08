import { buildMcpRouteHandler } from '@/lib/mcp/handler';
import {
  registerGetUserProjectsTool,
  registerFindFilesInIndexTool,
  registerReadFileFromIndexTool,
  registerGrepFileFromIndexTool,
  registerRetrieveFromIndexTool,
} from '@/lib/mcp/tools/tools';

// Per-index MCP server. Endpoint: /index/[indexId]/mcp
// All index tools are pre-bound to the indexId from the URL, so clients
// don't have to pass it on every call. We still expose listIndexes and
// getUserProjects as escape hatches.
//
// Note: we intentionally build a fresh handler per request rather than
// memoising one per indexId. The underlying `createMcpHandler` produces
// stateless request-dispatch closures, and `indexId` is user-supplied
// (effectively unbounded cardinality), so a process-lifetime cache would
// be an unbounded memory leak. The construction cost is dwarfed by the
// downstream LlamaParse API calls each tool makes.

type RouteContext = {
  params: Promise<{ indexId: string }>;
};

async function route(request: Request, context: RouteContext) {
  const { indexId } = await context.params;

  const handler = buildMcpRouteHandler((server) => {
    registerGetUserProjectsTool(server);
    registerFindFilesInIndexTool(server, indexId);
    registerReadFileFromIndexTool(server, indexId);
    registerGrepFileFromIndexTool(server, indexId);
    registerRetrieveFromIndexTool(server, indexId);
  }, `/index/${indexId}`);

  return handler(request);
}

export { route as GET, route as POST };

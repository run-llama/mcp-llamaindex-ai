import { buildMcpRouteHandler } from '@/lib/mcp/handler';
import {
  registerGetUploadUrlTool,
  registerUploadFileByUrlTool,
  registerGetUserProjectsTool,
  registerExtractFileTool,
} from '@/lib/mcp/tools/tools';

// Per-config extract MCP server. Endpoint: /extract/[configId]/mcp
// The extractFile tool is pre-bound to the configId from the URL, so
// clients don't have to pass `configurationId` on every call.
//
// As in /index/[indexId]/mcp, we build a fresh handler per request rather
// than memoising per configId: `configId` is user-supplied and effectively
// unbounded, so a process-lifetime cache would leak memory, and the
// construction cost is dwarfed by the downstream LlamaParse API calls.

type RouteContext = {
  params: Promise<{ configId: string }>;
};

async function route(request: Request, context: RouteContext) {
  const { configId } = await context.params;

  const handler = buildMcpRouteHandler((server) => {
    registerGetUserProjectsTool(server);
    registerGetUploadUrlTool(server);
    registerUploadFileByUrlTool(server);
    registerExtractFileTool(server, configId);
  }, `/extract/${configId}`);

  return handler(request);
}

export { route as GET, route as POST };

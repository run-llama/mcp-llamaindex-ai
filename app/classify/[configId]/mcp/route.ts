import { buildMcpRouteHandler } from '@/lib/mcp/handler';
import {
  registerGetUploadUrlTool,
  registerUploadFileByUrlTool,
  registerGetUserProjectsTool,
  registerClassifyFileTool,
} from '@/lib/mcp/tools/tools';

// Per-config classify MCP server. Endpoint: /classify/[configId]/mcp
// The classifyFile tool is pre-bound to the configId from the URL, so
// clients don't have to pass categories on every call — the saved
// configuration on LlamaCloud supplies the categories/rules.
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
    registerClassifyFileTool(server, configId);
  }, `/classify/${configId}`);

  return handler(request);
}

export { route as GET, route as POST };

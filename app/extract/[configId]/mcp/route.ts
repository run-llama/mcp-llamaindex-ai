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

  const handler = buildMcpRouteHandler(
    (server) => {
      registerGetUserProjectsTool(server);
      registerGetUploadUrlTool(server);
      registerUploadFileByUrlTool(server);
      registerExtractFileTool(server, configId);
    },
    `/extract/${configId}`,
    {
      serverInfo: {
        name: 'llamacloud-extract-config-mcp',
        version: '0.1.0',
      },
      instructions:
        'LlamaExtract MCP server bound to a saved extraction configuration ' +
        `(${configId}). The extractFile tool already knows the schema from the saved config, so ` +
        'clients only need to upload a file (getUploadUrl + POST the file to the obtained URL) and call extractFile ' +
        'with the resulting file id to get structured JSON output.',
    }
  );

  return handler(request);
}

export { route as GET, route as POST };

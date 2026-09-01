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
// We build a fresh handler per request rather than memoising per configId:
// `configId` is user-supplied and effectively unbounded, so a process-lifetime
// cache would leak memory, and the construction cost is dwarfed by the
// downstream LlamaParse API calls.

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
      registerClassifyFileTool(server, configId);
    },
    `/classify/${configId}`,
    {
      serverInfo: {
        name: 'llamacloud-classify-config-mcp',
        version: '0.1.0',
      },
      instructions:
        'LlamaCloud Classify MCP server bound to a saved classifier configuration ' +
        `(${configId}). The classifyFile tool already knows the categories from the saved config, ` +
        'so clients only need to upload a file (getUploadUrl + POST the file to the obtained URL) and call ' +
        'classifyFile with the resulting file id.',
    }
  );

  return handler(request);
}

export { route as GET, route as POST };

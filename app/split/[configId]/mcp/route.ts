import { buildMcpRouteHandler } from '@/lib/mcp/handler';
import {
  registerGetUploadUrlTool,
  registerUploadFileByUrlTool,
  registerGetUserProjectsTool,
  registerSplitFileTool,
} from '@/lib/mcp/tools/tools';

// Per-config split MCP server. Endpoint: /split/[configId]/mcp
// The splitFile tool is pre-bound to the configId from the URL, so
// clients don't have to pass categories on every call — the saved
// configuration on LlamaCloud supplies the categories and splitting
// strategy.
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
      registerSplitFileTool(server, configId);
    },
    `/split/${configId}`,
    {
      serverInfo: {
        name: 'llamacloud-split-config-mcp',
        version: '0.1.0',
      },
      instructions:
        'LlamaCloud Split MCP server bound to a saved split configuration ' +
        `(${configId}). The splitFile tool already knows the categories and splitting strategy ` +
        'from the saved config, so clients only need to upload a file (getUploadUrl + ' +
        'uploadFileByUrl) and call splitFile with the resulting file id.',
    }
  );

  return handler(request);
}

export { route as GET, route as POST };

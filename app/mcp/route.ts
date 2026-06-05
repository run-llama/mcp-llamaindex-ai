import { buildMcpRouteHandler } from '@/lib/mcp/handler';
import { registerLlamaParseTools } from '@/lib/mcp/tools/tools';

// Full MCP server: exposes every LlamaParse tool. Endpoint: /mcp
const authHandler = buildMcpRouteHandler(registerLlamaParseTools, '');

export { authHandler as GET, authHandler as POST };

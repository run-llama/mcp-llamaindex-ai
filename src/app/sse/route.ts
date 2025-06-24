import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { prisma } from '@/app/prisma';

// MCP Server capabilities and configuration
const MCP_SERVER_INFO = {
  name: "MCP OAuth Server",
  version: "0.1.0",
  capabilities: {
    "logging": {},
    "prompts": {
      "listChanged": true
    },
    "resources": {
      "subscribe": true,
      "listChanged": true
    },
    "tools": {
      "listChanged": true
    }
  },
};

// Available tools
const AVAILABLE_TOOLS = [
  {
    name: "add_numbers",
    description: "Adds two numbers together and returns the sum",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "number", description: "First number to add" },
        b: { type: "number", description: "Second number to add" }
      },
      required: ["a", "b"]
    }
  }
];

// Authentication helper
async function authenticateRequest(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  console.log('[MCP] Auth header present:', !!authHeader);
  
  if (!authHeader) {
    console.log('[MCP] No auth header, returning 401');
    return null;
  }

  const token = authHeader.split(' ')[1];
  console.log('[MCP] Token extracted:', token ? 'present' : 'missing');
  
  if (!token) {
    console.log('[MCP] No token, returning 401');
    return null;
  }

  try {
    console.log('[MCP] Looking up access token in database');
    const accessToken = await prisma.accessToken.findUnique({
      where: { token },
    });

    console.log('[MCP] Access token found:', !!accessToken);
    
    if (!accessToken) {
      console.log('[MCP] No access token found, returning 401');
      return null;
    }

    console.log('[MCP] Token expires at:', accessToken.expiresAt);
    console.log('[MCP] Current time:', new Date());
    
    if (accessToken.expiresAt < new Date()) {
      console.log('[MCP] Token expired, returning 401');
      return null;
    }

    console.log('[MCP] Authentication successful');
    return accessToken;
  } catch (e) {
    console.error('[MCP] Error validating token:', e);
    return null;
  }
}

export async function GET(request: NextRequest) {
  console.log('[MCP GET] Request received');

  console.log('[MCP GET] Full request path:', request.nextUrl.pathname);
  
  // For GET requests, return server information for discovery
  const baseUrl = process.env.NEXTAUTH_URL || 
    `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  
  const serverInfo = {
    name: MCP_SERVER_INFO.name,
    version: MCP_SERVER_INFO.version,
    description: "MCP server with OAuth 2.0 authentication",
    endpoints: {
      mcp: `${baseUrl}/sse`,
      oauth: {
        register: `${baseUrl}/api/oauth/register`,
        token: `${baseUrl}/api/oauth/token`
      }
    }
  };

  const response = NextResponse.json(serverInfo);
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  return response;
}

export async function POST(request: NextRequest) {
  console.log('[MCP POST] Request received');
  
  // Check if this is a JSON-RPC request or SSE connection
  const contentType = request.headers.get('content-type');
  
  if (contentType && contentType.includes('application/json')) {
    // Handle JSON-RPC request
    return handleJsonRpcRequest(request);
  } else {
    console.log('[MCP] NOT handling SEE requests');
    // Handle SSE connection
    //return handleSseConnection(request);
    const response = NextResponse.json({ error: 'Not implemented' }, { status: 501 });
    return response;
  }
}

async function handleJsonRpcRequest(request: NextRequest) {
  console.log('[MCP] Handling JSON-RPC request');
  
  // Authenticate the request
  const accessToken = await authenticateRequest(request);
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    console.log('[MCP] JSON-RPC request body:', body);
    
    // Validate JSON-RPC request structure
    if (!body.jsonrpc || body.jsonrpc !== "2.0") {
      return NextResponse.json({
        jsonrpc: "2.0",
        error: { code: -32600, message: "Invalid Request" },
        id: body.id || null
      }, { status: 400 });
    }

    if (!body.method) {
      return NextResponse.json({
        jsonrpc: "2.0",
        error: { code: -32600, message: "Invalid Request" },
        id: body.id || null
      }, { status: 400 });
    }

    // Handle MCP protocol methods
    switch (body.method) {
      case 'initialize':
        console.log('[MCP] Processing initialize method');
        return NextResponse.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: MCP_SERVER_INFO.capabilities,
            serverInfo: {
              name: MCP_SERVER_INFO.name,
              version: MCP_SERVER_INFO.version
            }
          }
        });

      case 'notifications/initialized':
        console.log('[MCP] Processing notifications/initialized method');
        return new NextResponse(null, { status: 200 });

      case 'tools/list':
        console.log('[MCP] Processing tools/list method');
        return NextResponse.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2024-11-05",
            tools: AVAILABLE_TOOLS
          }
        });

      case 'resources/list':
        console.log('[MCP] Processing resources/list method');
        return NextResponse.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            resources: []
          }
        });

      case 'prompts/list':
        console.log('[MCP] Processing prompts/list method');
        return NextResponse.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            prompts: []
          }
        });

      case 'tools/call':
        console.log('[MCP] Processing tools/call method');
        
        if (!body.params || !body.params.name) {
          return NextResponse.json({
            jsonrpc: "2.0",
            error: { code: -32602, message: "Invalid params" },
            id: body.id
          }, { status: 400 });
        }

        if (body.params.name === 'add_numbers') {
          const { arguments: args } = body.params;
          console.log('[MCP] Arguments received:', args);
          
          if (!args || typeof args.a !== 'number' || typeof args.b !== 'number') {
            return NextResponse.json({
              jsonrpc: "2.0",
              error: { code: -32602, message: "Invalid arguments. Both a and b must be numbers." },
              id: body.id
            }, { status: 400 });
          }

          const result = args.a + args.b;
          
          return NextResponse.json({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [
                {
                  type: "text",
                  text: `The sum of ${args.a} and ${args.b} is ${result}`
                }
              ]
            }
          });
        } else {
          return NextResponse.json({
            jsonrpc: "2.0",
            error: { code: -32601, message: "Method not found" },
            id: body.id
          }, { status: 404 });
        }

      default:
        return NextResponse.json({
          jsonrpc: "2.0",
          error: { code: -32601, message: "Method not found" },
          id: body.id
        }, { status: 404 });
    }
  } catch (e) {
    console.error('[MCP] JSON-RPC error:', e);
    return NextResponse.json({
      jsonrpc: "2.0",
      error: { code: -32603, message: "Internal error" },
      id: null
    }, { status: 500 });
  }
}

/*
async function handleSseConnection(request: NextRequest) {
  console.log('[MCP] Handling SSE connection');
  
  // Authenticate the request
  const accessToken = await authenticateRequest(request);
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[MCP] Authentication successful, creating SSE stream');
    
    // Create SSE response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        console.log('[MCP SSE Stream] Starting SSE stream');
        
        // Send initial connection message
        const connectionMessage = {
          jsonrpc: "2.0",
          method: "connection/established",
          params: {
            timestamp: new Date().toISOString()
          }
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(connectionMessage)}\n\n`));
        
        // Send server capabilities
        const capabilitiesMessage = {
          jsonrpc: "2.0",
          method: "server/capabilities",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: MCP_SERVER_INFO.capabilities,
            serverInfo: {
              name: MCP_SERVER_INFO.name,
              version: MCP_SERVER_INFO.version
            }
          }
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(capabilitiesMessage)}\n\n`));
        
        // Send available tools list
        const toolsMessage = {
          jsonrpc: "2.0",
          method: "tools/list",
          params: {
            tools: AVAILABLE_TOOLS
          }
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(toolsMessage)}\n\n`));
        
        // Send a heartbeat every 30 seconds
        const heartbeat = setInterval(() => {
          const heartbeatMessage = {
            jsonrpc: "2.0",
            method: "heartbeat",
            params: {
              timestamp: new Date().toISOString()
            }
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(heartbeatMessage)}\n\n`));
        }, 30000);
        
        // Set up cleanup when the stream is closed
        return () => {
          console.log('[MCP SSE Stream] Cleaning up stream');
          clearInterval(heartbeat);
        };
      }
    });

    console.log('[MCP] Returning SSE response');
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      }
    });
  } catch (e) {
    console.error('[MCP] SSE error:', e);
    return NextResponse.json({ error: 'Error creating SSE stream' }, { status: 500 });
  }
}
*/

export async function OPTIONS(request: NextRequest) {
  // Handle CORS preflight requests
  const response = new NextResponse(null, { status: 200 });
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return response;
} 

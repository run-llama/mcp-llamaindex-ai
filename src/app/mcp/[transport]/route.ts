import { createMcpHandler } from "@vercel/mcp-adapter";
import { z } from "zod";
import { jwtVerify, createRemoteJWKSet } from 'jose';

const LLAMACLOUD_API_BASE_URL =
  process.env.LLAMACLOUD_API_BASE_URL || 'https://api.cloud.llamaindex.ai';

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!_jwks) {
    const baseUrl = process.env.WORKOS_AUTHKIT_BASE_URL;
    if (!baseUrl) throw new Error('WORKOS_AUTHKIT_BASE_URL is not set');
    _jwks = createRemoteJWKSet(new URL(`${baseUrl}/oauth2/jwks`));
  }
  return _jwks;
}

interface AuthContext {
  userId: string;
  accessToken: string; // raw token to forward to platform API
}

async function authenticateRequest(request: Request): Promise<AuthContext | null> {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return null;

  try {
    const authkitBaseUrl = process.env.WORKOS_AUTHKIT_BASE_URL!;
    const { payload } = await jwtVerify(token, getJWKS(), {
      issuer: authkitBaseUrl,
    });

    if (!payload.sub) return null;
    return { userId: payload.sub, accessToken: token };
  } catch (err) {
    console.error('[MCP] JWT verification failed:', err);
    return null;
  }
}

function unauthorizedResponse(request: Request) {
  const baseUrl = process.env.MCP_BASE_URL || new URL(request.url).origin;
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'WWW-Authenticate':
        `Bearer error="unauthorized", ` +
        `error_description="Authorization needed", ` +
        `resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
    },
  });
}

// Helper to call the LlamaCloud platform API with the user's WorkOS token
async function llamaCloudFetch(path: string, accessToken: string, init?: RequestInit) {
  return fetch(`${LLAMACLOUD_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
}

const handler = async (req: Request) => {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return unauthorizedResponse(req);
  }

  return createMcpHandler(
    (server) => {
      server.tool(
        'list_indexes',
        'List available LlamaCloud indexes. Optionally filter by project_id.',
        {
          project_id: z.string().optional().describe('Project ID to filter indexes by'),
        },
        async ({ project_id }) => {
          const params = new URLSearchParams();
          if (project_id) params.set('project_id', project_id);

          const res = await llamaCloudFetch(
            `/api/v1/pipelines${params.toString() ? `?${params}` : ''}`,
            auth.accessToken,
          );

          if (!res.ok) {
            const errorText = await res.text();
            return {
              content: [{ type: 'text' as const, text: `Error listing indexes: ${res.status} - ${errorText}` }],
            };
          }

          const pipelines = await res.json();
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(pipelines) }],
          };
        },
      );

      server.tool(
        'query_index',
        'Query a LlamaCloud index to retrieve relevant information.',
        {
          pipeline_id: z.string().describe('The pipeline/index ID to query'),
          project_id: z.string().describe('The project ID that owns this pipeline'),
          query: z.string().describe('The search query'),
        },
        async ({ pipeline_id, project_id, query }) => {
          const params = new URLSearchParams({ project_id });
          const res = await llamaCloudFetch(
            `/api/v1/retrievers/retrieve?${params}`,
            auth.accessToken,
            {
              method: 'POST',
              body: JSON.stringify({
                query,
                pipelines: [{ pipeline_id }],
              }),
            },
          );

          if (!res.ok) {
            const errorText = await res.text();
            return {
              content: [{ type: 'text' as const, text: `Retriever error: ${res.status} - ${errorText}` }],
            };
          }

          const data = await res.json();
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(data) }],
          };
        },
      );
    },
    {},
    {
      basePath: "/mcp",
      redisUrl: process.env.REDIS_URL,
    }
  )(req);
};

export { handler as GET, handler as POST };

export async function OPTIONS() {
  const response = new Response(null, { status: 200 });
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return response;
}

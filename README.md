# mcp.llamaindex.ai

An authenticated [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that exposes [LlamaParse](https://developers.llamaindex.ai/llamaparse/) document processing capabilities to any MCP-compatible AI client. Built with Next.js 15 and deployed on Vercel, it uses [WorkOS AuthKit](https://workos.com/docs/user-management) for OAuth authentication so users sign in with their LlamaCloud credentials (**no API key sharing required**).

Visit [our docs](https://developers.llamaindex.ai/for-agents/) to learn more, or read on for exact implementation details.

## MCP Tools

| Tool | Description |
|------|-------------|
| `getUploadUrl` | Returns a short-lived pre-signed upload URL (and a browser upload link) for sending a file to LlamaParse storage |
| `uploadFileByUrl` | Uploads a file directly from a remote URL into LlamaParse storage |
| `getUserProjects` | Lists all LlamaCloud project IDs associated with the authenticated user |
| `parseFile` | Parses an uploaded file and returns its content as markdown or plain text |
| `classifyFile` | Classifies a file against a set of custom categories, returning the matched category, confidence score, and reasoning |
| `splitFile` | Splits a multi-section document into labelled segments based on custom categories |
| `searchSchemaTemplates` | Searches the built-in starter extraction schemas by keyword or category |
| `getSchemaTemplate` | Returns the full JSON Schema for one starter template |
| `createExtractionConfigFromSchema` | Creates an extraction configuration from a template id or an explicit JSON Schema, returning a configuration id for `extractFile` |

### Schema templates

`lib/business/schema-templates.json` is the starter-schema catalog shown in the
LlamaCloud Extract playground, vendored here so the CLI can offer the same
templates without an LLM round-trip through `generateExtractionConfig`.

**It is generated, not authored.** The source of truth is
`frontend/src/components/section/extract-v2/schema-designer/templates.ts` in the
`run-llama/platform` repo, which emits
`schema-templates.generated.json` via `templates-export.test.ts`
(`pnpm vitest run templates-export -u`). To pick up template changes, copy that
file over this one verbatim — no reformatting; `*.json` is in `.prettierignore`
here for exactly that reason.

The catalog carries a `fingerprint` of its own body, and
`__tests__/schema-templates.test.ts` recomputes it with the same hash the
platform repo uses. A hand-edit or a half-finished copy fails that test.

## Architecture

```
MCP Client (Claude, Cursor, etc.)
        │  HTTP + OAuth token
        ▼
┌──────────────────────────────┐
│  Next.js App (Vercel)        │
│  /mcp  ──► @vercel/mcp-adapter│
│            │                 │
│            ▼                 │
│  WorkOS JWT verification     │
│  Rate limiter (in-memory)    │
│            │                 │
│            ▼                 │
│  LlamaParse tools            │
│  (@llamaindex/llama-cloud)   │
└──────────────────────────────┘
        │
        ▼  (getUploadUrl only)
┌───────────────┐
│  Redis KV     │  stores short-lived upload tokens (10 min TTL)
└───────────────┘
```

## Using the hosted version

Production instances are already running in two regions. Pick the one that matches your LlamaCloud account — no server setup required either way.

| LlamaCloud account | MCP endpoint |
|------|-------------|
| `cloud.llamaindex.ai` (NA) | **`https://mcp.llamaindex.ai/mcp`** |
| `cloud.eu.llamaindex.ai` (EU) | **`https://mcp.eu.llamaindex.ai/mcp`** |

Region is a property of your account, not a per-session choice: a token issued in one region is rejected by the other with a `401` naming the correct endpoint. The client configurations below use the NA URL — substitute the EU URL if your account lives in the EU.

### Claude Desktop

Add the following to your `claude_desktop_config.json` (typically at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS or `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "llamaparse": {
      "type": "http",
      "url": "https://mcp.llamaindex.ai/mcp"
    }
  }
}
```

Restart Claude Desktop. On first use, open the MCP panel (`/mcp` slash command), select **llamaparse**, and click **Re-authenticate** to sign in with your LlamaCloud account.

### Claude CLI

```bash
claude mcp add --transport http llamaparse https://mcp.llamaindex.ai/mcp
```

Then run `/mcp` inside a Claude session, click **llamaparse → Re-authenticate**, and complete the OAuth flow in your browser.

### GitHub Copilot (VS Code)

Open your VS Code `settings.json` (`Cmd/Ctrl+Shift+P` → *Open User Settings (JSON)*) and add:

```json
{
  "mcp": {
    "servers": {
      "llamaparse": {
        "type": "http",
        "url": "https://mcp.llamaindex.ai/mcp"
      }
    }
  }
}
```

Restart VS Code. Copilot will prompt you to authenticate the first time a LlamaParse tool is invoked in agent mode.

### Cursor

Open **Settings → MCP** (or edit `~/.cursor/mcp.json`) and add:

```json
{
  "mcpServers": {
    "llamaparse": {
      "type": "http",
      "url": "https://mcp.llamaindex.ai/mcp"
    }
  }
}
```

Restart Cursor. The LlamaParse tools will appear in the Composer tool list. Cursor will redirect you to authenticate on first use.

---

## Quickstart (local development)

### Prerequisites

- Node.js 20+, `pnpm` 10+
- A [WorkOS](https://workos.com) account with an AuthKit application
- A [LlamaCloud](https://cloud.llamaindex.ai) account
- A Redis instance (local or cloud — required for file upload token storage)

### 1. Clone and install

```bash
git clone https://github.com/run-llama/mcp-llamaindex-ai
cd mcp-llamaindex-ai
pnpm install
```

### 2. Configure environment variables

Copy the example below into a `.env.local` file and fill in your values:

```bash
# WorkOS AuthKit
WORKOS_API_KEY=sk_...
WORKOS_CLIENT_ID=client_...
WORKOS_COOKIE_PASSWORD=<random-32-char-secret>   # used to sign session cookies
# Must be https and must not carry a path: it is advertised as the OAuth
# issuer and is where the discovery document is fetched from.
WORKOS_AUTHKIT_DOMAIN=https://<your-authkit-domain>.authkit.app
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback

# Public URL of this deployment (no trailing slash)
# Use http://localhost:3000 for local dev
NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL=http://localhost:3000

# LlamaCloud region this deployment serves: `na` (default) or `eu`.
# Selects the API base URL; `na` -> api.cloud.llamaindex.ai,
# `eu` -> api.cloud.eu.llamaindex.ai.
LLAMA_CLOUD_REGION=na

# Optional override of the API base, for local development.
# May only be a LlamaCloud region API (which then determines the region, so
# setting this alone is enough) or a loopback host with an explicit scheme
# (which requires LLAMA_CLOUD_REGION to be set). https is required for anything
# non-loopback. Arbitrary hosts — including staging APIs — are refused: a
# deployment that promises a region must not silently talk to somewhere else.
# LLAMA_CLOUD_BASE_URL=http://localhost:8000

# Redis — required for the pre-signed upload URL feature
REDIS_URI=redis://localhost:6379
```

> **WorkOS setup tip:** In your WorkOS dashboard, add `http://localhost:3000/callback` as an allowed redirect URI for local development.

> **Deploying `LLAMA_CLOUD_REGION=eu`:** the function region must also be in the
> EU. Documents are uploaded through this server, downloaded back for LiteParse,
> and parsed in the function, so pointing at the EU API is not on its own enough
> to keep them in region. Set the Vercel project's function region to `fra1`,
> `cdg1`, `arn1` or `dub1` — Vercel's default for a new project is `iad1`. An EU
> deployment left on the default still *deploys*; it then returns 500 for every
> request until the function region is corrected. Set it in **project
> settings**, not in a `vercel.json`: that file is shared with the NA project and
> would relocate its traffic too.

### 3. Run the dev server

```bash
pnpm dev
```

### 4. Connect an MCP client

**Claude Desktop / Claude CLI:**

```bash
claude mcp add --transport http llamaparse http://localhost:3000/mcp
```

Then open Claude, run `/mcp`, select `llamaparse`, and click **Re-authenticate** to complete the OAuth flow.

**Cursor or other HTTP-transport clients:** point them at `http://localhost:3000/mcp`.

## Deploying to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/run-llama/mcp-llamaindex-ai)

After deployment, set the same environment variables in your Vercel project settings, updating `NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL` and `NEXT_PUBLIC_WORKOS_REDIRECT_URI` to your production URL.

Connect your MCP client to the production endpoint:

```bash
claude mcp add --transport http llamaparse https://<your-deployment>.vercel.app/mcp
```

## Self-hosting against your own LlamaCloud

The hosted server authenticates through WorkOS AuthKit, which a BYOC or
self-hosted deployment cannot use: its users exist in the customer's own
LlamaCloud, not in our WorkOS directory. Setting `MCP_AUTH_MODE=api_key` runs
the server on LlamaCloud API keys alone.

```bash
MCP_AUTH_MODE=api_key
LLAMA_CLOUD_REGION=na                                  # or eu
LLAMA_CLOUD_BASE_URL=https://llamacloud.internal.example.com
REDIS_URI=redis://...

A Helm or Kubernetes deployment can supply the connection as separate values
instead, which is what the LlamaCloud chart emits. `REDIS_URI` wins when both
are set:

```
REDIS_HOST=llamacloud-redis
REDIS_PORT=6379
REDIS_SCHEME=redis        # rediss for TLS
REDIS_DB=0                # optional
REDIS_USERNAME=default    # optional
REDIS_PASSWORD=...        # optional
```
```

No `WORKOS_*` variable is required. (The AuthKit package is still imported and
reads a few at load, defaulting to empty; nothing in this mode depends on
them.) Callers authenticate by sending a LlamaCloud API key as the bearer
token:

```bash
claude mcp add --transport http llamacloud https://<your-deployment>/mcp \
  --header "Authorization: Bearer llx-..."
```

What changes in this mode:

- The OAuth discovery documents under `/.well-known/` return **404**, because
  there is no authorization server for a client to complete a flow against.
- A JWT is refused with a plain 401 naming the credential this deployment
  takes, rather than a challenge pointing at those withdrawn documents.
- `getUploadUrl` is unavailable to API-key callers on any deployment — it
  stores the caller's credential so the upload route can spend it, which is
  bounded for an expiring token and not for a key. Use `uploadFileByUrl`.
- `LLAMA_CLOUD_BASE_URL` may name your own host. It must be `https`, since it
  carries the API key and the document contents. `LLAMA_CLOUD_REGION` is still
  required so the deployment states what it serves rather than inheriting `na`
  by default; it does not affect routing, because the base URL is explicit.
- The EU compute pin is not applied. It exists to hold our own residency
  commitment, and a self-hosted deployment runs wherever you put it.

`MCP_AUTH_MODE` is deliberately explicit and never inferred from a missing
`WORKOS_CLIENT_ID`, so a variable dropped from the hosted configuration fails
at boot instead of silently downgrading it to API keys only.

Tool authorization still reflects the caller's own LlamaCloud permissions, and
the API enforces them — this server does not add a permission layer of its own.

### Fetching documents from inside your network

The guard below is on by default on every deployment, hosted included; the
opt-out exists for self-hosted ones, which is why it is documented here.

`uploadFileByUrl` has the server download a URL the caller supplied, so it can
reach whatever the server can. By default it refuses any URL resolving to a
loopback, link-local, RFC1918, carrier-grade-NAT or otherwise non-routable
address — including `169.254.169.254`, and including a public URL that redirects
to one.

A deployment whose documents genuinely live on an internal host can opt out:

```bash
ALLOW_PRIVATE_UPLOAD_HOSTS=true
```

Only the exact string `true` counts. Turning it on means any caller who can
reach this MCP server can have it fetch from your internal network and return
what it finds, so scope it the way you would scope an outbound proxy.

One limit worth knowing: the check resolves the hostname and then connects, so a
caller who controls DNS for their own domain can answer the check with a public
address and the connection with a private one. Closing that needs the resolved
address pinned onto the socket, which the platform's `fetch` does not expose.

## Development

```bash
pnpm dev          # start Next.js dev server
pnpm test         # run Jest test suite
pnpm test:watch   # watch mode
pnpm lint         # ESLint
pnpm prettier     # check formatting
pnpm prettier:fix # auto-fix formatting
```

## License

[MIT](LICENSE)

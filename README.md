# mcp.llamaindex.ai

An authenticated [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that exposes [LlamaParse](https://developers.llamaindex.ai/llamaparse/) document processing capabilities to any MCP-compatible AI client. Built with Next.js 15 and deployed on Vercel, it uses [WorkOS AuthKit](https://workos.com/docs/user-management) for OAuth authentication so users sign in with their LlamaCloud credentials (**no API key sharing required**).

## MCP Tools

| Tool | Description |
|------|-------------|
| `getUploadUrl` | Returns a short-lived pre-signed upload URL (and a browser upload link) for sending a file to LlamaParse storage |
| `uploadFileByUrl` | Uploads a file directly from a remote URL into LlamaParse storage |
| `getUserProjects` | Lists all LlamaCloud project IDs associated with the authenticated user |
| `parseFile` | Parses an uploaded file and returns its content as markdown or plain text |
| `classifyFile` | Classifies a file against a set of custom categories, returning the matched category, confidence score, and reasoning |
| `splitFile` | Splits a multi-section document into labelled segments based on custom categories |

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

A production instance is already running at **`https://mcp.llamaindex.ai/mcp`**. You can connect any MCP-compatible client directly — no server setup required.

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
WORKOS_AUTHKIT_DOMAIN=https://<your-authkit-domain>.authkit.app
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback

# Public URL of this deployment (no trailing slash)
# Use http://localhost:3000 for local dev
NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL=http://localhost:3000

# LlamaCloud (optional — overrides the default API base)
LLAMA_CLOUD_BASE_URL=https://api.cloud.llamaindex.ai

# Redis — required for the pre-signed upload URL feature
REDIS_URI=redis://localhost:6379
```

> **WorkOS setup tip:** In your WorkOS dashboard, add `http://localhost:3000/callback` as an allowed redirect URI for local development.

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

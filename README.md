# mcp.llamaindex.ai v2

New MCP for LlamaIndex and LlamaParse, reworked with WorkOS authentication.

## Quickstart

Clone the repo, install the dependencies and run the server in dev mode:

```bash
git clone https://github.com/run-llama/mcp-llamaindex-ai-v2
cd mcp-llamaindex-ai-v2
pnpm install
pnpm run dev
```

Add the MCP to Claude:

```bash
claude mcp add --transport http llamaparse http://localhost:3000/mcp
```

Once inside claude, you might need to open the MCP control panel (use the `/mcp` slash command), click on the `llamaparse` MCP and `Re-authenticate`.

# OAuth 2.1 MCP Server as a Next.js app

This is a Next.js-based application that provides an MCP (Model Context Protocol) server with OAuth 2.1 authentication support. It is intended as a model for building your own MCP server in a Next.js context.

In addition to being an OAuth server, it also requires the user authenticate. This is currently configured to use Google OAuth, but you could authenticate users however you want.

## Using with

### [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector)

Tell Inspector to connect to `http://localhost:3000/sse`, with Streamable HTTP transport.

### [Cursor](https://cursor.com/)

Add this to your mcp.json:

```
"my_server": {
  "name": "My Server",
  "url": "http://localhost:3000/sse",
  "transport": "sse"
}
```

### [VSCode](https://code.visualstudio.com/)

For some reason, VSCode doesn't send the `client_secret` parameter in the token request, so auth fails.

### [Claude Desktop](https://www.anthropic.com/products/claude-desktop)

Claude Desktop doesn't support arbitrary URLs as MCP servers, so you can't use it with this server.

## Running the server

```
npm install
npm run dev
```

Required environment variables in `.env`: (not `.env.local` because Prisma doesn't support it)

DATABASE_URL="postgresql://user:pass@server/database"
AUTH_SECRET=any random string
GOOGLE_CLIENT_ID=a Google OAuth client ID
GOOGLE_CLIENT_SECRET=a Google OAuth client secret

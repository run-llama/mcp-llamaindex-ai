# OAuth 2.1 MCP Server as a Next.js app

This is a Next.js-based application that provides an MCP (Model Context Protocol) server with OAuth 2.1 authentication support. It is intended as a model for building your own MCP server in a Next.js context.

In addition to being an OAuth server, it also requires the user authenticate. This is currently configured to use Google as a provider, but you could authenticate users however you want (X, GitHub, your own user/password database etc.) without breaking the OAuth flow.

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

VSCode [doesn't properly evict the client ID](https://github.com/microsoft/vscode/issues/250960), so client registration fails if you accidentally delete the client (the workaround in that issue will resolve it). Otherwise, it works fine. Add this to your settings.json:

```
"mcp": {
    "servers": {
        "My Server": {
            "url": "http://localhost:3000/sse"
        }
    }
}
```

### [Claude Desktop](https://www.anthropic.com/products/claude-desktop) and [Claude.ai](https://claude.ai)

Use the "Connect Apps" button and select "Add Integration". Provide the URL of your server. This may give you trouble if it's localhost but works as a remote server.

## Running the server

```
npm install
prisma generate
npm run dev
```

Required environment variables in `.env`: (not `.env.local` because Prisma doesn't support it)

```
DATABASE_URL="postgresql://user:pass@server/database"
AUTH_SECRET=any random string
GOOGLE_CLIENT_ID=a Google OAuth client ID
GOOGLE_CLIENT_SECRET=a Google OAuth client secret
```

## Architecture

If you're using this as a template for your own Next.js app, the important parts are:
* `/src/app/api/oauth/*` - these implement oauth client registration and token exchange
* `/src/app/oauth/authorize/page.tsx` - this implements the oauth consent screen (it's extremely basic right now)
* `/src/app/sse/route.ts` - this implements the MCP server itself, with correct redirects to the OAuth endpoints

Your app needs to be able to persist clients, access tokens, etc.. To do this it's using a PostgreSQL database accessed via Prisma. You can swap this for some other database if you want (it will be easiest if it's another Prisma-supported database).

You'll also notice:
* `src/app/auth.ts` - this implements Auth.js authentication to your app itself. It's configured to use Google as a provider, but you can change it to use any other provider supports by Auth.js. This is not required for the MCP server to work, but it's a good idea to have it in place for your own app.
* `src/app/api/auth/[...nextauth]/route.ts` - this plumbs in the Auth.js authentication, and is again not part of the OAuth implementation.

## Deploying to production

This app works deployed to Vercel, but you'll need to add `prisma generate` to your build command, and of course you'll need all the same environment variables as in the development environment.

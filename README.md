# MCP OAuth Server

A Next.js-based OAuth server that provides MCP (Model Context Protocol) services with OAuth 2.0 authentication support.

## Features

- OAuth 2.0 Client Credentials flow for server-to-server authentication
- OAuth 2.0 Device Authorization Grant flow for desktop applications
- MCP server implementation with SSE (Server-Sent Events)
- Google OAuth integration for user authentication
- Prisma-based database with PostgreSQL

## Device Authorization Flow

This server supports the OAuth 2.0 Device Authorization Grant flow, which is ideal for desktop applications that need to authenticate users without a web browser redirect.

### Flow Overview

1. **Desktop app discovers the MCP server** by calling `GET /api/sse`
2. **Desktop app requests device authorization** by calling `POST /api/oauth/device`
3. **User completes authentication** on the web at `/auth/device`
4. **Desktop app polls for completion** by calling `POST /api/oauth/device/token`
5. **Desktop app connects to MCP** using the received access token

### Step-by-Step Implementation

#### 1. Discover the MCP Server

```bash
curl -X GET http://localhost:3000/api/sse
```

Response includes device authorization endpoints:
```json
{
  "endpoints": {
    "device": "http://localhost:3000/api/oauth/device",
    "deviceToken": "http://localhost:3000/api/oauth/device/token",
    "verificationUrl": "http://localhost:3000/auth/device"
  },
  "auth": {
    "flows": {
      "device_authorization": {
        "deviceUrl": "http://localhost:3000/api/oauth/device",
        "tokenUrl": "http://localhost:3000/api/oauth/device/token",
        "verificationUrl": "http://localhost:3000/auth/device"
      }
    }
  }
}
```

#### 2. Request Device Authorization

```bash
curl -X POST http://localhost:3000/api/oauth/device \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "your_client_id",
    "scope": ["mcp:tools:read", "mcp:tools:call"]
  }'
```

Response:
```json
{
  "device_code": "ABCD1234",
  "user_code": "ABCD-EFGH",
  "verification_uri": "http://localhost:3000/auth/device",
  "verification_uri_complete": "http://localhost:3000/auth/device?code=ABCD-EFGH",
  "expires_in": 600,
  "interval": 5
}
```

#### 3. Display User Code

Show the user code (`ABCD-EFGH`) to the user and direct them to the verification URL.

#### 4. Poll for Authorization Completion

```bash
curl -X POST http://localhost:3000/api/oauth/device/token \
  -H "Content-Type: application/json" \
  -d '{
    "device_code": "ABCD1234",
    "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
  }'
```

While the user hasn't completed authorization:
```json
{
  "error": "authorization_pending",
  "error_description": "The user has not yet completed the authorization"
}
```

After the user completes authorization:
```json
{
  "access_token": "your_access_token",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "your_refresh_token",
  "scope": "mcp:tools:read mcp:tools:call"
}
```

#### 5. Connect to MCP Server

```bash
curl -X POST http://localhost:3000/api/sse \
  -H "Authorization: Bearer your_access_token" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize"
  }'
```

## API Endpoints

### OAuth Endpoints

- `POST /api/oauth/register` - Register a new OAuth client
- `POST /api/oauth/token` - Get access token (client credentials flow)
- `POST /api/oauth/validate` - Validate access token
- `POST /api/oauth/device` - Request device authorization
- `POST /api/oauth/device/token` - Exchange device code for token
- `POST /api/oauth/device/verify` - Verify device code (web interface)
- `POST /api/oauth/device/authorize` - Authorize device (web interface)

### MCP Endpoints

- `GET /api/sse` - Service discovery and MCP server info
- `POST /api/sse` - MCP server with SSE support

### Web Interface

- `/auth/device` - Device authorization web interface

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your database and OAuth credentials
```

3. Run database migrations:
```bash
npx prisma migrate dev
```

4. Start the development server:
```bash
npm run dev
```

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `NEXTAUTH_SECRET` - NextAuth secret key
- `NEXTAUTH_URL` - NextAuth URL (e.g., http://localhost:3000)

## Example Desktop Client

Here's a simple example of how a desktop application might implement this flow:

```python
import requests
import time

class MCPClient:
    def __init__(self, base_url, client_id):
        self.base_url = base_url
        self.client_id = client_id
        self.access_token = None
    
    def discover_server(self):
        response = requests.get(f"{self.base_url}/api/sse")
        return response.json()
    
    def request_device_auth(self):
        response = requests.post(f"{self.base_url}/api/oauth/device", json={
            "clientId": self.client_id,
            "scope": ["mcp:tools:read", "mcp:tools:call"]
        })
        return response.json()
    
    def poll_for_token(self, device_code, interval=5):
        while True:
            response = requests.post(f"{self.base_url}/api/oauth/device/token", json={
                "device_code": device_code,
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
            })
            
            if response.status_code == 200:
                data = response.json()
                self.access_token = data["access_token"]
                return data
            elif response.status_code == 400:
                error_data = response.json()
                if error_data.get("error") == "authorization_pending":
                    time.sleep(interval)
                    continue
                else:
                    raise Exception(f"Authorization failed: {error_data}")
            else:
                raise Exception(f"Unexpected response: {response.status_code}")
    
    def connect_to_mcp(self):
        if not self.access_token:
            raise Exception("No access token available")
        
        headers = {"Authorization": f"Bearer {self.access_token}"}
        response = requests.post(f"{self.base_url}/api/sse", headers=headers, json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize"
        })
        return response.json()

# Usage
client = MCPClient("http://localhost:3000", "your_client_id")

# Discover the server
server_info = client.discover_server()
print("Server discovered:", server_info["name"])

# Request device authorization
auth_info = client.request_device_auth()
print(f"Please visit: {auth_info['verification_uri_complete']}")

# Poll for completion
token_info = client.poll_for_token(auth_info["device_code"])
print("Authorization completed!")

# Connect to MCP
mcp_response = client.connect_to_mcp()
print("MCP connection established!")
```

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

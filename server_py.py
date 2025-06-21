# /// script
# dependencies = [
#     "fastapi",
#     "uvicorn",
#     "pyjwt",
#     "httpx",
#     "python-multipart",
#     "jinja2",
#     "mcp>=1.9.4",
#     "llama-cloud-services>=0.6.34",
#     "pydantic>=2.8,!=2.10",
# ]
# ///
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, cast

import httpx
import jwt
from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse
from llama_cloud import Project
from llama_cloud_services.extract.extract import AsyncLlamaCloud
from mcp import ServerSession
from mcp.server.auth.provider import (
    AccessToken as MCPAccessToken,
)
from mcp.server.auth.provider import (
    AuthorizationCode as MCPAuthorizationCode,
)
from mcp.server.auth.provider import (
    AuthorizationParams,
    OAuthAuthorizationServerProvider,
)
from mcp.server.auth.settings import (
    AuthSettings,
    ClientRegistrationOptions,
    RevocationOptions,
)
from mcp.server.fastmcp import Context, FastMCP
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic.v1 import BaseModel

# Configuration
OAUTH_SERVER_URL = "http://localhost:8000"
UPSTREAM_TEST_URL = "https://httpbin.org/bearer"
JWT_SECRET = "your-secret-key-change-in-production"

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# HTML template for API key input form
API_KEY_FORM_HTML = """
<!DOCTYPE html>
<html>
<head>
    <title>API Key Authorization</title>
    <style>
        body {{ font-family: Arial, sans-serif; max-width: 600px; margin: 100px auto; padding: 20px; }}
        .form-container {{ background: #f5f5f5; padding: 30px; border-radius: 8px; }}
        input[type="text"], input[type="password"] {{ width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; }}
        button {{ background: #007cba; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; }}
        button:hover {{ background: #005a87; }}
        h2 {{ color: #333; }}
        .info {{ background: #e7f3ff; padding: 15px; border-radius: 4px; margin: 20px 0; }}
    </style>
</head>
<body>
    <div class="form-container">
        <h2>🔐 API Key Authorization</h2>
        <div class="info">
            <p><strong>OAuth Application Authorization</strong></p>
            <p>This application requires access to your API key to make authenticated requests on your behalf.</p>
        </div>
        
        <form method="post" action="/authorize">
            <label for="api_key">Enter your API key:</label>
            <input type="password" id="api_key" name="api_key" required placeholder="Enter your API key here...">
            
            <input type="hidden" name="redirect_uri" value="{redirect_uri}">
            <input type="hidden" name="client_id" value="{client_id}">
            
            <button type="submit">Authorize Application</button>
        </form>
        
        <p style="font-size: 12px; color: #666; margin-top: 20px;">
            Your API key will be securely stored and used only for authenticated requests to the upstream service.
        </p>
    </div>
</body>
</html>
"""

# Create the main FastAPI application
app = FastAPI(
    title="OAuth-from-API-Key Bridge Server",
    description="Combined OAuth provider and MCP server for bridging OAuth apps with API key services",
    version="0.1.0",
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AccessToken(MCPAccessToken):
    api_key: str


class AuthorizationCode(MCPAuthorizationCode):
    api_key: str


JWT_DURATION_IN_SECONDS = 60 * 60 * 24 * 365  # 1 year


class FastAPIProvider(OAuthAuthorizationServerProvider):
    """OAuth provider that properly implements the MCP protocol"""

    def __init__(self):
        self.clients = {}
        self.auth_codes = {}
        self.access_tokens = {}

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        """Get client information by client ID"""
        logger.info(f"Getting client: {client_id}")
        return self.clients.get(client_id)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        """Register a client"""
        logger.info(f"Registering client: {client_info.client_id}")
        self.clients[client_info.client_id] = client_info

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        """Handle authorization - redirect to our OAuth form"""
        logger.info(
            f"Authorizing client {client.client_id} with redirect {params.redirect_uri}"
        )
        return f"{OAUTH_SERVER_URL}/authorize?client_id={client.client_id}&redirect_uri={params.redirect_uri}&response_type=code"

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        """Load authorization code"""
        logger.info(f"Loading auth code: {authorization_code[:20]}...")
        try:
            payload = jwt.decode(authorization_code, JWT_SECRET, algorithms=["HS256"])
            # Calculate expiration (1 hour from now)
            expires_at = datetime.now(timezone.utc).timestamp() + 3600
            return AuthorizationCode(
                code=authorization_code,
                scopes=["api:read"],
                expires_at=expires_at,
                client_id=client.client_id,
                code_challenge="",  # Not using PKCE for simplicity
                redirect_uri=payload.get("redirect_uri"),
                redirect_uri_provided_explicitly=True,
                api_key=payload.get("api_key"),
            )
        except Exception as e:
            logger.error(f"Failed to load auth code: {e}")
            return None

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        """Exchange authorization code for access token"""
        logger.info(f"Exchanging auth code for client {client.client_id}")

        # Create access token with API key
        access_payload = {
            "api_key": authorization_code.api_key,
            "exp": datetime.now(timezone.utc) + timedelta(days=365),
        }
        access_token = jwt.encode(access_payload, JWT_SECRET, algorithm="HS256")

        # Store the token
        expires_at = int(cast(datetime, access_payload["exp"]).timestamp())

        # Calculate expires_in based on actual expiration time
        current_time = int(datetime.now(timezone.utc).timestamp())
        expires_in = max(0, expires_at - current_time)

        token_obj = AccessToken(
            token=access_token,
            client_id=client.client_id,
            scopes=["api:read"],
            expires_at=expires_at,
            api_key=authorization_code.api_key,
        )
        self.access_tokens[access_token] = token_obj

        return OAuthToken(
            access_token=access_token,
            token_type="bearer",
            expires_in=expires_in,
        )

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> None:
        """Load refresh token (not implemented now)"""
        return None

    async def exchange_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: Any, scopes: list[str]
    ) -> OAuthToken:
        """Exchange refresh token (not implemented now)"""
        raise NotImplementedError("Refresh tokens not implemented")

    async def load_access_token(self, token: str) -> AccessToken | None:
        """Load and validate access token - this is the key method!"""
        logger.info(f"Loading access token: {token[:20]}...")
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            expires_at = payload.get("exp")
            token_obj = AccessToken(
                token=token,
                client_id="default",  # We'll use default for hackathon simplicity
                scopes=["api:read"],
                expires_at=expires_at,
                api_key=payload.get("api_key", ""),
            )
            self.access_tokens[token] = token_obj
            return token_obj
        except jwt.ExpiredSignatureError:
            logger.error("Token expired")
            return None
        except jwt.InvalidTokenError as e:
            logger.error(f"Invalid token: {e}")
            return None

    async def revoke_token(self, token: Any) -> None:
        """Revoke a token"""
        if hasattr(token, "token") and token.token in self.access_tokens:
            del self.access_tokens[token.token]
            logger.info("Token revoked")


# Create MCP server with OAuth authentication
mcp = FastMCP(
    "OAuth MCP Server",
    auth_server_provider=FastAPIProvider(),
    auth=AuthSettings(
        issuer_url=OAUTH_SERVER_URL,
        revocation_options=RevocationOptions(enabled=False),
        client_registration_options=ClientRegistrationOptions(
            enabled=True,
            valid_scopes=["api:read", "api:write"],
            default_scopes=["api:read"],
        ),
        required_scopes=["api:read"],
    ),
)


def get_api_key(ctx: Context[ServerSession, object, Request]) -> Optional[str]:
    """Get the API key from the authenticated token"""
    if ctx.request_context.request:
        auth_header = ctx.request_context.request.headers.get("authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:]  # Remove "Bearer " prefix
            payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            return payload.get("api_key", None)
    return None


@mcp.tool(description="Get the API key from the authenticated token")
async def list_projects(ctx: Context[ServerSession, object, Request]) -> str:
    """List projects available to the user"""
    try:
        ctx = mcp.get_context()
        api_key = get_api_key(ctx)
        if not api_key:
            raise ValueError("No API key found")

        client = AsyncLlamaCloud(token=api_key)
        projects = await client.projects.list_projects()

        return Projects(projects=projects).json()

    except Exception as e:
        logger.error(f"Tool error: {e}")
        return f"Tool error: {str(e)}"


class Projects(BaseModel):
    projects: list[Project]


@mcp.resource("config://server")
def get_server_config() -> str:
    """Get server configuration info"""
    return f"Combined OAuth + MCP Server running on {OAUTH_SERVER_URL}"


# OAuth Discovery Endpoints
@app.get("/.well-known/oauth-authorization-server")
async def oauth_authorization_server():
    """OAuth 2.0 Authorization Server Metadata"""
    return {
        "issuer": OAUTH_SERVER_URL,
        "authorization_endpoint": f"{OAUTH_SERVER_URL}/authorize",
        "token_endpoint": f"{OAUTH_SERVER_URL}/token",
        "registration_endpoint": f"{OAUTH_SERVER_URL}/register",
        "scopes_supported": ["api:read", "api:write"],
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "token_endpoint_auth_methods_supported": ["none", "client_secret_post"],
        "code_challenge_methods_supported": ["plain", "S256"],
    }


@app.get("/.well-known/oauth-protected-resource")
async def oauth_protected_resource():
    """OAuth 2.0 Protected Resource Metadata"""
    return {
        "resource": f"{OAUTH_SERVER_URL}/test-mcp",
        "authorization_servers": [OAUTH_SERVER_URL],
        "scopes_supported": ["api:read", "api:write"],
        "bearer_methods_supported": ["header"],
        "resource_documentation": f"{OAUTH_SERVER_URL}/docs",
    }


@app.post("/register")
async def register_client(request: Request):
    """OAuth 2.0 Dynamic Client Registration"""
    body = await request.body()
    logger.info(f"Client registration request: {body}")

    try:
        client_metadata = await request.json()
        logger.info(f"Client metadata: {client_metadata}")

        # Generate unique client credentials
        import uuid

        client_id = f"client_{uuid.uuid4().hex[:16]}"
        client_secret = uuid.uuid4().hex

        # Create client info object
        from mcp.shared.auth import OAuthClientInformationFull

        client_info = OAuthClientInformationFull(
            client_id=client_id,
            client_secret=client_secret,
            client_name=client_metadata.get("client_name", "MCP Client"),
            redirect_uris=client_metadata.get("redirect_uris", []),
            grant_types=client_metadata.get("grant_types", ["authorization_code"]),
            response_types=client_metadata.get("response_types", ["code"]),
            token_endpoint_auth_method=client_metadata.get(
                "token_endpoint_auth_method", "none"
            ),
        )

        # Actually register it with the provider
        await mcp._auth_server_provider.register_client(client_info)

        return {
            "client_id": client_id,
            "client_secret": client_secret,
            "client_name": client_info.client_name,
            "redirect_uris": client_info.redirect_uris,
            "grant_types": client_info.grant_types,
            "response_types": client_info.response_types,
            "token_endpoint_auth_method": client_info.token_endpoint_auth_method,
        }
    except Exception as e:
        logger.error(f"Client registration error: {e}")
        raise HTTPException(400, f"Invalid client metadata: {e}")


# OAuth Authorization Endpoint
@app.get("/authorize")
async def get_authorize(
    request: Request, redirect_uri: str, client_id: str = "default"
):
    """Show API key input form"""
    logger.info(
        f"Authorization request: redirect_uri={redirect_uri}, client_id={client_id}"
    )
    html_content = API_KEY_FORM_HTML.format(
        redirect_uri=redirect_uri, client_id=client_id
    )
    return HTMLResponse(content=html_content)


@app.post("/authorize")
async def post_authorize(
    api_key: str = Form(...), redirect_uri: str = Form(...), client_id: str = Form(...)
):
    """Process API key submission and redirect with auth code"""
    logger.info(
        f"Authorization POST: api_key=*****, redirect_uri={redirect_uri}, client_id={client_id}"
    )

    # Quick validation (allow through for hackathon speed)
    try:
        async with httpx.AsyncClient() as client:
            headers = {"Authorization": f"Bearer {api_key}"}
            await client.get(UPSTREAM_TEST_URL, headers=headers, timeout=5.0)
        logger.info("API key validation successful")
    except Exception as e:
        logger.warning(f"API key validation failed (allowing through): {e}")

    # Create auth code with API key embedded
    payload = {
        "api_key": api_key,
        "redirect_uri": redirect_uri,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
    }
    auth_code = jwt.encode(payload, JWT_SECRET, algorithm="HS256")
    logger.info(f"Generated auth code, redirecting to: {redirect_uri}")

    return RedirectResponse(f"{redirect_uri}?code={auth_code}")


# OAuth Token Endpoint
@app.post("/token")
async def exchange_token(request: Request):
    """Exchange authorization code for access token"""
    # Log the raw request body for debugging
    body = await request.body()
    logger.info(f"Token exchange request body: {body}")

    # Parse form data
    form_data = await request.form()
    grant_type = form_data.get("grant_type")
    code = form_data.get("code")
    client_id = form_data.get("client_id")
    client_secret = form_data.get("client_secret")

    logger.info(
        f"Token exchange: grant_type={grant_type}, client_id={client_id}, code_preview={code[:20] if code else None}..."
    )

    if grant_type != "authorization_code":
        raise HTTPException(400, "unsupported_grant_type")

    try:
        # Decode auth code to get API key
        payload = jwt.decode(code, JWT_SECRET, algorithms=["HS256"])
        api_key = payload["api_key"]
        logger.info("Successfully decoded auth code and extracted API key")

        # Create long-lived access token with API key
        access_payload = {
            "api_key": api_key,
            "exp": datetime.now(timezone.utc) + timedelta(days=365),
        }
        access_token = jwt.encode(access_payload, JWT_SECRET, algorithm="HS256")
        logger.info("Generated access token")

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "expires_in": 31536000,  # 1 year
        }
    except jwt.ExpiredSignatureError:
        logger.error("Auth code expired")
        raise HTTPException(400, "invalid_grant")
    except Exception as e:
        logger.error(f"Error exchanging token: {e}")
        raise HTTPException(400, "invalid_grant")


# Root endpoint with service information
@app.get("/")
async def root():
    """Service information and endpoint listing"""
    return {
        "service": "OAuth-from-API-Key Bridge",
        "description": "Bridges OAuth authentication with API key-based services",
        "version": "0.1.0",
        "endpoints": {
            "oauth_authorize": "/authorize",
            "oauth_token": "/token",
            "mcp_server": "/sse",
            "api_docs": "/docs",
        },
        "usage": "Connect MCP clients to /test-mcp endpoint. OAuth flow redirects to /authorize for API key input.",
    }


# Mount MCP server using SSE transport which might be more stable
app.mount("/", mcp.sse_app())


def main():
    """Entry point for the server"""
    import uvicorn

    print("🎯 Starting OAuth-from-API-Key Bridge Server")
    print("=" * 50)
    print("📋 OAuth endpoints: /authorize, /token")
    print("🔐 MCP endpoint: /test-mcp (streamable HTTP)")
    print("📖 API docs: /docs")
    print("🌐 Server: http://localhost:8000")
    print("=" * 50)

    # Use import string for hot reload support
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
    )


if __name__ == "__main__":
    main()
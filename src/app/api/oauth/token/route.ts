import { NextRequest } from "next/server";
import { validateOAuthClient, createAccessToken, refreshAccessToken } from "@/app/auth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { grant_type, client_id, client_secret, refresh_token, scope } = body;

    if (!client_id || !client_secret) {
      return Response.json(
        { error: "Client credentials are required" },
        { status: 400 }
      );
    }

    // Validate the client
    const client = await validateOAuthClient(client_id, client_secret);
    if (!client) {
      return Response.json({ error: "Invalid client" }, { status: 401 });
    }

    if (grant_type === "refresh_token") {
      if (!refresh_token) {
        return Response.json(
          { error: "Refresh token is required" },
          { status: 400 }
        );
      }

      const newToken = await refreshAccessToken(refresh_token);
      if (!newToken) {
        return Response.json({ error: "Invalid refresh token" }, { status: 401 });
      }

      return Response.json({
        access_token: newToken.accessToken,
        refresh_token: newToken.refreshToken,
        expires_in: Math.floor(
          (newToken.expiresAt.getTime() - Date.now()) / 1000
        ),
        token_type: "Bearer",
        scope: newToken.scope,
      });
    } else if (grant_type === "client_credentials") {
      const token = await createAccessToken(
        client_id,
        scope ? scope.split(" ") : []
      );

      return Response.json({
        access_token: token.accessToken,
        refresh_token: token.refreshToken,
        expires_in: Math.floor((token.expiresAt.getTime() - Date.now()) / 1000),
        token_type: "Bearer",
        scope: token.scope,
      });
    } else {
      return Response.json(
        { error: "Unsupported grant type" },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Error generating token:", error);
    return Response.json(
      { error: "Failed to generate token" },
      { status: 500 }
    );
  }
} 

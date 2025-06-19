import { NextRequest } from "next/server";
import { validateAccessToken } from "@/app/auth";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return Response.json(
        { error: "Bearer token is required" },
        { status: 401 }
      );
    }

    const token = authHeader.split(" ")[1];
    const validToken = await validateAccessToken(token);

    if (!validToken) {
      return Response.json({ error: "Invalid token" }, { status: 401 });
    }

    return Response.json({
      valid: true,
      clientId: validToken.client.clientId,
      scope: validToken.scope,
      expiresAt: validToken.expiresAt,
    });
  } catch (error) {
    console.error("Error validating token:", error);
    return Response.json(
      { error: "Failed to validate token" },
      { status: 500 }
    );
  }
} 

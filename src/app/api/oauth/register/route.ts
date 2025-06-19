import { NextRequest } from "next/server";
import { auth } from "@/app/auth";
import { createOAuthClient } from "@/app/auth";

export async function POST(req: NextRequest) {
  const session = await auth();
  
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, description, redirectUris } = body;

    if (!name) {
      return Response.json({ error: "Name is required" }, { status: 400 });
    }

    const client = await createOAuthClient(
      session.user.id,
      name,
      description,
      redirectUris
    );

    return Response.json({
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      name: client.name,
      description: client.description,
      redirectUris: client.redirectUris,
    });
  } catch (error) {
    console.error("Error registering OAuth client:", error);
    return Response.json(
      { error: "Failed to register OAuth client" },
      { status: 500 }
    );
  }
} 

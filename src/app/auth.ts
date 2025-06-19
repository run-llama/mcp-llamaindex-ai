import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { PrismaClient } from "../generated/prisma";
import crypto from "crypto";

const prisma = new PrismaClient();

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    async session({ session, user }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: user.id,
        },
      };
    },
  },
});

// OAuth helper functions
export async function createOAuthClient(userId: string, name: string, description?: string, redirectUris: string[] = []) {
  const clientId = crypto.randomBytes(16).toString("hex");
  const clientSecret = crypto.randomBytes(32).toString("hex");

  return prisma.oAuthClient.create({
    data: {
      clientId,
      clientSecret,
      name,
      description,
      redirectUris,
      userId,
    },
  });
}

export async function validateOAuthClient(clientId: string, clientSecret: string) {
  const client = await prisma.oAuthClient.findUnique({
    where: { clientId },
  });

  if (!client || client.clientSecret !== clientSecret) {
    return null;
  }

  return client;
}

export async function createAccessToken(clientId: string, scope: string[] = []) {
  const client = await prisma.oAuthClient.findUnique({
    where: { clientId },
  });

  if (!client) {
    throw new Error("Invalid client");
  }

  const accessToken = crypto.randomBytes(32).toString("hex");
  const refreshToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour from now

  return prisma.oAuthToken.create({
    data: {
      accessToken,
      refreshToken,
      clientId: client.id,
      expiresAt,
      scope,
    },
  });
}

export async function validateAccessToken(accessToken: string) {
  const token = await prisma.oAuthToken.findUnique({
    where: { accessToken },
    include: { client: true },
  });

  if (!token || token.expiresAt < new Date()) {
    return null;
  }

  return token;
}

export async function refreshAccessToken(refreshToken: string) {
  const token = await prisma.oAuthToken.findUnique({
    where: { refreshToken },
    include: { client: true },
  });

  if (!token) {
    return null;
  }

  const newAccessToken = crypto.randomBytes(32).toString("hex");
  const newRefreshToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour from now

  return prisma.oAuthToken.update({
    where: { id: token.id },
    data: {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresAt,
    },
  });
} 

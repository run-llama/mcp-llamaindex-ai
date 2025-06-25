import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "next-auth/react";

export const metadata: Metadata = {
  title: "LlamaCloud MCP Gateway",
  description: "Connect MCP clients to your LlamaCloud indexes!",
};

function SessionProviderWrapper({ children }: { children: React.ReactNode }) {
  // This is a client component wrapper for SessionProvider
  return <SessionProvider>{children}</SessionProvider>;
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <SessionProviderWrapper>{children}</SessionProviderWrapper>
      </body>
    </html>
  );
}

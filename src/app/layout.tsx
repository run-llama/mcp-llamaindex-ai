import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LlamaCloud MCP Server",
  description: "MCP server for LlamaCloud indexes",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

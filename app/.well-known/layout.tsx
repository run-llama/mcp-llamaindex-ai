import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '../components/theme-provider';
import { AuthKitProvider } from '@workos-inc/authkit-nextjs/components';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'LlamaParse MCP',
  description: 'The MCP server for your document processing agents.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} font-sans min-h-screen`}>
        <AuthKitProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            {children}
          </ThemeProvider>
        </AuthKitProvider>
      </body>
    </html>
  );
}

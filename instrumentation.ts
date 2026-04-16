import { registerOTel } from '@vercel/otel';

export function register() {
  registerOTel({ serviceName: 'vercel-mcp-example' });
}

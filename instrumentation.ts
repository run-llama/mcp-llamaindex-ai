import { registerOTel, OTLPHttpJsonTraceExporter } from '@vercel/otel';

export function register() {
  registerOTel({
    serviceName: 'llamaindex-mcp-traces',
    traceExporter: new OTLPHttpJsonTraceExporter({
      url: `https://${process.env.AXIOM_DOMAIN}/v1/traces`,
      headers: {
        Authorization: `Bearer ${process.env.AXIOM_TOKEN}`,
        'X-Axiom-Dataset': process.env.AXIOM_DATASET,
      },
    }),
  });
}

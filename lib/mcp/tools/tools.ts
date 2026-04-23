import { ensureUserAuthenticated } from '@/lib/auth/helpers';
import {
  classifyFile,
  getProjects,
  parseFile,
  splitFile,
  uploadFile,
} from '@/lib/business/llamaparse';
import { Category, SplitCategory } from '@/lib/business/types';
import { getLogger, redactFileId } from '@/lib/observability/logger';
import { createMcpHandler } from '@vercel/mcp-adapter';
import { trace } from '@opentelemetry/api';
import z from 'zod';
import { randomBytes } from 'node:crypto';
import { getKVStore } from '@/lib/business/kv';

const tracer = trace.getTracer('mcp-tools');

type McpServer = Parameters<Parameters<typeof createMcpHandler>[0]>[0];

export function registerLlamaParseTools(server: McpServer) {
  server.tool(
    'getUploadUrl',
    'Get a pre-signed URL to upload a file to the LlamaParse S3 storage',
    {
      purpose: z
        .string()
        .optional()
        .describe(
          "Expected downstream processing workload for the file to upload. Allowed values: 'user_data', 'parse', 'extract', 'split', 'classify', 'sheet', 'agent_app'. Defaults to 'parse' if not provided."
        ),
      projectId: z
        .string()
        .optional()
        .describe(
          'Project ID that the tool should use. Uses the default project if not provided.'
        ),
    },
    async (args, extra) => {
      return tracer.startActiveSpan('tool.getUploadUrl', async (span) => {
        const logger = getLogger();
        const { authInfo } = extra;
        ensureUserAuthenticated(authInfo);
        if (authInfo && authInfo.extra) {
          if ('rateLimit' in authInfo.extra && authInfo.extra.rateLimit) {
            logger.error(authInfo.extra.rateLimit);
            span.setAttribute('ratelimit.error', true);
            span.end();
            return {
              content: [
                {
                  type: 'text',
                  text: authInfo.extra.rateLimit as string,
                },
              ],
              isError: true,
            } as {
              content: { type: 'text'; text: string }[];
              isError: boolean;
            };
          }
        }
        const token = randomBytes(48).toString('base64url');
        const kvStore = getKVStore();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        try {
          await kvStore.set(token, authInfo!.token);
          logger.debug('Token successfully generated');
        } catch (e) {
          const message = `An error occurred while generating the presigned url: ${e}`;
          logger.error(message);
          span.setAttribute('uploadUrl.error', message);
          span.end();
          return {
            content: [
              {
                type: 'text',
                text: message,
              },
            ],
            isError: true,
          } as {
            content: { type: 'text'; text: string }[];
            isError: boolean;
          };
        }
        span.setAttribute('uploadUrl.success', true);
        span.end();
        const prod_url =
          process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL!.startsWith(
            'http'
          )
            ? process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL!
            : 'https://' +
              process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL!;
        const base = `${prod_url}/api/upload/${token}`;
        const url = new URL(base);
        url.searchParams.set('purpose', args.purpose ?? 'parse');
        url.searchParams.set('expires_at', expiresAt);
        if (args.projectId) {
          url.searchParams.set('project_id', args.projectId);
        }
        const presignedUrl = url.toString();
        const urlUpload = new URL(`${prod_url}/upload/${token}`);
        urlUpload.searchParams.set('expires_at', expiresAt);
        if (args.projectId) {
          url.searchParams.set('project_id', args.projectId);
        }
        return {
          content: [
            {
              type: 'text',
              text: `Send a POST request to this URL: ${presignedUrl} with a multipart form containing the file you want to upload under the 'file' key. You will receive the URL of the uploaded file.\n\nIf you can't use bash or your user prefers to upload the file manually, direct them to ${urlUpload}\n\nImportant note: The token is only valid until ${expiresAt} (time refers to UTC).`,
            },
          ],
        } as {
          content: { type: 'text'; text: string }[];
        };
      });
    }
  );

  server.tool(
    'uploadFileByUrl',
    'Upload a file to LLamaParse S3 storage providing a URL to download the file data. On upload completion, the file will be sent to LlamaParse S3 storage, so that it can be used for downstream processing tasks like parsing, classification or splitting.',
    {
      url: z.string().describe('URL of the file to upload'),
      fileName: z.string().describe('Basename of the original file'),
      fileType: z
        .string()
        .optional()
        .describe(
          'Mimetype of the file. Defaults to application/pdf if not provided. Highly recommended to always provide it'
        ),
      purpose: z
        .string()
        .optional()
        .describe(
          "Expected downstream processing workload. Allowed values: 'user_data', 'parse', 'extract', 'split', 'classify', 'sheet', 'agent_app'. Defaults to 'parse' if not provided."
        ),
      projectId: z
        .string()
        .optional()
        .describe(
          'Project ID that the tool should use. Uses the default project if not provided.'
        ),
    },
    async (args, extra) => {
      return tracer.startActiveSpan('tool.uploadFileByUrl', async (span) => {
        span.setAttribute('tool.file_name', args.fileName);
        if (args.fileType) span.setAttribute('tool.file_type', args.fileType);
        if (args.purpose) span.setAttribute('tool.purpose', args.purpose);
        const logger = getLogger();
        const { authInfo } = extra;
        ensureUserAuthenticated(authInfo);
        if (authInfo && authInfo.extra) {
          if ('rateLimit' in authInfo.extra && authInfo.extra.rateLimit) {
            logger.error(authInfo.extra.rateLimit);
            span.setAttribute('ratelimit.error', true);
            span.end();
            return {
              content: [
                {
                  type: 'text',
                  text: authInfo.extra.rateLimit as string,
                },
              ],
              isError: true,
            } as {
              content: { type: 'text'; text: string }[];
              isError: boolean;
            };
          }
        }
        const response = await fetch(args.url, { method: 'GET' });
        logger.debug(`Downloading ${args.url}`);
        if (!response.ok) {
          const details = await response.text();
          logger.error(
            `It was not possible to download the file. Response returned with status ${response.status}: ${details}`
          );
          span.setAttribute('tool.error', true);
          span.end();
          return {
            content: [
              {
                type: 'text',
                text: `It was not possible to download the file. Response returned with status ${response.status}: ${details}`,
              },
            ],
            isError: true,
          } as {
            content: { type: 'text'; text: string }[];
            isError: boolean;
          };
        }
        try {
          const fileData = await response.arrayBuffer();
          const fileId = await uploadFile({
            authToken: authInfo!.token,
            fileData: new Uint8Array(fileData),
            fileName: args.fileName,
            fileType: args.fileType,
            purpose: args.purpose,
            projectId: args.projectId,
          });
          logger.info(
            `Produced file ID as a result of file upload by URL: ${redactFileId(fileId)}`
          );
          span.end();
          return {
            content: [
              {
                type: 'text',
                text: `ID for the uploaded file: ${fileId}`,
              },
            ],
          } as {
            content: { type: 'text'; text: string }[];
          };
        } catch (err) {
          logger.error(`An error occurred while uploading file by URL: ${err}`);
          span.setAttribute('tool.error', true);
          span.end();
          throw err;
        }
      });
    }
  );

  server.tool(
    'getUserProjects',
    'Get all the project IDs associated to a user so that you can use them to call tools from different project IDs',
    {},
    async (_args, extra) => {
      return tracer.startActiveSpan('tool.getUserProjects', async (span) => {
        const { authInfo } = extra;
        ensureUserAuthenticated(authInfo);
        const logger = getLogger();
        if (authInfo && authInfo.extra) {
          if ('rateLimit' in authInfo.extra && authInfo.extra.rateLimit) {
            logger.error(authInfo.extra.rateLimit);
            span.setAttribute('ratelimit.error', true);
            span.end();
            return {
              content: [
                {
                  type: 'text',
                  text: authInfo.extra.rateLimit as string,
                },
              ],
              isError: true,
            } as {
              content: { type: 'text'; text: string }[];
              isError: boolean;
            };
          }
        }
        try {
          const result = await getProjects(authInfo!.token);
          logger.info(
            `Successfully obtained ${result.length} projects for the user`
          );
          span.end();
          return {
            content: [
              {
                type: 'text',
                text: `Project IDs: ${result.join(', ')}`,
              },
            ],
          } as {
            content: { type: 'text'; text: string }[];
          };
        } catch (err) {
          logger.error(`An error occurred while getting projects: ${err}`);
          span.setAttribute('tool.error', true);
          span.end();
          throw err;
        }
      });
    }
  );

  server.tool(
    'parseFile',
    'Parse a file providing its file ID, retrieving markdown or plain text content of the file. Use with file IDs obtained with the uploadFileChunk tool or that the user provided',
    {
      fileId: z
        .string()
        .describe(
          'ID of the file to parse, as returned by the file upload tool or provided by the user'
        ),
      tier: z
        .enum(['cost_effective', 'agentic', 'agentic_plus'])
        .optional()
        .describe(
          'Parsing mode to use. While agentic or agentic_plus are recommended, this parameter defaults to cost_effective if not specified.'
        ),
      version: z
        .union([z.literal('latest'), z.string()])
        .optional()
        .describe('API version to use. Defaults to `latest` if not specified.'),
      markdown: z
        .boolean()
        .optional()
        .describe(
          'Whether to extract markdown or plain text. Defaults to true (extract markdown).'
        ),
      projectId: z
        .string()
        .optional()
        .describe(
          'Project ID that the tool should use. Uses the default project if not provided.'
        ),
    },
    async (args, extra) => {
      return tracer.startActiveSpan('tool.parseFile', async (span) => {
        span.setAttribute('tool.file_id', redactFileId(args.fileId));
        if (args.tier) span.setAttribute('tool.tier', args.tier);
        if (args.version) span.setAttribute('tool.version', args.version);
        const { authInfo } = extra;
        ensureUserAuthenticated(authInfo);
        const logger = getLogger();
        if (authInfo && authInfo.extra) {
          if ('rateLimit' in authInfo.extra && authInfo.extra.rateLimit) {
            logger.error(authInfo.extra.rateLimit);
            span.setAttribute('ratelimit.error', true);
            span.end();
            return {
              content: [
                {
                  type: 'text',
                  text: authInfo.extra.rateLimit as string,
                },
              ],
              isError: true,
            } as {
              content: { type: 'text'; text: string }[];
              isError: boolean;
            };
          }
        }
        try {
          const result = await parseFile({
            authToken: authInfo!.token,
            fileId: args.fileId,
            tier: args.tier,
            version: args.version,
            markdown: args.markdown,
            projectId: args.projectId,
          });
          logger.info(`Successfully parsed ${redactFileId(args.fileId)}`);
          span.end();
          return {
            content: [
              {
                type: 'text',
                text:
                  result.markdown ?? result.text ?? 'No parsed text available',
              },
            ],
          } as {
            content: { type: 'text'; text: string }[];
          };
        } catch (err) {
          logger.error(`An error occurred while parsing: ${err}`);
          span.setAttribute('tool.error', true);
          span.end();
          throw err;
        }
      });
    }
  );

  server.tool(
    'classifyFile',
    'Classify a file (based on specific categories) providing its file ID. Use with file IDs obtained with the uploadFileChunk tool or that the user provided',
    {
      fileId: z
        .string()
        .describe(
          'ID of the file to classify, as returned by the file upload tool or provided by the user'
        ),
      mode: z
        .literal('FAST')
        .optional()
        .describe('Classification mode to use.'),
      categories: z
        .array(Category)
        .describe(
          'Array of categories for the file to be classfied as. Category types should be lowercase and use snake_case. Category descriptions should be exaustive but not longer than 500 characters'
        ),
      projectId: z
        .string()
        .optional()
        .describe(
          'Project ID that the tool should use. Uses the default project if not provided.'
        ),
    },
    async (args, extra) => {
      return tracer.startActiveSpan('tool.classifyFile', async (span) => {
        span.setAttribute('tool.file_id', redactFileId(args.fileId));
        if (args.mode) span.setAttribute('tool.mode', args.mode);
        const { authInfo } = extra;
        ensureUserAuthenticated(authInfo);
        const logger = getLogger();
        if (authInfo && authInfo.extra) {
          if ('rateLimit' in authInfo.extra && authInfo.extra.rateLimit) {
            logger.error(authInfo.extra.rateLimit);
            span.setAttribute('ratelimit.error', true);
            span.end();
            return {
              content: [
                {
                  type: 'text',
                  text: authInfo.extra.rateLimit as string,
                },
              ],
              isError: true,
            } as {
              content: { type: 'text'; text: string }[];
              isError: boolean;
            };
          }
        }
        try {
          const result = await classifyFile({
            authToken: authInfo!.token,
            fileId: args.fileId,
            mode: args.mode,
            categories: args.categories,
            projectId: args.projectId,
          });
          logger.info(`Successfully classified ${redactFileId(args.fileId)}`);
          span.end();
          return {
            content: [
              {
                type: 'text',
                text: result.asString(),
              },
            ],
          } as {
            content: { type: 'text'; text: string }[];
          };
        } catch (err) {
          logger.error(`An error occurred while classifying: ${err}`);
          span.setAttribute('tool.error', true);
          span.end();
          throw err;
        }
      });
    }
  );

  server.tool(
    'splitFile',
    'Split a file into category-based segments providing its file ID. Use with file IDs obtained with the uploadFileChunk tool or that the user provided',
    {
      fileId: z
        .string()
        .describe(
          'ID of the file to classify, as returned by the file upload tool or provided by the user'
        ),
      allowUncategorized: z
        .enum(['omit', 'include', 'forbid'])
        .optional()
        .describe(
          'Whether to omit, include or forbid uncategorized results. If you forbid uncategorized results, you force categorization even when the confidence is low. Defaults to `include`'
        ),
      categories: z
        .array(SplitCategory)
        .describe(
          'Array of categories for the file to be classfied as. Category names should be lowercase and use snake_case. Category descriptions should be exaustive but not longer than 500 characters'
        ),
      projectId: z
        .string()
        .optional()
        .describe(
          'Project ID that the tool should use. Uses the default project if not provided.'
        ),
    },
    async (args, extra) => {
      return tracer.startActiveSpan('tool.splitFile', async (span) => {
        span.setAttribute('tool.file_id', redactFileId(args.fileId));
        if (args.allowUncategorized)
          span.setAttribute(
            'tool.allow_uncategorized',
            args.allowUncategorized
          );
        const { authInfo } = extra;
        ensureUserAuthenticated(authInfo);
        const logger = getLogger();
        if (authInfo && authInfo.extra) {
          if ('rateLimit' in authInfo.extra && authInfo.extra.rateLimit) {
            logger.error(authInfo.extra.rateLimit);
            span.setAttribute('ratelimit.error', true);
            span.end();
            return {
              content: [
                {
                  type: 'text',
                  text: authInfo.extra.rateLimit as string,
                },
              ],
              isError: true,
            } as {
              content: { type: 'text'; text: string }[];
              isError: boolean;
            };
          }
        }
        try {
          const result = await splitFile({
            authToken: authInfo!.token,
            fileId: args.fileId,
            allowUnacategorized: args.allowUncategorized,
            categories: args.categories,
            projectId: args.projectId,
          });
          logger.info(`Successfully classified ${redactFileId(args.fileId)}`);
          span.end();
          return {
            content: [
              {
                type: 'text',
                text: result.asString(),
              },
            ],
          } as {
            content: { type: 'text'; text: string }[];
          };
        } catch (err) {
          logger.error(`An error occurred while splitting: ${err}`);
          span.setAttribute('tool.error', true);
          span.end();
          throw err;
        }
      });
    }
  );
}

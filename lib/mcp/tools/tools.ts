import { ensureUserAuthenticated } from '@/lib/auth/helpers';
import { publicBaseUrl } from '@/lib/urls';
import {
  classifyFile,
  createIndex,
  extract,
  generateExtractSchema,
  getIndexStatus,
  getProjects,
  grepFileFromIndex,
  listIndexes,
  parseFile,
  readFileFromIndex,
  retrieveFromIndex,
  searchFilesFromIndex,
  splitFile,
  syncIndex,
  uploadFile,
} from '@/lib/business/llamaparse';
import {
  addFilesToDirectory,
  createDirectory,
  listDirectories,
  listDirectory,
} from '@/lib/business/directories';
import { Category, SplitCategory } from '@/lib/business/types';
import { getLogger, redactFileId } from '@/lib/observability/logger';
import { createMcpHandler } from '@vercel/mcp-adapter';
import { trace, Span } from '@opentelemetry/api';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import z from 'zod';
import { randomBytes } from 'node:crypto';
import { getKVStore } from '@/lib/business/kv';
import { isComplex, litParse } from '@/lib/business/liteparse';

const tracer = trace.getTracer('mcp-tools');

export type McpServer = Parameters<Parameters<typeof createMcpHandler>[0]>[0];

// Shared helper: enforce auth + rate limit; returns a tool error response if rate
// limited (so the caller can short-circuit), or null to proceed.
type ToolErrorResponse = {
  content: { type: 'text'; text: string }[];
  isError: boolean;
};

function checkRateLimitedResponse(
  authInfo: AuthInfo | undefined,
  span: Span
): ToolErrorResponse | null {
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
      };
    }
  }
  return null;
}

type ToolTextResponse = {
  content: { type: 'text'; text: string }[];
};

/**
 * Render a tool result as JSON.
 *
 * The write tools all emit identifiers that must round-trip verbatim into a
 * later call, so they return JSON rather than the prose format used by the
 * older read tools.
 */
function jsonResult(value: unknown): ToolTextResponse {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

// =====================
// Upload tools
// =====================

export function registerGetUploadUrlTool(server: McpServer) {
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
        const rl = checkRateLimitedResponse(authInfo, span);
        if (rl) return rl;
        // Resolved before the token is written and the span is closed: this
        // can now reject several malformed shapes, and throwing after the write
        // burns a token and records a successful span for a failed call.
        const prodUrl = publicBaseUrl();
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
          } as ToolErrorResponse;
        }
        span.setAttribute('uploadUrl.success', true);
        span.end();
        const base = `${prodUrl}/api/upload/${token}`;
        const url = new URL(base);
        url.searchParams.set('purpose', args.purpose ?? 'parse');
        url.searchParams.set('expires_at', expiresAt);
        if (args.projectId) {
          url.searchParams.set('project_id', args.projectId);
        }
        const presignedUrl = url.toString();
        const urlUpload = new URL(`${prodUrl}/upload/${token}`);
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
}

export function registerUploadFileByUrlTool(server: McpServer) {
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
        const rl = checkRateLimitedResponse(authInfo, span);
        if (rl) return rl;
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
          } as ToolErrorResponse;
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
}

// =====================
// Project tool
// =====================

export function registerGetUserProjectsTool(server: McpServer) {
  server.tool(
    'getUserProjects',
    'List the projects available to the user, with their names, so you can pass the right projectId to other tools. Use this whenever a tool needs a projectId and the correct project is not already known — pick by name, and ask the user if the name is ambiguous.',
    {},
    async (_args, extra) => {
      return tracer.startActiveSpan('tool.getUserProjects', async (span) => {
        const { authInfo } = extra;
        ensureUserAuthenticated(authInfo);
        const logger = getLogger();
        const rl = checkRateLimitedResponse(authInfo, span);
        if (rl) return rl;
        try {
          const result = await getProjects(authInfo!.token);
          logger.info(
            `Successfully obtained ${result.length} projects for the user`
          );
          span.end();
          return jsonResult({ projects: result });
        } catch (err) {
          logger.error(`An error occurred while getting projects: ${err}`);
          span.setAttribute('tool.error', true);
          span.end();
          throw err;
        }
      });
    }
  );
}

// =====================
// Parse tool
// =====================

export function registerParseFileTool(server: McpServer) {
  server.tool(
    'parseFile',
    'Parse a file providing its file ID, retrieving markdown or plain text content of the file. Use with file IDs obtained with the getUploadUrl/uploadFileByUrl tool or that the user provided',
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
      pages: z
        .array(z.number())
        .optional()
        .describe('Specific pages to limit the parsing operation to'),
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
        const rl = checkRateLimitedResponse(authInfo, span);
        if (rl) return rl;
        try {
          const result = await parseFile({
            authToken: authInfo!.token,
            fileId: args.fileId,
            tier: args.tier,
            version: args.version,
            markdown: args.markdown,
            projectId: args.projectId,
            pages: args.pages,
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
}

// =====================
// LiteParse tool
// =====================

export function registerLitParseTool(server: McpServer) {
  server.tool(
    'parseWithLiteParse',
    'Parse a PDF file with LiteParse, a fast, in-process parser that does not consume credits from the LlamaParse Platform. The tool needs a file ID obtained with the getUploadUrl/uploadFileByUrl tool or provided by the user. Only works with PDF files.',
    {
      fileId: z.string().describe('ID of the file to parse.'),
      pages: z
        .array(z.number())
        .optional()
        .describe('Page numbers to limit the parsing operation to. 1-based.'),
      markdown: z
        .boolean()
        .optional()
        .describe(
          'Whether the output text should be markdown-formatted or plain text'
        ),
      includeJson: z
        .boolean()
        .optional()
        .describe(
          'Whether to include the JSON array of pages (with bboxes) in the parse result'
        ),
    },
    async (args, extra) => {
      return tracer.startActiveSpan('tool.parseWithLiteParse', async (span) => {
        span.setAttribute('tool.file_id', redactFileId(args.fileId));
        if (typeof args.markdown !== 'undefined')
          span.setAttribute('tool.markdown', args.markdown);
        if (typeof args.includeJson !== 'undefined')
          span.setAttribute('tool.include_json', args.includeJson);
        if (args.pages)
          span.setAttribute(
            'tool.version',
            args.pages.map((p) => p.toString).join(', ')
          );
        const { authInfo } = extra;
        ensureUserAuthenticated(authInfo);
        const logger = getLogger();
        const rl = checkRateLimitedResponse(authInfo, span);
        if (rl) return rl;
        try {
          const result = await litParse({
            authToken: authInfo!.token,
            fileId: args.fileId,
            markdown: args.markdown,
            pages: args.pages,
            includeJson: args.includeJson,
          });
          logger.info(
            `Successfully parsed ${redactFileId(args.fileId)} with LiteParse`
          );
          span.end();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, undefined, 2),
              },
            ],
          } as {
            content: { type: 'text'; text: string }[];
          };
        } catch (err) {
          logger.error(
            `An error occurred while parsing with LiteParse: ${err}`
          );
          span.setAttribute('tool.error', true);
          span.end();
          throw err;
        }
      });
    }
  );
}

export function registerLitIsComplexTool(server: McpServer) {
  server.tool(
    'estimateFileComplexity',
    'Estimate the parsing complexity of a PDF file (providing its file ID) using LiteParse. Returns a JSON object mapping each page with the LlamaParse tier it should be parsed with (or if you should use LiteParse), based on the parsing complexity and the need for OCR. Use in combination with parseFile and parseWithLiteParse. The tool needs a file ID obtained with the getUploadUrl/uploadFileByUrl tool or provided by the user. Only works with PDF files.',
    {
      fileId: z
        .string()
        .describe(
          'ID of the file whose parsing complexity you want to estimate.'
        ),
      includeLayout: z
        .boolean()
        .optional()
        .describe(
          'Whether or not to include layout signals in the complexity estimation. Defaults to false.'
        ),
    },
    async (args, extra) => {
      return tracer.startActiveSpan(
        'tool.estimateFileComplexity',
        async (span) => {
          span.setAttribute('tool.file_id', redactFileId(args.fileId));
          const { authInfo } = extra;
          ensureUserAuthenticated(authInfo);
          const logger = getLogger();
          const rl = checkRateLimitedResponse(authInfo, span);
          if (rl) return rl;
          try {
            const result = await isComplex({
              authToken: authInfo!.token,
              fileId: args.fileId,
              includeLayout: args.includeLayout ?? false,
            });
            logger.info(
              `Successfully parsed ${redactFileId(args.fileId)} with LiteParse`
            );
            span.end();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, undefined, 2),
                },
              ],
            } as {
              content: { type: 'text'; text: string }[];
            };
          } catch (err) {
            logger.error(
              `An error occurred while estimating the file complexity with LiteParse: ${err}`
            );
            span.setAttribute('tool.error', true);
            span.end();
            throw err;
          }
        }
      );
    }
  );
}

// =====================
// Classify tool
// =====================

export function registerClassifyFileTool(
  server: McpServer,
  fixedConfigurationId?: string
) {
  const schema: Record<string, z.ZodTypeAny> = {
    fileId: z
      .string()
      .describe(
        'ID of the file to classify, as returned by the file upload tool or provided by the user'
      ),
  };
  if (!fixedConfigurationId) {
    schema.mode = z
      .literal('FAST')
      .optional()
      .describe('Classification mode to use.');
    schema.categories = z
      .array(Category)
      .describe(
        'Array of categories for the file to be classfied as. Category types should be lowercase and use snake_case. Category descriptions should be exaustive but not longer than 500 characters'
      );
    schema.projectId = z
      .string()
      .optional()
      .describe(
        'Project ID that the tool should use. Uses the default project if not provided.'
      );
  } else {
    schema.projectId = z
      .string()
      .describe('Project ID that the tool should use.');
  }
  const description = fixedConfigurationId
    ? `Classify a file using the saved classify configuration ${fixedConfigurationId}. Provide the file ID (as returned by the upload tool or supplied by the user); the categories are pulled from the saved configuration.`
    : 'Classify a file (based on specific categories) providing its file ID. Use with file IDs obtained with the getUploadUrl/uploadFileByUrl tool or that the user provided';
  server.tool('classifyFile', description, schema, async (args, extra) => {
    return tracer.startActiveSpan('tool.classifyFile', async (span) => {
      span.setAttribute('tool.file_id', redactFileId(args.fileId as string));
      if (args.mode) span.setAttribute('tool.mode', args.mode as string);
      if (fixedConfigurationId)
        span.setAttribute('tool.config_id', redactFileId(fixedConfigurationId));
      const { authInfo } = extra;
      ensureUserAuthenticated(authInfo);
      const logger = getLogger();
      const rl = checkRateLimitedResponse(authInfo, span);
      if (rl) return rl;
      try {
        const result = await classifyFile({
          authToken: authInfo!.token,
          fileId: args.fileId as string,
          mode: args.mode as 'FAST' | undefined,
          categories: args.categories as never,
          projectId: args.projectId as string | undefined,
          configurationId: fixedConfigurationId,
        });
        logger.info(
          `Successfully classified ${redactFileId(args.fileId as string)}`
        );
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
  });
}

// =====================
// Split tool
// =====================

export function registerSplitFileTool(
  server: McpServer,
  fixedConfigurationId?: string
) {
  const schema: Record<string, z.ZodTypeAny> = {
    fileId: z
      .string()
      .describe(
        'ID of the file to split, as returned by the file upload tool or provided by the user'
      ),
  };
  if (!fixedConfigurationId) {
    schema.allowUncategorized = z
      .enum(['omit', 'include', 'forbid'])
      .optional()
      .describe(
        'Whether to omit, include or forbid uncategorized results. If you forbid uncategorized results, you force categorization even when the confidence is low. Defaults to `include`'
      );
    schema.categories = z
      .array(SplitCategory)
      .describe(
        'Array of categories for the file to be classfied as. Category names should be lowercase and use snake_case. Category descriptions should be exaustive but not longer than 500 characters'
      );
    schema.projectId = z
      .string()
      .optional()
      .describe(
        'Project ID that the tool should use. Uses the default project if not provided.'
      );
  } else {
    schema.projectId = z
      .string()
      .describe('Project ID that the tool should use.');
  }
  const description = fixedConfigurationId
    ? `Split a file into category-based segments using the saved split configuration ${fixedConfigurationId}. Provide the file ID (as returned by the upload tool or supplied by the user); the categories and splitting strategy are pulled from the saved configuration.`
    : 'Split a file into category-based segments providing its file ID. Use with file IDs obtained with the getUploadUrl/uploadFileByUrl tool or that the user provided';
  server.tool('splitFile', description, schema, async (args, extra) => {
    return tracer.startActiveSpan('tool.splitFile', async (span) => {
      span.setAttribute('tool.file_id', redactFileId(args.fileId as string));
      if (args.allowUncategorized)
        span.setAttribute(
          'tool.allow_uncategorized',
          args.allowUncategorized as string
        );
      if (fixedConfigurationId)
        span.setAttribute('tool.config_id', redactFileId(fixedConfigurationId));
      const { authInfo } = extra;
      ensureUserAuthenticated(authInfo);
      const logger = getLogger();
      const rl = checkRateLimitedResponse(authInfo, span);
      if (rl) return rl;
      try {
        const result = await splitFile({
          authToken: authInfo!.token,
          fileId: args.fileId as string,
          allowUnacategorized: args.allowUncategorized as
            | 'omit'
            | 'include'
            | 'forbid'
            | undefined,
          categories: args.categories as never,
          projectId: args.projectId as string | undefined,
          configurationId: fixedConfigurationId,
        });
        logger.info(
          `Successfully split ${redactFileId(args.fileId as string)}`
        );
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
  });
}

// =====================
// Extract tools
// =====================

export function registerGenerateExtractionConfigTool(server: McpServer) {
  server.tool(
    'generateExtractionConfig',
    'Generate the configuration to extract structured data from a specific file using the Extract service from the LlamaParse Platform. Provide a prompt describing what the schema of the extracted data, the ID of the file to extract and, optionally, a project ID.',
    {
      fileId: z
        .string()
        .describe(
          'ID of the file for which to generate the extraction config, as returned by the file upload tool or provided by the user'
        ),
      generationPrompt: z
        .string()
        .describe(
          'Prompt to generate the extraction configuration, describing the data schema to extract.'
        ),
      projectId: z
        .string()
        .optional()
        .describe(
          'Project ID that the tool should use. Uses the default project if not provided.'
        ),
    },
    async (args, extra) => {
      return tracer.startActiveSpan(
        'tool.generateExtractionConfig',
        async (span) => {
          span.setAttribute('tool.file_id', redactFileId(args.fileId));
          span.setAttribute('tool.prompt', args.generationPrompt.slice(0, 100));
          const { authInfo } = extra;
          ensureUserAuthenticated(authInfo);
          const logger = getLogger();
          const rl = checkRateLimitedResponse(authInfo, span);
          if (rl) return rl;
          try {
            const result = await generateExtractSchema({
              token: authInfo!.token,
              fileId: args.fileId,
              generationPrompt: args.generationPrompt,
              projectId: args.projectId,
            });
            logger.info(
              `Successfully generated schema for ${redactFileId(args.fileId)}`
            );
            span.end();
            return {
              content: [
                {
                  type: 'text',
                  text: `Generated JSON schema for extraction:\n\n\`\`\`json\n${result[0]}\n\`\`\`\n\nConfiguration ID: ${result[1]}.\nIf you are satisfied with the generated schema, use the configuration ID to call the 'extract' tool to actually extract the structured data`,
                },
              ],
            } as {
              content: { type: 'text'; text: string }[];
            };
          } catch (err) {
            logger.error(
              `An error occurred while generating JSON schema: ${err}`
            );
            span.setAttribute('tool.error', true);
            span.end();
            throw err;
          }
        }
      );
    }
  );
}

export function registerExtractFileTool(
  server: McpServer,
  fixedConfigurationId?: string
) {
  const schema: Record<string, z.ZodTypeAny> = {
    fileId: z
      .string()
      .describe(
        'ID of the file to extract, as returned by the file upload tool or provided by the user'
      ),
  };
  if (!fixedConfigurationId) {
    schema.configurationId = z
      .string()
      .describe(
        'ID of the configuration to use to extract data from the file, as provided by the `generateExtractionConfig` tool.'
      );
    schema.projectId = z
      .string()
      .optional()
      .describe(
        'Project ID that the tool should use. Uses the default project if not provided.'
      );
  } else {
    schema.projectId = z
      .string()
      .describe('Project ID that the tool should use.');
  }
  const description = fixedConfigurationId
    ? `Extract structured data from a file using the saved extraction configuration ${fixedConfigurationId}. Returns the extracted structured data.`
    : 'Extract structured data from a file based on the configuration created with the `generateExtractionConfig` tool. Returns the extracted structured data.';
  server.tool('extractFile', description, schema, async (args, extra) => {
    return tracer.startActiveSpan('tool.extractFile', async (span) => {
      const configurationId =
        fixedConfigurationId ?? (args.configurationId as string);
      span.setAttribute('tool.file_id', redactFileId(args.fileId as string));
      span.setAttribute('tool.config_name', redactFileId(configurationId));
      const { authInfo } = extra;
      ensureUserAuthenticated(authInfo);
      const logger = getLogger();
      const rl = checkRateLimitedResponse(authInfo, span);
      if (rl) return rl;
      try {
        const result = await extract({
          token: authInfo!.token,
          fileId: args.fileId as string,
          projectId: args.projectId as string | undefined,
          configurationId,
        });
        logger.info(
          `Successfully extracted ${redactFileId(args.fileId as string)}`
        );
        span.end();
        return {
          content: [
            {
              type: 'text',
              text: result,
            },
          ],
        } as {
          content: { type: 'text'; text: string }[];
        };
      } catch (err) {
        logger.error(`An error occurred while extracting data: ${err}`);
        span.setAttribute('tool.error', true);
        span.end();
        throw err;
      }
    });
  });
}

// =====================
// Index tools
// =====================
// All index tools accept an optional `fixedIndexId`. When provided, the
// registered tool removes `indexId` from its input schema and uses the
// fixed value (useful for the /index/[indexId]/mcp route).

export function registerListIndexesTool(server: McpServer) {
  server.tool(
    'listIndexes',
    'List all the available indexes on the LlamaParse Platform. Indexes are vector-indexed directories with the possibility of searching/reading/grepping files and performing retrieval.',
    {
      projectId: z
        .string()
        .optional()
        .describe(
          'Project ID that the tool should use. Uses the default project if not provided.'
        ),
    },
    async (args, extra) => {
      return tracer.startActiveSpan('tool.listIndexes', async (span) => {
        const { authInfo } = extra;
        ensureUserAuthenticated(authInfo);
        const logger = getLogger();
        const rl = checkRateLimitedResponse(authInfo, span);
        if (rl) return rl;
        try {
          const result = await listIndexes({
            authToken: authInfo!.token,
            projectId: args.projectId ?? null,
          });
          logger.info(`Successfully listed indexes`);
          span.end();
          return {
            content: [
              {
                type: 'text',
                text: result,
              },
            ],
          } as {
            content: { type: 'text'; text: string }[];
          };
        } catch (err) {
          logger.error(`An error occurred while listing indexes: ${err}`);
          span.setAttribute('tool.error', true);
          span.end();
          throw err;
        }
      });
    }
  );
}

export function registerFindFilesInIndexTool(
  server: McpServer,
  fixedIndexId?: string
) {
  const schema: Record<string, z.ZodTypeAny> = {
    fileName: z
      .string()
      .optional()
      .describe('Extact match for the file name to search for'),
    fileNameContains: z
      .string()
      .optional()
      .describe(
        'Substring contained in the file name to search for (recommended using over fileName)'
      ),
  };
  if (!fixedIndexId) {
    schema.indexId = z
      .string()
      .describe('Index ID, as provided by the listIndexes tool');
    schema.projectId = z
      .string()
      .optional()
      .describe(
        'Project ID that the tool should use. Uses the default project if not provided.'
      );
  } else {
    schema.projectId = z
      .string()
      .describe(
        'Project ID that the tool should use. Should correspond to the one the index is registered under.'
      );
  }
  server.tool(
    'findFilesInIndex',
    'Search files within an index. Optionally provide the file name to filter for or a substring that should be contained in the file name',
    schema,
    async (args, extra) => {
      return tracer.startActiveSpan(
        'tool.searchFilesFromIndex',
        async (span) => {
          const { authInfo } = extra;
          ensureUserAuthenticated(authInfo);
          const indexId = fixedIndexId ?? (args.indexId as string);
          const projectId = (args.projectId as string | undefined) ?? null;
          span.setAttribute('tool.index_id', redactFileId(indexId));
          const logger = getLogger();
          const rl = checkRateLimitedResponse(authInfo, span);
          if (rl) return rl;
          try {
            const result = await searchFilesFromIndex({
              authToken: authInfo!.token,
              projectId,
              indexId,
              fileName: (args.fileName as string | undefined) ?? null,
              fileNameContains:
                (args.fileNameContains as string | undefined) ?? null,
            });
            logger.info(`Successfully searched files`);
            span.end();
            return {
              content: [
                {
                  type: 'text',
                  text: result,
                },
              ],
            } as {
              content: { type: 'text'; text: string }[];
            };
          } catch (err) {
            logger.error(`An error occurred while searching for files: ${err}`);
            span.setAttribute('tool.error', true);
            span.end();
            throw err;
          }
        }
      );
    }
  );
}

export function registerReadFileFromIndexTool(
  server: McpServer,
  fixedIndexId?: string
) {
  const schema: Record<string, z.ZodTypeAny> = {
    fileId: z
      .string()
      .describe(
        'ID of the file to read, as obtained by the searchFilesFromIndex tool'
      ),
    offset: z
      .number()
      .optional()
      .describe('Offset (in characters) from which to read the file from'),
    maxLength: z
      .number()
      .optional()
      .describe(
        'Maximum length (in characters) to read starting from the offset.'
      ),
  };
  if (!fixedIndexId) {
    schema.indexId = z
      .string()
      .describe('Index ID, as provided by the listIndexes tool');
    schema.projectId = z
      .string()
      .optional()
      .describe(
        'Project ID that the tool should use. Uses the default project if not provided.'
      );
  } else {
    schema.projectId = z
      .string()
      .describe(
        'Project ID that the tool should use. Should correspond to the one the index is registered under.'
      );
  }
  server.tool(
    'readFileFromIndex',
    'Read the content of a file from an index, providing its file ID and, optionally, an offset and a maximum length (in characters) to read.',
    schema,
    async (args, extra) => {
      return tracer.startActiveSpan('tool.readFileFromIndex', async (span) => {
        const { authInfo } = extra;
        ensureUserAuthenticated(authInfo);
        const indexId = fixedIndexId ?? (args.indexId as string);
        const projectId = (args.projectId as string | undefined) ?? null;
        span.setAttribute('tool.index_id', redactFileId(indexId));
        span.setAttribute('tool.file_id', redactFileId(args.fileId as string));
        const logger = getLogger();
        const rl = checkRateLimitedResponse(authInfo, span);
        if (rl) return rl;
        try {
          const result = await readFileFromIndex({
            authToken: authInfo!.token,
            projectId,
            indexId,
            fileId: args.fileId as string,
            offset: (args.offset as number | undefined) ?? null,
            maxLength: (args.maxLength as number | undefined) ?? null,
          });
          logger.info(`Successfully read file`);
          span.end();
          return {
            content: [
              {
                type: 'text',
                text: result,
              },
            ],
          } as {
            content: { type: 'text'; text: string }[];
          };
        } catch (err) {
          logger.error(`An error occurred while reading the file: ${err}`);
          span.setAttribute('tool.error', true);
          span.end();
          throw err;
        }
      });
    }
  );
}

export function registerGrepFileFromIndexTool(
  server: McpServer,
  fixedIndexId?: string
) {
  const schema: Record<string, z.ZodTypeAny> = {
    fileId: z
      .string()
      .describe(
        'ID of the file to read, as obtained by the searchFilesFromIndex tool'
      ),
    pattern: z.string().describe('Pattern to grep the file with'),
    contextChars: z
      .number()
      .optional()
      .describe(
        'Context (in characters) to retrieve along with the grep match'
      ),
    limit: z
      .number()
      .optional()
      .describe('Maximum number of grep matches to retrieve'),
  };
  if (!fixedIndexId) {
    schema.indexId = z
      .string()
      .describe('Index ID, as provided by the listIndexes tool');
    schema.projectId = z
      .string()
      .optional()
      .describe(
        'Project ID that the tool should use. Uses the default project if not provided.'
      );
  } else {
    schema.projectId = z
      .string()
      .describe(
        'Project ID that the tool should use. Should correspond to the one the index is registered under.'
      );
  }
  server.tool(
    'grepFileFromIndex',
    'Grep the content of a file from an index, providing its file ID, the pattern to grep for and, optionally, a number of context characters and a maximum number of grep matches to retrieve',
    schema,
    async (args, extra) => {
      return tracer.startActiveSpan('tool.grepFileFromIndex', async (span) => {
        const { authInfo } = extra;
        ensureUserAuthenticated(authInfo);
        const indexId = fixedIndexId ?? (args.indexId as string);
        const projectId = (args.projectId as string | undefined) ?? null;
        span.setAttribute('tool.index_id', redactFileId(indexId));
        span.setAttribute('tool.file_id', redactFileId(args.fileId as string));
        span.setAttribute('tool.grep_pattern', args.pattern as string);
        const logger = getLogger();
        const rl = checkRateLimitedResponse(authInfo, span);
        if (rl) return rl;
        try {
          const result = await grepFileFromIndex({
            authToken: authInfo!.token,
            projectId,
            indexId,
            fileId: args.fileId as string,
            pattern: args.pattern as string,
            limit: (args.limit as number | undefined) ?? null,
            contextChars: (args.contextChars as number | undefined) ?? null,
          });
          logger.info(`Successfully grepped file`);
          span.end();
          return {
            content: [
              {
                type: 'text',
                text: result,
              },
            ],
          } as {
            content: { type: 'text'; text: string }[];
          };
        } catch (err) {
          logger.error(`An error occurred while grepping the file: ${err}`);
          span.setAttribute('tool.error', true);
          span.end();
          throw err;
        }
      });
    }
  );
}

export function registerRetrieveFromIndexTool(
  server: McpServer,
  fixedIndexId?: string
) {
  const schema: Record<string, z.ZodTypeAny> = {
    query: z.string().describe('Query to search for'),
    topK: z
      .number()
      .optional()
      .describe('Top K documents to retrieve. Defaults to 10.'),
    rerankTopN: z
      .number()
      .optional()
      .describe(
        'Top N documents to rerank. If not provided, reranking will be disabled.'
      ),
  };
  if (!fixedIndexId) {
    schema.indexId = z
      .string()
      .describe('Index ID, as provided by the listIndexes tool');
    schema.projectId = z
      .string()
      .optional()
      .describe(
        'Project ID that the tool should use. Uses the default project if not provided.'
      );
  } else {
    schema.projectId = z
      .string()
      .describe(
        'Project ID that the tool should use. Should correspond to the one the index is registered under.'
      );
  }
  server.tool(
    'retrieveFromIndex',
    'Perform hybrid search on the index, providing a query and, optionally, the top K documents to retrieve and the top N documents to rerank',
    schema,
    async (args, extra) => {
      return tracer.startActiveSpan('tool.retrieveFromIndex', async (span) => {
        const { authInfo } = extra;
        ensureUserAuthenticated(authInfo);
        const indexId = fixedIndexId ?? (args.indexId as string);
        const projectId = (args.projectId as string | undefined) ?? null;
        span.setAttribute('tool.index_id', redactFileId(indexId));
        span.setAttribute('tool.query', redactFileId(args.query as string));
        const logger = getLogger();
        const rl = checkRateLimitedResponse(authInfo, span);
        if (rl) return rl;
        try {
          const result = await retrieveFromIndex({
            authToken: authInfo!.token,
            projectId,
            indexId,
            query: args.query as string,
            topK: (args.topK as number | undefined) ?? null,
            rerankTopN: (args.rerankTopN as number | undefined) ?? null,
          });
          logger.info(`Successfully retrieved from index`);
          span.end();
          return {
            content: [
              {
                type: 'text',
                text: result,
              },
            ],
          } as {
            content: { type: 'text'; text: string }[];
          };
        } catch (err) {
          logger.error(
            `An error occurred while retrieving from the index: ${err}`
          );
          span.setAttribute('tool.error', true);
          span.end();
          throw err;
        }
      });
    }
  );
}

// =====================
// Directory tools
// =====================

export function registerCreateDirectoryTool(server: McpServer) {
  server.tool(
    'createDirectory',
    'Create a directory (folder) to hold source documents. A directory is what an index is built over: upload files, add them to a directory with addFilesToDirectory, then call createIndex on it.',
    {
      name: z.string().min(1).describe('Name for the new directory'),
      projectId: z
        .string()
        .describe(
          'Project ID to create the directory in. Required — call getUserProjects to list the available projects and ask the user which one to use if it is not obvious.'
        ),
      description: z
        .string()
        .optional()
        .describe('Optional description for the directory'),
    },
    async (args, extra) => {
      return tracer.startActiveSpan('tool.createDirectory', async (span) => {
        const { authInfo } = extra;
        ensureUserAuthenticated(authInfo);
        const logger = getLogger();
        const rl = checkRateLimitedResponse(authInfo, span);
        if (rl) return rl;
        try {
          const result = await createDirectory({
            authToken: authInfo!.token,
            name: args.name,
            projectId: args.projectId,
            description: args.description ?? null,
          });
          logger.info(`Created directory ${redactFileId(result.directoryId)}`);
          span.end();
          return jsonResult(result);
        } catch (err) {
          logger.error(`An error occurred while creating a directory: ${err}`);
          span.setAttribute('tool.error', true);
          span.end();
          throw err;
        }
      });
    }
  );
}

export function registerListDirectoriesTool(server: McpServer) {
  server.tool(
    'listDirectories',
    'List the directories in a project. Returns one page at a time — pass the returned nextPageToken to fetch more. By default only user directories are listed; indexes create their own internal output directories, which are not valid sources for a new index.',
    {
      name: z.string().optional().describe('Exact directory name to filter by'),
      type: z
        .enum(['user', 'index', 'ephemeral'])
        .optional()
        .describe(
          "Directory type to list. Defaults to 'user'. Only pass 'index' or 'ephemeral' if you specifically need internal directories."
        ),
      pageSize: z
        .number()
        .optional()
        .describe('Maximum number of directories to return per page'),
      pageToken: z
        .string()
        .optional()
        .describe('Token from a previous response to retrieve the next page'),
      projectId: z
        .string()
        .optional()
        .describe(
          'Project ID that the tool should use. Uses the default project if not provided.'
        ),
    },
    async (args, extra) => {
      return tracer.startActiveSpan('tool.listDirectories', async (span) => {
        const { authInfo } = extra;
        ensureUserAuthenticated(authInfo);
        const logger = getLogger();
        const rl = checkRateLimitedResponse(authInfo, span);
        if (rl) return rl;
        try {
          const result = await listDirectories({
            authToken: authInfo!.token,
            projectId: args.projectId ?? null,
            name: args.name ?? null,
            type: args.type ?? 'user',
            pageSize: args.pageSize ?? null,
            pageToken: args.pageToken ?? null,
          });
          logger.info(`Listed ${result.directories.length} directories`);
          span.end();
          return jsonResult(result);
        } catch (err) {
          logger.error(`An error occurred while listing directories: ${err}`);
          span.setAttribute('tool.error', true);
          span.end();
          throw err;
        }
      });
    }
  );
}

export function registerListDirectoryTool(server: McpServer) {
  server.tool(
    'listDirectory',
    'List the files inside a directory, along with the directory itself. Returns one page at a time — pass the returned nextPageToken to fetch more. Use directoryFileId, not fileId, when referring to a file in later calls.',
    {
      directoryId: z
        .string()
        .describe(
          'ID of the directory to list, as returned by listDirectories'
        ),
      displayNameContains: z
        .string()
        .optional()
        .describe('Substring match on the file name (case-insensitive)'),
      pageSize: z
        .number()
        .optional()
        .describe('Maximum number of files to return per page'),
      pageToken: z
        .string()
        .optional()
        .describe('Token from a previous response to retrieve the next page'),
      includeDownloadUrls: z
        .boolean()
        .optional()
        .describe(
          'Include a temporary download URL for each file. Defaults to false; only enable it if you need to fetch the file contents.'
        ),
      projectId: z
        .string()
        .optional()
        .describe(
          'Project ID that the tool should use. Uses the default project if not provided.'
        ),
    },
    async (args, extra) => {
      return tracer.startActiveSpan('tool.listDirectory', async (span) => {
        const { authInfo } = extra;
        ensureUserAuthenticated(authInfo);
        span.setAttribute('tool.directory_id', redactFileId(args.directoryId));
        const logger = getLogger();
        const rl = checkRateLimitedResponse(authInfo, span);
        if (rl) return rl;
        try {
          const result = await listDirectory({
            authToken: authInfo!.token,
            directoryId: args.directoryId,
            projectId: args.projectId ?? null,
            displayNameContains: args.displayNameContains ?? null,
            pageSize: args.pageSize ?? null,
            pageToken: args.pageToken ?? null,
            includeDownloadUrls: args.includeDownloadUrls ?? false,
          });
          logger.info(`Listed ${result.files.length} directory files`);
          span.end();
          return jsonResult(result);
        } catch (err) {
          logger.error(`An error occurred while listing a directory: ${err}`);
          span.setAttribute('tool.error', true);
          span.end();
          throw err;
        }
      });
    }
  );
}

export function registerAddFilesToDirectoryTool(server: McpServer) {
  server.tool(
    'addFilesToDirectory',
    'Add already-uploaded files to a directory, so they can be indexed. Takes file IDs from getUploadUrl or uploadFileByUrl. Files are added one by one, so the response reports which succeeded and which failed — retry only the failed ones. If the directory already backs an index, call syncIndex afterwards to pull the new files in.',
    {
      directoryId: z
        .string()
        .describe('ID of the directory to add the files to'),
      fileIds: z
        .array(z.string())
        .min(1)
        .describe(
          'IDs of the files to add, as returned by getUploadUrl or uploadFileByUrl'
        ),
      projectId: z
        .string()
        .optional()
        .describe(
          'Project ID that the tool should use. Uses the default project if not provided.'
        ),
    },
    async (args, extra) => {
      return tracer.startActiveSpan(
        'tool.addFilesToDirectory',
        async (span) => {
          const { authInfo } = extra;
          ensureUserAuthenticated(authInfo);
          span.setAttribute(
            'tool.directory_id',
            redactFileId(args.directoryId)
          );
          span.setAttribute('tool.file_count', args.fileIds.length);
          const logger = getLogger();
          const rl = checkRateLimitedResponse(authInfo, span);
          if (rl) return rl;
          try {
            const result = await addFilesToDirectory({
              authToken: authInfo!.token,
              directoryId: args.directoryId,
              fileIds: args.fileIds,
              projectId: args.projectId ?? null,
            });
            logger.info(
              `Added ${result.added.length} files to directory, ${result.failed.length} failed`
            );
            if (result.failed.length > 0) {
              span.setAttribute('tool.partial_failure', true);
            }
            span.end();
            return jsonResult(result);
          } catch (err) {
            logger.error(
              `An error occurred while adding files to a directory: ${err}`
            );
            span.setAttribute('tool.error', true);
            span.end();
            throw err;
          }
        }
      );
    }
  );
}

// =====================
// Index write tools
// =====================

export function registerCreateIndexTool(server: McpServer) {
  server.tool(
    'createIndex',
    'Create an index over a directory, making its documents searchable with retrieveFromIndex and the other index tools. The directory must already contain the files you want indexed — upload them and call addFilesToDirectory first. Indexing runs in the background: the returned index is not queryable until getIndexStatus reports it ready.',
    {
      sourceDirectoryId: z
        .string()
        .describe(
          'ID of the directory holding the documents to index, as returned by createDirectory or listDirectories'
        ),
      name: z
        .string()
        .optional()
        .describe(
          'Name for the index. Defaults to the source directory name if omitted.'
        ),
      description: z
        .string()
        .optional()
        .describe(
          'Description of what the index contains. Shown by listIndexes, so it is worth setting — it is how an agent later decides whether this index answers a question.'
        ),
      storeAttachments: z
        .array(z.enum(['screenshots', 'items']))
        .optional()
        .describe(
          "Extra artifacts to store per page. 'screenshots' keeps rendered page images; 'items' keeps structured items with bounding boxes. Defaults to ['screenshots']."
        ),
      parseConfigId: z
        .string()
        .optional()
        .describe(
          'Parse configuration to use. Omit to let the platform create a default one.'
        ),
      projectId: z
        .string()
        .optional()
        .describe(
          'Project ID that the tool should use. Uses the default project if not provided.'
        ),
    },
    async (args, extra) => {
      return tracer.startActiveSpan('tool.createIndex', async (span) => {
        const { authInfo } = extra;
        ensureUserAuthenticated(authInfo);
        span.setAttribute(
          'tool.source_directory_id',
          redactFileId(args.sourceDirectoryId)
        );
        const logger = getLogger();
        const rl = checkRateLimitedResponse(authInfo, span);
        if (rl) return rl;
        try {
          const result = await createIndex({
            authToken: authInfo!.token,
            sourceDirectoryId: args.sourceDirectoryId,
            projectId: args.projectId ?? null,
            name: args.name ?? null,
            description: args.description ?? null,
            storeAttachments: args.storeAttachments ?? ['screenshots'],
            parseConfigId: args.parseConfigId ?? null,
          });
          logger.info(`Created index ${redactFileId(result.indexId)}`);
          span.end();
          return jsonResult({
            ...result,
            message:
              'Initial sync started. Poll getIndexStatus until status is ready before querying the index.',
          });
        } catch (err) {
          logger.error(`An error occurred while creating an index: ${err}`);
          span.setAttribute('tool.error', true);
          span.end();
          throw err;
        }
      });
    }
  );
}

export function registerGetIndexStatusTool(server: McpServer) {
  server.tool(
    'getIndexStatus',
    "Check whether an index has finished building. Indexing is asynchronous, so an index created or synced moments ago will not return results yet. Poll this until status is 'ready'; 'failed' means the build did not complete. Querying an index that is not ready looks identical to an index with no matching documents.",
    {
      indexId: z
        .string()
        .describe('Index ID, as returned by createIndex or listIndexes'),
      projectId: z
        .string()
        .optional()
        .describe(
          'Project ID that the tool should use. Uses the default project if not provided.'
        ),
    },
    async (args, extra) => {
      return tracer.startActiveSpan('tool.getIndexStatus', async (span) => {
        const { authInfo } = extra;
        ensureUserAuthenticated(authInfo);
        span.setAttribute('tool.index_id', redactFileId(args.indexId));
        const logger = getLogger();
        const rl = checkRateLimitedResponse(authInfo, span);
        if (rl) return rl;
        try {
          const result = await getIndexStatus({
            authToken: authInfo!.token,
            indexId: args.indexId,
            projectId: args.projectId ?? null,
          });
          logger.info(`Fetched index status`);
          span.end();
          return jsonResult(result);
        } catch (err) {
          logger.error(
            `An error occurred while getting the index status: ${err}`
          );
          span.setAttribute('tool.error', true);
          span.end();
          throw err;
        }
      });
    }
  );
}

export function registerSyncIndexTool(server: McpServer) {
  server.tool(
    'syncIndex',
    'Re-index a directory, picking up files added or changed since the last run. Indexes do not refresh on their own, so this is the only way an existing index sees new documents. Runs in the background — poll getIndexStatus until status is ready. If a sync is already running, this returns syncStarted=false (the underlying API responds 409 or 429): do not retry syncIndex, call getIndexStatus to check the running sync and wait until status is ready.',
    {
      indexId: z
        .string()
        .describe('Index ID, as returned by createIndex or listIndexes'),
      projectId: z
        .string()
        .optional()
        .describe(
          'Project ID that the tool should use. Uses the default project if not provided.'
        ),
    },
    async (args, extra) => {
      return tracer.startActiveSpan('tool.syncIndex', async (span) => {
        const { authInfo } = extra;
        ensureUserAuthenticated(authInfo);
        span.setAttribute('tool.index_id', redactFileId(args.indexId));
        const logger = getLogger();
        const rl = checkRateLimitedResponse(authInfo, span);
        if (rl) return rl;
        try {
          const result = await syncIndex({
            authToken: authInfo!.token,
            indexId: args.indexId,
            projectId: args.projectId ?? null,
          });
          logger.info(`Sync requested: started=${result.syncStarted}`);
          span.end();
          return jsonResult(result);
        } catch (err) {
          logger.error(`An error occurred while syncing the index: ${err}`);
          span.setAttribute('tool.error', true);
          span.end();
          throw err;
        }
      });
    }
  );
}

// =====================
// Aggregate registration (backwards-compatible: all tools)
// =====================

export function registerLlamaParseTools(server: McpServer) {
  registerGetUploadUrlTool(server);
  registerUploadFileByUrlTool(server);
  registerGetUserProjectsTool(server);
  registerParseFileTool(server);
  registerClassifyFileTool(server);
  registerSplitFileTool(server);
  registerGenerateExtractionConfigTool(server);
  registerExtractFileTool(server);
  registerListIndexesTool(server);
  registerFindFilesInIndexTool(server);
  registerReadFileFromIndexTool(server);
  registerGrepFileFromIndexTool(server);
  registerRetrieveFromIndexTool(server);
  registerCreateDirectoryTool(server);
  registerListDirectoriesTool(server);
  registerListDirectoryTool(server);
  registerAddFilesToDirectoryTool(server);
  registerCreateIndexTool(server);
  registerGetIndexStatusTool(server);
  registerSyncIndexTool(server);
  registerLitParseTool(server);
  registerLitIsComplexTool(server);
}

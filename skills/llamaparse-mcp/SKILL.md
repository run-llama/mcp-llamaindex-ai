---
name: llamaparse-mcp
description: Skill on how to use the LlamaParse MCP tools
compatibility: Needs authenticated access to https://mcp.llamaindex.ai/mcp
license: MIT
metadata:
  author: LlamaIndex
  version: 0.1.0
---

# LlamaParse MCP — Usage Guide

## Authentication

All tools require a valid session. If a tool call returns an authentication error, ask the user to re-authenticate before retrying. Do not retry automatically without prompting the user.

## Uploading a File

Every operation (parse, classify, split) requires a `fileId` obtained by uploading first. There are two upload paths — choose based on where the file lives:

- **File accessible via URL** — use `uploadFileByUrl`. Pass the direct download URL and a descriptive file name. This is the preferred path when the user shares a link.
- **Local or binary file** — call `getUploadUrl` first to obtain a pre-signed upload URL and token, then POST the file to the returned endpoint. The token is valid for 10 minutes; complete the upload before it expires.

For `getUploadUrl`, always set `purpose` to match the intended downstream operation (`'parse'`, `'classify'`, `'split'`, etc.) so the server can apply the right storage policy.

## Choosing What to Do with a File

Once you have a `fileId`, pick the tool that matches the user's goal:

| Goal | Tool |
|---|---|
| Extract text or markdown content | `parseFile` |
| Determine which category a document belongs to | `classifyFile` |
| Break a multi-section document into labeled segments | `splitFile` |

These are independent — you can run any combination on the same `fileId`.

## Parsing

Use `parseFile` to extract readable content. Choose the `tier` based on document complexity:

- `cost_effective` — fast and cheap; good for standard PDFs with clean text and simple layouts.
- `agentic` — slower; use when the document has tables, multi-column layouts, or embedded images that need accurate extraction.
- `agentic_plus` — most thorough; reserve for documents where extraction quality is critical and cost/latency are acceptable.

When in doubt, start with `cost_effective`. Escalate to `agentic` only if the output is missing content or has structural errors.

Set `markdown: true` (the default) when the extracted content will be rendered or passed to an LLM. Set it to `false` when you need plain text without formatting.

## Classifying

Use `classifyFile` when the user wants to route or label a document. Define `categories` as precisely as possible — vague category descriptions reduce confidence. Include a `description` that explains what distinguishes each category from the others, not just what it is.

## Splitting

Use `splitFile` when a single document contains multiple logical sections that should be handled separately (e.g., a combined PDF of multiple contracts, or a report with distinct chapters). Define `categories` by the sections you expect, not by generic document types.

Choose `allowUncategorized` based on how strict the split needs to be:

- `'include'` (default) — unknown pages are grouped under an uncategorized segment; safe for exploratory use.
- `'omit'` — uncategorized pages are silently dropped; use when you only care about specific sections.
- `'forbid'` — the operation fails if any page cannot be categorized; use when completeness is required.

## Chaining Operations

Common multi-step patterns:

- **Classify then parse** — classify to confirm the document type, then parse only if it matches the expected category.
- **Split then parse** — split a composite document into segments, then call `parseFile` on each segment's pages separately (re-upload the relevant pages if needed).
- **Upload once, process multiple ways** — a single `fileId` can be passed to `parseFile`, `classifyFile`, and `splitFile` independently; you do not need to re-upload.

## Rate Limits

The server enforces a per-user rate limit. If you receive a rate limit error, read the `Retry-After` value from the response and wait that many seconds before retrying. Do not retry immediately in a loop.

## Error Handling

- If `uploadFileByUrl` fails, check whether the URL is publicly accessible and the file type is supported.
- If `parseFile` returns incomplete content, retry with a higher `tier`.
- If `classifyFile` or `splitFile` time out, the job may still be running on the server — inform the user rather than re-submitting the same job immediately.

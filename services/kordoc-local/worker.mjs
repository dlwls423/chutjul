// A narrow MCP adapter around kordoc: complete structured output, no 50k-text cap.
import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { parse, blocksToChunks } from 'kordoc';

const server = new McpServer({ name: 'chutjul-kordoc', version: '1.0.0' });
// Native parser warnings belong on stderr, never the MCP protocol stream.
console.log = (...args) => console.error(...args);
server.tool('read_document', { path: z.string() }, async ({ path }) => {
  try {
    const root = await realpath(process.env.KORDOC_ROOT);
    const file = await realpath(resolve(path));
    const rel = relative(root, file);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('PATH');
    const bytes = await readFile(file);
    if (bytes.length > 30 * 1024 * 1024) throw new Error('SIZE');
    const result = await parse(bytes, { ocr: true, images: false, tableFormat: 'gfm', removeHeaderFooter: false });
    if (!result.success || !result.markdown.trim()) throw new Error('PARSE');
    const warnings = (result.warnings || []).map(w => ({ code: w.code, page: w.page }));
    // Do not label partial/OCR failure as a complete successful extraction.
    if (warnings.some(w => /NEEDS_OCR|OCR_FAILED|PARTIAL_PARSE|MISSING_DEPENDENCY/.test(w.code))) throw new Error('INCOMPLETE');
    const payload = {
      version: 1, parser: 'kordoc@4.21.25', format: result.fileType,
      markdown: result.markdown,
      pages: result.pages || [],
      pageMode: result.metadata?.pageMode || (result.fileType === 'pdf' ? 'layout' : 'unknown'),
      chunks: blocksToChunks(result.blocks, { granularity: 'block', tableFormat: 'gfm' }), warnings,
    };
    const text = JSON.stringify(payload);
    if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error('RESULT_SIZE');
    return { content: [{ type: 'text', text }] };
  } catch {
    return { isError: true, content: [{ type: 'text', text: 'DOCUMENT_READ_FAILED' }] };
  }
});
await server.connect(new StdioServerTransport());

import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, mkdtemp, rm, readdir, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = dirname(fileURLToPath(import.meta.url));
const work = join(here, '.work');
await mkdir(work, { recursive: true });
const origins = new Set((process.env.CHUTJUL_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000').split(','));
const token = randomBytes(32).toString('hex');
const extensions = new Set(['pdf','hwp','hwpx','hml','xls','xlsx','docx','pptx','png','jpg','jpeg','webp']);
let busy = false;
function reply(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (req.headers.host !== '127.0.0.1:43127' || !origins.has(origin)) return reply(res, 403, { error: 'LOCAL_ORIGIN_DENIED' });
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Chutjul-Token,X-Document-Extension');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.writeHead(204); return res.end();
  }
  if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { parser: 'kordoc@4.21.25', offline: true, token, extensions: [...extensions] });
  const supplied = String(req.headers['x-chutjul-token'] || '');
  if (supplied.length !== token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return reply(res, 403, { error: 'LOCAL_TOKEN_DENIED' });
  if (req.method !== 'POST' || req.url !== '/parse') return reply(res, 404, { error: 'NOT_FOUND' });
  const ext = String(req.headers['x-document-extension'] || '').toLowerCase();
  if (!extensions.has(ext)) return reply(res, 415, { error: 'UNSUPPORTED_FORMAT' });
  if (busy) return reply(res, 429, { error: 'LOCAL_BUSY' });
  busy = true;
  let dir, client, transport, output; let status=200;
  try {
    let size = 0; const parts = [];
    for await (const part of req) { size += part.length; if (size > 30 * 1024 * 1024) throw new Error('SIZE'); parts.push(part); }
    if (!size) throw new Error('EMPTY');
    dir = await mkdtemp(join(work, 'parse-'));
    const path = join(dir, `${randomUUID()}.${ext}`);
    await writeFile(path, Buffer.concat(parts), { mode: 0o600 });
    transport = new StdioClientTransport({ command: process.execPath, args: [join(here, 'worker.mjs')], stderr: 'pipe', env: {
      PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '', TEMP: dir, TMP: dir,
      KORDOC_OFFLINE: '1', KORDOC_ROOT: dir, KORDOC_MODEL_CACHE: join(here, '.models'),
    } });
    // Never print parser stderr: it can contain source text or local paths.
    if (transport.stderr) transport.stderr.on('data', () => {});
    client = new Client({ name: 'chutjul-local-client', version: '1.0.0' });
    await client.connect(transport);
    const result = await client.callTool({ name: 'read_document', arguments: { path } }, undefined, { timeout: 120000 });
    if (result.isError) throw new Error('PARSE');
    output = JSON.parse(result.content.find(item => item.type === 'text').text);
  } catch { status=422; output={ error: '문서를 끝까지 읽지 못했습니다. 암호·손상 여부와 오프라인 OCR 모델 설치를 확인해 주세요.' }; }
  finally {
    await client?.close().catch(() => {});
    await transport?.close().catch(() => {});
    if (dir && dirname(dir) === work) await rm(dir, { recursive: true, force: true });
    busy = false;
    if (!res.destroyed) reply(res,status,output);
  }
});
server.requestTimeout = 150000;
server.listen(43127, '127.0.0.1', async () => {
  // Once the exclusive port is held, remove temporary originals left by a crash.
  for (const name of await readdir(work)) {
    const path=join(work,name);
    const stat=await lstat(path);
    if (/^parse-[A-Za-z0-9]+$/.test(name) && stat.isDirectory() && !stat.isSymbolicLink() && dirname(path)===work) await rm(path,{recursive:true,force:true});
  }
  console.log('첫줄 kordoc 로컬 도우미: 127.0.0.1:43127 (offline)');
});

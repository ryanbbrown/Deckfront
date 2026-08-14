import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { ZodError } from 'zod';
import { GameService, ConflictError, ForbiddenActionError } from './gameService';
import { GameNotFoundError, FileGameRepository } from './persistence';
import { actionRequestSchema, createGameRequestSchema, undoRequestSchema } from './schemas';
import { loadStrategyPresets } from './strategies';
import { ThinHarnessAiRunner, type AiRunnerConfig } from './aiRunner';
import { AiTurnCoordinator } from './aiCoordinator';

export interface ServerOptions {
  dataDirectory: string;
  strategyDirectory: string;
  distDirectory: string;
  ai: AiRunnerConfig;
}

export interface HexdeckServer {
  server: Server;
  service: GameService;
  ai: AiTurnCoordinator;
}

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

export function createHexdeckServer(options: ServerOptions): HexdeckServer {
  const repository = new FileGameRepository(options.dataDirectory);
  const service = new GameService(repository, { model: options.ai.model, effort: options.ai.effort });
  const ai = new AiTurnCoordinator(service, new ThinHarnessAiRunner(options.ai));
  const server = createServer(async (request, response) => {
    try {
      if (await handleApi(request, response, service, ai, options)) return;
      await serveClient(request, response, options.distDirectory);
    } catch (error) {
      handleError(response, error);
    }
  });
  return { server, service, ai };
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  service: GameService,
  ai: AiTurnCoordinator,
  options: ServerOptions
): Promise<boolean> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return false;
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/strategies') {
    sendJson(response, 200, { strategies: await loadStrategyPresets(options.strategyDirectory) });
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/games') {
    const input = createGameRequestSchema.parse(await readJson(request));
    const presets = await loadStrategyPresets(options.strategyDirectory);
    if (!presets.some((preset) => preset.id === input.strategyPresetId)) {
      throw new BadRequestError('Unknown strategy preset.');
    }
    sendJson(response, 201, await service.create(input));
    return true;
  }
  const match = url.pathname.match(/^\/api\/games\/([0-9a-f-]{36})(?:\/(actions|undo|export|ai-turn))?$/i);
  if (!match?.[1]) throw new GameNotFoundError('Game not found.');
  const id = match[1];
  const operation = match[2];
  if (request.method === 'GET' && !operation) {
    sendJson(response, 200, await service.get(id));
    return true;
  }
  if (request.method === 'POST' && operation === 'actions') {
    const input = actionRequestSchema.parse(await readJson(request));
    sendJson(response, 200, await service.applyHumanAction(id, input.expectedRevision, input.actionId));
    return true;
  }
  if (request.method === 'POST' && operation === 'undo') {
    const input = undoRequestSchema.parse(await readJson(request));
    sendJson(response, 200, await service.undoHumanAction(id, input.expectedRevision));
    return true;
  }
  if (request.method === 'GET' && operation === 'export') {
    const redacted = url.searchParams.get('redacted') === '1';
    const exported = redacted ? await service.redactedExport(id) : await service.fullExport(id);
    response.setHeader('content-disposition', `attachment; filename="hexdeck-${id}${redacted ? '-redacted' : ''}.json"`);
    sendJson(response, 200, exported);
    return true;
  }
  if (request.method === 'POST' && operation === 'ai-turn') {
    sendJson(response, 202, await ai.start(id));
    return true;
  }
  if (request.method === 'GET' && operation === 'ai-turn') {
    sendJson(response, 200, await ai.status(id));
    return true;
  }
  throw new GameNotFoundError('API route not found.');
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 100_000) throw new BadRequestError('Request body is too large.');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new BadRequestError('Request body must be valid JSON.');
  }
}

async function serveClient(request: IncomingMessage, response: ServerResponse, distDirectory: string): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }
  const url = new URL(request.url ?? '/', 'http://localhost');
  const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  let candidate = path.resolve(distDirectory, requested);
  if (!candidate.startsWith(`${path.resolve(distDirectory)}${path.sep}`) && candidate !== path.resolve(distDirectory)) {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }
  try {
    if (!(await stat(candidate)).isFile()) throw new Error('Not a file.');
  } catch {
    candidate = path.join(distDirectory, 'index.html');
  }
  const body = await readFile(candidate);
  response.statusCode = 200;
  response.setHeader('content-type', MIME_TYPES[path.extname(candidate)] ?? 'application/octet-stream');
  response.setHeader('cache-control', path.extname(candidate) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable');
  response.end(request.method === 'HEAD' ? undefined : body);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  if (response.headersSent) return;
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
}

function handleError(response: ServerResponse, error: unknown): void {
  if (error instanceof ZodError || error instanceof BadRequestError) {
    sendJson(response, 400, { error: error instanceof ZodError ? 'Invalid request.' : error.message });
    return;
  }
  if (error instanceof GameNotFoundError) {
    sendJson(response, 404, { error: error.message });
    return;
  }
  if (error instanceof ConflictError) {
    sendJson(response, 409, { error: error.message });
    return;
  }
  if (error instanceof ForbiddenActionError) {
    sendJson(response, 403, { error: error.message });
    return;
  }
  console.error(error);
  sendJson(response, 500, { error: 'Internal server error.' });
}

class BadRequestError extends Error {}

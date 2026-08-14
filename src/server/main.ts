import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHexdeckServer } from './httpServer';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number.parseInt(process.env.PORT ?? '4173', 10);
const host = process.env.HOST ?? '127.0.0.1';
const model = process.env.HEXDECK_AI_MODEL ?? 'openai:gpt-5.6-luna';
const effort = process.env.HEXDECK_AI_EFFORT ?? 'low';

const { server } = createHexdeckServer({
  dataDirectory: process.env.HEXDECK_DATA_DIR ?? path.join(projectRoot, '.data/games'),
  strategyDirectory: path.join(projectRoot, 'strategies'),
  distDirectory: path.join(projectRoot, 'dist'),
  ai: {
    projectRoot,
    traceDirectory: process.env.HEXDECK_AI_TRACE_DIR ?? path.join(projectRoot, '.data/ai-traces'),
    model,
    effort,
    timeoutMilliseconds: Number.parseInt(process.env.HEXDECK_AI_TIMEOUT_MS ?? '240000', 10),
    fakeModel: process.env.HEXDECK_AI_FAKE === '1'
  }
});

server.listen(port, host, () => {
  console.log(`Hexdeck is running at http://${host}:${port}`);
});

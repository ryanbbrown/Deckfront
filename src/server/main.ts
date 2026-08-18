import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHexdeckServer } from './httpServer';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number.parseInt(process.env.PORT ?? '4173', 10);
const host = process.env.HOST ?? '127.0.0.1';
const { server } = createHexdeckServer({
  dataDirectory: process.env.HEXDECK_DATA_DIR ?? path.join(projectRoot, '.data/games'),
  distDirectory: path.join(projectRoot, 'dist')
});
server.listen(port, host, () => { console.log(`Hexdeck is running at http://${host}:${port}`); });

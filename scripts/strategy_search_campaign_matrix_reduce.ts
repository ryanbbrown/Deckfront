import fs from 'node:fs';
import path from 'node:path';
import {
  reduceStrategySearchMatrixScoreTasks, strategySearchMatrixScoreTasks,
  validateStrategySearchMatrixManifest, validateStrategySearchMatrixScoreTaskChunk
} from '../src/sim/strategySearchMatrix';

function option(name: string): string { const index = process.argv.indexOf(`--${name}`), value = process.argv[index + 1];
  if (index < 0 || !value || value.startsWith('--')) throw new Error(`--${name} is required.`); return value; }
function writeAtomic(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`; fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`);
  fs.renameSync(temporary, file); }
const manifest = JSON.parse(fs.readFileSync(path.resolve(option('manifest')), 'utf8')) as unknown;
if (!validateStrategySearchMatrixManifest(manifest)) throw new Error('Matrix reduction manifest is invalid.');
const tasks = strategySearchMatrixScoreTasks(manifest);
const files = JSON.parse(fs.readFileSync(path.resolve(option('chunks')), 'utf8')) as unknown;
if (!Array.isArray(files) || files.some((file) => typeof file !== 'string') || files.length !== tasks.length) {
  throw new Error('Matrix reduction chunk manifest is invalid.');
}
const chunks = files.map((file, index) => {
  const value = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as unknown;
  if (!validateStrategySearchMatrixScoreTaskChunk(value, manifest, tasks[index]!)) {
    throw new Error(`Matrix reduction chunk ${index} is stale or corrupt.`);
  }
  return value;
});
writeAtomic(path.resolve(option('out')), reduceStrategySearchMatrixScoreTasks({ manifest, tasks, chunks }));

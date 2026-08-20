import process from 'node:process';
import { challengerAudit } from './challenger_audit';

function parse(argv: readonly string[]): { kingdomId?: string; force: boolean; workers: number } {
  let kingdomId: string | undefined;
  let force = false;
  let workers = 8;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (flag === '--force') force = true;
    else if (flag === '--kingdom') {
      kingdomId = argv[++index];
      if (!kingdomId) throw new Error('--kingdom needs an id.');
    } else if (flag === '--workers') {
      const raw = argv[++index]; workers = Number(raw);
      if (!Number.isInteger(workers) || workers < 1 || workers > 16) throw new Error('--workers must be 1 to 16.');
    } else throw new Error(`Unknown option ${flag}.`);
  }
  return { ...(kingdomId ? { kingdomId } : {}), force, workers };
}

try {
  const options = parse(process.argv.slice(2));
  const result = await challengerAudit.run({ root: process.cwd(), ...options });
  process.stdout.write(`${result.completed.length} completed, ${result.skipped.length} skipped, ${result.failed.length} failed.\n`);
  if (result.failed.length) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

import process from 'node:process';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';

function optionInteger(name: string): number | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1 || value > deepBeamSuite.kingdoms.length) {
    throw new Error(`--${name} needs a whole number from 1 to ${deepBeamSuite.kingdoms.length}.`);
  }
  return value;
}

function duration(milliseconds: number | null): string {
  if (milliseconds === null) return 'unknown';
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

if (process.argv.includes('--status')) {
  const status = deepBeamSuite.status(process.cwd());
  process.stdout.write(`[${status.complete}/${status.total}] complete; recorded runtime ${duration(status.elapsedMs)}\n`);
  if (!status.valid) {
    process.stdout.write(`${status.failures.length} kingdoms are missing, stale, malformed, partial, or failed.\n`);
    process.exitCode = 1;
  }
} else {
  const controller = new AbortController();
  let signalExitCode: number | null = null;
  const stop = (signal: 'SIGINT' | 'SIGTERM'): void => {
    if (controller.signal.aborted) return;
    signalExitCode = signal === 'SIGINT' ? 130 : 143;
    process.stderr.write(`Stopping active kingdom after ${signal}.\n`);
    controller.abort();
  };
  const onInterrupt = (): void => stop('SIGINT');
  const onTerminate = (): void => stop('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  try {
    const limit = optionInteger('limit');
    const kingdomIds = limit === null
      ? undefined : deepBeamSuite.kingdoms.slice(0, limit).map((kingdom) => kingdom.id);
    const result = await deepBeamSuite.runBatch({
      root: process.cwd(),
      ...(kingdomIds ? { kingdomIds } : {}),
      signal: controller.signal,
      onProgress: ({ kingdomId, status, finished, total, elapsedMs, etaMs }) => {
        process.stdout.write(`[${finished}/${total}] ${kingdomId}: ${status}; elapsed ${duration(elapsedMs)}; ETA ${duration(etaMs)}\n`);
      }
    });
    for (const failure of result.failed) {
      process.stderr.write(`${failure.kingdomId}: ${failure.error}\n`);
    }
    if (signalExitCode !== null) process.exitCode = signalExitCode;
    else if (result.failed.length) process.exitCode = 1;
  } finally {
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
  }
}

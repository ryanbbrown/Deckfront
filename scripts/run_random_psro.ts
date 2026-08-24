import process from 'node:process';
import {
  RANDOM_PSRO_DEFAULT_CONFIG, RANDOM_PSRO_SUITE_SEEDS
} from '../src/sim/randomPsro';
import type { RandomPsroConfig } from '../src/sim/randomPsro';
import {
  RANDOM_PSRO_KINGDOMS, randomPsroStatus, runRandomPsroBatch
} from '../src/sim/randomPsroSuite';

function value(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const held = process.argv[index + 1];
  if (!held || held.startsWith('--')) throw new Error(`${flag} needs a value.`);
  return held;
}

function integer(flag: string, fallback: number): number {
  const held = Number(value(flag) ?? fallback);
  if (!Number.isInteger(held) || held < 1) throw new Error(`${flag} must be a positive integer.`);
  return held;
}

function duration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1_000);
  return seconds >= 3_600 ? `${Math.floor(seconds / 3_600)}h ${Math.floor(seconds % 3_600 / 60)}m`
    : seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

const smoke = process.argv.includes('--smoke');
const config: Partial<RandomPsroConfig> = smoke ? {
  initialStrategies: integer('--initial-strategies', 8),
  proposalCount: integer('--proposals', 8),
  finalists: integer('--finalists', 2),
  confirmationBlocks: integer('--confirmation-blocks', 4),
  matrixBlocks: integer('--matrix-blocks', 1),
  safetyCap: integer('--safety-cap', 8),
  independentAttackProposalCount: integer('--attack-proposals', 8)
} : {
  initialStrategies: integer('--initial-strategies', RANDOM_PSRO_DEFAULT_CONFIG.initialStrategies),
  proposalCount: integer('--proposals', RANDOM_PSRO_DEFAULT_CONFIG.proposalCount),
  finalists: integer('--finalists', RANDOM_PSRO_DEFAULT_CONFIG.finalists),
  confirmationBlocks: integer('--confirmation-blocks', RANDOM_PSRO_DEFAULT_CONFIG.confirmationBlocks),
  matrixBlocks: integer('--matrix-blocks', RANDOM_PSRO_DEFAULT_CONFIG.matrixBlocks),
  safetyCap: integer('--safety-cap', RANDOM_PSRO_DEFAULT_CONFIG.safetyCap),
  independentAttackProposalCount: integer('--attack-proposals', RANDOM_PSRO_DEFAULT_CONFIG.independentAttackProposalCount)
};
if (!smoke && (config.proposalCount! < 20_000 || config.independentAttackProposalCount! < 20_000)) {
  throw new Error('Full runs need at least 20,000 oracle and independent-attack proposals. Use --smoke for an explicit smaller budget.');
}

if (process.argv.includes('--status')) {
  const status = randomPsroStatus(process.cwd(), config);
  process.stdout.write(`${status.converged}/${status.total} converged; ${status.incomplete} incomplete; ${status.missing.length} missing or stale.\n`);
  if (status.converged !== status.total) process.exitCode = 1;
} else {
  const suite = process.argv.includes('--suite');
  const kingdomId = value('--kingdom') ?? RANDOM_PSRO_KINGDOMS[0]!.id;
  if (!RANDOM_PSRO_KINGDOMS.some((entry) => entry.id === kingdomId)) throw new Error(`Unknown kingdom ${kingdomId}.`);
  const seed = Number(value('--seed') ?? RANDOM_PSRO_SUITE_SEEDS[0]);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('--seed must be a nonnegative 32-bit integer.');
  const workers = integer('--workers', 10);
  const units = suite ? undefined : [{ kingdomId, seed }];
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const result = await runRandomPsroBatch({ root: process.cwd(), ...(units ? { units } : {}), workers, config,
      signal: controller.signal, onProgress: ({ unit, status, finished, total, elapsedMs }) => {
        process.stdout.write(`[${finished}/${total}] ${unit.kingdomId} seed ${unit.seed}: ${status}; ${duration(elapsedMs)}\n`);
      } });
    for (const failure of result.failed) process.stderr.write(`${failure.unit.kingdomId} seed ${failure.unit.seed}: ${failure.error}\n`);
    if (result.interrupted) process.exitCode = 130;
    else if (result.failed.length || result.incomplete.length) process.exitCode = 1;
  } finally {
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
  }
}

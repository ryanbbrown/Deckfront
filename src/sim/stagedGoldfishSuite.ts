import { RandomPsroSeedLedger } from './randomPsro';
import { STAGED_GOLDFISH_VERSION } from './stagedGoldfish';

export const STAGED_GOLDFISH_POOL_SEEDS = Object.freeze([1, 2, 3, 4, 5] as const);
export type StagedGoldfishPoolSeed = typeof STAGED_GOLDFISH_POOL_SEEDS[number];
export type StagedGoldfishUnitCommand = 'run' | 'status' | 'pool' | 'psro' | 'compare';
export type StagedGoldfishCommand = StagedGoldfishUnitCommand | 'suite' | 'suite-status';
export interface StagedGoldfishCliOptions { command: StagedGoldfishCommand; poolSeed?: StagedGoldfishPoolSeed }

const COMMAND_FLAGS: Readonly<Record<string, StagedGoldfishCommand>> = Object.freeze({
  '--run': 'run', '--status': 'status', '--pool': 'pool', '--psro': 'psro', '--compare': 'compare',
  '--suite': 'suite', '--suite-status': 'suite-status'
});

export function parseStagedGoldfishArgs(argv: readonly string[]): StagedGoldfishCliOptions {
  let command: StagedGoldfishCommand | undefined;
  let seedValue: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--seed') {
      if (seedValue !== undefined) throw new Error('--seed may be set only once.');
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--seed needs a value.');
      seedValue = value;
      index += 1;
      continue;
    }
    const parsed = COMMAND_FLAGS[argument];
    if (!parsed) throw new Error(`Unknown argument ${argument}.`);
    if (command) throw new Error('Choose one staged goldfish command.');
    command = parsed;
  }
  command ??= 'run';
  if (command === 'suite' || command === 'suite-status') {
    if (seedValue !== undefined) throw new Error(`${command} does not take --seed.`);
    return { command };
  }
  const poolSeed = Number(seedValue ?? 5);
  if (!STAGED_GOLDFISH_POOL_SEEDS.includes(poolSeed as StagedGoldfishPoolSeed)) {
    throw new Error('--seed must be a whole number from 1 through 5.');
  }
  return { command, poolSeed: poolSeed as StagedGoldfishPoolSeed };
}

export function stagedGoldfishArtifactDirectory(kingdomId: string, poolSeed: StagedGoldfishPoolSeed): string {
  return `.experiments/staged-goldfish-ab/${STAGED_GOLDFISH_VERSION}/${kingdomId}/seed-${poolSeed}`;
}

function evidenceOrdinal(poolSeed: StagedGoldfishPoolSeed): number {
  return poolSeed === 5 ? 0 : poolSeed;
}

export interface StagedGoldfishEvidenceSeedRoots {
  acquisition: number;
  lottery: number;
  lotteryBootstrap: readonly [number, number];
  attacks: Readonly<Record<'baseline-vs-staged' | 'staged-vs-baseline', number>>;
}

export function stagedGoldfishEvidenceSeedRoots(
  poolSeed: StagedGoldfishPoolSeed
): StagedGoldfishEvidenceSeedRoots {
  const ordinal = evidenceOrdinal(poolSeed);
  return { acquisition: 8_100_000 + ordinal * 10_000, lottery: 8_400_000 + ordinal * 1_000,
    lotteryBootstrap: [8_500_001 + ordinal * 10, 8_500_002 + ordinal * 10],
    attacks: { 'baseline-vs-staged': 9_200_000 + poolSeed,
      'staged-vs-baseline': 9_300_000 + poolSeed } };
}

export interface StagedGoldfishAttackProtocolSeeds {
  root: number;
  namespaces: Record<string, number[]>;
  race: number[];
  confirmation: number[];
  sampling: number[];
  bootstrap: number[];
}

export function stagedGoldfishAttackSeeds(
  poolSeed: StagedGoldfishPoolSeed, direction: 'baseline-vs-staged' | 'staged-vs-baseline',
  protocol: { raceBlocks: readonly number[]; confirmationBlocks: number; finalists: number }
): StagedGoldfishAttackProtocolSeeds {
  const root = stagedGoldfishEvidenceSeedRoots(poolSeed).attacks[direction];
  const ledger = new RandomPsroSeedLedger(root);
  const race = ledger.reserve(`${direction}:race`, protocol.raceBlocks.reduce((sum, count) => sum + count, 0));
  const confirmation = ledger.reserve(`${direction}:confirmation`, protocol.confirmationBlocks);
  const sampling = ledger.reserve(`${direction}:sampling`, protocol.raceBlocks.length + 1);
  const bootstrap = ledger.reserve(`${direction}:bootstrap`, protocol.finalists);
  ledger.validate();
  return { root, namespaces: ledger.namespaces, race, confirmation, sampling, bootstrap };
}

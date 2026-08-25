import path from 'node:path';
import rawManifest from './balance-suite-manifest.json' with { type: 'json' };
import { findKingdom, registerKingdom } from '../game';
import type { Kingdom } from '../game';
import {
  balanceSuiteDesign, generateBalanceSuiteManifest, measureBalanceSuiteDesign,
  validateBalanceSuiteManifest
} from './balanceSuiteDesign';
import type { BalanceSuiteManifest } from './balanceSuiteDesign';

export type {
  BalanceCandidateSummary, BalanceRouteLabel, BalanceSuiteDesign, BalanceSuiteKingdom,
  BalanceSuiteManifest, BalanceSuiteProvenance, BalanceSuiteSplit, NumericDistribution
} from './balanceSuiteDesign';

export interface BalanceSuiteBatchOptions {
  root: string;
  kingdomIds?: readonly string[];
  concurrency?: number;
  workersPerExperiment?: number;
  onProgress?: ((progress: { kingdomId: string; status: 'skipped' | 'completed' | 'failed';
    finished: number; total: number }) => void) | undefined;
}
export interface BalanceSuiteRunRequest { kingdomId: string; outDir: string; workers: number; root: string }
export type BalanceSuiteRunAdapter = (request: BalanceSuiteRunRequest) => Promise<void>;
export interface BalanceSuiteBatchResult {
  skipped: string[];
  completed: string[];
  failed: { kingdomId: string; error: string }[];
}
export interface BalanceSuiteValidation {
  valid: boolean;
  complete: number;
  matches: number;
  aborted: number;
  elapsedMs: number;
  failures: { kingdomId: string; reason: string }[];
}

export const BALANCE_CAMPAIGN_BLOCKED_MESSAGE =
  'The balance-suite campaign is blocked: pending-k009-consistency. Accept the Kingdom 009 production protocol and get separate spending approval first.';

export const BALANCE_SUITE_MANIFEST: BalanceSuiteManifest = validateBalanceSuiteManifest(
  rawManifest as unknown as BalanceSuiteManifest
);
const kingdomById = new Map(BALANCE_SUITE_MANIFEST.kingdoms.map((kingdom) => [kingdom.id, kingdom]));

function register(): void {
  for (const definition of BALANCE_SUITE_MANIFEST.kingdoms) {
    const { id, name, startingHealth, actionPiles } = definition;
    registerKingdom({ id, name, startingHealth, actionPiles });
  }
}
function hasKingdom(kingdomId: string): boolean { return kingdomById.has(kingdomId); }
function runDirectory(root: string, kingdomId: string): string {
  return path.join(root, '.experiments', 'balance-suite', BALANCE_SUITE_MANIFEST.suiteVersion, kingdomId, 'full');
}
export function assertBalanceCampaignReady(kingdomId?: string): never {
  if (kingdomId && !hasKingdom(kingdomId)) throw new Error(`Unknown balance-suite kingdom ${kingdomId}.`);
  throw new Error(BALANCE_CAMPAIGN_BLOCKED_MESSAGE);
}
async function runBatch(
  options: BalanceSuiteBatchOptions, _adapter?: BalanceSuiteRunAdapter
): Promise<BalanceSuiteBatchResult> {
  for (const id of options.kingdomIds ?? []) if (!hasKingdom(id)) throw new Error(`Unknown balance-suite kingdom ${id}.`);
  return assertBalanceCampaignReady();
}
function validateRuns(_root: string): BalanceSuiteValidation {
  return assertBalanceCampaignReady();
}

export { balanceSuiteDesign, generateBalanceSuiteManifest, measureBalanceSuiteDesign, validateBalanceSuiteManifest };
export const balanceSuite = Object.freeze({
  manifest: BALANCE_SUITE_MANIFEST,
  generate: generateBalanceSuiteManifest,
  measure: measureBalanceSuiteDesign,
  validateManifest: validateBalanceSuiteManifest,
  register,
  hasKingdom,
  runDirectory,
  runBatch,
  validateRuns,
  assertCampaignReady: assertBalanceCampaignReady,
  findKingdom: (kingdomId: string): Kingdom | null => hasKingdom(kingdomId) ? findKingdom(kingdomId) : null
});

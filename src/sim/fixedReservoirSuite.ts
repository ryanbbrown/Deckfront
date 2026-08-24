import type { BootstrapInterval } from './mixtureEvaluation';

export const FIXED_RESERVOIR_FIVE_RUN_VERSION = 'fixed-reservoir-five-run-v1';
export const FIXED_RESERVOIR_POOL_SEEDS = Object.freeze([1, 2, 3, 4, 5] as const);
export interface FixedReservoirKingdomSuiteConfig { kingdomId: string; evaluationSeed: number }
export const FIXED_RESERVOIR_KINGDOMS = Object.freeze([
  Object.freeze({ kingdomId: 'deep-beam-tuning-001', evaluationSeed: 7_100_001 }),
  Object.freeze({ kingdomId: 'deep-beam-tuning-009', evaluationSeed: 7_100_009 })
] as const satisfies readonly FixedReservoirKingdomSuiteConfig[]);

export type UnitState = 'complete' | 'invalid' | 'missing';
export interface SuiteUnitState { pool: UnitState; run: UnitState }
export type SuiteUnitAction = 'skip' | 'build-pool' | 'run-psro';
export function suiteUnitActions(state: SuiteUnitState): SuiteUnitAction[] {
  if (state.pool !== 'complete') return ['build-pool', 'run-psro'];
  if (state.run !== 'complete') return ['run-psro'];
  return ['skip'];
}

export const MATERIAL_ACQUISITIONS_PER_GAME = 0.1;
export const MATERIAL_EQUILIBRIUM_SHARE = 0.01;
export const DAMAGE_FAMILIES = Object.freeze(['Melee', 'Ranged', 'Mage'] as const);
export type DamageFamily = typeof DAMAGE_FAMILIES[number];
export interface SupportAcquisitionEvidence {
  strategyId: string;
  weight: number;
  archetype: string;
  acquisitionRates: Record<string, number>;
  damageAmounts: Record<DamageFamily, number>;
}
export interface RunAcquisitionEvidence { poolSeed: number; support: SupportAcquisitionEvidence[] }
export interface CardRunMeasure { poolSeed: number; expectedCopies: number; materialSupportShare: number; material: boolean }
export interface CardFiveRunSummary {
  cardId: string;
  runs: CardRunMeasure[];
  mean: number;
  minimum: number;
  maximum: number;
  materialRuns: number;
}
export interface RunFamilySummary {
  poolSeed: number;
  archetypes: Record<string, number>;
  continuous: Record<DamageFamily, number>;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
export function summarizeRunFamilies(run: RunAcquisitionEvidence): RunFamilySummary {
  const archetypes: Record<string, number> = {};
  const amounts = Object.fromEntries(DAMAGE_FAMILIES.map((family) => [family, 0])) as Record<DamageFamily, number>;
  for (const entry of run.support) {
    archetypes[entry.archetype] = (archetypes[entry.archetype] ?? 0) + entry.weight;
    for (const family of DAMAGE_FAMILIES) amounts[family] += entry.weight * entry.damageAmounts[family];
  }
  const total = Object.values(amounts).reduce((sum, value) => sum + value, 0);
  const continuous = Object.fromEntries(DAMAGE_FAMILIES.map((family) =>
    [family, total ? amounts[family] / total : 0])) as Record<DamageFamily, number>;
  return { poolSeed: run.poolSeed, archetypes, continuous };
}
export function summarizeFiveRunCards(
  runs: readonly RunAcquisitionEvidence[], cardIds: readonly string[]
): CardFiveRunSummary[] {
  if (runs.length !== 5) throw new Error('Card summaries require exactly five runs.');
  return [...cardIds].sort().map((cardId) => {
    const measures = runs.map((run): CardRunMeasure => {
      let expectedCopies = 0, materialSupportShare = 0;
      for (const entry of run.support) {
        const rate = entry.acquisitionRates[cardId] ?? 0;
        expectedCopies += entry.weight * rate;
        if (rate >= MATERIAL_ACQUISITIONS_PER_GAME) materialSupportShare += entry.weight;
      }
      return { poolSeed: run.poolSeed, expectedCopies, materialSupportShare,
        material: materialSupportShare >= MATERIAL_EQUILIBRIUM_SHARE };
    });
    const values = measures.map((entry) => entry.expectedCopies);
    return { cardId, runs: measures, mean: mean(values), minimum: Math.min(...values),
      maximum: Math.max(...values), materialRuns: measures.filter((entry) => entry.material).length };
  });
}
export function cumulativeMaterialCoverage(
  cardSummaries: readonly CardFiveRunSummary[]
): Array<{ afterRuns: number; cards: string[] }> {
  return Array.from({ length: 5 }, (_unused, index) => ({ afterRuns: index + 1,
    cards: cardSummaries.filter((card) => card.runs.slice(0, index + 1).some((run) => run.material))
      .map((card) => card.cardId).sort() }));
}
export function cumulativeFamilyCoverage(
  runs: readonly RunFamilySummary[]
): Array<{ afterRuns: number; families: DamageFamily[] }> {
  return runs.map((_run, index) => ({ afterRuns: index + 1, families: DAMAGE_FAMILIES.filter((family) =>
    runs.slice(0, index + 1).some((entry) => Object.entries(entry.archetypes)
      .filter(([label]) => label.split(' + ').includes(family))
      .reduce((sum, [, share]) => sum + share, 0) >= MATERIAL_EQUILIBRIUM_SHARE)) }));
}

export interface CrossPlayCell { rowSeed: number; columnSeed: number; score: number; interval95: BootstrapInterval }
export function crossPlayMatrix(cells: readonly CrossPlayCell[], seeds: readonly number[]): CrossPlayCell[][] {
  const byPair = new Map(cells.map((cell) => [`${cell.rowSeed}/${cell.columnSeed}`, cell]));
  return seeds.map((rowSeed) => seeds.map((columnSeed) => {
    const cell = byPair.get(`${rowSeed}/${columnSeed}`);
    if (!cell) throw new Error(`Missing cross-play cell ${rowSeed}/${columnSeed}.`);
    return cell;
  }));
}

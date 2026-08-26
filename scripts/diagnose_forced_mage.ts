import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { SeededRandom, cardDefinition, registerKingdom } from '../src/game';
import type { Kingdom } from '../src/game';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import { canonicalStrategy, formatStrategy } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';
import { beamBestResponses, pureLaneGrammar } from './beam_draft_off';
import type { BeamGrammar } from './beam_draft_off';
import { headToHead, seedRange } from './headToHead';
import type { WeightedOpponent } from './headToHead';

const MAGE_DAMAGE_MECHANICS = new Set(['spell', 'discharge', 'cascade', 'overload']);
const DEFAULT_KINGDOMS = ['deep-beam-tuning-002', 'deep-beam-tuning-007', 'deep-beam-tuning-008'];
const SEARCH_CONFIG = Object.freeze({ width: 32, confirmCount: 4, maxSlots: 8 });
const FINAL_SCORE_SEEDS = 200;

interface SavedEquilibrium {
  kingdom: Kingdom;
  config: { startingDraftEnabled: unknown; maxSlots: unknown };
  targetMixture: WeightedOpponent[];
  matrix: { strategies: Strategy[] };
}

export function forcedMageGrammar(kingdomId: string): BeamGrammar {
  const grammar = pureLaneGrammar(kingdomId, 'mage');
  if (!grammar) throw new Error(`${kingdomId} has no purchasable Mage damage card.`);
  return grammar;
}

function option(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value.`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(option(name) ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer.`);
  return value;
}

function confidenceInterval(values: readonly number[]): { lower: number; upper: number } {
  const random = new SeededRandom(0x6d616765);
  const means = Array.from({ length: 10_000 }, () => {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) total += values[random.nextInt(values.length)]!;
    return total / values.length;
  }).sort((left, right) => left - right);
  return { lower: means[Math.floor(means.length * 0.025)]!,
    upper: means[Math.floor(means.length * 0.975)]! };
}

function hasMageDamagePlan(strategy: Strategy): boolean {
  return strategy.buyPlan.some((slot) => slot.kind === 'buy'
    && MAGE_DAMAGE_MECHANICS.has(cardDefinition(slot.cardId).mechanic));
}

function resultFile(root: string, kingdomId: string): string {
  return path.join(root, '.experiments', 'deep-beam-suite', 'deep-beam-v1', 'results', `${kingdomId}.json`);
}

function loadEquilibrium(root: string, kingdomId: string): SavedEquilibrium {
  const saved = JSON.parse(fs.readFileSync(resultFile(root, kingdomId), 'utf8')) as SavedEquilibrium;
  if (saved.kingdom.id !== kingdomId || saved.kingdom.startingHealth !== 50) {
    throw new Error(`${kingdomId} is not a saved 50-health equilibrium.`);
  }
  if (saved.config.startingDraftEnabled !== false || saved.config.maxSlots !== 8) {
    throw new Error(`${kingdomId} does not use the required draft-off, eight-slot rules.`);
  }
  if (!Array.isArray(saved.targetMixture) || !saved.targetMixture.length) {
    throw new Error(`${kingdomId} has no saved unrestricted equilibrium mixture.`);
  }
  return saved;
}

async function main(): Promise<void> {
  const root = process.cwd();
  const workers = positiveInteger('workers', 10);
  const scoreSeeds = positiveInteger('score-seeds', FINAL_SCORE_SEEDS);
  const requested = option('kingdoms');
  const kingdomIds = requested ? requested.split(',').map((id) => id.trim()).filter(Boolean) : DEFAULT_KINGDOMS;
  const outputFile = option('out') ?? path.join(root, '.experiments', 'forced-mage-diagnostic.json');
  const results: unknown[] = [];

  for (const kingdomId of kingdomIds) {
    const saved = loadEquilibrium(root, kingdomId);
    registerKingdom(saved.kingdom);
    const grammar = forcedMageGrammar(kingdomId);
    if (SEARCH_CONFIG.width < grammar.floorIds!.length) {
      throw new Error(`Beam width cannot retain every forced Mage floor in ${kingdomId}.`);
    }
    const runner = new WorkerPairingRunner(
      workers, new URL('../src/server/aiWorker.ts', import.meta.url), { kingdom: saved.kingdom },
      ['--import', 'tsx']
    );
    const started = Date.now();
    try {
      console.log(`${kingdomId}: allowed ${grammar.purchaseIds!.join(', ')}; Mage floors ${grammar.floorIds!.join(', ')}`);
      const search = await beamBestResponses(runner, kingdomId, saved.targetMixture, {
        iteration: 0, maxSlots: SEARCH_CONFIG.maxSlots,
        lanes: [{ id: 'mage', width: SEARCH_CONFIG.width, finalists: SEARCH_CONFIG.confirmCount }],
        report: (message) => console.log(`  ${message}`)
      });
      const searchElapsedMs = Date.now() - started;
      const strongest = search.confirmed[0];
      if (!strongest) throw new Error(`Forced Mage search produced no finalist for ${kingdomId}.`);
      const finalScore = (await headToHead(
        runner, kingdomId, [strongest.strategy], saved.targetMixture,
        seedRange(60_000, scoreSeeds), 1, undefined, { startingDraftEnabled: false }
      ))[0]!;
      const ci95 = confidenceInterval(finalScore.blockScores);
      const normalForms = new Set(saved.matrix.strategies.map(canonicalStrategy));
      const normalSearchContainedStrategy = normalForms.has(canonicalStrategy(strongest.strategy));
      const normalMatrixMagePlanCount = saved.matrix.strategies.filter(hasMageDamagePlan).length;
      const normalMixtureMagePlanCount = saved.targetMixture
        .filter((entry) => hasMageDamagePlan(entry.strategy)).length;
      const result = {
        kingdomId,
        grammar,
        searchConfig: { ...SEARCH_CONFIG, startingDraftEnabled: false },
        searchElapsedMs,
        stages: search.stages,
        strategy: strongest.strategy,
        searchConfirmation: {
          mean: strongest.mean, matches: strongest.matches, seedEvaluations: strongest.blockScores.length
        },
        independentScore: {
          mean: finalScore.mean, ci95, matches: finalScore.matches,
          seedEvaluations: finalScore.blockScores.length, firstSeed: 60_000
        },
        normalSearchContainedStrategy,
        normalMatrixMagePlanCount,
        normalMixtureMagePlanCount,
        pointEstimateBeatsEquilibrium: finalScore.mean > 0.5,
        confidenceIntervalBeatsEquilibrium: ci95.lower > 0.5,
        normalSearchOmittedWinningForcedMageStrategy:
          !normalSearchContainedStrategy && ci95.lower > 0.5
      };
      results.push(result);
      console.log(`${formatStrategy(strongest.strategy)}\n  score ${(finalScore.mean * 100).toFixed(2)}%`
        + ` (95% CI ${(ci95.lower * 100).toFixed(2)}–${(ci95.upper * 100).toFixed(2)}%; ${finalScore.matches} matches)`
        + `; search ${(searchElapsedMs / 1_000).toFixed(1)}s`);
    } finally {
      await runner.close();
    }
  }

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify({
    schemaVersion: 1,
    experiment: 'forced-mage-deep-beam-diagnostic',
    createdAt: new Date().toISOString(),
    workers,
    scoreSeeds,
    results
  }, null, 2)}\n`);
  console.log(`written: ${outputFile}`);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) await main();

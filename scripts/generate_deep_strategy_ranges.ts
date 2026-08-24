import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { ALWAYS_AVAILABLE_ACTION_IDS } from '../src/game';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import { SUPPORT_TOLERANCE } from '../src/sim/equilibrium';
import type { EquilibriumResult } from '../src/sim/equilibrium';
import type { MatrixSnapshot } from '../src/sim/payoffMatrix';
import { classifyStrategyDamage } from './generate_balance_corpus';
import {
  buildStrategyReportModel
} from './generate_strategy_report';
import type {
  StrategyReportInput, StrategyReportKingdomInput, StrategyTypeMeasure
} from './generate_strategy_report';

interface DeepBeamResult {
  suiteVersion: string;
  kingdom: { id: string; actionPiles: { cardId: string }[] };
  matrix: MatrixSnapshot;
  equilibrium: EquilibriumResult;
}

export interface DeepStrategyRangeArtifact {
  suiteVersion: string;
  completedKingdoms: number;
  strategyTypes: StrategyTypeMeasure[];
  kingdoms: { id: string; strategyTypes: StrategyTypeMeasure[] }[];
}

function acquisitions(matrix: MatrixSnapshot, strategyId: string): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const cell of matrix.cells) {
    for (const [cardId, amount] of Object.entries(cell.telemetry.acquisitionsByStrategy[strategyId] ?? {})) {
      totals[cardId] = (totals[cardId] ?? 0) + amount;
    }
  }
  return totals;
}

function loadKingdom(root: string, kingdomId: string): StrategyReportKingdomInput {
  const evidence = deepBeamSuite.resultEvidence(root, kingdomId);
  if (!evidence.valid) throw new Error(`${kingdomId}: ${evidence.reason}.`);
  const result = JSON.parse(fs.readFileSync(deepBeamSuite.resultPath(root, kingdomId), 'utf8')) as DeepBeamResult;
  const ids = result.matrix.strategies.map((strategy) => strategy.id);
  if (result.equilibrium.strategyIds.length !== ids.length
    || result.equilibrium.strategyIds.some((id, index) => id !== ids[index])) {
    throw new Error(`${kingdomId}: equilibrium ids do not match the full discovered matrix.`);
  }
  const acquisitionById = new Map(ids.map((id) => [id, acquisitions(result.matrix, id)]));
  const archetypeByStrategyId = Object.fromEntries(result.matrix.strategies.map((strategy) => [
    strategy.id,
    classifyStrategyDamage({ startingBuild: strategy.startingBuild,
      acquisitionRates: acquisitionById.get(strategy.id)! })
  ]));
  return {
    id: kingdomId,
    availableCardIds: [...ALWAYS_AVAILABLE_ACTION_IDS,
      ...result.kingdom.actionPiles.map((pile) => pile.cardId)],
    strategies: result.matrix.strategies.flatMap((strategy) => {
      const weight = result.equilibrium.weights[strategy.id] ?? 0;
      return weight > SUPPORT_TOLERANCE ? [{ id: strategy.id, status: 'Lottery' as const,
        weight, score: 0.5, damageType: archetypeByStrategyId[strategy.id]!,
        startingBuild: strategy.startingBuild, acquisitionRates: acquisitionById.get(strategy.id)! }] : [];
    }),
    equilibrium: { strategyIds: ids, centeredPayoffs: result.matrix.centeredPayoffs,
      value: result.equilibrium.value, archetypeByStrategyId }
  };
}

export function buildDeepStrategyRangeArtifact(
  root: string, count = 10
): DeepStrategyRangeArtifact {
  deepBeamSuite.register();
  const kingdoms = deepBeamSuite.kingdoms.slice(0, count).map((kingdom) => loadKingdom(root, kingdom.id));
  const input: StrategyReportInput = { suiteVersion: deepBeamSuite.version, kingdoms, cards: [] };
  const strategyTypes = buildStrategyReportModel(input).strategyTypes;
  return {
    suiteVersion: deepBeamSuite.version,
    completedKingdoms: kingdoms.length,
    strategyTypes,
    kingdoms: kingdoms.map((kingdom) => ({ id: kingdom.id,
      strategyTypes: buildStrategyReportModel({ ...input, kingdoms: [kingdom] }).strategyTypes }))
  };
}

export function generateDeepStrategyRangeArtifact(
  root: string, output = path.join(root, '.data', 'deep-strategy-equilibrium-ranges-pilot-10.json'),
  count = 10
): DeepStrategyRangeArtifact {
  const artifact = buildDeepStrategyRangeArtifact(root, count);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
  return artifact;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  try {
    const output = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
    const artifact = generateDeepStrategyRangeArtifact(process.cwd(), output);
    process.stdout.write(`Wrote selected/min/max archetype shares for ${artifact.completedKingdoms} kingdoms.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

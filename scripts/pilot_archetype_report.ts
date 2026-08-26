import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerKingdom } from '../src/game';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import { solveEquilibrium } from '../src/sim/equilibrium';
import {
  stratifiedOpponentSchedule, summarizeLotteryAcquisitions
} from '../src/sim/lotteryAcquisition';
import type {
  FullCandidateEvidence, ProductBlockEvidence
} from '../src/sim/lotteryAcquisition';
import { GAMES_PER_SEED } from '../src/sim/pairing';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import type { PairingJob } from '../src/sim/pairingRunner';
import type { MatrixSnapshot } from '../src/sim/payoffMatrix';
import { stableHash } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';

const KINGDOMS = ['deep-beam-tuning-001', 'deep-beam-tuning-007', 'deep-beam-tuning-008'] as const;
const RUN_ROOTS = [
  '.experiments/successive-halving-double-oracle-pilot/v1',
  '.experiments/successive-halving-double-oracle-pilot/v1-run-2',
  '.experiments/successive-halving-double-oracle-pilot/v1-run-3'
] as const;
const PANELS = 3;
const SEEDS_PER_PANEL = 2_000;

type Checkpoint = { matrix: MatrixSnapshot; equilibrium: ReturnType<typeof solveEquilibrium> };
type AcquisitionSummary = ReturnType<typeof summarizeLotteryAcquisitions>;
interface ReportRow {
  run: number;
  kingdomId: string;
  matrixSize: number;
  supportSize: number;
  selectedArchetypeShares: AcquisitionSummary['selectedArchetypeShares'];
  feasibleArchetypeRanges: AcquisitionSummary['feasibleArchetypeRanges'];
  panelArchetypeSpans: Record<string, number>;
  strategyLabels: AcquisitionSummary['strategyLabels'];
}

function readJson<T>(file: string): T { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; }
function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function seeds(namespace: string, count: number): number[] {
  const root = Number.parseInt(stableHash(namespace).slice(0, 8), 16) >>> 0;
  return Array.from({ length: count }, (_unused, index) => (root + index) >>> 0);
}
function matrixAcquisitions(snapshot: MatrixSnapshot, strategyId: string): Record<string, number> {
  const result: Record<string, number> = {}; let games = 0;
  for (const cell of snapshot.cells) {
    if (cell.rowId !== strategyId && cell.columnId !== strategyId) continue;
    games += cell.matches;
    for (const [cardId, amount] of Object.entries(cell.telemetry.acquisitionsByStrategy[strategyId] ?? {})) {
      result[cardId] = (result[cardId] ?? 0) + amount;
    }
  }
  return Object.fromEntries(Object.entries(result).map(([cardId, amount]) => [cardId, games ? amount / games : 0]));
}
async function evaluateFull(
  candidates: readonly Strategy[], opponents: ReadonlyMap<string, Strategy>,
  blocks: readonly { seed: number; opponentId: string }[], runner: WorkerPairingRunner,
  kingdomId: string
): Promise<FullCandidateEvidence[]> {
  const jobs: PairingJob[] = candidates.flatMap((candidate) => blocks.map((block) => ({
    candidate, opponent: opponents.get(block.opponentId)!, options: { kingdomId, seeds: [block.seed],
      turnLimitPerPlayer: 30, actionCapPerTurn: 200, startingDraftEnabled: false, allowEarlyStop: false }
  })));
  const batch = await runner.run(jobs), result: FullCandidateEvidence[] = [];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const evidence: ProductBlockEvidence[] = [];
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const outcome = batch.outcomes[candidateIndex * blocks.length + blockIndex], block = blocks[blockIndex]!;
      if (!outcome || outcome.record.aborted || outcome.blocks[0]?.played !== GAMES_PER_SEED) {
        throw new Error('Invalid acquisition-panel result.');
      }
      evidence.push({ seed: block.seed, opponentId: block.opponentId, score: outcome.blocks[0]!.score,
        matches: GAMES_PER_SEED, telemetry: outcome.telemetry });
    }
    result.push({ strategy: candidates[candidateIndex]!, blocks: evidence });
  }
  return result;
}

async function main(): Promise<void> {
  const output = '.experiments/successive-halving-double-oracle-pilot/archetype-report.json';
  const rows: ReportRow[] = [];
  for (let runIndex = 0; runIndex < RUN_ROOTS.length; runIndex += 1) for (const kingdomId of KINGDOMS) {
    const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === kingdomId);
    if (!kingdom) throw new Error(`Missing kingdom ${kingdomId}.`);
    registerKingdom(kingdom);
    const checkpoint = readJson<Checkpoint>(path.join(RUN_ROOTS[runIndex]!, kingdomId, 'checkpoint.json'));
    const snapshot = checkpoint.matrix;
    const equilibrium = solveEquilibrium(snapshot.strategies.map((strategy) => strategy.id), snapshot.centeredPayoffs);
    const support = snapshot.strategies.filter((strategy) => (equilibrium.weights[strategy.id] ?? 0) > 1e-8
      || (equilibrium.maximumEquilibriumWeight[strategy.id] ?? 0) >= 0.005);
    const opponents = new Map(support.map((strategy) => [strategy.id, strategy]));
    const weights = Object.fromEntries(support.map((strategy) => [strategy.id, equilibrium.weights[strategy.id] ?? 0]));
    const runner = new WorkerPairingRunner(8, new URL('../src/server/aiWorker.ts', import.meta.url),
      { kingdom }, ['--import', 'tsx']);
    const panels: FullCandidateEvidence[][] = [];
    try {
      for (let panel = 1; panel <= PANELS; panel += 1) {
        const schedule = stratifiedOpponentSchedule(weights,
          seeds(`pilot-archetype:${runIndex + 1}:${kingdomId}:${panel}`, SEEDS_PER_PANEL), 25);
        panels.push(await evaluateFull(support, opponents, schedule.blocks, runner, kingdomId));
      }
    } finally { await runner.close(); }
    const pooled = new Map<string, FullCandidateEvidence>();
    for (const panel of panels) for (const evidence of panel) {
      const held = pooled.get(evidence.strategy.id);
      if (held) held.blocks.push(...evidence.blocks);
      else pooled.set(evidence.strategy.id, structuredClone(evidence));
    }
    const summarize = (panel: FullCandidateEvidence[]) => summarizeLotteryAcquisitions({
      strategies: snapshot.strategies, panels: panel, equilibrium, centeredPayoffs: snapshot.centeredPayoffs,
      fallbackAcquisitionRates: Object.fromEntries(snapshot.strategies.map((strategy) =>
        [strategy.id, matrixAcquisitions(snapshot, strategy.id)]))
    });
    const summaries = panels.map(summarize), summary = summarize([...pooled.values()]);
    const labels = [...new Set(summaries.flatMap((entry) => Object.keys(entry.selectedArchetypeShares)))];
    rows.push({ run: runIndex + 1, kingdomId, matrixSize: snapshot.strategies.length,
      supportSize: support.length, selectedArchetypeShares: summary.selectedArchetypeShares,
      feasibleArchetypeRanges: summary.feasibleArchetypeRanges,
      panelArchetypeSpans: Object.fromEntries(labels.map((label) => [label,
        Math.max(...summaries.map((entry) => entry.selectedArchetypeShares[label] ?? 0))
          - Math.min(...summaries.map((entry) => entry.selectedArchetypeShares[label] ?? 0))])),
      strategyLabels: summary.strategyLabels });
    console.log(`run ${runIndex + 1} ${kingdomId} support ${support.length}`);
  }
  const archetypes = [...new Set(rows.flatMap((row) => Object.keys(row.selectedArchetypeShares)))];
  const variation = KINGDOMS.map((kingdomId) => ({ kingdomId,
    archetypes: Object.fromEntries(archetypes.map((archetype) => {
      const shares = rows.filter((row) => row.kingdomId === kingdomId)
        .map((row) => row.selectedArchetypeShares[archetype] ?? 0);
      return [archetype, { minimum: Math.min(...shares), maximum: Math.max(...shares),
        span: Math.max(...shares) - Math.min(...shares) }];
    })) }));
  writeAtomic(output, { panelsPerRun: PANELS, seedsPerPanel: SEEDS_PER_PANEL, rows, variation });
  console.log(JSON.stringify({ output, variation }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

import type { GameState, LegalAction, PlayerId } from '../src/game';
import { strategyAgent } from '../src/sim/agents/strategyAgent';
import { tacticalAgent } from '../src/sim/tacticalAgent';
import { diagnosticLabels, diagnosticStrategies } from '../src/sim/baselines';
import { CURATED_KINGDOM_IDS } from '../src/sim/kingdoms';
import { runMatch } from '../src/sim/match';
import { GAMES_PER_SEED, playPairing } from '../src/sim/pairing';
import type { PairingMatchRunner } from '../src/sim/pairing';
import type { SimulationMatchConfig } from '../src/sim/simulationKernel';
import type { Strategy } from '../src/sim/strategy';
import type { Agent, MatchResult } from '../src/sim/types';

const TURN_LIMIT = 30;
const ACTION_CAP = 200;

function option(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value.`);
  return value;
}

function definitionForInstance(state: GameState, playerId: PlayerId, instanceId: string | null): string | null {
  if (instanceId === null) return null;
  const deck = state.players[playerId].deck;
  return [...deck.hand, ...deck.discard, ...deck.play].find((card) => card.id === instanceId)?.definitionId ?? null;
}

function semanticAction(state: GameState, playerId: PlayerId, action: LegalAction): string {
  const command = action.command;
  if ('cardInstanceId' in command) {
    const cardId = definitionForInstance(state, playerId, command.cardInstanceId);
    const movement = 'movement' in command ? command.movement : 'direction' in command ? command.direction : null;
    const trash = command.type === 'playTargetedAction'
      ? command.targetCardInstanceIds.map((id) => definitionForInstance(state, playerId, id)).sort()
      : [];
    return JSON.stringify(['play', cardId, movement, trash]);
  }
  if (command.type === 'resolveDiscard') return JSON.stringify(['discard', definitionForInstance(state, playerId, command.discardInstanceId)]);
  if (command.type === 'resolveRecover') return JSON.stringify(['recover', definitionForInstance(state, playerId, command.recoverInstanceId)]);
  if (command.type === 'buyCard') return JSON.stringify(['buy', command.definitionId]);
  return command.type;
}

interface ComparisonCounts { decisions: number; agreements: number; disagreements: Map<string, number> }

function observedFullAgent(strategy: Strategy, counts: ComparisonCounts): Agent {
  const full = strategyAgent(strategy);
  const tactical = tacticalAgent(strategy);
  return {
    id: full.id,
    chooseStartingBuild: full.chooseStartingBuild,
    chooseAction(state, playerId, actions) {
      const chosen = full.chooseAction(state, playerId, actions);
      if (state.phase === 'action') {
        const alternative = tactical.chooseAction(state, playerId, actions);
        counts.decisions += 1;
        const expected = semanticAction(state, playerId, chosen);
        const actual = semanticAction(state, playerId, alternative);
        if (expected === actual) counts.agreements += 1;
        else {
          const pair = `${expected} -> ${actual}`;
          counts.disagreements.set(pair, (counts.disagreements.get(pair) ?? 0) + 1);
        }
      }
      return chosen;
    }
  };
}

function resultKey(result: MatchResult): string { return `${result.outcome}/${result.reason}`; }

const requested = option('kingdom');
const kingdoms = requested ? [requested] : [...CURATED_KINGDOM_IDS];
const seeds = (option('seeds') ?? '3,17').split(',').map(Number);
const matrixSeedCount = Number(option('matrix-seeds') ?? '8');
if (!Number.isInteger(matrixSeedCount) || matrixSeedCount < 1 || matrixSeedCount > 25) {
  throw new Error('--matrix-seeds needs a whole number from 1 to 25.');
}
let totalDecisions = 0;
let totalAgreements = 0;
let totalMatches = 0;
let sameResult = 0;
let sameOutcome = 0;
let absoluteTurnDifference = 0;
let matrixCells = 0;
let sameCellDirection = 0;
let absoluteCellDifference = 0;
let maximumCellDifference = 0;
const matrixDifferences: { kingdomId: string; left: string; right: string; full: number; tactical: number }[] = [];

const fullMatch: PairingMatchRunner = (config: SimulationMatchConfig) => runMatch({
  kingdomId: config.kingdomId, seed: config.seed, firstPlayerId: config.firstPlayerId,
  swapSides: config.swapSides, turnLimitPerPlayer: config.turnLimitPerPlayer,
  actionCapPerTurn: config.actionCapPerTurn,
  agents: {
    ochre: strategyAgent(config.strategies.ochre), indigo: strategyAgent(config.strategies.indigo)
  }
});

for (const kingdomId of kingdoms) {
  const strategies = diagnosticStrategies(kingdomId);
  const labels = diagnosticLabels(kingdomId);
  const counts: ComparisonCounts = { decisions: 0, agreements: 0, disagreements: new Map() };
  let kingdomMatches = 0;
  let kingdomSameOutcome = 0;
  let kingdomSameResult = 0;
  let kingdomTurnDifference = 0;
  for (const seed of seeds) for (const ochre of strategies) for (const indigo of strategies) {
    const shared = {
      kingdomId, seed, firstPlayerId: 'ochre' as const, swapSides: false,
      turnLimitPerPlayer: TURN_LIMIT, actionCapPerTurn: ACTION_CAP
    };
    const full = runMatch({
      ...shared,
      agents: { ochre: observedFullAgent(ochre, counts), indigo: observedFullAgent(indigo, counts) }
    });
    const tactical = runMatch({
      ...shared,
      agents: { ochre: tacticalAgent(ochre), indigo: tacticalAgent(indigo) }
    });
    kingdomMatches += 1;
    if (full.outcome === tactical.outcome) kingdomSameOutcome += 1;
    if (resultKey(full) === resultKey(tactical)) kingdomSameResult += 1;
    kingdomTurnDifference += Math.abs(full.turns - tactical.turns);
  }
  totalDecisions += counts.decisions; totalAgreements += counts.agreements;
  totalMatches += kingdomMatches; sameOutcome += kingdomSameOutcome; sameResult += kingdomSameResult;
  absoluteTurnDifference += kingdomTurnDifference;
  console.log(`${kingdomId}: action agreement ${(100 * counts.agreements / counts.decisions).toFixed(1)}%`
    + ` (${counts.agreements}/${counts.decisions}); same outcome ${(100 * kingdomSameOutcome / kingdomMatches).toFixed(1)}%;`
    + ` same outcome/reason ${(100 * kingdomSameResult / kingdomMatches).toFixed(1)}%;`
    + ` mean |turn difference| ${(kingdomTurnDifference / kingdomMatches).toFixed(2)}`);
  console.log(`  top differences: ${[...counts.disagreements].sort((left, right) => right[1] - left[1]).slice(0, 5)
    .map(([pair, count]) => `${count} ${pair}`).join('; ')}`);

  const matrixSeeds = Array.from({ length: matrixSeedCount }, (_unused, index) => index + 1);
  for (let left = 0; left < strategies.length; left += 1) for (let right = left + 1; right < strategies.length; right += 1) {
    const pairingOptions = {
      kingdomId, seeds: matrixSeeds, turnLimitPerPlayer: TURN_LIMIT, actionCapPerTurn: ACTION_CAP,
      allowEarlyStop: false
    };
    const full = playPairing(strategies[left]!, strategies[right]!, pairingOptions, fullMatch);
    const tactical = playPairing(strategies[left]!, strategies[right]!, pairingOptions);
    if (full.candidateMean === null || tactical.candidateMean === null) continue;
    const difference = Math.abs(full.candidateMean - tactical.candidateMean);
    matrixCells += 1; absoluteCellDifference += difference;
    maximumCellDifference = Math.max(maximumCellDifference, difference);
    if (Math.sign(full.candidateMean - 0.5) === Math.sign(tactical.candidateMean - 0.5)) sameCellDirection += 1;
    matrixDifferences.push({ kingdomId, left: labels.get(strategies[left]!.id) ?? strategies[left]!.id,
      right: labels.get(strategies[right]!.id) ?? strategies[right]!.id,
      full: full.candidateMean, tactical: tactical.candidateMean });
  }
}

console.log(`all: action agreement ${(100 * totalAgreements / totalDecisions).toFixed(1)}% (${totalAgreements}/${totalDecisions});`
  + ` same outcome ${(100 * sameOutcome / totalMatches).toFixed(1)}%;`
  + ` same outcome/reason ${(100 * sameResult / totalMatches).toFixed(1)}%;`
  + ` mean |turn difference| ${(absoluteTurnDifference / totalMatches).toFixed(2)} across ${totalMatches} matches`);
console.log(`diagnostic matrix (${matrixSeedCount} shuffle seeds x ${GAMES_PER_SEED} games): same cell direction `
  + `${(100 * sameCellDirection / matrixCells).toFixed(1)}%; mean |win-rate difference| `
  + `${(100 * absoluteCellDifference / matrixCells).toFixed(1)} points; maximum `
  + `${(100 * maximumCellDifference).toFixed(1)} points across ${matrixCells} cells`);
console.log(`largest cell differences: ${matrixDifferences.sort((left, right) =>
  Math.abs(right.full - right.tactical) - Math.abs(left.full - left.tactical)).slice(0, 8)
  .map((entry) => `${entry.kingdomId} ${entry.left}/${entry.right} `
    + `${(100 * entry.full).toFixed(0)}% -> ${(100 * entry.tactical).toFixed(0)}%`).join('; ')}`);

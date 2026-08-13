import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { mapDistance, hexDistance, lineOfSight } from '../src/board/coordinates';
import { boardMapSchema, coordKey, type BoardState } from '../src/board/schema';
import { loadGameConfig } from '../src/config/loadGameConfig';
import { SeededRng } from '../src/core/random';
import { setupGame } from '../src/core/state';
import { savePersistedGame } from '../src/cli/persistence';
import { executeBoardAction, loadBoardRulesContext, nextDeckPlayerAfterSetup, type BoardActionInput, type BoardRulesContext } from '../src/playtest/boardAction';
import { commitAction } from '../src/playtest/commitAction';
import { executeDeckTurn, type DeckSnapshot, type DeckTurnInput } from '../src/playtest/deckTurn';
import { expectedTerminalEvents, initPlaytestRun, validateReplayBundle } from '../src/playtest/run';
import type { ReplayActivationInput } from '../src/replay/schema';

const repoRoot = resolve(import.meta.dirname, '..');
const runRoot = join(repoRoot, '.games', 'skirmish-mock');
const turnCap = 20;

await assertMissing(runRoot);
await mkdir(join(runRoot, 'actions'), { recursive: true });
await mkdir(join(runRoot, 'results'), { recursive: true });

const context = await loadBoardRulesContext();
const starterBoard = buildStarterBoard(context);
const starterBoardPath = join(runRoot, 'starter-board.json');
await writeJson(starterBoardPath, starterBoard);
const paths = await initPlaytestRun({
  root: runRoot,
  ruleset: 'skirmish-v1',
  map: 'skirmish-v1',
  boardPath: starterBoardPath,
  title: 'Skirmish mock: ten turns per player',
  turnCap
});

const config = await loadGameConfig(join(repoRoot, 'game', 'deck.yaml'));
const rng = new SeededRng(2106);
let deck: DeckSnapshot = { schemaVersion: 1, rngState: rng.snapshot(), game: setupGame(config, rng) };
let board = starterBoard;
await savePersistedGame(paths.deckState, deck);

let step = 1;
while (board.turn.round <= turnCap) {
  const stepId = `step-${String(step).padStart(3, '0')}`;
  const player = board.turn.activePlayer;
  const snapshotPrefix = join('snapshots', stepId);
  let deckResultPath: string | undefined;
  let deckTurn: ReturnType<typeof executeDeckTurn> | undefined;
  let boardInput: BoardActionInput;
  if (board.turn.phase === 'setup') {
    const deckInput: DeckTurnInput = { schemaVersion: 1, turnId: stepId, player, actions: [{ type: 'moveToBuy' }, { type: 'buyCard', cardId: 'silver' }, { type: 'endTurn' }] };
    await writeJson(join(runRoot, 'actions', `${stepId}.deck.json`), deckInput);
    deckTurn = executeDeckTurn(deck, deckInput, { beforePath: `${snapshotPrefix}.before.deck.json`, afterPath: `${snapshotPrefix}.after.deck.json`, nextPlayer: nextDeckPlayerAfterSetup(board) });
    deckResultPath = join(runRoot, 'results', `${stepId}.deck.result.json`);
    await Promise.all([writeJson(join(runRoot, deckTurn.result.before), deckTurn.before), writeJson(join(runRoot, deckTurn.result.after), deckTurn.after), writeJson(deckResultPath, deckTurn.result), savePersistedGame(paths.deckState, deckTurn.after)]);
    boardInput = { schemaVersion: 1, stepId, player, action: { type: 'setup', upgrades: [] } };
  } else {
    const activation = chooseActivation(board, nextUnitId(board, player), player, context);
    if (!activation) throw new Error(`${stepId}: no activation for ${player}`);
    boardInput = { schemaVersion: 1, stepId, player, action: { type: 'activation', activation } };
  }
  const boardActionPath = join(runRoot, 'actions', `${stepId}.board.json`);
  await writeJson(boardActionPath, boardInput);
  const boardAction = executeBoardAction(board, boardInput, context, {
    beforePath: `${snapshotPrefix}.before.board.json`,
    afterPath: `${snapshotPrefix}.after.board.json`
  }, deckTurn?.result);
  const boardResultPath = join(runRoot, 'results', `${stepId}.board.result.json`);
  await Promise.all([
    writeJson(join(runRoot, boardAction.result.before), boardAction.before),
    writeJson(join(runRoot, boardAction.result.after), boardAction.after),
    writeJson(boardResultPath, boardAction.result),
    writeJson(paths.boardState, boardAction.after)
  ]);

  const winEvents = expectedTerminalEvents(boardAction.after, boardAction.after.turn.round - 1, turnCap);
  const winEventsPath = winEvents.length > 0 ? join(runRoot, 'results', `${stepId}.win-events.json`) : undefined;
  if (winEventsPath) await writeJson(winEventsPath, winEvents);
  await commitAction({
    run: runRoot,
    ...(deckResultPath ? { deckResultPath } : {}),
    boardResultPath,
    summary: boardInput.action.type === 'setup' ? `${player} completed setup.` : `${player} activated ${boardInput.action.activation.unit}.`,
    reasoning: boardInput.action.type === 'setup' ? 'Bought one Silver and applied upgrades.' : 'Advanced toward contact and attacked when legal.',
    ...(winEventsPath ? { winEventsPath, terminalWinEventsPath: winEventsPath } : {}),
    strictWin: true
  });

  if (deckTurn) deck = deckTurn.after;
  board = boardAction.after;
  step += 1;
  if (winEvents.length > 0) break;
}

const validated = await validateReplayBundle(paths.timeline, { strict: true, strictDeck: true, strictWin: true });
const turnsByPlayer = Object.fromEntries(board.players.map((player) => [player, validated.timeline.entries.filter((entry) => entry.player === player).length]));
const actions = validated.timeline.entries.flatMap((entry) => entry.phase === 'activation' ? [entry.action.activation] : []);
console.log(JSON.stringify({
  timeline: paths.timeline,
  entries: validated.entries.length,
  turnsByPlayer,
  activations: actions.length,
  moves: actions.filter((activation) => coordKey(activation.from) !== coordKey(activation.to)).length,
  attacks: actions.filter((activation) => activation.attack).length,
  removals: actions.filter((activation) => activation.attack?.targetRemoved).length,
  keyPointUpgrades: validated.timeline.entries.flatMap((entry) => entry.phase === 'setup' ? entry.action.keyPointUpgrades : []).length,
  terminalWinEvents: validated.timeline.terminalWinEvents
}, null, 2));

function buildStarterBoard(context: BoardRulesContext): BoardState {
  const placements = [
    ['P1-vanguard', 'P1', 'soldier', 4, 0],
    ['P1-soldier-2', 'P1', 'soldier', 2, 0],
    ['P1-soldier-3', 'P1', 'soldier', 6, 0],
    ['P1-archer-1', 'P1', 'archer', 3, 0],
    ['P1-archer-2', 'P1', 'archer', 5, 0],
    ['P2-vanguard', 'P2', 'soldier', 4, 16],
    ['P2-soldier-2', 'P2', 'soldier', 6, 16],
    ['P2-soldier-3', 'P2', 'soldier', 2, 16],
    ['P2-archer-1', 'P2', 'archer', 5, 16],
    ['P2-archer-2', 'P2', 'archer', 3, 16]
  ] as const;
  return {
    schemaVersion: 1,
    ruleset: 'skirmish-v1',
    map: context.map.id,
    players: ['P1', 'P2'],
    turn: { round: 1, phase: 'setup', initiativePlayer: 'P1', activePlayer: 'P1', completedSetupPlayers: [], activatedUnitIds: [], activationCounts: { P1: 0, P2: 0 } },
    units: placements.map(([id, player, type, col, row]) => {
      const rules = context.units[type];
      if (!rules) throw new Error(`Missing unit rules for ${type}`);
      return { id, player, type, col, row, hp: rules.hp, attack: rules.attack, movement: rules.movement, range: rules.range };
    }),
    notes: ['Deterministic twenty-turn mock replay.']
  };
}

function chooseActivation(state: BoardState, unitId: string, player: string, context: BoardRulesContext): ReplayActivationInput | undefined {
  const unit = state.units.find((candidate) => candidate.id === unitId && candidate.player === player);
  if (!unit) return undefined;
  const enemies = state.units.filter((candidate) => candidate.player !== player);
  const target = [...enemies].sort((left, right) => hexDistance(unit, left, context.map.coordinateSystem) - hexDistance(unit, right, context.map.coordinateSystem))[0];
  if (!target) return { unit: unit.id, from: { col: unit.col, row: unit.row }, to: { col: unit.col, row: unit.row } };
  const attacksAllowed = enemies.length > 3;

  const occupied = new Map(state.units.filter((candidate) => candidate.id !== unit.id).map((candidate) => [coordKey(candidate), { col: candidate.col, row: candidate.row }]));
  const wallsAndUnits = new Map(context.map.blocked.map((coord) => [coordKey(coord), coord]));
  for (const [key, coord] of occupied) wallsAndUnits.set(key, coord);
  const movementMap = boardMapSchema.parse({ ...context.map, blocked: [...wallsAndUnits.values()] });
  const candidates = context.map.hexes.flatMap((coord) => {
    if (occupied.has(coordKey(coord)) || context.map.blocked.some((wall) => coordKey(wall) === coordKey(coord))) return [];
    const movement = mapDistance(movementMap, unit, coord);
    if (movement === null || movement > unit.movement) return [];
    const range = hexDistance(coord, target, context.map.coordinateSystem);
    const canAttack = attacksAllowed && range <= unit.range && (unit.range === 1 || lineOfSight(context.map, coord, target));
    return [{ coord, movement, range, canAttack }];
  });
  candidates.sort((left, right) => {
    if (!attacksAllowed) {
      return right.range - left.range
        || distanceFromHome(left.coord, player, context) - distanceFromHome(right.coord, player, context)
        || right.movement - left.movement
        || left.coord.row - right.coord.row
        || left.coord.col - right.coord.col;
    }
    return Number(right.canAttack) - Number(left.canAttack)
      || (left.canAttack ? Math.abs(left.range - unit.range) - Math.abs(right.range - unit.range) : left.range - right.range)
      || Number(!isKeyPoint(left.coord, context)) - Number(!isKeyPoint(right.coord, context))
      || left.movement - right.movement
      || left.coord.row - right.coord.row
      || left.coord.col - right.coord.col;
  });
  const destination = candidates[0];
  if (!destination) return undefined;
  const moved = coordKey(destination.coord) !== coordKey(unit);
  return {
    unit: unit.id,
    from: { col: unit.col, row: unit.row },
    ...(moved ? { via: destination.coord } : {}),
    ...(destination.canAttack ? { attack: { target: target.id } } : {}),
    to: destination.coord
  };
}

function isKeyPoint(coord: { col: number; row: number }, context: BoardRulesContext): boolean {
  return context.map.keyPoints.some((point) => coordKey(point) === coordKey(coord));
}

function distanceFromHome(coord: { col: number; row: number }, player: string, context: BoardRulesContext): number {
  const deployment = context.map.deployment.find((zone) => zone.player === player);
  return Math.min(...(deployment?.hexes.map((hex) => hexDistance(coord, hex, context.map.coordinateSystem)) ?? [0]));
}

function nextUnitId(state: BoardState, player: string): string {
  const unit = state.units.find((candidate) => candidate.player === player && !state.turn.activatedUnitIds.includes(candidate.id));
  if (!unit) throw new Error(`No unactivated unit for ${player}`);
  return unit.id;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function assertMissing(path: string): Promise<void> {
  try {
    await access(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Refusing to overwrite existing mock game: ${path}`);
}

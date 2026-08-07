import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { hexDistance, lineOfSight, mapDistance } from '../board/coordinates';
import { boardStateSchema, coordKey, unitRulesSchema, validateSkirmishMap, type BoardMap, type BoardState, type UnitRules } from '../board/schema';
import { loadGameConfig } from '../config/loadGameConfig';
import type { GameConfig, GameState, PlayerState } from '../core/types';
import { replayTimelineSchema, type ReplayBoardActions, type ReplayEntry, type ReplayTimeline, type ReplayWinEvent } from '../replay/schema';
import { deckTurnInputSchema, executeDeckTurn, isCompleteDeckSnapshot, type DeckSnapshot } from './deckTurn';

export interface PlaytestRunPaths { root: string; deckState: string; boardState: string; timeline: string; snapshotsDir: string }
export interface TurnSnapshotPaths { deckBefore: string; deckAfter: string; boardBefore: string; boardAfter: string }
export interface ValidatedReplayEntry { entry: ReplayEntry; deckBefore: DeckSnapshot; deckAfter: DeckSnapshot; boardBefore: BoardState; boardAfter: BoardState }
export interface ValidatedReplayBundle { timeline: ReplayTimeline; entries: ValidatedReplayEntry[] }
export interface ValidateReplayBundleOptions { strict?: boolean; strictDeck?: boolean; strictWin?: boolean }
export interface InitPlaytestRunOptions {
  root: string;
  ruleset: string;
  map: string;
  players?: string[];
  boardPath?: string;
  unitsPath?: string;
  title?: string;
  turnCap?: number;
}

interface RulesContext { map: BoardMap; units: UnitRules; unitsPerPlayer: number; deckConfig: GameConfig }
type BoardUnit = BoardState['units'][number];

const initialUnitSetupSchema = z.object({
  id: z.string().min(1),
  player: z.string().min(1),
  type: z.string().min(1),
  col: z.number().int(),
  row: z.number().int()
}).strict();
const initialUnitSetupsSchema = z.array(initialUnitSetupSchema);

export function playtestRunPaths(root: string): PlaytestRunPaths {
  return { root, deckState: join(root, 'deck.json'), boardState: join(root, 'board.json'), timeline: join(root, 'timeline.json'), snapshotsDir: join(root, 'snapshots') };
}

export function turnSnapshotPaths(root: string, turnId: string): TurnSnapshotPaths {
  const snapshots = playtestRunPaths(root).snapshotsDir;
  return {
    deckBefore: join(snapshots, `${turnId}.before.deck.json`),
    deckAfter: join(snapshots, `${turnId}.after.deck.json`),
    boardBefore: join(snapshots, `${turnId}.before.board.json`),
    boardAfter: join(snapshots, `${turnId}.after.board.json`)
  };
}

export async function initPlaytestRun(options: InitPlaytestRunOptions): Promise<PlaytestRunPaths> {
  if (!options.boardPath && !options.unitsPath) {
    throw new Error('Missing army setup: provide exactly one of boardPath or unitsPath');
  }
  if (options.boardPath && options.unitsPath) {
    throw new Error('Conflicting army setup: provide only one of boardPath or unitsPath');
  }
  const paths = playtestRunPaths(options.root);
  const context = await loadRulesContext();
  if (options.ruleset !== 'skirmish-v1' || options.map !== context.map.id) {
    throw new Error(`Skirmish assets are skirmish-v1/${context.map.id}, received ${options.ruleset}/${options.map}`);
  }
  const players = options.players ?? context.map.deployment.map((zone) => zone.player);
  if (players.length !== 2) throw new Error('Skirmish requires exactly two players');
  const deploymentPlayers = context.map.deployment.map((zone) => zone.player);
  if (stableJson(players) !== stableJson(deploymentPlayers)) {
    throw new Error(`Skirmish players must match deployment order: ${deploymentPlayers.join(', ')}`);
  }
  const playerTuple = [players[0], players[1]] as [string, string];
  const units = options.unitsPath ? await loadInitialUnits(options.unitsPath, context) : [];
  const board = options.boardPath ? boardStateSchema.parse(await readJson(options.boardPath)) : boardStateSchema.parse({
    schemaVersion: 1,
    ruleset: options.ruleset,
    map: context.map.id,
    players: playerTuple,
    turn: { activePlayer: playerTuple[0], round: 1 },
    units,
    notes: []
  });
  if (board.ruleset !== options.ruleset || board.map !== options.map) throw new Error('Starter board does not match requested ruleset and map');
  if (stableJson(board.players) !== stableJson(playerTuple)) throw new Error('Starter board players do not match requested players');
  if (board.turn.activePlayer !== playerTuple[0] || board.turn.round !== 1) {
    throw new Error(`Starter board must begin at round 1 with ${playerTuple[0]} active`);
  }
  const setupErrors: string[] = [];
  validateInitialArmy(board, context, setupErrors);
  if (setupErrors.length > 0) throw new Error(`Invalid army setup: ${setupErrors.join('; ')}`);
  const turnCap = options.turnCap ?? await loadDefaultTurnCap();
  const timeline: ReplayTimeline = { schemaVersion: 1, title: options.title ?? `${options.ruleset} ${options.map}`, run: { turnCap }, entries: [] };
  await mkdir(paths.snapshotsDir, { recursive: true });
  await writeFile(paths.boardState, `${JSON.stringify(board, null, 2)}\n`);
  await writeFile(paths.timeline, `${JSON.stringify(timeline, null, 2)}\n`);
  return paths;
}

export async function validateReplayBundle(timelinePath: string, options: ValidateReplayBundleOptions = {}): Promise<ValidatedReplayBundle> {
  const timeline = replayTimelineSchema.parse(await readJson(timelinePath));
  const baseDir = dirname(timelinePath);
  const context = await loadRulesContext();
  const entries: ValidatedReplayEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  if (timeline.entries.length === 0) errors.push('timeline has no entries');

  for (const entry of timeline.entries) {
    if (seen.has(entry.id)) errors.push(`${entry.id}: duplicate replay entry id`);
    seen.add(entry.id);
    const snapshots = await loadEntrySnapshots(baseDir, entry, errors);
    if (!snapshots) continue;
    const validated = { entry, ...snapshots };
    validateState(`${entry.id} board.before`, snapshots.boardBefore, context, errors);
    validateState(`${entry.id} board.after`, snapshots.boardAfter, context, errors);
    checkEntryMatchesSnapshots(validated, errors);
    const previous = entries.at(-1);
    if (previous) checkContinuity(previous, validated, errors);
    if (options.strict) validateBoardTransitionIndependent(validated, context, errors);
    if (options.strictDeck) validateDeckTransition(validated, errors);
    entries.push(validated);
  }

  const first = entries[0];
  if (first) {
    validateInitialArmy(first.boardBefore, context, errors);
    validateInitialDeck(first.deckBefore, first.boardBefore.players, context.deckConfig, options.strictDeck ?? false, errors);
  }
  if (options.strictWin) validateWinEvents(timeline, entries, errors);
  if (errors.length > 0) throw new Error(`Invalid replay bundle: ${errors.join('; ')}`);
  return { timeline, entries };
}

function validateBoardTransitionIndependent(validated: ValidatedReplayEntry, context: RulesContext, errors: string[]): void {
  const { entry } = validated;
  if (!entry.actions) {
    errors.push(`${entry.id}: strict validation requires board actions`);
    return;
  }
  const state = boardStateSchema.parse(cloneJson(validated.boardBefore));
  const raised = new Set<string>();
  const expectedKeyPoints: ReplayBoardActions['keyPointUpgrades'] = [];

  for (const point of context.map.keyPoints) {
    const unit = state.units.find((candidate) => candidate.player === entry.player && coordKey(candidate) === coordKey(point));
    if (!unit) continue;
    const rules = context.units[unit.type];
    if (!rules || (point.stat === 'range' && !rules.canUpgradeRange)) continue;
    unit[point.stat] += 1;
    raised.add(`${unit.id}:${point.stat}`);
    expectedKeyPoints.push({ target: unit.id, stat: point.stat, to: unit[point.stat], keyPoint: point.id });
  }
  if (stableJson(entry.actions.keyPointUpgrades) !== stableJson(expectedKeyPoints)) {
    errors.push(`${entry.id}: key point upgrades do not match start-of-turn occupancy`);
  }

  const spent: Record<string, number> = {};
  for (const upgrade of entry.actions.upgrades) {
    const unit = state.units.find((candidate) => candidate.id === upgrade.target);
    if (!unit) { errors.push(`${entry.id}: upgrade references missing target ${upgrade.target}`); continue; }
    if (unit.player !== entry.player) errors.push(`${entry.id}: upgrade target ${unit.id} is not a ${entry.player} unit`);
    const rules = context.units[unit.type];
    if (!rules) { errors.push(`${entry.id}: ${unit.id} has unknown unit type ${unit.type}`); continue; }
    if (upgrade.stat === 'range' && !rules.canUpgradeRange) errors.push(`${entry.id}: ${unit.id} cannot upgrade range`);
    const raiseKey = `${unit.id}:${upgrade.stat}`;
    if (raised.has(raiseKey)) errors.push(`${entry.id}: ${unit.id} ${upgrade.stat} can only be raised once per turn`);
    if (upgrade.to !== unit[upgrade.stat] + 1) errors.push(`${entry.id}: ${unit.id} ${upgrade.stat} must increase exactly once`);
    const lane = `${unit.type}${upgrade.stat[0]?.toUpperCase() ?? ''}${upgrade.stat.slice(1)}`;
    spent[lane] = (spent[lane] ?? 0) + upgrade.to;
    if ((spent[lane] ?? 0) > (entry.deck.produced[lane] ?? 0)) errors.push(`${entry.id}: upgrades spend ${spent[lane]} ${lane}, exceeding produced ${entry.deck.produced[lane] ?? 0}`);
    unit[upgrade.stat] = upgrade.to;
    raised.add(raiseKey);
  }

  const activated = new Set<string>();
  for (const activation of entry.actions.activations) {
    if (activated.has(activation.unit)) errors.push(`${entry.id}: ${activation.unit} has multiple activations`);
    activated.add(activation.unit);
    const unit = state.units.find((candidate) => candidate.id === activation.unit);
    if (!unit) { errors.push(`${entry.id}: activation references missing unit ${activation.unit}`); continue; }
    if (unit.player !== entry.player) errors.push(`${entry.id}: ${unit.id} cannot activate during ${entry.player}'s turn`);
    if (coordKey(unit) !== coordKey(activation.from)) errors.push(`${entry.id}: ${unit.id} activation starts at the wrong hex`);
    const via = activation.via ?? activation.from;
    const first = independentMovementDistance(state, context.map, unit, activation.from, via, entry.id, errors);
    unit.col = via.col;
    unit.row = via.row;
    if (activation.attack) {
      const target = state.units.find((candidate) => candidate.id === activation.attack?.target);
      if (!target) {
        errors.push(`${entry.id}: attack references missing target ${activation.attack.target}`);
      } else {
        if (target.player === entry.player) errors.push(`${entry.id}: ${unit.id} attacks friendly unit ${target.id}`);
        const distance = hexDistance(unit, target, context.map.coordinateSystem);
        if (distance > unit.range) errors.push(`${entry.id}: ${unit.id} attacked ${target.id} at range ${distance}, exceeding range ${unit.range}`);
        if (unit.range > 1 && !lineOfSight(context.map, unit, target)) errors.push(`${entry.id}: ${unit.id} has no line of sight to ${target.id}`);
        if (activation.attack.damage !== unit.attack) errors.push(`${entry.id}: ${unit.id} logged damage ${activation.attack.damage}, expected ${unit.attack}`);
        target.hp -= unit.attack;
        const removed = target.hp <= 0;
        if (activation.attack.targetRemoved !== removed) errors.push(`${entry.id}: ${target.id} targetRemoved is ${activation.attack.targetRemoved}, expected ${removed}`);
        if (removed) state.units = state.units.filter((candidate) => candidate.id !== target.id);
      }
    }
    const second = independentMovementDistance(state, context.map, unit, via, activation.to, entry.id, errors);
    if (first !== null && second !== null && first + second > unit.movement) errors.push(`${entry.id}: ${unit.id} moved ${first + second}, exceeding movement ${unit.movement}`);
    unit.col = activation.to.col;
    unit.row = activation.to.row;
  }

  state.turn = independentNextTurn(state);
  if (stableJson(boardContinuityState(state)) !== stableJson(boardContinuityState(validated.boardAfter))) {
    errors.push(`${entry.id}: independently replayed board actions do not match board.after`);
  }
}

function independentMovementDistance(
  state: BoardState,
  map: BoardMap,
  moving: BoardUnit,
  from: { col: number; row: number },
  to: { col: number; row: number },
  entryId: string,
  errors: string[]
): number | null {
  const occupant = state.units.find((unit) => unit.id !== moving.id && coordKey(unit) === coordKey(to));
  if (occupant) errors.push(`${entryId}: ${moving.id} cannot move to occupied hex ${coordKey(to)} containing ${occupant.id}`);
  const blockedByUnits = new Map(map.blocked.map((coord) => [coordKey(coord), coord]));
  for (const unit of state.units) {
    if (unit.id !== moving.id) blockedByUnits.set(coordKey(unit), { col: unit.col, row: unit.row });
  }
  const distance = mapDistance({ ...map, blocked: [...blockedByUnits.values()] }, from, to);
  if (distance === null) errors.push(`${entryId}: ${moving.id} movement uses an invalid map path ${coordKey(from)} -> ${coordKey(to)}`);
  return distance;
}

function validateWinEvents(timeline: ReplayTimeline, entries: ValidatedReplayEntry[], errors: string[]): void {
  if (!timeline.run) {
    errors.push('strict win validation requires timeline run.turnCap');
    return;
  }
  let terminal: ReplayWinEvent[] = [];
  for (const [index, validated] of entries.entries()) {
    const expected = expectedTerminalEvents(validated.boardAfter, index + 1, timeline.run.turnCap);
    if (stableJson(validated.entry.winEvents ?? []) !== stableJson(expected)) errors.push(`${validated.entry.id}: winEvents do not match expected terminal state`);
    if (terminal.length > 0) errors.push(`${validated.entry.id}: replay continues after a terminal event`);
    if (expected.length > 0) terminal = expected;
  }
  if (stableJson(timeline.terminalWinEvents ?? []) !== stableJson(terminal)) errors.push('terminalWinEvents do not match the final terminal event');
}

export function expectedTerminalEvents(state: BoardState, completedTurns: number, turnCap: number): ReplayWinEvent[] {
  const [first, second] = state.players;
  const firstUnits = state.units.filter((unit) => unit.player === first);
  const secondUnits = state.units.filter((unit) => unit.player === second);
  const eliminated = firstUnits.length === 0 || secondUnits.length === 0;
  if (!eliminated && completedTurns < turnCap) return [];

  let winner: string | null = null;
  const type: ReplayWinEvent['type'] = eliminated ? 'elimination' : 'turnCap';
  if (firstUnits.length !== secondUnits.length) {
    winner = firstUnits.length > secondUnits.length ? first : second;
  } else {
    const firstHp = totalHp(firstUnits);
    const secondHp = totalHp(secondUnits);
    if (firstHp !== secondHp) winner = firstHp > secondHp ? first : second;
  }
  if (winner === null) {
    return [{ type, outcome: 'draw', player: null, completedTurns, playerUnits: firstUnits.length, opponentUnits: secondUnits.length, playerHp: totalHp(firstUnits), opponentHp: totalHp(secondUnits) }];
  }
  const opponent = winner === first ? second : first;
  const winnerUnits = state.units.filter((unit) => unit.player === winner);
  const opponentUnits = state.units.filter((unit) => unit.player === opponent);
  return [{ type, outcome: 'win', player: winner, completedTurns, playerUnits: winnerUnits.length, opponentUnits: opponentUnits.length, playerHp: totalHp(winnerUnits), opponentHp: totalHp(opponentUnits) }];
}

function validateDeckTransition(validated: ValidatedReplayEntry, errors: string[]): void {
  const { entry, deckBefore, deckAfter } = validated;
  if (!isCompleteDeckSnapshot(deckBefore)) { errors.push(`${entry.id}: strict deck validation requires a complete deck.before snapshot`); return; }
  if (!isCompleteDeckSnapshot(deckAfter)) { errors.push(`${entry.id}: strict deck validation requires a complete deck.after snapshot`); return; }
  if (!entry.deck.actions) { errors.push(`${entry.id}: strict deck validation requires deck actions`); return; }
  const parsed = deckTurnInputSchema.safeParse({ schemaVersion: 1, turnId: entry.id, player: entry.player, actions: entry.deck.actions });
  if (!parsed.success) { errors.push(`${entry.id}: invalid deck actions: ${parsed.error.message}`); return; }
  try {
    const replayed = executeDeckTurn(deckBefore, parsed.data, { beforePath: entry.deck.before, afterPath: entry.deck.after });
    if (stableJson(replayed.after) !== stableJson(deckAfter)) errors.push(`${entry.id}: replayed deck actions do not match deck.after`);
    if (stableJson(entry.deck.drawnHand) !== stableJson(replayed.result.drawnHand)) errors.push(`${entry.id}: deck.drawnHand does not match replay`);
    if (stableJson(entry.deck.played) !== stableJson(replayed.result.played)) errors.push(`${entry.id}: deck.played does not match replay`);
    if (stableJson(entry.deck.bought) !== stableJson(replayed.result.bought)) errors.push(`${entry.id}: deck.bought does not match replay`);
    const keys = new Set([...Object.keys(entry.deck.produced), ...Object.keys(replayed.result.produced)]);
    for (const key of keys) if ((entry.deck.produced[key] ?? 0) !== (replayed.result.produced[key] ?? 0)) errors.push(`${entry.id}: deck.produced.${key} does not match replay`);
  } catch (error) {
    errors.push(`${entry.id}: ${errorMessage(error)}`);
  }
}

async function loadInitialUnits(path: string, context: RulesContext): Promise<BoardState['units']> {
  const parsed = initialUnitSetupsSchema.safeParse(await readJson(path));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'units'}: ${issue.message}`);
    throw new Error(`Invalid --units setup: ${issues.join('; ')}`);
  }
  return parsed.data.map((submitted) => {
    const rules = context.units[submitted.type];
    if (!rules) throw new Error(`Invalid army setup: ${submitted.id} has unknown unit type ${submitted.type}`);
    return {
      ...submitted,
      hp: rules.hp,
      attack: rules.attack,
      movement: rules.movement,
      range: rules.range
    };
  });
}

function validateInitialArmy(state: BoardState, context: RulesContext, errors: string[]): void {
  if (state.turn.round !== 1 || state.turn.activePlayer !== state.players[0]) {
    errors.push(`initial board must begin at round 1 with ${state.players[0]} active`);
  }
  const occupied = new Set<string>();
  const walls = new Set(context.map.blocked.map(coordKey));
  for (const player of state.players) {
    const units = state.units.filter((unit) => unit.player === player);
    if (units.length !== context.unitsPerPlayer) errors.push(`${player} must deploy exactly ${context.unitsPerPlayer} units`);
    const zone = context.map.deployment.find((candidate) => candidate.player === player);
    const allowed = new Set(zone?.hexes.map(coordKey) ?? []);
    for (const unit of units) {
      const key = coordKey(unit);
      if (occupied.has(key)) errors.push(`multiple units occupy ${key}`);
      occupied.add(key);
      if (!allowed.has(key)) errors.push(`${unit.id} is outside ${player}'s deployment zone at ${key}`);
      if (walls.has(key)) errors.push(`${unit.id} is deployed on wall ${key}`);
      const rules = context.units[unit.type];
      if (!rules) { errors.push(`${unit.id} has unknown unit type ${unit.type}`); continue; }
      for (const stat of ['hp', 'attack', 'movement', 'range'] as const) if (unit[stat] !== rules[stat]) errors.push(`${unit.id} ${stat} is ${unit[stat]}, expected base ${rules[stat]}`);
    }
  }
}

function validateInitialDeck(snapshot: DeckSnapshot, boardPlayers: [string, string], config: GameConfig, strict: boolean, errors: string[]): void {
  if (!isCompleteDeckSnapshot(snapshot)) return;
  const game = snapshot.game;
  const firstPlayer = boardPlayers[0];
  if (activeDeckPlayerId(game) !== firstPlayer) errors.push(`initial deck must begin with ${firstPlayer} active`);
  if (game.players.some((player) => player.turnsTaken !== 0)) errors.push('initial deck players must have zero turns taken');
  if (!strict) return;

  if (stableJson(game.config) !== stableJson(config)) errors.push('initial deck config does not match game/deck.yaml');
  const expectedCards = Object.fromEntries(config.cards.map((card) => [card.id, card]));
  if (stableJson(game.cards) !== stableJson(expectedCards)) errors.push('initial deck card definitions do not match game/deck.yaml');
  if (stableJson(game.players.map((player) => player.id)) !== stableJson(boardPlayers)) errors.push('initial deck players do not match board players');
  if (game.activePlayer !== 0) errors.push('initial deck activePlayer must be 0');
  if (game.phase !== 'action') errors.push('initial deck must begin in the action phase');
  if (game.ended) errors.push('initial deck cannot already be ended');
  if (game.pending) errors.push('initial deck cannot have a pending effect');
  if (game.trash.length > 0) errors.push('initial deck trash must be empty');

  const draftedCounts: Record<string, number> = {};
  for (const player of game.players) validateOpeningPlayer(player, config, draftedCounts, errors);

  const expectedSupply = Object.fromEntries(config.supply.map((pile) => [pile.card, pile.count]));
  for (const [cardId, count] of Object.entries(draftedCounts)) {
    if (expectedSupply[cardId] === undefined) {
      errors.push(`${cardId} is not available in the configured draft market`);
      continue;
    }
    expectedSupply[cardId] -= count;
    if (expectedSupply[cardId] < 0) errors.push(`initial drafts request ${count} ${cardId}, exceeding configured supply`);
  }
  if (stableJson(game.supply) !== stableJson(expectedSupply)) errors.push('initial deck supply does not match configured supply minus drafted cards');
}

function validateOpeningPlayer(player: PlayerState, config: GameConfig, draftedCounts: Record<string, number>, errors: string[]): void {
  const draft = config.setup.draft;
  const cards = [...player.draw, ...player.hand, ...player.discard, ...player.play];
  const counts = countCards(cards);
  const baseCounts = countCards(draft ? Array(draft.baseCount).fill(draft.baseCard) : config.setup.startingDeck);
  const drafted: string[] = [];

  for (const [cardId, count] of Object.entries(counts)) {
    const extra = count - (baseCounts[cardId] ?? 0);
    if (!config.cards.some((card) => card.id === cardId)) errors.push(`${player.id} opening deck contains unknown card ${cardId}`);
    if (extra > 0) drafted.push(...Array(extra).fill(cardId));
  }
  for (const [cardId, count] of Object.entries(baseCounts)) {
    if ((counts[cardId] ?? 0) < count) errors.push(`${player.id} opening deck is missing ${count - (counts[cardId] ?? 0)} ${cardId}`);
  }

  if (!draft && drafted.length > 0) errors.push(`${player.id} opening deck does not match configured startingDeck`);
  if (draft) {
    if (drafted.length > draft.maxCards) errors.push(`${player.id} opening deck has ${drafted.length} drafted cards, exceeding maximum ${draft.maxCards}`);
    const cost = drafted.reduce((sum, cardId) => sum + (config.cards.find((card) => card.id === cardId)?.cost ?? 0), 0);
    if (cost > draft.maxCost) errors.push(`${player.id} opening draft costs ${cost}, exceeding maximum ${draft.maxCost}`);
    for (const cardId of drafted) draftedCounts[cardId] = (draftedCounts[cardId] ?? 0) + 1;
  }

  if (player.hand.length !== Math.min(config.setup.handSize, cards.length)) errors.push(`${player.id} opening hand has ${player.hand.length} cards, expected ${Math.min(config.setup.handSize, cards.length)}`);
  if (player.discard.length > 0 || player.play.length > 0) errors.push(`${player.id} opening discard and play zones must be empty`);
  if (player.actions !== config.setup.initialActions) errors.push(`${player.id} opening actions do not match config`);
  if (player.buys !== config.setup.initialBuys) errors.push(`${player.id} opening buys do not match config`);
  if (player.money !== config.setup.initialMoney) errors.push(`${player.id} opening money does not match config`);
  if (stableJson(player.attributes) !== stableJson(config.setup.attributes)) errors.push(`${player.id} opening attributes do not match config`);
  if (Object.keys(player.persistentAttributes).length > 0) errors.push(`${player.id} opening persistent attributes must be empty`);
  if (player.vpCounters !== 0) errors.push(`${player.id} opening VP counters must be zero`);
  if (player.freeTrashUsed) errors.push(`${player.id} cannot begin with free trash already used`);
}

function countCards(cards: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const card of cards) counts[card] = (counts[card] ?? 0) + 1;
  return counts;
}

function validateState(label: string, state: BoardState, context: RulesContext, errors: string[]): void {
  if (state.ruleset !== 'skirmish-v1' || state.map !== context.map.id) errors.push(`${label}: board references unexpected assets`);
  const hexes = new Set(context.map.hexes.map(coordKey));
  const walls = new Set(context.map.blocked.map(coordKey));
  const occupied = new Set<string>();
  for (const unit of state.units) {
    const key = coordKey(unit);
    if (!hexes.has(key)) errors.push(`${label}: ${unit.id} is outside the map at ${key}`);
    if (walls.has(key)) errors.push(`${label}: ${unit.id} occupies wall ${key}`);
    if (occupied.has(key)) errors.push(`${label}: multiple units occupy ${key}`);
    occupied.add(key);
    if (!context.units[unit.type]) errors.push(`${label}: ${unit.id} has unknown unit type ${unit.type}`);
  }
}

function checkEntryMatchesSnapshots(validated: ValidatedReplayEntry, errors: string[]): void {
  const { entry, boardBefore, boardAfter, deckBefore } = validated;
  if (boardBefore.turn.activePlayer !== entry.player) errors.push(`${entry.id}: board.before active player is ${boardBefore.turn.activePlayer}, expected ${entry.player}`);
  if (boardBefore.turn.round !== entry.round) errors.push(`${entry.id}: board.before round is ${boardBefore.turn.round}, expected ${entry.round}`);
  if (activeDeckPlayerId(deckBefore.game) !== entry.player) errors.push(`${entry.id}: deck.before active player does not match ${entry.player}`);
  if (stableJson(boardAfter.turn) !== stableJson(independentNextTurn(boardBefore))) errors.push(`${entry.id}: board.after turn does not advance from board.before`);
}

function checkContinuity(previous: ValidatedReplayEntry, current: ValidatedReplayEntry, errors: string[]): void {
  if (stableJson(previous.deckAfter) !== stableJson(current.deckBefore)) errors.push(`${previous.entry.id}: deck.after does not match the next deck.before`);
  if (stableJson(boardContinuityState(previous.boardAfter)) !== stableJson(boardContinuityState(current.boardBefore))) errors.push(`${previous.entry.id}: board.after does not match the next board.before`);
}

function independentNextTurn(state: BoardState): BoardState['turn'] {
  const current = state.players.indexOf(state.turn.activePlayer);
  if (current < 0) return state.turn;
  const next = (current + 1) % state.players.length;
  return { activePlayer: state.players[next] ?? state.turn.activePlayer, round: state.turn.round + (next === 0 ? 1 : 0) };
}

async function loadRulesContext(): Promise<RulesContext> {
  const [map, units, setup, deckConfig] = await Promise.all([readJson('game/map.json'), readJson('game/units.json'), readJson('game/setup.json'), loadGameConfig('game/deck.yaml')]);
  const parsedSetup = z.object({ unitsPerPlayer: z.number().int().positive() }).strict().parse(setup);
  return { map: validateSkirmishMap(map), units: unitRulesSchema.parse(units), unitsPerPlayer: parsedSetup.unitsPerPlayer, deckConfig };
}

async function loadEntrySnapshots(baseDir: string, entry: ReplayEntry, errors: string[]): Promise<Omit<ValidatedReplayEntry, 'entry'> | undefined> {
  const [deckBefore, deckAfter, boardBefore, boardAfter] = await Promise.all([
    loadDeck(resolveSnapshotPath(baseDir, entry.deck.before), `${entry.id} deck.before`, errors),
    loadDeck(resolveSnapshotPath(baseDir, entry.deck.after), `${entry.id} deck.after`, errors),
    loadBoard(resolveSnapshotPath(baseDir, entry.board.before), `${entry.id} board.before`, errors),
    loadBoard(resolveSnapshotPath(baseDir, entry.board.after), `${entry.id} board.after`, errors)
  ]);
  return deckBefore && deckAfter && boardBefore && boardAfter ? { deckBefore, deckAfter, boardBefore, boardAfter } : undefined;
}

async function loadDeck(path: string, label: string, errors: string[]): Promise<DeckSnapshot | undefined> {
  try {
    const value = await readJson(path);
    if (!isDeckSnapshot(value)) { errors.push(`${label}: invalid deck snapshot`); return undefined; }
    return value;
  } catch (error) { errors.push(`${label}: ${errorMessage(error)}`); return undefined; }
}

async function loadBoard(path: string, label: string, errors: string[]): Promise<BoardState | undefined> {
  try { return boardStateSchema.parse(await readJson(path)); }
  catch (error) { errors.push(`${label}: ${errorMessage(error)}`); return undefined; }
}

function isDeckSnapshot(value: unknown): value is DeckSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DeckSnapshot>;
  return candidate.schemaVersion === 1 && Number.isInteger(candidate.rngState) && isGameState(candidate.game);
}

function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GameState>;
  return Array.isArray(candidate.players) && Number.isInteger(candidate.activePlayer);
}

function totalHp(units: BoardUnit[]): number { return units.reduce((sum, unit) => sum + unit.hp, 0); }
function activeDeckPlayerId(game: GameState): string | undefined { return game.players[game.activePlayer]?.id; }
function boardContinuityState(state: BoardState): Omit<BoardState, 'notes'> { const { notes, ...rest } = state; return rest; }
function resolveSnapshotPath(baseDir: string, path: string): string { return isAbsolute(path) ? path : join(baseDir, path); }
function stableJson(value: unknown): string { return JSON.stringify(value); }
function cloneJson<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
async function readJson(path: string): Promise<unknown> { return JSON.parse(await readFile(path, 'utf8')) as unknown; }
async function loadDefaultTurnCap(): Promise<number> {
  const raw = parseYaml(await readFile('game/run.yaml', 'utf8')) as unknown;
  return z.object({ max_turns: z.number().int().positive() }).strict().parse(raw).max_turns;
}

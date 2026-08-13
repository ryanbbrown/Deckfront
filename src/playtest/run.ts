import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { boardStateSchema, coordKey, skirmishSetupRulesSchema, unitRulesSchema, validateSkirmishMap, type BoardMap, type BoardState, type UnitRules } from '../board/schema';
import { loadGameConfig } from '../config/loadGameConfig';
import type { GameConfig, GameState, PlayerState } from '../core/types';
import { replayTimelineSchema, type ReplayActivationInput, type ReplayEntry, type ReplayTimeline, type ReplayWinEvent } from '../replay/schema';
import { executeBoardAction, nextDeckPlayerAfterSetup, type BoardActionInput, type BoardRulesContext } from './boardAction';
import { deckTurnInputSchema, executeDeckTurn, isCompleteDeckSnapshot, type DeckSnapshot } from './deckTurn';

export interface PlaytestRunPaths { root: string; deckState: string; boardState: string; timeline: string; snapshotsDir: string }
export interface StepSnapshotPaths { deckBefore: string; deckAfter: string; boardBefore: string; boardAfter: string }
export interface ValidatedReplayEntry { entry: ReplayEntry; deckBefore?: DeckSnapshot; deckAfter?: DeckSnapshot; boardBefore: BoardState; boardAfter: BoardState }
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

interface RulesContext extends BoardRulesContext { unitsPerPlayer: number; deckConfig: GameConfig }
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

export function stepSnapshotPaths(root: string, stepId: string): StepSnapshotPaths {
  const snapshots = playtestRunPaths(root).snapshotsDir;
  return {
    deckBefore: join(snapshots, `${stepId}.before.deck.json`),
    deckAfter: join(snapshots, `${stepId}.after.deck.json`),
    boardBefore: join(snapshots, `${stepId}.before.board.json`),
    boardAfter: join(snapshots, `${stepId}.after.board.json`)
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
    turn: initialRoundState(playerTuple),
    units,
    notes: []
  });
  if (board.ruleset !== options.ruleset || board.map !== options.map) throw new Error('Starter board does not match requested ruleset and map');
  if (stableJson(board.players) !== stableJson(playerTuple)) throw new Error('Starter board players do not match requested players');
  if (!isInitialRoundState(board.turn, playerTuple)) {
    throw new Error(`Starter board must begin in round 1 setup with ${playerTuple[0]} holding initiative`);
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
  let lastDeckAfter: DeckSnapshot | undefined;
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
    if (options.strictDeck && entry.phase === 'setup') validateDeckTransition(validated, errors);
    if (entry.phase === 'setup' && validated.deckBefore && validated.deckAfter) {
      if (lastDeckAfter && stableJson(lastDeckAfter) !== stableJson(validated.deckBefore)) errors.push(`${entry.id}: deck.before does not match the previous setup deck.after`);
      lastDeckAfter = validated.deckAfter;
    }
    entries.push(validated);
  }

  const first = entries[0];
  if (first) {
    validateInitialArmy(first.boardBefore, context, errors);
    if (first.deckBefore) validateInitialDeck(first.deckBefore, first.boardBefore.players, context.deckConfig, options.strictDeck ?? false, errors);
  }
  if (options.strictWin) validateWinEvents(timeline, entries, errors);
  if (errors.length > 0) throw new Error(`Invalid replay bundle: ${errors.join('; ')}`);
  return { timeline, entries };
}

function validateBoardTransitionIndependent(validated: ValidatedReplayEntry, context: RulesContext, errors: string[]): void {
  const { entry } = validated;
  const input: BoardActionInput = entry.phase === 'setup'
    ? { schemaVersion: 1, stepId: entry.id, player: entry.player, action: { type: 'setup', upgrades: entry.action.upgrades } }
    : { schemaVersion: 1, stepId: entry.id, player: entry.player, action: { type: 'activation', activation: replayActivationInput(entry.action.activation) } };
  try {
    const replayed = executeBoardAction(
      validated.boardBefore,
      input,
      context,
      { beforePath: entry.board.before, afterPath: entry.board.after },
      entry.phase === 'setup' ? replayDeckResult(entry) : undefined
    );
    if (stableJson(replayed.result.action) !== stableJson(entry.action)) errors.push(`${entry.id}: board action result does not match replay`);
    if (stableJson(boardContinuityState(replayed.after)) !== stableJson(boardContinuityState(validated.boardAfter))) {
      errors.push(`${entry.id}: replayed board action does not match board.after`);
    }
  } catch (error) {
    errors.push(`${entry.id}: ${errorMessage(error)}`);
  }
}

function validateWinEvents(timeline: ReplayTimeline, entries: ValidatedReplayEntry[], errors: string[]): void {
  if (!timeline.run) {
    errors.push('strict win validation requires timeline run.turnCap');
    return;
  }
  let terminal: ReplayWinEvent[] = [];
  for (const validated of entries) {
    const expected = expectedTerminalEvents(validated.boardAfter, completedRounds(validated.boardAfter), timeline.run.turnCap);
    if (stableJson(validated.entry.winEvents ?? []) !== stableJson(expected)) errors.push(`${validated.entry.id}: winEvents do not match expected terminal state`);
    if (terminal.length > 0) errors.push(`${validated.entry.id}: replay continues after a terminal event`);
    if (expected.length > 0) terminal = expected;
  }
  if (stableJson(timeline.terminalWinEvents ?? []) !== stableJson(terminal)) errors.push('terminalWinEvents do not match the final terminal event');
}

export function expectedTerminalEvents(state: BoardState, completedRoundsValue: number, turnCap: number): ReplayWinEvent[] {
  const [first, second] = state.players;
  const firstUnits = state.units.filter((unit) => unit.player === first);
  const secondUnits = state.units.filter((unit) => unit.player === second);
  const eliminated = firstUnits.length === 0 || secondUnits.length === 0;
  if (!eliminated && completedRoundsValue < turnCap) return [];

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
    return [{ type, outcome: 'draw', player: null, completedRounds: completedRoundsValue, playerUnits: firstUnits.length, opponentUnits: secondUnits.length, playerHp: totalHp(firstUnits), opponentHp: totalHp(secondUnits) }];
  }
  const opponent = winner === first ? second : first;
  const winnerUnits = state.units.filter((unit) => unit.player === winner);
  const opponentUnits = state.units.filter((unit) => unit.player === opponent);
  return [{ type, outcome: 'win', player: winner, completedRounds: completedRoundsValue, playerUnits: winnerUnits.length, opponentUnits: opponentUnits.length, playerHp: totalHp(winnerUnits), opponentHp: totalHp(opponentUnits) }];
}

function validateDeckTransition(validated: ValidatedReplayEntry, errors: string[]): void {
  const { entry, deckBefore, deckAfter } = validated;
  if (entry.phase !== 'setup') return;
  if (!isCompleteDeckSnapshot(deckBefore)) { errors.push(`${entry.id}: strict deck validation requires a complete deck.before snapshot`); return; }
  if (!isCompleteDeckSnapshot(deckAfter)) { errors.push(`${entry.id}: strict deck validation requires a complete deck.after snapshot`); return; }
  if (!entry.deck.actions) { errors.push(`${entry.id}: strict deck validation requires deck actions`); return; }
  const parsed = deckTurnInputSchema.safeParse({ schemaVersion: 1, turnId: entry.id, player: entry.player, actions: entry.deck.actions });
  if (!parsed.success) { errors.push(`${entry.id}: invalid deck actions: ${parsed.error.message}`); return; }
  try {
    const nextPlayer = nextDeckPlayerAfterSetup(validated.boardBefore);
    const replayed = executeDeckTurn(deckBefore, parsed.data, { beforePath: entry.deck.before, afterPath: entry.deck.after, nextPlayer });
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
  if (!isInitialRoundState(state.turn, state.players)) {
    errors.push(`initial board must begin in round 1 setup with ${state.players[0]} holding initiative`);
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
  const opponent = state.players.find((player) => player !== state.turn.initiativePlayer);
  const setupOrder = opponent ? [state.turn.initiativePlayer, opponent] : [];
  if (state.turn.phase === 'setup') {
    if (state.turn.activatedUnitIds.length > 0) errors.push(`${label}: setup phase cannot retain activated units`);
    if (Object.values(state.turn.activationCounts).some((count) => count !== 0)) errors.push(`${label}: setup phase cannot retain activation counts`);
    if (stableJson(state.turn.completedSetupPlayers) !== stableJson(setupOrder.slice(0, state.turn.completedSetupPlayers.length))) errors.push(`${label}: completed setup players are out of initiative order`);
    const expected = setupOrder[state.turn.completedSetupPlayers.length];
    if (expected && state.turn.activePlayer !== expected) errors.push(`${label}: setup active player is ${state.turn.activePlayer}, expected ${expected}`);
  } else {
    if (stableJson(state.turn.completedSetupPlayers) !== stableJson(setupOrder)) errors.push(`${label}: activation phase requires both completed setups in initiative order`);
    for (const player of state.players) {
      if ((state.turn.activationCounts[player] ?? 0) > context.setup.maxActivationsPerPlayer) {
        errors.push(`${label}: ${player} exceeds the activation limit of ${context.setup.maxActivationsPerPlayer}`);
      }
    }
    const activeHasUnit = (state.turn.activationCounts[state.turn.activePlayer] ?? context.setup.maxActivationsPerPlayer) < context.setup.maxActivationsPerPlayer
      && state.units.some((unit) => unit.player === state.turn.activePlayer && !state.turn.activatedUnitIds.includes(unit.id));
    const eliminated = state.players.some((player) => !state.units.some((unit) => unit.player === player));
    if (!activeHasUnit && !eliminated) errors.push(`${label}: active player has no unactivated unit and should have passed automatically`);
  }
}

function checkEntryMatchesSnapshots(validated: ValidatedReplayEntry, errors: string[]): void {
  const { entry, boardBefore, boardAfter, deckBefore } = validated;
  if (boardBefore.turn.activePlayer !== entry.player) errors.push(`${entry.id}: board.before active player is ${boardBefore.turn.activePlayer}, expected ${entry.player}`);
  if (boardBefore.turn.round !== entry.round) errors.push(`${entry.id}: board.before round is ${boardBefore.turn.round}, expected ${entry.round}`);
  if (boardBefore.turn.phase !== entry.phase) errors.push(`${entry.id}: board.before phase is ${boardBefore.turn.phase}, expected ${entry.phase}`);
  if (entry.phase === 'setup' && deckBefore && activeDeckPlayerId(deckBefore.game) !== entry.player) errors.push(`${entry.id}: deck.before active player does not match ${entry.player}`);
  if (entry.phase === 'activation' && (validated.deckBefore || validated.deckAfter)) errors.push(`${entry.id}: activation entry cannot contain deck snapshots`);
}

function checkContinuity(previous: ValidatedReplayEntry, current: ValidatedReplayEntry, errors: string[]): void {
  const previousDeck = previous.deckAfter ?? previous.deckBefore;
  const currentDeck = current.deckBefore ?? current.deckAfter;
  if (previousDeck && currentDeck && stableJson(previousDeck) !== stableJson(currentDeck)) errors.push(`${previous.entry.id}: deck state does not match the next setup deck.before`);
  if (stableJson(boardContinuityState(previous.boardAfter)) !== stableJson(boardContinuityState(current.boardBefore))) errors.push(`${previous.entry.id}: board.after does not match the next board.before`);
}

async function loadRulesContext(): Promise<RulesContext> {
  const [map, units, setup, deckConfig] = await Promise.all([readJson('game/map.json'), readJson('game/units.json'), readJson('game/setup.json'), loadGameConfig('game/deck.yaml')]);
  const parsedSetup = skirmishSetupRulesSchema.parse(setup);
  return { map: validateSkirmishMap(map), units: unitRulesSchema.parse(units), setup: parsedSetup, unitsPerPlayer: parsedSetup.unitsPerPlayer, deckConfig };
}

async function loadEntrySnapshots(baseDir: string, entry: ReplayEntry, errors: string[]): Promise<Omit<ValidatedReplayEntry, 'entry'> | undefined> {
  const [deckBefore, deckAfter, boardBefore, boardAfter] = await Promise.all([
    entry.phase === 'setup' ? loadDeck(resolveSnapshotPath(baseDir, entry.deck.before), `${entry.id} deck.before`, errors) : Promise.resolve(undefined),
    entry.phase === 'setup' ? loadDeck(resolveSnapshotPath(baseDir, entry.deck.after), `${entry.id} deck.after`, errors) : Promise.resolve(undefined),
    loadBoard(resolveSnapshotPath(baseDir, entry.board.before), `${entry.id} board.before`, errors),
    loadBoard(resolveSnapshotPath(baseDir, entry.board.after), `${entry.id} board.after`, errors)
  ]);
  if (!boardBefore || !boardAfter || (entry.phase === 'setup' && (!deckBefore || !deckAfter))) return undefined;
  return { ...(deckBefore ? { deckBefore } : {}), ...(deckAfter ? { deckAfter } : {}), boardBefore, boardAfter };
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
function completedRounds(state: BoardState): number { return state.turn.round - 1; }
function replayActivationInput(activation: Extract<ReplayEntry, { phase: 'activation' }>['action']['activation']): ReplayActivationInput {
  return { unit: activation.unit, from: activation.from, ...(activation.via ? { via: activation.via } : {}), ...(activation.attack ? { attack: { target: activation.attack.target } } : {}), to: activation.to };
}
function replayDeckResult(entry: Extract<ReplayEntry, { phase: 'setup' }>) {
  return { schemaVersion: 1 as const, turnId: entry.id, player: entry.player, ...entry.deck, actions: entry.deck.actions ?? [] };
}
function initialRoundState(players: BoardState['players']): BoardState['turn'] {
  const [firstPlayer, secondPlayer] = players;
  return {
    round: 1,
    phase: 'setup',
    initiativePlayer: firstPlayer,
    activePlayer: firstPlayer,
    completedSetupPlayers: [],
    activatedUnitIds: [],
    activationCounts: { [firstPlayer]: 0, [secondPlayer]: 0 }
  };
}
function isInitialRoundState(turn: BoardState['turn'], players: BoardState['players']): boolean {
  const expected = initialRoundState(players);
  return turn.round === expected.round
    && turn.phase === expected.phase
    && turn.initiativePlayer === expected.initiativePlayer
    && turn.activePlayer === expected.activePlayer
    && stableJson(turn.completedSetupPlayers) === stableJson(expected.completedSetupPlayers)
    && stableJson(turn.activatedUnitIds) === stableJson(expected.activatedUnitIds)
    && Object.keys(turn.activationCounts).length === players.length
    && players.every((player) => turn.activationCounts[player] === 0);
}
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

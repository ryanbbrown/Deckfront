import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { hexDistance, lineOfSight, mapDistance } from '../board/coordinates';
import {
  boardMapSchema,
  boardStateSchema,
  coordKey,
  unitRulesSchema,
  validateSkirmishMap,
  type BoardMap,
  type BoardState,
  type UnitRules
} from '../board/schema';
import {
  replayActivationInputSchema,
  replayBoardActionSchema,
  replayUpgradeActionSchema,
  type ReplayBoardAction
} from '../replay/schema';
import { deckTurnResultSchema, type DeckTurnResult } from './deckTurn';

const setupRulesSchema = z.object({ unitsPerPlayer: z.number().int().positive() }).strict();

const setupInputSchema = z.object({
  type: z.literal('setup'),
  upgrades: z.array(replayUpgradeActionSchema).default([])
}).strict();

const activationInputSchema = z.object({
  type: z.literal('activation'),
  activation: replayActivationInputSchema
}).strict();

export const boardActionInputSchema = z.object({
  schemaVersion: z.literal(1),
  stepId: z.string().min(1),
  player: z.string().min(1),
  action: z.discriminatedUnion('type', [setupInputSchema, activationInputSchema])
}).strict();

export const boardActionResultSchema = z.object({
  schemaVersion: z.literal(1),
  stepId: z.string().min(1),
  player: z.string().min(1),
  before: z.string().min(1),
  after: z.string().min(1),
  action: replayBoardActionSchema
}).strict();

type SetupInput = z.infer<typeof setupInputSchema>;
type ActivationInput = z.infer<typeof activationInputSchema>;
interface BoardActionInputBase { schemaVersion: 1; stepId: string; player: string }
export type BoardActionInput = BoardActionInputBase & ({ action: SetupInput } | { action: ActivationInput });
export type BoardActionResult = z.infer<typeof boardActionResultSchema>;
export type BoardUnit = BoardState['units'][number];

export interface BoardRulesContext {
  map: BoardMap;
  units: UnitRules;
  setup: z.infer<typeof setupRulesSchema>;
}

export interface ExecuteBoardActionOptions { beforePath: string; afterPath: string }
export interface ExecutedBoardAction { before: BoardState; after: BoardState; result: BoardActionResult }

export function nextDeckPlayerAfterSetup(state: BoardState): string {
  if (state.turn.phase !== 'setup') throw new Error('Deck turns are only available during setup');
  if (state.turn.completedSetupPlayers.length === 0) {
    const opponent = state.players.find((player) => player !== state.turn.initiativePlayer);
    if (!opponent) throw new Error(`board roster has no opponent for ${state.turn.initiativePlayer}`);
    return opponent;
  }
  return state.turn.activePlayer;
}

export async function readBoardActionInput(path: string): Promise<BoardActionInput> {
  return boardActionInputSchema.parse(JSON.parse(await readFile(path, 'utf8')) as unknown) as BoardActionInput;
}

export async function readDeckTurnResult(path: string): Promise<DeckTurnResult> {
  return deckTurnResultSchema.parse(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

export async function loadBoardRulesContext(board?: BoardState): Promise<BoardRulesContext> {
  const [mapRaw, unitsRaw, setupRaw] = await Promise.all([
    readJson('game/map.json'),
    readJson('game/units.json'),
    readJson('game/setup.json')
  ]);
  const map = validateSkirmishMap(mapRaw);
  if (board && (board.map !== map.id || board.ruleset !== 'skirmish-v1')) {
    throw new Error(`Board references ${board.ruleset}/${board.map}, expected skirmish-v1/${map.id}`);
  }
  return { map, units: unitRulesSchema.parse(unitsRaw), setup: setupRulesSchema.parse(setupRaw) };
}

export function executeBoardAction(
  beforeState: BoardState,
  input: BoardActionInput,
  context: BoardRulesContext,
  options: ExecuteBoardActionOptions,
  deckResult?: DeckTurnResult
): ExecutedBoardAction {
  const before = boardStateSchema.parse(cloneJson(beforeState));
  const after = boardStateSchema.parse(cloneJson(beforeState));
  if (armyEliminated(before)) throw new Error(`${input.stepId}: board action cannot execute after elimination`);
  assertActivePlayer(before, input);
  if (context.map.id !== before.map) throw new Error(`rules context map is ${context.map.id}, expected ${before.map}`);

  let action: ReplayBoardAction;
  if (input.action.type === 'setup') {
    action = executeSetup(after, input as BoardActionInputBase & { action: SetupInput }, context, deckResult);
  } else {
    if (deckResult) throw new Error(`${input.stepId}: activation cannot include a deck result`);
    action = executeActivation(after, input as BoardActionInputBase & { action: ActivationInput }, context);
  }

  return {
    before,
    after: boardStateSchema.parse(after),
    result: {
      schemaVersion: 1,
      stepId: input.stepId,
      player: input.player,
      before: options.beforePath,
      after: options.afterPath,
      action
    }
  };
}

function assertActivePlayer(state: BoardState, input: BoardActionInput): void {
  if (!state.players.includes(input.player)) throw new Error(`board roster does not include ${input.player}`);
  if (state.turn.activePlayer !== input.player) {
    throw new Error(`${input.stepId}: active player is ${state.turn.activePlayer}, expected ${input.player}`);
  }
  if (state.turn.phase !== input.action.type) {
    throw new Error(`${input.stepId}: board phase is ${state.turn.phase}, not ${input.action.type}`);
  }
}

function executeSetup(
  state: BoardState,
  input: BoardActionInputBase & { action: SetupInput },
  context: BoardRulesContext,
  deckResult: DeckTurnResult | undefined
): ReplayBoardAction {
  if (!deckResult) throw new Error(`${input.stepId}: setup requires a deck result`);
  if (deckResult.turnId !== input.stepId) throw new Error(`${input.stepId}: deck result id is ${deckResult.turnId}`);
  if (deckResult.player !== input.player) throw new Error(`${input.stepId}: deck result player is ${deckResult.player}`);
  if (state.turn.completedSetupPlayers.includes(input.player)) {
    throw new Error(`${input.stepId}: ${input.player} already completed setup this round`);
  }

  const action: Extract<ReplayBoardAction, { type: 'setup' }> = {
    type: 'setup',
    keyPointUpgrades: [],
    upgrades: []
  };
  const raised = applyKeyPointUpgrades(state, input.player, context, action);
  applyPaidUpgrades(state, input, deckResult, context, raised, action);
  state.turn.completedSetupPlayers.push(input.player);

  const pending = setupOrder(state).find((player) => !state.turn.completedSetupPlayers.includes(player));
  if (pending) {
    state.turn.activePlayer = pending;
  } else {
    state.turn.phase = 'activation';
    state.turn.activePlayer = state.turn.initiativePlayer;
    state.turn.activatedUnitIds = [];
  }
  return action;
}

function executeActivation(
  state: BoardState,
  input: BoardActionInputBase & { action: ActivationInput },
  context: BoardRulesContext
): ReplayBoardAction {
  const activation = input.action.activation;
  if (state.turn.activatedUnitIds.includes(activation.unit)) {
    throw new Error(`${input.stepId}: ${activation.unit} already activated this round`);
  }
  const unit = findUnit(state, activation.unit);
  if (!unit) throw new Error(`${input.stepId}: activation references missing unit ${activation.unit}`);
  if (unit.player !== input.player) throw new Error(`${input.stepId}: ${unit.id} cannot activate for ${input.player}`);
  if (coordKey(unit) !== coordKey(activation.from)) {
    throw new Error(`${input.stepId}: ${unit.id} activation from ${coordKey(activation.from)} does not match ${coordKey(unit)}`);
  }

  const via = activation.via ?? activation.from;
  const firstDistance = movementDistance(state, context.map, unit, activation.from, via, input.stepId);
  unit.col = via.col;
  unit.row = via.row;

  let attackResult: Extract<ReplayBoardAction, { type: 'activation' }>['activation']['attack'];
  if (activation.attack) {
    const target = findUnit(state, activation.attack.target);
    if (!target) throw new Error(`${input.stepId}: attack references missing target ${activation.attack.target}`);
    if (target.player === input.player) throw new Error(`${input.stepId}: ${unit.id} attacks friendly unit ${target.id}`);
    const distance = hexDistance(unit, target, context.map.coordinateSystem);
    if (distance > unit.range) throw new Error(`${input.stepId}: ${unit.id} attacked ${target.id} at range ${distance}, exceeding range ${unit.range}`);
    if (unit.range > 1 && !lineOfSight(context.map, unit, target)) throw new Error(`${input.stepId}: ${unit.id} has no line of sight to ${target.id}`);
    const damage = unit.attack;
    target.hp -= damage;
    const targetRemoved = target.hp <= 0;
    attackResult = { target: target.id, damage, targetRemoved };
    if (targetRemoved) state.units = state.units.filter((candidate) => candidate.id !== target.id);
  }

  const secondDistance = movementDistance(state, context.map, unit, via, activation.to, input.stepId);
  if (firstDistance + secondDistance > unit.movement) {
    throw new Error(`${input.stepId}: ${unit.id} moved ${firstDistance + secondDistance}, exceeding movement ${unit.movement}`);
  }
  unit.col = activation.to.col;
  unit.row = activation.to.row;
  state.turn.activatedUnitIds.push(unit.id);

  if (!armyEliminated(state)) advanceActivation(state, input.player);
  return {
    type: 'activation',
    activation: {
      unit: unit.id,
      from: activation.from,
      ...(activation.via ? { via: activation.via } : {}),
      ...(attackResult ? { attack: attackResult } : {}),
      to: activation.to
    }
  };
}

function applyKeyPointUpgrades(
  state: BoardState,
  player: string,
  context: BoardRulesContext,
  action: Extract<ReplayBoardAction, { type: 'setup' }>
): Set<string> {
  const raised = new Set<string>();
  for (const point of context.map.keyPoints) {
    const unit = state.units.find((candidate) => candidate.player === player && coordKey(candidate) === coordKey(point));
    if (!unit) continue;
    const rules = requireUnitRules(unit, context);
    if (point.stat === 'range' && !rules.canUpgradeRange) continue;
    unit[point.stat] += 1;
    raised.add(upgradeKey(unit.id, point.stat));
    action.keyPointUpgrades.push({ target: unit.id, stat: point.stat, to: unit[point.stat], keyPoint: point.id });
  }
  return raised;
}

function applyPaidUpgrades(
  state: BoardState,
  input: BoardActionInputBase & { action: SetupInput },
  deckResult: DeckTurnResult,
  context: BoardRulesContext,
  raised: Set<string>,
  action: Extract<ReplayBoardAction, { type: 'setup' }>
): void {
  const spent: Record<string, number> = {};
  for (const upgrade of input.action.upgrades) {
    const unit = findUnit(state, upgrade.target);
    if (!unit) throw new Error(`${input.stepId}: upgrade references missing target ${upgrade.target}`);
    if (unit.player !== input.player) throw new Error(`${input.stepId}: upgrade target ${upgrade.target} is not a ${input.player} unit`);
    const rules = requireUnitRules(unit, context);
    if (upgrade.stat === 'range' && !rules.canUpgradeRange) throw new Error(`${input.stepId}: ${unit.id} cannot upgrade range`);
    const key = upgradeKey(unit.id, upgrade.stat);
    if (raised.has(key)) throw new Error(`${input.stepId}: ${unit.id} ${upgrade.stat} can only be raised once per round`);
    if (upgrade.to !== unit[upgrade.stat] + 1) {
      throw new Error(`${input.stepId}: ${unit.id} ${upgrade.stat} must increase from ${unit[upgrade.stat]} to ${unit[upgrade.stat] + 1}`);
    }
    const lane = symbolLane(unit.type, upgrade.stat);
    spent[lane] = (spent[lane] ?? 0) + upgrade.to;
    const available = deckResult.produced[lane] ?? 0;
    if (spent[lane] > available) throw new Error(`${input.stepId}: upgrades spend ${spent[lane]} ${lane}, exceeding produced ${available}`);
    unit[upgrade.stat] = upgrade.to;
    raised.add(key);
    action.upgrades.push(upgrade);
  }
  assertNoAffordableUpgrade(state, input, deckResult, context, raised, spent);
}

function assertNoAffordableUpgrade(
  state: BoardState,
  input: BoardActionInputBase & { action: SetupInput },
  deckResult: DeckTurnResult,
  context: BoardRulesContext,
  raised: Set<string>,
  spent: Record<string, number>
): void {
  const stats: Array<'attack' | 'movement' | 'range'> = ['attack', 'movement', 'range'];
  for (const unit of state.units.filter((candidate) => candidate.player === input.player)) {
    const rules = requireUnitRules(unit, context);
    for (const stat of stats) {
      if (stat === 'range' && !rules.canUpgradeRange) continue;
      if (raised.has(upgradeKey(unit.id, stat))) continue;
      const lane = symbolLane(unit.type, stat);
      const remaining = (deckResult.produced[lane] ?? 0) - (spent[lane] ?? 0);
      const cost = unit[stat] + 1;
      if (cost <= remaining) {
        throw new Error(`${input.stepId}: affordable upgrade remains for ${unit.id} ${stat} at cost ${cost} ${lane}`);
      }
    }
  }
}

function advanceActivation(state: BoardState, player: string): void {
  const opponent = state.players.find((candidate) => candidate !== player);
  if (!opponent) throw new Error(`board roster has no opponent for ${player}`);
  if (hasUnactivatedUnit(state, opponent)) {
    state.turn.activePlayer = opponent;
    return;
  }
  if (hasUnactivatedUnit(state, player)) {
    state.turn.activePlayer = player;
    return;
  }

  const nextInitiative = state.players.find((candidate) => candidate !== state.turn.initiativePlayer);
  if (!nextInitiative) throw new Error(`board roster has no next initiative player`);
  state.turn = {
    round: state.turn.round + 1,
    phase: 'setup',
    initiativePlayer: nextInitiative,
    activePlayer: nextInitiative,
    completedSetupPlayers: [],
    activatedUnitIds: []
  };
}

function hasUnactivatedUnit(state: BoardState, player: string): boolean {
  return state.units.some((unit) => unit.player === player && !state.turn.activatedUnitIds.includes(unit.id));
}

function setupOrder(state: BoardState): string[] {
  const opponent = state.players.find((player) => player !== state.turn.initiativePlayer);
  if (!opponent) throw new Error(`board roster has no opponent for ${state.turn.initiativePlayer}`);
  return [state.turn.initiativePlayer, opponent];
}

function armyEliminated(state: BoardState): boolean {
  return state.players.some((player) => !state.units.some((unit) => unit.player === player));
}

function movementDistance(
  state: BoardState,
  map: BoardMap,
  moving: BoardUnit,
  from: { col: number; row: number },
  to: { col: number; row: number },
  stepId: string
): number {
  const occupant = state.units.find((unit) => unit.id !== moving.id && coordKey(unit) === coordKey(to));
  if (occupant) throw new Error(`${stepId}: ${moving.id} cannot move to occupied hex ${coordKey(to)} containing ${occupant.id}`);
  const movementMap = mapWithUnitsBlocked(map, state.units.filter((unit) => unit.id !== moving.id));
  const distance = mapDistance(movementMap, from, to);
  if (distance === null) throw new Error(`${stepId}: ${moving.id} movement uses an invalid map path ${coordKey(from)} -> ${coordKey(to)}`);
  return distance;
}

function mapWithUnitsBlocked(map: BoardMap, units: BoardUnit[]): BoardMap {
  const blocked = new Map(map.blocked.map((coord) => [coordKey(coord), coord]));
  for (const unit of units) blocked.set(coordKey(unit), { col: unit.col, row: unit.row });
  return boardMapSchema.parse({ ...map, blocked: [...blocked.values()] });
}

function requireUnitRules(unit: BoardUnit, context: BoardRulesContext): UnitRules[string] {
  const rules = context.units[unit.type];
  if (!rules) throw new Error(`${unit.id} has unknown unit type ${unit.type}`);
  return rules;
}

function findUnit(state: BoardState, id: string): BoardUnit | undefined {
  return state.units.find((unit) => unit.id === id);
}

function symbolLane(type: string, stat: 'attack' | 'movement' | 'range'): string {
  return `${type}${stat[0]?.toUpperCase() ?? ''}${stat.slice(1)}`;
}

function upgradeKey(target: string, stat: string): string {
  return `${target}:${stat}`;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

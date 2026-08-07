import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { hexDistance, lineOfSight, mapDistance } from '../board/coordinates';
import { boardMapSchema, boardStateSchema, coordKey, unitRulesSchema, validateSkirmishMap, type BoardMap, type BoardState, type UnitRules } from '../board/schema';
import {
  replayActivationInputSchema,
  replayBoardActionsSchema,
  replayUpgradeActionSchema,
  type ReplayBoardActions
} from '../replay/schema';
import { deckTurnResultSchema, type DeckTurnResult } from './deckTurn';

const setupRulesSchema = z.object({ unitsPerPlayer: z.number().int().positive() }).strict();

const boardTurnActionsSchema = z.object({
  upgrades: z.array(replayUpgradeActionSchema).default([]),
  activations: z.array(replayActivationInputSchema).default([])
}).strict();

export const boardTurnInputSchema = z.object({
  schemaVersion: z.literal(1),
  turnId: z.string().min(1),
  player: z.string().min(1),
  actions: boardTurnActionsSchema
}).strict();

export const boardTurnResultSchema = z.object({
  schemaVersion: z.literal(1),
  turnId: z.string().min(1),
  player: z.string().min(1),
  before: z.string().min(1),
  after: z.string().min(1),
  actions: replayBoardActionsSchema
}).strict();

export type BoardTurnInput = z.infer<typeof boardTurnInputSchema>;
export type BoardTurnResult = z.infer<typeof boardTurnResultSchema>;
export type BoardUnit = BoardState['units'][number];

export interface BoardRulesContext {
  map: BoardMap;
  units: UnitRules;
  setup: z.infer<typeof setupRulesSchema>;
}

export interface ExecuteBoardTurnOptions { beforePath: string; afterPath: string }
export interface ExecutedBoardTurn { before: BoardState; after: BoardState; result: BoardTurnResult }

export async function readBoardTurnInput(path: string): Promise<BoardTurnInput> {
  return boardTurnInputSchema.parse(JSON.parse(await readFile(path, 'utf8')) as unknown);
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

export function executeBoardTurn(
  beforeState: BoardState,
  deckResult: DeckTurnResult,
  input: BoardTurnInput,
  context: BoardRulesContext,
  options: ExecuteBoardTurnOptions
): ExecutedBoardTurn {
  const before = boardStateSchema.parse(cloneJson(beforeState));
  const after = boardStateSchema.parse(cloneJson(beforeState));
  if (input.turnId !== deckResult.turnId) throw new Error(`board turn ${input.turnId} does not match deck result ${deckResult.turnId}`);
  if (input.player !== deckResult.player) throw new Error(`board player ${input.player} does not match deck result player ${deckResult.player}`);
  if (before.turn.activePlayer !== input.player) throw new Error(`board active player is ${before.turn.activePlayer}, expected ${input.player}`);
  if (!before.players.includes(input.player)) throw new Error(`board roster does not include ${input.player}`);
  if (context.map.id !== before.map) throw new Error(`rules context map is ${context.map.id}, expected ${before.map}`);

  const resultActions: ReplayBoardActions = { keyPointUpgrades: [], upgrades: [], activations: [] };
  const raised = applyKeyPointUpgrades(after, input.player, context, resultActions);
  applyPaidUpgrades(after, input, deckResult, context, raised, resultActions);
  applyActivations(after, input, context, resultActions);
  advanceTurn(after);

  return {
    before,
    after: boardStateSchema.parse(after),
    result: {
      schemaVersion: 1,
      turnId: input.turnId,
      player: input.player,
      before: options.beforePath,
      after: options.afterPath,
      actions: resultActions
    }
  };
}

function applyKeyPointUpgrades(state: BoardState, player: string, context: BoardRulesContext, result: ReplayBoardActions): Set<string> {
  const raised = new Set<string>();
  for (const point of context.map.keyPoints) {
    const unit = state.units.find((candidate) => candidate.player === player && coordKey(candidate) === coordKey(point));
    if (!unit) continue;
    const rules = requireUnitRules(unit, context);
    if (point.stat === 'range' && !rules.canUpgradeRange) continue;
    unit[point.stat] += 1;
    raised.add(upgradeKey(unit.id, point.stat));
    result.keyPointUpgrades.push({ target: unit.id, stat: point.stat, to: unit[point.stat], keyPoint: point.id });
  }
  return raised;
}

function applyPaidUpgrades(
  state: BoardState,
  input: BoardTurnInput,
  deckResult: DeckTurnResult,
  context: BoardRulesContext,
  raised: Set<string>,
  result: ReplayBoardActions
): void {
  const spent: Record<string, number> = {};
  for (const upgrade of input.actions.upgrades) {
    const unit = findUnit(state, upgrade.target);
    if (!unit) throw new Error(`${input.turnId}: upgrade references missing target ${upgrade.target}`);
    if (unit.player !== input.player) throw new Error(`${input.turnId}: upgrade target ${upgrade.target} is not a ${input.player} unit`);
    const rules = requireUnitRules(unit, context);
    if (upgrade.stat === 'range' && !rules.canUpgradeRange) throw new Error(`${input.turnId}: ${unit.id} cannot upgrade range`);
    const key = upgradeKey(unit.id, upgrade.stat);
    if (raised.has(key)) throw new Error(`${input.turnId}: ${unit.id} ${upgrade.stat} can only be raised once per turn`);
    if (upgrade.to !== unit[upgrade.stat] + 1) {
      throw new Error(`${input.turnId}: ${unit.id} ${upgrade.stat} must increase from ${unit[upgrade.stat]} to ${unit[upgrade.stat] + 1}`);
    }
    const lane = symbolLane(unit.type, upgrade.stat);
    spent[lane] = (spent[lane] ?? 0) + upgrade.to;
    const available = produced(deckResult, lane);
    if ((spent[lane] ?? 0) > available) {
      throw new Error(`${input.turnId}: upgrades spend ${spent[lane]} ${lane}, exceeding produced ${available}`);
    }
    unit[upgrade.stat] = upgrade.to;
    raised.add(key);
    result.upgrades.push(upgrade);
  }
}

function applyActivations(state: BoardState, input: BoardTurnInput, context: BoardRulesContext, result: ReplayBoardActions): void {
  const activated = new Set<string>();
  for (const activation of input.actions.activations) {
    if (activated.has(activation.unit)) throw new Error(`${input.turnId}: ${activation.unit} has multiple activations`);
    activated.add(activation.unit);
    const unit = findUnit(state, activation.unit);
    if (!unit) throw new Error(`${input.turnId}: activation references missing unit ${activation.unit}`);
    if (unit.player !== input.player) throw new Error(`${input.turnId}: ${unit.id} cannot activate during ${input.player}'s turn`);
    if (coordKey(unit) !== coordKey(activation.from)) {
      throw new Error(`${input.turnId}: ${unit.id} activation from ${coordKey(activation.from)} does not match current position ${coordKey(unit)}`);
    }
    const via = activation.via ?? activation.from;
    const firstDistance = movementDistance(state, context.map, unit, activation.from, via, input.turnId);
    unit.col = via.col;
    unit.row = via.row;

    let attackResult: ReplayBoardActions['activations'][number]['attack'];
    if (activation.attack) {
      const target = findUnit(state, activation.attack.target);
      if (!target) throw new Error(`${input.turnId}: attack references missing target ${activation.attack.target}`);
      if (target.player === input.player) throw new Error(`${input.turnId}: ${unit.id} attacks friendly unit ${target.id}`);
      const distance = hexDistance(unit, target, context.map.coordinateSystem);
      if (distance > unit.range) throw new Error(`${input.turnId}: ${unit.id} attacked ${target.id} at range ${distance}, exceeding range ${unit.range}`);
      if (unit.range > 1 && !lineOfSight(context.map, unit, target)) throw new Error(`${input.turnId}: ${unit.id} has no line of sight to ${target.id}`);
      const damage = unit.attack;
      target.hp -= damage;
      const targetRemoved = target.hp <= 0;
      attackResult = { target: target.id, damage, targetRemoved };
      if (targetRemoved) state.units = state.units.filter((candidate) => candidate.id !== target.id);
    }

    const secondDistance = movementDistance(state, context.map, unit, via, activation.to, input.turnId);
    if (firstDistance + secondDistance > unit.movement) {
      throw new Error(`${input.turnId}: ${unit.id} moved ${firstDistance + secondDistance}, exceeding movement ${unit.movement}`);
    }
    unit.col = activation.to.col;
    unit.row = activation.to.row;
    result.activations.push({
      unit: unit.id,
      from: activation.from,
      ...(activation.via ? { via: activation.via } : {}),
      ...(attackResult ? { attack: attackResult } : {}),
      to: activation.to
    });
  }
}

function movementDistance(state: BoardState, map: BoardMap, moving: BoardUnit, from: { col: number; row: number }, to: { col: number; row: number }, turnId: string): number {
  const occupant = state.units.find((unit) => unit.id !== moving.id && coordKey(unit) === coordKey(to));
  if (occupant) throw new Error(`${turnId}: ${moving.id} cannot move to occupied hex ${coordKey(to)} containing ${occupant.id}`);
  const movementMap = mapWithUnitsBlocked(map, state.units.filter((unit) => unit.id !== moving.id));
  const distance = mapDistance(movementMap, from, to);
  if (distance === null) throw new Error(`${turnId}: ${moving.id} movement uses an invalid map path ${coordKey(from)} -> ${coordKey(to)}`);
  return distance;
}

function mapWithUnitsBlocked(map: BoardMap, units: BoardUnit[]): BoardMap {
  const blocked = new Map(map.blocked.map((coord) => [coordKey(coord), coord]));
  for (const unit of units) blocked.set(coordKey(unit), { col: unit.col, row: unit.row });
  return boardMapSchema.parse({ ...map, blocked: [...blocked.values()] });
}

function advanceTurn(state: BoardState): void {
  const currentIndex = state.players.indexOf(state.turn.activePlayer);
  if (currentIndex < 0) throw new Error(`board roster is missing active player ${state.turn.activePlayer}`);
  const nextIndex = (currentIndex + 1) % state.players.length;
  const activePlayer = state.players[nextIndex];
  if (!activePlayer) throw new Error('board roster has no next player');
  state.turn = { activePlayer, round: state.turn.round + (nextIndex === 0 ? 1 : 0) };
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

function produced(result: DeckTurnResult, key: string): number {
  return result.produced[key] ?? 0;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

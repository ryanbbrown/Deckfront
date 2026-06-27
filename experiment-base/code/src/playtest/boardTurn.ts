import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { mapDistance } from '../board/coordinates';
import { boardMapSchema, boardStateSchema, coordKey, unitRulesSchema, type BoardMap, type BoardState, type UnitRules } from '../board/schema';
import {
  replayBoardActionsSchema,
  replayHealActionSchema,
  replayMovementActionSchema,
  replayRecruitActionSchema,
  replayUpgradeActionSchema,
  type ReplayBoardActions
} from '../replay/schema';
import { deckTurnResultSchema, type DeckTurnResult } from './deckTurn';
import { incomeForCenterCount, recruitCostForRuleset, supplyForPlayer } from './run';

const boardAttackInputSchema = z
  .object({
    attacker: z.string().min(1),
    target: z.string().min(1),
    deckDamage: z.number().int().nonnegative().default(0)
  })
  .strict();

const boardTurnActionsSchema = z
  .object({
    movements: z.array(replayMovementActionSchema).default([]),
    recruits: z.array(replayRecruitActionSchema).default([]),
    attacks: z.array(boardAttackInputSchema).default([]),
    heals: z.array(replayHealActionSchema).default([]),
    upgrades: z.array(replayUpgradeActionSchema).default([])
  })
  .strict();

export const boardTurnInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    turnId: z.string().min(1),
    player: z.string().min(1),
    actions: boardTurnActionsSchema
  })
  .strict();

export const boardTurnResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    turnId: z.string().min(1),
    player: z.string().min(1),
    before: z.string().min(1),
    after: z.string().min(1),
    actions: replayBoardActionsSchema
  })
  .strict();

export type BoardTurnInput = z.infer<typeof boardTurnInputSchema>;
export type BoardTurnResult = z.infer<typeof boardTurnResultSchema>;

export interface BoardRulesContext {
  map: BoardMap;
  units: UnitRules;
}

export interface ExecuteBoardTurnOptions {
  beforePath: string;
  afterPath: string;
}

export interface ExecutedBoardTurn {
  before: BoardState;
  after: BoardState;
  result: BoardTurnResult;
}

type BoardUnit = BoardState['units'][number];

export async function readBoardTurnInput(path: string): Promise<BoardTurnInput> {
  return boardTurnInputSchema.parse(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

export async function readDeckTurnResult(path: string): Promise<DeckTurnResult> {
  return deckTurnResultSchema.parse(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

export async function loadBoardRulesContext(board: BoardState): Promise<BoardRulesContext> {
  const [mapRaw, unitsRaw] = await Promise.all([
    JSON.parse(await readFile('game/map.json', 'utf8')) as unknown,
    JSON.parse(await readFile('game/units.json', 'utf8')) as unknown
  ]);
  return {
    map: boardMapSchema.parse(mapRaw),
    units: unitRulesSchema.parse(unitsRaw)
  };
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
  const resultActions: ReplayBoardActions = {
    movements: [],
    recruits: [],
    attacks: [],
    heals: [],
    upgrades: []
  };

  if (input.turnId !== deckResult.turnId) {
    throw new Error(`board turn ${input.turnId} does not match deck result ${deckResult.turnId}`);
  }
  if (input.player !== deckResult.player) {
    throw new Error(`board player ${input.player} does not match deck result player ${deckResult.player}`);
  }
  if (before.turn.activePlayer !== input.player) {
    throw new Error(`board active player is ${before.turn.activePlayer}, expected ${input.player}`);
  }
  if (context.map.id !== before.map) {
    throw new Error(`rules context map is ${context.map.id}, expected ${before.map}`);
  }

  addIncome(after, input.player);
  applyMovements(after, input, context, resultActions);
  updateSupplyControl(after, input.player, context.map);
  applyUpgrades(after, input, deckResult, resultActions);
  const attackUse = applyAttacks(after, input, deckResult, context, resultActions);
  applyHeals(after, input, deckResult, context, attackUse, resultActions);
  applyRecruits(after, input, context, resultActions);
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

function addIncome(state: BoardState, player: string): void {
  const supply = state.supply.find((entry) => entry.player === player);
  if (!supply) {
    throw new Error(`board supply is missing active player ${player}`);
  }
  const centers = state.supplyControl.filter((center) => center.controller === player).length;
  supply.amount += incomeForCenterCount(state.ruleset, centers);
}

function applyMovements(state: BoardState, input: BoardTurnInput, context: BoardRulesContext, resultActions: ReplayBoardActions): void {
  const moved = new Set<string>();
  for (const movement of input.actions.movements) {
    if (moved.has(movement.unit)) {
      throw new Error(`${input.turnId}: ${movement.unit} has multiple movement actions`);
    }
    moved.add(movement.unit);

    const unit = findUnit(state, movement.unit);
    if (!unit) {
      throw new Error(`${input.turnId}: movement references missing unit ${movement.unit}`);
    }
    if (unit.player !== input.player) {
      throw new Error(`${input.turnId}: ${movement.unit} cannot move during ${input.player}'s turn`);
    }
    if (coordKey(unit) !== coordKey(movement.from)) {
      throw new Error(`${input.turnId}: ${movement.unit} movement from ${coordKey(movement.from)} does not match current position ${coordKey(unit)}`);
    }
    const occupant = state.units.find((candidate) => candidate.id !== unit.id && coordKey(candidate) === coordKey(movement.to));
    if (occupant) {
      throw new Error(`${input.turnId}: ${movement.unit} cannot move to occupied hex ${coordKey(movement.to)} containing ${occupant.id}`);
    }
    const rules = context.units[unit.type];
    if (!rules) {
      throw new Error(`${input.turnId}: ${unit.id} has unknown unit type ${unit.type}`);
    }
    const movementMap = mapWithEnemyBlocked(context.map, state.units.filter((candidate) => candidate.player !== input.player));
    const distance = mapDistance(movementMap, movement.from, movement.to);
    if (distance === null) {
      throw new Error(`${input.turnId}: ${movement.unit} movement uses an invalid map path ${coordKey(movement.from)} -> ${coordKey(movement.to)}`);
    }
    if (distance > rules.movement) {
      throw new Error(`${input.turnId}: ${movement.unit} moved ${distance}, exceeding movement ${rules.movement}`);
    }
    unit.col = movement.to.col;
    unit.row = movement.to.row;
    resultActions.movements.push(movement);
  }
}

function updateSupplyControl(state: BoardState, player: string, map: BoardMap): void {
  for (const center of map.supplyCenters) {
    const activeUnitOnCenter = state.units.find((unit) => unit.player === player && unit.col === center.col && unit.row === center.row);
    if (!activeUnitOnCenter) {
      continue;
    }
    const control = state.supplyControl.find((entry) => entry.id === center.id);
    if (!control) {
      state.supplyControl.push({ id: center.id, controller: player });
    } else {
      control.controller = player;
    }
  }
}

function applyUpgrades(state: BoardState, input: BoardTurnInput, deckResult: DeckTurnResult, resultActions: ReplayBoardActions): void {
  let attackUsed = 0;
  let healthUsed = 0;
  for (const upgrade of input.actions.upgrades) {
    if (upgrade.attack === 0 && upgrade.maxHp === 0) {
      throw new Error(`${input.turnId}: upgrade for ${upgrade.target} has no effect`);
    }
    const target = findUnit(state, upgrade.target);
    if (!target) {
      throw new Error(`${input.turnId}: upgrade references missing target ${upgrade.target}`);
    }
    if (target.player !== input.player) {
      throw new Error(`${input.turnId}: upgrade target ${upgrade.target} is not a ${input.player} unit`);
    }
    attackUsed += upgrade.attack;
    healthUsed += upgrade.maxHp;
    if (attackUsed > produced(deckResult, 'upgradeDamage')) {
      throw new Error(`${input.turnId}: upgrades use ${attackUsed} attack upgrades, exceeding produced upgradeDamage ${produced(deckResult, 'upgradeDamage')}`);
    }
    if (healthUsed > produced(deckResult, 'upgradeHealth')) {
      throw new Error(`${input.turnId}: upgrades use ${healthUsed} health upgrades, exceeding produced upgradeHealth ${produced(deckResult, 'upgradeHealth')}`);
    }
    target.attack += upgrade.attack;
    target.maxHp += upgrade.maxHp;
    target.hp += upgrade.maxHp;
    resultActions.upgrades.push(upgrade);
  }
}

interface AttackUse {
  attacksByAttacker: Map<string, number>;
}

function applyAttacks(state: BoardState, input: BoardTurnInput, deckResult: DeckTurnResult, context: BoardRulesContext, resultActions: ReplayBoardActions): AttackUse {
  const attacksByAttacker = new Map<string, number>();
  const deckDamageByAttacker = new Map<string, number>();
  let totalDeckDamage = 0;

  for (const attack of input.actions.attacks) {
    const attacker = findUnit(state, attack.attacker);
    const target = findUnit(state, attack.target);
    if (!attacker) {
      throw new Error(`${input.turnId}: attack references missing attacker ${attack.attacker}`);
    }
    if (!target) {
      throw new Error(`${input.turnId}: attack references missing target ${attack.target}`);
    }
    if (attacker.player !== input.player) {
      throw new Error(`${input.turnId}: ${attack.attacker} cannot attack during ${input.player}'s turn`);
    }
    if (target.player === input.player) {
      throw new Error(`${input.turnId}: ${attack.attacker} attacks friendly unit ${attack.target}`);
    }
    const rules = context.units[attacker.type];
    if (!rules) {
      throw new Error(`${input.turnId}: ${attacker.id} has unknown unit type ${attacker.type}`);
    }
    const range = rules.range ?? 1;
    const distance = mapDistance(context.map, attacker, target);
    if (distance === null) {
      throw new Error(`${input.turnId}: ${attack.attacker} attack to ${attack.target} uses invalid map coordinates`);
    }
    if (distance > range) {
      throw new Error(`${input.turnId}: ${attack.attacker} ${attacker.type} attacked ${attack.target} at range ${distance}, exceeding range ${range}`);
    }

    const nextDeckDamageForAttacker = (deckDamageByAttacker.get(attacker.id) ?? 0) + attack.deckDamage;
    if (state.ruleset.includes('damagecap') && nextDeckDamageForAttacker > 1) {
      throw new Error(`${input.turnId}: ${attacker.id} used ${nextDeckDamageForAttacker} deck damage under damage cap`);
    }
    deckDamageByAttacker.set(attacker.id, nextDeckDamageForAttacker);
    totalDeckDamage += attack.deckDamage;
    if (totalDeckDamage > produced(deckResult, 'damage')) {
      throw new Error(`${input.turnId}: attacks use ${totalDeckDamage} deck damage, exceeding produced damage ${produced(deckResult, 'damage')}`);
    }

    const attackCount = (attacksByAttacker.get(attacker.id) ?? 0) + 1;
    attacksByAttacker.set(attacker.id, attackCount);
    const extraAttacks = Array.from(attacksByAttacker.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
    if (extraAttacks > produced(deckResult, 'reattack')) {
      throw new Error(`${input.turnId}: attacks require ${extraAttacks} reattacks, exceeding produced reattack ${produced(deckResult, 'reattack')}`);
    }

    const damage = Math.min(target.hp, attacker.attack + attack.deckDamage);
    if (damage <= 0) {
      throw new Error(`${input.turnId}: attack against ${target.id} has no effect`);
    }
    target.hp -= damage;
    const targetRemoved = target.hp <= 0;
    resultActions.attacks.push({ attacker: attacker.id, target: target.id, damage, deckDamage: attack.deckDamage, targetRemoved });
    if (targetRemoved) {
      state.units = state.units.filter((unit) => unit.id !== target.id);
    }
  }

  return { attacksByAttacker };
}

function applyHeals(
  state: BoardState,
  input: BoardTurnInput,
  deckResult: DeckTurnResult,
  context: BoardRulesContext,
  attackUse: AttackUse,
  resultActions: ReplayBoardActions
): void {
  let deckHealing = 0;
  const printedHealingByHealer = new Map<string, number>();

  for (const heal of input.actions.heals) {
    const target = findUnit(state, heal.target);
    if (!target) {
      throw new Error(`${input.turnId}: heal references missing target ${heal.target}`);
    }
    if (target.player !== input.player) {
      throw new Error(`${input.turnId}: heal target ${heal.target} is not a living ${input.player} unit`);
    }
    if (heal.source === 'deck') {
      if (heal.healer) {
        throw new Error(`${input.turnId}: deck heal for ${heal.target} should not name unit healer ${heal.healer}`);
      }
      deckHealing += heal.amount;
      if (deckHealing > produced(deckResult, 'heal')) {
        throw new Error(`${input.turnId}: heals use ${deckHealing} deck healing, exceeding produced heal ${produced(deckResult, 'heal')}`);
      }
    } else {
      if (!heal.healer) {
        throw new Error(`${input.turnId}: unit heal for ${heal.target} is missing healer`);
      }
      const healer = findUnit(state, heal.healer);
      if (!healer) {
        throw new Error(`${input.turnId}: unit heal references missing healer ${heal.healer}`);
      }
      if (healer.player !== input.player) {
        throw new Error(`${input.turnId}: ${heal.healer} cannot heal during ${input.player}'s turn`);
      }
      if (attackUse.attacksByAttacker.has(healer.id)) {
        throw new Error(`${input.turnId}: ${healer.id} cannot both attack and use printed healing`);
      }
      const rules = context.units[healer.type];
      const printedHeal = rules?.heal ?? 0;
      const totalHealed = (printedHealingByHealer.get(healer.id) ?? 0) + heal.amount;
      if (totalHealed > printedHeal) {
        throw new Error(`${input.turnId}: ${healer.id} healed ${totalHealed}, exceeding printed heal ${printedHeal}`);
      }
      printedHealingByHealer.set(healer.id, totalHealed);
      const range = rules?.range ?? 1;
      const distance = mapDistance(context.map, healer, target);
      if (distance === null) {
        throw new Error(`${input.turnId}: ${healer.id} heal to ${target.id} uses invalid map coordinates`);
      }
      if (distance > range) {
        throw new Error(`${input.turnId}: ${healer.id} healed ${target.id} at range ${distance}, exceeding range ${range}`);
      }
    }

    target.hp = Math.min(target.maxHp, target.hp + heal.amount);
    resultActions.heals.push(heal);
  }
}

function applyRecruits(state: BoardState, input: BoardTurnInput, context: BoardRulesContext, resultActions: ReplayBoardActions): void {
  const supply = state.supply.find((entry) => entry.player === input.player);
  if (!supply) {
    throw new Error(`board supply is missing active player ${input.player}`);
  }
  if (state.ruleset.includes('recruitcap') && input.actions.recruits.length > 1) {
    throw new Error(`${input.turnId}: recruitcap rulesets allow at most 1 recruit per turn`);
  }
  const cost = recruitCostForRuleset(state.ruleset);
  const activeHomeHexes = new Set(context.map.homeBases.filter((homeBase) => homeBase.player === input.player).flatMap((homeBase) => homeBase.hexes.map(coordKey)));
  const recruitedIds = new Set<string>();

  for (const recruit of input.actions.recruits) {
    if (recruitedIds.has(recruit.unit) || findUnit(state, recruit.unit)) {
      throw new Error(`${input.turnId}: recruit ${recruit.unit} already exists`);
    }
    recruitedIds.add(recruit.unit);
    const rules = context.units[recruit.type];
    if (!rules) {
      throw new Error(`${input.turnId}: recruit ${recruit.unit} has unknown type ${recruit.type}`);
    }
    if (!activeHomeHexes.has(coordKey(recruit.at))) {
      throw new Error(`${input.turnId}: recruit ${recruit.unit} entered outside ${input.player}'s home base at ${coordKey(recruit.at)}`);
    }
    const occupant = state.units.find((unit) => coordKey(unit) === coordKey(recruit.at));
    if (occupant) {
      throw new Error(`${input.turnId}: recruit ${recruit.unit} entered occupied hex ${coordKey(recruit.at)} containing ${occupant.id}`);
    }
    if (supply.amount < cost) {
      throw new Error(`${input.turnId}: ${input.player} has ${supply.amount} supply, cannot recruit ${recruit.unit} for ${cost}`);
    }
    supply.amount -= cost;
    state.units.push({
      id: recruit.unit,
      player: input.player,
      type: recruit.type,
      col: recruit.at.col,
      row: recruit.at.row,
      hp: rules.hp,
      maxHp: rules.hp,
      attack: rules.attack
    });
    resultActions.recruits.push(recruit);
  }
}

function advanceTurn(state: BoardState): void {
  const players = state.supply.map((entry) => entry.player);
  const currentIndex = players.indexOf(state.turn.activePlayer);
  if (currentIndex === -1) {
    throw new Error(`board supply is missing active player ${state.turn.activePlayer}`);
  }
  const nextIndex = (currentIndex + 1) % players.length;
  state.turn.activePlayer = players[nextIndex] ?? state.turn.activePlayer;
  if (nextIndex === 0) {
    state.turn.round += 1;
  }
}

function findUnit(state: BoardState, unitId: string): BoardUnit | undefined {
  return state.units.find((unit) => unit.id === unitId);
}

function produced(deckResult: DeckTurnResult, key: string): number {
  return deckResult.produced[key] ?? 0;
}

function mapWithEnemyBlocked(map: BoardMap, enemies: BoardUnit[]): BoardMap {
  const blocked = new Map(map.blocked.map((coord) => [coordKey(coord), coord]));
  for (const enemy of enemies) {
    blocked.set(coordKey(enemy), { col: enemy.col, row: enemy.row });
  }
  return { ...map, blocked: Array.from(blocked.values()) };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

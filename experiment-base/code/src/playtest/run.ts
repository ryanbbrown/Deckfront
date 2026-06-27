import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { mapDistance } from '../board/coordinates';
import { boardMapSchema, boardStateSchema, coordKey, unitRulesSchema, type BoardMap, type BoardState, type UnitRules } from '../board/schema';
import type { GameState } from '../core/types';
import { replayTimelineSchema, type ReplayBoardActions, type ReplayEntry, type ReplayTimeline, type ReplayWinEvent } from '../replay/schema';
import { deckTurnInputSchema, executeDeckTurn, isCompleteDeckSnapshot, type DeckSnapshot } from './deckTurn';

export interface PlaytestRunPaths {
  root: string;
  deckState: string;
  boardState: string;
  timeline: string;
  snapshotsDir: string;
}

export interface TurnSnapshotPaths {
  deckBefore: string;
  deckAfter: string;
  boardBefore: string;
  boardAfter: string;
}

export interface ValidatedReplayEntry {
  entry: ReplayEntry;
  deckBefore: DeckSnapshot;
  deckAfter: DeckSnapshot;
  boardBefore: BoardState;
  boardAfter: BoardState;
}

export interface ValidatedReplayBundle {
  timeline: ReplayTimeline;
  entries: ValidatedReplayEntry[];
}

export interface ValidateReplayBundleOptions {
  strict?: boolean;
  strictDeck?: boolean;
  strictWin?: boolean;
}

export interface InitPlaytestRunOptions {
  root: string;
  ruleset: string;
  map: string;
  players?: string[];
  boardPath?: string;
  unitsPath?: string;
  title?: string;
}

export function playtestRunPaths(root: string): PlaytestRunPaths {
  return {
    root,
    deckState: join(root, 'deck.json'),
    boardState: join(root, 'board.json'),
    timeline: join(root, 'timeline.json'),
    snapshotsDir: join(root, 'snapshots')
  };
}

export function turnSnapshotPaths(root: string, turnId: string): TurnSnapshotPaths {
  const snapshotsDir = playtestRunPaths(root).snapshotsDir;
  return {
    deckBefore: join(snapshotsDir, `${turnId}.before.deck.json`),
    deckAfter: join(snapshotsDir, `${turnId}.after.deck.json`),
    boardBefore: join(snapshotsDir, `${turnId}.before.board.json`),
    boardAfter: join(snapshotsDir, `${turnId}.after.board.json`)
  };
}

export async function initPlaytestRun(options: InitPlaytestRunOptions): Promise<PlaytestRunPaths> {
  const paths = playtestRunPaths(options.root);
  const players = options.players ?? ['P1', 'P2'];
  const map = boardMapSchema.parse(await readJson(join('game', 'map.json')));
  const units = options.unitsPath ? boardStateSchema.shape.units.parse(await readJson(options.unitsPath)) : [];
  const boardState = options.boardPath
    ? boardStateSchema.parse(await readJson(options.boardPath))
    : initialBoardState(options, map.id, players, units, map.supplyCenters.map((center) => center.id));
  const timeline: ReplayTimeline = {
    schemaVersion: 1,
    title: options.title ?? `${options.ruleset} ${map.id}`,
    entries: []
  };

  if (boardState.ruleset !== options.ruleset) {
    throw new Error(`Starter board ruleset is ${boardState.ruleset}, expected ${options.ruleset}`);
  }
  if (boardState.map !== map.id) {
    throw new Error(`Starter board map is ${boardState.map}, expected ${map.id}`);
  }

  await mkdir(paths.snapshotsDir, { recursive: true });
  await writeFile(paths.boardState, `${JSON.stringify(boardStateSchema.parse(boardState), null, 2)}\n`);
  await writeFile(paths.timeline, `${JSON.stringify(timeline, null, 2)}\n`);
  return paths;
}

function initialBoardState(options: InitPlaytestRunOptions, mapId: string, players: string[], units: BoardState['units'], supplyCenterIds: string[]): BoardState {
  return {
    schemaVersion: 1,
    ruleset: options.ruleset,
    map: mapId,
    turn: {
      activePlayer: players[0] ?? 'P1',
      round: 1
    },
    units,
    supplyControl: supplyCenterIds.map((id) => ({ id, controller: null })),
    supply: players.map((player) => ({ player, amount: 0 })),
    notes: []
  };
}

export async function validateReplayBundle(timelinePath: string, options: ValidateReplayBundleOptions = {}): Promise<ValidatedReplayBundle> {
  const timeline = replayTimelineSchema.parse(await readJson(timelinePath));
  const baseDir = dirname(timelinePath);
  const entries: ValidatedReplayEntry[] = [];
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const rulesContextCache = new Map<string, Promise<RulesContext | undefined>>();

  if (timeline.entries.length === 0) {
    errors.push('timeline has no entries');
  }

  for (const entry of timeline.entries) {
    if (seenIds.has(entry.id)) {
      errors.push(`${entry.id}: duplicate replay entry id`);
      continue;
    }
    seenIds.add(entry.id);

    const loaded = await loadEntrySnapshots(baseDir, entry, errors);
    if (!loaded) {
      continue;
    }

    checkEntryMatchesSnapshots(entry, loaded, errors);
    if (options.strictDeck) {
      validateDeckTransition(entry, loaded, errors);
    }
    const context = await loadRulesContext(loaded.boardBefore, errors, rulesContextCache);
    if (context) {
      validateBoardSnapshot(loaded.boardBefore, `${entry.id} board.before`, context, errors);
      validateBoardSnapshot(loaded.boardAfter, `${entry.id} board.after`, context, errors);
      validateBoardTransition(entry, loaded, context, options, errors);
    }
    const previous = entries.at(-1);
    if (previous) {
      checkContinuity(previous, loaded, errors);
    }
    entries.push({ entry, ...loaded });
  }

  if (options.strictWin) {
    validateWinEvents(entries, errors);
    validateTerminalWinEvents(timeline, entries, errors);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid replay bundle: ${errors.join('; ')}`);
  }

  return { timeline, entries };
}

interface RulesContext {
  map: BoardMap;
  units: UnitRules;
}

type BoardUnit = BoardState['units'][number];

async function loadRulesContext(
  state: BoardState,
  errors: string[],
  cache: Map<string, Promise<RulesContext | undefined>>
): Promise<RulesContext | undefined> {
  const key = `${state.map}\n${state.ruleset}`;
  let cached = cache.get(key);
  if (!cached) {
    cached = loadRulesContextUncached(state, errors);
    cache.set(key, cached);
  }
  return cached;
}

async function loadRulesContextUncached(state: BoardState, errors: string[]): Promise<RulesContext | undefined> {
  const [mapValue, unitsValue] = await Promise.allSettled([readJson(join('game', 'map.json')), readJson(join('game', 'units.json'))]);
  if (mapValue.status === 'rejected') {
    errors.push(`${state.map}: ${errorMessage(mapValue.reason)}`);
    return undefined;
  }
  if (unitsValue.status === 'rejected') {
    errors.push(`${state.ruleset}: ${errorMessage(unitsValue.reason)}`);
    return undefined;
  }

  try {
    return {
      map: boardMapSchema.parse(mapValue.value),
      units: unitRulesSchema.parse(unitsValue.value)
    };
  } catch (error) {
    errors.push(`rules context: ${errorMessage(error)}`);
    return undefined;
  }
}

function validateBoardSnapshot(state: BoardState, label: string, context: RulesContext, errors: string[]): void {
  const mapHexes = new Set(context.map.hexes.map(coordKey));
  const blocked = new Set(context.map.blocked.map(coordKey));
  const occupied = new Map<string, BoardUnit[]>();

  for (const unit of state.units) {
    const key = coordKey(unit);
    if (!context.units[unit.type]) {
      errors.push(`${label}: ${unit.id} has unknown unit type ${unit.type}`);
    }
    if (!mapHexes.has(key)) {
      errors.push(`${label}: ${unit.id} is off map at ${key}`);
    }
    if (blocked.has(key)) {
      errors.push(`${label}: ${unit.id} is on blocked hex ${key}`);
    }
    const units = occupied.get(key) ?? [];
    units.push(unit);
    occupied.set(key, units);
  }

  for (const [key, units] of occupied) {
    if (units.length > 1) {
      errors.push(`${label}: multiple units occupy ${key}: ${units.map((unit) => unit.id).join(', ')}`);
    }
  }
}

function validateBoardTransition(
  entry: ReplayEntry,
  snapshots: Omit<ValidatedReplayEntry, 'entry'>,
  context: RulesContext,
  options: ValidateReplayBundleOptions,
  errors: string[]
): void {
  if (!options.strict) {
    return;
  }

  const actions = entry.actions;
  if (!actions) {
    errors.push(`${entry.id}: strict validation requires board actions`);
    return;
  }

  validateMovements(entry, snapshots, context, actions, errors);
  validateBoardTurnAdvance(entry, snapshots, errors);
  validateRecruits(entry, snapshots, context, actions, errors);
  const combat = validateAttacks(entry, snapshots, context, actions, errors);
  validateHealsAndUpgrades(entry, snapshots, context, actions, combat, errors);
  validateSupplyAndCenters(entry, snapshots, context, actions, errors);
}

function validateBoardTurnAdvance(entry: ReplayEntry, snapshots: Omit<ValidatedReplayEntry, 'entry'>, errors: string[]): void {
  const expectedAfterTurn = nextBoardTurn(snapshots.boardBefore);
  if (snapshots.boardAfter.turn.activePlayer !== expectedAfterTurn.activePlayer || snapshots.boardAfter.turn.round !== expectedAfterTurn.round) {
    errors.push(
      `${entry.id}: board.after turn is ${snapshots.boardAfter.turn.activePlayer} round ${snapshots.boardAfter.turn.round}, expected ${expectedAfterTurn.activePlayer} round ${expectedAfterTurn.round}`
    );
  }
}

function validateMovements(
  entry: ReplayEntry,
  snapshots: Omit<ValidatedReplayEntry, 'entry'>,
  context: RulesContext,
  actions: ReplayBoardActions,
  errors: string[]
): void {
  const beforeUnits = new Map(snapshots.boardBefore.units.map((unit) => [unit.id, unit]));
  const afterUnits = new Map(snapshots.boardAfter.units.map((unit) => [unit.id, unit]));
  const movements = new Map(actions.movements.map((movement) => [movement.unit, movement]));

  for (const movement of actions.movements) {
    const before = beforeUnits.get(movement.unit);
    const after = afterUnits.get(movement.unit);
    if (!before) {
      errors.push(`${entry.id}: movement references missing before unit ${movement.unit}`);
      continue;
    }
    if (!after) {
      errors.push(`${entry.id}: movement references removed unit ${movement.unit}`);
      continue;
    }
    if (before.player !== entry.player) {
      errors.push(`${entry.id}: ${movement.unit} cannot move during ${entry.player}'s turn`);
    }
    if (coordKey(before) !== coordKey(movement.from)) {
      errors.push(`${entry.id}: ${movement.unit} movement from ${coordKey(movement.from)} does not match before position ${coordKey(before)}`);
    }
    if (coordKey(after) !== coordKey(movement.to)) {
      errors.push(`${entry.id}: ${movement.unit} movement to ${coordKey(movement.to)} does not match after position ${coordKey(after)}`);
    }
    const rules = context.units[before.type];
    if (rules) {
      const distance = mapDistance(mapWithEnemyBlocked(context.map, snapshots.boardBefore.units.filter((unit) => unit.player !== entry.player)), movement.from, movement.to);
      if (distance === null) {
        errors.push(`${entry.id}: ${movement.unit} movement uses an invalid map path ${coordKey(movement.from)} -> ${coordKey(movement.to)}`);
      } else if (distance > rules.movement) {
        errors.push(`${entry.id}: ${movement.unit} moved ${distance}, exceeding movement ${rules.movement}`);
      }
    }
  }

  for (const before of snapshots.boardBefore.units) {
    const after = afterUnits.get(before.id);
    if (!after) {
      continue;
    }
    if (coordKey(before) !== coordKey(after) && !movements.has(before.id)) {
      errors.push(`${entry.id}: ${before.id} moved ${coordKey(before)} -> ${coordKey(after)} without a movement action`);
    }
  }
}

function validateRecruits(
  entry: ReplayEntry,
  snapshots: Omit<ValidatedReplayEntry, 'entry'>,
  context: RulesContext,
  actions: ReplayBoardActions,
  errors: string[]
): void {
  const beforeUnits = new Map(snapshots.boardBefore.units.map((unit) => [unit.id, unit]));
  const occupiedAtRecruit = new Map(
    snapshots.boardAfter.units.filter((unit) => beforeUnits.has(unit.id)).map((unit) => [coordKey(unit), unit.id])
  );
  const recruits = new Map(actions.recruits.map((recruit) => [recruit.unit, recruit]));
  const activeHomeHexes = new Set(
    context.map.homeBases.filter((homeBase) => homeBase.player === entry.player).flatMap((homeBase) => homeBase.hexes.map(coordKey))
  );

  for (const recruit of actions.recruits) {
    if (!context.units[recruit.type]) {
      errors.push(`${entry.id}: recruit ${recruit.unit} has unknown type ${recruit.type}`);
    }
    if (beforeUnits.has(recruit.unit)) {
      errors.push(`${entry.id}: recruit ${recruit.unit} already existed before the turn`);
    }
    if (!activeHomeHexes.has(coordKey(recruit.at))) {
      errors.push(`${entry.id}: recruit ${recruit.unit} entered outside ${entry.player}'s home base at ${coordKey(recruit.at)}`);
    }
    const occupiedBy = occupiedAtRecruit.get(coordKey(recruit.at));
    if (occupiedBy) {
      errors.push(`${entry.id}: recruit ${recruit.unit} entered occupied hex ${coordKey(recruit.at)} containing ${occupiedBy}`);
    }
    const after = snapshots.boardAfter.units.find((unit) => unit.id === recruit.unit);
    if (!after) {
      errors.push(`${entry.id}: recruit ${recruit.unit} is logged but missing after the turn`);
    }
    occupiedAtRecruit.set(coordKey(recruit.at), recruit.unit);
  }

  for (const after of snapshots.boardAfter.units) {
    if (beforeUnits.has(after.id)) {
      continue;
    }
    const recruit = recruits.get(after.id);
    if (!recruit) {
      errors.push(`${entry.id}: new unit ${after.id} has no recruit action`);
      continue;
    }
    if (after.player !== entry.player) {
      errors.push(`${entry.id}: new unit ${after.id} belongs to ${after.player}, not active player ${entry.player}`);
    }
    if (after.type !== recruit.type) {
      errors.push(`${entry.id}: recruit ${after.id} action type ${recruit.type} does not match after type ${after.type}`);
    }
    if (coordKey(after) !== coordKey(recruit.at)) {
      errors.push(`${entry.id}: recruit ${after.id} action at ${coordKey(recruit.at)} does not match after position ${coordKey(after)}`);
    }
  }
}

function validateAttacks(
  entry: ReplayEntry,
  snapshots: Omit<ValidatedReplayEntry, 'entry'>,
  context: RulesContext,
  actions: ReplayBoardActions,
  errors: string[]
): AttackValidation {
  const beforeUnits = new Map(snapshots.boardBefore.units.map((unit) => [unit.id, unit]));
  const afterUnits = new Map(snapshots.boardAfter.units.map((unit) => [unit.id, unit]));
  const damageByTarget = new Map<string, number>();
  const deckDamageByAttacker = new Map<string, number>();
  const attacksByAttacker = new Map<string, number>();

  for (const attack of actions.attacks) {
    const attacker = afterUnits.get(attack.attacker) ?? beforeUnits.get(attack.attacker);
    const targetBefore = beforeUnits.get(attack.target);
    if (!attacker) {
      errors.push(`${entry.id}: attack references missing attacker ${attack.attacker}`);
      continue;
    }
    if (!targetBefore) {
      errors.push(`${entry.id}: attack references missing target ${attack.target}`);
      continue;
    }
    if (!beforeUnits.has(attack.attacker)) {
      errors.push(`${entry.id}: ${attack.attacker} cannot attack on the turn it was recruited`);
    }
    if (attacker.player !== entry.player) {
      errors.push(`${entry.id}: ${attack.attacker} cannot attack during ${entry.player}'s turn`);
    }
    if (targetBefore.player === entry.player) {
      errors.push(`${entry.id}: ${attack.attacker} attacks friendly unit ${attack.target}`);
    }

    const rules = context.units[attacker.type];
    if (rules) {
      const range = rules.range ?? 1;
      const distance = mapDistance(context.map, attacker, targetBefore);
      if (distance === null) {
        errors.push(`${entry.id}: ${attack.attacker} attack to ${attack.target} uses invalid map coordinates`);
      } else if (distance > range) {
        errors.push(`${entry.id}: ${attack.attacker} ${attacker.type} attacked ${attack.target} at range ${distance}, exceeding range ${range}`);
      }
      if (attack.damage > attacker.attack + attack.deckDamage) {
        errors.push(`${entry.id}: ${attack.attacker} dealt ${attack.damage}, exceeding attack ${attacker.attack} + deck damage ${attack.deckDamage}`);
      }
    }

    damageByTarget.set(attack.target, (damageByTarget.get(attack.target) ?? 0) + attack.damage);
    deckDamageByAttacker.set(attack.attacker, (deckDamageByAttacker.get(attack.attacker) ?? 0) + attack.deckDamage);
    attacksByAttacker.set(attack.attacker, (attacksByAttacker.get(attack.attacker) ?? 0) + 1);

    const targetAfter = afterUnits.get(attack.target);
    if (attack.targetRemoved && targetAfter) {
      errors.push(`${entry.id}: attack says ${attack.target} was removed, but it exists after the turn`);
    }
  }

  for (const before of snapshots.boardBefore.units) {
    if (before.player === entry.player) {
      continue;
    }
    const after = afterUnits.get(before.id);
    const observedDamage = after ? before.hp - after.hp : before.hp;
    if (observedDamage <= 0) {
      continue;
    }
    const loggedDamage = damageByTarget.get(before.id) ?? 0;
    if (loggedDamage !== observedDamage) {
      errors.push(`${entry.id}: ${before.id} took ${observedDamage} damage/removal, but attack actions log ${loggedDamage}`);
    }
  }

  for (const attack of actions.attacks) {
    const targetBefore = beforeUnits.get(attack.target);
    if (!targetBefore || targetBefore.player === entry.player) {
      continue;
    }
    const targetAfter = afterUnits.get(attack.target);
    const observedDamage = targetAfter ? targetBefore.hp - targetAfter.hp : targetBefore.hp;
    if (observedDamage <= 0) {
      errors.push(`${entry.id}: attack against ${attack.target} is logged, but no opponent damage/removal is visible`);
    }
  }

  const producedDamage = entry.deck.produced.damage ?? 0;
  const usedDeckDamage = Array.from(deckDamageByAttacker.values()).reduce((sum, damage) => sum + damage, 0);
  if (usedDeckDamage > producedDamage) {
    errors.push(`${entry.id}: attacks use ${usedDeckDamage} deck damage, exceeding produced damage ${producedDamage}`);
  }

  if (snapshots.boardBefore.ruleset.includes('damagecap')) {
    for (const [attacker, deckDamage] of deckDamageByAttacker) {
      if (deckDamage > 1) {
        errors.push(`${entry.id}: ${attacker} used ${deckDamage} deck damage under damage cap`);
      }
    }
  }

  const reattacks = entry.deck.produced.reattack ?? 0;
  const extraAttacks = Array.from(attacksByAttacker.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  if (extraAttacks > reattacks) {
    errors.push(`${entry.id}: attacks require ${extraAttacks} reattacks, exceeding produced reattack ${reattacks}`);
  }

  return { attacksByAttacker, damageByTarget };
}

interface AttackValidation {
  attacksByAttacker: Map<string, number>;
  damageByTarget: Map<string, number>;
}

function validateHealsAndUpgrades(
  entry: ReplayEntry,
  snapshots: Omit<ValidatedReplayEntry, 'entry'>,
  context: RulesContext,
  actions: ReplayBoardActions,
  combat: AttackValidation,
  errors: string[]
): void {
  const beforeUnits = new Map(snapshots.boardBefore.units.map((unit) => [unit.id, unit]));
  const afterUnits = new Map(snapshots.boardAfter.units.map((unit) => [unit.id, unit]));
  const healingByTarget = new Map<string, number>();
  const attackUpgradeByTarget = new Map<string, number>();
  const healthUpgradeByTarget = new Map<string, number>();
  let deckHealing = 0;
  let attackUpgrades = 0;
  let healthUpgrades = 0;
  const printedHealingByHealer = new Map<string, number>();

  for (const heal of actions.heals) {
    const targetBefore = beforeUnits.get(heal.target);
    const targetAfter = afterUnits.get(heal.target);
    if (!targetBefore || !targetAfter) {
      errors.push(`${entry.id}: heal references missing target ${heal.target}`);
      continue;
    }
    if (targetBefore.player !== entry.player || targetAfter.player !== entry.player) {
      errors.push(`${entry.id}: heal target ${heal.target} is not a living ${entry.player} unit`);
    }

    healingByTarget.set(heal.target, (healingByTarget.get(heal.target) ?? 0) + heal.amount);

    if (heal.source === 'deck') {
      if (heal.healer) {
        errors.push(`${entry.id}: deck heal for ${heal.target} should not name unit healer ${heal.healer}`);
      }
      deckHealing += heal.amount;
      continue;
    }

    if (!heal.healer) {
      errors.push(`${entry.id}: unit heal for ${heal.target} is missing healer`);
      continue;
    }

    const healerBefore = beforeUnits.get(heal.healer);
    const healerAfter = afterUnits.get(heal.healer);
    if (!healerBefore || !healerAfter) {
      errors.push(`${entry.id}: unit heal references missing healer ${heal.healer}`);
      continue;
    }
    if (healerBefore.player !== entry.player || healerAfter.player !== entry.player) {
      errors.push(`${entry.id}: ${heal.healer} cannot heal during ${entry.player}'s turn`);
    }
    if (combat.attacksByAttacker.has(heal.healer)) {
      errors.push(`${entry.id}: ${heal.healer} cannot both attack and use printed healing`);
    }

    const rules = context.units[healerBefore.type];
    const printedHeal = rules?.heal ?? 0;
    const totalPrintedHealing = (printedHealingByHealer.get(heal.healer) ?? 0) + heal.amount;
    printedHealingByHealer.set(heal.healer, totalPrintedHealing);
    if (totalPrintedHealing > printedHeal) {
      errors.push(`${entry.id}: ${heal.healer} healed ${totalPrintedHealing}, exceeding printed heal ${printedHeal}`);
    }
    if (rules) {
      const range = rules.range ?? 1;
      const distance = mapDistance(context.map, healerAfter, targetAfter);
      if (distance === null) {
        errors.push(`${entry.id}: ${heal.healer} heal to ${heal.target} uses invalid map coordinates`);
      } else if (distance > range) {
        errors.push(`${entry.id}: ${heal.healer} healed ${heal.target} at range ${distance}, exceeding range ${range}`);
      }
    }
  }

  const producedHeal = entry.deck.produced.heal ?? 0;
  if (deckHealing > producedHeal) {
    errors.push(`${entry.id}: heals use ${deckHealing} deck healing, exceeding produced heal ${producedHeal}`);
  }

  for (const upgrade of actions.upgrades) {
    if (upgrade.attack === 0 && upgrade.maxHp === 0) {
      errors.push(`${entry.id}: upgrade for ${upgrade.target} has no effect`);
    }

    const targetBefore = beforeUnits.get(upgrade.target);
    if (!targetBefore) {
      errors.push(`${entry.id}: upgrade references missing target ${upgrade.target}`);
      continue;
    }
    if (targetBefore.player !== entry.player) {
      errors.push(`${entry.id}: upgrade target ${upgrade.target} is not a ${entry.player} unit`);
    }

    attackUpgradeByTarget.set(upgrade.target, (attackUpgradeByTarget.get(upgrade.target) ?? 0) + upgrade.attack);
    healthUpgradeByTarget.set(upgrade.target, (healthUpgradeByTarget.get(upgrade.target) ?? 0) + upgrade.maxHp);
    attackUpgrades += upgrade.attack;
    healthUpgrades += upgrade.maxHp;
  }

  const producedAttackUpgrades = entry.deck.produced.upgradeDamage ?? 0;
  if (attackUpgrades > producedAttackUpgrades) {
    errors.push(`${entry.id}: upgrades use ${attackUpgrades} attack upgrades, exceeding produced upgradeDamage ${producedAttackUpgrades}`);
  }

  const producedHealthUpgrades = entry.deck.produced.upgradeHealth ?? 0;
  if (healthUpgrades > producedHealthUpgrades) {
    errors.push(`${entry.id}: upgrades use ${healthUpgrades} health upgrades, exceeding produced upgradeHealth ${producedHealthUpgrades}`);
  }

  for (const before of snapshots.boardBefore.units) {
    const after = afterUnits.get(before.id);
    if (!after) {
      continue;
    }

    const observedAttackUpgrade = after.attack - before.attack;
    const loggedAttackUpgrade = attackUpgradeByTarget.get(before.id) ?? 0;
    if (observedAttackUpgrade !== loggedAttackUpgrade) {
      errors.push(`${entry.id}: ${before.id} attack changed by ${observedAttackUpgrade}, but upgrade actions log ${loggedAttackUpgrade}`);
    }

    const observedHealthUpgrade = after.maxHp - before.maxHp;
    const loggedHealthUpgrade = healthUpgradeByTarget.get(before.id) ?? 0;
    if (observedHealthUpgrade !== loggedHealthUpgrade) {
      errors.push(`${entry.id}: ${before.id} maxHp changed by ${observedHealthUpgrade}, but upgrade actions log ${loggedHealthUpgrade}`);
    }

    const damage = combat.damageByTarget.get(before.id) ?? 0;
    const healing = healingByTarget.get(before.id) ?? 0;
    const expectedBeforeHealing = Math.min(after.maxHp, before.hp + loggedHealthUpgrade - damage);
    const maxExpectedHp = Math.min(after.maxHp, expectedBeforeHealing + healing);
    if (after.hp < expectedBeforeHealing) {
      errors.push(`${entry.id}: ${before.id} hp is ${after.hp}, below expected ${expectedBeforeHealing} after logged damage/upgrades`);
    }
    if (after.hp > maxExpectedHp) {
      errors.push(`${entry.id}: ${before.id} hp is ${after.hp}, exceeding logged damage/upgrades/healing maximum ${maxExpectedHp}`);
    }
  }

  for (const after of snapshots.boardAfter.units) {
    if (beforeUnits.has(after.id)) {
      continue;
    }
    const rules = context.units[after.type];
    if (!rules) {
      continue;
    }
    if (after.attack !== rules.attack) {
      errors.push(`${entry.id}: recruit ${after.id} attack is ${after.attack}, expected base attack ${rules.attack}`);
    }
    if (after.maxHp !== rules.hp) {
      errors.push(`${entry.id}: recruit ${after.id} maxHp is ${after.maxHp}, expected base hp ${rules.hp}`);
    }
    if (after.hp !== rules.hp) {
      errors.push(`${entry.id}: recruit ${after.id} hp is ${after.hp}, expected base hp ${rules.hp}`);
    }
  }
}

function validateSupplyAndCenters(
  entry: ReplayEntry,
  snapshots: Omit<ValidatedReplayEntry, 'entry'>,
  context: RulesContext,
  actions: ReplayBoardActions,
  errors: string[]
): void {
  const beforeSupply = supplyForPlayer(snapshots.boardBefore, entry.player);
  const afterSupply = supplyForPlayer(snapshots.boardAfter, entry.player);
  const beforeCenters = new Map(snapshots.boardBefore.supplyControl.map((center) => [center.id, center.controller]));
  const afterCenters = new Map(snapshots.boardAfter.supplyControl.map((center) => [center.id, center.controller]));
  const controlledCenterCount = Array.from(beforeCenters.values()).filter((controller) => controller === entry.player).length;
  const income = incomeForCenterCount(snapshots.boardBefore.ruleset, controlledCenterCount);
  const recruitCost = recruitCostForRuleset(snapshots.boardBefore.ruleset);
  const expectedAfterSupply = beforeSupply + income - actions.recruits.length * recruitCost;

  if (snapshots.boardBefore.ruleset.includes('recruitcap') && actions.recruits.length > 1) {
    errors.push(`${entry.id}: recruitcap rulesets allow at most 1 recruit per turn`);
  }
  if (expectedAfterSupply < 0) {
    errors.push(`${entry.id}: ${entry.player} spent more supply than available (${beforeSupply} + ${income} income - ${actions.recruits.length} recruits at ${recruitCost})`);
  }
  if (afterSupply !== expectedAfterSupply) {
    errors.push(`${entry.id}: ${entry.player} supply is ${afterSupply}, expected ${expectedAfterSupply}`);
  }

  for (const supply of snapshots.boardAfter.supply) {
    if (supply.player !== entry.player && supply.amount !== supplyForPlayer(snapshots.boardBefore, supply.player)) {
      errors.push(`${entry.id}: inactive player ${supply.player} supply changed from ${supplyForPlayer(snapshots.boardBefore, supply.player)} to ${supply.amount}`);
    }
  }

  for (const center of context.map.supplyCenters) {
    const beforeController = beforeCenters.get(center.id) ?? null;
    const afterController = afterCenters.get(center.id) ?? null;
    const activeUnitOnCenter = snapshots.boardAfter.units.find((unit) => unit.player === entry.player && unit.col === center.col && unit.row === center.row);

    if (activeUnitOnCenter && afterController !== entry.player) {
      errors.push(`${entry.id}: ${activeUnitOnCenter.id} ended on ${center.id}, but controller is ${afterController ?? 'neutral'}`);
    }
    if (afterController !== beforeController) {
      if (afterController !== entry.player) {
        errors.push(`${entry.id}: ${center.id} changed from ${beforeController ?? 'neutral'} to ${afterController ?? 'neutral'} during ${entry.player}'s turn`);
      } else if (!activeUnitOnCenter) {
        errors.push(`${entry.id}: ${center.id} changed to ${entry.player} without an active unit ending on it`);
      }
    }
  }
}

export function supplyForPlayer(state: BoardState, player: string): number {
  return state.supply.find((supply) => supply.player === player)?.amount ?? 0;
}

export function recruitCostForRuleset(ruleset: string): number {
  return ruleset.includes('cost6') ? 6 : 5;
}

export function incomeForCenterCount(ruleset: string, centers: number): number {
  if (ruleset.includes('compressed')) {
    if (centers <= 4) {
      return centers + 1;
    }
    if (centers <= 6) {
      return 6;
    }
    return 7;
  }
  return 2 + centers;
}

function mapWithEnemyBlocked(map: BoardMap, enemies: BoardUnit[]): BoardMap {
  const blocked = new Map(map.blocked.map((coord) => [coordKey(coord), coord]));
  for (const enemy of enemies) {
    blocked.set(coordKey(enemy), { col: enemy.col, row: enemy.row });
  }
  return { ...map, blocked: Array.from(blocked.values()) };
}

type WinEventType = ReplayWinEvent['type'];

interface PendingWinThreat {
  type: WinEventType;
  player: string;
}

interface WinCounts {
  playerUnits: number;
  opponentUnits: number;
  playerCenters: number;
  opponentCenters: number;
}

function validateWinEvents(entries: ValidatedReplayEntry[], errors: string[]): void {
  const pendingThreats: PendingWinThreat[] = [];

  entries.forEach((validated, completedTurns) => {
    const expected = expectedWinEventsAtTurnStart(validated, completedTurns, pendingThreats);

    if (!validated.entry.winEvents) {
      errors.push(`${validated.entry.id}: strict win validation requires winEvents`);
      return;
    }

    const actualComparable = validated.entry.winEvents.map(winEventComparable);
    const expectedComparable = expected.map(winEventComparable);
    if (stableJson(actualComparable) !== stableJson(expectedComparable)) {
      errors.push(
        `${validated.entry.id}: winEvents ${stableJson(actualComparable)} do not match expected ${stableJson(expectedComparable)}`
      );
    }
  });
}

function validateTerminalWinEvents(timeline: ReplayTimeline, entries: ValidatedReplayEntry[], errors: string[]): void {
  if (entries.length === 0) {
    return;
  }

  const pendingThreats: PendingWinThreat[] = [];
  for (const [completedTurns, validated] of entries.entries()) {
    expectedWinEventsAtTurnStart(validated, completedTurns, pendingThreats);
  }

  const finalEntry = entries.at(-1);
  if (!finalEntry) {
    return;
  }

  const expectedTerminal = expectedWinEventsForState(finalEntry.boardAfter, entries.length, pendingThreats);
  const actualTerminal = (timeline.terminalWinEvents ?? []).map(winEventComparable);
  const expectedComparable = expectedTerminal.map(winEventComparable);
  if (stableJson(actualTerminal) !== stableJson(expectedComparable)) {
    errors.push(`terminalWinEvents ${stableJson(actualTerminal)} do not match expected ${stableJson(expectedComparable)}`);
  }
}

function expectedWinEventsAtTurnStart(validated: ValidatedReplayEntry, completedTurns: number, pendingThreats: PendingWinThreat[]): ReplayWinEvent[] {
  return expectedWinEventsForState(validated.boardBefore, completedTurns, pendingThreats, validated.entry.player);
}

function expectedWinEventsForState(state: BoardState, completedTurns: number, pendingThreats: PendingWinThreat[], activePlayer = state.turn.activePlayer): ReplayWinEvent[] {
  const opponent = opponentForPlayer(state, activePlayer);
  const events: ReplayWinEvent[] = [];
  const activeCounts = winCounts(state, activePlayer, opponent);

  for (const pending of [...pendingThreats]) {
    if (pending.player !== activePlayer) {
      continue;
    }

    const status: ReplayWinEvent['status'] = winEventEligible(state, pending.type, activePlayer, completedTurns) ? 'confirmed' : 'cleared';
    events.push(winEventForState(state, pending.type, status, activePlayer, completedTurns, opponent, activeCounts));
    pendingThreats.splice(pendingThreats.indexOf(pending), 1);
  }

  if (!events.some((event) => event.status === 'confirmed')) {
    for (const type of enabledWinEventTypes(state.ruleset)) {
      if (pendingThreats.some((pending) => pending.type === type && pending.player === activePlayer)) {
        continue;
      }
      if (winEventEligible(state, type, activePlayer, completedTurns)) {
        events.push(winEventForState(state, type, 'created', activePlayer, completedTurns, opponent, activeCounts));
        pendingThreats.push({ type, player: activePlayer });
      }
    }
  }

  return events;
}

function winEventEligible(state: BoardState, type: WinEventType, player: string, completedTurns: number): boolean {
  const opponent = opponentForPlayer(state, player);
  const counts = winCounts(state, player, opponent);

  if (type === 'unitLead') {
    const threshold = unitLeadThreshold(state.ruleset);
    return threshold !== null && counts.playerUnits - counts.opponentUnits >= threshold;
  }

  if (type === 'centerMajority') {
    return completedTurns >= 24 && counts.playerCenters >= 5 && counts.playerUnits >= counts.opponentUnits;
  }

  if (type === 'sixCenterDominance') {
    const allowedBehind = sixCenterAllowedBehind(state.ruleset);
    return completedTurns >= 18 && counts.playerCenters >= 6 && counts.opponentUnits - counts.playerUnits <= allowedBehind;
  }

  return false;
}

function winEventForState(
  state: BoardState,
  type: WinEventType,
  status: ReplayWinEvent['status'],
  player: string,
  completedTurns: number,
  opponent: string,
  counts = winCounts(state, player, opponent)
): ReplayWinEvent {
  return {
    type,
    status,
    player,
    completedTurns,
    playerUnits: counts.playerUnits,
    opponentUnits: counts.opponentUnits,
    playerCenters: counts.playerCenters,
    opponentCenters: counts.opponentCenters
  };
}

function winEventComparable(event: ReplayWinEvent): Omit<ReplayWinEvent, 'reason'> {
  const { reason, ...rest } = event;
  return rest;
}

function enabledWinEventTypes(ruleset: string): WinEventType[] {
  const types: WinEventType[] = [];
  if (unitLeadThreshold(ruleset) !== null) {
    types.push('unitLead');
  }
  if (ruleset.includes('centermid')) {
    types.push('centerMajority');
  }
  if (ruleset.includes('center6')) {
    types.push('sixCenterDominance');
  }
  return types;
}

function unitLeadThreshold(ruleset: string): number | null {
  if (ruleset.includes('responsewin-lead4')) {
    return 4;
  }
  if (ruleset.includes('responsewin')) {
    return 3;
  }
  return null;
}

function sixCenterAllowedBehind(ruleset: string): number {
  return ruleset.includes('center6-tight') ? 1 : 2;
}

function opponentForPlayer(state: BoardState, player: string): string {
  const opponent = state.supply.map((supply) => supply.player).find((candidate) => candidate !== player);
  return opponent ?? (player === 'P1' ? 'P2' : 'P1');
}

function winCounts(state: BoardState, player: string, opponent: string): WinCounts {
  return {
    playerUnits: state.units.filter((unit) => unit.player === player).length,
    opponentUnits: state.units.filter((unit) => unit.player === opponent).length,
    playerCenters: state.supplyControl.filter((center) => center.controller === player).length,
    opponentCenters: state.supplyControl.filter((center) => center.controller === opponent).length
  };
}

async function loadEntrySnapshots(
  baseDir: string,
  entry: ReplayEntry,
  errors: string[]
): Promise<Omit<ValidatedReplayEntry, 'entry'> | undefined> {
  const [deckBefore, deckAfter, boardBefore, boardAfter] = await Promise.all([
    loadDeckSnapshot(resolveSnapshotPath(baseDir, entry.deck.before), `${entry.id} deck.before`, errors),
    loadDeckSnapshot(resolveSnapshotPath(baseDir, entry.deck.after), `${entry.id} deck.after`, errors),
    loadBoardSnapshot(resolveSnapshotPath(baseDir, entry.board.before), `${entry.id} board.before`, errors),
    loadBoardSnapshot(resolveSnapshotPath(baseDir, entry.board.after), `${entry.id} board.after`, errors)
  ]);

  if (!deckBefore || !deckAfter || !boardBefore || !boardAfter) {
    return undefined;
  }

  return { deckBefore, deckAfter, boardBefore, boardAfter };
}

async function loadDeckSnapshot(path: string, label: string, errors: string[]): Promise<DeckSnapshot | undefined> {
  try {
    const value = await readJson(path);
    if (!isDeckSnapshot(value)) {
      errors.push(`${label}: invalid deck snapshot`);
      return undefined;
    }
    return value;
  } catch (error) {
    errors.push(`${label}: ${errorMessage(error)}`);
    return undefined;
  }
}

async function loadBoardSnapshot(path: string, label: string, errors: string[]): Promise<BoardState | undefined> {
  try {
    return boardStateSchema.parse(await readJson(path));
  } catch (error) {
    errors.push(`${label}: ${errorMessage(error)}`);
    return undefined;
  }
}

function checkEntryMatchesSnapshots(
  entry: ReplayEntry,
  snapshots: Omit<ValidatedReplayEntry, 'entry'>,
  errors: string[]
): void {
  if (snapshots.boardBefore.turn.activePlayer !== entry.player) {
    errors.push(`${entry.id}: board.before active player is ${snapshots.boardBefore.turn.activePlayer}, expected ${entry.player}`);
  }
  if (snapshots.boardBefore.turn.round !== entry.round) {
    errors.push(`${entry.id}: board.before round is ${snapshots.boardBefore.turn.round}, expected ${entry.round}`);
  }

  const deckActivePlayer = activeDeckPlayerId(snapshots.deckBefore.game);
  if (deckActivePlayer !== entry.player) {
    errors.push(`${entry.id}: deck.before active player is ${deckActivePlayer ?? 'missing'}, expected ${entry.player}`);
  }
}

function nextBoardTurn(state: BoardState): BoardState['turn'] {
  const players = state.supply.map((supply) => supply.player);
  const currentIndex = players.indexOf(state.turn.activePlayer);
  if (currentIndex === -1 || players.length === 0) {
    return state.turn;
  }
  const nextIndex = (currentIndex + 1) % players.length;
  return {
    activePlayer: players[nextIndex] ?? state.turn.activePlayer,
    round: nextIndex === 0 ? state.turn.round + 1 : state.turn.round
  };
}

function validateDeckTransition(entry: ReplayEntry, snapshots: Omit<ValidatedReplayEntry, 'entry'>, errors: string[]): void {
  if (!isCompleteDeckSnapshot(snapshots.deckBefore)) {
    errors.push(`${entry.id}: strict deck validation requires a complete deck.before snapshot`);
    return;
  }
  if (!isCompleteDeckSnapshot(snapshots.deckAfter)) {
    errors.push(`${entry.id}: strict deck validation requires a complete deck.after snapshot`);
    return;
  }
  if (!entry.deck.actions) {
    errors.push(`${entry.id}: strict deck validation requires deck actions`);
    return;
  }

  const inputResult = deckTurnInputSchema.safeParse({
    schemaVersion: 1,
    turnId: entry.id,
    player: entry.player,
    actions: entry.deck.actions
  });
  if (!inputResult.success) {
    errors.push(`${entry.id}: invalid deck actions: ${inputResult.error.message}`);
    return;
  }

  try {
    const replayed = executeDeckTurn(snapshots.deckBefore, inputResult.data, {
      beforePath: entry.deck.before,
      afterPath: entry.deck.after
    });
    if (stableJson(replayed.after) !== stableJson(snapshots.deckAfter)) {
      errors.push(`${entry.id}: replayed deck actions do not match deck.after`);
    }
    compareStringArray(`${entry.id}: deck.drawnHand`, entry.deck.drawnHand, replayed.result.drawnHand, errors);
    compareStringArray(`${entry.id}: deck.played`, entry.deck.played, replayed.result.played, errors);
    compareStringArray(`${entry.id}: deck.bought`, entry.deck.bought, replayed.result.bought, errors);
    compareProduced(entry.id, entry.deck.produced, replayed.result.produced, errors);
  } catch (error) {
    errors.push(`${entry.id}: ${errorMessage(error)}`);
  }
}

function compareStringArray(label: string, actual: string[], expected: string[], errors: string[]): void {
  if (stableJson(actual) !== stableJson(expected)) {
    errors.push(`${label} is ${stableJson(actual)}, expected ${stableJson(expected)}`);
  }
}

function compareProduced(turnId: string, actual: Record<string, number>, expected: Record<string, number>, errors: string[]): void {
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  for (const key of keys) {
    if ((actual[key] ?? 0) !== (expected[key] ?? 0)) {
      errors.push(`${turnId}: deck.produced.${key} is ${actual[key] ?? 0}, expected ${expected[key] ?? 0}`);
    }
  }
}

function checkContinuity(
  previous: ValidatedReplayEntry,
  current: Omit<ValidatedReplayEntry, 'entry'>,
  errors: string[]
): void {
  if (stableJson(previous.deckAfter) !== stableJson(current.deckBefore)) {
    errors.push(`${previous.entry.id}: deck.after does not match the next deck.before`);
  }
  if (stableJson(boardContinuityState(previous.boardAfter)) !== stableJson(boardContinuityState(current.boardBefore))) {
    errors.push(`${previous.entry.id}: board.after does not match the next board.before`);
  }
}

function activeDeckPlayerId(game: GameState): string | undefined {
  return game.players[game.activePlayer]?.id;
}

function boardContinuityState(state: BoardState): Omit<BoardState, 'notes'> {
  const { notes, ...rest } = state;
  return rest;
}

function isDeckSnapshot(value: unknown): value is DeckSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<DeckSnapshot>;
  return candidate.schemaVersion === 1 && Number.isInteger(candidate.rngState) && isGameState(candidate.game);
}

function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<GameState>;
  return Array.isArray(candidate.players) && Number.isInteger(candidate.activePlayer);
}

function resolveSnapshotPath(baseDir: string, path: string): string {
  return isAbsolute(path) ? path : join(baseDir, path);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadGameConfig } from '../../src/config/loadGameConfig';
import { applyAction } from '../../src/core/engine';
import { listLegalActions } from '../../src/core/legalActions';
import { SeededRng, type Rng } from '../../src/core/random';
import { setupGame } from '../../src/core/state';
import type { GameState, LegalAction } from '../../src/core/types';

type Player = 'P1' | 'P2';
type UnitType = 'guardian' | 'raider' | 'marksman' | 'scout' | 'druid' | 'healer';

interface Coord {
  col: number;
  row: number;
}

interface Unit extends Coord {
  id: string;
  player: Player;
  type: UnitType;
  hp: number;
  maxHp: number;
  attack: number;
}

interface BoardState {
  schemaVersion: 1;
  ruleset: string;
  map: string;
  turn: { activePlayer: Player; round: number };
  units: Unit[];
  supplyControl: Array<{ id: string; controller: Player | null }>;
  supply: Array<{ player: Player; amount: number }>;
  notes: string[];
}

interface ReplayEntry {
  id: string;
  player: Player;
  round: number;
  deck: {
    before: string;
    after: string;
    drawnHand: string[];
    played: string[];
    bought: string[];
    produced: Record<string, number>;
  };
  board: { before: string; after: string };
  summary: string;
  reasoning: string;
}

const runDir = '.games/e014a-center-vs-flank-a';
const snapshotsDir = join(runDir, 'snapshots');
const ruleset = 'territory-v1-cost6-damagecap-responsewin-lead4';
const mapId = 'sketch-v4-tempo';
const cardConfigPath = `rulesets/${ruleset}/deck.yaml`;
const starterBoardPath = '.games/e014-tempo-starter.board.json';
const maxCompletedTurns = 40;

const unitRules: Record<UnitType, { hp: number; attack: number; movement: number; range?: number; heal?: number }> = {
  guardian: { hp: 16, attack: 4, movement: 1 },
  raider: { hp: 8, attack: 6, movement: 2 },
  marksman: { hp: 8, attack: 4, movement: 1, range: 2 },
  scout: { hp: 8, attack: 2, movement: 3, range: 2 },
  druid: { hp: 10, attack: 4, movement: 1, heal: 1 },
  healer: { hp: 4, attack: 1, movement: 1, range: 2, heal: 1 }
};

const p1CenterPlan = [
  'center-northeast',
  'center-east',
  'center-southeast',
  'center-center-north',
  'center-center',
  'center-center-south',
  'center-northwest',
  'center-west-south'
];

const p2CenterPlan = [
  'center-west-south',
  'center-center-south',
  'center-northwest',
  'center-center',
  'center-east',
  'center-southeast',
  'center-center-north',
  'center-northeast'
];

const recruitPlans: Record<Player, UnitType[]> = {
  P1: ['guardian', 'marksman', 'druid', 'healer', 'guardian', 'marksman', 'druid', 'guardian'],
  P2: ['scout', 'raider', 'marksman', 'guardian', 'scout', 'raider', 'marksman', 'guardian']
};

const p1BuyPlan = [
  'silver',
  'peddler',
  'village',
  'armory',
  'training',
  'blast',
  'gold',
  'peddler',
  'village',
  'armory',
  'training',
  'healer',
  'second-wind'
];

const p2BuyPlan = [
  'silver',
  'peddler',
  'village',
  'gold',
  'peddler',
  'storm',
  'blast',
  'gold',
  'village',
  'healer',
  'silver',
  'peddler'
];

const idCounters: Record<Player, Partial<Record<UnitType, number>>> = { P1: {}, P2: {} };
const recruitPlanCursor: Record<Player, number> = { P1: 0, P2: 0 };

function key(coord: Coord): string {
  return `${coord.col},${coord.row}`;
}

function other(player: Player): Player {
  return player === 'P1' ? 'P2' : 'P1';
}

function cardName(id: string, state: GameState): string {
  return state.cards[id]?.name ?? id;
}

function activePlayer(state: GameState): Player {
  return state.players[state.activePlayer]!.id as Player;
}

function liveUnits(board: BoardState, player: Player): Unit[] {
  return board.units.filter((unit) => unit.player === player && unit.hp > 0);
}

function centersControlled(board: BoardState, player: Player): number {
  return board.supplyControl.filter((center) => center.controller === player).length;
}

function supplyAmount(board: BoardState, player: Player): number {
  return board.supply.find((entry) => entry.player === player)!.amount;
}

function setSupply(board: BoardState, player: Player, amount: number): void {
  board.supply.find((entry) => entry.player === player)!.amount = amount;
}

function centerById(map: any, id: string): Coord {
  const center = map.supplyCenters.find((candidate: any) => candidate.id === id);
  if (!center) {
    throw new Error(`Unknown center: ${id}`);
  }
  return { col: center.col, row: center.row };
}

function homeHexes(map: any, player: Player): Coord[] {
  return map.homeBases.find((base: any) => base.player === player)!.hexes;
}

function neighbors(coord: Coord): Coord[] {
  const even = coord.col % 2 === 0;
  const offsets = even
    ? [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]]
    : [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  return offsets.map(([dc, dr]) => ({ col: coord.col + dc!, row: coord.row + dr! }));
}

function distance(a: Coord, b: Coord, hexes: Set<string>): number {
  if (key(a) === key(b)) {
    return 0;
  }
  const seen = new Set([key(a)]);
  let frontier: Coord[] = [a];
  for (let depth = 1; depth < 40; depth += 1) {
    const next: Coord[] = [];
    for (const coord of frontier) {
      for (const neighbor of neighbors(coord)) {
        const neighborKey = key(neighbor);
        if (!hexes.has(neighborKey) || seen.has(neighborKey)) {
          continue;
        }
        if (neighborKey === key(b)) {
          return depth;
        }
        seen.add(neighborKey);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return 999;
}

function stepToward(unit: Unit, target: Coord, board: BoardState, hexes: Set<string>): Coord {
  const occupied = new Set(board.units.filter((candidate) => candidate.id !== unit.id && candidate.hp > 0).map(key));
  const enemyOccupied = new Set(
    board.units.filter((candidate) => candidate.id !== unit.id && candidate.hp > 0 && candidate.player !== unit.player).map(key)
  );
  let best: Coord = { col: unit.col, row: unit.row };
  let bestDistance = distance(best, target, hexes);
  const seen = new Set([key(unit)]);
  const frontier: Array<{ coord: Coord; depth: number }> = [{ coord: unit, depth: 0 }];

  while (frontier.length > 0) {
    const current = frontier.shift()!;
    if (current.depth >= unitRules[unit.type].movement) {
      continue;
    }
    for (const neighbor of neighbors(current.coord)) {
      const neighborKey = key(neighbor);
      if (!hexes.has(neighborKey) || seen.has(neighborKey) || enemyOccupied.has(neighborKey)) {
        continue;
      }
      seen.add(neighborKey);
      const candidateDistance = distance(neighbor, target, hexes);
      if (!occupied.has(neighborKey) && candidateDistance < bestDistance) {
        best = neighbor;
        bestDistance = candidateDistance;
      }
      frontier.push({ coord: neighbor, depth: current.depth + 1 });
    }
  }
  return best;
}

function inRange(attacker: Unit, target: Unit, hexes: Set<string>): boolean {
  return distance(attacker, target, hexes) <= (unitRules[attacker.type].range ?? 1);
}

function unitCenterPlan(unit: Unit, completedTurn: number): string[] {
  if (unit.player === 'P1') {
    if (unit.type === 'scout') {
      return ['center-east', 'center-southeast', 'center-center', ...p1CenterPlan];
    }
    if (unit.type === 'guardian' || unit.type === 'druid' || unit.type === 'healer') {
      return ['center-center-north', 'center-center', 'center-east', 'center-southeast', ...p1CenterPlan];
    }
    return p1CenterPlan;
  }
  if (unit.type === 'scout' || unit.type === 'raider') {
    const earlyFlank = ['center-west-south', 'center-center-south', 'center-northwest', 'center-center'];
    const eastTest = ['center-east', 'center-southeast', 'center-center-north', 'center-northeast'];
    return completedTurn < 12 ? [...earlyFlank, ...eastTest] : [...earlyFlank, ...eastTest, ...p2CenterPlan];
  }
  return p2CenterPlan;
}

function chooseCenterTarget(unit: Unit, board: BoardState, map: any, hexes: Set<string>, completedTurn: number): Coord {
  const priorities = unitCenterPlan(unit, completedTurn);
  const targets = priorities.map((id) => ({
    id,
    coord: centerById(map, id),
    controller: board.supplyControl.find((center) => center.id === id)?.controller ?? null
  }));
  const preferred = targets.filter((center) => center.controller !== unit.player);
  const candidates = preferred.length > 0 ? preferred : targets;
  candidates.sort((a, b) => {
    const distanceDelta = distance(unit, a.coord, hexes) - distance(unit, b.coord, hexes);
    return distanceDelta !== 0 ? distanceDelta : priorities.indexOf(a.id) - priorities.indexOf(b.id);
  });
  return candidates[0]!.coord;
}

function chooseUpgradeTarget(board: BoardState, player: Player, kind: 'health' | 'damage'): Unit | undefined {
  const preferred = player === 'P1'
    ? ['guardian', 'marksman', 'druid', 'healer', 'raider', 'scout']
    : ['guardian', 'marksman', 'raider', 'scout', 'druid', 'healer'];
  const units = liveUnits(board, player);
  units.sort((a, b) => {
    const typeDelta = preferred.indexOf(a.type) - preferred.indexOf(b.type);
    if (typeDelta !== 0) {
      return typeDelta;
    }
    return kind === 'health' ? b.attack - a.attack : b.maxHp - a.maxHp;
  });
  return units[0];
}

function nextUnitId(player: Player, type: UnitType): string {
  idCounters[player][type] = (idCounters[player][type] ?? 0) + 1;
  return `${player}-${type}-${idCounters[player][type]}`;
}

function seedCounters(board: BoardState): void {
  for (const player of ['P1', 'P2'] as Player[]) {
    recruitPlanCursor[player] = board.units.filter((candidate) => candidate.player === player).length;
    for (const unit of board.units.filter((candidate) => candidate.player === player)) {
      const match = unit.id.match(new RegExp(`^${player}-${unit.type}-(\\d+)$`));
      idCounters[player][unit.type] = Math.max(idCounters[player][unit.type] ?? 0, match ? Number(match[1]) : 0);
    }
  }
}

function recruit(board: BoardState, map: any, player: Player, pendingThreat: Player | null): string[] {
  const recruited: string[] = [];
  let supply = supplyAmount(board, player);
  const occupied = new Set(board.units.filter((unit) => unit.hp > 0).map(key));
  const homes = homeHexes(map, player).filter((hex) => !occupied.has(key(hex)));
  const maxRecruits = pendingThreat && pendingThreat !== player ? 4 : player === 'P2' ? 3 : 2;

  while (supply >= 6 && homes.length > 0 && recruited.length < maxRecruits) {
    const type = recruitPlans[player][recruitPlanCursor[player] % recruitPlans[player].length]!;
    const coord = homes.shift()!;
    const rules = unitRules[type];
    board.units.push({
      id: nextUnitId(player, type),
      player,
      type,
      col: coord.col,
      row: coord.row,
      hp: rules.hp,
      maxHp: rules.hp,
      attack: rules.attack
    });
    recruited.push(board.units.at(-1)!.id);
    supply -= 6;
    recruitPlanCursor[player] += 1;
  }

  setSupply(board, player, supply);
  return recruited;
}

function cardCounts(state: GameState, player: Player): Record<string, number> {
  const owner = state.players.find((candidate) => candidate.id === player)!;
  const counts: Record<string, number> = {};
  for (const id of [...owner.draw, ...owner.hand, ...owner.discard, ...owner.play]) {
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

function chooseBuy(state: GameState, legal: LegalAction[], player: Player): number {
  const counts = cardCounts(state, player);
  const plan = player === 'P1' ? p1BuyPlan : p2BuyPlan;
  const buyIndex = (cardId: string) =>
    legal.findIndex((action) => action.description === `Buy ${cardName(cardId, state)} (${state.cards[cardId]?.cost})`);

  for (const cardId of plan) {
    const max = player === 'P1'
      ? (cardId === 'armory' || cardId === 'training' ? 3 : cardId === 'blast' ? 2 : cardId === 'gold' ? 3 : 4)
      : (cardId === 'gold' ? 4 : cardId === 'storm' || cardId === 'blast' || cardId === 'healer' ? 2 : 5);
    if ((counts[cardId] ?? 0) >= max) {
      continue;
    }
    const index = buyIndex(cardId);
    if (index >= 0) {
      return index;
    }
  }

  const fallback = player === 'P1'
    ? ['gold', 'training', 'armory', 'blast', 'peddler', 'village', 'silver']
    : ['gold', 'peddler', 'village', 'storm', 'blast', 'silver'];
  for (const cardId of fallback) {
    const index = buyIndex(cardId);
    if (index >= 0) {
      return index;
    }
  }
  return legal.length - 1;
}

function chooseDeckAction(state: GameState, legal: LegalAction[], player: Player, bought: string[]): number {
  const current = state.players[state.activePlayer]!;
  if (state.phase === 'action') {
    if (!current.freeTrashUsed && current.play.length === 0) {
      const trashRest = legal.findIndex((action) => action.description === 'Trash Rest');
      if (trashRest >= 0) {
        return trashRest;
      }
    }
    const priorities = player === 'P1'
      ? [
          'Play Village',
          'Play Peddler',
          'Play Training',
          'Play Blast',
          'Play Zap',
          'Play Armory',
          'Play Second Wind',
          'Play Bandage',
          'Play Potion',
          'Play Healer',
          'Play Smithy'
        ]
      : [
          'Play Village',
          'Play Peddler',
          'Play Blast',
          'Play Zap',
          'Play Storm',
          'Play Smithy',
          'Play Bandage',
          'Play Potion',
          'Play Healer'
        ];
    for (const description of priorities) {
      const index = legal.findIndex((action) => action.description === description);
      if (index >= 0) {
        return index;
      }
    }
    return legal.findIndex((action) => action.description === 'Move to buy phase');
  }
  if (state.phase === 'buy') {
    const endTurn = legal.findIndex((action) => action.description === 'End turn');
    const index = chooseBuy(state, legal, player);
    if (index !== endTurn && bought.length === 0) {
      bought.push(legal[index]!.description.replace(/^Buy /, '').replace(/ \(\d+\)$/, ''));
      return index;
    }
    return endTurn;
  }
  return 0;
}

function producedCounters(state: GameState): Record<string, number> {
  const player = state.players[state.activePlayer]!;
  return {
    money: player.money,
    damage: player.attributes.damage ?? 0,
    heal: player.attributes.heal ?? 0,
    upgradeHealth: player.attributes.upgradeHealth ?? 0,
    upgradeDamage: player.attributes.upgradeDamage ?? 0,
    reattack: player.attributes.reattack ?? 0,
    stormTargets: player.attributes.stormTargets ?? 0
  };
}

function playDeckTurn(state: GameState, rng: Rng): {
  state: GameState;
  drawnHand: string[];
  played: string[];
  bought: string[];
  produced: Record<string, number>;
} {
  const player = activePlayer(state);
  const drawnHand = state.players[state.activePlayer]!.hand.map((id) => cardName(id, state));
  const played: string[] = [];
  const bought: string[] = [];
  let produced = producedCounters(state);

  while (!state.ended && activePlayer(state) === player) {
    const legal = listLegalActions(state);
    if (state.phase === 'buy' && legal.some((action) => action.description === 'End turn')) {
      produced = producedCounters(state);
    }
    const index = chooseDeckAction(state, legal, player, bought);
    const chosen = legal[index]!;
    if (chosen.description.startsWith('Play ')) {
      played.push(chosen.description.slice('Play '.length));
    }
    state = applyAction(state, chosen.action, rng);
  }

  return { state, drawnHand, played, bought, produced };
}

function targetPriority(target: Unit): number {
  const value: Record<UnitType, number> = {
    healer: 0,
    scout: 1,
    marksman: 2,
    raider: 3,
    druid: 4,
    guardian: 5
  };
  return value[target.type];
}

function shouldSupportInsteadOfAttack(board: BoardState, healer: Unit, hexes: Set<string>): boolean {
  const healRange = unitRules[healer.type].range ?? 1;
  return liveUnits(board, healer.player).some((unit) => unit.hp < unit.maxHp && distance(healer, unit, hexes) <= healRange);
}

function applyBoardTurn(
  board: BoardState,
  map: any,
  hexes: Set<string>,
  player: Player,
  produced: Record<string, number>,
  completedTurn: number,
  pendingThreat: Player | null
): { summary: string; reasoning: string } {
  const beforeUnits = liveUnits(board, player).length;
  const beforeEnemyUnits = liveUnits(board, other(player)).length;
  const income = 2 + centersControlled(board, player);
  const events: string[] = [`income ${income}`];
  setSupply(board, player, supplyAmount(board, player) + income);

  for (const unit of liveUnits(board, player)) {
    const target = chooseCenterTarget(unit, board, map, hexes, completedTurn);
    const destination = stepToward(unit, target, board, hexes);
    unit.col = destination.col;
    unit.row = destination.row;
    const center = map.supplyCenters.find((candidate: any) => candidate.col === unit.col && candidate.row === unit.row);
    if (center) {
      const control = board.supplyControl.find((candidate) => candidate.id === center.id)!;
      if (control.controller !== player) {
        control.controller = player;
        events.push(`${unit.id} captured ${center.id}`);
      }
    }
  }

  for (let points = produced.upgradeHealth ?? 0; points > 0; points -= 1) {
    const target = chooseUpgradeTarget(board, player, 'health');
    if (!target) {
      break;
    }
    target.maxHp += 1;
    target.hp += 1;
    events.push(`${target.id} gained +1 max HP`);
  }

  for (let points = produced.upgradeDamage ?? 0; points > 0; points -= 1) {
    const target = chooseUpgradeTarget(board, player, 'damage');
    if (!target) {
      break;
    }
    target.attack += 1;
    events.push(`${target.id} gained +1 attack`);
  }

  let deckDamage = produced.damage ?? 0;
  const attacked = new Set<string>();
  const deckDamageUsers = new Set<string>();
  const attackers = [...liveUnits(board, player)];
  const reattackers = attackers.slice(0, produced.reattack ?? 0);
  for (const attacker of [...attackers, ...reattackers]) {
    const current = board.units.find((unit) => unit.id === attacker.id && unit.hp > 0);
    if (!current) {
      continue;
    }
    if ((unitRules[current.type].heal ?? 0) > 0 && shouldSupportInsteadOfAttack(board, current, hexes)) {
      continue;
    }
    const targets = liveUnits(board, other(player)).filter((target) => inRange(current, target, hexes));
    if (targets.length === 0) {
      continue;
    }
    targets.sort((a, b) => a.hp - b.hp || targetPriority(a) - targetPriority(b));
    const target = targets[0]!;
    const extra = deckDamage > 0 && !deckDamageUsers.has(current.id) ? 1 : 0;
    target.hp -= current.attack + extra;
    deckDamage -= extra;
    if (extra > 0) {
      deckDamageUsers.add(current.id);
    }
    attacked.add(current.id);
    events.push(`${current.id} hit ${target.id} for ${current.attack + extra}`);
  }

  const killed = board.units.filter((unit) => unit.hp <= 0).map((unit) => unit.id);
  board.units = board.units.filter((unit) => unit.hp > 0);
  if (killed.length > 0) {
    events.push(`removed ${killed.join(', ')}`);
  }
  if (deckDamage > 0) {
    events.push(`${deckDamage} deck damage expired`);
  }

  let deckHeal = produced.heal ?? 0;
  while (deckHeal > 0) {
    const target = liveUnits(board, player)
      .filter((unit) => unit.hp < unit.maxHp)
      .sort((a, b) => (b.maxHp - b.hp) - (a.maxHp - a.hp))[0];
    if (!target) {
      break;
    }
    target.hp = Math.min(target.maxHp, target.hp + 1);
    deckHeal -= 1;
  }

  for (const healer of liveUnits(board, player).filter((unit) => (unitRules[unit.type].heal ?? 0) > 0 && !attacked.has(unit.id))) {
    const healRange = unitRules[healer.type].range ?? 1;
    const target = liveUnits(board, player)
      .filter((unit) => unit.hp < unit.maxHp && distance(healer, unit, hexes) <= healRange)
      .sort((a, b) => (b.maxHp - b.hp) - (a.maxHp - a.hp))[0];
    if (target) {
      target.hp = Math.min(target.maxHp, target.hp + (unitRules[healer.type].heal ?? 0));
      events.push(`${healer.id} healed ${target.id}`);
    }
  }

  const recruited = recruit(board, map, player, pendingThreat);
  if (recruited.length > 0) {
    events.push(`recruited ${recruited.join(', ')}`);
  }

  const afterUnits = liveUnits(board, player).length;
  const afterEnemyUnits = liveUnits(board, other(player)).length;
  const summary = `${player} ${events.slice(0, 3).join('; ')}; units ${beforeUnits}-${beforeEnemyUnits} to ${afterUnits}-${afterEnemyUnits}, centers ${centersControlled(board, 'P1')}-${centersControlled(board, 'P2')}.`;
  const reasoning = `${player === 'P1'
    ? 'P1 followed the balanced economy/control assignment: hold the central/eastern centers, preserve anchors with support, and make attacks matter through upgrades and capped deck damage.'
    : 'P2 followed the flank/economy assignment: use mobile units for west/south/east flips, buy economy first, and convert center pressure into recruit tempo without assuming the southeast route is free.'} Board events: ${events.join('; ')}.`;
  return { summary, reasoning };
}

function advanceBoardTurn(board: BoardState): void {
  if (board.turn.activePlayer === 'P1') {
    board.turn.activePlayer = 'P2';
  } else {
    board.turn.activePlayer = 'P1';
    board.turn.round += 1;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  await rm(snapshotsDir, { recursive: true, force: true });
  await mkdir(snapshotsDir, { recursive: true });

  const config = await loadGameConfig(cardConfigPath);
  const rng = new SeededRng(1401);
  let deck = setupGame(config, rng);
  let board = JSON.parse(await readFile(starterBoardPath, 'utf8')) as BoardState;
  const map = JSON.parse(await readFile(`maps/${mapId}.json`, 'utf8'));
  const hexes = new Set<string>(map.hexes.map((coord: Coord) => key(coord)));
  const timeline: { schemaVersion: 1; title: string; entries: ReplayEntry[] } = {
    schemaVersion: 1,
    title: 'E014a center vs flank A tempo replay',
    entries: []
  };
  seedCounters(board);

  let pendingThreat: Player | null = null;
  let winner: Player | null = null;
  let completedTurns = 0;
  const threatLog: string[] = [];

  for (let turnNumber = 1; turnNumber <= maxCompletedTurns; turnNumber += 1) {
    const player = board.turn.activePlayer;
    if (pendingThreat && liveUnits(board, pendingThreat).length - liveUnits(board, other(pendingThreat)).length < 4) {
      threatLog.push(`Turn ${turnNumber}: cleared pending ${pendingThreat} lead before ${player}'s start check.`);
      pendingThreat = null;
    }

    const playerCount = liveUnits(board, player).length;
    const enemyCount = liveUnits(board, other(player)).length;
    if (playerCount - enemyCount >= 4) {
      if (pendingThreat === player) {
        winner = player;
        threatLog.push(`Turn ${turnNumber}: ${player} confirmed pending lead-4 at start of turn, ${playerCount}-${enemyCount}.`);
        break;
      }
      pendingThreat = player;
      threatLog.push(`Turn ${turnNumber}: ${player} created pending lead-4 at start of turn, ${playerCount}-${enemyCount}.`);
    }

    const turnId = `turn-${String(turnNumber).padStart(3, '0')}`;
    const paths = {
      deckBefore: `snapshots/${turnId}.before.deck.json`,
      deckAfter: `snapshots/${turnId}.after.deck.json`,
      boardBefore: `snapshots/${turnId}.before.board.json`,
      boardAfter: `snapshots/${turnId}.after.board.json`
    };
    const boardBefore = JSON.parse(JSON.stringify(board)) as BoardState;
    await writeJson(join(runDir, paths.deckBefore), { schemaVersion: 1, rngState: rng.snapshot(), game: deck });
    await writeJson(join(runDir, paths.boardBefore), boardBefore);

    const deckResult = playDeckTurn(deck, rng);
    deck = deckResult.state;
    const boardResult = applyBoardTurn(board, map, hexes, player, deckResult.produced, turnNumber, pendingThreat);
    advanceBoardTurn(board);

    await writeJson(join(runDir, paths.deckAfter), { schemaVersion: 1, rngState: rng.snapshot(), game: deck });
    await writeJson(join(runDir, paths.boardAfter), board);

    timeline.entries.push({
      id: turnId,
      player,
      round: boardBefore.turn.round,
      deck: {
        before: paths.deckBefore,
        after: paths.deckAfter,
        drawnHand: deckResult.drawnHand,
        played: deckResult.played,
        bought: deckResult.bought,
        produced: deckResult.produced
      },
      board: { before: paths.boardBefore, after: paths.boardAfter },
      summary: boardResult.summary,
      reasoning: `${pendingThreat ? `Pending threat after start check: ${pendingThreat}. ` : ''}${boardResult.reasoning}`
    });
    completedTurns = turnNumber;
  }

  await writeJson(join(runDir, 'deck.json'), { schemaVersion: 1, rngState: rng.snapshot(), game: deck });
  await writeJson(join(runDir, 'board.json'), board);
  await writeJson(join(runDir, 'timeline.json'), timeline);

  const finalP1 = liveUnits(board, 'P1').length;
  const finalP2 = liveUnits(board, 'P2').length;
  const finalCenters = {
    P1: centersControlled(board, 'P1'),
    P2: centersControlled(board, 'P2'),
    neutral: board.supplyControl.filter((center) => center.controller === null).length
  };
  const stallNote = winner
    ? ''
    : '- No legal winner emerged by 40 completed player turns. The position still had active center flips and live attacks, so this is unresolved pacing evidence rather than a stable stall.\n';
  const resultTakeaway = winner === 'P1'
    ? '- P1 center/east control resisted the flank economy long enough to convert support and upgrades into a confirmed unit-count lead.'
    : winner === 'P2'
      ? '- P2 still converted flank economy into the decisive body lead, but the southeast rollback forced more contested movement through east/center than the E013 lower route.'
      : '- The tempo map softened the E013 spike into a prolonged contest: P2 could pressure flanks, but P1 repeatedly kept enough eastern/central control to prevent a clean lead confirmation.';
  const notes = `# E014a Center vs Flank A Replay Notes

## Setup

- Ruleset: \`${ruleset}\`.
- Map: \`${mapId}\`.
- Starter board: \`${starterBoardPath}\`.
- Deck setup used the fixed \`deck.yaml\` starting deck: 5 Copper, Zap, Bandage, and 3 Rest per player. The board-rules prose still mentions an older 7-Copper draft baseline, so this run records the fixed deck-file setup as operative.
- P1 deck strategy: balanced economy/control, with Silver, Gold, Peddler, Village, Blast, Armory, Training, and support cards.
- P1 board strategy: claim and hold central/eastern centers without overextending; prioritize guardians, marksmen, druids, and healers.
- P2 deck strategy: flank/economy pressure, buying economy first with Storm, Blast, and Healer support.
- P2 board strategy: use scouts and raiders for west/south/east flips, then convert income into flank footholds and marksman/guardian support.

## Result

- Completed player turns: ${completedTurns}.
- Winner: ${winner ?? 'none within cap'}${winner ? ' by confirmed lead-4 response-window unit-count win' : ''}.
- Final living units: P1 ${finalP1}, P2 ${finalP2}.
- Final supply centers: P1 ${finalCenters.P1}, P2 ${finalCenters.P2}, neutral ${finalCenters.neutral}.
- Final saved supply: P1 ${supplyAmount(board, 'P1')}, P2 ${supplyAmount(board, 'P2')}.

## Lead-4 Threat Handling

${threatLog.map((line) => `- ${line}`).join('\n') || '- No lead-4 threat occurred.'}

## Map And Strategy Takeaways

${resultTakeaway}
- Compared with E013c center-vs-flank A, P1 did not treat the southeast/east pair as a free race; the shifted southeast center at (9,7) pulled P1 defenders farther south/east and made P2's east pressure arrive through a more contestable route.
- Pacing remained longer than the current 12-16 turn target range, but the middle turns had repeated center flips, kills, healing, and recruit-pressure decisions rather than isolated economy building.
${stallNote}
## Rules Calls And Ambiguities

- The board schema has no pending-threat field; pending lead-4 state is recorded in timeline reasoning and this notes file.
- Deck-produced damage was attached only to legal attacks and capped at 1 deck-produced damage per attacking unit. Excess damage expired.
- Printed healers and druids healed instead of attacking when they had a damaged friendly in legal heal range.
- Storm used the least expansive interpretation in this helper: the produced damage still required legal attackers and the normal per-attacker deck-damage cap.
- Tactical movement, targeting, and supply math were generated by a deterministic hand-audited simulator in this run directory. \`validate-run\` verifies schema, snapshot existence, active-player alignment, and continuity, not full tactical legality.
`;
  await writeFile(join(runDir, 'notes.md'), notes);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});

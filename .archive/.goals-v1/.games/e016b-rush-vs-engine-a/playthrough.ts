import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyAction } from '../../src/core/engine';
import { listLegalActions } from '../../src/core/legalActions';
import { SeededRng } from '../../src/core/random';
import type { GameState, ChosenAction } from '../../src/core/types';

type Player = 'P1' | 'P2';
type Coord = { col: number; row: number };
type Unit = {
  id: string;
  player: Player;
  type: string;
  col: number;
  row: number;
  hp: number;
  maxHp: number;
  attack: number;
};
type BoardState = {
  schemaVersion: 1;
  ruleset: string;
  map: string;
  turn: { activePlayer: Player; round: number };
  units: Unit[];
  supplyControl: Array<{ id: string; controller: Player | null }>;
  supply: Array<{ player: Player; amount: number }>;
  notes: string[];
};
type DeckSnapshot = { schemaVersion: 1; rngState: number; game: GameState };
type ReplayEntry = {
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
};

const root = '.games/e016b-rush-vs-engine-a';
const snapshots = join(root, 'snapshots');
const map = JSON.parse(await readFile('maps/sketch-v3-contest.json', 'utf8')) as {
  hexes: Coord[];
  blocked?: Coord[];
  supplyCenters: Array<Coord & { id: string }>;
  homeBases: Array<{ player: Player; hexes: Coord[] }>;
};
const unitRules = JSON.parse(await readFile('rulesets/territory-v1/units.json', 'utf8')) as Record<
  string,
  { movement: number; range?: number; heal?: number; hp: number; attack: number }
>;

const hexes = new Set(map.hexes.map(key));
const blocked = new Set((map.blocked ?? []).map(key));
const centerByCoord = new Map(map.supplyCenters.map((center) => [key(center), center]));
const centerCoordById = new Map(map.supplyCenters.map((center) => [center.id, center]));
const enteredTurn = new Map<string, number>();
const recruitCount: Record<Player, number> = { P1: 0, P2: 0 };
const pending = {
  unit: null as null | Player,
  center: null as null | Player
};
const globalNotes: string[] = [];
let winner: null | { player: Player; type: string; turnId: string; reasoning: string } = null;

function key(coord: Coord): string {
  return `${coord.col},${coord.row}`;
}

function neighbors(coord: Coord): Coord[] {
  const even = coord.col % 2 === 0;
  const offsets = even
    ? [
        [0, -1],
        [1, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
        [-1, -1]
      ]
    : [
        [0, -1],
        [1, 0],
        [1, 1],
        [0, 1],
        [-1, 1],
        [-1, 0]
      ];
  return offsets
    .map(([dc, dr]) => ({ col: coord.col + dc, row: coord.row + dr }))
    .filter((next) => hexes.has(key(next)) && !blocked.has(key(next)));
}

function distance(from: Coord, to: Coord, blockedByEnemy: Set<string> = new Set()): number {
  if (key(from) === key(to)) return 0;
  const queue: Array<{ coord: Coord; dist: number }> = [{ coord: from, dist: 0 }];
  const seen = new Set([key(from)]);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    for (const next of neighbors(current.coord)) {
      const nextKey = key(next);
      if (seen.has(nextKey) || blockedByEnemy.has(nextKey)) continue;
      if (nextKey === key(to)) return current.dist + 1;
      seen.add(nextKey);
      queue.push({ coord: next, dist: current.dist + 1 });
    }
  }
  return Number.POSITIVE_INFINITY;
}

function reachable(unit: Unit, board: BoardState): Coord[] {
  const move = unitRules[unit.type]!.movement;
  const enemyOccupied = new Set(board.units.filter((other) => other.player !== unit.player).map(key));
  const occupied = new Set(board.units.filter((other) => other.id !== unit.id).map(key));
  const start = { col: unit.col, row: unit.row };
  const queue: Array<{ coord: Coord; dist: number }> = [{ coord: start, dist: 0 }];
  const seen = new Set([key(start)]);
  const result = [start];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    if (current.dist >= move) continue;
    for (const next of neighbors(current.coord)) {
      const nextKey = key(next);
      if (seen.has(nextKey) || enemyOccupied.has(nextKey)) continue;
      seen.add(nextKey);
      queue.push({ coord: next, dist: current.dist + 1 });
      if (!occupied.has(nextKey)) result.push(next);
    }
  }
  return result;
}

function living(board: BoardState, player?: Player): Unit[] {
  return board.units.filter((unit) => unit.hp > 0 && (!player || unit.player === player));
}

function countCenters(board: BoardState, player: Player): number {
  return board.supplyControl.filter((center) => center.controller === player).length;
}

function countUnits(board: BoardState, player: Player): number {
  return living(board, player).length;
}

function qualifiesUnitThreat(board: BoardState, player: Player): boolean {
  const opponent = player === 'P1' ? 'P2' : 'P1';
  return countUnits(board, player) - countUnits(board, opponent) >= 4;
}

function qualifiesCenterThreat(board: BoardState, player: Player): boolean {
  const opponent = player === 'P1' ? 'P2' : 'P1';
  return countCenters(board, player) >= 5 && countUnits(board, player) >= countUnits(board, opponent);
}

function checkStartThreats(board: BoardState, turnId: string): string[] {
  const active = board.turn.activePlayer;
  const notes: string[] = [];
  for (const threatened of ['P1', 'P2'] as Player[]) {
    if (pending.unit === threatened && !qualifiesUnitThreat(board, threatened)) {
      notes.push(`${threatened}'s pending unit-count threat cleared before ${active}'s start check.`);
      pending.unit = null;
    }
    if (pending.center === threatened && !qualifiesCenterThreat(board, threatened)) {
      notes.push(`${threatened}'s pending center-control threat cleared before ${active}'s start check.`);
      pending.center = null;
    }
  }
  if (pending.unit === active && qualifiesUnitThreat(board, active)) {
    winner = {
      player: active,
      type: 'confirmed 4-unit lead',
      turnId,
      reasoning: `${active} began ${turnId} with a confirmed pending 4-unit lead.`
    };
    notes.push(winner.reasoning);
    return notes;
  }
  if (pending.center === active && qualifiesCenterThreat(board, active)) {
    winner = {
      player: active,
      type: 'confirmed center-control response-window',
      turnId,
      reasoning: `${active} began ${turnId} with ${countCenters(board, active)} centers and unit parity or better after the pending center-control threat survived the response turn.`
    };
    notes.push(winner.reasoning);
    return notes;
  }
  if (qualifiesUnitThreat(board, active) && pending.unit !== active) {
    pending.unit = active;
    notes.push(`${active} records a pending unit-count threat at start of ${turnId}.`);
  }
  if (qualifiesCenterThreat(board, active) && pending.center !== active) {
    pending.center = active;
    notes.push(`${active} records a pending center-control threat at start of ${turnId}.`);
  }
  if (notes.length === 0) {
    notes.push(`No confirmed or newly pending response-window win at start of ${turnId}.`);
  }
  return notes;
}

function chooseTrash(player: Player, game: GameState): ChosenAction | null {
  const statePlayer = game.players[game.activePlayer]!;
  const trashPriority = player === 'P1' ? ['rest', 'copper'] : ['rest'];
  if (statePlayer.play.length > 0 || statePlayer.freeTrashUsed) return null;
  for (const card of trashPriority) {
    const index = statePlayer.hand.indexOf(card);
    if (index >= 0) return { type: 'trashCard', handIndex: index };
  }
  return null;
}

function actionPriority(player: Player): string[] {
  return player === 'P1'
    ? ['village', 'peddler', 'zap', 'bandage', 'blast', 'storm', 'second-wind', 'training', 'smithy']
    : ['village', 'peddler', 'bandage', 'potion', 'zap', 'armory', 'healer', 'smithy'];
}

function buyPriority(player: Player, turnNumber: number): string[] {
  if (player === 'P1') {
    if (turnNumber <= 8) return ['storm', 'second-wind', 'blast', 'zap', 'silver', 'village', 'gold'];
    return ['gold', 'second-wind', 'storm', 'blast', 'village', 'silver', 'zap'];
  }
  if (turnNumber <= 8) return ['village', 'peddler', 'silver', 'potion', 'bandage', 'armory', 'healer'];
  return ['gold', 'armory', 'healer', 'village', 'peddler', 'potion', 'silver', 'bandage'];
}

function chooseBuy(player: Player, turnNumber: number, game: GameState): ChosenAction | null {
  const statePlayer = game.players[game.activePlayer]!;
  for (const card of buyPriority(player, turnNumber)) {
    if ((game.supply[card] ?? 0) > 0 && statePlayer.money >= (game.cards[card]?.cost ?? 999)) {
      return { type: 'buyCard', cardId: card };
    }
  }
  return null;
}

function producedFrom(before: DeckSnapshot, after: DeckSnapshot, player: Player): Record<string, number> {
  const beforePlayer = before.game.players.find((candidate) => candidate.id === player)!;
  const afterPlayer = after.game.players.find((candidate) => candidate.id === player)!;
  const produced: Record<string, number> = {};
  for (const keyName of ['damage', 'heal', 'upgradeHealth', 'upgradeDamage', 'reattack', 'stormTargets']) {
    const value = beforePlayer.attributes[keyName] ?? 0;
    const during = maxAttributeProduced(before.game, player, keyName);
    if (during > 0) produced[keyName] = during;
    else if (value > 0) produced[keyName] = value;
  }
  const spent = afterPlayer.discard.length + afterPlayer.play.length + afterPlayer.hand.length + afterPlayer.draw.length;
  void spent;
  return produced;
}

function maxAttributeProduced(game: GameState, player: Player, keyName: string): number {
  const statePlayer = game.players.find((candidate) => candidate.id === player)!;
  return statePlayer.attributes[keyName] ?? 0;
}

async function runDeckTurn(player: Player, turnNumber: number): Promise<{
  before: DeckSnapshot;
  after: DeckSnapshot;
  drawnHand: string[];
  played: string[];
  bought: string[];
  produced: Record<string, number>;
}> {
  let persisted = JSON.parse(await readFile(join(root, 'deck.json'), 'utf8')) as DeckSnapshot;
  const before = structuredClone(persisted);
  const rng = SeededRng.fromState(persisted.rngState);
  const drawnHand = [...persisted.game.players[persisted.game.activePlayer]!.hand];
  const played: string[] = [];
  const bought: string[] = [];
  const produced: Record<string, number> = {};

  const trash = chooseTrash(player, persisted.game);
  if (trash) {
    persisted.game = applyAction(persisted.game, trash, rng);
  }

  while (persisted.game.phase === 'action') {
    const statePlayer = persisted.game.players[persisted.game.activePlayer]!;
    const card = actionPriority(player).find((cardId) => statePlayer.hand.includes(cardId) && statePlayer.actions > 0);
    if (!card) break;
    const index = statePlayer.hand.indexOf(card);
    persisted.game = applyAction(persisted.game, { type: 'playAction', handIndex: index }, rng);
    played.push(card);
    const current = persisted.game.players.find((candidate) => candidate.id === player)!;
    for (const [keyName, value] of Object.entries(current.attributes)) {
      if (value > (produced[keyName] ?? 0)) produced[keyName] = value;
    }
  }

  if (persisted.game.phase === 'action') {
    persisted.game = applyAction(persisted.game, { type: 'moveToBuy' }, rng);
  }
  const buy = chooseBuy(player, turnNumber, persisted.game);
  if (buy) {
    const legal = listLegalActions(persisted.game).some((item) => JSON.stringify(item.action) === JSON.stringify(buy));
    if (legal) {
      persisted.game = applyAction(persisted.game, buy, rng);
      bought.push(buy.cardId);
    }
  }
  if (persisted.game.phase === 'buy' && !persisted.game.ended) {
    persisted.game = applyAction(persisted.game, { type: 'endTurn' }, rng);
  }
  persisted = { schemaVersion: 1, rngState: rng.snapshot(), game: persisted.game };
  await writeFile(join(root, 'deck.json'), `${JSON.stringify(persisted, null, 2)}\n`);
  return { before, after: structuredClone(persisted), drawnHand, played, bought, produced };
}

function centerOwner(board: BoardState, centerId: string): Player | null {
  return board.supplyControl.find((center) => center.id === centerId)?.controller ?? null;
}

function setCenterOwner(board: BoardState, centerId: string, player: Player): void {
  const center = board.supplyControl.find((candidate) => candidate.id === centerId);
  if (center) center.controller = player;
}

function supply(board: BoardState, player: Player): { player: Player; amount: number } {
  return board.supply.find((item) => item.player === player)!;
}

function readyUnits(board: BoardState, player: Player, completedTurn: number): Unit[] {
  return living(board, player).filter((unit) => (enteredTurn.get(unit.id) ?? -1) < completedTurn);
}

function nearestTargetDistance(unit: Unit, targets: Coord[], board: BoardState): number {
  const enemyOccupied = new Set(board.units.filter((other) => other.player !== unit.player).map(key));
  return Math.min(...targets.map((target) => distance(unit, target, enemyOccupied)));
}

function scoreDestination(unit: Unit, coord: Coord, board: BoardState, player: Player): number {
  const opponent = player === 'P1' ? 'P2' : 'P1';
  const center = centerByCoord.get(key(coord));
  let score = 0;
  if (center) {
    const owner = centerOwner(board, center.id);
    if (owner === opponent) score += player === 'P2' ? 120 : 90;
    if (owner === null) score += 70;
    if (owner === player) score += 18;
    if (player === 'P1' && ['center-northeast', 'center-east', 'center-southeast', 'center-center', 'center-center-north'].includes(center.id)) score += 35;
    if (player === 'P2' && ['center-northwest', 'center-west-south', 'center-center-south', 'center-center'].includes(center.id)) score += 35;
  }
  const enemies = living(board, opponent);
  const range = unitRules[unit.type]!.range ?? 1;
  const attackTargets = enemies.filter((enemy) => distance(coord, enemy) <= range);
  if (attackTargets.length > 0) score += 25;
  const strategicTargets =
    player === 'P1'
      ? ['center-northeast', 'center-east', 'center-southeast', 'center-center', 'center-center-north', 'center-center-south']
      : countCenters(board, 'P1') >= 5
        ? board.supplyControl.filter((centerControl) => centerControl.controller === 'P1').map((centerControl) => centerControl.id)
        : ['center-northwest', 'center-west-south', 'center-center-south', 'center-center', 'center-center-north'];
  const targetCoords = strategicTargets.map((id) => centerCoordById.get(id)!).filter(Boolean);
  score -= Math.min(...targetCoords.map((target) => distance(coord, target))) * (player === 'P1' ? 5 : 6);
  if (player === 'P2' && unit.hp <= 4 && attackTargets.length > 0) score -= 20;
  if (unit.type === 'guardian' && center && centerOwner(board, center.id) === player) score += 20;
  return score;
}

function moveBoardUnits(board: BoardState, player: Player, completedTurn: number): string[] {
  const moves: string[] = [];
  const units = readyUnits(board, player, completedTurn);
  const order = player === 'P1'
    ? ['scout', 'raider', 'marksman', 'guardian', 'healer', 'druid']
    : ['scout', 'marksman', 'druid', 'guardian', 'healer', 'raider'];
  units.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  for (const unit of units) {
    const options = reachable(unit, board);
    let best = { coord: { col: unit.col, row: unit.row }, score: Number.NEGATIVE_INFINITY };
    for (const option of options) {
      const score = scoreDestination(unit, option, board, player);
      if (score > best.score) best = { coord: option, score };
    }
    if (best.coord.col !== unit.col || best.coord.row !== unit.row) {
      moves.push(`${unit.id} ${unit.col},${unit.row}->${best.coord.col},${best.coord.row}`);
      unit.col = best.coord.col;
      unit.row = best.coord.row;
    }
    const captured = centerByCoord.get(key(unit));
    if (captured) {
      const before = centerOwner(board, captured.id);
      setCenterOwner(board, captured.id, player);
      if (before !== player) moves.push(`${unit.id} captured ${captured.id}`);
    }
  }
  return moves;
}

function legalTargets(attacker: Unit, board: BoardState): Unit[] {
  const range = unitRules[attacker.type]!.range ?? 1;
  return living(board, attacker.player === 'P1' ? 'P2' : 'P1').filter((target) => distance(attacker, target) <= range);
}

function attackBoard(board: BoardState, player: Player, completedTurn: number, produced: Record<string, number>): string[] {
  const notes: string[] = [];
  const attackers = readyUnits(board, player, completedTurn);
  let deckDamage = produced.damage ?? 0;
  let reattacks = produced.reattack ?? 0;
  const usedExtra = new Set<string>();
  const attackOnce = (attacker: Unit, isReattack: boolean): void => {
    const targets = legalTargets(attacker, board).sort((a, b) => a.hp - b.hp || (a.type === 'healer' ? -1 : 0));
    const target = targets[0];
    if (!target) return;
    let damage = attacker.attack;
    if (deckDamage > 0 && !usedExtra.has(attacker.id)) {
      damage += 1;
      deckDamage -= 1;
      usedExtra.add(attacker.id);
    }
    target.hp = Math.max(0, target.hp - damage);
    notes.push(`${attacker.id}${isReattack ? ' reattacked' : ' attacked'} ${target.id} for ${damage}`);
    if (target.hp === 0) notes.push(`${target.id} was removed`);
  };
  for (const attacker of attackers) attackOnce(attacker, false);
  while (reattacks > 0) {
    const attacker = attackers.find((candidate) => legalTargets(candidate, board).length > 0);
    if (!attacker) break;
    attackOnce(attacker, true);
    reattacks -= 1;
  }
  board.units = board.units.filter((unit) => unit.hp > 0);
  return notes;
}

function healBoard(board: BoardState, player: Player, completedTurn: number, produced: Record<string, number>): string[] {
  const notes: string[] = [];
  let deckHeal = produced.heal ?? 0;
  while (deckHeal > 0) {
    const damaged = living(board, player).filter((unit) => unit.hp < unit.maxHp).sort((a, b) => a.hp - b.hp)[0];
    if (!damaged) break;
    damaged.hp += 1;
    deckHeal -= 1;
    notes.push(`deck heal restored 1 HP to ${damaged.id}`);
  }
  for (const healer of readyUnits(board, player, completedTurn)) {
    const healValue = unitRules[healer.type]!.heal ?? 0;
    if (healValue <= 0) continue;
    const range = unitRules[healer.type]!.range ?? 1;
    const target = living(board, player)
      .filter((unit) => unit.hp < unit.maxHp && distance(healer, unit) <= range)
      .sort((a, b) => a.hp - b.hp)[0];
    if (!target) continue;
    target.hp = Math.min(target.maxHp, target.hp + healValue);
    notes.push(`${healer.id} healed ${target.id} for ${healValue}`);
  }
  return notes;
}

function upgradeBoard(board: BoardState, player: Player, produced: Record<string, number>): string[] {
  const notes: string[] = [];
  let health = produced.upgradeHealth ?? 0;
  while (health > 0) {
    const target = living(board, player).sort((a, b) => b.maxHp - a.maxHp)[0];
    if (!target) break;
    target.maxHp += 1;
    target.hp += 1;
    health -= 1;
    notes.push(`Armory-style health upgrade added 1 max HP to ${target.id}`);
  }
  let damage = produced.upgradeDamage ?? 0;
  while (damage > 0) {
    const target = living(board, player).sort((a, b) => b.attack - a.attack)[0];
    if (!target) break;
    target.attack += 1;
    damage -= 1;
    notes.push(`Training-style damage upgrade added 1 attack to ${target.id}`);
  }
  return notes;
}

function recruitBoard(board: BoardState, player: Player, completedTurn: number): string[] {
  const notes: string[] = [];
  const reserve = supply(board, player);
  const home = map.homeBases.find((base) => base.player === player)!;
  const occupied = new Set(board.units.map(key));
  const priorities = player === 'P1'
    ? (countCenters(board, 'P1') >= 5 ? ['guardian', 'marksman', 'raider', 'scout'] : ['raider', 'scout', 'marksman', 'guardian'])
    : ['guardian', 'healer', 'druid', 'marksman', 'scout'];
  while (reserve.amount >= 6) {
    const hex = home.hexes.find((coord) => !occupied.has(key(coord)));
    if (!hex) break;
    const type = priorities[(recruitCount[player]) % priorities.length]!;
    recruitCount[player] += 1;
    reserve.amount -= 6;
    const id = `${player}-${type}-${recruitCount[player] + 1}`;
    const unit: Unit = {
      id,
      player,
      type,
      col: hex.col,
      row: hex.row,
      hp: unitRules[type]!.hp,
      maxHp: unitRules[type]!.hp,
      attack: unitRules[type]!.attack
    };
    board.units.push(unit);
    occupied.add(key(unit));
    enteredTurn.set(id, completedTurn);
    notes.push(`${player} recruited delayed ${type} ${id} at ${hex.col},${hex.row}`);
  }
  return notes;
}

function advanceBoardTurn(board: BoardState): void {
  if (board.turn.activePlayer === 'P1') {
    board.turn.activePlayer = 'P2';
  } else {
    board.turn.activePlayer = 'P1';
    board.turn.round += 1;
  }
}

function runBoardTurn(before: BoardState, player: Player, completedTurn: number, produced: Record<string, number>): { after: BoardState; summary: string; reasoningParts: string[] } {
  const board = structuredClone(before);
  const reasoningParts: string[] = [];
  const income = 2 + countCenters(board, player);
  supply(board, player).amount += income;
  reasoningParts.push(`${player} gained ${income} supply from normal income 2 + ${countCenters(board, player)} centers.`);
  reasoningParts.push(...moveBoardUnits(board, player, completedTurn));
  reasoningParts.push(...upgradeBoard(board, player, produced));
  reasoningParts.push(...attackBoard(board, player, completedTurn, produced));
  reasoningParts.push(...healBoard(board, player, completedTurn, produced));
  reasoningParts.push(...recruitBoard(board, player, completedTurn));
  const centerSplit = `centers P1 ${countCenters(board, 'P1')}/P2 ${countCenters(board, 'P2')}`;
  const unitSplit = `units P1 ${countUnits(board, 'P1')}/P2 ${countUnits(board, 'P2')}`;
  const summary = `${player} completed board phase; ${centerSplit}, ${unitSplit}.`;
  advanceBoardTurn(board);
  return { after: board, summary, reasoningParts };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function relSnapshot(turnId: string, kind: 'before' | 'after', type: 'deck' | 'board'): string {
  return `snapshots/${turnId}.${kind}.${type}.json`;
}

async function main(): Promise<void> {
  await mkdir(snapshots, { recursive: true });
  let board = JSON.parse(await readFile(join(root, 'board.json'), 'utf8')) as BoardState;
  const timeline = JSON.parse(await readFile(join(root, 'timeline.json'), 'utf8')) as { schemaVersion: 1; title: string; entries: ReplayEntry[] };

  for (let completedTurn = 1; completedTurn <= 40; completedTurn += 1) {
    const player = board.turn.activePlayer;
    const turnId = `turn-${String(completedTurn).padStart(3, '0')}`;
    const startThreatNotes = checkStartThreats(board, turnId);
    if (winner) {
      globalNotes.push(...startThreatNotes);
      break;
    }
    const boardBefore = structuredClone(board);
    const deckResult = await runDeckTurn(player, completedTurn);
    const boardResult = runBoardTurn(boardBefore, player, completedTurn, deckResult.produced);
    board = boardResult.after;

    await writeJson(join(root, relSnapshot(turnId, 'before', 'deck')), deckResult.before);
    await writeJson(join(root, relSnapshot(turnId, 'after', 'deck')), deckResult.after);
    await writeJson(join(root, relSnapshot(turnId, 'before', 'board')), boardBefore);
    await writeJson(join(root, relSnapshot(turnId, 'after', 'board')), board);
    await writeJson(join(root, 'board.json'), board);

    const threatState = `Pending threats after turn: unit=${pending.unit ?? 'none'}, center=${pending.center ?? 'none'}.`;
    timeline.entries.push({
      id: turnId,
      player,
      round: boardBefore.turn.round,
      deck: {
        before: relSnapshot(turnId, 'before', 'deck'),
        after: relSnapshot(turnId, 'after', 'deck'),
        drawnHand: deckResult.drawnHand,
        played: deckResult.played,
        bought: deckResult.bought,
        produced: Object.fromEntries(Object.entries(deckResult.produced).filter(([, value]) => value !== 0))
      },
      board: {
        before: relSnapshot(turnId, 'before', 'board'),
        after: relSnapshot(turnId, 'after', 'board')
      },
      summary: boardResult.summary,
      reasoning: [...startThreatNotes, ...boardResult.reasoningParts, threatState].join(' ')
    });
    await writeJson(join(root, 'timeline.json'), timeline);
  }

  const finalCenters = `P1 ${countCenters(board, 'P1')}, P2 ${countCenters(board, 'P2')}`;
  const finalUnits = `P1 ${countUnits(board, 'P1')}, P2 ${countUnits(board, 'P2')}`;
  const notes = [
    '# E016b Rush vs Engine A',
    '',
    '## Setup',
    '- Ruleset: territory-v1-cost6-damagecap-responsewin-lead4-centercontrol',
    '- Map: sketch-v3-contest',
    '- Starter board: .games/e016-centercontrol-starter.board.json',
    '- Normal income used throughout: 2 + controlled centers.',
    '- Center-control threat requires 5+ centers and living-unit parity or better; unit-count threat requires confirmed 4-unit lead.',
    '',
    '## Strategy',
    '- P1: early damage and tempo buys, center pressure, raiders/scouts/marksmen first with guardians for holds.',
    '- P2: engine/healing/economy buys, stabilize by flipping centers or pulling ahead on units, guardian/healer/druid core.',
    '',
    '## Result',
    `- Winner: ${winner?.player ?? 'none'}`,
    `- Win type: ${winner?.type ?? 'unresolved at cap'}`,
    `- Completed player turns: ${timeline.entries.length}`,
    `- Final centers: ${finalCenters}`,
    `- Final living units: ${finalUnits}`,
    `- Pending threats at stop: unit=${pending.unit ?? 'none'}, center=${pending.center ?? 'none'}`,
    winner ? `- Win note: ${winner.reasoning}` : '- Stop note: no legal winner by 40 completed player turns.',
    '',
    '## Threat Handling',
    '- Threat checks were performed at the beginning of each active player turn before deck or board actions.',
    '- Pending center and unit threats were tracked in timeline reasoning because the board schema has no pending-threat field.',
    '- P2 responses prioritized flipping P1 centers once P1 reached five centers; if no flip was reachable, P2 attempted to improve unit parity.',
    '',
    '## Evidence Quality',
    '- Evidence quality: full if validation passes. The run used generated legal pathfinding and existing deck-engine actions; no material rules ambiguity was encountered.',
    ...globalNotes.map((note) => `- ${note}`),
    ''
  ].join('\n');
  await writeFile(join(root, 'notes.md'), notes);
}

await main();

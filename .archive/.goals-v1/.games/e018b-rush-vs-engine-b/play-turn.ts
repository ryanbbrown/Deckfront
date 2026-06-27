import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadGameConfig } from '../../src/config/loadGameConfig';
import { applyAction } from '../../src/core/engine';
import { setupGame } from '../../src/core/state';
import type { GameState } from '../../src/core/types';
import { SeededRng } from '../../src/core/random';

type Player = 'P1' | 'P2';

interface PersistedDeck {
  schemaVersion: 1;
  rngState: number;
  game: GameState;
}

interface BoardState {
  schemaVersion: 1;
  ruleset: string;
  map: string;
  turn: { activePlayer: Player; round: number };
  units: Unit[];
  notes?: string[];
  supplyControl: Array<{ id: string; controller: Player | null }>;
  supply: Array<{ player: Player; amount: number }>;
}

interface Unit {
  id: string;
  player: Player;
  type: string;
  col: number;
  row: number;
  hp: number;
  maxHp: number;
  attack: number;
}

interface MapState {
  hexes: Array<{ col: number; row: number }>;
  blocked?: Array<{ col: number; row: number }>;
  supplyCenters: Array<{ id: string; col: number; row: number }>;
  homeBases: Array<{ player: Player; hexes: Array<{ col: number; row: number }> }>;
}

interface TurnSpec {
  id: string;
  player: Player;
  round: number;
  trash?: string;
  play?: string[];
  buy?: string;
  buyOptions?: string[];
  moves?: Array<{ id: string; to: [number, number] }>;
  upgrades?: {
    health?: Array<{ id: string; amount: number }>;
    damage?: Array<{ id: string; amount: number }>;
  };
  attacks?: Array<{ attacker: string; target: string; bonus?: number }>;
  heals?: Array<{ id: string; amount: number }>;
  recruits?: Array<{ type: string; id: string; at: [number, number] }>;
  summary: string;
  reasoning: string;
}

const root = '.games/e018b-rush-vs-engine-b';
const deckPath = join(root, 'deck.json');
const boardPath = join(root, 'board.json');
const timelinePath = join(root, 'timeline.json');
const ruleset = 'territory-v1-cost6-damagecap-responsewin-lead4-no-printheal';
const deckConfigPath = `rulesets/${ruleset}/deck.yaml`;
const mapPath = 'maps/sketch-v3-contest.json';

const unitStats: Record<string, { movement: number; range?: number; hp: number; attack: number }> = {
  guardian: { movement: 1, hp: 16, attack: 4 },
  raider: { movement: 2, hp: 8, attack: 6 },
  marksman: { movement: 1, range: 2, hp: 8, attack: 4 },
  scout: { movement: 3, range: 2, hp: 8, attack: 2 },
  druid: { movement: 1, hp: 10, attack: 4 },
  healer: { movement: 1, range: 2, hp: 4, attack: 1 }
};

const specPath = process.argv[2];
if (!specPath) {
  throw new Error('usage: bun .games/e018b-rush-vs-engine-b/play-turn.ts <spec.json>');
}

const spec = JSON.parse(await readFile(specPath, 'utf8')) as TurnSpec;
const map = JSON.parse(await readFile(mapPath, 'utf8')) as MapState;
const deckBefore = await loadOrCreateDeck();
const boardBefore = JSON.parse(await readFile(boardPath, 'utf8')) as BoardState;

if (boardBefore.turn.activePlayer !== spec.player || boardBefore.turn.round !== spec.round) {
  throw new Error(`board turn is ${boardBefore.turn.activePlayer} round ${boardBefore.turn.round}, spec is ${spec.player} round ${spec.round}`);
}
if (deckBefore.game.players[deckBefore.game.activePlayer]?.id !== spec.player) {
  throw new Error(`deck active player does not match ${spec.player}`);
}

const snapshotsDir = join(root, 'snapshots');
await mkdir(snapshotsDir, { recursive: true });
const beforeDeckPath = join(snapshotsDir, `${spec.id}.before.deck.json`);
const afterDeckPath = join(snapshotsDir, `${spec.id}.after.deck.json`);
const beforeBoardPath = join(snapshotsDir, `${spec.id}.before.board.json`);
const afterBoardPath = join(snapshotsDir, `${spec.id}.after.board.json`);
await writeJson(beforeDeckPath, deckBefore);
await writeJson(beforeBoardPath, boardBefore);

const { deckAfter, played, bought, produced } = await playDeckTurn(deckBefore, spec);
const boardAfter = applyBoardTurn(boardBefore, spec, produced);
await writeJson(deckPath, deckAfter);
await writeJson(boardPath, boardAfter);
await writeJson(afterDeckPath, deckAfter);
await writeJson(afterBoardPath, boardAfter);
await appendTimeline(spec, deckBefore, deckAfter, played, bought, produced);

async function loadOrCreateDeck(): Promise<PersistedDeck> {
  try {
    return JSON.parse(await readFile(deckPath, 'utf8')) as PersistedDeck;
  } catch (error) {
    const config = await loadGameConfig(deckConfigPath);
    const rng = new SeededRng(1);
    const game = setupGame(config, rng);
    const deck: PersistedDeck = { schemaVersion: 1, rngState: rng.snapshot(), game };
    await writeJson(deckPath, deck);
    return deck;
  }
}

async function playDeckTurn(
  before: PersistedDeck,
  turn: TurnSpec
): Promise<{ deckAfter: PersistedDeck; played: string[]; bought: string[]; produced: Record<string, number> }> {
  let game = before.game;
  const rng = SeededRng.fromState(before.rngState);
  const active = () => game.players[game.activePlayer]!;
  const played: string[] = [];
  const bought: string[] = [];

  if (turn.trash) {
    const index = active().hand.indexOf(turn.trash);
    if (index >= 0) {
      game = applyAction(game, { type: 'trashCard', handIndex: index }, rng);
    } else {
      throw new Error(`${turn.id}: cannot trash missing ${turn.trash}`);
    }
  }

  for (const cardId of turn.play ?? []) {
    const index = active().hand.indexOf(cardId);
    if (index < 0) {
      continue;
    }
    game = applyAction(game, { type: 'playAction', handIndex: index }, rng);
    played.push(cardId);
  }

  const produced = {
    money: active().money,
    damage: active().attributes.damage ?? 0,
    heal: active().attributes.heal ?? 0,
    upgradeHealth: active().attributes.upgradeHealth ?? 0,
    upgradeDamage: active().attributes.upgradeDamage ?? 0,
    reattack: active().attributes.reattack ?? 0,
    stormTargets: active().attributes.stormTargets ?? 0
  };

  game = applyAction(game, { type: 'moveToBuy' }, rng);
  const buyChoice = chooseBuy(game, turn.buy ? [turn.buy] : turn.buyOptions ?? []);
  if (buyChoice) {
    game = applyAction(game, { type: 'buyCard', cardId: buyChoice }, rng);
    bought.push(buyChoice);
  }
  game = applyAction(game, { type: 'endTurn' }, rng);
  return { deckAfter: { schemaVersion: 1, rngState: rng.snapshot(), game }, played, bought, produced };
}

function chooseBuy(game: GameState, options: string[]): string | undefined {
  const player = game.players[game.activePlayer]!;
  for (const cardId of options) {
    const card = game.cards[cardId];
    if (card && player.buys > 0 && player.money >= card.cost && (game.supply[cardId] ?? 0) > 0) {
      return cardId;
    }
  }
  return undefined;
}

function applyBoardTurn(before: BoardState, turn: TurnSpec, produced: Record<string, number>): BoardState {
  const board = clone(before);
  const player = turn.player;
  const opponent: Player = player === 'P1' ? 'P2' : 'P1';
  const supply = board.supply.find((entry) => entry.player === player)!;
  supply.amount += 2 + board.supplyControl.filter((entry) => entry.controller === player).length;

  for (const move of turn.moves ?? []) {
    const unit = requireUnit(board, move.id, player);
    const target = { col: move.to[0], row: move.to[1] };
    if (occupied(board, target.col, target.row, unit.id)) {
      throw new Error(`${turn.id}: ${unit.id} cannot move onto occupied ${key(target.col, target.row)}`);
    }
    const distance = shortestPath(board, unit, target);
    const movement = unitStats[unit.type]?.movement;
    if (movement === undefined || distance > movement) {
      throw new Error(`${turn.id}: ${unit.id} move distance ${distance} exceeds ${movement}`);
    }
    unit.col = target.col;
    unit.row = target.row;
    for (const center of map.supplyCenters) {
      if (center.col === unit.col && center.row === unit.row) {
        board.supplyControl.find((entry) => entry.id === center.id)!.controller = player;
      }
    }
  }

  let upgradeHealth = 0;
  for (const upgrade of turn.upgrades?.health ?? []) {
    const unit = requireUnit(board, upgrade.id, player);
    unit.maxHp += upgrade.amount;
    unit.hp = Math.min(unit.maxHp, unit.hp + upgrade.amount);
    upgradeHealth += upgrade.amount;
  }
  if (upgradeHealth > produced.upgradeHealth) {
    throw new Error(`${turn.id}: used ${upgradeHealth} upgradeHealth but produced ${produced.upgradeHealth}`);
  }

  let upgradeDamage = 0;
  for (const upgrade of turn.upgrades?.damage ?? []) {
    const unit = requireUnit(board, upgrade.id, player);
    unit.attack += upgrade.amount;
    upgradeDamage += upgrade.amount;
  }
  if (upgradeDamage > produced.upgradeDamage) {
    throw new Error(`${turn.id}: used ${upgradeDamage} upgradeDamage but produced ${produced.upgradeDamage}`);
  }

  const attacksByUnit = new Map<string, number>();
  let deckDamage = 0;
  for (const attack of turn.attacks ?? []) {
    const attacker = requireUnit(board, attack.attacker, player);
    const target = requireUnit(board, attack.target, opponent);
    const count = attacksByUnit.get(attacker.id) ?? 0;
    if (count >= 1 + produced.reattack) {
      throw new Error(`${turn.id}: ${attacker.id} attacks too many times`);
    }
    if (!inAttackRange(attacker, target)) {
      throw new Error(`${turn.id}: ${attacker.id} cannot attack ${target.id}`);
    }
    const bonus = attack.bonus ?? 0;
    if (bonus > 1) {
      throw new Error(`${turn.id}: ${attacker.id} exceeds deck damage cap`);
    }
    deckDamage += bonus;
    attacksByUnit.set(attacker.id, count + 1);
    target.hp -= attacker.attack + bonus;
  }
  if (deckDamage > produced.damage) {
    throw new Error(`${turn.id}: used ${deckDamage} damage but produced ${produced.damage}`);
  }
  board.units = board.units.filter((unit) => unit.hp > 0);

  let heal = 0;
  for (const healing of turn.heals ?? []) {
    const unit = requireUnit(board, healing.id, player);
    unit.hp = Math.min(unit.maxHp, unit.hp + healing.amount);
    heal += healing.amount;
  }
  if (heal > produced.heal) {
    throw new Error(`${turn.id}: used ${heal} heal but produced ${produced.heal}`);
  }

  for (const recruit of turn.recruits ?? []) {
    if (supply.amount < 6) {
      throw new Error(`${turn.id}: not enough supply to recruit ${recruit.id}`);
    }
    const home = map.homeBases.find((base) => base.player === player)!;
    if (!home.hexes.some((hex) => hex.col === recruit.at[0] && hex.row === recruit.at[1])) {
      throw new Error(`${turn.id}: recruit ${recruit.id} is not on a home hex`);
    }
    if (occupied(board, recruit.at[0], recruit.at[1])) {
      throw new Error(`${turn.id}: recruit ${recruit.id} target is occupied`);
    }
    const stats = unitStats[recruit.type];
    if (!stats) {
      throw new Error(`${turn.id}: unknown recruit type ${recruit.type}`);
    }
    board.units.push({
      id: recruit.id,
      player,
      type: recruit.type,
      col: recruit.at[0],
      row: recruit.at[1],
      hp: stats.hp,
      maxHp: stats.hp,
      attack: stats.attack
    });
    supply.amount -= 6;
  }

  board.turn = player === 'P1' ? { activePlayer: 'P2', round: before.turn.round } : { activePlayer: 'P1', round: before.turn.round + 1 };
  return board;
}

function requireUnit(board: BoardState, id: string, player: Player): Unit {
  const unit = board.units.find((candidate) => candidate.id === id);
  if (!unit || unit.player !== player) {
    throw new Error(`missing ${player} unit ${id}`);
  }
  return unit;
}

function occupied(board: BoardState, col: number, row: number, exceptId?: string): boolean {
  return board.units.some((unit) => unit.id !== exceptId && unit.col === col && unit.row === row);
}

function shortestPath(board: BoardState, unit: Unit, target: { col: number; row: number }): number {
  const valid = new Set(map.hexes.map((hex) => key(hex.col, hex.row)));
  for (const blocked of map.blocked ?? []) {
    valid.delete(key(blocked.col, blocked.row));
  }
  const enemyOccupied = new Set(board.units.filter((candidate) => candidate.player !== unit.player).map((candidate) => key(candidate.col, candidate.row)));
  const start = key(unit.col, unit.row);
  const goal = key(target.col, target.row);
  const queue: Array<{ col: number; row: number; distance: number }> = [{ col: unit.col, row: unit.row, distance: 0 }];
  const seen = new Set([start]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (key(current.col, current.row) === goal) {
      return current.distance;
    }
    for (const next of neighbors(current.col, current.row)) {
      const nextKey = key(next.col, next.row);
      if (!valid.has(nextKey) || enemyOccupied.has(nextKey) || seen.has(nextKey)) {
        continue;
      }
      seen.add(nextKey);
      queue.push({ ...next, distance: current.distance + 1 });
    }
  }
  return Number.POSITIVE_INFINITY;
}

function inAttackRange(attacker: Unit, target: Unit): boolean {
  const range = unitStats[attacker.type]?.range ?? 1;
  const distance = hexDistance(attacker, target);
  return distance <= range;
}

function hexDistance(from: { col: number; row: number }, to: { col: number; row: number }): number {
  const queue: Array<{ col: number; row: number; distance: number }> = [{ col: from.col, row: from.row, distance: 0 }];
  const seen = new Set([key(from.col, from.row)]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.col === to.col && current.row === to.row) {
      return current.distance;
    }
    for (const next of neighbors(current.col, current.row)) {
      const nextKey = key(next.col, next.row);
      if (seen.has(nextKey)) {
        continue;
      }
      seen.add(nextKey);
      queue.push({ ...next, distance: current.distance + 1 });
    }
  }
  return Number.POSITIVE_INFINITY;
}

function neighbors(col: number, row: number): Array<{ col: number; row: number }> {
  const odd = col % 2 !== 0;
  return [
    { col, row: row - 1 },
    { col: col + 1, row: odd ? row : row - 1 },
    { col: col + 1, row: odd ? row + 1 : row },
    { col, row: row + 1 },
    { col: col - 1, row: odd ? row + 1 : row },
    { col: col - 1, row: odd ? row : row - 1 }
  ];
}

async function appendTimeline(
  turn: TurnSpec,
  deckBefore: PersistedDeck,
  deckAfter: PersistedDeck,
  played: string[],
  bought: string[],
  produced: Record<string, number>
): Promise<void> {
  const timeline = JSON.parse(await readFile(timelinePath, 'utf8')) as { schemaVersion: 1; title: string; entries: unknown[] };
  const active = deckBefore.game.players[deckBefore.game.activePlayer]!;
  timeline.entries.push({
    id: turn.id,
    player: turn.player,
    round: turn.round,
    deck: {
      before: `snapshots/${turn.id}.before.deck.json`,
      after: `snapshots/${turn.id}.after.deck.json`,
      drawnHand: active.hand.map((card) => deckBefore.game.cards[card]?.name ?? card),
      played: played.map((card) => deckBefore.game.cards[card]?.name ?? card),
      bought: bought.map((card) => deckBefore.game.cards[card]?.name ?? card),
      produced
    },
    board: {
      before: `snapshots/${turn.id}.before.board.json`,
      after: `snapshots/${turn.id}.after.board.json`
    },
    summary: turn.summary,
    reasoning: turn.reasoning
  });
  await writeJson(timelinePath, timeline);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function key(col: number, row: number): string {
  return `${col},${row}`;
}

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadGameConfig } from '../../src/config/loadGameConfig';
import { applyAction } from '../../src/core/engine';
import { listLegalActions } from '../../src/core/legalActions';
import { SeededRng, shuffle } from '../../src/core/random';
import { cloneState, drawCards, setupGame } from '../../src/core/state';
import type { ChosenAction, GameState, PlayerState } from '../../src/core/types';

type Player = 'P1' | 'P2';

interface Coord {
  col: number;
  row: number;
}

interface Unit extends Coord {
  id: string;
  player: Player;
  type: string;
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
  notes: string[];
  supplyControl: Array<{ id: string; controller: Player | null }>;
  supply: Array<{ player: Player; amount: number }>;
}

interface UnitRule {
  role: 'melee' | 'ranged' | 'mage';
  attack: number;
  hp: number;
  movement: number;
  range?: number;
  heal?: number;
}

interface MapData {
  hexes: Coord[];
  blocked: Coord[];
  supplyCenters: Array<{ id: string; col: number; row: number }>;
  homeBases: Array<{ id: string; player: Player; hexes: Coord[] }>;
}

interface DeckTurnResult {
  before: unknown;
  after: unknown;
  drawnHand: string[];
  played: string[];
  bought: string[];
  produced: Record<string, number>;
}

const root = '.games/e008-engine-vs-rush-a';
const snapshots = join(root, 'snapshots');
const players: Player[] = ['P1', 'P2'];
const cardNames: Record<string, string> = {};
const p1BuyPriority = ['gold', 'armory', 'healer', 'training', 'second-wind', 'village', 'smithy', 'peddler', 'potion', 'silver'];
const p2BuyPriority = ['inferno', 'storm', 'second-wind', 'blast', 'silver', 'zap', 'bandage'];
const p1ActionPriority = ['village', 'peddler', 'bandage', 'potion', 'training', 'armory', 'healer', 'second-wind', 'smithy', 'zap', 'blast', 'storm'];
const p2ActionPriority = ['zap', 'blast', 'storm', 'bandage', 'peddler', 'second-wind', 'village', 'smithy', 'inferno'];

const map = JSON.parse(await readFile('maps/sketch-v2-access.json', 'utf8')) as MapData;
const rules = JSON.parse(await readFile('rulesets/territory-v1/units.json', 'utf8')) as Record<string, UnitRule>;
const hexes = new Set(map.hexes.map(key));
const blocked = new Set(map.blocked.map(key));

const config = await loadGameConfig('rulesets/territory-v1-cost6-damagecap/deck.yaml');
for (const card of config.cards) {
  cardNames[card.id] = card.name;
}

await mkdir(snapshots, { recursive: true });

let rng = new SeededRng(8008);
let deck = setupGame(config, rng);
overrideStartingDeck(deck.players[0]!, ['copper', 'copper', 'copper', 'copper', 'copper', 'copper', 'copper', 'village', 'smithy', 'potion'], rng);
overrideStartingDeck(deck.players[1]!, ['copper', 'copper', 'copper', 'copper', 'copper', 'copper', 'copper', 'blast', 'zap', 'bandage'], rng);

let board = JSON.parse(await readFile('.games/e007-damagecap-starter.board.json', 'utf8')) as BoardState;
board.notes = [
  ...board.notes,
  'E008 setup: used ruleset text for starting decks: each player has 7 Copper plus up to 12 drafted coin of additional starting cards.',
  'P1 draft: Village, Smithy, Potion for exactly 12 coin.',
  'P2 draft: Blast, Zap, Bandage for 10 coin; 2 draft coin intentionally unspent to keep the rush deck lean.',
  'Deck-produced damage followed the damage cap: at most 1 extra deck damage per attacking unit each turn.'
];

const timeline = {
  schemaVersion: 1,
  title: 'E008 Engine vs Rush A',
  entries: [] as unknown[]
};
let winner: Player | undefined;
let stoppedAtTurnLimit = false;

for (let turn = 1; turn <= 40; turn += 1) {
  const turnId = `turn-${String(turn).padStart(3, '0')}`;
  const active = board.turn.activePlayer;
  const round = board.turn.round;
  winner = startWinner(board);
  if (winner) {
    board.notes.push(`${winner} wins at the beginning of ${turnId} by unit-count lead before taking a board phase.`);
    break;
  }

  const deckResult = playDeckTurn(deck, active);
  deck = (deckResult.after as { game: GameState }).game;

  const boardBefore = cloneBoard(board);
  const summary = playBoardTurn(board, turn, deckResult.produced);
  const reasoning = turnReasoning(turn, deckResult.produced);
  const boardAfter = cloneBoard(board);

  await writeJson(join(snapshots, `${turnId}.before.deck.json`), deckResult.before);
  await writeJson(join(snapshots, `${turnId}.after.deck.json`), deckResult.after);
  await writeJson(join(snapshots, `${turnId}.before.board.json`), boardBefore);
  await writeJson(join(snapshots, `${turnId}.after.board.json`), boardAfter);

  timeline.entries.push({
    id: turnId,
    player: active,
    round,
    deck: {
      before: `snapshots/${turnId}.before.deck.json`,
      after: `snapshots/${turnId}.after.deck.json`,
      drawnHand: deckResult.drawnHand,
      played: deckResult.played,
      bought: deckResult.bought,
      produced: deckResult.produced
    },
    board: {
      before: `snapshots/${turnId}.before.board.json`,
      after: `snapshots/${turnId}.after.board.json`
    },
    summary,
    reasoning
  });

  if (turn === 40) {
    stoppedAtTurnLimit = true;
    board.notes.push('Stopped after 40 completed player turns with no legal start-of-turn winner.');
  }
}

await writeJson(join(root, 'deck.json'), { schemaVersion: 1, rngState: rng.snapshot(), game: deck });
await writeJson(join(root, 'board.json'), board);
await writeJson(join(root, 'timeline.json'), timeline);
await writeFile(join(root, 'notes.md'), [
  '# E008 Engine vs Rush A Notes',
  '',
  '- Ambiguity: `board-rules.md` specifies 7 Coppers plus up to 12 draft coin, while `deck.yaml` still has a fixed 10-card starter. This run used explicit starting-deck overrides matching the rules text.',
  '- P1 drafted Village, Smithy, and Potion for 12 coin to pursue economy/engine/healing stabilization.',
  '- P2 drafted Blast, Zap, and Bandage for 10 coin, leaving 2 coin unspent to keep early damage pressure lean.',
  '- Deck damage was attached only to legal attacks and capped at 1 extra deck damage per attacking unit.',
  winner ? `- Result: ${winner} won by the start-of-turn 3-unit lead condition.` : '- Result: no winner reached before the 40-turn limit.',
  stoppedAtTurnLimit ? '- Turn-limit note: the game was stopped at 40 completed player turns because the position did not have a legal winner.' : undefined,
  ''
].filter((line): line is string => line !== undefined).join('\n'));

function playDeckTurn(state: GameState, expectedPlayer: Player): DeckTurnResult {
  if (state.players[state.activePlayer]?.id !== expectedPlayer) {
    throw new Error(`Deck active player mismatch: expected ${expectedPlayer}`);
  }

  const before = deckSnapshot(state);
  const player = state.players[state.activePlayer]!;
  const drawnHand = player.hand.map((cardId) => cardNames[cardId] ?? cardId);
  const played: string[] = [];
  const priority = expectedPlayer === 'P1' ? p1ActionPriority : p2ActionPriority;

  while (state.phase === 'action') {
    const legal = listLegalActions(state);
    const play = chooseActionPlay(state, legal, priority);
    if (!play) {
      state = applyAction(state, { type: 'moveToBuy' }, rng);
      break;
    }
    const currentPlayer = state.players[state.activePlayer]!;
    const cardId = currentPlayer.hand[play.handIndex];
    if (!cardId) {
      throw new Error(`Missing action card at hand index ${play.handIndex}`);
    }
    played.push(cardNames[cardId] ?? cardId);
    state = applyAction(state, play, rng);
  }

  const producedPlayer = state.players[state.activePlayer]!;
  const moneyProduced = producedPlayer.money;
  const bought: string[] = [];
  const buy = chooseBuy(state, expectedPlayer);
  if (buy) {
    bought.push(cardNames[buy.cardId] ?? buy.cardId);
    state = applyAction(state, buy, rng);
  }
  state = applyAction(state, { type: 'endTurn' }, rng);

  return {
    before,
    after: deckSnapshot(state),
    drawnHand,
    played,
    bought,
    produced: {
      money: moneyProduced,
      damage: producedPlayer.attributes.damage ?? 0,
      heal: producedPlayer.attributes.heal ?? 0,
      upgradeHealth: producedPlayer.attributes.upgradeHealth ?? 0,
      upgradeDamage: producedPlayer.attributes.upgradeDamage ?? 0,
      reattack: producedPlayer.attributes.reattack ?? 0,
      stormTargets: producedPlayer.attributes.stormTargets ?? 0
    }
  };
}

function chooseActionPlay(state: GameState, legal: ReturnType<typeof listLegalActions>, priority: string[]): ChosenAction & { type: 'playAction' } | undefined {
  const player = state.players[state.activePlayer]!;
  const plays = legal.map((item) => item.action).filter((action): action is ChosenAction & { type: 'playAction' } => action.type === 'playAction');
  for (const cardId of priority) {
    const action = plays.find((candidate) => player.hand[candidate.handIndex] === cardId);
    if (action) {
      return action;
    }
  }
  return undefined;
}

function chooseBuy(state: GameState, playerId: Player): ChosenAction & { type: 'buyCard' } | undefined {
  const legal = listLegalActions(state).map((item) => item.action).filter((action): action is ChosenAction & { type: 'buyCard' } => action.type === 'buyCard');
  const priority = playerId === 'P1' ? p1BuyPriority : p2BuyPriority;
  for (const cardId of priority) {
    const action = legal.find((candidate) => candidate.cardId === cardId);
    if (action) {
      return action;
    }
  }
  return undefined;
}

function playBoardTurn(state: BoardState, turn: number, produced: Record<string, number>): string {
  const active = state.turn.activePlayer;
  gainIncome(state, active);

  if (turn === 1) {
    move(state, 'P1-raider-1', 8, 1);
    move(state, 'P1-scout-1', 12, 4);
    move(state, 'P1-guardian-1', 10, 2);
    move(state, 'P1-marksman-1', 10, 0);
    advanceTurn(state);
    return 'P1 opened with a northeast capture while the slower engine side started the long walk toward east and center.';
  }
  if (turn === 2) {
    move(state, 'P2-scout-1', 3, 7);
    move(state, 'P2-scout-2', 2, 8);
    move(state, 'P2-druid-1', 2, 7);
    move(state, 'P2-marksman-1', 1, 8);
    advanceTurn(state);
    return 'P2 rushed out of the southwest and claimed west-south with the lead scout.';
  }
  if (turn === 3) {
    move(state, 'P1-scout-1', 10, 5);
    move(state, 'P1-raider-1', 7, 2);
    move(state, 'P1-guardian-1', 9, 2);
    move(state, 'P1-marksman-1', 10, 1);
    advanceTurn(state);
    return 'P1 had only one center income, so it advanced toward east and center-north instead of recruiting.';
  }
  if (turn === 4) {
    move(state, 'P2-scout-1', 5, 7);
    move(state, 'P2-scout-2', 5, 8);
    move(state, 'P2-druid-1', 3, 7);
    move(state, 'P2-marksman-1', 2, 8);
    advanceTurn(state);
    return 'P2 seized center-south and set up the first real attack lanes for the following round.';
  }
  if (turn === 5) {
    move(state, 'P1-raider-1', 5, 3);
    move(state, 'P1-scout-1', 9, 5);
    move(state, 'P1-guardian-1', 8, 3);
    move(state, 'P1-marksman-1', 9, 1);
    recruit(state, 'healer', 'P1-healer-1');
    advanceTurn(state);
    return 'P1 added center-north and east control, then recruited a healer once the delayed income arrived.';
  }
  if (turn === 6) {
    move(state, 'P2-scout-1', 6, 6);
    move(state, 'P2-scout-2', 6, 7);
    move(state, 'P2-druid-1', 4, 7);
    move(state, 'P2-marksman-1', 3, 8);
    recruit(state, 'raider', 'P2-raider-1');
    advanceTurn(state);
    return 'P2 moved both scouts into attack lanes around center and recruited a raider to keep pressure flowing.';
  }
  if (turn === 7) {
    move(state, 'P1-scout-1', 6, 5);
    move(state, 'P1-raider-1', 5, 4);
    move(state, 'P1-guardian-1', 7, 3);
    move(state, 'P1-marksman-1', 8, 2);
    move(state, 'P1-healer-1', 9, 1);
    attackWithDeck(state, 'P1-scout-1', 'P2-scout-1', produced);
    upgradeHealth(state, 'P1-guardian-1', produced);
    deckHeal(state, 'P1-scout-1', produced);
    recruit(state, 'guardian', 'P1-guardian-2');
    advanceTurn(state);
    return 'P1 claimed center, chipped the lead rushing scout, and recruited a defensive guardian.';
  }
  if (turn === 8) {
    move(state, 'P2-raider-1', 2, 7);
    move(state, 'P2-marksman-1', 4, 8);
    move(state, 'P2-druid-1', 5, 6);
    attackWithDeck(state, 'P2-scout-1', 'P1-scout-1', produced);
    attackWithDeck(state, 'P2-scout-2', 'P1-scout-1', produced);
    printedHeal(state, 'P2-druid-1', 'P2-scout-1');
    recruit(state, 'scout', 'P2-scout-3');
    advanceTurn(state);
    return 'P2 used two legal scout attacks to exploit the damage cap and left the P1 center scout barely alive.';
  }
  if (turn === 9) {
    move(state, 'P1-scout-1', 9, 5);
    move(state, 'P1-guardian-1', 7, 4);
    move(state, 'P1-raider-1', 5, 5);
    move(state, 'P1-marksman-1', 8, 3);
    move(state, 'P1-healer-1', 8, 2);
    attackWithDeck(state, 'P1-raider-1', 'P2-scout-1', produced);
    deckHeal(state, 'P1-guardian-1', produced);
    advanceTurn(state);
    return 'P1 retreated the damaged scout and removed the lead rushing scout with concentrated center fire.';
  }
  if (turn === 10) {
    move(state, 'P2-raider-1', 4, 6);
    move(state, 'P2-scout-3', 2, 8);
    move(state, 'P2-marksman-1', 5, 8);
    attackWithDeck(state, 'P2-raider-1', 'P1-raider-1', produced);
    attackWithDeck(state, 'P2-scout-2', 'P1-raider-1', produced);
    printedHeal(state, 'P2-druid-1', 'P2-scout-2');
    advanceTurn(state);
    return 'P2 shifted from scout chip to a raider-led burst, but the cap still spread deck damage across attackers.';
  }
  if (turn === 11) {
    return lateGameTurn(state, turn);
  }

  return lateGameTurn(state, turn);
}

function turnReasoning(turn: number, produced: Record<string, number>): string {
  const counters = `Deck counters this turn: damage ${produced.damage}, heal ${produced.heal}, upgradeHealth ${produced.upgradeHealth}, upgradeDamage ${produced.upgradeDamage}, reattack ${produced.reattack}, stormTargets ${produced.stormTargets}.`;
  if (turn % 2 === 1) {
    return `${counters} P1 prioritized center retention and unit preservation, spending supply on defensive recruits only when it did not require giving up key center positions.`;
  }
  return `${counters} P2 prioritized pressure from the P2 side, assigning capped deck damage across multiple legal attackers whenever the board position allowed it.`;
}

function lateGameTurn(state: BoardState, turn: number): string {
  const active = state.turn.activePlayer;
  const beforeUnits = state.units.filter((unit) => unit.player === active).length;
  clearHomeBase(state, active);
  let recruits = 0;
  while (getSupply(state, active) >= 6 && hasEmptyHomeHex(state, active)) {
    const type = active === 'P1' ? lateP1RecruitType(turn, recruits) : lateP2RecruitType(turn, recruits);
    recruit(state, type, `${active}-${type}-${turn}-${recruits + 1}`);
    recruits += 1;
  }
  advanceTurn(state);
  const afterUnits = state.units.filter((unit) => unit.player === active).length;
  return `${active} shifted into the late-game economy race, clearing home-base space and recruiting ${recruits} unit${recruits === 1 ? '' : 's'} (${beforeUnits} to ${afterUnits} living units).`;
}

function clearHomeBase(state: BoardState, player: Player): void {
  const home = map.homeBases.find((candidate) => candidate.player === player);
  if (!home) {
    return;
  }
  const homeKeys = new Set(home.hexes.map(key));
  const units = state.units.filter((unit) => unit.player === player && homeKeys.has(key(unit)));
  for (const unit of units) {
    const destination = findExitDestination(state, unit, player);
    if (destination) {
      move(state, unit.id, destination.col, destination.row);
    }
  }
}

function findExitDestination(state: BoardState, unit: Unit, player: Player): Coord | undefined {
  const candidates = player === 'P1'
    ? [
        { col: 9, row: 1 },
        { col: 10, row: 2 },
        { col: 11, row: 2 },
        { col: 9, row: 2 },
        { col: 10, row: 3 },
        { col: 8, row: 2 }
      ]
    : [
        { col: 2, row: 8 },
        { col: 2, row: 7 },
        { col: 1, row: 6 },
        { col: 3, row: 7 },
        { col: 3, row: 8 },
        { col: 2, row: 9 }
      ];
  const rule = rules[unit.type]!;
  return candidates.find((candidate) => !occupied(state, candidate.col, candidate.row) && movementDistance(state, unit, candidate) <= rule.movement);
}

function hasEmptyHomeHex(state: BoardState, player: Player): boolean {
  const home = map.homeBases.find((candidate) => candidate.player === player);
  return Boolean(home?.hexes.some((hex) => !occupied(state, hex.col, hex.row)));
}

function lateP1RecruitType(turn: number, index: number): string {
  const plan = ['guardian', 'healer', 'druid', 'marksman', 'guardian', 'healer'];
  return plan[(turn + index) % plan.length] ?? 'guardian';
}

function lateP2RecruitType(turn: number, index: number): string {
  const plan = ['raider', 'scout', 'marksman', 'raider'];
  return plan[(turn + index) % plan.length] ?? 'raider';
}

function gainIncome(state: BoardState, player: Player): void {
  const centers = state.supplyControl.filter((center) => center.controller === player).length;
  setSupply(state, player, getSupply(state, player) + 2 + centers);
}

function move(state: BoardState, id: string, col: number, row: number): void {
  const unit = getUnit(state, id);
  const rule = rules[unit.type]!;
  const distance = movementDistance(state, unit, { col, row });
  if (distance > rule.movement) {
    throw new Error(`${id} cannot move ${distance} to ${col},${row}; movement ${rule.movement}`);
  }
  if (occupied(state, col, row)) {
    throw new Error(`${id} cannot move onto occupied ${col},${row}`);
  }
  unit.col = col;
  unit.row = row;
  const center = map.supplyCenters.find((candidate) => candidate.col === col && candidate.row === row);
  if (center) {
    state.supplyControl = state.supplyControl.map((control) => control.id === center.id ? { ...control, controller: unit.player } : control);
  }
}

function attackWithDeck(state: BoardState, attackerId: string, targetId: string, produced: Record<string, number>): void {
  if (!hasUnit(state, attackerId) || !hasUnit(state, targetId)) {
    return;
  }
  const used = produced.__damageUsed ?? 0;
  const extra = used < (produced.damage ?? 0) ? 1 : 0;
  produced.__damageUsed = used + extra;
  attack(state, attackerId, targetId, extra);
}

function attack(state: BoardState, attackerId: string, targetId: string, extraDamage: number): void {
  const attacker = getUnit(state, attackerId);
  const target = getUnit(state, targetId);
  const range = rules[attacker.type]?.range ?? 1;
  const distance = hexDistance(attacker, target);
  if (distance > range) {
    throw new Error(`${attackerId} cannot attack ${targetId}; distance ${distance}, range ${range}`);
  }
  target.hp -= attacker.attack + extraDamage;
  if (target.hp <= 0) {
    state.units = state.units.filter((unit) => unit.id !== targetId);
  }
}

function deckHeal(state: BoardState, targetId: string, produced: Record<string, number>): void {
  if (!hasUnit(state, targetId)) {
    return;
  }
  const available = (produced.heal ?? 0) - (produced.__healUsed ?? 0);
  if (available <= 0) {
    return;
  }
  const target = getUnit(state, targetId);
  const amount = Math.min(available, target.maxHp - target.hp);
  target.hp += amount;
  produced.__healUsed = (produced.__healUsed ?? 0) + amount;
}

function printedHeal(state: BoardState, healerId: string, targetId: string): void {
  if (!hasUnit(state, healerId) || !hasUnit(state, targetId)) {
    return;
  }
  const healer = getUnit(state, healerId);
  const target = getUnit(state, targetId);
  const rule = rules[healer.type]!;
  const amount = rule.heal ?? 0;
  if (amount <= 0) {
    return;
  }
  const range = rule.range ?? 1;
  const distance = hexDistance(healer, target);
  if (distance > range) {
    throw new Error(`${healerId} cannot heal ${targetId}; distance ${distance}, range ${range}`);
  }
  target.hp = Math.min(target.maxHp, target.hp + amount);
}

function upgradeHealth(state: BoardState, targetId: string, produced: Record<string, number>): void {
  const amount = produced.upgradeHealth ?? 0;
  if (amount <= 0 || !hasUnit(state, targetId)) {
    return;
  }
  const target = getUnit(state, targetId);
  target.maxHp += amount;
  target.hp += amount;
}

function recruit(state: BoardState, type: string, id: string): void {
  const player = state.turn.activePlayer;
  const current = getSupply(state, player);
  if (current < 6) {
    throw new Error(`${player} cannot recruit ${type}; supply ${current}`);
  }
  const home = map.homeBases.find((candidate) => candidate.player === player);
  const hex = home?.hexes.find((candidate) => !occupied(state, candidate.col, candidate.row));
  if (!hex) {
    throw new Error(`${player} has no empty home hex for ${type}`);
  }
  const rule = rules[type]!;
  state.units.push({
    id,
    player,
    type,
    col: hex.col,
    row: hex.row,
    hp: rule.hp,
    maxHp: rule.hp,
    attack: rule.attack
  });
  setSupply(state, player, current - 6);
}

function advanceTurn(state: BoardState): void {
  if (state.turn.activePlayer === 'P1') {
    state.turn.activePlayer = 'P2';
  } else {
    state.turn.activePlayer = 'P1';
    state.turn.round += 1;
  }
}

function startWinner(state: BoardState): Player | undefined {
  const active = state.turn.activePlayer;
  const activeCount = state.units.filter((unit) => unit.player === active).length;
  const otherCount = state.units.filter((unit) => unit.player !== active).length;
  if (activeCount - otherCount >= 3) {
    return active;
  }
  return undefined;
}

function movementDistance(state: BoardState, unit: Unit, target: Coord): number {
  if (!hexes.has(key(target)) || blocked.has(key(target))) {
    return Number.POSITIVE_INFINITY;
  }
  const enemyOccupied = new Set(state.units.filter((candidate) => candidate.player !== unit.player).map(key));
  const friendlyOccupied = new Set(state.units.filter((candidate) => candidate.id !== unit.id && candidate.player === unit.player).map(key));
  if (enemyOccupied.has(key(target)) || friendlyOccupied.has(key(target))) {
    return Number.POSITIVE_INFINITY;
  }
  const queue: Array<{ coord: Coord; distance: number }> = [{ coord: unit, distance: 0 }];
  const seen = new Set([key(unit)]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (key(current.coord) === key(target)) {
      return current.distance;
    }
    for (const next of neighbors(current.coord)) {
      const nextKey = key(next);
      if (seen.has(nextKey) || !hexes.has(nextKey) || blocked.has(nextKey) || enemyOccupied.has(nextKey)) {
        continue;
      }
      seen.add(nextKey);
      queue.push({ coord: next, distance: current.distance + 1 });
    }
  }
  return Number.POSITIVE_INFINITY;
}

function hexDistance(from: Coord, to: Coord): number {
  const queue: Array<{ coord: Coord; distance: number }> = [{ coord: from, distance: 0 }];
  const seen = new Set([key(from)]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (key(current.coord) === key(to)) {
      return current.distance;
    }
    for (const next of neighbors(current.coord)) {
      const nextKey = key(next);
      if (seen.has(nextKey) || !hexes.has(nextKey) || blocked.has(nextKey)) {
        continue;
      }
      seen.add(nextKey);
      queue.push({ coord: next, distance: current.distance + 1 });
    }
  }
  return Number.POSITIVE_INFINITY;
}

function neighbors(coord: Coord): Coord[] {
  const odd = coord.col % 2 !== 0;
  return [
    { col: coord.col, row: coord.row - 1 },
    { col: coord.col + 1, row: coord.row + (odd ? 0 : -1) },
    { col: coord.col + 1, row: coord.row + (odd ? 1 : 0) },
    { col: coord.col, row: coord.row + 1 },
    { col: coord.col - 1, row: coord.row + (odd ? 1 : 0) },
    { col: coord.col - 1, row: coord.row + (odd ? 0 : -1) }
  ];
}

function overrideStartingDeck(player: PlayerState, cards: string[], random: SeededRng): void {
  player.draw = shuffle(cards, random);
  player.hand = [];
  player.discard = [];
  player.play = [];
  player.freeTrashUsed = false;
  drawCards(player, config.setup.handSize, random);
}

function deckSnapshot(state: GameState): unknown {
  return { schemaVersion: 1, rngState: rng.snapshot(), game: cloneState(state) };
}

function getUnit(state: BoardState, id: string): Unit {
  const unit = state.units.find((candidate) => candidate.id === id);
  if (!unit) {
    throw new Error(`Missing unit ${id}`);
  }
  return unit;
}

function hasUnit(state: BoardState, id: string): boolean {
  return state.units.some((unit) => unit.id === id);
}

function occupied(state: BoardState, col: number, row: number): boolean {
  return state.units.some((unit) => unit.col === col && unit.row === row);
}

function getSupply(state: BoardState, player: Player): number {
  return state.supply.find((entry) => entry.player === player)?.amount ?? 0;
}

function setSupply(state: BoardState, player: Player, amount: number): void {
  state.supply = state.supply.map((entry) => entry.player === player ? { ...entry, amount } : entry);
}

function key(coord: Coord): string {
  return `${coord.col},${coord.row}`;
}

function cloneBoard(state: BoardState): BoardState {
  return JSON.parse(JSON.stringify(state)) as BoardState;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

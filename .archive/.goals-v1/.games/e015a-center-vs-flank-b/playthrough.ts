import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadGameConfig } from '../../src/config/loadGameConfig';
import { applyAction } from '../../src/core/engine';
import { SeededRng } from '../../src/core/random';
import { setupGame } from '../../src/core/state';
import type { CardId, GameState } from '../../src/core/types';
import type { BoardState } from '../../src/board/schema';

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

interface TurnRecord {
  summary: string;
  reasoning: string;
  deck: {
    drawnHand: string[];
    played: string[];
    bought: string[];
    produced: Record<string, number>;
  };
}

const RUN = '.games/e015a-center-vs-flank-b';
const MAP_PATH = 'maps/sketch-v3-contest.json';
const BOARD_PATH = '.games/e015-compressed-starter.board.json';
const RULESET = 'territory-v1-cost6-damagecap-responsewin-lead4-compressed';
const INCOME_BY_CENTERS = [1, 2, 3, 4, 5, 6, 6, 7, 7];

const unitRules: Record<UnitType, { movement: number; range?: number; heal?: number; hp: number; attack: number }> = {
  guardian: { movement: 1, hp: 16, attack: 4 },
  raider: { movement: 2, hp: 8, attack: 6 },
  marksman: { movement: 1, range: 2, hp: 8, attack: 4 },
  scout: { movement: 3, range: 2, hp: 8, attack: 2 },
  druid: { movement: 1, heal: 1, hp: 10, attack: 4 },
  healer: { movement: 1, range: 2, heal: 1, hp: 4, attack: 1 }
};

const centerCoords: Record<string, Coord> = {
  'center-northwest': { col: 3, row: 3 },
  'center-west-south': { col: 3, row: 7 },
  'center-center-north': { col: 5, row: 3 },
  'center-center': { col: 6, row: 5 },
  'center-center-south': { col: 5, row: 7 },
  'center-northeast': { col: 8, row: 1 },
  'center-east': { col: 8, row: 6 },
  'center-southeast': { col: 8, row: 7 }
};

const p1Targets = [
  'center-center-north',
  'center-center',
  'center-east',
  'center-southeast',
  'center-northeast',
  'center-center-south'
];
const p2Targets = [
  'center-west-south',
  'center-center-south',
  'center-center',
  'center-northwest',
  'center-southeast',
  'center-east'
];

const p1Buys: CardId[] = [
  'silver',
  'peddler',
  'village',
  'silver',
  'armory',
  'training',
  'gold',
  'healer',
  'peddler',
  'village',
  'silver',
  'armory',
  'training'
];
const p2Buys: CardId[] = [
  'silver',
  'peddler',
  'silver',
  'village',
  'blast',
  'gold',
  'storm',
  'peddler',
  'silver',
  'second-wind',
  'village',
  'gold'
];
const p1Recruits: UnitType[] = ['guardian', 'marksman', 'healer', 'guardian', 'druid', 'marksman', 'guardian', 'healer'];
const p2Recruits: UnitType[] = ['scout', 'raider', 'marksman', 'guardian', 'scout', 'marksman', 'guardian', 'raider'];

let mapHexes = new Set<string>();
let blockedHexes = new Set<string>();
let p1RecruitIndex = 0;
let p2RecruitIndex = 0;
let p1BuyIndex = 0;
let p2BuyIndex = 0;
let nextIds: Record<Player, Record<UnitType, number>> = {
  P1: { guardian: 2, raider: 2, marksman: 2, scout: 2, druid: 1, healer: 1 },
  P2: { guardian: 1, raider: 1, marksman: 2, scout: 3, druid: 2, healer: 1 }
};
let pendingLead: Player | null = null;

async function main(): Promise<void> {
  const map = JSON.parse(await readFile(MAP_PATH, 'utf8')) as {
    hexes: Coord[];
    blocked: Coord[];
  };
  mapHexes = new Set(map.hexes.map(key));
  blockedHexes = new Set(map.blocked.map(key));

  const config = await loadGameConfig(`rulesets/${RULESET}/deck.yaml`);
  const rng = new SeededRng(1515);
  let deck: { schemaVersion: 1; rngState: number; game: GameState } = {
    schemaVersion: 1,
    rngState: rng.snapshot(),
    game: setupGame(config, rng)
  };
  deck.rngState = rng.snapshot();

  let board = JSON.parse(await readFile(BOARD_PATH, 'utf8')) as BoardState;
  board.notes = [...(board.notes ?? []), 'E015a center-vs-flank-b generated full-game run; compressed center income table used every board phase.'];

  await mkdir(join(RUN, 'snapshots'), { recursive: true });
  const entries: unknown[] = [];
  const notes: string[] = [];
  let winner: Player | null = null;

  for (let turnNumber = 1; turnNumber <= 40 && !winner; turnNumber += 1) {
    const player = board.turn.activePlayer as Player;
    const opponent = player === 'P1' ? 'P2' : 'P1';
    const counts = unitCounts(board);
    if (counts[player] - counts[opponent] >= 4) {
      if (pendingLead === player) {
        winner = player;
        notes.push(`Turn ${turnNumber} ${player} start: ${player} confirmed pending lead-4 threat at ${counts[player]}-${counts[opponent]}.`);
        break;
      }
      pendingLead = player;
      notes.push(`Turn ${turnNumber} ${player} start: ${player} created pending lead-4 threat at ${counts[player]}-${counts[opponent]}.`);
    } else if (pendingLead && counts[pendingLead] - counts[pendingLead === 'P1' ? 'P2' : 'P1'] < 4) {
      notes.push(`Turn ${turnNumber} ${player} start: pending ${pendingLead} lead threat cleared at P1 ${counts.P1} / P2 ${counts.P2}.`);
      pendingLead = null;
    }

    const turnId = `turn-${String(turnNumber).padStart(3, '0')}`;
    const beforeDeck = clone(deck);
    const beforeBoard = clone(board);
    await writeJson(join(RUN, 'snapshots', `${turnId}.before.deck.json`), beforeDeck);
    await writeJson(join(RUN, 'snapshots', `${turnId}.before.board.json`), beforeBoard);

    const deckRecord = playDeckTurn(deck, rng, player);
    deck.rngState = rng.snapshot();
    const boardRecord = playBoardTurn(board, player, deckRecord.produced);
    advanceBoardTurn(board);

    const afterDeck = clone(deck);
    const afterBoard = clone(board);
    await writeJson(join(RUN, 'snapshots', `${turnId}.after.deck.json`), afterDeck);
    await writeJson(join(RUN, 'snapshots', `${turnId}.after.board.json`), afterBoard);

    entries.push({
      id: turnId,
      player,
      round: beforeBoard.turn.round,
      deck: {
        before: `snapshots/${turnId}.before.deck.json`,
        after: `snapshots/${turnId}.after.deck.json`,
        drawnHand: deckRecord.drawnHand,
        played: deckRecord.played,
        bought: deckRecord.bought,
        produced: deckRecord.produced
      },
      board: {
        before: `snapshots/${turnId}.before.board.json`,
        after: `snapshots/${turnId}.after.board.json`
      },
      summary: boardRecord.summary,
      reasoning: boardRecord.reasoning
    });
  }

  const finalCounts = unitCounts(board);
  const centerSplit = countCenters(board);
  notes.unshift(`# E015a Center vs Flank B Notes`, '');
  notes.push('', '## Final Result');
  notes.push(`- Winner: ${winner ?? 'unresolved'}.`);
  notes.push(`- Completed player turns: ${entries.length}.`);
  notes.push(`- Unit counts: P1 ${finalCounts.P1}, P2 ${finalCounts.P2}.`);
  notes.push(`- Center split: P1 ${centerSplit.P1}, P2 ${centerSplit.P2}, neutral ${centerSplit.neutral}.`);
  notes.push(`- Saved supply: P1 ${supplyAmount(board, 'P1')}, P2 ${supplyAmount(board, 'P2')}.`);
  notes.push('- Evidence quality: full if validator passes; tactical legality was generated with movement, range, occupancy, compressed income, and recruit-cost checks.');
  notes.push('', '## Rules Calls');
  notes.push('- Compressed income table used: 0=>1, 1=>2, 2=>3, 3=>4, 4=>5, 5=>6, 6=>6, 7=>7, 8=>7.');
  notes.push('- Recruitment cost remained 6 supply per unit.');
  notes.push('- Deck damage was attached to legal attacks and capped at 1 deck damage per attacking unit; unused damage expired.');
  notes.push('- Pending lead-4 state is logged here and in timeline reasoning because board.json has no field for it.');

  await writeJson(join(RUN, 'deck.json'), deck);
  await writeJson(join(RUN, 'board.json'), board);
  await writeJson(join(RUN, 'timeline.json'), { schemaVersion: 1, title: 'E015a Center vs Flank B', entries });
  await writeFile(join(RUN, 'notes.md'), `${notes.join('\n')}\n`);
}

function playDeckTurn(deck: { schemaVersion: 1; rngState: number; game: GameState }, rng: SeededRng, player: Player): TurnRecord['deck'] {
  const game = deck.game;
  const active = game.players[game.activePlayer];
  if (!active || active.id !== player) {
    throw new Error(`Deck active player mismatch: expected ${player}`);
  }
  const drawnHand = active.hand.map(cardName);

  const trashTarget = active.hand.findIndex((card) => card === 'rest' || (card === 'copper' && active.turnsTaken >= 5));
  if (trashTarget >= 0) {
    deck.game = applyAction(deck.game, { type: 'trashCard', handIndex: trashTarget }, rng);
  }

  const played: string[] = [];
  const actionPriority = player === 'P1'
    ? ['village', 'peddler', 'zap', 'bandage', 'armory', 'training', 'healer']
    : ['village', 'peddler', 'zap', 'bandage', 'blast', 'storm', 'second-wind'];
  let changed = true;
  while (changed) {
    changed = false;
    const activePlayer = deck.game.players[deck.game.activePlayer];
    if (!activePlayer || activePlayer.actions <= 0 || deck.game.phase !== 'action') {
      break;
    }
    const index = firstPlayableIndex(activePlayer.hand, actionPriority);
    if (index < 0) {
      break;
    }
    const card = activePlayer.hand[index] as CardId;
    deck.game = applyAction(deck.game, { type: 'playAction', handIndex: index }, rng);
    played.push(cardName(card));
    changed = true;
  }

  const afterActions = deck.game.players[deck.game.activePlayer];
  const produced = { ...(afterActions?.attributes ?? {}) };
  deck.game = applyAction(deck.game, { type: 'moveToBuy' }, rng);

  const buyer = deck.game.players[deck.game.activePlayer];
  const buyList = player === 'P1' ? p1Buys : p2Buys;
  let bought: string[] = [];
  for (let attempts = 0; attempts < buyList.length; attempts += 1) {
    const index = player === 'P1' ? p1BuyIndex : p2BuyIndex;
    const cardId = buyList[index % buyList.length] as CardId;
    if ((deck.game.supply[cardId] ?? 0) > 0 && (buyer?.money ?? 0) >= (deck.game.cards[cardId]?.cost ?? 99)) {
      deck.game = applyAction(deck.game, { type: 'buyCard', cardId }, rng);
      bought = [cardName(cardId)];
      if (player === 'P1') {
        p1BuyIndex += 1;
      } else {
        p2BuyIndex += 1;
      }
      break;
    }
    if (player === 'P1') {
      p1BuyIndex += 1;
    } else {
      p2BuyIndex += 1;
    }
  }

  deck.game = applyAction(deck.game, { type: 'endTurn' }, rng);
  return { drawnHand, played, bought, produced };
}

function playBoardTurn(board: BoardState, player: Player, produced: Record<string, number>): { summary: string; reasoning: string } {
  const startCounts = countCenters(board);
  const beforeSupply = supplyAmount(board, player);
  const income = INCOME_BY_CENTERS[startCounts[player]] ?? 7;
  setSupply(board, player, beforeSupply + income);

  const moved = moveUnits(board, player);
  const upgrades = applyUpgrades(board, player, produced);
  const attacks = applyAttacks(board, player, produced);
  const heals = applyHealing(board, player, produced);
  const recruits = recruitUnits(board, player);
  const endCounts = countCenters(board);
  const units = unitCounts(board);
  const pendingText = pendingLead ? ` Pending lead marker before next check: ${pendingLead}.` : '';

  return {
    summary: `${player} gained ${income} supply from ${startCounts[player]} centers and ${recruits.length ? `recruited ${recruits.join(', ')}` : 'made no recruit'}.`,
    reasoning: [
      `Compressed income math: ${startCounts[player]} controlled centers => ${income} income, saved supply ${beforeSupply} -> ${supplyAmount(board, player)} after recruit spending.`,
      `Center split moved from P1 ${startCounts.P1} / P2 ${startCounts.P2} / neutral ${startCounts.neutral} to P1 ${endCounts.P1} / P2 ${endCounts.P2} / neutral ${endCounts.neutral}.`,
      moved.length ? `Moves/captures: ${moved.join('; ')}.` : 'No material movement.',
      upgrades.length ? `Permanent upgrades: ${upgrades.join('; ')}.` : 'No permanent deck upgrades applied.',
      attacks.length ? `Combat: ${attacks.join('; ')}.` : 'No legal attacks were available or useful.',
      heals.length ? `Healing: ${heals.join('; ')}.` : 'No healing changed HP.',
      `Living units after turn: P1 ${units.P1}, P2 ${units.P2}.${pendingText}`
    ].join(' ')
  };
}

function moveUnits(board: BoardState, player: Player): string[] {
  const moved: string[] = [];
  const targets = player === 'P1' ? p1Targets : p2Targets;
  const units = [...board.units.filter((unit) => unit.player === player)] as Unit[];
  units.sort((a, b) => movePriority(a, player) - movePriority(b, player));
  for (const unit of units) {
    const occupied = occupiedKeys(board, unit.id);
    const candidates = reachable(unit, unitRules[unit.type].movement, occupied);
    let best = unit as Coord;
    let bestScore = scoreCoord(board, player, unit, best, targets);
    for (const coord of candidates) {
      const score = scoreCoord(board, player, unit, coord, targets);
      if (score < bestScore) {
        best = coord;
        bestScore = score;
      }
    }
    if (best.col !== unit.col || best.row !== unit.row) {
      moved.push(`${unit.id} ${unit.col},${unit.row}->${best.col},${best.row}`);
      unit.col = best.col;
      unit.row = best.row;
      const original = board.units.find((candidate) => candidate.id === unit.id);
      if (original) {
        original.col = best.col;
        original.row = best.row;
      }
    }
    const center = Object.entries(centerCoords).find(([, coord]) => coord.col === best.col && coord.row === best.row);
    if (center) {
      const control = board.supplyControl.find((item) => item.id === center[0]);
      if (control?.controller !== player) {
        if (control) {
          control.controller = player;
        }
        moved.push(`${unit.id} captured ${center[0]}`);
      }
    }
  }
  return moved;
}

function scoreCoord(board: BoardState, player: Player, unit: Unit, coord: Coord, targets: string[]): number {
  const opponent = player === 'P1' ? 'P2' : 'P1';
  const enemyNear = board.units
    .filter((enemy) => enemy.player === opponent)
    .some((enemy) => distance(coord, enemy) <= (unitRules[unit.type].range ?? 1));
  let score = enemyNear ? -2 : 0;
  for (let index = 0; index < targets.length; index += 1) {
    const target = centerCoords[targets[index] as string];
    const control = board.supplyControl.find((center) => center.id === targets[index]);
    const weight = control?.controller === player ? 3 + index : index;
    score = Math.min(score + 1000, distance(coord, target) * 10 + weight);
  }
  return score;
}

function applyUpgrades(board: BoardState, player: Player, produced: Record<string, number>): string[] {
  const upgrades: string[] = [];
  const health = produced.upgradeHealth ?? 0;
  if (health > 0) {
    const target = board.units
      .filter((unit) => unit.player === player)
      .sort((a, b) => (b.maxHp - a.maxHp) || (a.hp - b.hp))[0];
    if (target) {
      target.maxHp += health;
      target.hp += health;
      upgrades.push(`${target.id} +${health} maxHp`);
    }
  }
  const damage = produced.upgradeDamage ?? 0;
  if (damage > 0) {
    const target = board.units
      .filter((unit) => unit.player === player)
      .sort((a, b) => b.attack - a.attack)[0];
    if (target) {
      target.attack += damage;
      upgrades.push(`${target.id} +${damage} attack`);
    }
  }
  return upgrades;
}

function applyAttacks(board: BoardState, player: Player, produced: Record<string, number>): string[] {
  const attacks: string[] = [];
  const opponent = player === 'P1' ? 'P2' : 'P1';
  let bonusDamage = produced.damage ?? 0;
  let reattacks = produced.reattack ?? 0;
  const attackers = [...board.units.filter((unit) => unit.player === player)] as Unit[];
  attackers.sort((a, b) => b.attack - a.attack);
  for (const attacker of attackers) {
    const attackText = attackOnce(board, attacker, opponent, bonusDamage > 0 ? 1 : 0);
    if (attackText) {
      attacks.push(attackText);
      if (bonusDamage > 0) {
        bonusDamage -= 1;
      }
      if (reattacks > 0 && board.units.some((unit) => unit.id === attacker.id)) {
        const reattackText = attackOnce(board, attacker, opponent, 0);
        if (reattackText) {
          attacks.push(`reattack ${reattackText}`);
          reattacks -= 1;
        }
      }
    }
  }
  return attacks;
}

function attackOnce(board: BoardState, attacker: Unit, opponent: Player, bonus: number): string | null {
  const liveAttacker = board.units.find((unit) => unit.id === attacker.id) as Unit | undefined;
  if (!liveAttacker) {
    return null;
  }
  const range = unitRules[liveAttacker.type].range ?? 1;
  const targets = board.units
    .filter((unit) => unit.player === opponent && distance(liveAttacker, unit) <= range)
    .sort((a, b) => (a.hp - b.hp) || distance(liveAttacker, a) - distance(liveAttacker, b));
  const target = targets[0] as Unit | undefined;
  if (!target) {
    return null;
  }
  const damage = liveAttacker.attack + bonus;
  target.hp = Math.max(0, target.hp - damage);
  const result = `${liveAttacker.id} hit ${target.id} for ${damage}${bonus ? ' including 1 deck damage' : ''}`;
  if (target.hp <= 0) {
    board.units = board.units.filter((unit) => unit.id !== target.id);
    return `${result}, killing it`;
  }
  return `${result} (${target.hp}/${target.maxHp} hp left)`;
}

function applyHealing(board: BoardState, player: Player, produced: Record<string, number>): string[] {
  const heals: string[] = [];
  let deckHeal = produced.heal ?? 0;
  while (deckHeal > 0) {
    const target = mostWounded(board, player);
    if (!target) {
      break;
    }
    target.hp += 1;
    deckHeal -= 1;
    heals.push(`deck healed ${target.id} to ${target.hp}/${target.maxHp}`);
  }
  for (const healer of board.units.filter((unit) => unit.player === player && (unitRules[unit.type as UnitType].heal ?? 0) > 0) as Unit[]) {
    const healAmount = unitRules[healer.type].heal ?? 0;
    const range = unitRules[healer.type].range ?? 1;
    const target = board.units
      .filter((unit) => unit.player === player && unit.hp < unit.maxHp && distance(healer, unit) <= range)
      .sort((a, b) => (b.maxHp - b.hp) - (a.maxHp - a.hp))[0];
    if (target) {
      target.hp = Math.min(target.maxHp, target.hp + healAmount);
      heals.push(`${healer.id} printed-healed ${target.id} to ${target.hp}/${target.maxHp}`);
    }
  }
  return heals;
}

function recruitUnits(board: BoardState, player: Player): string[] {
  const recruits: string[] = [];
  const sequence = player === 'P1' ? p1Recruits : p2Recruits;
  let supply = supplyAmount(board, player);
  while (supply >= 6) {
    const spawn = firstEmptyHome(board, player);
    if (!spawn) {
      break;
    }
    const recruitIndex = player === 'P1' ? p1RecruitIndex : p2RecruitIndex;
    const type = sequence[recruitIndex % sequence.length] as UnitType;
    if (player === 'P1') {
      p1RecruitIndex += 1;
    } else {
      p2RecruitIndex += 1;
    }
    const id = `${player}-${type}-${nextIds[player][type]}`;
    nextIds[player][type] += 1;
    board.units.push({
      id,
      player,
      type,
      col: spawn.col,
      row: spawn.row,
      hp: unitRules[type].hp,
      maxHp: unitRules[type].hp,
      attack: unitRules[type].attack
    });
    supply -= 6;
    recruits.push(id);
  }
  setSupply(board, player, supply);
  return recruits;
}

function advanceBoardTurn(board: BoardState): void {
  if (board.turn.activePlayer === 'P1') {
    board.turn.activePlayer = 'P2';
  } else {
    board.turn.activePlayer = 'P1';
    board.turn.round += 1;
  }
}

function firstPlayableIndex(hand: CardId[], priority: string[]): number {
  for (const card of priority) {
    const index = hand.indexOf(card as CardId);
    if (index >= 0) {
      return index;
    }
  }
  return -1;
}

function mostWounded(board: BoardState, player: Player): Unit | undefined {
  return board.units
    .filter((unit) => unit.player === player && unit.hp < unit.maxHp)
    .sort((a, b) => (b.maxHp - b.hp) - (a.maxHp - a.hp))[0] as Unit | undefined;
}

function firstEmptyHome(board: BoardState, player: Player): Coord | undefined {
  const homes: Record<Player, Coord[]> = {
    P1: [{ col: 10, row: 1 }, { col: 11, row: 0 }, { col: 12, row: 1 }, { col: 11, row: 1 }],
    P2: [{ col: 0, row: 8 }, { col: 1, row: 7 }, { col: 1, row: 8 }, { col: 0, row: 9 }]
  };
  const occupied = occupiedKeys(board);
  return homes[player].find((coord) => !occupied.has(key(coord)));
}

function occupiedKeys(board: BoardState, exceptId?: string): Set<string> {
  return new Set(board.units.filter((unit) => unit.id !== exceptId).map(key));
}

function reachable(unit: Unit, movement: number, occupied: Set<string>): Coord[] {
  const start = { col: unit.col, row: unit.row };
  const seen = new Set([key(start)]);
  const queue: Array<{ coord: Coord; steps: number }> = [{ coord: start, steps: 0 }];
  const result = [start];
  while (queue.length) {
    const current = queue.shift();
    if (!current || current.steps >= movement) {
      continue;
    }
    for (const next of neighbors(current.coord)) {
      const nextKey = key(next);
      if (seen.has(nextKey) || !mapHexes.has(nextKey) || blockedHexes.has(nextKey) || occupied.has(nextKey)) {
        continue;
      }
      seen.add(nextKey);
      queue.push({ coord: next, steps: current.steps + 1 });
      result.push(next);
    }
  }
  return result;
}

function distance(a: Coord, b: Coord): number {
  if (a.col === b.col && a.row === b.row) {
    return 0;
  }
  const queue: Array<{ coord: Coord; steps: number }> = [{ coord: a, steps: 0 }];
  const seen = new Set([key(a)]);
  while (queue.length) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    for (const next of neighbors(current.coord)) {
      const nextKey = key(next);
      if (!mapHexes.has(nextKey) || blockedHexes.has(nextKey) || seen.has(nextKey)) {
        continue;
      }
      if (next.col === b.col && next.row === b.row) {
        return current.steps + 1;
      }
      seen.add(nextKey);
      queue.push({ coord: next, steps: current.steps + 1 });
    }
  }
  return 99;
}

function neighbors(coord: Coord): Coord[] {
  const odd = coord.col % 2 !== 0;
  const offsets = odd
    ? [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]
    : [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]];
  return offsets.map(([dc, dr]) => ({ col: coord.col + (dc as number), row: coord.row + (dr as number) }));
}

function movePriority(unit: Unit, player: Player): number {
  if (player === 'P1') {
    return ({ guardian: 1, marksman: 2, druid: 3, healer: 4, raider: 5, scout: 6 } as Record<UnitType, number>)[unit.type];
  }
  return ({ scout: 1, raider: 2, marksman: 3, guardian: 4, druid: 5, healer: 6 } as Record<UnitType, number>)[unit.type];
}

function countCenters(board: BoardState): Record<Player | 'neutral', number> {
  return {
    P1: board.supplyControl.filter((center) => center.controller === 'P1').length,
    P2: board.supplyControl.filter((center) => center.controller === 'P2').length,
    neutral: board.supplyControl.filter((center) => center.controller === null).length
  };
}

function unitCounts(board: BoardState): Record<Player, number> {
  return {
    P1: board.units.filter((unit) => unit.player === 'P1').length,
    P2: board.units.filter((unit) => unit.player === 'P2').length
  };
}

function supplyAmount(board: BoardState, player: Player): number {
  return board.supply.find((entry) => entry.player === player)?.amount ?? 0;
}

function setSupply(board: BoardState, player: Player, amount: number): void {
  const entry = board.supply.find((item) => item.player === player);
  if (!entry) {
    board.supply.push({ player, amount });
  } else {
    entry.amount = amount;
  }
}

function cardName(card: CardId): string {
  return card
    .split('-')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function key(coord: Coord): string {
  return `${coord.col},${coord.row}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});

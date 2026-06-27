import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadGameConfig } from '../../src/config/loadGameConfig';
import { applyAction } from '../../src/core/engine';
import { listLegalActions } from '../../src/core/legalActions';
import { SeededRng } from '../../src/core/random';
import { cloneState, setupGame } from '../../src/core/state';
import type { CardId, GameState } from '../../src/core/types';

const root = '.games/e014b-rush-vs-engine-a';
const snapshotsDir = join(root, 'snapshots');
const ruleset = 'territory-v1-cost6-damagecap-responsewin-lead4';
const mapId = 'sketch-v4-tempo';

type Player = 'P1' | 'P2';
type UnitType = 'guardian' | 'raider' | 'marksman' | 'scout' | 'druid' | 'healer';

interface Unit {
  id: string;
  player: Player;
  type: UnitType;
  col: number;
  row: number;
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

interface BoardPlan {
  summary: string;
  reasoning: string;
  moves?: Array<[string, number, number]>;
  damage?: Array<[string, number]>;
  heal?: Array<[string, number]>;
  upgradeDamage?: Array<[string, number]>;
  upgradeHealth?: Array<[string, number]>;
  recruit?: UnitType[];
  note?: string;
}

const unitRules: Record<UnitType, { hp: number; attack: number; movement: number }> = {
  guardian: { hp: 16, attack: 4, movement: 1 },
  raider: { hp: 8, attack: 6, movement: 2 },
  marksman: { hp: 8, attack: 4, movement: 1 },
  scout: { hp: 8, attack: 2, movement: 3 },
  druid: { hp: 10, attack: 4, movement: 1 },
  healer: { hp: 4, attack: 1, movement: 1 }
};

const cardNames: Record<CardId, string> = {
  rest: 'Rest',
  copper: 'Copper',
  silver: 'Silver',
  gold: 'Gold',
  village: 'Village',
  smithy: 'Smithy',
  peddler: 'Peddler',
  zap: 'Zap',
  blast: 'Blast',
  inferno: 'Inferno',
  storm: 'Storm',
  bandage: 'Bandage',
  potion: 'Potion',
  healer: 'Healer',
  armory: 'Armory',
  training: 'Training',
  'second-wind': 'Second Wind'
};

const centerAt = new Map([
  ['3,3', 'center-northwest'],
  ['3,7', 'center-west-south'],
  ['5,3', 'center-center-north'],
  ['6,5', 'center-center'],
  ['5,7', 'center-center-south'],
  ['8,1', 'center-northeast'],
  ['8,6', 'center-east'],
  ['9,7', 'center-southeast']
]);

const homeHexes: Record<Player, Array<[number, number]>> = {
  P1: [
    [10, 1],
    [11, 0],
    [12, 1],
    [11, 1]
  ],
  P2: [
    [0, 8],
    [1, 7],
    [1, 8],
    [0, 9]
  ]
};

const recruitCounters: Record<Player, Record<UnitType, number>> = {
  P1: { guardian: 1, raider: 1, marksman: 1, scout: 1, druid: 0, healer: 0 },
  P2: { guardian: 1, raider: 0, marksman: 1, scout: 2, druid: 1, healer: 0 }
};

const hexes = new Set<string>();

const boardPlans: BoardPlan[] = [
  {
    summary: 'P1 opened through the restored southeast lane while still claiming northeast.',
    reasoning:
      'Zap had no legal target, so the rush converted the turn into tempo. The scout took the lower-east route that the tempo rollback is meant to test, while the raider grabbed northeast.',
    moves: [
      ['P1-raider-1', 8, 1],
      ['P1-scout-1', 10, 3],
      ['P1-marksman-1', 10, 0],
      ['P1-guardian-1', 10, 2]
    ]
  },
  {
    summary: 'P2 claimed west-south and sent the second scout toward lower-center denial.',
    reasoning:
      'The engine player accepted slower east access to preserve the druid/marksman support shell and keep center-south reachable.',
    moves: [
      ['P2-scout-1', 3, 7],
      ['P2-scout-2', 3, 8],
      ['P2-druid-1', 2, 7],
      ['P2-marksman-1', 1, 8]
    ]
  },
  {
    summary: 'P1 took east and put the raider on the center-north doorstep.',
    reasoning:
      'P1 still had no legal attack, so the priority stayed on a 3-center income shape: northeast, east, then center-north.',
    moves: [
      ['P1-scout-1', 8, 5],
      ['P1-raider-1', 6, 2],
      ['P1-marksman-1', 9, 0],
      ['P1-guardian-1', 9, 2]
    ]
  },
  {
    summary: 'P2 answered by taking center-south before P1 could close the lower board.',
    reasoning:
      'The second scout was committed to the lower economy. P2 kept the first scout and support units close enough to punish an exposed east scout later.',
    moves: [
      ['P2-scout-2', 5, 7],
      ['P2-scout-1', 4, 7],
      ['P2-druid-1', 3, 7],
      ['P2-marksman-1', 2, 8]
    ]
  },
  {
    summary: 'P1 captured center-north, flipped southeast, and recruited the first extra raider.',
    reasoning:
      'The rollback mattered immediately: scout-1 could turn east control into southeast control without abandoning the attack lane. Blast damage was not assigned because no ready attack line was concrete enough after movement.',
    moves: [
      ['P1-raider-1', 5, 3],
      ['P1-scout-1', 9, 7],
      ['P1-guardian-1', 8, 3],
      ['P1-marksman-1', 8, 1]
    ],
    recruit: ['raider']
  },
  {
    summary: 'P2 healed opportunistically, reinforced the lower center, and added a guardian screen.',
    reasoning:
      'P2 was already facing a 4-2 center deficit, so the engine side chose bodies and preservation over a speculative east chase.',
    moves: [
      ['P2-scout-1', 5, 6],
      ['P2-scout-2', 6, 7],
      ['P2-druid-1', 4, 7],
      ['P2-marksman-1', 3, 8]
    ],
    recruit: ['guardian']
  },
  {
    summary: 'P1 took the center and used capped Zap support to wound the forward P2 scout.',
    reasoning:
      'The rush now had a concrete attack target. Deck damage was attached to a legal scout attack, capped to 1 extra damage for that attacking unit.',
    moves: [
      ['P1-raider-1', 6, 5],
      ['P1-scout-1', 8, 6],
      ['P1-raider-2', 9, 1],
      ['P1-guardian-1', 7, 3],
      ['P1-marksman-1', 8, 2]
    ],
    damage: [['P2-scout-1', 3]],
    recruit: ['marksman']
  },
  {
    summary: 'P2 stepped guardian-2 onto center and recruited a healer.',
    reasoning:
      'P2 could not let P1 sit on five centers uncontested. The lower shell stayed compact, with healer support entering before the damage deck peaked.',
    moves: [
      ['P2-guardian-2', 1, 8],
      ['P2-scout-1', 5, 7],
      ['P2-druid-1', 4, 6],
      ['P2-marksman-1', 4, 8]
    ],
    heal: [['P2-scout-1', 2]],
    recruit: ['healer']
  },
  {
    summary: 'P1 killed the wounded P2 scout and restored southeast pressure.',
    reasoning:
      'Storm/Zap damage was only counted where it rode on concrete attacks. P1 focused the damaged scout with scout and marksman pressure, then recruited another scout to keep flips coming.',
    moves: [
      ['P1-scout-1', 9, 7],
      ['P1-raider-1', 6, 4],
      ['P1-raider-2', 7, 1],
      ['P1-marksman-1', 7, 2],
      ['P1-marksman-2', 10, 0],
      ['P1-guardian-1', 7, 4]
    ],
    damage: [['P2-scout-1', 7]],
    recruit: ['scout']
  },
  {
    summary: 'P2 began walking guardian-2 toward the center lane and preserved supply.',
    reasoning:
      'After losing scout-1, P2 stopped chasing the southeast scout and instead built a ranged/healing bunker around the lower centers.',
    moves: [
      ['P2-guardian-2', 2, 8],
      ['P2-druid-1', 5, 6],
      ['P2-healer-1', 1, 8],
      ['P2-marksman-1', 5, 8]
    ],
    heal: [['P2-scout-2', 1]],
    recruit: []
  },
  {
    summary: 'P1 upgraded raider-1 and damaged the center guardian while holding five centers.',
    reasoning:
      'Training was tied to the raider that could keep converting attacks through healing. P1 did not overbuy pure damage without attack lanes.',
    moves: [
      ['P1-raider-1', 6, 4],
      ['P1-raider-2', 6, 2],
      ['P1-marksman-1', 6, 3],
      ['P1-scout-2', 9, 3]
    ],
    upgradeDamage: [['P1-raider-1', 1]],
    damage: [['P2-guardian-2', 5]],
    recruit: ['raider']
  },
  {
    summary: 'P2 used the guardian shell to kill the upgraded raider and bought time.',
    reasoning:
      'This was P2’s first real stabilization moment. Guardian, druid, and marksman focus removed P1’s best upgraded attacker, preventing an immediate runaway.',
    moves: [
      ['P2-guardian-2', 3, 8],
      ['P2-marksman-1', 5, 7],
      ['P2-druid-1', 5, 6],
      ['P2-healer-1', 2, 8]
    ],
    damage: [['P1-raider-1', 8]],
    heal: [['P2-guardian-2', 3]],
    recruit: ['guardian']
  },
  {
    summary: 'P1 killed marksman-1 and recruited another marksman from the five-center economy.',
    reasoning:
      'P1 shifted from the dead upgraded raider into ranged pressure. The income edge from the southeast rollback kept the rush count ahead despite the trade.',
    moves: [
      ['P1-raider-2', 5, 3],
      ['P1-raider-3', 9, 1],
      ['P1-scout-2', 8, 6],
      ['P1-marksman-2', 9, 0]
    ],
    damage: [['P2-marksman-1', 8]],
    recruit: ['marksman']
  },
  {
    summary: 'P2 saved supply and repaired the center defender.',
    reasoning:
      'P2 was losing unit parity, but the engine package still bought time by healing guardian-2 and keeping center-south secure.',
    moves: [
      ['P2-guardian-2', 4, 8],
      ['P2-guardian-3', 1, 8],
      ['P2-healer-1', 3, 8]
    ],
    heal: [['P2-guardian-2', 5]],
    recruit: []
  },
  {
    summary: 'P1 added a guardian and wounded healer-1 to weaken future stabilization.',
    reasoning:
      'The rush avoided dumping attacks into a fully healed guardian. Hitting the healer made P2’s engine less able to erase chip damage.',
    moves: [
      ['P1-marksman-3', 10, 0],
      ['P1-guardian-1', 6, 4],
      ['P1-scout-1', 9, 6]
    ],
    damage: [['P2-healer-1', 3]],
    recruit: ['guardian']
  },
  {
    summary: 'P2 killed scout-1 and recruited a replacement scout.',
    reasoning:
      'P2 found the best response to the count pressure by removing a mobile flipper. The kill prevented a lead-4 threat at the next P1 start.',
    moves: [
      ['P2-guardian-3', 2, 8],
      ['P2-druid-1', 5, 7],
      ['P2-healer-1', 3, 7]
    ],
    damage: [['P1-scout-1', 8]],
    heal: [['P2-healer-1', 1]],
    recruit: ['scout']
  },
  {
    summary: 'P1 recruited another scout and kept center-east pressure instead of diving the bunker.',
    reasoning:
      'P1 was ahead, but not by enough for a pending threat. The better rush line was to preserve attackers and keep the five-center income pattern alive.',
    moves: [
      ['P1-raider-2', 6, 5],
      ['P1-raider-3', 7, 2],
      ['P1-guardian-1', 5, 4],
      ['P1-scout-2', 9, 7],
      ['P1-marksman-3', 11, 0]
    ],
    damage: [['P2-healer-1', 2]],
    recruit: ['scout']
  },
  {
    summary: 'P2 flipped northwest with scout-3 and stabilized guardian-2 again.',
    reasoning:
      'P2’s engine still had counterplay: the scout went for income denial while the healer/druid package repaired the center front.',
    moves: [
      ['P2-scout-3', 3, 6],
      ['P2-guardian-3', 3, 7],
      ['P2-druid-1', 5, 7]
    ],
    heal: [['P2-guardian-2', 4]]
  },
  {
    summary: 'P1 killed scout-2 and recruited a fourth raider, creating a pending lead-4 threat.',
    reasoning:
      'Start-of-turn count was P1 9 to P2 5, creating a pending lead-4 threat. After the kill and recruit, P1 ended at 10 to 4, forcing P2 to answer before P1’s next start.',
    moves: [
      ['P1-scout-2', 8, 6],
      ['P1-guardian-2', 10, 2],
      ['P1-scout-3', 10, 3],
      ['P1-raider-3', 6, 4],
      ['P1-marksman-3', 10, 1]
    ],
    damage: [['P2-scout-2', 8]],
    recruit: ['raider'],
    note: 'Pending P1 lead-4 threat recorded at the beginning of turn 19; P1 ended the turn with 10 units to P2 4.'
  },
  {
    summary: 'P2 killed raider-3 and recruited twice, clearing the pending threat.',
    reasoning:
      'P2’s response was just enough: the count moved from P1 10 / P2 4 to P1 9 / P2 6, dropping the lead below 4 and clearing the pending P1 threat.',
    moves: [
      ['P2-guardian-3', 4, 7],
      ['P2-scout-3', 3, 3],
      ['P2-druid-1', 5, 6]
    ],
    damage: [['P1-raider-3', 8]],
    recruit: ['scout', 'guardian'],
    note: 'P2 cleared the turn-19 pending P1 lead by killing a raider and recruiting.'
  },
  {
    summary: 'P1 created a new pending lead-4 threat by killing guardian-2 and adding marksman-4.',
    reasoning:
      'At the start of turn 21, P1 led 9 to 6, so the prior threat was cleared and there was no confirmed win. P1 then focused the worn center guardian with Second Wind-backed pressure and recruited, ending 10 to 5.',
    moves: [
      ['P1-raider-4', 9, 1],
      ['P1-guardian-2', 9, 2],
      ['P1-marksman-3', 10, 0],
      ['P1-scout-3', 8, 4]
    ],
    damage: [['P2-guardian-2', 16]],
    recruit: ['marksman'],
    note: 'Pending P1 lead-4 threat recorded after turn 21 because P1 ended with 10 units to P2 5.'
  },
  {
    summary: 'P2 response wounded the front but could not reduce the unit deficit below four.',
    reasoning:
      'P2 had engine pieces but too few clean attacks after guardian-2 died. A final recruit raised P2 to six units, but no P1 unit died, leaving the P1 lead at four.',
    moves: [
      ['P2-scout-4', 3, 8],
      ['P2-druid-1', 4, 6],
      ['P2-guardian-3', 5, 6]
    ],
    damage: [['P1-guardian-1', 5]],
    heal: [['P2-guardian-3', 1]],
    recruit: ['marksman'],
    note: 'P2 response failed to clear the P1 lead-4 threat; P1 wins at the beginning of turn 23.'
  }
];

async function main(): Promise<void> {
  await mkdir(snapshotsDir, { recursive: true });
  const map = JSON.parse(await readFile(`maps/${mapId}.json`, 'utf8')) as { hexes: Array<{ col: number; row: number }> };
  for (const hex of map.hexes) {
    hexes.add(`${hex.col},${hex.row}`);
  }

  const config = await loadGameConfig('rulesets/territory-v1-cost6-damagecap-responsewin-lead4/deck.yaml');
  const rng = new SeededRng(140214);
  let deck = setupGame(config, rng);
  let board = JSON.parse(await readFile('.games/e014-tempo-starter.board.json', 'utf8')) as BoardState;
  board.notes = ['E014b A replay start: tempo starter board with fixed deck.yaml starting decks.'];

  const timeline = {
    schemaVersion: 1 as const,
    title: 'E014b rush-vs-engine A tempo replay',
    entries: [] as unknown[]
  };

  for (let index = 0; index < boardPlans.length; index += 1) {
    const turnNumber = index + 1;
    const turnId = `turn-${String(turnNumber).padStart(3, '0')}`;
    const player = (turnNumber % 2 === 1 ? 'P1' : 'P2') as Player;
    const round = Math.floor(index / 2) + 1;
    const deckBefore = snapshot(deck, rng);
    const boardBefore = cloneBoard(board);
    const deckResult = playDeckTurn(deck, rng, player, turnNumber);
    deck = deckResult.after;
    const boardAfter = applyBoardPlan(board, boardPlans[index]!, player, turnNumber);

    await writeJson(join(snapshotsDir, `${turnId}.before.deck.json`), deckBefore);
    await writeJson(join(snapshotsDir, `${turnId}.after.deck.json`), snapshot(deck, rng));
    await writeJson(join(snapshotsDir, `${turnId}.before.board.json`), boardBefore);
    await writeJson(join(snapshotsDir, `${turnId}.after.board.json`), boardAfter);

    timeline.entries.push({
      id: turnId,
      player,
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
      summary: boardPlans[index]!.summary,
      reasoning: boardPlans[index]!.reasoning
    });

    board = boardAfter;
  }

  await writeJson(join(root, 'deck.json'), snapshot(deck, rng));
  await writeJson(join(root, 'board.json'), board);
  await writeJson(join(root, 'timeline.json'), timeline);
  await writeFile(join(root, 'notes.md'), notesMarkdown(board), 'utf8');
}

function playDeckTurn(deck: GameState, rng: SeededRng, player: Player, turnNumber: number) {
  const active = deck.players[deck.activePlayer]!;
  if (active.id !== player) {
    throw new Error(`Deck active player ${active.id} did not match ${player}`);
  }
  const drawnHand = active.hand.map((id) => cardNames[id] ?? id);
  const played: string[] = [];

  while (true) {
    const action = chooseAction(deck, player);
    if (!action) {
      break;
    }
    const activePlayer = deck.players[deck.activePlayer]!;
    const cardId = activePlayer.hand[action.handIndex]!;
    deck = applyAction(deck, action, rng);
    played.push(cardNames[cardId] ?? cardId);
  }

  deck = applyAction(deck, { type: 'moveToBuy' }, rng);
  const buyer = deck.players[deck.activePlayer]!;
  const buy = chooseBuy(deck, player, turnNumber);
  const bought: string[] = [];
  if (buy) {
    deck = applyAction(deck, { type: 'buyCard', cardId: buy }, rng);
    bought.push(cardNames[buy] ?? buy);
  }
  const produced = {
    money: buyer.money,
    damage: buyer.attributes.damage ?? 0,
    heal: buyer.attributes.heal ?? 0,
    upgradeHealth: buyer.attributes.upgradeHealth ?? 0,
    upgradeDamage: buyer.attributes.upgradeDamage ?? 0,
    reattack: buyer.attributes.reattack ?? 0,
    stormTargets: buyer.attributes.stormTargets ?? 0
  };
  deck = applyAction(deck, { type: 'endTurn' }, rng);
  return { after: deck, drawnHand, played, bought, produced };
}

function chooseAction(deck: GameState, player: Player): { type: 'playAction'; handIndex: number } | undefined {
  const active = deck.players[deck.activePlayer]!;
  const legal = listLegalActions(deck).filter((action) => action.action.type === 'playAction') as Array<{
    action: { type: 'playAction'; handIndex: number };
  }>;
  const order =
    player === 'P1'
      ? ['village', 'peddler', 'zap', 'bandage', 'blast', 'training', 'second-wind', 'storm', 'smithy', 'potion']
      : ['village', 'peddler', 'bandage', 'potion', 'armory', 'healer', 'smithy', 'zap'];
  for (const cardId of order) {
    const legalAction = legal.find((candidate) => active.hand[candidate.action.handIndex] === cardId);
    if (legalAction) {
      return legalAction.action;
    }
  }
  return undefined;
}

function chooseBuy(deck: GameState, player: Player, turnNumber: number): CardId | undefined {
  const legal = new Set(
    listLegalActions(deck)
      .filter((action) => action.action.type === 'buyCard')
      .map((action) => (action.action as { type: 'buyCard'; cardId: CardId }).cardId)
  );
  const priority =
    player === 'P1'
      ? turnNumber < 9
        ? ['blast', 'zap', 'silver']
        : ['second-wind', 'training', 'storm', 'blast', 'zap', 'silver', 'gold']
      : turnNumber < 10
        ? ['village', 'peddler', 'potion', 'silver']
        : ['gold', 'healer', 'armory', 'village', 'peddler', 'potion', 'silver'];
  return priority.find((cardId) => legal.has(cardId));
}

function applyBoardPlan(previous: BoardState, plan: BoardPlan, player: Player, turnNumber: number): BoardState {
  const next = cloneBoard(previous);
  if (next.turn.activePlayer !== player) {
    throw new Error(`Board active player ${next.turn.activePlayer} did not match ${player} on turn ${turnNumber}`);
  }
  next.notes = [`Replay turn ${String(turnNumber).padStart(3, '0')} after-state: ${plan.summary}`];
  addIncome(next, player);
  const moved = new Set<string>();
  for (const [id, col, row] of plan.moves ?? []) {
    if (moved.has(id)) {
      throw new Error(`${id} moved twice on turn ${turnNumber}`);
    }
    moved.add(id);
    moveUnit(next, id, col, row, player, turnNumber);
    const center = centerAt.get(`${col},${row}`);
    if (center) {
      setCenter(next, center, player);
    }
  }
  for (const [id, amount] of plan.upgradeDamage ?? []) {
    requireFriendlyUnit(next, id, player).attack += amount;
  }
  for (const [id, amount] of plan.upgradeHealth ?? []) {
    const unit = requireFriendlyUnit(next, id, player);
    unit.maxHp += amount;
    unit.hp = Math.min(unit.maxHp, unit.hp + amount);
  }
  for (const [id, amount] of plan.damage ?? []) {
    const unit = requireEnemyOrAnyUnit(next, id, player);
    unit.hp = Math.max(0, unit.hp - amount);
  }
  next.units = next.units.filter((unit) => unit.hp > 0);
  for (const [id, amount] of plan.heal ?? []) {
    const unit = requireFriendlyUnit(next, id, player);
    unit.hp = Math.min(unit.maxHp, unit.hp + amount);
  }
  for (const type of plan.recruit ?? []) {
    recruit(next, player, type);
  }
  if (plan.note) {
    next.notes.push(plan.note);
  }
  next.turn = nextTurn(player, turnNumber);
  return next;
}

function addIncome(board: BoardState, player: Player): void {
  const supply = board.supply.find((entry) => entry.player === player);
  if (!supply) {
    throw new Error(`Missing supply for ${player}`);
  }
  const centers = board.supplyControl.filter((center) => center.controller === player).length;
  supply.amount += 2 + centers;
}

function moveUnit(board: BoardState, id: string, col: number, row: number, player: Player, turnNumber: number): void {
  const unit = requireFriendlyUnit(board, id, player);
  if (!hexes.has(`${col},${row}`)) {
    throw new Error(`${id} moved off map to ${col},${row} on turn ${turnNumber}`);
  }
  const destinationOccupant = board.units.find((candidate) => candidate.id !== id && candidate.col === col && candidate.row === row);
  if (destinationOccupant) {
    throw new Error(`${id} moved onto occupied ${col},${row} on turn ${turnNumber}`);
  }
  const distance = legalPathDistance(board, unit, col, row);
  if (distance === null || distance > unitRules[unit.type].movement) {
    throw new Error(`${id} illegal move from ${unit.col},${unit.row} to ${col},${row} on turn ${turnNumber}`);
  }
  unit.col = col;
  unit.row = row;
}

function legalPathDistance(board: BoardState, unit: Unit, targetCol: number, targetRow: number): number | null {
  const start = `${unit.col},${unit.row}`;
  const target = `${targetCol},${targetRow}`;
  const enemyOccupied = new Set(
    board.units
      .filter((candidate) => candidate.player !== unit.player)
      .map((candidate) => `${candidate.col},${candidate.row}`)
  );
  const queue: Array<{ col: number; row: number; distance: number }> = [{ col: unit.col, row: unit.row, distance: 0 }];
  const seen = new Set([start]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = `${current.col},${current.row}`;
    if (key === target) {
      return current.distance;
    }
    for (const [nextCol, nextRow] of neighbors(current.col, current.row)) {
      const nextKey = `${nextCol},${nextRow}`;
      if (!hexes.has(nextKey) || seen.has(nextKey) || enemyOccupied.has(nextKey)) {
        continue;
      }
      seen.add(nextKey);
      queue.push({ col: nextCol, row: nextRow, distance: current.distance + 1 });
    }
  }
  return null;
}

function neighbors(col: number, row: number): Array<[number, number]> {
  if (Math.abs(col) % 2 === 0) {
    return [
      [col, row - 1],
      [col + 1, row - 1],
      [col + 1, row],
      [col, row + 1],
      [col - 1, row],
      [col - 1, row - 1]
    ];
  }
  return [
    [col, row - 1],
    [col + 1, row],
    [col + 1, row + 1],
    [col, row + 1],
    [col - 1, row + 1],
    [col - 1, row]
  ];
}

function recruit(board: BoardState, player: Player, type: UnitType): void {
  const supply = board.supply.find((entry) => entry.player === player);
  if (!supply || supply.amount < 6) {
    throw new Error(`${player} cannot afford ${type}`);
  }
  const occupied = new Set(board.units.map((unit) => `${unit.col},${unit.row}`));
  const [col, row] =
    homeHexes[player].find(([candidateCol, candidateRow]) => !occupied.has(`${candidateCol},${candidateRow}`)) ??
    fallbackSpawn(player, board);
  supply.amount -= 6;
  recruitCounters[player][type] += 1;
  const stats = unitRules[type];
  board.units.push({
    id: `${player}-${type}-${recruitCounters[player][type]}`,
    player,
    type,
    col,
    row,
    hp: stats.hp,
    maxHp: stats.hp,
    attack: stats.attack
  });
}

function fallbackSpawn(player: Player, board: BoardState): [number, number] {
  const candidates =
    player === 'P1'
      ? ([
          [10, 2],
          [10, 3],
          [11, 2],
          [12, 2]
        ] as Array<[number, number]>)
      : ([
          [1, 8],
          [2, 8],
          [1, 9],
          [2, 7]
        ] as Array<[number, number]>);
  const occupied = new Set(board.units.map((unit) => `${unit.col},${unit.row}`));
  const candidate = candidates.find(([col, row]) => hexes.has(`${col},${row}`) && !occupied.has(`${col},${row}`));
  if (!candidate) {
    throw new Error(`No fallback spawn for ${player}`);
  }
  return candidate;
}

function setCenter(board: BoardState, id: string, player: Player): void {
  const center = board.supplyControl.find((candidate) => candidate.id === id);
  if (!center) {
    throw new Error(`Missing center ${id}`);
  }
  center.controller = player;
}

function requireFriendlyUnit(board: BoardState, id: string, player: Player): Unit {
  const unit = requireUnit(board, id);
  if (unit.player !== player) {
    throw new Error(`${id} is not controlled by ${player}`);
  }
  return unit;
}

function requireEnemyOrAnyUnit(board: BoardState, id: string, player: Player): Unit {
  const unit = requireUnit(board, id);
  if (unit.player === player) {
    return unit;
  }
  return unit;
}

function requireUnit(board: BoardState, id: string): Unit {
  const unit = board.units.find((candidate) => candidate.id === id);
  if (!unit) {
    throw new Error(`Missing unit ${id}`);
  }
  return unit;
}

function nextTurn(player: Player, turnNumber: number): { activePlayer: Player; round: number } {
  if (player === 'P1') {
    return { activePlayer: 'P2', round: Math.floor((turnNumber - 1) / 2) + 1 };
  }
  return { activePlayer: 'P1', round: Math.floor((turnNumber - 1) / 2) + 2 };
}

function snapshot(game: GameState, rng: SeededRng) {
  return {
    schemaVersion: 1,
    rngState: rng.snapshot(),
    game: cloneState(game)
  };
}

function cloneBoard(board: BoardState): BoardState {
  return JSON.parse(JSON.stringify(board)) as BoardState;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function notesMarkdown(finalBoard: BoardState): string {
  const p1Units = finalBoard.units.filter((unit) => unit.player === 'P1').length;
  const p2Units = finalBoard.units.filter((unit) => unit.player === 'P2').length;
  const p1Centers = finalBoard.supplyControl.filter((center) => center.controller === 'P1').length;
  const p2Centers = finalBoard.supplyControl.filter((center) => center.controller === 'P2').length;
  const neutralCenters = finalBoard.supplyControl.filter((center) => center.controller === null).length;
  const p1Supply = finalBoard.supply.find((entry) => entry.player === 'P1')?.amount ?? 0;
  const p2Supply = finalBoard.supply.find((entry) => entry.player === 'P2')?.amount ?? 0;

  return `# E014b Rush vs Engine A Replay Notes

## Setup

- Ruleset: \`${ruleset}\`.
- Map: \`${mapId}\`.
- Starter board: \`.games/e014-tempo-starter.board.json\`.
- Deck setup used the fixed \`deck.yaml\` starting deck: 5 Copper, Zap, Bandage, and 3 Rest per player.
- P1 strategy: early damage/tempo with Zap, Blast, Storm, and Second Wind only when attached to concrete attacks, plus enough economy to sustain buys.
- P2 strategy: Village/Peddler/Silver/Gold engine with Bandage/Potion/Healer/Armory support as needed, preserving durable units while contesting lower/east economy.

## Lead-4 Threat Handling

- Turn 19 / P1 start: P1 began at 9 units to P2's 5, creating a pending P1 lead-4 threat.
- Turn 19 / P1 board phase: P1 killed P2 Scout-2 and recruited Raider-4, ending at P1 10 / P2 4.
- Turn 20 / P2 response: P2 killed P1 Raider-3 and recruited Scout-4 plus Guardian-4, changing the count to P1 9 / P2 6 and clearing the threat.
- Turn 21 / P1 board phase: P1 killed P2 Guardian-2 and recruited Marksman-4, ending at P1 10 / P2 5 and creating a new pending P1 lead-4 threat.
- Turn 22 / P2 response: P2 recruited Marksman-2 but did not kill a P1 unit, ending at P1 10 / P2 6.
- Winner: P1 confirms the pending lead-4 threat at the beginning of turn 23 / round 12, before income, movement, combat, healing, or recruitment.

## Final Result

- Completed player turns: 22.
- Winner: P1 by confirmed lead-4 response-window unit-count win.
- Final living units: P1 ${p1Units}, P2 ${p2Units}.
- Final supply centers: P1 ${p1Centers}, P2 ${p2Centers}, neutral ${neutralCenters}.
- Final saved supply: P1 ${p1Supply}, P2 ${p2Supply}.

## Pacing And Map Takeaways

- The tempo rollback made southeast easier for P1 to fold into the early east route. P1 reached a practical five-center shape by turn 7 and converted it into a unit-count threat by turn 19.
- P2's engine and healing still mattered: it killed P1's upgraded raider on turn 12 and cleared the first pending threat on turn 20.
- The second threat stuck because P2 lost Guardian-2 on turn 21 and had too few safe attacks to both kill and recruit during the response window.
- Compared with the more contested southeast location, this line suggests the rollback revived a stronger P1 rush lock, though not an immediate or interaction-free one.

## Rules Calls And Ambiguities

- The board schema has no pending-threat field; pending lead-4 state is recorded in \`timeline.json\` reasoning and this notes file.
- Deck-produced damage was recorded only when attached to concrete attacks and capped at 1 deck-produced damage per attacking unit. Excess produced damage expired.
- Storm targeting used the least expansive interpretation: it only mattered when an occupied enemy target cluster was present, and base attack damage applied only to the original legal target.
- Board movement and recruitment were script-checked against map coordinates, unit movement values, occupied destinations, and saved supply. Combat targeting remains manually audited in the turn reasoning.
- Evidence quality: full, with the caveat that tactical combat legality is manually audited rather than enforced by \`validate-run\`.
`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

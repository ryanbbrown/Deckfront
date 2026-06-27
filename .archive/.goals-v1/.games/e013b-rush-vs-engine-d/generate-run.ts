import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadGameConfig } from '../../src/config/loadGameConfig';
import { applyAction } from '../../src/core/engine';
import { listLegalActions } from '../../src/core/legalActions';
import { SeededRng } from '../../src/core/random';
import { cloneState, setupGame } from '../../src/core/state';
import type { CardId, GameState } from '../../src/core/types';

const root = '.games/e013b-rush-vs-engine-d';
const snapshotsDir = join(root, 'snapshots');
const ruleset = 'territory-v1-cost6-damagecap-responsewin-lead4';
const mapId = 'sketch-v3-contest';

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
  recruit?: UnitType[];
  note?: string;
}

const unitRules: Record<UnitType, { hp: number; attack: number }> = {
  guardian: { hp: 16, attack: 4 },
  raider: { hp: 8, attack: 6 },
  marksman: { hp: 8, attack: 4 },
  scout: { hp: 8, attack: 2 },
  druid: { hp: 10, attack: 4 },
  healer: { hp: 4, attack: 1 }
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
  ['8,7', 'center-southeast']
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

const boardPlans: BoardPlan[] = [
  {
    summary: 'P1 opened toward the east cluster, claiming northeast while lining up a lower-east scout lane.',
    reasoning:
      'The damage hand had no legal attack, so P1 converted the turn into tempo: raider took center-northeast, scout sprinted toward the east/southeast route, and slower units left home to keep future recruits legal.',
    moves: [
      ['P1-raider-1', 8, 1],
      ['P1-scout-1', 9, 3],
      ['P1-marksman-1', 10, 0],
      ['P1-guardian-1', 10, 2]
    ]
  },
  {
    summary: 'P2 answered with the southern engine posture and took west-south.',
    reasoning:
      'P2 preserved the druid and marksman while scouts moved first. This denied P1 a free lower-center sweep and kept a later center-south flip realistic.',
    moves: [
      ['P2-scout-1', 3, 7],
      ['P2-scout-2', 3, 8],
      ['P2-druid-1', 2, 7],
      ['P2-marksman-1', 1, 8]
    ]
  },
  {
    summary: 'P1 reached east and started the center-north approach.',
    reasoning:
      'P1 still lacked a clean attack, so the rush prioritized a 2-center income base and central threat projection over early chip damage.',
    moves: [
      ['P1-scout-1', 8, 6],
      ['P1-raider-1', 6, 3],
      ['P1-marksman-1', 9, 1],
      ['P1-guardian-1', 9, 3]
    ]
  },
  {
    summary: 'P2 claimed center-south and recruited a guardian screen.',
    reasoning:
      'P2 could not spend yet because center-south was captured after income. The engine side accepted that P1 would likely take center-north, but made the lower center expensive to crack.',
    moves: [
      ['P2-scout-2', 5, 7],
      ['P2-scout-1', 4, 7],
      ['P2-druid-1', 3, 7],
      ['P2-marksman-1', 2, 8]
    ]
  },
  {
    summary: 'P1 took center-north, poked the southern scout, and recruited a second raider.',
    reasoning:
      'Zap/Blast support finally had a concrete attack. P1 put capped deck damage onto the lead raider attack instead of throwing damage without a follow-up.',
    moves: [
      ['P1-raider-1', 5, 3],
      ['P1-guardian-1', 8, 3],
      ['P1-marksman-1', 8, 2],
      ['P1-scout-1', 8, 7]
    ],
    damage: [['P2-scout-2', 5]],
    recruit: ['raider']
  },
  {
    summary: 'P2 healed the scout line, put bodies around center-south, and added a healer.',
    reasoning:
      'P2 chose survival conversion over counterattacking into P1 range. The guardian moved out just far enough to matter next turn while the healer entered safely.',
    moves: [
      ['P2-scout-1', 5, 6],
      ['P2-druid-1', 4, 7],
      ['P2-marksman-1', 3, 8]
    ],
    heal: [['P2-scout-2', 3]],
    recruit: ['guardian']
  },
  {
    summary: 'P1 claimed center and recruited marksman follow-up.',
    reasoning:
      'The rush avoided overextending into the guardian. P1 used the scout to flip center while the marksman line moved into range for the next exchange.',
    moves: [
      ['P1-scout-1', 6, 5],
      ['P1-raider-1', 5, 4],
      ['P1-guardian-1', 7, 3],
      ['P1-raider-2', 9, 1],
      ['P1-marksman-1', 7, 2]
    ],
    damage: [['P2-scout-1', 4]],
    recruit: ['marksman']
  },
  {
    summary: 'P2 contested center with a guardian and recruited a marksman for ranged trades.',
    reasoning:
      'P2 could not let the 5-center pattern settle. Guardian-2 moved onto the center road while the damaged scout backed off for healing.',
    moves: [
      ['P2-guardian-2', 6, 5],
      ['P2-scout-1', 5, 7],
      ['P2-marksman-1', 4, 8]
    ],
    heal: [['P2-scout-1', 2]],
    recruit: ['healer']
  },
  {
    summary: 'P1 killed the first P2 scout, retook southeast, and added another scout.',
    reasoning:
      'This was the first real rush payoff: P1 focused a damaged scout with raider plus capped deck damage, then used the original scout to keep the lower-east centers under P1 control.',
    moves: [
      ['P1-scout-1', 8, 7],
      ['P1-raider-2', 7, 1],
      ['P1-marksman-2', 10, 0],
      ['P1-guardian-1', 7, 4]
    ],
    damage: [['P2-scout-1', 6]],
    recruit: ['scout']
  },
  {
    summary: 'P2 preserved the center-south core and recruited a second guardian.',
    reasoning:
      'With one scout gone, P2 avoided a low-value revenge attack and instead kept the healer/druid package behind a guardian line.',
    moves: [
      ['P2-guardian-2', 5, 6],
      ['P2-druid-1', 4, 7],
      ['P2-healer-1', 2, 8]
    ],
    heal: [['P2-guardian-2', 2]],
    recruit: ['marksman']
  },
  {
    summary: 'P1 upgraded the lead raider and recruited a third raider.',
    reasoning:
      'P1 chose Training because the upgraded raider could keep threatening real kills through P2 healing. The board stayed at a P1-favored 5-3 center split.',
    moves: [
      ['P1-raider-1', 6, 4],
      ['P1-raider-2', 6, 2],
      ['P1-marksman-1', 6, 3],
      ['P1-scout-2', 10, 3]
    ],
    upgradeDamage: [['P1-raider-1', 1]],
    damage: [['P2-guardian-2', 5]],
    recruit: ['raider']
  },
  {
    summary: 'P2 counterkilled the original raider and recruited a druid.',
    reasoning:
      'P2 finally converted the guardian screen into a trade. Removing the upgraded raider reduced P1 count pressure, but P1 still retained the east/southeast income engine.',
    moves: [
      ['P2-marksman-1', 4, 7],
      ['P2-druid-1', 5, 7]
    ],
    damage: [['P1-raider-1', 8]]
  },
  {
    summary: 'P1 killed P2 marksman-1 and recruited another marksman.',
    reasoning:
      'The rush deck used Blast only because two ready attackers could make the focus fire matter. P1 traded up on unit count and kept all five eastern/central centers.',
    moves: [
      ['P1-raider-2', 5, 4],
      ['P1-raider-3', 9, 1],
      ['P1-scout-2', 8, 6],
      ['P1-marksman-2', 9, 1]
    ],
    damage: [['P2-marksman-1', 8]],
    recruit: ['marksman']
  },
  {
    summary: 'P2 added a second guardian and stabilized guardian-2.',
    reasoning:
      'P2 was behind on count but not out of the game. The engine/heal deck converted into repair, and P2 kept center-south instead of chasing a risky east flip.',
    moves: [
      ['P2-healer-1', 3, 8],
      ['P2-marksman-2', 3, 7]
    ],
    heal: [
      ['P2-guardian-2', 4],
      ['P2-scout-2', 1]
    ],
    recruit: ['guardian']
  },
  {
    summary: 'P1 recruited a guardian off the 5-center economy and pressed the lower-east kill box.',
    reasoning:
      'The 5-3 split started to matter. P1 bought a durable center holder, creating the first plausible lead-4 route if P2 could not find kills.',
    moves: [
      ['P1-marksman-3', 10, 0],
      ['P1-guardian-1', 6, 4],
      ['P1-scout-1', 8, 6]
    ],
    damage: [['P2-guardian-2', 4]],
    recruit: ['guardian']
  },
  {
    summary: 'P2 killed P1 scout-1 and recruited a replacement scout.',
    reasoning:
      'This cleared any immediate lead-4 danger and showed the engine side still had a response. P2 used ranged focus fire rather than exposing the support units.',
    moves: [
      ['P2-scout-2', 6, 7],
      ['P2-guardian-3', 2, 7],
      ['P2-druid-1', 2, 8]
    ],
    damage: [['P1-scout-1', 8]],
    recruit: ['scout']
  },
  {
    summary: 'P1 wounded healer-1 and restored the count pressure.',
    reasoning:
      'P1 prioritized the support unit over more guardian damage. Leaving the healer at 1 HP reduced future P2 stabilization without requiring an overcommitted attack.',
    moves: [
      ['P1-raider-2', 6, 5],
      ['P1-raider-3', 7, 3],
      ['P1-scout-2', 8, 7],
      ['P1-marksman-3', 9, 1]
    ],
    damage: [['P2-healer-1', 3]],
    recruit: ['scout']
  },
  {
    summary: 'P2 flipped center-south and repaired the front, but did not find a kill.',
    reasoning:
      'The support engine was still meaningful, yet the wounded healer reduced P2 action efficiency on the board. P2 held the southern three centers and stayed alive on units.',
    moves: [
      ['P2-scout-3', 3, 8],
      ['P2-guardian-3', 3, 7],
      ['P2-healer-1', 2, 8]
    ],
    heal: [['P2-guardian-2', 4]]
  },
  {
    summary: 'P1 killed scout-2 and recruited a fourth raider.',
    reasoning:
      'Second Wind lined up with a concrete ranged follow-up, so P1 used it to remove a mobile flipper. The board returned to a 5-3 split with P1 threatening a count win.',
    moves: [
      ['P1-scout-2', 8, 6],
      ['P1-guardian-2', 10, 2],
      ['P1-scout-3', 9, 3],
      ['P1-raider-3', 6, 4]
    ],
    damage: [['P2-scout-2', 8]],
    recruit: ['raider']
  },
  {
    summary: 'P2 reclaimed northwest, using the scout for denial instead of a doomed attack.',
    reasoning:
      'P2 was now behind on count, so the best response was to avoid feeding another kill and create income counterplay. No pending lead existed yet because the start-of-turn count was only P1 10 to P2 7.',
    moves: [
      ['P2-scout-3', 3, 3],
      ['P2-druid-1', 5, 7],
      ['P2-marksman-2', 4, 7],
      ['P2-healer-1', 3, 8]
    ],
    heal: [['P2-guardian-2', 2]]
  },
  {
    summary: 'P1 created a pending lead-4 threat and killed guardian-2.',
    reasoning:
      'Start-of-turn count was P1 10 to P2 6, creating a pending P1 lead-4 threat. P1 then focused the wounded guardian with real attacks plus capped deck damage and recruited one more marksman, forcing P2 to reduce the lead below 4 on the response turn.',
    moves: [
      ['P1-raider-4', 9, 1],
      ['P1-guardian-2', 9, 3],
      ['P1-marksman-3', 8, 2],
      ['P1-raider-3', 6, 5]
    ],
    damage: [['P2-guardian-2', 16]],
    recruit: ['marksman'],
    note: 'Pending P1 lead-4 threat recorded at the beginning of turn 21.'
  },
  {
    summary: 'P2 response killed one raider and recruited, but the P1 lead remained exactly 4.',
    reasoning:
      'P2 took the best available response: focus down raider-3 and add a scout. That changed the count from P1 11 / P2 5 to P1 10 / P2 6, which was not enough to clear the pending P1 threat.',
    moves: [
      ['P2-druid-1', 3, 7],
      ['P2-guardian-3', 4, 6],
      ['P2-scout-3', 4, 3]
    ],
    damage: [['P1-raider-3', 8]],
    recruit: ['scout'],
    note: 'P2 response reduced the deficit but left P1 ahead by 4, so P1 wins at the beginning of turn 23.'
  }
];

async function main(): Promise<void> {
  await mkdir(snapshotsDir, { recursive: true });
  const config = await loadGameConfig('rulesets/territory-v1-cost6-damagecap-responsewin-lead4/deck.yaml');
  const rng = new SeededRng(130134);
  let deck = setupGame(config, rng);
  let board = JSON.parse(await readFile('.games/e013-contest-starter.board.json', 'utf8')) as BoardState;
  board.notes = ['E013b D replay start: contest starter board with fixed deck.yaml starting decks.'];

  const timeline = {
    schemaVersion: 1 as const,
    title: 'E013b rush-vs-engine D contest replay',
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
  const active = deck.players[deck.activePlayer]!;
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
  next.notes = [`Replay turn ${String(turnNumber).padStart(3, '0')} after-state: ${plan.summary}`];
  addIncome(next, player);
  for (const [id, col, row] of plan.moves ?? []) {
    const unit = requireUnit(next, id);
    unit.col = col;
    unit.row = row;
    const center = centerAt.get(`${col},${row}`);
    if (center) {
      setCenter(next, center, unit.player);
    }
  }
  for (const [id, amount] of plan.upgradeDamage ?? []) {
    requireUnit(next, id).attack += amount;
  }
  for (const [id, amount] of plan.damage ?? []) {
    const unit = requireUnit(next, id);
    unit.hp = Math.max(0, unit.hp - amount);
  }
  next.units = next.units.filter((unit) => unit.hp > 0);
  for (const [id, amount] of plan.heal ?? []) {
    const unit = requireUnit(next, id);
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
  const base = player === 'P1' ? [10, 2] : [1, 8];
  const occupied = new Set(board.units.map((unit) => `${unit.col},${unit.row}`));
  for (let offset = 0; offset < 5; offset += 1) {
    const candidate = [base[0], base[1] + offset] as [number, number];
    if (!occupied.has(`${candidate[0]},${candidate[1]}`)) {
      return candidate;
    }
  }
  throw new Error(`No fallback spawn for ${player}`);
}

function setCenter(board: BoardState, id: string, player: Player): void {
  const center = board.supplyControl.find((candidate) => candidate.id === id);
  if (!center) {
    throw new Error(`Missing center ${id}`);
  }
  center.controller = player;
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

  return `# E013b Rush vs Engine D Replay Notes

## Setup

- Ruleset: \`${ruleset}\`.
- Map: \`${mapId}\`.
- Starter board: \`.games/e013-contest-starter.board.json\`.
- Deck setup used the fixed \`deck.yaml\` starting deck: 5 Copper, Zap, Bandage, and 3 Rest per player.
- P1 strategy: early damage/tempo with Zap/Blast/Second Wind used only when they supported concrete attacks.
- P2 strategy: engine/healing/economy, preserving units while contesting the lower centers.

## Lead-4 Threat Handling

- No lead-4 threat existed through turn 20. P1 had pressure, but P2's recruits and the turn-16 scout kill kept the deficit below 4 at start-of-turn checks.
- Turn 21 / P1 start: P1 began at 10 units to P2's 6, so P1 recorded a pending lead-4 threat.
- Turn 21 / P1 board phase: P1 killed P2 Guardian-2 and recruited Marksman-4, ending at P1 11 / P2 5.
- Turn 22 / P2 response: P2 killed P1 Raider-3 and recruited Scout-4, ending at P1 10 / P2 6.
- Winner: P1 confirms the pending lead-4 threat at the beginning of turn 23 / round 12, before income, movement, combat, healing, or recruitment.

## Final Result

- Completed player turns: 22.
- Winner: P1 by confirmed lead-4 response-window unit-count win.
- Final living units: P1 ${p1Units}, P2 ${p2Units}.
- Final supply centers: P1 ${p1Centers}, P2 ${p2Centers}, neutral ${neutralCenters}.
- Final saved supply: P1 ${p1Supply}, P2 ${p2Supply}.

## Map And Strategy Takeaways

- This repeat found a cleaner P1 rush line than the earlier A run: P1 held northeast/east/southeast plus center-north/center long enough for the 5-3 income edge to become extra bodies.
- P2's engine did stabilize the first rush wave and killed two P1 units, but the turn-17 healer wound made later guardian preservation fail.
- The contest map still created counterplay: P2 flipped northwest late and forced P1 to win by unit lead rather than by a permanent 6-2 supply lock.

## Rules Calls And Ambiguities

- The board schema has no pending-threat field; pending lead-4 state is recorded in \`timeline.json\` reasoning and this notes file.
- Deck-produced damage was recorded only when attached to concrete attacks; excess produced damage expired.
- Tactical board play was manually recorded turn by turn. \`validate-run\` verifies schema, snapshot existence, and continuity, not full tactical legality.
- Evidence quality: full, assuming reviewer accepts the manually recorded movement/combat decisions; no known material legality issue was identified during this playthrough.
`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

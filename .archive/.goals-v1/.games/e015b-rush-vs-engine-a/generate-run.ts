import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadGameConfig } from '../../src/config/loadGameConfig';
import { applyAction } from '../../src/core/engine';
import { listLegalActions } from '../../src/core/legalActions';
import { SeededRng } from '../../src/core/random';
import { cloneState, setupGame } from '../../src/core/state';
import type { CardId, GameState } from '../../src/core/types';

const root = '.games/e015b-rush-vs-engine-a';
const snapshotsDir = join(root, 'snapshots');
const ruleset = 'territory-v1-cost6-damagecap-responsewin-lead4-compressed';
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
    summary: 'P1 opened toward northeast and the lower-east lane.',
    reasoning:
      'The rush hand had no legal target, so P1 converted it into board tempo: raider claimed northeast, scout sprinted toward east/southeast, and the slower units cleared home for later recruits.',
    moves: [
      ['P1-raider-1', 8, 1],
      ['P1-scout-1', 10, 3],
      ['P1-marksman-1', 10, 0],
      ['P1-guardian-1', 10, 2]
    ]
  },
  {
    summary: 'P2 claimed west-south and formed the support shell.',
    reasoning:
      'P2 kept the druid and marksman protected while the scouts established the lower-center route that the engine needs to slow P1 replacement tempo.',
    moves: [
      ['P2-scout-1', 3, 7],
      ['P2-scout-2', 3, 8],
      ['P2-druid-1', 2, 7],
      ['P2-marksman-1', 1, 8]
    ]
  },
  {
    summary: 'P1 set up east and the center-north capture.',
    reasoning:
      'P1 still had no profitable attack. The legal scout route could not reach east yet, so P1 staged on the east approach while the raider stayed on the center-north path.',
    moves: [
      ['P1-scout-1', 8, 5],
      ['P1-raider-1', 6, 2],
      ['P1-marksman-1', 9, 0],
      ['P1-guardian-1', 9, 2]
    ]
  },
  {
    summary: 'P2 took center-south and compacted around the lower centers.',
    reasoning:
      'The engine player accepted that the first recruit would be delayed until after this capture, prioritizing a stable 2-center base over an exposed early poke.',
    moves: [
      ['P2-scout-2', 5, 7],
      ['P2-scout-1', 4, 7],
      ['P2-druid-1', 3, 7],
      ['P2-marksman-1', 2, 8]
    ]
  },
  {
    summary: 'P1 reached three centers but was one supply short of recruiting.',
    reasoning:
      'The corrected scout route delayed east by a full P1 turn. P1 claimed center-north and east, but compressed income left only 5 saved supply, so the first recruit had to wait.',
    moves: [
      ['P1-raider-1', 5, 3],
      ['P1-scout-1', 8, 6],
      ['P1-guardian-1', 8, 3],
      ['P1-marksman-1', 8, 1]
    ],
    damage: [['P2-scout-2', 5]]
  },
  {
    summary: 'P2 repaired the lower scout and recruited a guardian screen.',
    reasoning:
      'P2 used the first affordable recruit on a guardian rather than a faster unit, trying to preserve the engine core through P1 capped damage.',
    moves: [
      ['P2-scout-1', 5, 6],
      ['P2-druid-1', 4, 7],
      ['P2-marksman-1', 3, 8]
    ],
    heal: [['P2-scout-2', 3]],
    recruit: ['guardian']
  },
  {
    summary: 'P1 took center and southeast, then recruited the first extra raider.',
    reasoning:
      'P1 started on only three centers and gained 4, making the first recruit possible but delayed until turn 7. The move still created the 5-center rush posture.',
    moves: [
      ['P1-scout-1', 8, 7],
      ['P1-raider-1', 6, 5],
      ['P1-guardian-1', 7, 3],
      ['P1-marksman-1', 8, 2]
    ],
    damage: [['P2-scout-1', 4]],
    recruit: ['raider']
  },
  {
    summary: 'P2 healed and held supply for the next response window.',
    reasoning:
      'P2 also felt the compression. With only two centers, the engine side had 3 supply after income and could not recruit every turn.',
    moves: [
      ['P2-guardian-2', 1, 8],
      ['P2-druid-1', 4, 6],
      ['P2-marksman-1', 4, 8]
    ],
    heal: [['P2-scout-1', 2]]
  },
  {
    summary: 'P1 killed scout-1 and recruited a flanking scout.',
    reasoning:
      'The fifth center gave P1 exactly enough pace to recruit this turn. P1 converted capped damage through legal attacks into the first unit kill while keeping southeast pressure active.',
    moves: [
      ['P1-scout-1', 8, 7],
      ['P1-raider-2', 8, 1],
      ['P1-marksman-1', 7, 2],
      ['P1-guardian-1', 7, 4]
    ],
    damage: [['P2-scout-1', 6]],
    recruit: ['scout']
  },
  {
    summary: 'P2 recruited a healer and stayed compact.',
    reasoning:
      'P2 used saved supply on support rather than chasing the southeast scout. The slower replacement schedule made preserving guardian and druid HP more important than flipping immediately.',
    moves: [
      ['P2-guardian-2', 2, 8],
      ['P2-druid-1', 5, 6]
    ],
    heal: [['P2-scout-2', 1]],
    recruit: ['healer']
  },
  {
    summary: 'P1 upgraded the lead raider and recruited another raider.',
    reasoning:
      'Training was attached to the raider most likely to keep converting attacks. P1 could recruit again only because it had reached a 5-center shape.',
    moves: [
      ['P1-raider-1', 5, 5],
      ['P1-raider-2', 6, 2],
      ['P1-marksman-1', 6, 3],
      ['P1-scout-2', 9, 3]
    ],
    upgradeDamage: [['P1-raider-1', 1]],
    damage: [['P2-druid-1', 5]],
    recruit: ['raider']
  },
  {
    summary: 'P2 healed the druid and declined an unaffordable recruit.',
    reasoning:
      'The engine side could heal damage, but two-center compressed income left it short of a new unit. P2 preserved pieces for a future response instead of forcing a bad trade.',
    moves: [
      ['P2-guardian-2', 3, 8],
      ['P2-marksman-1', 4, 7],
      ['P2-healer-1', 1, 8]
    ],
    heal: [['P2-druid-1', 5]]
  },
  {
    summary: 'P1 killed scout-2 and recruited a marksman, creating the first lead-4 threat.',
    reasoning:
      'P1 used the wider attack net to remove P2’s remaining mobile scout. The turn ended at P1 8 units to P2 4, creating a pending lead-4 threat for P2 to answer.',
    moves: [
      ['P1-raider-1', 5, 5],
      ['P1-raider-3', 8, 1],
      ['P1-scout-1', 9, 7],
      ['P1-scout-2', 8, 6],
      ['P1-marksman-1', 6, 3]
    ],
    damage: [['P2-scout-2', 8]],
    recruit: ['marksman'],
    note: 'Pending P1 lead-4 threat recorded after turn 13; P1 ended at 8 units to P2 4.'
  },
  {
    summary: 'P2 killed the upgraded raider and recruited guardian-3, clearing the threat.',
    reasoning:
      'P2’s best response combined a kill with a saved-supply recruit. The count moved to P1 7 / P2 5, proving the engine still had one clean answer despite lower income.',
    moves: [
      ['P2-druid-1', 5, 6],
      ['P2-marksman-1', 4, 7],
      ['P2-guardian-2', 4, 8]
    ],
    damage: [['P1-raider-1', 8]],
    recruit: ['guardian'],
    note: 'The pending P1 lead was cleared because P2 reduced the unit gap below 4.'
  },
  {
    summary: 'P1 killed healer-1 and rebuilt the lead with another scout.',
    reasoning:
      'Rather than grind into guardians, P1 removed the support unit that was making chip damage reversible. The recruit restored a lead-4 threat at the end of the turn.',
    moves: [
      ['P1-raider-2', 6, 4],
      ['P1-raider-3', 7, 2],
      ['P1-scout-2', 8, 7],
      ['P1-marksman-2', 9, 1]
    ],
    damage: [['P2-healer-1', 4]],
    recruit: ['scout'],
    note: 'Pending P1 lead-4 threat recorded after turn 15; P1 ended at 8 units to P2 4.'
  },
  {
    summary: 'P2 killed raider-2 but could not also recruit.',
    reasoning:
      'Compressed income was decisive here. P2 found a kill through druid and marksman focus, but only had 3 saved supply after income, so the response lowered the count only to P1 7 / P2 4 and cleared the immediate pending threat by a single unit.',
    moves: [
      ['P2-druid-1', 5, 5],
      ['P2-marksman-1', 5, 7],
      ['P2-guardian-3', 1, 8]
    ],
    damage: [['P1-raider-2', 8]],
    note: 'The pending P1 lead was cleared by a kill, but P2 remained unable to replace on this turn.'
  },
  {
    summary: 'P1 killed marksman-1 and recruited raider-4.',
    reasoning:
      'With the healer gone, P1 could pick off the ranged defender. The 5-center income let P1 keep recruiting every turn, recreating a larger lead-4 threat.',
    moves: [
      ['P1-raider-3', 6, 4],
      ['P1-scout-2', 8, 6],
      ['P1-scout-3', 9, 3],
      ['P1-marksman-2', 8, 2]
    ],
    damage: [['P2-marksman-1', 8]],
    recruit: ['raider'],
    note: 'Pending P1 lead-4 threat recorded after turn 17; P1 ended at 8 units to P2 3.'
  },
  {
    summary: 'P2 used saved supply and a kill to clear the second major threat.',
    reasoning:
      'P2 finally crossed 6 supply again. Killing scout-3 and recruiting scout-3 changed the count to P1 7 / P2 4, clearing the pending threat but leaving P2 without a stable support engine.',
    moves: [
      ['P2-druid-1', 5, 6],
      ['P2-guardian-2', 5, 8],
      ['P2-guardian-3', 2, 8]
    ],
    damage: [['P1-scout-3', 8]],
    recruit: ['scout'],
    note: 'The pending P1 lead was cleared by P2’s last saved-supply recruit plus a kill.'
  },
  {
    summary: 'P1 killed guardian-2 and recruited marksman-3 for the final threat.',
    reasoning:
      'P1’s tempo pressure had stripped the healer and marksman, so the next guardian kill left P2 with too few bodies and too little supply to fully respond.',
    moves: [
      ['P1-raider-4', 9, 1],
      ['P1-guardian-1', 7, 4],
      ['P1-scout-2', 8, 7],
      ['P1-marksman-2', 8, 1]
    ],
    damage: [['P2-guardian-2', 16]],
    recruit: ['marksman'],
    note: 'Pending P1 lead-4 threat recorded after turn 19; P1 ended at 8 units to P2 3.'
  },
  {
    summary: 'P2 killed one scout but could not recruit, leaving the P1 lead intact.',
    reasoning:
      'P2 had the attack to remove scout-2, but compressed two-center income left only 3 board supply after income. The response ended at P1 7 / P2 3, still a four-unit gap, so P1 will confirm at the next start-of-turn check.',
    moves: [
      ['P2-druid-1', 5, 6],
      ['P2-guardian-3', 3, 8],
      ['P2-scout-3', 3, 7]
    ],
    damage: [['P1-scout-2', 8]],
    note: 'P2 failed to clear the pending P1 lead-4 threat; P1 wins at the beginning of turn 21.'
  }
];

const hexes = new Set<string>();
const blocked = new Set<string>();

async function main(): Promise<void> {
  await mkdir(snapshotsDir, { recursive: true });
  const map = JSON.parse(await readFile(`maps/${mapId}.json`, 'utf8')) as {
    hexes: Array<{ col: number; row: number }>;
    blocked: Array<{ col: number; row: number }>;
  };
  for (const hex of map.hexes) {
    hexes.add(`${hex.col},${hex.row}`);
  }
  for (const hex of map.blocked) {
    blocked.add(`${hex.col},${hex.row}`);
  }

  const config = await loadGameConfig(`rulesets/${ruleset}/deck.yaml`);
  const rng = new SeededRng(150215);
  let deck = setupGame(config, rng);
  let board = JSON.parse(await readFile('.games/e015-compressed-starter.board.json', 'utf8')) as BoardState;
  board.notes = ['E015b A replay start: compressed-income starter board with fixed deck.yaml starting decks.'];

  const timeline = {
    schemaVersion: 1 as const,
    title: 'E015b rush-vs-engine A compressed replay',
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
  for (const [id, amount] of plan.damage ?? []) {
    const unit = requireUnit(next, id);
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
  const income = [1, 2, 3, 4, 5, 6, 6, 7, 7][centers];
  if (income === undefined) {
    throw new Error(`Unsupported center count ${centers}`);
  }
  supply.amount += income;
}

function moveUnit(board: BoardState, id: string, col: number, row: number, player: Player, turnNumber: number): void {
  const unit = requireFriendlyUnit(board, id, player);
  if (!isOpenMapHex(col, row)) {
    throw new Error(`${id} moved off map or into blocked ${col},${row} on turn ${turnNumber}`);
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
      if (!isOpenMapHex(nextCol, nextRow) || seen.has(nextKey) || enemyOccupied.has(nextKey)) {
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

function isOpenMapHex(col: number, row: number): boolean {
  const key = `${col},${row}`;
  return hexes.has(key) && !blocked.has(key);
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
  const candidate = candidates.find(([col, row]) => isOpenMapHex(col, row) && !occupied.has(`${col},${row}`));
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

  return `# E015b Rush vs Engine A Replay Notes

## Setup

- Ruleset: \`${ruleset}\`.
- Map: \`${mapId}\`.
- Starter board: \`.games/e015-compressed-starter.board.json\`.
- Deck setup used the fixed \`deck.yaml\` starting deck: 5 Copper, Zap, Bandage, and 3 Rest per player.
- P1 strategy: early damage/tempo with Zap, Blast, Storm, and Second Wind only when attached to concrete attacks, plus enough economy to keep buying.
- P1 board strategy: pressure centers and P2 lanes with raiders, scouts, and marksmen; guardians only hold center space.
- P2 strategy: Village/Peddler/Silver/Gold engine with Bandage/Potion/Healer/Armory support.
- P2 board strategy: preserve units with guardian/druid/healer core, marksmen for safe damage, and scouts for flips.

## Compressed Income Notes

- Income used the E015 table: 0 centers = 1, 1 = 2, 2 = 3, 3 = 4, 4 = 5, 5 = 6, 6 = 6, 7 = 7, 8 = 7.
- Recruitment still cost 6 supply.
- Turn 5 showed the intended compression: P1 reached only 5 saved supply and could not recruit. The first P1 recruit came on turn 7 after starting from three controlled centers.
- P2 repeatedly hit the opposite side of the rule: at two to three centers, it could answer some threats with saved supply, but not recruit every response turn.

## Lead-4 Threat Handling

- Turn 13: P1 killed P2 Scout-2 and recruited Marksman-2, ending at P1 8 / P2 4 and recording a pending P1 lead-4 threat.
- Turn 14: P2 killed P1 Raider-1 and recruited Guardian-3, reducing the count to P1 7 / P2 5 and clearing the threat.
- Turn 15: P1 killed P2 Healer-1 and recruited Scout-3, ending at P1 8 / P2 4 and recording another pending threat.
- Turn 16: P2 killed P1 Raider-2 but could not recruit, reducing the count to P1 7 / P2 4 and clearing the threat by one unit.
- Turn 17: P1 killed P2 Marksman-1 and recruited Raider-4, ending at P1 8 / P2 3 and recording a third threat.
- Turn 18: P2 killed P1 Scout-3 and recruited Scout-3, reducing the count to P1 7 / P2 4 and clearing the threat.
- Turn 19: P1 killed P2 Guardian-2 and recruited Marksman-3, ending at P1 8 / P2 3 and recording the final pending threat.
- Turn 20: P2 killed P1 Scout-2 but had only 3 board supply after compressed income, so it could not recruit. The count stayed P1 7 / P2 3.
- Winner: P1 confirms the pending lead-4 threat at the beginning of turn 21 / round 11, before income, movement, combat, healing, or recruitment.

## Final Result

- Completed player turns: 20.
- Winner: P1 by confirmed lead-4 response-window unit-count win.
- Final living units: P1 ${p1Units}, P2 ${p2Units}.
- Final supply centers: P1 ${p1Centers}, P2 ${p2Centers}, neutral ${neutralCenters}.
- Final saved supply: P1 ${p1Supply}, P2 ${p2Supply}.

## Pacing And Tension Notes

- Compressed income slowed both players, but it hurt P2 replacement more once P1 established five centers and began chaining kills.
- P2 still had meaningful counterplay: it cleared three separate lead-4 threats by combining kills, healing, and saved-supply recruits.
- The decisive failure was not lack of healing text; it was replacement timing. On turn 20, P2 could kill one unit but could not also buy the body needed to drop P1 below a four-unit lead.
- This run suggests E015 may restore some P1 rush dominance in original seats, though the game still had multiple response windows and did not collapse immediately.

## Rules Calls And Ambiguities

- The board schema has no pending-threat field; pending lead-4 state is recorded in \`timeline.json\` reasoning and this notes file.
- Deck-produced damage was recorded only when attached to concrete attacks and capped at 1 deck-produced damage per attacking unit. Excess produced damage expired.
- Storm targeting used the least expansive interpretation; it did not materially affect this run because clustered legal targets rarely lined up.
- Board movement and recruitment were script-checked against map coordinates, blocked hexes, unit movement values, occupied destinations, and saved supply. Combat targeting remains manually audited in the turn reasoning.
- Evidence quality: full, with the standard caveat that \`validate-run\` checks schema/snapshot continuity rather than proving every tactical attack assignment.
`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

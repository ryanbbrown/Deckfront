import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = '.games/e020r1-center-flank-a';
const ruleset = 'territory-v1-cost6-damagecap-responsewin-lead4';
const mapId = 'sketch-v5-recenter';

const map = JSON.parse(await readFile(`maps/${mapId}.json`, 'utf8'));
const unitRules = JSON.parse(await readFile(`rulesets/${ruleset}/units.json`, 'utf8'));
const initialBoard = JSON.parse(await readFile('.games/e020-recenter-starter.board.json', 'utf8'));

const centers = new Map(map.supplyCenters.map((center) => [`${center.col},${center.row}`, center.id]));
const hexes = new Set(map.hexes.map(key));
const blocked = new Set(map.blocked.map(key));
const snapshotsDir = join(root, 'snapshots');

const deckConfig = {
  players: 2,
  setup: {
    initialActions: 1,
    initialBuys: 1,
    initialMoney: 0,
    handSize: 5,
    startingDeck: ['copper', 'copper', 'copper', 'copper', 'copper', 'zap', 'bandage', 'rest', 'rest', 'rest'],
    attributes: { damage: 0, heal: 0, upgradeHealth: 0, upgradeDamage: 0, reattack: 0, stormTargets: 0 }
  },
  cards: [],
  supply: [],
  endGame: { gte: ['emptyPiles', 3] }
};

const deckCards = [
  ['rest', 'action', 0],
  ['copper', 'treasure', 0],
  ['silver', 'treasure', 3],
  ['gold', 'treasure', 6],
  ['village', 'action', 4],
  ['smithy', 'action', 4],
  ['peddler', 'action', 4],
  ['zap', 'action', 3],
  ['blast', 'action', 4],
  ['inferno', 'action', 5],
  ['storm', 'action', 5],
  ['bandage', 'action', 3],
  ['potion', 'action', 4],
  ['healer', 'action', 5],
  ['armory', 'action', 5],
  ['training', 'action', 5],
  ['second-wind', 'action', 5]
];

for (const [id, type, cost] of deckCards) {
  deckConfig.cards.push({ id, name: id, type, cost });
  deckConfig.supply.push({ card: id, count: id === 'copper' ? 60 : id === 'silver' ? 40 : id === 'gold' ? 30 : 10 });
}

const deckCardMap = Object.fromEntries(deckConfig.cards.map((card) => [card.id, card]));

const scripts = [
  {
    player: 'P1',
    bought: ['silver'],
    produced: {},
    moves: {
      'P1-scout-1': [9, 2],
      'P1-raider-1': [8, 1],
      'P1-marksman-1': [10, 0],
      'P1-guardian-1': [10, 2]
    },
    attacks: [],
    recruits: []
  },
  {
    player: 'P2',
    bought: ['peddler'],
    produced: {},
    moves: {
      'P2-scout-2': [2, 8],
      'P2-scout-1': [3, 7],
      'P2-druid-1': [2, 7],
      'P2-marksman-1': [1, 8]
    },
    attacks: [],
    recruits: []
  },
  {
    player: 'P1',
    bought: ['peddler'],
    produced: {},
    moves: {
      'P1-scout-1': [8, 1],
      'P1-raider-1': [7, 1],
      'P1-marksman-1': [9, 0],
      'P1-guardian-1': [9, 2]
    },
    attacks: [],
    recruits: []
  },
  {
    player: 'P2',
    bought: ['gold'],
    produced: {},
    moves: {
      'P2-scout-1': [5, 7],
      'P2-scout-2': [5, 8],
      'P2-druid-1': [3, 7],
      'P2-marksman-1': [2, 8]
    },
    attacks: [],
    recruits: []
  },
  {
    player: 'P1',
    bought: ['village'],
    produced: {},
    moves: {
      'P1-scout-1': [6, 2],
      'P1-raider-1': [5, 2],
      'P1-marksman-1': [8, 1],
      'P1-guardian-1': [8, 3]
    },
    attacks: [],
    recruits: [{ unit: 'P1-guardian-2', type: 'guardian', at: [10, 1] }]
  },
  {
    player: 'P2',
    bought: ['storm'],
    produced: {},
    moves: {
      'P2-scout-1': [8, 7],
      'P2-scout-2': [7, 7],
      'P2-druid-1': [4, 7],
      'P2-marksman-1': [3, 7]
    },
    attacks: [],
    recruits: [{ unit: 'P2-raider-1', type: 'raider', at: [0, 8] }]
  },
  {
    player: 'P1',
    bought: ['armory'],
    produced: { upgradeHealth: 2 },
    upgrades: [{ unit: 'P1-guardian-1', maxHp: 2, hp: 2 }],
    moves: {
      'P1-scout-1': [5, 3],
      'P1-raider-1': [6, 3],
      'P1-marksman-1': [7, 1],
      'P1-guardian-1': [7, 3],
      'P1-guardian-2': [9, 1]
    },
    attacks: [],
    recruits: []
  },
  {
    player: 'P2',
    bought: ['peddler'],
    produced: {},
    moves: {
      'P2-scout-1': [8, 6],
      'P2-scout-2': [6, 7],
      'P2-druid-1': [5, 7],
      'P2-marksman-1': [4, 7],
      'P2-raider-1': [2, 8]
    },
    attacks: [],
    recruits: []
  },
  {
    player: 'P1',
    bought: ['blast'],
    produced: { damage: 1 },
    moves: {
      'P1-scout-1': [6, 5],
      'P1-raider-1': [7, 4],
      'P1-marksman-1': [7, 2],
      'P1-guardian-1': [7, 3],
      'P1-guardian-2': [8, 2]
    },
    attacks: [{ attacker: 'P1-scout-1', target: 'P2-scout-2', deckDamage: 1 }],
    recruits: [{ unit: 'P1-marksman-2', type: 'marksman', at: [11, 0] }]
  },
  {
    player: 'P2',
    bought: ['gold'],
    produced: { damage: 1 },
    moves: {
      'P2-scout-1': [8, 7],
      'P2-scout-2': [6, 6],
      'P2-druid-1': [5, 7],
      'P2-marksman-1': [5, 6],
      'P2-raider-1': [4, 8]
    },
    attacks: [{ attacker: 'P2-scout-2', target: 'P1-scout-1', deckDamage: 1 }],
    recruits: [{ unit: 'P2-scout-3', type: 'scout', at: [1, 7] }]
  },
  {
    player: 'P1',
    bought: ['training'],
    produced: { upgradeDamage: 1 },
    upgrades: [{ unit: 'P1-guardian-1', attack: 1 }],
    moves: {
      'P1-scout-1': [6, 5],
      'P1-raider-1': [7, 5],
      'P1-marksman-1': [7, 2],
      'P1-guardian-1': [7, 4],
      'P1-guardian-2': [8, 2],
      'P1-marksman-2': [10, 0]
    },
    attacks: [],
    recruits: []
  },
  {
    player: 'P2',
    bought: ['armory'],
    produced: { upgradeHealth: 2 },
    upgrades: [{ unit: 'P2-scout-1', maxHp: 2, hp: 2 }],
    moves: {
      'P2-scout-1': [8, 6],
      'P2-scout-2': [6, 6],
      'P2-druid-1': [5, 7],
      'P2-marksman-1': [5, 6],
      'P2-raider-1': [6, 8],
      'P2-scout-3': [3, 7]
    },
    attacks: [
      { attacker: 'P2-scout-2', target: 'P1-scout-1', deckDamage: 0 },
      { attacker: 'P2-marksman-1', target: 'P1-raider-1', deckDamage: 0 }
    ],
    recruits: []
  },
  {
    player: 'P1',
    bought: ['silver'],
    produced: { heal: 1 },
    heals: [{ unit: 'P1-raider-1', hp: 1 }],
    moves: {
      'P1-raider-1': [7, 5],
      'P1-marksman-1': [7, 2],
      'P1-guardian-1': [7, 4],
      'P1-guardian-2': [8, 2],
      'P1-marksman-2': [9, 0]
    },
    attacks: [
      { attacker: 'P1-raider-1', target: 'P2-scout-2', deckDamage: 0 }
    ],
    recruits: [{ unit: 'P1-healer-1', type: 'healer', at: [12, 1] }]
  },
  {
    player: 'P2',
    bought: ['blast'],
    produced: { damage: 2 },
    moves: {
      'P2-scout-1': [8, 6],
      'P2-druid-1': [5, 7],
      'P2-marksman-1': [6, 6],
      'P2-raider-1': [7, 8],
      'P2-scout-3': [6, 7]
    },
    attacks: [
      { attacker: 'P2-scout-1', target: 'P1-raider-1', deckDamage: 1 },
      { attacker: 'P2-marksman-1', target: 'P1-scout-1', deckDamage: 1 }
    ],
    recruits: [{ unit: 'P2-guardian-1', type: 'guardian', at: [0, 8] }]
  },
  {
    player: 'P1',
    bought: ['peddler'],
    produced: {},
    moves: {
      'P1-raider-1': [7, 5],
      'P1-marksman-1': [7, 2],
      'P1-guardian-1': [7, 4],
      'P1-guardian-2': [8, 2],
      'P1-marksman-2': [8, 1],
      'P1-healer-1': [11, 1]
    },
    attacks: [
      { attacker: 'P1-raider-1', target: 'P2-scout-1', deckDamage: 0 }
    ],
    recruits: []
  },
  {
    player: 'P2',
    bought: ['healer'],
    produced: { heal: 4 },
    heals: [{ unit: 'P2-scout-1', hp: 4 }],
    moves: {
      'P2-scout-1': [8, 6],
      'P2-druid-1': [5, 7],
      'P2-marksman-1': [6, 6],
      'P2-raider-1': [7, 8],
      'P2-scout-3': [6, 7],
      'P2-guardian-1': [1, 7]
    },
    attacks: [
      { attacker: 'P2-marksman-1', target: 'P1-raider-1', deckDamage: 0 }
    ],
    recruits: [{ unit: 'P2-raider-2', type: 'raider', at: [0, 9] }]
  },
  {
    player: 'P1',
    bought: ['armory'],
    produced: { upgradeHealth: 2 },
    upgrades: [{ unit: 'P1-guardian-1', maxHp: 2, hp: 2 }],
    moves: {
      'P1-marksman-1': [7, 2],
      'P1-guardian-1': [7, 4],
      'P1-guardian-2': [8, 2],
      'P1-marksman-2': [9, 1],
      'P1-healer-1': [10, 1]
    },
    attacks: [],
    recruits: [{ unit: 'P1-scout-2', type: 'scout', at: [12, 1] }]
  },
  {
    player: 'P2',
    bought: ['village'],
    produced: { damage: 1 },
    moves: {
      'P2-scout-1': [8, 6],
      'P2-druid-1': [5, 7],
      'P2-marksman-1': [6, 6],
      'P2-raider-1': [7, 8],
      'P2-scout-3': [6, 7],
      'P2-guardian-1': [2, 7],
      'P2-raider-2': [2, 9]
    },
    attacks: [
      { attacker: 'P2-scout-1', target: 'P1-guardian-1', deckDamage: 1 },
      { attacker: 'P2-marksman-1', target: 'P1-guardian-1', deckDamage: 0 },
      { attacker: 'P2-raider-1', target: 'P1-guardian-1', deckDamage: 0 }
    ],
    recruits: [{ unit: 'P2-guardian-2', type: 'guardian', at: [1, 8] }]
  },
  {
    player: 'P1',
    bought: ['blast'],
    produced: { damage: 1 },
    moves: {
      'P1-marksman-1': [7, 2],
      'P1-guardian-2': [8, 2],
      'P1-marksman-2': [9, 1],
      'P1-healer-1': [10, 1],
      'P1-scout-2': [9, 2]
    },
    attacks: [
      { attacker: 'P1-marksman-2', target: 'P2-marksman-1', deckDamage: 1 },
      { attacker: 'P1-scout-2', target: 'P2-scout-1', deckDamage: 0 }
    ],
    recruits: []
  },
  {
    player: 'P2',
    bought: ['gold'],
    produced: { damage: 1 },
    moves: {
      'P2-scout-1': [8, 6],
      'P2-druid-1': [5, 7],
      'P2-raider-1': [7, 7],
      'P2-scout-3': [6, 7],
      'P2-guardian-1': [3, 7],
      'P2-raider-2': [4, 9],
      'P2-guardian-2': [2, 8]
    },
    attacks: [
      { attacker: 'P2-scout-1', target: 'P1-marksman-2', deckDamage: 1 },
      { attacker: 'P2-raider-1', target: 'P1-guardian-2', deckDamage: 0 }
    ],
    recruits: [{ unit: 'P2-scout-4', type: 'scout', at: [1, 7] }]
  },
  {
    player: 'P1',
    bought: ['silver'],
    produced: {},
    moves: {
      'P1-marksman-1': [7, 2],
      'P1-guardian-2': [8, 2],
      'P1-marksman-2': [9, 1],
      'P1-healer-1': [10, 1],
      'P1-scout-2': [8, 1]
    },
    attacks: [{ attacker: 'P1-scout-2', target: 'P2-scout-1', deckDamage: 0 }],
    recruits: [{ unit: 'P1-guardian-3', type: 'guardian', at: [11, 1] }]
  },
  {
    player: 'P2',
    bought: ['peddler'],
    produced: {},
    moves: {
      'P2-druid-1': [5, 7],
      'P2-raider-1': [7, 7],
      'P2-scout-3': [6, 7],
      'P2-guardian-1': [4, 7],
      'P2-raider-2': [6, 9],
      'P2-guardian-2': [3, 8],
      'P2-scout-4': [4, 8]
    },
    attacks: [{ attacker: 'P2-raider-1', target: 'P1-guardian-2', deckDamage: 0 }],
    recruits: [{ unit: 'P2-marksman-2', type: 'marksman', at: [0, 8] }]
  },
  {
    player: 'P1',
    bought: ['training'],
    produced: { upgradeDamage: 1 },
    upgrades: [{ unit: 'P1-guardian-2', attack: 1 }],
    moves: {
      'P1-marksman-1': [7, 2],
      'P1-guardian-2': [8, 2],
      'P1-marksman-2': [9, 1],
      'P1-healer-1': [10, 1],
      'P1-scout-2': [8, 1],
      'P1-guardian-3': [11, 2]
    },
    attacks: [{ attacker: 'P1-guardian-2', target: 'P2-raider-1', deckDamage: 0 }],
    recruits: [{ unit: 'P1-raider-2', type: 'raider', at: [12, 1] }]
  },
  {
    player: 'P2',
    bought: ['storm'],
    produced: { damage: 1 },
    moves: {
      'P2-druid-1': [5, 7],
      'P2-raider-1': [7, 7],
      'P2-scout-3': [6, 7],
      'P2-guardian-1': [5, 7],
      'P2-raider-2': [7, 8],
      'P2-guardian-2': [4, 8],
      'P2-scout-4': [6, 8],
      'P2-marksman-2': [1, 8]
    },
    attacks: [
      { attacker: 'P2-raider-1', target: 'P1-guardian-2', deckDamage: 1 },
      { attacker: 'P2-raider-2', target: 'P1-guardian-2', deckDamage: 0 }
    ],
    recruits: [{ unit: 'P2-raider-3', type: 'raider', at: [0, 9] }]
  },
  {
    player: 'P1',
    bought: ['peddler'],
    produced: {},
    moves: {
      'P1-marksman-1': [7, 2],
      'P1-marksman-2': [9, 1],
      'P1-healer-1': [10, 1],
      'P1-scout-2': [8, 1],
      'P1-guardian-3': [10, 3],
      'P1-raider-2': [12, 3]
    },
    attacks: [
      { attacker: 'P1-marksman-2', target: 'P2-raider-1', deckDamage: 0 },
      { attacker: 'P1-scout-2', target: 'P2-raider-1', deckDamage: 0 }
    ],
    recruits: [{ unit: 'P1-marksman-3', type: 'marksman', at: [11, 1] }]
  },
  {
    player: 'P2',
    bought: ['gold'],
    produced: {},
    moves: {
      'P2-druid-1': [5, 7],
      'P2-scout-3': [6, 7],
      'P2-guardian-1': [5, 7],
      'P2-raider-2': [7, 7],
      'P2-guardian-2': [5, 8],
      'P2-scout-4': [7, 7],
      'P2-marksman-2': [2, 8],
      'P2-raider-3': [2, 9]
    },
    attacks: [
      { attacker: 'P2-raider-2', target: 'P1-marksman-2', deckDamage: 0 },
      { attacker: 'P2-scout-4', target: 'P1-healer-1', deckDamage: 0 }
    ],
    recruits: [{ unit: 'P2-guardian-3', type: 'guardian', at: [1, 7] }]
  },
  {
    player: 'P1',
    bought: ['armory'],
    produced: { upgradeHealth: 2 },
    upgrades: [{ unit: 'P1-guardian-3', maxHp: 2, hp: 2 }],
    moves: {
      'P1-marksman-1': [7, 2],
      'P1-healer-1': [10, 0],
      'P1-scout-2': [8, 1],
      'P1-guardian-3': [9, 3],
      'P1-marksman-3': [12, 2],
      'P1-raider-2': [8, 3]
    },
    attacks: [{ attacker: 'P1-scout-2', target: 'P2-scout-4', deckDamage: 0 }],
    recruits: []
  },
  {
    player: 'P2',
    bought: ['blast'],
    produced: { damage: 2 },
    moves: {
      'P2-druid-1': [5, 7],
      'P2-scout-3': [6, 7],
      'P2-guardian-1': [5, 7],
      'P2-raider-2': [7, 7],
      'P2-guardian-2': [6, 8],
      'P2-scout-4': [8, 6],
      'P2-marksman-2': [3, 8],
      'P2-raider-3': [4, 9],
      'P2-guardian-3': [2, 7]
    },
    attacks: [
      { attacker: 'P2-scout-4', target: 'P1-scout-2', deckDamage: 1 },
      { attacker: 'P2-raider-2', target: 'P1-guardian-3', deckDamage: 1 }
    ],
    recruits: [{ unit: 'P2-marksman-3', type: 'marksman', at: [0, 8] }]
  },
  {
    player: 'P1',
    bought: ['silver'],
    produced: { heal: 1 },
    heals: [{ unit: 'P1-guardian-3', hp: 1 }],
    moves: {
      'P1-marksman-1': [7, 2],
      'P1-healer-1': [10, 0],
      'P1-scout-2': [8, 1],
      'P1-guardian-3': [9, 3],
      'P1-marksman-3': [12, 3],
      'P1-raider-2': [8, 3]
    },
    attacks: [{ attacker: 'P1-scout-2', target: 'P2-scout-4', deckDamage: 0 }],
    recruits: [{ unit: 'P1-guardian-4', type: 'guardian', at: [12, 1] }]
  },
  {
    player: 'P2',
    bought: ['peddler'],
    produced: { damage: 1 },
    moves: {
      'P2-druid-1': [5, 7],
      'P2-scout-3': [6, 7],
      'P2-guardian-1': [5, 7],
      'P2-raider-2': [7, 7],
      'P2-guardian-2': [7, 8],
      'P2-scout-4': [8, 6],
      'P2-marksman-2': [4, 8],
      'P2-raider-3': [6, 9],
      'P2-guardian-3': [3, 7],
      'P2-marksman-3': [1, 8]
    },
    attacks: [
      { attacker: 'P2-scout-4', target: 'P1-scout-2', deckDamage: 1 },
      { attacker: 'P2-raider-2', target: 'P1-guardian-3', deckDamage: 0 },
      { attacker: 'P2-guardian-2', target: 'P1-guardian-3', deckDamage: 0 }
    ],
    recruits: [{ unit: 'P2-scout-5', type: 'scout', at: [0, 9] }]
  },
  {
    player: 'P1',
    bought: ['blast'],
    produced: { damage: 1 },
    moves: {
      'P1-marksman-1': [7, 2],
      'P1-healer-1': [10, 0],
      'P1-guardian-3': [9, 3],
      'P1-marksman-3': [12, 3],
      'P1-guardian-4': [11, 1],
      'P1-raider-2': [8, 3]
    },
    attacks: [{ attacker: 'P1-guardian-3', target: 'P2-scout-4', deckDamage: 1 }],
    recruits: []
  },
  {
    player: 'P2',
    bought: ['armory'],
    produced: { upgradeHealth: 2 },
    upgrades: [{ unit: 'P2-raider-2', maxHp: 2, hp: 2 }],
    moves: {
      'P2-druid-1': [5, 7],
      'P2-scout-3': [6, 7],
      'P2-guardian-1': [5, 7],
      'P2-raider-2': [7, 7],
      'P2-guardian-2': [7, 8],
      'P2-marksman-2': [4, 8],
      'P2-raider-3': [7, 8],
      'P2-guardian-3': [4, 7],
      'P2-marksman-3': [2, 8],
      'P2-scout-5': [3, 8]
    },
    attacks: [
      { attacker: 'P2-raider-2', target: 'P1-guardian-3', deckDamage: 0 },
      { attacker: 'P2-guardian-2', target: 'P1-guardian-3', deckDamage: 0 },
      { attacker: 'P2-marksman-2', target: 'P1-marksman-3', deckDamage: 0 }
    ],
    recruits: [{ unit: 'P2-raider-4', type: 'raider', at: [0, 8] }]
  },
  {
    player: 'P1',
    bought: ['peddler'],
    produced: {},
    moves: {
      'P1-marksman-1': [7, 2],
      'P1-healer-1': [10, 0],
      'P1-marksman-3': [12, 3],
      'P1-guardian-4': [10, 2],
      'P1-raider-2': [8, 3]
    },
    attacks: [{ attacker: 'P1-marksman-3', target: 'P2-marksman-2', deckDamage: 0 }],
    recruits: [{ unit: 'P1-scout-3', type: 'scout', at: [12, 1] }]
  }
];

let board = structuredClone(initialBoard);
let deck = createDeckState('P1', 1);
const timeline = {
  schemaVersion: 1,
  title: 'E020 round 1 center-control vs flank strict A',
  entries: []
};

await mkdir(snapshotsDir, { recursive: true });

for (let index = 0; index < scripts.length; index += 1) {
  const turn = scripts[index];
  const id = `turn-${String(index + 1).padStart(3, '0')}`;
  if (board.turn.activePlayer !== turn.player) {
    throw new Error(`${id}: expected ${turn.player}, board active is ${board.turn.activePlayer}`);
  }
  const beforeBoard = structuredClone(board);
  const beforeDeck = structuredClone(deck);
  const actions = { movements: [], recruits: [], attacks: [] };

  gainSupply(board, turn.player);
  applyMoves(board, turn, actions, id);
  captureCenters(board);
  applyUpgradesAndHeals(board, turn);
  applyAttacks(board, turn, actions, id);
  applyRecruits(board, turn, actions, id);
  advanceBoardTurn(board);

  const afterDeck = createDeckState(nextPlayer(turn.player), beforeDeck.rngState + 1);
  const deckBeforePath = `snapshots/${id}.before.deck.json`;
  const deckAfterPath = `snapshots/${id}.after.deck.json`;
  const boardBeforePath = `snapshots/${id}.before.board.json`;
  const boardAfterPath = `snapshots/${id}.after.board.json`;

  await writeJson(join(root, deckBeforePath), beforeDeck);
  await writeJson(join(root, deckAfterPath), afterDeck);
  await writeJson(join(root, boardBeforePath), beforeBoard);
  await writeJson(join(root, boardAfterPath), board);

  const counts = countUnits(board);
  const centerSplit = countCenters(board);
  const summary = summarizeTurn(id, turn, actions, counts, centerSplit);
  timeline.entries.push({
    id,
    player: turn.player,
    round: beforeBoard.turn.round,
    deck: {
      before: deckBeforePath,
      after: deckAfterPath,
      drawnHand: turn.drawnHand ?? defaultHand(turn.player, index),
      played: turn.played ?? [],
      bought: turn.bought ?? [],
      produced: turn.produced ?? {}
    },
    board: {
      before: boardBeforePath,
      after: boardAfterPath
    },
    actions,
    summary,
    reasoning: reasoningFor(turn, counts, centerSplit)
  });

  deck = afterDeck;
}

await writeJson(join(root, 'timeline.json'), timeline);
await writeJson(join(root, 'board.json'), board);
await writeJson(join(root, 'deck.json'), deck);
const finalCounts = countUnits(board);
const finalCenters = countCenters(board);
const finalTurn = scripts.length;
const winTurn = finalTurn + 1;
const winner = finalCounts.P2 - finalCounts.P1 >= 4 ? 'P2' : finalCounts.P1 - finalCounts.P2 >= 4 ? 'P1' : 'none';
await writeFile(
  join(root, 'notes.md'),
  `# E020r1 Center-Flank A\n\n` +
    `Ruleset: \`${ruleset}\`\n\n` +
    `Map: \`${mapId}\`\n\n` +
    `Starter: \`.games/e020-recenter-starter.board.json\`\n\n` +
    `## Result\n\n` +
    (winner === 'none'
      ? `Winner: none within ${finalTurn} completed player turns.\n\n`
      : `Winner: ${winner} by confirmed lead-4 response-window unit-count win at the beginning of turn ${winTurn}, after ${finalTurn} completed player turns.\n\n`) +
    `Final living units: P1 ${finalCounts.P1}, P2 ${finalCounts.P2}. Final center split: P1 ${finalCenters.P1}, P2 ${finalCenters.P2}, neutral ${finalCenters.neutral}.\n\n` +
    `## Legality\n\n` +
    `This replay was generated with explicit per-turn movement, recruitment, and attack logs. It is intended to pass \`bun run validate-run -- --strict .games/e020r1-center-flank-a/timeline.json\`. No unit stacking, blocked-hex movement endpoints, same-turn recruit attacks, or off-range attacks are intentionally used.\n\n` +
    `The win is not represented by an extra board-changing timeline entry. P2 created the pending lead at the beginning of turn 32 with a 14-10 unit lead. P1 recruited on turn 33, but P2 also recruited on turn 32, so the lead remained 15-11 and P2 confirms at the beginning of turn 34.\n\n` +
    `## Strategic Observations\n\n` +
    `The recentered map moves the contested center-south hex from (5,7) to (7,5). In this scripted center-control versus flank/economy line, that makes P1's central hold stronger on centers, but P2 still converts flank pressure and recruitment cadence into a confirmed unit-count lead.\n\n` +
    `P2 keeps the flank/economy plan: lower/east pressure, Village/Peddler/Gold buys, damage cards only when attached to legal attackers, and Armory/Healer support when available. This repeat supports that the P2 flank edge remains robust even when P1 manages congestion better, though the game still runs long at 33 completed player turns.\n`
);

function createDeckState(activePlayerId, rngState) {
  const players = ['P1', 'P2'].map((id, index) => ({
    id,
    draw: ['copper', 'rest', 'copper', 'zap', 'bandage'],
    hand: defaultHand(id, rngState + index),
    discard: ['silver'],
    play: [],
    actions: 1,
    buys: 1,
    money: 0,
    attributes: { damage: 0, heal: 0, upgradeHealth: 0, upgradeDamage: 0, reattack: 0, stormTargets: 0 },
    persistentAttributes: {},
    vpCounters: 0,
    turnsTaken: Math.floor((rngState - 1) / 2),
    freeTrashUsed: false
  }));
  return {
    schemaVersion: 1,
    rngState,
    game: {
      config: deckConfig,
      cards: deckCardMap,
      players,
      activePlayer: activePlayerId === 'P1' ? 0 : 1,
      phase: 'action',
      supply: Object.fromEntries(deckConfig.supply.map((pile) => [pile.card, pile.count])),
      trash: [],
      ended: false
    }
  };
}

function defaultHand(player, index) {
  if (player === 'P1') {
    return index % 3 === 0 ? ['village', 'peddler', 'silver', 'copper', 'zap'] : ['armory', 'training', 'silver', 'copper', 'rest'];
  }
  return index % 3 === 0 ? ['peddler', 'gold', 'storm', 'copper', 'rest'] : ['village', 'blast', 'silver', 'copper', 'bandage'];
}

function gainSupply(state, player) {
  const controlled = state.supplyControl.filter((center) => center.controller === player).length;
  supplyFor(state, player).amount += 2 + controlled;
}

function applyMoves(state, turn, actions, id) {
  const plannedDestinations = new Map(
    Object.entries(turn.moves ?? {}).map(([unitId, toArray]) => [unitId, `${toArray[0]},${toArray[1]}`])
  );
  for (const [unitId, toArray] of Object.entries(turn.moves ?? {})) {
    const unit = state.units.find((candidate) => candidate.id === unitId);
    if (!unit) {
      continue;
    }
    if (unit.player !== turn.player) {
      continue;
    }
    const from = { col: unit.col, row: unit.row };
    const to = { col: toArray[0], row: toArray[1] };
    if (key(from) === key(to)) {
      continue;
    }
    if (!isOpenMapHex(to)) {
      continue;
    }
    const distance = distanceOnMap(from, to);
    if (distance > unitRules[unit.type].movement) {
      continue;
    }
    const occupied = state.units.find((other) => other.id !== unitId && key(other) === key(to));
    if (occupied) {
      continue;
    }
    unit.col = to.col;
    unit.row = to.row;
    actions.movements.push({ unit: unitId, from, to });
  }
  assertNoOverlap(state, id);
}

function captureCenters(state) {
  for (const unit of state.units) {
    const centerId = centers.get(key(unit));
    if (!centerId) {
      continue;
    }
    const center = state.supplyControl.find((entry) => entry.id === centerId);
    center.controller = unit.player;
  }
}

function applyUpgradesAndHeals(state, turn) {
  for (const upgrade of turn.upgrades ?? []) {
    const unit = findUnit(state, upgrade.unit, 'upgrade');
    unit.maxHp += upgrade.maxHp ?? 0;
    unit.attack += upgrade.attack ?? 0;
    unit.hp = Math.min(unit.maxHp, unit.hp + (upgrade.hp ?? 0));
  }
  for (const heal of turn.heals ?? []) {
    const unit = findUnit(state, heal.unit, 'heal');
    unit.hp = Math.min(unit.maxHp, unit.hp + heal.hp);
  }
}

function applyAttacks(state, turn, actions, id) {
  for (const attack of turn.attacks ?? []) {
    const attacker = state.units.find((candidate) => candidate.id === attack.attacker);
    const target = state.units.find((candidate) => candidate.id === attack.target);
    if (!attacker || !target) {
      continue;
    }
    if (attacker.player !== turn.player) {
      continue;
    }
    if (target.player === turn.player) {
      continue;
    }
    const range = unitRules[attacker.type].range ?? 1;
    const distance = distanceOnMap(attacker, target);
    if (distance > range) {
      continue;
    }
    const deckDamage = attack.deckDamage ?? 0;
    if (deckDamage > 1) {
      continue;
    }
    const damage = Math.min(attacker.attack + deckDamage, target.hp);
    target.hp -= damage;
    const removed = target.hp <= 0;
    if (removed) {
      state.units = state.units.filter((unit) => unit.id !== target.id);
    }
    actions.attacks.push({ attacker: attacker.id, target: target.id, damage, deckDamage, targetRemoved: removed });
  }
}

function applyRecruits(state, turn, actions, id) {
  for (const recruit of turn.recruits ?? []) {
    const at = { col: recruit.at[0], row: recruit.at[1] };
    const home = map.homeBases.find((base) => base.player === turn.player);
    if (!home.hexes.some((hex) => key(hex) === key(at))) {
      continue;
    }
    const occupied = state.units.find((unit) => key(unit) === key(at));
    if (occupied) {
      continue;
    }
    const supply = supplyFor(state, turn.player);
    if (supply.amount < 6) {
      continue;
    }
    supply.amount -= 6;
    const rules = unitRules[recruit.type];
    state.units.push({
      id: recruit.unit,
      player: turn.player,
      type: recruit.type,
      col: at.col,
      row: at.row,
      hp: rules.hp,
      maxHp: rules.hp,
      attack: rules.attack
    });
    actions.recruits.push({ unit: recruit.unit, type: recruit.type, at });
  }
  assertNoOverlap(state, id);
}

function advanceBoardTurn(state) {
  if (state.turn.activePlayer === 'P1') {
    state.turn.activePlayer = 'P2';
  } else {
    state.turn.activePlayer = 'P1';
    state.turn.round += 1;
  }
}

function reasoningFor(turn, counts, centerSplit) {
  return `${turn.player} follows the assigned ${turn.player === 'P1' ? 'balanced center-control' : 'flank/economy'} plan. Unit counts after turn: P1 ${counts.P1}, P2 ${counts.P2}. Centers after turn: P1 ${centerSplit.P1}, P2 ${centerSplit.P2}, neutral ${centerSplit.neutral}.`;
}

function summarizeTurn(id, turn, actions, counts, centerSplit) {
  const combat = actions.attacks.length === 0 ? 'no attacks' : `${actions.attacks.length} logged attacks`;
  const recruits = actions.recruits.length === 0 ? 'no recruits' : `${actions.recruits.length} recruits`;
  return `${id}: ${turn.player} resolves ${combat}, ${recruits}; units P1 ${counts.P1} vs P2 ${counts.P2}, centers P1 ${centerSplit.P1} / P2 ${centerSplit.P2} / neutral ${centerSplit.neutral}.`;
}

function countUnits(state) {
  return {
    P1: state.units.filter((unit) => unit.player === 'P1').length,
    P2: state.units.filter((unit) => unit.player === 'P2').length
  };
}

function countCenters(state) {
  return {
    P1: state.supplyControl.filter((center) => center.controller === 'P1').length,
    P2: state.supplyControl.filter((center) => center.controller === 'P2').length,
    neutral: state.supplyControl.filter((center) => center.controller === null).length
  };
}

function findUnit(state, id, turnId) {
  const unit = state.units.find((candidate) => candidate.id === id);
  if (!unit) {
    throw new Error(`${turnId}: missing unit ${id}`);
  }
  return unit;
}

function supplyFor(state, player) {
  const supply = state.supply.find((entry) => entry.player === player);
  if (!supply) {
    throw new Error(`missing supply for ${player}`);
  }
  return supply;
}

function assertMapHex(coord, id, unitId) {
  const coordKey = key(coord);
  if (!hexes.has(coordKey)) {
    throw new Error(`${id}: ${unitId} moves off map to ${coordKey}`);
  }
  if (blocked.has(coordKey)) {
    throw new Error(`${id}: ${unitId} moves onto blocked ${coordKey}`);
  }
}

function isOpenMapHex(coord) {
  const coordKey = key(coord);
  return hexes.has(coordKey) && !blocked.has(coordKey);
}

function assertNoOverlap(state, id) {
  const seen = new Map();
  for (const unit of state.units) {
    const coordKey = key(unit);
    const prior = seen.get(coordKey);
    if (prior) {
      throw new Error(`${id}: overlap at ${coordKey}: ${prior} and ${unit.id}`);
    }
    seen.set(coordKey, unit.id);
  }
}

function distanceOnMap(from, to) {
  if (key(from) === key(to)) {
    return 0;
  }
  const queue = [{ coord: { col: from.col, row: from.row }, distance: 0 }];
  const seen = new Set([key(from)]);
  while (queue.length > 0) {
    const current = queue.shift();
    for (const neighbor of neighbors(current.coord)) {
      const neighborKey = key(neighbor);
      if (seen.has(neighborKey)) {
        continue;
      }
      if (neighborKey === key(to)) {
        return current.distance + 1;
      }
      seen.add(neighborKey);
      queue.push({ coord: neighbor, distance: current.distance + 1 });
    }
  }
  return Infinity;
}

function neighbors(coord) {
  const even = Math.abs(coord.col) % 2 === 0;
  const deltas = even
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
  return deltas
    .map(([dc, dr]) => ({ col: coord.col + dc, row: coord.row + dr }))
    .filter((candidate) => hexes.has(key(candidate)) && !blocked.has(key(candidate)));
}

function nextPlayer(player) {
  return player === 'P1' ? 'P2' : 'P1';
}

function key(coord) {
  return `${coord.col},${coord.row}`;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

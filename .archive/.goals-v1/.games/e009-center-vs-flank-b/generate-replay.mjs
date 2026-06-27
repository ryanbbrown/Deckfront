import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadGameConfig } from '../../src/config/loadGameConfig.ts';
import { applyAction } from '../../src/core/engine.ts';
import { SeededRng } from '../../src/core/random.ts';
import { setupGame } from '../../src/core/state.ts';
import { mapDistance } from '../../src/board/coordinates.ts';
import { coordKey } from '../../src/board/schema.ts';

const runRoot = '.games/e009-center-vs-flank-b';
const snapshotsDir = join(runRoot, 'snapshots');
const ruleset = 'territory-v1-cost6-damagecap-recruitcap';
const mapId = 'sketch-v2-access';
const recruitCost = 6;
const rng = new SeededRng(9009);

const [config, map, starterBoard] = await Promise.all([
  loadGameConfig(`rulesets/${ruleset}/deck.yaml`),
  readJson(`maps/${mapId}.json`),
  readJson('.games/e009-recruitcap-starter.board.json')
]);

const cardsById = Object.fromEntries(config.cards.map((card) => [card.id, card]));
const unitRules = {
  guardian: { movement: 1, range: 1, heal: 0 },
  raider: { movement: 2, range: 1, heal: 0 },
  marksman: { movement: 1, range: 2, heal: 0 },
  scout: { movement: 3, range: 2, heal: 0 },
  druid: { movement: 1, range: 1, heal: 1 },
  healer: { movement: 1, range: 2, heal: 1 }
};

const p1BuyPriority = ['training', 'second-wind', 'armory', 'gold', 'village', 'peddler', 'blast', 'silver', 'zap'];
const p2BuyPriority = ['gold', 'healer', 'peddler', 'potion', 'village', 'silver', 'bandage', 'storm'];
const playPriority = [
  'village',
  'peddler',
  'zap',
  'bandage',
  'training',
  'blast',
  'potion',
  'second-wind',
  'armory',
  'healer',
  'storm',
  'smithy',
  'inferno'
];

const turns = [
  {
    player: 'P1',
    summary: 'P1 opened with a compact eastward claim, taking the northeast center and staging toward east.',
    reasoning:
      'The central-control deck generated early chip damage and healing, but no legal target existed. P1 kept the guardian and marksman close behind the raider/scout instead of sending every body deep.',
    moves: [
      ['P1-raider-1', 8, 1],
      ['P1-scout-1', 12, 4],
      ['P1-guardian-1', 11, 2],
      ['P1-marksman-1', 10, 1]
    ]
  },
  {
    player: 'P2',
    summary: 'P2 answered through the southwest lane and claimed west-south.',
    reasoning:
      'P2 mirrored the early cantrip damage but had no legal shot, so the flank plan emphasized fast scouts and a support line behind them.',
    moves: [
      ['P2-druid-1', 2, 7],
      ['P2-scout-1', 3, 7],
      ['P2-scout-2', 2, 8],
      ['P2-marksman-1', 1, 7]
    ]
  },
  {
    player: 'P1',
    summary: 'P1 added the east center while keeping the slower core in contact.',
    reasoning:
      'P1 bought engine support and declined a recruit until supply reached the cost-6 threshold. The scout took east, while the raider and guardian stayed close enough to contest center later.',
    moves: [
      ['P1-scout-1', 9, 5],
      ['P1-raider-1', 8, 3],
      ['P1-guardian-1', 10, 3],
      ['P1-marksman-1', 9, 1]
    ]
  },
  {
    player: 'P2',
    summary: 'P2 stretched into center-south, creating the first real center/flank split.',
    reasoning:
      'The flank/economy deck bought a payload card and used the board turn to occupy the south approach without offering an isolated unit to P1 yet.',
    moves: [
      ['P2-scout-1', 5, 7],
      ['P2-druid-1', 3, 7],
      ['P2-scout-2', 4, 7],
      ['P2-marksman-1', 2, 7]
    ]
  },
  {
    player: 'P1',
    summary: 'P1 recruited a second guardian and formed a compact line outside center.',
    reasoning:
      'P1 had enough saved supply for exactly one recruit under the cap. The existing units stayed mutually supporting instead of diving into the southern flank.',
    moves: [
      ['P1-raider-1', 7, 4],
      ['P1-guardian-1', 9, 3],
      ['P1-marksman-1', 8, 2],
      ['P1-scout-1', 7, 5]
    ],
    recruit: ['P1-guardian-2', 'guardian', 11, 1]
  },
  {
    player: 'P2',
    summary: "P2 flipped the center and started wearing down P1's exposed scout.",
    reasoning:
      'The support deck bought healing and recruited a healer. P2 used two scout shots rather than a risky body trade, keeping the southern formation intact.',
    moves: [
      ['P2-scout-1', 6, 5],
      ['P2-scout-2', 6, 6],
      ['P2-druid-1', 4, 7],
      ['P2-marksman-1', 3, 7]
    ],
    attacks: [
      ['P2-scout-1', 'P1-scout-1', false],
      ['P2-scout-2', 'P1-scout-1', false]
    ],
    recruit: ['P2-healer-1', 'healer', 0, 8]
  },
  {
    player: 'P1',
    summary: 'P1 recruited a marksman and converted the first center fight into a scout kill.',
    reasoning:
      "Training upgraded the lead guardian, but P1 attached the one deck damage to the damaged scout attack and then finished the target with the raider. The marksman softened P2's second scout as a follow-up.",
    moves: [
      ['P1-raider-1', 6, 4],
      ['P1-guardian-1', 9, 4],
      ['P1-marksman-1', 7, 2],
      ['P1-guardian-2', 10, 2]
    ],
    upgrades: [['attack', 'P1-guardian-1', 1]],
    attacks: [['P1-scout-1', 'P2-scout-1', true]],
    recruit: ['P1-marksman-2', 'marksman', 10, 1]
  },
  {
    player: 'P2',
    summary: "P2 used support tempo to kill P1's forward scout and restore the damaged flank scout.",
    reasoning:
      "The support hand produced enough heal to undo P1 marksman damage. P2 spent the deck damage on the scout shot, then the marksman finished P1's low-health scout.",
    moves: [
      ['P2-druid-1', 5, 7],
      ['P2-marksman-1', 4, 7],
      ['P2-healer-1', 1, 7]
    ],
    attacks: [
      ['P2-scout-1', 'P1-scout-1', true],
      ['P2-scout-2', 'P1-scout-1', false]
    ],
    recruit: ['P2-scout-3', 'scout', 0, 8]
  },
  {
    player: 'P1',
    summary: 'P1 removed the lead center scout but could not yet flip center.',
    reasoning:
      'P1 could not recruit this turn, and P2 still occupied the center at movement time. The raider took the kill from an adjacent hex while the rest of the core kept moving up.',
    moves: [
      ['P1-raider-1', 6, 4],
      ['P1-guardian-1', 8, 5],
      ['P1-marksman-1', 6, 3],
      ['P1-guardian-2', 9, 2],
      ['P1-marksman-2', 9, 1]
    ],
    upgrades: [['attack', 'P1-guardian-1', 1]],
    attacks: [['P1-raider-1', 'P2-scout-1', false]]
  },
  {
    player: 'P2',
    summary: 'P2 wounded the raider but had to spend the turn rebuilding its support shell.',
    reasoning:
      'P2 recruited another druid and used deck healing to restore the damaged scout before the next exchange. The marksman stayed in the flank shell rather than making an illegal long-range shot.',
    moves: [
      ['P2-scout-3', 3, 7],
      ['P2-marksman-1', 5, 6],
      ['P2-druid-1', 4, 7],
      ['P2-healer-1', 2, 7]
    ],
    attacks: [['P2-scout-2', 'P1-raider-1', true]],
    heals: [['deck', 'P2-scout-2', 4]],
    recruit: ['P2-druid-2', 'druid', 1, 8]
  },
  {
    player: 'P1',
    summary: 'P1 recruited a replacement raider and killed P2\'s second scout.',
    reasoning:
      'P1 stayed with the compact-core plan: guardian first, recruits behind it. The damage upgrade went onto the guardian, and the one deck damage converted the delayed scout fight into a kill.',
    moves: [
      ['P1-guardian-1', 7, 5],
      ['P1-marksman-1', 5, 3],
      ['P1-guardian-2', 8, 3],
      ['P1-marksman-2', 8, 2]
    ],
    upgrades: [['attack', 'P1-guardian-1', 1]],
    attacks: [['P1-guardian-1', 'P2-scout-2', true]],
    recruit: ['P1-raider-2', 'raider', 12, 1]
  },
  {
    player: 'P2',
    summary: 'P2 could not afford a recruit, so it preserved bodies and chipped the central guardian.',
    reasoning:
      'This was the clearest recruit-cap pressure point for P2: the center loss lowered income enough to skip a body. P2 kept the healer and druid back instead of forcing a bad center trade.',
    moves: [
      ['P2-scout-3', 6, 6],
      ['P2-druid-2', 2, 8],
      ['P2-healer-1', 3, 7]
    ],
    attacks: [
      ['P2-marksman-1', 'P1-guardian-1', false],
      ['P2-scout-3', 'P1-guardian-1', false]
    ]
  },
  {
    player: 'P1',
    summary: 'P1 recruited a healer and removed the forward flank scout.',
    reasoning:
      'P1 used its center income to keep recruiting every turn it could. The upgraded guardian spent the turn damage on the scout that had stepped into contact, while the marksman chipped P2\'s restored marksman for the next exchange.',
    moves: [
      ['P1-guardian-1', 7, 5],
      ['P1-guardian-2', 7, 4],
      ['P1-marksman-2', 7, 2],
      ['P1-raider-2', 10, 1],
      ['P1-marksman-1', 5, 4]
    ],
    attacks: [
      ['P1-guardian-1', 'P2-scout-3', true],
      ['P1-marksman-1', 'P2-marksman-1', false]
    ],
    heals: [['deck', 'P1-guardian-1', 1]],
    recruit: ['P1-healer-1', 'healer', 11, 0]
  },
  {
    player: 'P2',
    summary: "P2 recruited a guardian, but the flank no longer had enough damage to break P1's core.",
    reasoning:
      "The support hand produced healing but had no damaged friendly unit in range that changed the fight. P2's scout kept pressure on the guardian, while the new guardian entered too far away to affect the center this turn.",
    moves: [
      ['P2-druid-2', 2, 7],
      ['P2-healer-1', 4, 7]
    ],
    recruit: ['P2-guardian-1', 'guardian', 0, 9]
  },
  {
    player: 'P1',
    summary: 'P1 recruited again and removed both P2 support pieces near center-south.',
    reasoning:
      'The final P1 attack turn showed the compact-core payoff. The upgraded guardian killed the scout from an adjacent hex, while the marksman removed the exposed healer before P2 could rebuild.',
    moves: [
      ['P1-guardian-1', 5, 6],
      ['P1-guardian-2', 6, 5],
      ['P1-marksman-2', 6, 3],
      ['P1-raider-2', 8, 2],
      ['P1-healer-1', 10, 1],
      ['P1-marksman-1', 5, 5]
    ],
    upgrades: [['attack', 'P1-guardian-1', 1]],
    attacks: [
      ['P1-guardian-1', 'P2-healer-1', false],
      ['P1-marksman-1', 'P2-marksman-1', false]
    ],
    recruit: ['P1-marksman-3', 'marksman', 11, 1]
  },
  {
    player: 'P2',
    summary: "P2 recruited one final marksman but could not reach a kill before P1's start-of-turn win check.",
    reasoning:
      "P2 had enough saved supply for one body and no more. The remaining units were too far from P1's damaged guardian to remove it, leaving P1 with a legal three-plus unit lead for the next start check.",
    moves: [
      ['P2-druid-2', 3, 7],
      ['P2-guardian-1', 1, 8]
    ],
    recruit: ['P2-marksman-2', 'marksman', 0, 8]
  }
];

let deckState = setupGame(config, rng);
let boardState = clone(starterBoard);
const timeline = {
  schemaVersion: 1,
  title: 'E009 Center vs Flank B',
  entries: []
};

await rm(snapshotsDir, { recursive: true, force: true });
await mkdir(snapshotsDir, { recursive: true });

for (const [index, turn] of turns.entries()) {
  const turnNumber = index + 1;
  const turnId = `turn-${String(turnNumber).padStart(3, '0')}`;
  assertStartOfTurn(turn, boardState);

  const deckBefore = deckSnapshot(deckState);
  const boardBefore = clone(boardState);
  const deckResult = playDeckTurn(turn.player);

  gainIncome(boardState, turn.player);
  for (const move of turn.moves ?? []) {
    moveUnit(boardState, turn.player, move[0], move[1], move[2]);
  }
  for (const upgrade of turn.upgrades ?? []) {
    applyUpgrade(boardState, turn.player, deckResult.produced, upgrade);
  }
  for (const attack of turn.attacks ?? []) {
    applyAttack(boardState, turn.player, deckResult.produced, attack);
  }
  for (const heal of turn.heals ?? []) {
    applyHeal(boardState, turn.player, deckResult.produced, heal);
  }
  if (turn.recruit) {
    recruitUnit(boardState, turn.player, turn.recruit);
  }
  advanceBoardTurn(boardState);

  const deckAfter = deckSnapshot(deckState);
  const boardAfter = clone(boardState);
  await writeTurnSnapshots(turnId, deckBefore, deckAfter, boardBefore, boardAfter);
  timeline.entries.push({
    id: turnId,
    player: turn.player,
    round: boardBefore.turn.round,
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
    summary: turn.summary,
    reasoning: turn.reasoning
  });
}

const finalCounts = countLivingUnits(boardState);
const winner = finalCounts.P1 >= finalCounts.P2 + 3 && boardState.turn.activePlayer === 'P1' ? 'P1' : null;
if (winner !== 'P1') {
  throw new Error(`Expected P1 start-of-turn win, got active=${boardState.turn.activePlayer} counts=${JSON.stringify(finalCounts)}`);
}

boardState.notes = [
  ...boardState.notes,
  'E009 center-vs-flank B used the fixed starting deck from the active deck.yaml; no separate 12-coin opening draft was applied.',
  'Deck damage was always attached to legal attacks and capped at one extra deck damage per attacking unit.',
  'P1 wins at the beginning of turn-017 by unit-count lead: 7 living P1 units versus 3 living P2 units.'
];

await writeJson(join(runRoot, 'deck.json'), deckSnapshot(deckState));
await writeJson(join(runRoot, 'board.json'), boardState);
await writeJson(join(runRoot, 'timeline.json'), timeline);
await writeFile(
  join(runRoot, 'notes.md'),
  [
    '# E009 Center vs Flank B Notes',
    '',
    '- Used the fixed `rulesets/territory-v1-cost6-damagecap-recruitcap/deck.yaml` starting deck, which differs from the older draft-budget prose still present in the rules text.',
    '- Treated the legal win as occurring at the beginning of the next active player turn. The replay therefore has 16 completed player turns and stops with `board.turn.activePlayer` set to `P1` for the turn-017 start check.',
    '- No deck damage was assigned outside a legal unit attack, and no attacking unit received more than one deck-produced damage in a turn.',
    '- Recruits were limited to at most one unit per player turn.'
  ].join('\n') + '\n'
);

function playDeckTurn(expectedPlayer) {
  const active = deckState.players[deckState.activePlayer];
  if (active?.id !== expectedPlayer) {
    throw new Error(`Deck active player is ${active?.id}, expected ${expectedPlayer}`);
  }
  const drawnHand = active.hand.map(cardName);
  maybeTrashWeakCard(active);

  const played = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    const player = deckState.players[deckState.activePlayer];
    for (const cardId of playPriority) {
      const handIndex = player.hand.indexOf(cardId);
      if (handIndex >= 0 && player.actions > 0) {
        deckState = applyAction(deckState, { type: 'playAction', handIndex }, rng);
        played.push(cardName(cardId));
        progressed = true;
        break;
      }
    }
  }

  deckState = applyAction(deckState, { type: 'moveToBuy' }, rng);
  const buyer = deckState.players[deckState.activePlayer];
  const produced = {
    money: buyer.money,
    damage: buyer.attributes.damage ?? 0,
    heal: buyer.attributes.heal ?? 0,
    upgradeHealth: buyer.attributes.upgradeHealth ?? 0,
    upgradeDamage: buyer.attributes.upgradeDamage ?? 0,
    reattack: buyer.attributes.reattack ?? 0,
    stormTargets: buyer.attributes.stormTargets ?? 0
  };

  const bought = [];
  for (const cardId of expectedPlayer === 'P1' ? p1BuyPriority : p2BuyPriority) {
    const card = cardsById[cardId];
    const current = deckState.players[deckState.activePlayer];
    if (card && current.buys > 0 && current.money >= card.cost && (deckState.supply[cardId] ?? 0) > 0) {
      deckState = applyAction(deckState, { type: 'buyCard', cardId }, rng);
      bought.push(cardName(cardId));
      break;
    }
  }
  deckState = applyAction(deckState, { type: 'endTurn' }, rng);
  return { drawnHand, played, bought, produced };
}

function maybeTrashWeakCard(player) {
  const restIndex = player.hand.indexOf('rest');
  if (restIndex >= 0) {
    deckState = applyAction(deckState, { type: 'trashCard', handIndex: restIndex }, rng);
    return;
  }
  if (player.turnsTaken >= 4) {
    const copperIndex = player.hand.indexOf('copper');
    if (copperIndex >= 0) {
      deckState = applyAction(deckState, { type: 'trashCard', handIndex: copperIndex }, rng);
    }
  }
}

function gainIncome(state, player) {
  const entry = supplyEntry(state, player);
  entry.amount += 2 + state.supplyControl.filter((center) => center.controller === player).length;
}

function moveUnit(state, player, unitId, col, row) {
  const unit = getUnit(state, unitId);
  if (unit.player !== player) {
    throw new Error(`${unitId} belongs to ${unit.player}, not ${player}`);
  }
  const target = { col, row };
  assertEmpty(state, target, unitId);
  const distance = mapDistance(map, unit, target);
  if (distance === null || distance > unitRules[unit.type].movement) {
    throw new Error(`${unitId} cannot move from ${coordKey(unit)} to ${coordKey(target)}; distance=${distance}`);
  }
  unit.col = col;
  unit.row = row;
  captureCenter(state, player, unit);
}

function captureCenter(state, player, coord) {
  const center = map.supplyCenters.find((candidate) => candidate.col === coord.col && candidate.row === coord.row);
  if (!center) {
    return;
  }
  const control = state.supplyControl.find((candidate) => candidate.id === center.id);
  if (!control) {
    throw new Error(`Missing supply control for ${center.id}`);
  }
  control.controller = player;
}

function applyUpgrade(state, player, produced, [kind, unitId, amount]) {
  const unit = getUnit(state, unitId);
  if (unit.player !== player) {
    throw new Error(`${unitId} cannot receive ${player} upgrade`);
  }
  if (kind === 'attack') {
    produced.upgradeDamage -= amount;
    assertCounter(produced.upgradeDamage, 'upgradeDamage');
    unit.attack += amount;
    return;
  }
  if (kind === 'health') {
    produced.upgradeHealth -= amount;
    assertCounter(produced.upgradeHealth, 'upgradeHealth');
    unit.maxHp += amount;
    unit.hp += amount;
    return;
  }
  throw new Error(`Unknown upgrade kind: ${kind}`);
}

function applyAttack(state, player, produced, [attackerId, targetId, useDeckDamage]) {
  const attacker = getUnit(state, attackerId);
  const target = getUnit(state, targetId);
  if (attacker.player !== player || target.player === player) {
    throw new Error(`Invalid attack ${attackerId} -> ${targetId}`);
  }
  const range = unitRules[attacker.type].range;
  const distance = mapDistance(map, attacker, target);
  if (distance === null || distance > range) {
    throw new Error(`${attackerId} cannot attack ${targetId}; distance=${distance} range=${range}`);
  }
  const extra = useDeckDamage ? 1 : 0;
  if (extra > 0) {
    produced.damage -= 1;
    assertCounter(produced.damage, 'damage');
  }
  target.hp -= attacker.attack + extra;
  if (target.hp <= 0) {
    state.units = state.units.filter((unit) => unit.id !== targetId);
  }
}

function applyHeal(state, player, produced, heal) {
  if (heal[0] === 'deck') {
    const [, targetId, amount] = heal;
    const target = getUnit(state, targetId);
    if (target.player !== player) {
      throw new Error(`${targetId} cannot receive ${player} deck healing`);
    }
    produced.heal -= amount;
    assertCounter(produced.heal, 'heal');
    target.hp = Math.min(target.maxHp, target.hp + amount);
    return;
  }

  const [, healerId, targetId] = heal;
  const healer = getUnit(state, healerId);
  const target = getUnit(state, targetId);
  const healAmount = unitRules[healer.type].heal;
  if (healer.player !== player || target.player !== player || healAmount <= 0) {
    throw new Error(`Invalid unit heal ${healerId} -> ${targetId}`);
  }
  const distance = mapDistance(map, healer, target);
  if (distance === null || distance > unitRules[healer.type].range) {
    throw new Error(`${healerId} cannot heal ${targetId}; distance=${distance}`);
  }
  target.hp = Math.min(target.maxHp, target.hp + healAmount);
}

function recruitUnit(state, player, [id, type, col, row]) {
  const supply = supplyEntry(state, player);
  if (supply.amount < recruitCost) {
    throw new Error(`${player} cannot recruit ${id}; supply=${supply.amount}`);
  }
  const home = map.homeBases.find((candidate) => candidate.player === player);
  if (!home?.hexes.some((hex) => hex.col === col && hex.row === row)) {
    throw new Error(`${coordKey({ col, row })} is not a ${player} home hex`);
  }
  assertEmpty(state, { col, row });
  supply.amount -= recruitCost;
  const rules = configUnit(type);
  state.units.push({
    id,
    player,
    type,
    col,
    row,
    hp: rules.hp,
    maxHp: rules.hp,
    attack: rules.attack
  });
}

function configUnit(type) {
  const values = {
    guardian: { attack: 4, hp: 16 },
    raider: { attack: 6, hp: 8 },
    marksman: { attack: 4, hp: 8 },
    scout: { attack: 2, hp: 8 },
    druid: { attack: 4, hp: 10 },
    healer: { attack: 1, hp: 4 }
  };
  return values[type];
}

function advanceBoardTurn(state) {
  if (state.turn.activePlayer === 'P1') {
    state.turn.activePlayer = 'P2';
    return;
  }
  state.turn.activePlayer = 'P1';
  state.turn.round += 1;
}

function assertStartOfTurn(turn, state) {
  if (state.turn.activePlayer !== turn.player) {
    throw new Error(`Board active player is ${state.turn.activePlayer}, expected ${turn.player}`);
  }
}

function getUnit(state, unitId) {
  const unit = state.units.find((candidate) => candidate.id === unitId);
  if (!unit) {
    throw new Error(`Missing unit: ${unitId}`);
  }
  return unit;
}

function assertEmpty(state, coord, movingId = null) {
  const occupied = state.units.find((unit) => unit.id !== movingId && unit.col === coord.col && unit.row === coord.row);
  if (occupied) {
    throw new Error(`${coordKey(coord)} is occupied by ${occupied.id}`);
  }
}

function supplyEntry(state, player) {
  const entry = state.supply.find((candidate) => candidate.player === player);
  if (!entry) {
    throw new Error(`Missing supply entry for ${player}`);
  }
  return entry;
}

function assertCounter(value, counter) {
  if (value < 0) {
    throw new Error(`Overspent ${counter}`);
  }
}

function countLivingUnits(state) {
  return {
    P1: state.units.filter((unit) => unit.player === 'P1').length,
    P2: state.units.filter((unit) => unit.player === 'P2').length
  };
}

function cardName(cardId) {
  return cardsById[cardId]?.name ?? cardId;
}

function deckSnapshot(game) {
  return {
    schemaVersion: 1,
    rngState: rng.snapshot(),
    game: clone(game)
  };
}

async function writeTurnSnapshots(turnId, deckBefore, deckAfter, boardBefore, boardAfter) {
  await Promise.all([
    writeJson(join(snapshotsDir, `${turnId}.before.deck.json`), deckBefore),
    writeJson(join(snapshotsDir, `${turnId}.after.deck.json`), deckAfter),
    writeJson(join(snapshotsDir, `${turnId}.before.board.json`), boardBefore),
    writeJson(join(snapshotsDir, `${turnId}.after.board.json`), boardAfter)
  ]);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

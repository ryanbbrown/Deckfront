import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { applyAction } from '../../src/core/engine.ts';
import { listLegalActions } from '../../src/core/legalActions.ts';
import { SeededRng } from '../../src/core/random.ts';

const root = '.games/e004-engine-vs-rush-b';
const snapshotsDir = join(root, 'snapshots');
const deckPath = join(root, 'deck.json');
const boardPath = join(root, 'board.json');
const timelinePath = join(root, 'timeline.json');
const starterBoardPath = '.games/e003-locked-starter.board.json';
const deckConfigPath = 'rulesets/territory-v1-locked/deck.yaml';
const map = JSON.parse(await readFile('maps/sketch-v1.json', 'utf8'));
const unitDefs = JSON.parse(await readFile('rulesets/territory-v1-locked/units.json', 'utf8'));

const p1StartingDeck = 'P1=copper,copper,copper,copper,copper,copper,copper,village,peddler,silver';
const p2StartingDeck = 'P2=copper,copper,copper,copper,copper,copper,copper,blast,blast,zap';
const p1BuyPriority = ['gold', 'village', 'peddler', 'silver', 'potion', 'bandage'];
const p2BuyPriority = ['storm', 'blast', 'zap', 'silver', 'inferno'];

const turns = [
  {
    id: 'turn-001',
    summary: 'P1 opened by taking both near-side centers while keeping the guardian and marksman tucked behind the runners.',
    reasoning:
      'The engine deck trashed Copper and bought development instead of another Copper. Board play took safe income first because the rush starts second and cannot contest these centers immediately.',
    moves: [
      ['P1-scout-1', 10, 3],
      ['P1-raider-1', 8, 1],
      ['P1-guardian-1', 10, 2],
      ['P1-marksman-1', 10, 0]
    ]
  },
  {
    id: 'turn-002',
    summary: 'P2 sent both scouts into the southern lane and claimed west-south as the first rush foothold.',
    reasoning:
      'The rush deck also trashed Copper and bought pressure. P2 used the scout pair for tempo while the marksman and druid stayed close enough to support later attacks.',
    moves: [
      ['P2-scout-1', 3, 7],
      ['P2-scout-2', 2, 9],
      ['P2-druid-1', 2, 7],
      ['P2-marksman-1', 1, 8]
    ]
  },
  {
    id: 'turn-003',
    summary: 'P1 advanced toward the central band and recruited a second guardian as a delayed screen.',
    reasoning:
      'P1 had enough saved supply after near-side income to recruit. The new guardian entered at home and did not act, matching the delayed activation rule.',
    moves: [
      ['P1-scout-1', 9, 5],
      ['P1-raider-1', 6, 2],
      ['P1-guardian-1', 9, 2],
      ['P1-marksman-1', 9, 0]
    ],
    recruits: [['P1-guardian-2', 'guardian', 11, 1]]
  },
  {
    id: 'turn-004',
    summary: 'P2 took center-south and recruited a raider to convert the rush into combat pressure.',
    reasoning:
      'P2 reached the second southern center before P1 could stabilize there. The raider recruit entered delayed, so it created next-turn pressure rather than immediate damage.',
    moves: [
      ['P2-scout-1', 6, 8],
      ['P2-scout-2', 5, 8],
      ['P2-druid-1', 3, 7],
      ['P2-marksman-1', 2, 8]
    ],
    recruits: [['P2-raider-1', 'raider', 0, 8]]
  },
  {
    id: 'turn-005',
    summary: 'P1 claimed center-north and southeast, then added a druid for stabilizing printed healing.',
    reasoning:
      'The engine seat reached four centers but spent the recruit on durability rather than speed. The druid entered delayed and did not heal or attack this turn.',
    moves: [
      ['P1-scout-1', 9, 7],
      ['P1-raider-1', 5, 3],
      ['P1-guardian-1', 8, 2],
      ['P1-marksman-1', 8, 1],
      ['P1-guardian-2', 10, 2]
    ],
    recruits: [['P1-druid-1', 'druid', 11, 0]]
  },
  {
    id: 'turn-006',
    summary: 'P2 moved the rush screen into the southeast lane and opened damage on P1’s forward scout.',
    reasoning:
      'Deck damage was only attached to a legal scout attack. This made P2’s early Blast/Zap package matter without treating it as global direct damage.',
    moves: [
      ['P2-scout-1', 8, 7],
      ['P2-scout-2', 7, 7],
      ['P2-druid-1', 4, 7],
      ['P2-marksman-1', 3, 8],
      ['P2-raider-1', 2, 8]
    ],
    attacks: [{ attacker: 'P2-scout-1', target: 'P1-scout-1', bonus: 'all' }]
  },
  {
    id: 'turn-007',
    summary: 'P1 took the exact center and damaged the nearest scout while recruiting another guardian.',
    reasoning:
      'P1 chose center control and screens over chasing the rush too deeply. The scout attacked from the southeast center but the engine deck produced no direct damage to inflate the exchange.',
    moves: [
      ['P1-raider-1', 6, 5],
      ['P1-guardian-1', 7, 2],
      ['P1-marksman-1', 7, 1],
      ['P1-guardian-2', 9, 2],
      ['P1-druid-1', 10, 0]
    ],
    attacks: [{ attacker: 'P1-scout-1', target: 'P2-scout-1' }],
    recruits: [['P1-guardian-3', 'guardian', 10, 1]]
  },
  {
    id: 'turn-008',
    summary: 'P2 focused fire and killed P1’s southeast scout, then recruited a fresh scout for continued tempo.',
    reasoning:
      'The rush deck converted a legal attack into a kill, showing the damage package can punish exposed capture units. The recruit again entered delayed and did not act.',
    moves: [
      ['P2-scout-1', 8, 7],
      ['P2-scout-2', 8, 8],
      ['P2-druid-1', 5, 7],
      ['P2-marksman-1', 3, 7],
      ['P2-raider-1', 4, 8]
    ],
    attacks: [{ attacker: 'P2-scout-1', target: 'P1-scout-1', bonus: 'all' }],
    recruits: [['P2-scout-3', 'scout', 1, 8]]
  },
  {
    id: 'turn-009',
    summary: 'P1 answered by killing the lead rush scout and recruiting a healer for the stretched line.',
    reasoning:
      'The center raider and marksman punished the exposed scout. P1 bought time through unit preservation tools rather than trying to race the rush with fragile scouts.',
    moves: [
      ['P1-raider-1', 7, 6],
      ['P1-guardian-1', 6, 2],
      ['P1-marksman-1', 6, 1],
      ['P1-guardian-2', 8, 3],
      ['P1-druid-1', 9, 0],
      ['P1-guardian-3', 9, 1]
    ],
    attacks: [{ attacker: 'P1-raider-1', target: 'P2-scout-1' }],
    recruits: [['P1-healer-1', 'healer', 12, 1]]
  },
  {
    id: 'turn-010',
    summary: 'P2 flipped southeast back and mauled P1’s center raider with the southern pocket.',
    reasoning:
      'P2 still had enough tempo units to pull a center away from P1 and combine board attacks with any legal deck damage. The attack targeted the raider because removing mobile capture power helps the rush.',
    moves: [
      ['P2-scout-2', 9, 7],
      ['P2-raider-1', 6, 7],
      ['P2-scout-3', 4, 8],
      ['P2-druid-1', 5, 7],
      ['P2-marksman-1', 4, 7]
    ],
    attacks: [{ attacker: 'P2-raider-1', target: 'P1-raider-1', bonus: 'all' }],
    recruits: [['P2-raider-2', 'raider', 0, 8]]
  },
  {
    id: 'turn-011',
    summary: 'P1 stabilized after losing the raider by tightening the guardian wall and adding a marksman.',
    reasoning:
      'P2’s tempo package removed P1’s mobile capture unit, so the engine response shifted to durable screens rather than a chase. The new marksman entered delayed and did not act.',
    moves: [
      ['P1-guardian-1', 6, 3],
      ['P1-marksman-1', 6, 2],
      ['P1-guardian-2', 7, 3],
      ['P1-druid-1', 8, 1],
      ['P1-guardian-3', 8, 2],
      ['P1-healer-1', 11, 1]
    ],
    recruits: [['P1-marksman-2', 'marksman', 12, 1]]
  },
  {
    id: 'turn-012',
    summary: 'P2 pulled the first raider back into threat range and refreshed the scout stream.',
    reasoning:
      'P2 could not reach the guardian line this turn without overextending, so it preserved southern center pressure and added another delayed scout.',
    moves: [
      ['P2-scout-2', 9, 7],
      ['P2-scout-3', 6, 8],
      ['P2-druid-1', 5, 7],
      ['P2-marksman-1', 5, 6],
      ['P2-raider-1', 6, 5],
      ['P2-raider-2', 2, 8]
    ],
    recruits: [['P2-scout-4', 'scout', 1, 8]]
  },
  {
    id: 'turn-013',
    summary: 'P1 trapped and killed the first raider while keeping the marksmen behind the screen.',
    reasoning:
      'The guardian wall finally converted stabilization into a kill. This showed the slower seat can punish rush units that stay in the center after the initial tempo hit.',
    moves: [
      ['P1-guardian-1', 6, 4],
      ['P1-marksman-1', 6, 3],
      ['P1-guardian-2', 7, 4],
      ['P1-guardian-3', 8, 3],
      ['P1-druid-1', 7, 1],
      ['P1-healer-1', 10, 1],
      ['P1-marksman-2', 11, 1]
    ],
    attacks: [
      { attacker: 'P1-guardian-1', target: 'P2-raider-1' },
      { attacker: 'P1-guardian-2', target: 'P2-raider-1' }
    ],
    recruits: [['P1-marksman-3', 'marksman', 12, 1]]
  },
  {
    id: 'turn-014',
    summary: 'P2 kept the southern centers and used a marksman shot to slow P1’s lead guardian.',
    reasoning:
      'After losing the first raider, P2 leaned on supply flips and ranged chip rather than feeding support into the guardian wall. The second raider advanced but stayed out of a direct trade.',
    moves: [
      ['P2-scout-2', 9, 7],
      ['P2-scout-3', 6, 8],
      ['P2-scout-4', 3, 7],
      ['P2-druid-1', 5, 7],
      ['P2-marksman-1', 5, 5],
      ['P2-raider-2', 4, 8]
    ],
    attacks: [{ attacker: 'P2-marksman-1', target: 'P1-guardian-1', bonus: 'all' }],
    recruits: [['P2-scout-5', 'scout', 0, 8]]
  },
  {
    id: 'turn-015',
    summary: 'P1 killed P2’s support marksman and recruited a fourth guardian, taking a clear board lead.',
    reasoning:
      'The engine could not safely reach the second raider, so it removed the ranged support piece instead. P1 led on material and board shape, but P2 still had a turn before any P1 start-of-turn lead check.',
    moves: [
      ['P1-guardian-1', 5, 4],
      ['P1-marksman-1', 5, 3],
      ['P1-guardian-2', 7, 5],
      ['P1-guardian-3', 7, 3],
      ['P1-druid-1', 7, 2],
      ['P1-healer-1', 9, 1],
      ['P1-marksman-2', 10, 2],
      ['P1-marksman-3', 11, 1]
    ],
    attacks: [
      { attacker: 'P1-guardian-1', target: 'P2-marksman-1' },
      { attacker: 'P1-marksman-1', target: 'P2-marksman-1' }
    ],
    recruits: [['P1-guardian-4', 'guardian', 10, 1]]
  },
  {
    id: 'turn-016',
    summary: 'P2 preserved southern income and recruited a healer, but P1 remained ahead on material and position.',
    reasoning:
      'The rush still held southern centers and had scouts on capture duty, but losing the marksman left it without enough punch to break the guardian wall. The run stopped at 16 completed turns with P1 leading, not yet winning by the start-of-turn unit-lead condition.',
    moves: [
      ['P2-scout-2', 9, 7],
      ['P2-scout-3', 7, 7],
      ['P2-scout-4', 3, 7],
      ['P2-scout-5', 2, 8],
      ['P2-druid-1', 4, 7],
      ['P2-raider-2', 5, 7]
    ],
    attacks: [{ attacker: 'P2-scout-3', target: 'P1-guardian-2', bonus: 'all' }],
    recruits: [['P2-healer-1', 'healer', 1, 8]]
  }
];

await resetRun();

let timeline = { schemaVersion: 1, title: 'E004 Engine vs Rush B', entries: [] };

for (const turn of turns) {
  const boardBefore = JSON.parse(await readFile(boardPath, 'utf8'));
  const deckBefore = JSON.parse(await readFile(deckPath, 'utf8'));
  const player = boardBefore.turn.activePlayer;
  const round = boardBefore.turn.round;
  const deckPlan = planDeckTurn(deckBefore, player);
  const paths = snapshotPaths(turn.id);

  await copyFile(deckPath, paths.deckBefore);
  await copyFile(boardPath, paths.boardBefore);
  await writeFile(join(root, `${turn.id}.script`), `${deckPlan.choices.join('\n')}\n`);
  runDeckCli(turn.id, deckPlan.choices.length);
  await copyFile(deckPath, paths.deckAfter);

  const deckAfter = JSON.parse(await readFile(deckPath, 'utf8'));
  const produced = producedAttributes(deckAfter, player);
  const boardAfter = applyBoardTurn(boardBefore, turn, player, produced);
  await writeFile(boardPath, `${JSON.stringify(boardAfter, null, 2)}\n`);
  await copyFile(boardPath, paths.boardAfter);

  timeline.entries.push({
    id: turn.id,
    player,
    round,
    deck: {
      before: `snapshots/${turn.id}.before.deck.json`,
      after: `snapshots/${turn.id}.after.deck.json`,
      drawnHand: deckPlan.drawnHand.map((cardId) => cardName(deckBefore, cardId)),
      played: deckPlan.played.map((cardId) => cardName(deckBefore, cardId)),
      bought: deckPlan.bought.map((cardId) => cardName(deckBefore, cardId)),
      produced
    },
    board: {
      before: `snapshots/${turn.id}.before.board.json`,
      after: `snapshots/${turn.id}.after.board.json`
    },
    summary: turn.summary,
    reasoning: turn.reasoning
  });
  console.log(`${turn.id}: ${player} round ${round}`);
}

await writeFile(timelinePath, `${JSON.stringify(timeline, null, 2)}\n`);

async function resetRun() {
  await mkdir(snapshotsDir, { recursive: true });
  await rm(snapshotsDir, { recursive: true, force: true });
  await mkdir(snapshotsDir, { recursive: true });
  for (const turn of turns) {
    await rm(join(root, `${turn.id}.script`), { force: true });
  }
  await copyFile(starterBoardPath, boardPath);
  await writeFile(timelinePath, `${JSON.stringify({ schemaVersion: 1, title: 'E004 Engine vs Rush B', entries: [] }, null, 2)}\n`);
  await rm(deckPath, { force: true });
  const result = spawnSync('bun', [
    'run',
    'cli',
    '--',
    '--config',
    deckConfigPath,
    '--state',
    deckPath,
    '--seed',
    '3',
    '--max-actions',
    '0',
    '--starting-deck',
    p1StartingDeck,
    '--starting-deck',
    p2StartingDeck
  ], { cwd: process.cwd(), encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Deck initialization failed:\n${result.stdout}\n${result.stderr}`);
  }
}

function planDeckTurn(snapshot, playerId) {
  let state = snapshot.game;
  let rng = SeededRng.fromState(snapshot.rngState);
  const active = activePlayer(state, playerId);
  const drawnHand = [...active.hand];
  const played = [];
  const bought = [];
  const choices = [];
  const trashTarget = chooseTrash(active.hand);
  if (trashTarget) {
    chooseAndApply({ type: 'trash', cardId: trashTarget });
  }

  while (true) {
    const player = state.players[state.activePlayer];
    if (state.phase !== 'action' || player.id !== playerId) {
      break;
    }
    const playable = bestPlayableAction(state, playerId);
    if (!playable) {
      chooseAndApply({ type: 'moveToBuy' });
      break;
    }
    chooseAndApply({ type: 'play', cardId: playable });
    played.push(playable);
  }

  const buy = bestBuy(state, playerId);
  if (buy) {
    chooseAndApply({ type: 'buy', cardId: buy });
    bought.push(buy);
  }
  chooseAndApply({ type: 'endTurn' });

  return { choices, drawnHand, played, bought };

  function chooseAndApply(wanted) {
    const actions = listLegalActions(state);
    const index = actions.findIndex((action) => matchesAction(state, action, wanted));
    if (index < 0) {
      throw new Error(`No legal deck action for ${JSON.stringify(wanted)}. Legal: ${actions.map((action) => action.description).join(', ')}`);
    }
    choices.push(index + 1);
    state = applyAction(state, actions[index].action, rng);
  }
}

function chooseTrash(hand) {
  if (hand.filter((cardId) => cardId === 'copper').length >= 4) {
    return 'copper';
  }
  if (hand.filter((cardId) => cardId === 'copper').length >= 3 && hand.some((cardId) => cardId !== 'copper')) {
    return 'copper';
  }
  return undefined;
}

function bestPlayableAction(state, playerId) {
  const player = activePlayer(state, playerId);
  if (player.actions <= 0) {
    return undefined;
  }
  const hand = new Set(player.hand);
  const priority = playerId === 'P1'
    ? ['village', 'peddler', 'potion', 'bandage']
    : ['zap', 'blast', 'storm', 'inferno'];
  return priority.find((cardId) => hand.has(cardId));
}

function bestBuy(state, playerId) {
  const player = activePlayer(state, playerId);
  if (state.phase !== 'buy' || player.buys <= 0) {
    return undefined;
  }
  const priority = playerId === 'P1' ? p1BuyPriority : p2BuyPriority;
  return priority.find((cardId) => {
    const card = state.cards[cardId];
    return card && card.cost <= player.money && (state.supply[cardId] ?? 0) > 0;
  });
}

function matchesAction(state, legal, wanted) {
  const action = legal.action;
  if (wanted.type === 'moveToBuy') {
    return action.type === 'moveToBuy';
  }
  if (wanted.type === 'endTurn') {
    return action.type === 'endTurn';
  }
  if (wanted.type === 'buy') {
    return action.type === 'buyCard' && action.cardId === wanted.cardId;
  }
  if (wanted.type === 'play' && action.type === 'playAction') {
    const player = state.players[state.activePlayer];
    return player.hand[action.handIndex] === wanted.cardId;
  }
  if (wanted.type === 'trash' && action.type === 'trashCard') {
    const player = state.players[state.activePlayer];
    return player.hand[action.handIndex] === wanted.cardId;
  }
  return false;
}

function runDeckCli(turnId, actionCount) {
  const result = spawnSync('bun', [
    'run',
    'cli',
    '--',
    '--config',
    deckConfigPath,
    '--state',
    deckPath,
    '--script',
    join(root, `${turnId}.script`),
    '--max-actions',
    String(actionCount)
  ], { cwd: process.cwd(), encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`CLI failed for ${turnId}:\n${result.stdout}\n${result.stderr}`);
  }
}

function applyBoardTurn(board, turn, player, produced) {
  const next = JSON.parse(JSON.stringify(board));
  const opponent = player === 'P1' ? 'P2' : 'P1';
  const activeUnits = next.units.filter((unit) => unit.player === player);
  const enemyUnits = next.units.filter((unit) => unit.player === opponent);
  if (activeUnits.length >= enemyUnits.length + 3) {
    next.notes = [...(next.notes ?? []), `${turn.id}: ${player} would satisfy the 3-unit lead win check at start of turn.`];
  }

  const spent = { damage: 0, heal: 0, upgradeDamage: 0, upgradeHealth: 0 };
  const usedUnits = new Set();
  const income = 2 + next.supplyControl.filter((center) => center.controller === player).length;
  supplyEntry(next, player).amount += income;

  for (const [unitId, col, row] of turn.moves ?? []) {
    moveUnit(next, player, unitId, col, row);
    captureCenter(next, player, col, row);
  }
  for (const upgrade of turn.upgrades ?? []) {
    applyUpgrade(next, player, upgrade, produced, spent);
  }
  for (const attack of turn.attacks ?? []) {
    attackUnit(next, player, attack, produced, spent, usedUnits);
  }
  for (const heal of turn.heals ?? []) {
    healUnit(next, player, heal, produced, spent, usedUnits);
  }
  for (const [unitId, type, col, row] of turn.recruits ?? []) {
    recruitUnit(next, player, unitId, type, col, row);
  }

  const activeIndex = player === 'P1' ? 0 : 1;
  next.turn.activePlayer = opponent;
  if (activeIndex === 1) {
    next.turn.round += 1;
  }
  next.notes = [...(next.notes ?? []), `${turn.id}: ${turn.summary}`];
  return next;
}

function applyUpgrade(board, player, upgrade, produced, spent) {
  const unit = findUnit(board, upgrade.target);
  if (unit.player !== player) {
    throw new Error(`Cannot upgrade enemy unit ${upgrade.target}`);
  }
  if (upgrade.kind === 'damage') {
    spent.upgradeDamage += upgrade.amount;
    assertCounterAvailable('upgradeDamage', spent.upgradeDamage, produced.upgradeDamage);
    unit.attack += upgrade.amount;
    return;
  }
  if (upgrade.kind === 'health') {
    spent.upgradeHealth += upgrade.amount;
    assertCounterAvailable('upgradeHealth', spent.upgradeHealth, produced.upgradeHealth);
    unit.maxHp += upgrade.amount;
    unit.hp = Math.min(unit.maxHp, unit.hp + upgrade.amount);
    return;
  }
  throw new Error(`Unknown upgrade kind: ${upgrade.kind}`);
}

function moveUnit(board, player, unitId, col, row) {
  assertMapHex(col, row);
  const unit = findUnit(board, unitId);
  if (unit.player !== player) {
    throw new Error(`Cannot move non-active unit ${unitId}`);
  }
  const occupied = board.units.find((candidate) => candidate.id !== unitId && candidate.col === col && candidate.row === row);
  if (occupied) {
    throw new Error(`${unitId} cannot move onto occupied hex ${col},${row}`);
  }
  const distance = pathDistance(unit.col, unit.row, col, row, board, player);
  const movement = unitDefs[unit.type].movement;
  if (distance > movement) {
    throw new Error(`${unitId} move ${unit.col},${unit.row} -> ${col},${row} distance ${distance} exceeds ${movement}`);
  }
  unit.col = col;
  unit.row = row;
}

function attackUnit(board, player, attack, produced, spent, usedUnits) {
  const attacker = findUnit(board, attack.attacker);
  const target = findUnit(board, attack.target);
  if (attacker.player !== player || target.player === player) {
    throw new Error(`Illegal attack ${attack.attacker} -> ${attack.target}`);
  }
  const range = unitDefs[attacker.type].range ?? 1;
  const distance = hexDistance(attacker.col, attacker.row, target.col, target.row);
  if (distance > range) {
    throw new Error(`${attack.attacker} cannot attack ${attack.target}: distance ${distance} exceeds ${range}`);
  }
  const bonus = attack.bonus === 'all' ? Math.max(0, (produced.damage ?? 0) - spent.damage) : (attack.bonus ?? 0);
  spent.damage += bonus;
  assertCounterAvailable('damage', spent.damage, produced.damage);
  const attackCount = usedUnits.has(attack.attacker) ? 2 : 1;
  if (attackCount > 1 && (produced.reattack ?? 0) < 1) {
    throw new Error(`${attack.attacker} cannot attack twice without reattack`);
  }
  usedUnits.add(attack.attacker);
  target.hp -= attacker.attack + bonus;
  if (target.hp <= 0) {
    board.units = board.units.filter((unit) => unit.id !== attack.target);
  }
}

function healUnit(board, player, heal, produced, spent, usedUnits) {
  const healer = findUnit(board, heal.healer);
  const target = findUnit(board, heal.target);
  if (healer.player !== player || target.player !== player) {
    throw new Error(`Illegal heal ${heal.healer} -> ${heal.target}`);
  }
  const printedHeal = unitDefs[healer.type].heal ?? 0;
  if (printedHeal < heal.amount) {
    spent.heal += heal.amount;
    assertCounterAvailable('heal', spent.heal, produced.heal);
  } else {
    const range = unitDefs[healer.type].range ?? 1;
    const distance = hexDistance(healer.col, healer.row, target.col, target.row);
    if (distance > range) {
      throw new Error(`${heal.healer} cannot heal ${heal.target}: distance ${distance} exceeds ${range}`);
    }
    if (usedUnits.has(heal.healer)) {
      throw new Error(`${heal.healer} cannot heal after attacking`);
    }
    usedUnits.add(heal.healer);
  }
  target.hp = Math.min(target.maxHp, target.hp + heal.amount);
}

function recruitUnit(board, player, unitId, type, col, row) {
  const cost = 5;
  const supply = supplyEntry(board, player);
  if (supply.amount < cost) {
    throw new Error(`${player} cannot recruit ${unitId}; supply ${supply.amount}`);
  }
  const home = map.homeBases.find((base) => base.player === player);
  if (!home?.hexes.some((hex) => hex.col === col && hex.row === row)) {
    throw new Error(`${unitId} recruit hex ${col},${row} is not in ${player} home`);
  }
  if (board.units.some((unit) => unit.col === col && unit.row === row)) {
    throw new Error(`${unitId} recruit hex ${col},${row} is occupied`);
  }
  const def = unitDefs[type];
  supply.amount -= cost;
  board.units.push({ id: unitId, player, type, col, row, hp: def.hp, maxHp: def.hp, attack: def.attack });
}

function captureCenter(board, player, col, row) {
  const center = map.supplyCenters.find((candidate) => candidate.col === col && candidate.row === row);
  if (!center) {
    return;
  }
  const control = board.supplyControl.find((candidate) => candidate.id === center.id);
  control.controller = player;
}

function pathDistance(startCol, startRow, endCol, endRow, board, player) {
  if (startCol === endCol && startRow === endRow) {
    return 0;
  }
  const enemyOccupied = new Set(board.units.filter((unit) => unit.player !== player).map((unit) => `${unit.col},${unit.row}`));
  const seen = new Set([`${startCol},${startRow}`]);
  const frontier = [[startCol, startRow, 0]];
  while (frontier.length > 0) {
    const [col, row, distance] = frontier.shift();
    for (const [nextCol, nextRow] of neighbors(col, row)) {
      const key = `${nextCol},${nextRow}`;
      if (seen.has(key) || !isMapHex(nextCol, nextRow) || enemyOccupied.has(key)) {
        continue;
      }
      if (nextCol === endCol && nextRow === endRow) {
        return distance + 1;
      }
      seen.add(key);
      frontier.push([nextCol, nextRow, distance + 1]);
    }
  }
  return Infinity;
}

function hexDistance(startCol, startRow, endCol, endRow) {
  const seen = new Set([`${startCol},${startRow}`]);
  const frontier = [[startCol, startRow, 0]];
  while (frontier.length > 0) {
    const [col, row, distance] = frontier.shift();
    if (col === endCol && row === endRow) {
      return distance;
    }
    for (const [nextCol, nextRow] of neighbors(col, row)) {
      const key = `${nextCol},${nextRow}`;
      if (!seen.has(key) && isMapHex(nextCol, nextRow)) {
        seen.add(key);
        frontier.push([nextCol, nextRow, distance + 1]);
      }
    }
  }
  return Infinity;
}

function neighbors(col, row) {
  if (col % 2 === 0) {
    return [[col, row - 1], [col + 1, row - 1], [col + 1, row], [col, row + 1], [col - 1, row], [col - 1, row - 1]];
  }
  return [[col, row - 1], [col + 1, row], [col + 1, row + 1], [col, row + 1], [col - 1, row + 1], [col - 1, row]];
}

function isMapHex(col, row) {
  return map.hexes.some((hex) => hex.col === col && hex.row === row) && !map.blocked.some((hex) => hex.col === col && hex.row === row);
}

function assertMapHex(col, row) {
  if (!isMapHex(col, row)) {
    throw new Error(`Not a legal map hex: ${col},${row}`);
  }
}

function assertCounterAvailable(counter, spent, produced) {
  if (spent > (produced ?? 0)) {
    throw new Error(`Spent ${spent} ${counter}, but deck produced ${produced ?? 0}`);
  }
}

function findUnit(board, unitId) {
  const unit = board.units.find((candidate) => candidate.id === unitId);
  if (!unit) {
    throw new Error(`Missing unit ${unitId}`);
  }
  return unit;
}

function supplyEntry(board, player) {
  const entry = board.supply.find((candidate) => candidate.player === player);
  if (!entry) {
    throw new Error(`Missing supply entry for ${player}`);
  }
  return entry;
}

function snapshotPaths(turnId) {
  return {
    deckBefore: join(snapshotsDir, `${turnId}.before.deck.json`),
    deckAfter: join(snapshotsDir, `${turnId}.after.deck.json`),
    boardBefore: join(snapshotsDir, `${turnId}.before.board.json`),
    boardAfter: join(snapshotsDir, `${turnId}.after.board.json`)
  };
}

function producedAttributes(snapshot, playerId) {
  const player = snapshot.game.players.find((candidate) => candidate.id === playerId);
  return {
    money: player.money,
    damage: player.attributes.damage,
    heal: player.attributes.heal,
    upgradeHealth: player.attributes.upgradeHealth,
    upgradeDamage: player.attributes.upgradeDamage,
    reattack: player.attributes.reattack,
    stormTargets: player.attributes.stormTargets
  };
}

function cardName(snapshot, cardId) {
  return snapshot.game.cards[cardId]?.name ?? cardId;
}

function activePlayer(state, playerId) {
  const player = state.players[state.activePlayer];
  if (!player || player.id !== playerId) {
    throw new Error(`Expected active deck player ${playerId}, got ${player?.id ?? 'missing'}`);
  }
  return player;
}

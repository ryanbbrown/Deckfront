import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { applyAction } from '../../src/core/engine.ts';
import { listLegalActions } from '../../src/core/legalActions.ts';
import { SeededRng } from '../../src/core/random.ts';

const root = '.games/e005-rush-vs-engine-b';
const snapshotsDir = join(root, 'snapshots');
const deckPath = join(root, 'deck.json');
const boardPath = join(root, 'board.json');
const timelinePath = join(root, 'timeline.json');
const starterBoardPath = '.games/e005-access-starter.board.json';
const deckConfigPath = 'rulesets/territory-v1-locked/deck.yaml';
const map = JSON.parse(await readFile('maps/sketch-v2-access.json', 'utf8'));
const unitDefs = JSON.parse(await readFile('rulesets/territory-v1-locked/units.json', 'utf8'));

const p1StartingDeck = 'P1=copper,copper,copper,copper,copper,copper,copper,blast,blast,zap';
const p2StartingDeck = 'P2=copper,copper,copper,copper,copper,copper,copper,village,peddler,silver';
const p1BuyPriority = ['blast', 'zap', 'silver', 'storm', 'inferno'];
const p2BuyPriority = ['gold', 'village', 'peddler', 'silver', 'potion', 'bandage'];

const turns = [
  {
    id: 'turn-001',
    summary: 'P1 opened the rush by taking northeast and pushing the scout toward the east lane.',
    reasoning:
      'P1 trashed Copper and bought pressure. The board plan used the raider for the nearest supply flip while the scout moved toward center-east without overextending the marksman.',
    moves: [
      ['P1-scout-1', 10, 3],
      ['P1-raider-1', 8, 1],
      ['P1-guardian-1', 10, 2],
      ['P1-marksman-1', 10, 0]
    ]
  },
  {
    id: 'turn-002',
    summary: 'P2 answered with the west-south scout capture and kept the support line compact.',
    reasoning:
      'The engine deck also trashed Copper and bought development. P2 used a scout to claim the accessible western center while the druid and marksman stayed close enough to stabilize the lane.',
    moves: [
      ['P2-scout-1', 3, 7],
      ['P2-scout-2', 2, 9],
      ['P2-druid-1', 2, 7],
      ['P2-marksman-1', 1, 8]
    ]
  },
  {
    id: 'turn-003',
    summary: 'P1 claimed center-east and recruited a delayed raider for continued tempo.',
    reasoning:
      'P1 had exactly enough saved supply after northeast income to add a pressure piece. The new raider entered at home and did not move or attack this turn.',
    moves: [
      ['P1-scout-1', 9, 5],
      ['P1-raider-1', 6, 2],
      ['P1-guardian-1', 9, 2],
      ['P1-marksman-1', 9, 0]
    ],
    recruits: [['P1-raider-2', 'raider', 11, 1]]
  },
  {
    id: 'turn-004',
    summary: 'P2 reached center-south and recruited the first guardian screen.',
    reasoning:
      'The sketch-v2-access south lane let P2 contest a second center without immediately exposing the marksman. The guardian recruit was delayed, so it was a future screen rather than same-turn defense.',
    moves: [
      ['P2-scout-1', 5, 7],
      ['P2-scout-2', 4, 8],
      ['P2-druid-1', 3, 7],
      ['P2-marksman-1', 2, 8]
    ],
    recruits: [['P2-guardian-1', 'guardian', 0, 8]]
  },
  {
    id: 'turn-005',
    summary: 'P1 converted the fast opening into center and center-north control.',
    reasoning:
      'P1 had no recruit after the previous spend, so the rush value came from center access rather than extra bodies. The marksman stayed behind the line while the scout and raider made the flips.',
    moves: [
      ['P1-scout-1', 6, 5],
      ['P1-raider-1', 5, 3],
      ['P1-guardian-1', 8, 2],
      ['P1-marksman-1', 8, 1],
      ['P1-raider-2', 9, 2]
    ]
  },
  {
    id: 'turn-006',
    summary: 'P2 damaged the exposed center scout and advanced the guardian screen.',
    reasoning:
      'P2 used printed attacks rather than deck damage because the engine draw did not produce attack counters. The goal was to make P1 pay for early center control while preserving the stabilizing units.',
    moves: [
      ['P2-scout-1', 6, 7],
      ['P2-scout-2', 5, 8],
      ['P2-druid-1', 4, 7],
      ['P2-marksman-1', 3, 8],
      ['P2-guardian-1', 1, 8]
    ],
    attacks: [{ attacker: 'P2-scout-1', target: 'P1-scout-1' }]
  },
  {
    id: 'turn-007',
    summary: 'P1 pressed the center, chipped the lead scout, and spent the stored supply on two delayed rush units.',
    reasoning:
      'The rush had earned enough income for a two-unit recruit, but delayed activation kept that from becoming immediate combat. P1 left deck damage unused because the legal attacks did not need to become direct spell damage.',
    moves: [
      ['P1-scout-1', 6, 5],
      ['P1-raider-1', 4, 3],
      ['P1-guardian-1', 7, 2],
      ['P1-marksman-1', 7, 1],
      ['P1-raider-2', 8, 2]
    ],
    attacks: [{ attacker: 'P1-scout-1', target: 'P2-scout-1' }],
    recruits: [
      ['P1-scout-2', 'scout', 12, 1],
      ['P1-raider-3', 'raider', 11, 1]
    ]
  },
  {
    id: 'turn-008',
    summary: 'P2 kept chipping the center scout and recruited a second guardian to stop the rush count from running away.',
    reasoning:
      'P2 could not yet finish P1’s capture scout legally, so the second guardian recruit was the engine seat prioritizing preservation over a faster but fragile counterattack.',
    moves: [
      ['P2-scout-1', 6, 7],
      ['P2-scout-2', 6, 8],
      ['P2-druid-1', 5, 7],
      ['P2-marksman-1', 4, 8],
      ['P2-guardian-1', 2, 8]
    ],
    attacks: [{ attacker: 'P2-scout-1', target: 'P1-scout-1' }],
    recruits: [['P2-guardian-2', 'guardian', 1, 8]]
  },
  {
    id: 'turn-009',
    summary: 'P1 nearly killed the lead P2 scout with ranged pressure and added another delayed raider.',
    reasoning:
      'The rush kept board pressure by using the forward scout against the damaged enemy scout, but the attack-attached deck damage left the target barely alive. This left P2 with a response window before any P1 win check.',
    moves: [
      ['P1-raider-1', 5, 4],
      ['P1-guardian-1', 6, 3],
      ['P1-marksman-1', 6, 2],
      ['P1-raider-2', 7, 3],
      ['P1-scout-2', 10, 3],
      ['P1-raider-3', 9, 2]
    ],
    attacks: [{ attacker: 'P1-scout-1', target: 'P2-scout-1', bonus: 'all' }],
    recruits: [['P1-raider-4', 'raider', 11, 1]]
  },
  {
    id: 'turn-010',
    summary: 'P2 stabilized the unit count with a druid recruit and concentrated damage on P1’s forward raider.',
    reasoning:
      'P2 could not fully erase the rush lead, so the engine seat preserved the guardian wall and used the remaining scout plus marksman to punish the exposed raider.',
    moves: [
      ['P2-scout-2', 6, 6],
      ['P2-druid-1', 5, 8],
      ['P2-marksman-1', 5, 7],
      ['P2-guardian-1', 3, 8],
      ['P2-guardian-2', 2, 8]
    ],
    attacks: [
      { attacker: 'P2-scout-1', target: 'P1-scout-1' },
      { attacker: 'P2-scout-2', target: 'P1-scout-1' }
    ],
    recruits: [['P2-druid-2', 'druid', 1, 8]]
  },
  {
    id: 'turn-011',
    summary: 'P1 used the damaged raider to flip northwest and recruited a marksman behind the rush line.',
    reasoning:
      'P1 chose center spread over an immediate low-odds trade into guardians. The marksman recruit improved follow-up pressure but remained delayed this turn.',
    moves: [
      ['P1-raider-1', 3, 3],
      ['P1-guardian-1', 5, 3],
      ['P1-marksman-1', 5, 2],
      ['P1-raider-2', 6, 4],
      ['P1-scout-2', 8, 5],
      ['P1-raider-3', 7, 3],
      ['P1-raider-4', 9, 2]
    ],
    attacks: [{ attacker: 'P1-scout-2', target: 'P2-scout-2' }],
    recruits: [['P1-marksman-2', 'marksman', 12, 1]]
  },
  {
    id: 'turn-012',
    summary: 'P2 wounded the central raider and added a healer for long stabilization.',
    reasoning:
      'P2 could not legally reach the northwest raider yet, so it used the scout and marksman to punish the central raider instead. Recruiting a healer followed the assignment to use stabilizing healing only as needed after contact began.',
    moves: [
      ['P2-scout-2', 6, 6],
      ['P2-druid-1', 5, 8],
      ['P2-marksman-1', 5, 6],
      ['P2-guardian-1', 4, 8],
      ['P2-guardian-2', 3, 8],
      ['P2-druid-2', 2, 8]
    ],
    attacks: [{ attacker: 'P2-scout-2', target: 'P1-raider-2' }],
    recruits: [['P2-healer-1', 'healer', 0, 8]]
  },
  {
    id: 'turn-013',
    summary: 'P1 killed P2’s remaining scout and recruited another scout to keep the capture race alive.',
    reasoning:
      'P1’s tempo cards were still strongest when attached to legal attacks by ready units. Removing the last P2 scout reduced P2’s ability to flip centers back quickly.',
    moves: [
      ['P1-guardian-1', 5, 4],
      ['P1-marksman-1', 5, 3],
      ['P1-raider-2', 6, 5],
      ['P1-scout-2', 8, 6],
      ['P1-raider-3', 6, 3],
      ['P1-raider-4', 7, 3],
      ['P1-marksman-2', 11, 1]
    ],
    attacks: [{ attacker: 'P1-scout-2', target: 'P2-scout-2', bonus: 'all' }],
    recruits: [['P1-scout-3', 'scout', 12, 1]]
  },
  {
    id: 'turn-014',
    summary: 'P2 screened the center-south approach and recruited another guardian.',
    reasoning:
      'P2 no longer had healthy scouts, so it played for survival through guardian density and marksman chip. The new guardian entered delayed and could not act this turn.',
    moves: [
      ['P2-druid-1', 5, 8],
      ['P2-marksman-1', 5, 6],
      ['P2-guardian-1', 5, 7],
      ['P2-guardian-2', 4, 8],
      ['P2-druid-2', 3, 8],
      ['P2-healer-1', 1, 8]
    ],
    attacks: [{ attacker: 'P2-marksman-1', target: 'P1-raider-2' }],
    recruits: [['P2-guardian-3', 'guardian', 0, 8]]
  },
  {
    id: 'turn-015',
    summary: 'P1 killed P2’s support marksman with a burst attack and recruited a final raider.',
    reasoning:
      'The rush could not legally reach the guardian screen cleanly, so it used a large attack-attached damage burst to remove the exposed support marksman instead.',
    moves: [
      ['P1-guardian-1', 5, 5],
      ['P1-marksman-1', 5, 4],
      ['P1-raider-2', 6, 6],
      ['P1-scout-2', 8, 7],
      ['P1-raider-3', 5, 3],
      ['P1-raider-4', 6, 3],
      ['P1-marksman-2', 10, 2],
      ['P1-scout-3', 10, 3]
    ],
    attacks: [{ attacker: 'P1-raider-2', target: 'P2-marksman-1', bonus: 'all' }],
    recruits: [['P1-raider-5', 'raider', 11, 1]]
  },
  {
    id: 'turn-016',
    summary: 'P2’s surviving scout removed P1’s wounded center raider and kept enough units alive to avoid an immediate P1 win.',
    reasoning:
      'P2 no longer had marksman support, so the one-health scout had to finish the exposed raider while the guardian wall tightened behind it. The game remained unresolved at 16 turns, with P1 ahead but P2 still viable through stabilizing screens.',
    moves: [
      ['P2-druid-1', 5, 8],
      ['P2-guardian-2', 4, 7],
      ['P2-druid-2', 4, 8],
      ['P2-healer-1', 2, 8],
      ['P2-guardian-3', 1, 8]
    ],
    attacks: [{ attacker: 'P2-scout-1', target: 'P1-raider-2' }]
  }
];

await resetRun();

let timeline = { schemaVersion: 1, title: 'E005 Rush vs Engine B', entries: [] };

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
  await writeFile(timelinePath, `${JSON.stringify({ schemaVersion: 1, title: 'E005 Rush vs Engine B', entries: [] }, null, 2)}\n`);
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
    '5005',
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
    ? ['zap', 'blast', 'storm', 'inferno']
    : ['village', 'peddler', 'potion', 'bandage'];
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

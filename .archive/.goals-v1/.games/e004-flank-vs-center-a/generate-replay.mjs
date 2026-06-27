import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { applyAction } from '../../src/core/engine.ts';
import { listLegalActions } from '../../src/core/legalActions.ts';
import { SeededRng } from '../../src/core/random.ts';

const root = '.games/e004-flank-vs-center-a';
const snapshotsDir = join(root, 'snapshots');
const deckPath = join(root, 'deck.json');
const boardPath = join(root, 'board.json');
const timelinePath = join(root, 'timeline.json');
const map = JSON.parse(await readFile('maps/sketch-v1.json', 'utf8'));
const unitDefs = JSON.parse(await readFile('rulesets/territory-v1-locked/units.json', 'utf8'));

const p1StartingDeck = 'P1=copper,copper,copper,copper,copper,copper,copper,village,potion,peddler';
const p2StartingDeck = 'P2=copper,copper,copper,copper,copper,copper,copper,silver,training,blast';
const p1BuyPriority = ['healer', 'storm', 'potion', 'village', 'peddler', 'silver'];
const p2BuyPriority = ['training', 'blast', 'peddler', 'silver'];

const turns = [
  {
    id: 'turn-001',
    summary: 'P1 opened with a two-center east claim and angled the support pair down the flank lane.',
    reasoning:
      'The flank/control seat used its fast units for northeast and east, not center-north. Village/Potion/Peddler produced healing but there was no damage yet, so the board value was positional and P1 avoided buying Copper.',
    moves: [
      ['P1-raider-1', 8, 1],
      ['P1-scout-1', 10, 3],
      ['P1-guardian-1', 10, 2],
      ['P1-marksman-1', 10, 1]
    ]
  },
  {
    id: 'turn-002',
    summary: 'P2 took west-south and formed the first compact center-support pocket.',
    reasoning:
      'P2’s opening hand delivered Training plus Blast. The upgrade went onto the marksman core piece, while the scout captured the safe western center and the druid/marksman advanced together instead of racing the southeast flank.',
    moves: [
      ['P2-scout-1', 3, 7],
      ['P2-scout-2', 2, 8],
      ['P2-druid-1', 2, 7],
      ['P2-marksman-1', 1, 8]
    ],
    upgrades: [{ kind: 'damage', target: 'P2-marksman-1', amount: 1 }]
  },
  {
    id: 'turn-003',
    summary: 'P1 sent the scout toward southeast and recruited a second scout to keep the flank wide.',
    reasoning:
      'P1’s first income spike came from the two nearby eastern centers. Rather than pivoting center, P1 spent the first recruit on another scout and pushed the original scout down the east edge to threaten center-southeast.',
    moves: [
      ['P1-scout-1', 9, 5],
      ['P1-raider-1', 7, 2],
      ['P1-guardian-1', 10, 3],
      ['P1-marksman-1', 9, 1]
    ],
    recruits: [['P1-scout-2', 'scout', 12, 1]]
  },
  {
    id: 'turn-004',
    summary: 'P2 claimed center-south and recruited a guardian for the delayed center block.',
    reasoning:
      'From the bottom-left seat, the exact middle was not reachable this turn. P2 took center-south first, kept the second scout and support pair close, and used the first 5 supply on a guardian as assigned.',
    moves: [
      ['P2-scout-1', 6, 8],
      ['P2-scout-2', 5, 7],
      ['P2-druid-1', 3, 7],
      ['P2-marksman-1', 2, 8]
    ],
    recruits: [['P2-guardian-1', 'guardian', 0, 8]]
  },
  {
    id: 'turn-005',
    summary: 'P1 flipped southeast and kept the raider pointed at P2’s delayed center route.',
    reasoning:
      'P1 kept the flank promise: the scout took the southeast center while the raider moved to the east edge of the center lane. P1 recruited a raider to make isolated center units expensive for P2.',
    moves: [
      ['P1-scout-1', 9, 7],
      ['P1-raider-1', 7, 4],
      ['P1-guardian-1', 9, 3],
      ['P1-marksman-1', 8, 2],
      ['P1-scout-2', 10, 3]
    ],
    recruits: [['P1-raider-2', 'raider', 11, 0]]
  },
  {
    id: 'turn-006',
    summary: 'P2 reached the middle and damaged P1’s first flank raider.',
    reasoning:
      'P2’s center-south scout advanced into the exact middle. The two scouts punished the raider that stepped into the lane; Blast damage, if available, stayed attached to the legal scout attack rather than becoming direct damage.',
    moves: [
      ['P2-scout-1', 6, 5],
      ['P2-scout-2', 6, 6],
      ['P2-druid-1', 4, 7],
      ['P2-marksman-1', 3, 7],
      ['P2-guardian-1', 1, 8]
    ],
    attacks: [
      { attacker: 'P2-scout-1', target: 'P1-raider-1', bonus: 2 },
      { attacker: 'P2-scout-2', target: 'P1-raider-1', bonus: 0 }
    ]
  },
  {
    id: 'turn-007',
    summary: 'P1 answered by killing P2’s wounded center scout and chipping the second scout.',
    reasoning:
      'The first raider survived at low HP and made one more melee attack into the center scout. P1 could not also flip center-south, so the original scout only chipped P2’s next capture unit while P1 added a druid for later printed healing.',
    moves: [
      ['P1-scout-1', 8, 7],
      ['P1-scout-2', 8, 5],
      ['P1-guardian-1', 9, 4],
      ['P1-marksman-1', 8, 3],
      ['P1-raider-2', 9, 1]
    ],
    attacks: [
      { attacker: 'P1-raider-1', target: 'P2-scout-1', bonus: 0 },
      { attacker: 'P1-scout-2', target: 'P2-scout-1', bonus: 0 },
      { attacker: 'P1-scout-1', target: 'P2-scout-2', bonus: 0 }
    ],
    recruits: [['P1-druid-1', 'druid', 11, 1]]
  },
  {
    id: 'turn-008',
    summary: 'P2 re-flipped center-south and recruited a marksman to keep the core intact.',
    reasoning:
      'The center plan still had enough bodies to answer. P2 moved the fresh guardian into the lane, reclaimed center-south with the second scout, and used the druid’s printed healing rather than an attack.',
    moves: [
      ['P2-scout-2', 6, 8],
      ['P2-druid-1', 5, 7],
      ['P2-marksman-1', 4, 7],
      ['P2-guardian-1', 2, 8]
    ],
    attacks: [{ attacker: 'P2-scout-2', target: 'P1-scout-1', bonus: 0 }],
    heals: [{ target: 'P2-scout-2', amount: 1 }],
    recruits: [['P2-marksman-2', 'marksman', 0, 9]]
  },
  {
    id: 'turn-009',
    summary: 'P1 flipped the exact middle from the east and kept pressure on center-south.',
    reasoning:
      'The flank was now forcing the compact formation to turn around. P1’s fresh scout took the center, the original scout stayed on the southeast lane, and the druid moved into support range instead of overcommitting to an illegal kill.',
    moves: [
      ['P1-scout-2', 6, 5],
      ['P1-scout-1', 7, 8],
      ['P1-guardian-1', 8, 5],
      ['P1-marksman-1', 7, 3],
      ['P1-raider-2', 7, 2],
      ['P1-druid-1', 10, 2]
    ],
    attacks: [{ attacker: 'P1-scout-1', target: 'P2-scout-2', bonus: 0 }],
    heals: [{ target: 'P1-scout-1', amount: 1 }],
    recruits: [['P1-healer-1', 'healer', 12, 1]]
  },
  {
    id: 'turn-010',
    summary: 'P2 used a heavy Blast turn to kill P1’s exposed center scout.',
    reasoning:
      'P2 did not chase the flank all the way east. It reinforced the central lane and attached Blast damage to a legal marksman attack, removing the scout that flipped the center.',
    moves: [
      ['P2-guardian-1', 3, 8],
      ['P2-druid-1', 5, 8],
      ['P2-marksman-1', 5, 6],
      ['P2-marksman-2', 1, 8]
    ],
    attacks: [{ attacker: 'P2-marksman-1', target: 'P1-scout-2', bonus: 4 }],
    recruits: [['P2-guardian-2', 'guardian', 0, 8]]
  },
  {
    id: 'turn-011',
    summary: 'P1 restored the southeast scout and widened east pressure after losing the center scout.',
    reasoning:
      'The damaged center scout could not be saved without overcommitting. P1 instead used deck healing and printed support to keep the southeast scout alive, while raider pressure headed for center-north.',
    moves: [
      ['P1-scout-1', 8, 7],
      ['P1-guardian-1', 7, 5],
      ['P1-marksman-1', 6, 4],
      ['P1-raider-2', 6, 3],
      ['P1-druid-1', 9, 2],
      ['P1-healer-1', 11, 1]
    ],
    heals: [
      { target: 'P1-scout-1', amount: 2 },
      { target: 'P1-scout-1', amount: 1 },
      { target: 'P1-scout-1', amount: 1 }
    ],
    recruits: [['P1-scout-3', 'scout', 12, 1]]
  },
  {
    id: 'turn-012',
    summary: 'P2 settled into a guardian/marksman block and chipped P1’s lead guardian.',
    reasoning:
      'The compact formation had removed P1’s center scout last turn, so this turn focused on holding shape. P2 also recruited another marksman, but the effort pulled resources away from retaking the southeast.',
    moves: [
      ['P2-guardian-1', 4, 8],
      ['P2-druid-1', 5, 8],
      ['P2-marksman-1', 5, 5],
      ['P2-marksman-2', 2, 8],
      ['P2-guardian-2', 1, 8]
    ],
    attacks: [{ attacker: 'P2-marksman-1', target: 'P1-guardian-1', bonus: 0 }],
    recruits: [['P2-marksman-3', 'marksman', 0, 9]]
  },
  {
    id: 'turn-013',
    summary: 'P1 flipped center-north and east while the healed scout kept the southeast flank alive.',
    reasoning:
      'P1’s center scout died, but the raider and fresh scout converted the edge pressure into more center control. The turn showed the seat-advantage question sharply: P1 was up on centers while P2 was up on concentrated combat stats.',
    moves: [
      ['P1-raider-2', 5, 3],
      ['P1-scout-3', 10, 3],
      ['P1-scout-1', 9, 7],
      ['P1-guardian-1', 6, 5],
      ['P1-marksman-1', 6, 4],
      ['P1-druid-1', 8, 3],
      ['P1-healer-1', 10, 2]
    ],
    attacks: [{ attacker: 'P1-guardian-1', target: 'P2-marksman-1', bonus: 0 }],
    recruits: [['P1-raider-3', 'raider', 11, 0]]
  },
  {
    id: 'turn-014',
    summary: 'P2 reclaimed the center and killed P1’s overextended raider with upgraded marksman fire.',
    reasoning:
      'P2’s compact plan did answer the middle: the guardian retook the lane while Training and Blast made the lead marksman a legal finisher against the raider. The downside was that southeast and east still belonged to P1.',
    moves: [
      ['P2-guardian-1', 5, 7],
      ['P2-druid-1', 5, 8],
      ['P2-marksman-1', 5, 5],
      ['P2-marksman-2', 3, 7],
      ['P2-guardian-2', 2, 8],
      ['P2-marksman-3', 1, 8]
    ],
    upgrades: [{ kind: 'damage', target: 'P2-marksman-1', amount: 1 }],
    attacks: [{ attacker: 'P2-marksman-1', target: 'P1-raider-2', bonus: 2 }],
    recruits: [['P2-scout-3', 'scout', 0, 9]]
  },
  {
    id: 'turn-015',
    summary: 'P1 used the flank economy to recruit again and kill P2’s damaged lead marksman.',
    reasoning:
      'P2’s center retake cost the exposed marksman. P1’s guardian finished it after the earlier chip, while the healer/druid support stayed behind the flank units and P1 converted the center-count lead into another recruit.',
    moves: [
      ['P1-guardian-1', 6, 5],
      ['P1-marksman-1', 6, 4],
      ['P1-scout-1', 9, 7],
      ['P1-scout-3', 9, 4],
      ['P1-druid-1', 7, 3],
      ['P1-healer-1', 9, 2],
      ['P1-raider-3', 9, 1]
    ],
    attacks: [{ attacker: 'P1-guardian-1', target: 'P2-marksman-1', bonus: 0 }],
    recruits: [['P1-raider-4', 'raider', 11, 1]]
  },
  {
    id: 'turn-016',
    summary: 'P2 preserved the center block but could not erase P1’s flank-center income lead by the stop point.',
    reasoning:
      'P2 had a durable guardian line and enough units to avoid the immediate 3-unit loss check. The run stopped after 16 completed player turns because P1 led on supply centers and unit count, but P2 still had a coherent central formation and the result was not formally resolved.',
    moves: [
      ['P2-guardian-1', 5, 7],
      ['P2-druid-1', 5, 8],
      ['P2-marksman-2', 4, 7],
      ['P2-guardian-2', 3, 8],
      ['P2-marksman-3', 2, 8],
      ['P2-scout-3', 3, 7]
    ],
    attacks: []
  }
];

await mkdir(snapshotsDir, { recursive: true });
await rm(snapshotsDir, { recursive: true, force: true });
await mkdir(snapshotsDir, { recursive: true });
await copyFile('.games/e003-locked-starter.board.json', boardPath);
await rm(deckPath, { force: true });
initializeDeck();

let timeline = { schemaVersion: 1, title: 'E004 Flank vs Center A', entries: [] };

for (let index = 0; index < turns.length; index += 1) {
  const turn = turns[index];
  const boardBefore = JSON.parse(await readFile(boardPath, 'utf8'));
  const deckBefore = JSON.parse(await readFile(deckPath, 'utf8'));
  const player = boardBefore.turn.activePlayer;
  const round = boardBefore.turn.round;
  const deckPlan = planDeckTurn(deckBefore, player);
  const paths = snapshotPaths(turn.id);

  await copyFile(deckPath, paths.deckBefore);
  await copyFile(boardPath, paths.boardBefore);
  await writeFile(join(root, `${turn.id}.script`), `${deckPlan.choices.join('\n')}\n`);
  runCli(turn.id, deckPlan.choices.length);
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

function planDeckTurn(snapshot, playerId) {
  let state = snapshot.game;
  let rng = SeededRng.fromState(snapshot.rngState);
  const active = activePlayer(state, playerId);
  const drawnHand = [...active.hand];
  const played = [];
  const bought = [];
  const choices = [];
  const trashTarget = active.hand.includes('rest') ? 'rest' : active.hand.filter((card) => card === 'copper').length >= 3 ? 'copper' : undefined;
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

function bestPlayableAction(state, playerId) {
  const player = activePlayer(state, playerId);
  if (player.actions <= 0) {
    return undefined;
  }
  const hand = new Set(player.hand);
  for (const cardId of ['zap', 'bandage', 'peddler', 'village', 'blast', 'potion', 'training']) {
    if (hand.has(cardId)) {
      return cardId;
    }
  }
  for (const cardId of ['healer', 'storm', 'second-wind', 'inferno', 'smithy', 'armory']) {
    if (hand.has(cardId)) {
      return cardId;
    }
  }
  if (hand.has('rest') && player.actions > 0) {
    return 'rest';
  }
  return undefined;
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

function runCli(turnId, actionCount) {
  const result = spawnSync('bun', [
    'run',
    'src/cli/main.ts',
    '--config',
    'rulesets/territory-v1-locked/deck.yaml',
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

function initializeDeck() {
  const result = spawnSync('bun', [
    'run',
    'src/cli/main.ts',
    '--config',
    'rulesets/territory-v1-locked/deck.yaml',
    '--state',
    deckPath,
    '--starting-deck',
    p1StartingDeck,
    '--starting-deck',
    p2StartingDeck,
    '--max-actions',
    '0'
  ], { cwd: process.cwd(), encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Deck initialization failed:\n${result.stdout}\n${result.stderr}`);
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
  const income = 2 + next.supplyControl.filter((center) => center.controller === player).length;
  supplyEntry(next, player).amount += income;

  for (const [unitId, col, row] of turn.moves ?? []) {
    moveUnit(next, player, unitId, col, row);
    captureCenter(next, player, col, row);
  }
  let damageUsed = 0;
  let healUsed = 0;
  let upgradeDamageUsed = 0;
  let upgradeHealthUsed = 0;

  for (const upgrade of turn.upgrades ?? []) {
    const unit = findUnit(next, upgrade.target);
    if (unit.player !== player) {
      throw new Error(`${turn.id}: cannot upgrade enemy unit ${upgrade.target}`);
    }
    if (upgrade.kind === 'damage') {
      upgradeDamageUsed += upgrade.amount;
      unit.attack += upgrade.amount;
    } else if (upgrade.kind === 'health') {
      upgradeHealthUsed += upgrade.amount;
      unit.maxHp += upgrade.amount;
      unit.hp = Math.min(unit.maxHp, unit.hp + upgrade.amount);
    }
  }
  if (upgradeDamageUsed > produced.upgradeDamage) {
    throw new Error(`${turn.id}: used ${upgradeDamageUsed} upgradeDamage but produced ${produced.upgradeDamage}`);
  }
  if (upgradeHealthUsed > produced.upgradeHealth) {
    throw new Error(`${turn.id}: used ${upgradeHealthUsed} upgradeHealth but produced ${produced.upgradeHealth}`);
  }
  for (const attack of turn.attacks ?? []) {
    damageUsed += attack.bonus ?? 0;
    attackUnit(next, player, attack.attacker, attack.target, attack.bonus ?? 0);
  }
  if (damageUsed > produced.damage) {
    throw new Error(`${turn.id}: used ${damageUsed} damage but produced ${produced.damage}`);
  }
  for (const heal of turn.heals ?? []) {
    const unit = findUnit(next, heal.target);
    if (unit.player !== player) {
      throw new Error(`${turn.id}: cannot heal enemy unit ${heal.target}`);
    }
    healUsed += heal.amount;
    unit.hp = Math.min(unit.maxHp, unit.hp + heal.amount);
  }
  if (healUsed > produced.heal + printedHealingAvailable(next, player, turn)) {
    throw new Error(`${turn.id}: used ${healUsed} healing but produced ${produced.heal} and had insufficient printed healing`);
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

function printedHealingAvailable(board, player, turn) {
  const attackers = new Set((turn.attacks ?? []).map((attack) => attack.attacker));
  const activeHealers = board.units.filter((unit) => unit.player === player && unitDefs[unit.type].heal && !attackers.has(unit.id));
  return activeHealers.reduce((total, unit) => total + unitDefs[unit.type].heal, 0);
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

function attackUnit(board, player, attackerId, targetId, bonus) {
  const attacker = findUnit(board, attackerId);
  const target = findUnit(board, targetId);
  if (attacker.player !== player || target.player === player) {
    throw new Error(`Illegal attack ${attackerId} -> ${targetId}`);
  }
  const range = unitDefs[attacker.type].range ?? 1;
  const distance = hexDistance(attacker.col, attacker.row, target.col, target.row);
  if (distance > range) {
    throw new Error(`${attackerId} cannot attack ${targetId}: distance ${distance} exceeds ${range}`);
  }
  target.hp -= attacker.attack + bonus;
  if (target.hp <= 0) {
    board.units = board.units.filter((unit) => unit.id !== targetId);
  }
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
  let frontier = [[startCol, startRow, 0]];
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
  let frontier = [[startCol, startRow, 0]];
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

function activePlayer(state, playerId) {
  const player = state.players[state.activePlayer];
  if (!player || player.id !== playerId) {
    throw new Error(`Expected active deck player ${playerId}, got ${player?.id ?? 'none'}`);
  }
  return player;
}

function cardName(snapshot, cardId) {
  return snapshot.game.cards[cardId]?.name ?? cardId;
}

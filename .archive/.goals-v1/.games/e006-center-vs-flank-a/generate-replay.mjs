import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { applyAction } from '../../src/core/engine.ts';
import { listLegalActions } from '../../src/core/legalActions.ts';
import { SeededRng } from '../../src/core/random.ts';

const root = '.games/e006-center-vs-flank-a';
const snapshotsDir = join(root, 'snapshots');
const deckPath = join(root, 'deck.json');
const boardPath = join(root, 'board.json');
const timelinePath = join(root, 'timeline.json');
const map = JSON.parse(await readFile('maps/sketch-v2-access.json', 'utf8'));
const unitDefs = JSON.parse(await readFile('rulesets/territory-v1-cost6/units.json', 'utf8'));

const p1BuyPriority = ['training', 'blast', 'peddler', 'silver'];
const p2BuyPriority = ['healer', 'storm', 'potion', 'village', 'peddler', 'silver'];

const turns = [
  {
    id: 'turn-001',
    summary: 'P1 opened by taking the northeast center and staging the guardian/marksman core toward the middle.',
    reasoning:
      'P1 followed the compact-center assignment: the raider took the nearest supply center while the scout and slow core advanced without overextending. Cost 6 meant the opening income could not become a quick extra body.',
    moves: [
      ['P1-raider-1', 8, 1],
      ['P1-scout-1', 10, 3],
      ['P1-guardian-1', 10, 2],
      ['P1-marksman-1', 10, 0]
    ],
    upgrades: [{ kind: 'damage', target: 'P1-guardian-1', amount: 1 }]
  },
  {
    id: 'turn-002',
    summary: 'P2 started the west-south flank and sent the second scout toward the southeast lane.',
    reasoning:
      'P2 used scouts for lane access while the druid and marksman stayed behind them. Early healing had no damaged target, so the board pressure came from captures rather than combat.',
    moves: [
      ['P2-scout-1', 3, 7],
      ['P2-scout-2', 2, 9],
      ['P2-druid-1', 2, 7],
      ['P2-marksman-1', 1, 8]
    ]
  },
  {
    id: 'turn-003',
    summary: 'P1 advanced the center group but banked supply instead of recruiting at the old cost-5 timing.',
    reasoning:
      'P1 had only 5 saved supply after income, so the cost-6 rule prevented the E005-style turn-3 marksman. The Training counter went onto the lead guardian to keep the center push tactically meaningful.',
    moves: [
      ['P1-scout-1', 7, 3],
      ['P1-raider-1', 6, 2],
      ['P1-guardian-1', 9, 2],
      ['P1-marksman-1', 9, 0]
    ]
  },
  {
    id: 'turn-004',
    summary: 'P2 also hit the cost-6 brake and widened the southern approach without adding a raider yet.',
    reasoning:
      'P2 had 5 supply after income, so the flank-control deck could not immediately convert west-south control into another body. The scouts continued to stretch P1 toward center-south and southeast.',
    moves: [
      ['P2-scout-1', 6, 8],
      ['P2-scout-2', 5, 8],
      ['P2-druid-1', 3, 7],
      ['P2-marksman-1', 2, 8]
    ]
  },
  {
    id: 'turn-005',
    summary: 'P1 claimed center-north and finally recruited the first reinforcement from banked supply.',
    reasoning:
      'The delayed recruit was a marksman rather than a scout, matching P1s guardian/marksman core plan. P1 still had to leave the new unit inactive until the next friendly board phase.',
    moves: [
      ['P1-scout-1', 5, 3],
      ['P1-raider-1', 6, 4],
      ['P1-guardian-1', 8, 2],
      ['P1-marksman-1', 8, 1]
    ],
    recruits: [['P1-marksman-2', 'marksman', 11, 0]]
  },
  {
    id: 'turn-006',
    summary: 'P2 completed the southeast flank, chipped P1s raider, and recruited the first punish raider.',
    reasoning:
      'P2 reached 8 supply after the delayed income turn and spent 6 on a raider. The scout attack was a legal printed ranged attack; deck healing remained unused except for future stabilization value.',
    moves: [
      ['P2-scout-1', 9, 7],
      ['P2-scout-2', 6, 6],
      ['P2-druid-1', 4, 7],
      ['P2-marksman-1', 3, 7]
    ],
    attacks: [{ attacker: 'P2-scout-2', target: 'P1-raider-1', bonus: 0 }],
    recruits: [['P2-raider-1', 'raider', 0, 8]]
  },
  {
    id: 'turn-007',
    summary: 'P1 took the exact middle, bloodied the forward southern scout, and added a guardian.',
    reasoning:
      'Cost 6 delayed but did not eliminate P1s center reinforcement. P1 used the raider as the legal attack carrier for deck damage and bought a durable recruit instead of another fast capture unit.',
    moves: [
      ['P1-guardian-1', 7, 2],
      ['P1-raider-1', 6, 5],
      ['P1-scout-1', 5, 4],
      ['P1-marksman-1', 7, 1],
      ['P1-marksman-2', 10, 1]
    ],
    upgrades: [{ kind: 'damage', target: 'P1-guardian-1', amount: 1 }],
    attacks: [{ attacker: 'P1-raider-1', target: 'P2-scout-2', bonus: 1 }],
    recruits: [['P1-guardian-2', 'guardian', 11, 1]]
  },
  {
    id: 'turn-008',
    summary: 'P2 healed the damaged scout, took center-south, and recruited support behind the flank.',
    reasoning:
      'P2 chose preservation over a direct trade. The druid captured center-south, Potion healing kept the forward scout alive, and the new healer gave the flank a way to contest without racing bodies as quickly as E005.',
    moves: [
      ['P2-scout-1', 10, 5],
      ['P2-scout-2', 7, 6],
      ['P2-druid-1', 5, 7],
      ['P2-marksman-1', 4, 7],
      ['P2-raider-1', 2, 8]
    ],
    heals: [{ target: 'P2-scout-2', amount: 2 }],
    recruits: [['P2-healer-1', 'healer', 1, 7]]
  },
  {
    id: 'turn-009',
    summary: 'P1 collapsed onto the middle and killed the damaged scout before it could flip center.',
    reasoning:
      'P1 used the raider as the attack carrier for Blast damage rather than treating deck damage as direct spell damage. The kill preserved center tempo, but P2 still had an active southeast scout and support pocket.',
    moves: [
      ['P1-guardian-1', 6, 3],
      ['P1-raider-1', 6, 6],
      ['P1-scout-1', 6, 5],
      ['P1-marksman-1', 6, 2],
      ['P1-marksman-2', 9, 1],
      ['P1-guardian-2', 10, 2]
    ],
    attacks: [{ attacker: 'P1-raider-1', target: 'P2-scout-2', bonus: 2 }]
  },
  {
    id: 'turn-010',
    summary: 'P2 flipped east and damaged P1s exposed center scout from a support marksman position.',
    reasoning:
      'The surviving flank scout forced P1 to respect the east lane. P2 avoided a losing central melee and used printed marksman damage to soften the scout holding the middle.',
    moves: [
      ['P2-scout-1', 9, 5],
      ['P2-druid-1', 5, 8],
      ['P2-marksman-1', 5, 6],
      ['P2-raider-1', 4, 8],
      ['P2-healer-1', 2, 7]
    ],
    attacks: [{ attacker: 'P2-marksman-1', target: 'P1-scout-1', bonus: 0 }]
  },
  {
    id: 'turn-011',
    summary: 'P1 killed P2s support marksman but had to spread east instead of staying compact.',
    reasoning:
      'The center formation punished the exposed marksman, while the guardian and upgraded marksman shifted toward the east scout. This preserved the center/flank split rather than letting P1 simply stack the middle.',
    moves: [
      ['P1-guardian-1', 6, 4],
      ['P1-raider-1', 6, 7],
      ['P1-scout-1', 7, 5],
      ['P1-marksman-1', 6, 3],
      ['P1-marksman-2', 9, 2],
      ['P1-guardian-2', 10, 3]
    ],
    upgrades: [{ kind: 'damage', target: 'P1-guardian-2', amount: 1 }],
    attacks: [
      { attacker: 'P1-raider-1', target: 'P2-marksman-1', bonus: 0 },
      { attacker: 'P1-scout-1', target: 'P2-marksman-1', bonus: 0 }
    ],
    recruits: [['P1-guardian-3', 'guardian', 10, 1]]
  },
  {
    id: 'turn-012',
    summary: 'P2 killed P1s damaged raider and reloaded the west lane with a scout.',
    reasoning:
      'P2 converted the delayed raider into a real punish turn. The cost-6 economy allowed only one recruit, so the response restored pressure without immediately matching P1s body count.',
    moves: [
      ['P2-raider-1', 5, 7],
      ['P2-druid-1', 5, 8],
      ['P2-healer-1', 3, 7]
    ],
    attacks: [
      { attacker: 'P2-raider-1', target: 'P1-raider-1', bonus: 0 },
      { attacker: 'P2-scout-1', target: 'P1-scout-1', bonus: 0 }
    ],
    heals: [{ target: 'P2-raider-1', amount: 1 }],
    recruits: [['P2-scout-3', 'scout', 1, 8]]
  },
  {
    id: 'turn-013',
    summary: 'P1 killed the east scout, reclaimed the lane, and recruited a third marksman.',
    reasoning:
      'P1 had enough banked supply for another single recruit, but not a flood. The upgraded marksman and scout finished the east threat while the guardian core held center.',
    moves: [
      ['P1-guardian-1', 6, 5],
      ['P1-marksman-1', 6, 4],
      ['P1-scout-1', 8, 5],
      ['P1-marksman-2', 9, 3],
      ['P1-guardian-2', 10, 4],
      ['P1-guardian-3', 10, 2]
    ],
    upgrades: [{ kind: 'damage', target: 'P1-marksman-2', amount: 1 }],
    attacks: [
      { attacker: 'P1-marksman-2', target: 'P2-scout-1', bonus: 2 },
      { attacker: 'P1-scout-1', target: 'P2-scout-1', bonus: 0 }
    ],
    recruits: [['P1-marksman-3', 'marksman', 11, 0]]
  },
  {
    id: 'turn-014',
    summary: 'P2 re-flipped west-south and sent the raider back into the center-south lane.',
    reasoning:
      'P2 could not match P1s center mass directly, so the new scout took capture duty while the raider threatened P1s lead guardian. One more raider recruit kept the flank dangerous without creating a cost-5 style swarm.',
    moves: [
      ['P2-raider-1', 6, 6],
      ['P2-druid-1', 5, 7],
      ['P2-healer-1', 4, 7],
      ['P2-scout-3', 3, 7]
    ],
    attacks: [{ attacker: 'P2-raider-1', target: 'P1-guardian-1', bonus: 0 }],
    recruits: [['P2-raider-2', 'raider', 0, 8]]
  },
  {
    id: 'turn-015',
    summary: 'P1 retook east and damaged the raider, but chose another guardian over a second recruit wave.',
    reasoning:
      'P1 had a lead but not a resolved win. The center guardian hit the raider without enough follow-up to kill it, leaving P2 a live punish piece for the final recorded response.',
    moves: [
      ['P1-guardian-1', 6, 5],
      ['P1-marksman-1', 6, 4],
      ['P1-scout-1', 9, 5],
      ['P1-marksman-2', 8, 3],
      ['P1-guardian-2', 9, 4],
      ['P1-guardian-3', 10, 1],
      ['P1-marksman-3', 10, 0]
    ],
    attacks: [{ attacker: 'P1-guardian-1', target: 'P2-raider-1', bonus: 0 }],
    recruits: [['P1-guardian-4', 'guardian', 11, 1]]
  },
  {
    id: 'turn-016',
    summary: 'P2 used the surviving raider to kill P1s east scout and recruited one more support unit.',
    reasoning:
      'The cost-6 rule kept P2 to one recruit despite four-center income earlier in the game. P2 reduced P1s unit lead and kept the flank alive, so the run stops with P1 ahead but not at a checked win condition.',
    moves: [
      ['P2-raider-1', 8, 6],
      ['P2-druid-1', 6, 7],
      ['P2-healer-1', 5, 7],
      ['P2-scout-3', 4, 5],
      ['P2-raider-2', 2, 8]
    ],
    attacks: [{ attacker: 'P2-raider-1', target: 'P1-scout-1', bonus: 0 }],
    heals: [{ target: 'P2-raider-1', amount: 2 }],
    recruits: [['P2-healer-2', 'healer', 1, 7]]
  }
];

await mkdir(snapshotsDir, { recursive: true });
await rm(snapshotsDir, { recursive: true, force: true });
await mkdir(snapshotsDir, { recursive: true });

let timeline = { schemaVersion: 1, title: 'E006 Center vs Flank A', entries: [] };

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
    'rulesets/territory-v1-cost6/deck.yaml',
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
  const income = 2 + next.supplyControl.filter((center) => center.controller === player).length;
  supplyEntry(next, player).amount += income;
  const usedDamage = (turn.attacks ?? []).reduce((total, attack) => total + (attack.bonus ?? 0), 0);
  const usedHeal = (turn.heals ?? []).reduce((total, heal) => total + heal.amount, 0);
  const usedUpgradeDamage = (turn.upgrades ?? [])
    .filter((upgrade) => upgrade.kind === 'damage')
    .reduce((total, upgrade) => total + upgrade.amount, 0);
  const usedUpgradeHealth = (turn.upgrades ?? [])
    .filter((upgrade) => upgrade.kind === 'health')
    .reduce((total, upgrade) => total + upgrade.amount, 0);
  if (usedDamage > produced.damage) {
    throw new Error(`${turn.id}: used ${usedDamage} deck damage but produced ${produced.damage}`);
  }
  if (usedHeal > produced.heal) {
    throw new Error(`${turn.id}: used ${usedHeal} deck healing but produced ${produced.heal}`);
  }
  if (usedUpgradeDamage > produced.upgradeDamage) {
    throw new Error(`${turn.id}: used ${usedUpgradeDamage} damage upgrades but produced ${produced.upgradeDamage}`);
  }
  if (usedUpgradeHealth > produced.upgradeHealth) {
    throw new Error(`${turn.id}: used ${usedUpgradeHealth} health upgrades but produced ${produced.upgradeHealth}`);
  }

  for (const [unitId, col, row] of turn.moves ?? []) {
    moveUnit(next, player, unitId, col, row);
    captureCenter(next, player, col, row);
  }
  for (const upgrade of turn.upgrades ?? []) {
    const unit = findUnit(next, upgrade.target);
    if (unit.player !== player) {
      throw new Error(`${turn.id}: cannot upgrade enemy unit ${upgrade.target}`);
    }
    if (upgrade.kind === 'damage') {
      unit.attack += upgrade.amount;
    } else if (upgrade.kind === 'health') {
      unit.maxHp += upgrade.amount;
      unit.hp = Math.min(unit.maxHp, unit.hp + upgrade.amount);
    }
  }
  for (const attack of turn.attacks ?? []) {
    attackUnit(next, player, attack.attacker, attack.target, attack.bonus ?? 0);
  }
  for (const heal of turn.heals ?? []) {
    const unit = findUnit(next, heal.target);
    if (unit.player !== player) {
      throw new Error(`${turn.id}: cannot heal enemy unit ${heal.target}`);
    }
    unit.hp = Math.min(unit.maxHp, unit.hp + heal.amount);
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
  const cost = 6;
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
  const blocked = map.blocked ?? map.blockedHexes ?? [];
  return map.hexes.some((hex) => hex.col === col && hex.row === row) && !blocked.some((hex) => hex.col === col && hex.row === row);
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

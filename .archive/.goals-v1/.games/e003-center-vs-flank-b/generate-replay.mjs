import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { applyAction } from '../../src/core/engine.ts';
import { listLegalActions } from '../../src/core/legalActions.ts';
import { SeededRng } from '../../src/core/random.ts';

const root = '.games/e003-center-vs-flank-b';
const snapshotsDir = join(root, 'snapshots');
const deckPath = join(root, 'deck.json');
const boardPath = join(root, 'board.json');
const timelinePath = join(root, 'timeline.json');
const starterBoardPath = '.games/e003-locked-starter.board.json';
const deckConfigPath = 'rulesets/territory-v1-locked/deck.yaml';
const map = JSON.parse(await readFile('maps/sketch-v1.json', 'utf8'));
const unitDefs = JSON.parse(await readFile('rulesets/territory-v1-locked/units.json', 'utf8'));

const p1StartingDeck = 'P1=copper,copper,copper,copper,copper,copper,copper,silver,training,blast';
const p2StartingDeck = 'P2=copper,copper,copper,copper,copper,copper,copper,village,potion,peddler';
const p1BuyPriority = ['training', 'blast', 'peddler', 'silver'];
const p2BuyPriority = ['healer', 'storm', 'potion', 'village', 'peddler', 'silver'];

const turns = [
  {
    id: 'turn-001',
    summary: 'P1 opened with near-side center captures and kept the guardian/marksman pair pointed toward the middle.',
    reasoning:
      'P1 trashed a Copper from the money-heavy opener, still reached a Training buy, and avoided adding Copper. The raider and scout took safe supply centers while the slower core stayed compact.',
    moves: [
      ['P1-raider-1', 8, 1],
      ['P1-scout-1', 10, 3],
      ['P1-guardian-1', 10, 2],
      ['P1-marksman-1', 10, 0]
    ]
  },
  {
    id: 'turn-002',
    summary: 'P2 committed both scouts south and west, starting the flank without exposing the support units.',
    reasoning:
      'P2 used the all-Copper opener to buy Potion after trashing Copper. Board pressure came from scout captures, with druid and marksman trailing instead of taking an early center fight.',
    moves: [
      ['P2-scout-1', 3, 7],
      ['P2-scout-2', 2, 9],
      ['P2-druid-1', 2, 7],
      ['P2-marksman-1', 1, 8]
    ]
  },
  {
    id: 'turn-003',
    summary: 'P1 upgraded the lead guardian and pushed the center column while recruiting a second marksman.',
    reasoning:
      'Training was applied permanently to the guardian before combat, matching the compact upgraded-core plan. Blast had no legal attack target, so the deck damage was not treated as direct damage.',
    moves: [
      ['P1-scout-1', 7, 3],
      ['P1-raider-1', 6, 2],
      ['P1-guardian-1', 9, 2],
      ['P1-marksman-1', 9, 0]
    ],
    upgrades: [{ kind: 'damage', target: 'P1-guardian-1', amount: 1 }],
    recruits: [['P1-marksman-2', 'marksman', 11, 0]]
  },
  {
    id: 'turn-004',
    summary: 'P2 flipped the southern center and added a raider to make the flank punish more than a capture race.',
    reasoning:
      'The first southern scout claimed income, the second scout formed a screen, and the delayed raider recruit set up future attacks on isolated center units.',
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
    summary: 'P1 took center-north and tightened the guardian/marksman line around the middle.',
    reasoning:
      'The safe scout flip kept P1 on the center-control plan while the upgraded guardian and marksmen moved in a mutually supporting group.',
    moves: [
      ['P1-scout-1', 5, 3],
      ['P1-raider-1', 6, 4],
      ['P1-guardian-1', 8, 2],
      ['P1-marksman-1', 8, 1],
      ['P1-marksman-2', 10, 1]
    ]
  },
  {
    id: 'turn-006',
    summary: 'P2 completed the southeast capture and chipped P1’s raider from the southern screen.',
    reasoning:
      'The flank became real board pressure: P2 held two southern centers and used a legal scout attack, without expanding deck damage beyond legal attacks.',
    moves: [
      ['P2-scout-1', 9, 7],
      ['P2-scout-2', 6, 6],
      ['P2-druid-1', 4, 7],
      ['P2-marksman-1', 3, 7],
      ['P2-raider-1', 2, 8]
    ],
    attacks: [{ attacker: 'P2-scout-2', target: 'P1-raider-1' }]
  },
  {
    id: 'turn-007',
    summary: 'P1 collapsed onto the forward scout and removed it while adding a second guardian.',
    reasoning:
      'P1 answered the flank with board attacks rather than direct spell damage. The guardian recruit favored durable center control, but it entered delayed and did not act this turn.',
    moves: [
      ['P1-guardian-1', 7, 2],
      ['P1-raider-1', 6, 5],
      ['P1-scout-1', 5, 4],
      ['P1-marksman-1', 7, 1],
      ['P1-marksman-2', 9, 1]
    ],
    attacks: [
      { attacker: 'P1-raider-1', target: 'P2-scout-2' },
      { attacker: 'P1-scout-1', target: 'P2-scout-2' }
    ],
    recruits: [['P1-guardian-2', 'guardian', 11, 1]]
  },
  {
    id: 'turn-008',
    summary: 'P2 kept the remaining scout wide and built a healer behind the southern support pocket.',
    reasoning:
      'With one scout gone, P2 avoided a direct center brawl. The southeast scout moved toward P1’s east center while the druid, marksman, and raider stayed close enough to punish a center overextension.',
    moves: [
      ['P2-scout-1', 10, 5],
      ['P2-druid-1', 5, 7],
      ['P2-marksman-1', 4, 7],
      ['P2-raider-1', 4, 8]
    ],
    recruits: [['P2-healer-1', 'healer', 1, 7]]
  },
  {
    id: 'turn-009',
    summary: 'P1 claimed the exact middle and shifted the second guardian toward the east response lane.',
    reasoning:
      'The center plan gained a fourth center, but P1 had to start spreading out because the surviving scout threatened the east supply center.',
    moves: [
      ['P1-guardian-1', 6, 3],
      ['P1-raider-1', 6, 6],
      ['P1-scout-1', 6, 5],
      ['P1-marksman-1', 6, 2],
      ['P1-marksman-2', 8, 2],
      ['P1-guardian-2', 10, 2]
    ]
  },
  {
    id: 'turn-010',
    summary: 'P2 flipped the east center and punished both exposed center units.',
    reasoning:
      'This was the main flank payoff: the scout forced an east response while the raider and marksman damaged P1’s stretched center formation.',
    moves: [
      ['P2-scout-1', 10, 3],
      ['P2-druid-1', 5, 8],
      ['P2-marksman-1', 4, 6],
      ['P2-raider-1', 5, 6],
      ['P2-healer-1', 2, 7]
    ],
    attacks: [
      { attacker: 'P2-marksman-1', target: 'P1-scout-1' },
      { attacker: 'P2-raider-1', target: 'P1-raider-1' }
    ]
  },
  {
    id: 'turn-011',
    summary: 'P1 killed the flanking scout, then recruited another marksman to rebuild the center screen.',
    reasoning:
      'P1 could answer east, but only by committing the second guardian and a marksman away from the compact center. This preserved the intended center-versus-flank tension.',
    moves: [
      ['P1-guardian-2', 10, 2],
      ['P1-marksman-2', 9, 2],
      ['P1-guardian-1', 6, 4],
      ['P1-marksman-1', 6, 3]
    ],
    attacks: [
      { attacker: 'P1-guardian-2', target: 'P2-scout-1' },
      { attacker: 'P1-marksman-2', target: 'P2-scout-1' }
    ],
    recruits: [['P1-marksman-3', 'marksman', 12, 1]]
  },
  {
    id: 'turn-012',
    summary: 'P2 killed P1’s center scout and sent a fresh scout toward the west-south recapture.',
    reasoning:
      'P2 was behind on unit count but still had a support pocket and raider pressure. The healer used printed healing rather than attacking because keeping the raider healthy mattered more than one damage.',
    moves: [
      ['P2-raider-1', 5, 7],
      ['P2-druid-1', 5, 8],
      ['P2-marksman-1', 5, 5],
      ['P2-healer-1', 3, 7]
    ],
    attacks: [{ attacker: 'P2-marksman-1', target: 'P1-scout-1' }],
    heals: [{ healer: 'P2-healer-1', target: 'P2-raider-1', amount: 1 }],
    recruits: [['P2-scout-3', 'scout', 1, 8]]
  },
  {
    id: 'turn-013',
    summary: 'P1 converted the upgraded guardian into a kill on P2’s support marksman and added another guardian.',
    reasoning:
      'The center mass could punish support units once the flank scout died. P1 still could not immediately win because the check happens only at the start of the active player’s turn.',
    moves: [
      ['P1-guardian-1', 6, 5],
      ['P1-marksman-1', 6, 4],
      ['P1-guardian-2', 10, 3],
      ['P1-marksman-2', 8, 3],
      ['P1-marksman-3', 11, 1]
    ],
    attacks: [
      { attacker: 'P1-guardian-1', target: 'P2-marksman-1' },
      { attacker: 'P1-marksman-1', target: 'P2-marksman-1' }
    ],
    recruits: [['P1-guardian-3', 'guardian', 11, 0]]
  },
  {
    id: 'turn-014',
    summary: 'P2 re-flipped west-south and hit the lead guardian instead of feeding support into the center.',
    reasoning:
      'P2’s fresh scout resumed capture duty while the raider attacked the upgraded guardian. The support units stayed south, preserving a fallback even as P1 led in the center.',
    moves: [
      ['P2-healer-1', 4, 7],
      ['P2-scout-3', 3, 7],
      ['P2-raider-1', 5, 5],
      ['P2-druid-1', 5, 8]
    ],
    attacks: [{ attacker: 'P2-raider-1', target: 'P1-guardian-1' }],
    recruits: [['P2-raider-2', 'raider', 0, 8]]
  },
  {
    id: 'turn-015',
    summary: 'P1 held the middle, reinforced east, and damaged the southern raider without ending the game.',
    reasoning:
      'P1 was ahead, but the formation was now wide rather than compact. The attack chose pressure over a guaranteed overextension, leaving P2 with a meaningful turn to respond.',
    moves: [
      ['P1-guardian-1', 6, 5],
      ['P1-marksman-1', 6, 4],
      ['P1-guardian-2', 10, 3],
      ['P1-marksman-2', 8, 3],
      ['P1-marksman-3', 10, 2],
      ['P1-guardian-3', 10, 1]
    ],
    attacks: [{ attacker: 'P1-marksman-1', target: 'P2-raider-1' }],
    recruits: [['P1-marksman-4', 'marksman', 12, 1]]
  },
  {
    id: 'turn-016',
    summary: 'P2 preserved the flank by badly wounding the lead guardian and recruiting another scout.',
    reasoning:
      'The raider kept punishing the exposed upgraded guardian while the new scout kept P2 close enough on unit count to avoid an immediate start-of-turn loss. The run stopped here because P1 led on centers and material, but P2 still had a live flank and support pocket.',
    moves: [
      ['P2-raider-1', 5, 5],
      ['P2-druid-1', 5, 7],
      ['P2-healer-1', 4, 7],
      ['P2-scout-3', 5, 8],
      ['P2-raider-2', 2, 8]
    ],
    attacks: [{ attacker: 'P2-raider-1', target: 'P1-guardian-1' }],
    heals: [{ healer: 'P2-healer-1', target: 'P2-raider-1', amount: 1 }],
    recruits: [['P2-scout-4', 'scout', 1, 8]]
  }
];

await resetRun();

let timeline = { schemaVersion: 1, title: 'E003 Center vs Flank B', entries: [] };

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
  await writeFile(timelinePath, `${JSON.stringify({ schemaVersion: 1, title: 'E003 Center vs Flank B', entries: [] }, null, 2)}\n`);
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
    ? ['training', 'blast', 'peddler', 'village', 'potion', 'healer', 'storm']
    : ['village', 'peddler', 'potion', 'healer', 'storm', 'training', 'blast'];
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
  const bonus = attack.bonus ?? 0;
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

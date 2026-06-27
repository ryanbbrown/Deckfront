import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { applyAction } from '../../src/core/engine.ts';
import { listLegalActions } from '../../src/core/legalActions.ts';
import { SeededRng } from '../../src/core/random.ts';

const root = '.games/e009-center-vs-flank-a';
const ruleset = 'territory-v1-cost6-damagecap-recruitcap';
const mapId = 'sketch-v2-access';
const deckConfigPath = `rulesets/${ruleset}/deck.yaml`;
const starterBoardPath = '.games/e009-recruitcap-starter.board.json';
const snapshotsDir = join(root, 'snapshots');
const deckPath = join(root, 'deck.json');
const boardPath = join(root, 'board.json');
const timelinePath = join(root, 'timeline.json');
const notesPath = join(root, 'notes.md');
const map = JSON.parse(await readFile(`maps/${mapId}.json`, 'utf8'));
const unitDefs = JSON.parse(await readFile(`rulesets/${ruleset}/units.json`, 'utf8'));

const p1BuyPriority = ['training', 'armory', 'second-wind', 'blast', 'peddler', 'village', 'silver', 'gold'];
const p2BuyPriority = ['healer', 'storm', 'potion', 'village', 'peddler', 'silver', 'gold'];

const turns = [
  {
    id: 'turn-001',
    summary: 'P1 opened by taking the northeast center and staging the guardian/marksman core toward the middle.',
    reasoning:
      'P1 followed the compact-center assignment: the raider took the nearest supply center while the scout and slow core advanced without overextending. The one-recruit cap was not relevant before the first income cycle.',
    moves: [
      ['P1-raider-1', 8, 1],
      ['P1-scout-1', 10, 3],
      ['P1-guardian-1', 10, 2],
      ['P1-marksman-1', 10, 0]
    ]
  },
  {
    id: 'turn-002',
    summary: 'P2 started the west-south flank and sent the second scout toward the southeast lane.',
    reasoning:
      'P2 used scouts for lane access while the druid and marksman stayed behind them. The flank player prioritized early captures over a central collision.',
    moves: [
      ['P2-scout-1', 3, 7],
      ['P2-scout-2', 2, 9],
      ['P2-druid-1', 2, 7],
      ['P2-marksman-1', 1, 8]
    ]
  },
  {
    id: 'turn-003',
    summary: 'P1 advanced the center group but banked supply instead of recruiting immediately.',
    reasoning:
      'P1 had only 5 saved supply after income, so recruit cost 6 kept the central player on starting bodies for another turn.',
    moves: [
      ['P1-scout-1', 7, 3],
      ['P1-raider-1', 6, 2],
      ['P1-guardian-1', 9, 2],
      ['P1-marksman-1', 9, 0]
    ]
  },
  {
    id: 'turn-004',
    summary: 'P2 widened the southern approach and also stayed below the first recruit threshold.',
    reasoning:
      'P2 had 5 supply after income. The scouts continued to stretch P1 toward center-south and southeast while the support pair trailed.',
    moves: [
      ['P2-scout-1', 6, 8],
      ['P2-scout-2', 5, 8],
      ['P2-druid-1', 3, 7],
      ['P2-marksman-1', 2, 8]
    ]
  },
  {
    id: 'turn-005',
    summary: 'P1 claimed center-north and recruited the first central marksman reinforcement.',
    reasoning:
      'The delayed recruit was a marksman rather than another scout, matching P1s plan to protect a compact central formation.',
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
    summary: 'P2 completed the southeast flank, chipped P1s raider, and recruited a punish raider.',
    reasoning:
      'P2 reached 8 supply and spent 6 on one raider. The one-recruit cap left saved supply banked instead of allowing a second body.',
    moves: [
      ['P2-scout-1', 9, 7],
      ['P2-scout-2', 6, 6],
      ['P2-druid-1', 4, 7],
      ['P2-marksman-1', 3, 7]
    ],
    attacks: [{ attacker: 'P2-scout-2', target: 'P1-raider-1' }],
    recruits: [['P2-raider-1', 'raider', 0, 8]]
  },
  {
    id: 'turn-007',
    summary: 'P1 took the exact middle, bloodied the forward southern scout, and added a guardian.',
    reasoning:
      'P1 converted the delayed central income into durability rather than a faster flank unit. The new guardian entered inactive at home.',
    moves: [
      ['P1-guardian-1', 7, 2],
      ['P1-raider-1', 6, 5],
      ['P1-scout-1', 5, 4],
      ['P1-marksman-1', 7, 1],
      ['P1-marksman-2', 10, 1]
    ],
    attacks: [{ attacker: 'P1-raider-1', target: 'P2-scout-2' }],
    recruits: [['P1-guardian-2', 'guardian', 11, 1]]
  },
  {
    id: 'turn-008',
    summary: 'P2 took center-south and recruited support behind the flank.',
    reasoning:
      'P2 chose preservation and lane pressure over a direct middle trade. The support recruit kept the flank plan alive without matching P1s center mass.',
    moves: [
      ['P2-scout-1', 10, 5],
      ['P2-scout-2', 7, 6],
      ['P2-druid-1', 5, 7],
      ['P2-marksman-1', 4, 7],
      ['P2-raider-1', 2, 8]
    ],
    recruits: [['P2-healer-1', 'healer', 1, 7]]
  },
  {
    id: 'turn-009',
    summary: 'P1 collapsed onto the middle and killed the damaged southern scout.',
    reasoning:
      'The center raider finished the scout through a legal melee attack. P2 still had an active southeast scout and a support pocket, so the flank plan remained relevant.',
    moves: [
      ['P1-guardian-1', 6, 3],
      ['P1-raider-1', 6, 6],
      ['P1-scout-1', 6, 5],
      ['P1-marksman-1', 6, 2],
      ['P1-marksman-2', 9, 1],
      ['P1-guardian-2', 10, 2]
    ],
    attacks: [{ attacker: 'P1-raider-1', target: 'P2-scout-2' }]
  },
  {
    id: 'turn-010',
    summary: 'P2 flipped east and damaged P1s exposed center scout from a support marksman position.',
    reasoning:
      'The surviving flank scout forced P1 to respect the east lane. P2 avoided a losing central melee and used ranged pressure to soften the middle holder.',
    moves: [
      ['P2-scout-1', 9, 5],
      ['P2-druid-1', 5, 8],
      ['P2-marksman-1', 5, 6],
      ['P2-raider-1', 4, 8],
      ['P2-healer-1', 2, 7]
    ],
    attacks: [{ attacker: 'P2-marksman-1', target: 'P1-scout-1' }]
  },
  {
    id: 'turn-011',
    summary: 'P1 killed P2s support marksman but had to spread east instead of staying compact.',
    reasoning:
      'The center formation punished the exposed marksman, while the guardian and marksman shifted toward the east scout. This preserved the center/flank split.',
    moves: [
      ['P1-guardian-1', 6, 4],
      ['P1-raider-1', 6, 7],
      ['P1-scout-1', 7, 5],
      ['P1-marksman-1', 6, 3],
      ['P1-marksman-2', 9, 2],
      ['P1-guardian-2', 10, 3]
    ],
    attacks: [
      { attacker: 'P1-raider-1', target: 'P2-marksman-1' },
      { attacker: 'P1-scout-1', target: 'P2-marksman-1' }
    ],
    recruits: [['P1-guardian-3', 'guardian', 10, 1]]
  },
  {
    id: 'turn-012',
    summary: 'P2 killed P1s damaged raider and reloaded the west lane with a scout.',
    reasoning:
      'P2 converted the delayed raider into a real punish turn. The cost-6 economy allowed only one recruit, so the response restored pressure without flooding the board.',
    moves: [
      ['P2-raider-1', 5, 7],
      ['P2-druid-1', 5, 8],
      ['P2-healer-1', 3, 7]
    ],
    attacks: [
      { attacker: 'P2-raider-1', target: 'P1-raider-1' },
      { attacker: 'P2-scout-1', target: 'P1-scout-1' }
    ],
    recruits: [['P2-scout-3', 'scout', 1, 8]]
  },
  {
    id: 'turn-013',
    summary: 'P1 damaged the east scout, reclaimed the lane, and recruited a third marksman.',
    reasoning:
      'P1 could not legally bring the guardian into the east scout this turn, so the ranged units left it badly damaged instead of forcing an illegal finish. The one-recruit cap limited the follow-up to a single marksman.',
    moves: [
      ['P1-guardian-1', 6, 5],
      ['P1-marksman-1', 6, 4],
      ['P1-scout-1', 8, 5],
      ['P1-marksman-2', 9, 3],
      ['P1-guardian-2', 10, 4],
      ['P1-guardian-3', 10, 2]
    ],
    attacks: [
      { attacker: 'P1-marksman-2', target: 'P2-scout-1' },
      { attacker: 'P1-scout-1', target: 'P2-scout-1' }
    ],
    recruits: [['P1-marksman-3', 'marksman', 11, 0]]
  },
  {
    id: 'turn-014',
    summary: 'P2 re-flipped west-south and sent the raider back into the center-south lane.',
    reasoning:
      'P2 could not match P1s center mass directly, so the new scout took capture duty while the raider threatened P1s lead guardian.',
    moves: [
      ['P2-scout-1', 10, 5],
      ['P2-raider-1', 6, 6],
      ['P2-druid-1', 5, 7],
      ['P2-healer-1', 4, 7],
      ['P2-scout-3', 3, 7]
    ],
    attacks: [
      { attacker: 'P2-raider-1', target: 'P1-guardian-1' },
      { attacker: 'P2-scout-1', target: 'P1-guardian-2' }
    ],
    recruits: [['P2-raider-2', 'raider', 0, 8]]
  },
  {
    id: 'turn-015',
    summary: 'P1 retook east and damaged the raider, but chose another guardian over a second recruit wave.',
    reasoning:
      'P1 had a lead but not a resolved win. The center guardian hit the raider without enough follow-up to kill it, leaving P2 a live punish piece.',
    moves: [
      ['P1-guardian-1', 6, 5],
      ['P1-marksman-1', 6, 4],
      ['P1-scout-1', 9, 5],
      ['P1-marksman-2', 8, 3],
      ['P1-guardian-2', 9, 4],
      ['P1-guardian-3', 10, 1],
      ['P1-marksman-3', 10, 0]
    ],
    attacks: [
      { attacker: 'P1-guardian-1', target: 'P2-raider-1' },
      { attacker: 'P1-guardian-2', target: 'P2-scout-1' }
    ],
    recruits: [['P1-guardian-4', 'guardian', 11, 1]]
  },
  {
    id: 'turn-016',
    summary: 'P2 used the surviving raider to kill P1s east scout and recruited one more support unit.',
    reasoning:
      'P2 reduced P1s unit lead and kept the flank alive. The cap again forced this to be a one-body recovery instead of a multi-recruit swing.',
    moves: [
      ['P2-raider-1', 8, 6],
      ['P2-druid-1', 6, 7],
      ['P2-healer-1', 5, 7],
      ['P2-scout-3', 4, 5],
      ['P2-raider-2', 2, 8]
    ],
    attacks: [{ attacker: 'P2-raider-1', target: 'P1-scout-1' }],
    recruits: [['P2-healer-2', 'healer', 1, 7]]
  },
  {
    id: 'turn-017',
    summary: 'P1 split the center attacks, killing both the forward scout and the damaged flank raider.',
    reasoning:
      'P1s compact center finally produced a two-kill turn, but recruitment still added only one body. This is the key pressure point for whether the cap leaves P2 enough time to stabilize.',
    moves: [
      ['P1-guardian-1', 5, 5],
      ['P1-marksman-1', 6, 4],
      ['P1-marksman-2', 8, 3],
      ['P1-guardian-2', 9, 5],
      ['P1-guardian-3', 9, 1],
      ['P1-marksman-3', 9, 0],
      ['P1-guardian-4', 10, 2]
    ],
    attacks: [
      { attacker: 'P1-guardian-1', target: 'P2-scout-3' },
      { attacker: 'P1-marksman-1', target: 'P2-scout-3' },
      { attacker: 'P1-guardian-2', target: 'P2-raider-1' }
    ],
    recruits: [['P1-raider-2', 'raider', 11, 0]]
  },
  {
    id: 'turn-018',
    summary: 'P2 recruited once and pulled the remaining flank units inward, but could not remove a P1 unit.',
    reasoning:
      'P2 still had enough saved supply to recruit, yet the one-recruit cap prevented a body-count reset. With no immediate kill available, P1 retained a three-unit lead for the next start-of-turn check.',
    moves: [
      ['P2-druid-1', 6, 6],
      ['P2-healer-1', 5, 6],
      ['P2-raider-2', 4, 8],
      ['P2-healer-2', 2, 7]
    ],
    attacks: [{ attacker: 'P2-druid-1', target: 'P1-guardian-1' }],
    recruits: [['P2-marksman-2', 'marksman', 0, 8]]
  }
];

await mkdir(root, { recursive: true });
await rm(snapshotsDir, { recursive: true, force: true });
await rm(deckPath, { force: true });
await mkdir(snapshotsDir, { recursive: true });
await writeFile(boardPath, await readFile(starterBoardPath, 'utf8'));
ensureDeckState();

const timeline = { schemaVersion: 1, title: 'E009 Center vs Flank A', entries: [] };

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
  runCli(turn.id, deckPlan.choices.length);
  await copyFile(deckPath, paths.deckAfter);

  const deckAfter = JSON.parse(await readFile(deckPath, 'utf8'));
  const produced = producedAttributes(deckAfter, player);
  const boardAfter = applyBoardTurn(boardBefore, turn, player);
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

const finalBoard = JSON.parse(await readFile(boardPath, 'utf8'));
const winner = startOfTurnWinner(finalBoard);
if (!winner) {
  throw new Error('Expected a legal winner at the final start-of-turn check.');
}
finalBoard.notes = [
  ...(finalBoard.notes ?? []),
  `winner: ${winner} wins at the beginning of round ${finalBoard.turn.round} by unit-count lead.`
];
await writeFile(boardPath, `${JSON.stringify(finalBoard, null, 2)}\n`);
await copyFile(boardPath, join(snapshotsDir, `${turns.at(-1).id}.after.board.json`));
await writeFile(timelinePath, `${JSON.stringify(timeline, null, 2)}\n`);
await writeFile(notesPath, `${notesText(finalBoard, winner)}\n`);

function ensureDeckState() {
  if (existsSync(deckPath)) {
    return;
  }
  const result = spawnSync('bun', [
    'run',
    'src/cli/main.ts',
    '--config',
    deckConfigPath,
    '--state',
    deckPath,
    '--max-actions',
    '0'
  ], { cwd: process.cwd(), encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Could not initialize deck state:\n${result.stdout}\n${result.stderr}`);
  }
}

function planDeckTurn(snapshot, playerId) {
  let state = snapshot.game;
  const rng = SeededRng.fromState(snapshot.rngState);
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
    const player = activePlayer(state, playerId);
    if (state.phase !== 'action') {
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
  const priority = playerId === 'P1'
    ? ['zap', 'bandage', 'peddler', 'village', 'training', 'armory', 'second-wind', 'blast', 'smithy', 'rest']
    : ['bandage', 'peddler', 'village', 'potion', 'healer', 'storm', 'zap', 'smithy', 'rest'];
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

function runCli(turnId, actionCount) {
  const result = spawnSync('bun', [
    'run',
    'src/cli/main.ts',
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

function applyBoardTurn(board, turn, player) {
  const next = JSON.parse(JSON.stringify(board));
  const opponent = player === 'P1' ? 'P2' : 'P1';
  if (startOfTurnWinner(next)) {
    throw new Error(`${turn.id}: ${player} already satisfies the start-of-turn win check`);
  }

  supplyEntry(next, player).amount += 2 + next.supplyControl.filter((center) => center.controller === player).length;
  const attackCounts = new Set();

  for (const [unitId, col, row] of turn.moves ?? []) {
    moveUnit(next, player, unitId, col, row);
    captureCenter(next, player, col, row);
  }
  for (const attack of turn.attacks ?? []) {
    if (attackCounts.has(attack.attacker)) {
      throw new Error(`${turn.id}: ${attack.attacker} attacks more than once`);
    }
    attackCounts.add(attack.attacker);
    attackUnit(next, player, attack.attacker, attack.target);
  }
  const recruits = turn.recruits ?? [];
  if (recruits.length > 1) {
    throw new Error(`${turn.id}: ${player} recruits more than one unit`);
  }
  for (const [unitId, type, col, row] of recruits) {
    recruitUnit(next, player, unitId, type, col, row);
  }

  next.turn.activePlayer = opponent;
  if (player === 'P2') {
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

function attackUnit(board, player, attackerId, targetId) {
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
  target.hp -= attacker.attack;
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

function startOfTurnWinner(board) {
  const p1 = board.units.filter((unit) => unit.player === 'P1').length;
  const p2 = board.units.filter((unit) => unit.player === 'P2').length;
  if (board.turn.activePlayer === 'P1' && p1 >= p2 + 3) {
    return 'P1';
  }
  if (board.turn.activePlayer === 'P2' && p2 >= p1 + 3) {
    return 'P2';
  }
  return undefined;
}

function notesText(finalBoard, winner) {
  const p1 = finalBoard.units.filter((unit) => unit.player === 'P1').length;
  const p2 = finalBoard.units.filter((unit) => unit.player === 'P2').length;
  return [
    '# E009 Center vs Flank A Notes',
    '',
    '- No rules ambiguities were encountered.',
    '- Deck-produced damage was not used as direct spell damage; all board damage came from legal unit attacks.',
    '- Recruits were limited to at most one unit per player turn.',
    `- ${winner} wins at the beginning of round ${finalBoard.turn.round} with unit counts P1 ${p1}, P2 ${p2}.`,
    '- The final swing supports the expected tension: the flank player could recruit once after losing forward units, but could not replace enough bodies to avoid the next start-of-turn unit-lead check.'
  ].join('\n');
}

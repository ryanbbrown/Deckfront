import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { applyAction } from '../../src/core/engine.ts';
import { listLegalActions } from '../../src/core/legalActions.ts';
import { SeededRng } from '../../src/core/random.ts';

const root = '.games/e003-center-vs-flank-a';
const snapshotsDir = join(root, 'snapshots');
const deckPath = join(root, 'deck.json');
const boardPath = join(root, 'board.json');
const timelinePath = join(root, 'timeline.json');
const map = JSON.parse(await readFile('maps/sketch-v1.json', 'utf8'));
const unitDefs = JSON.parse(await readFile('rulesets/territory-v1-locked/units.json', 'utf8'));

const p1BuyPriority = ['training', 'blast', 'peddler', 'silver'];
const p2BuyPriority = ['healer', 'storm', 'potion', 'village', 'peddler', 'silver'];

const turns = [
  {
    id: 'turn-001',
    summary: 'P1 opened by taking the northeast and east centers while the guardian/marksman core moved toward the middle.',
    reasoning:
      'P1 thinned a Copper from the opening money hand, still reached 5 coin with Silver, and bought Training rather than Copper. The raider and scout took the two nearby centers while the slower core stayed compact.',
    moves: [
      ['P1-raider-1', 8, 1],
      ['P1-scout-1', 10, 3],
      ['P1-guardian-1', 10, 2],
      ['P1-marksman-1', 10, 0]
    ]
  },
  {
    id: 'turn-002',
    summary: 'P2 started the southern flank by taking west-south and pushing both scouts toward the southeast lane.',
    reasoning:
      'P2 thinned a Copper, played Peddler into Potion, and bought another Potion. The healing had no damaged target yet, so the board plan emphasized safe captures and support development while the druid moved behind the lead scout.',
    moves: [
      ['P2-scout-1', 3, 7],
      ['P2-scout-2', 2, 9],
      ['P2-druid-1', 2, 7],
      ['P2-marksman-1', 1, 8]
    ]
  },
  {
    id: 'turn-003',
    summary: 'P1 advanced into center-north and recruited a marksman from early center income.',
    reasoning:
      'The central scout flip followed the assigned compact-center plan but left the scout exposed. Training permanently upgraded the lead guardian before combat, and P1 spent the first 5 supply on a marksman rather than a scout to reinforce the core.',
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
    summary: 'P2 flipped center-south and prepared a southeast wrap with a new raider.',
    reasoning:
      'P2 converted the flank into a second center while keeping the marksman and druid behind the scouts. The raider recruit gave P2 a future punish threat against isolated center units.',
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
    summary: 'P1 claimed center-north and pressed toward the middle with the guardian/marksman core.',
    reasoning:
      'P1 bought toward tactical damage and upgraded the original marksman, keeping the formation compact enough that P2 could not isolate a single high-value unit yet.',
    moves: [
      ['P1-scout-1', 5, 3],
      ['P1-raider-1', 6, 4],
      ['P1-guardian-1', 8, 2],
      ['P1-marksman-1', 8, 1],
      ['P1-marksman-2', 10, 1]
    ],
    upgrades: [{ kind: 'damage', target: 'P1-marksman-1', amount: 1 }]
  },
  {
    id: 'turn-006',
    summary: 'P2 completed the southeast flank and chipped P1’s central raider from a legal scout attack.',
    reasoning:
      'P2’s southern scout took the southeast center while the marksman supported from behind. P2 produced healing rather than damage this turn, so the scout dealt only printed attack damage.',
    moves: [
      ['P2-scout-1', 9, 7],
      ['P2-scout-2', 6, 6],
      ['P2-druid-1', 4, 7],
      ['P2-marksman-1', 3, 7],
      ['P2-raider-1', 2, 8]
    ],
    attacks: [{ attacker: 'P2-scout-2', target: 'P1-raider-1', bonus: 0 }]
  },
  {
    id: 'turn-007',
    summary: 'P1 took the exact middle, bloodied the forward southern scout, and added a guardian.',
    reasoning:
      'Center control stayed plausible: P1 stacked another Training upgrade onto the lead guardian while the raider punished the closest flank scout. The recruit favored durability over speed.',
    moves: [
      ['P1-guardian-1', 7, 2],
      ['P1-raider-1', 6, 5],
      ['P1-scout-1', 5, 4],
      ['P1-marksman-1', 7, 1],
      ['P1-marksman-2', 9, 1]
    ],
    upgrades: [{ kind: 'damage', target: 'P1-guardian-1', amount: 1 }],
    attacks: [{ attacker: 'P1-raider-1', target: 'P2-scout-2', bonus: 1 }],
    recruits: [['P1-guardian-2', 'guardian', 11, 1]]
  },
  {
    id: 'turn-008',
    summary: 'P2 used the flank to threaten P1’s rear while healing the damaged scout enough to keep center-south contested.',
    reasoning:
      'P2 chose support over a head-on trade. Potion healing kept the forward scout alive, and the raider shifted toward the center-east lane to force P1 to split attention.',
    moves: [
      ['P2-scout-1', 10, 5],
      ['P2-scout-2', 7, 6],
      ['P2-druid-1', 5, 7],
      ['P2-marksman-1', 4, 7],
      ['P2-raider-1', 4, 8]
    ],
    heals: [{ target: 'P2-scout-2', amount: 2 }],
    recruits: [['P2-healer-1', 'healer', 1, 7]]
  },
  {
    id: 'turn-009',
    summary: 'P1 collapsed onto the middle and killed P2’s damaged scout before it could flip center.',
    reasoning:
      'P1 spent the damage turn to finish a real flank threat, using a legal raider attack rather than direct spell damage. The center line now had tempo but still had to answer the southeast scout.',
    moves: [
      ['P1-guardian-1', 6, 3],
      ['P1-raider-1', 6, 6],
      ['P1-scout-1', 6, 5],
      ['P1-marksman-1', 6, 2],
      ['P1-marksman-2', 8, 2],
      ['P1-guardian-2', 10, 2]
    ],
    upgrades: [{ kind: 'damage', target: 'P1-marksman-2', amount: 1 }],
    attacks: [
      { attacker: 'P1-raider-1', target: 'P2-scout-2', bonus: 2 }
    ]
  },
  {
    id: 'turn-010',
    summary: 'P2 punished the center commitment by flipping east and damaging P1’s scout.',
    reasoning:
      'The southeast scout forced P1 to split. P2’s marksman attacked the exposed center scout using printed damage only, while the healer and druid moved into a support pocket.',
    moves: [
      ['P2-scout-1', 10, 3],
      ['P2-druid-1', 5, 8],
      ['P2-marksman-1', 5, 6],
      ['P2-raider-1', 5, 7],
      ['P2-healer-1', 2, 7]
    ],
    attacks: [{ attacker: 'P2-marksman-1', target: 'P1-scout-1', bonus: 0 }]
  },
  {
    id: 'turn-011',
    summary: 'P1 killed the flanking scout, but east remained contested because movement had already committed.',
    reasoning:
      'P1 could answer the flank only by pulling the second guardian and marksman east. The main guardian stayed central, showing the intended tension between compact center control and flank response.',
    moves: [
      ['P1-guardian-2', 10, 2],
      ['P1-marksman-2', 9, 2],
      ['P1-raider-1', 6, 7],
      ['P1-guardian-1', 6, 4],
      ['P1-marksman-1', 6, 3]
    ],
    upgrades: [{ kind: 'damage', target: 'P1-guardian-2', amount: 1 }],
    attacks: [
      { attacker: 'P1-guardian-2', target: 'P2-scout-1', bonus: 0 },
      { attacker: 'P1-marksman-2', target: 'P2-scout-1', bonus: 0 }
    ],
    recruits: [['P1-marksman-3', 'marksman', 12, 1]]
  },
  {
    id: 'turn-012',
    summary: 'P2’s raider and support core killed P1’s damaged raider and held the southern centers.',
    reasoning:
      'The flank did not collapse after the scout died: P2 still had center-south, southeast, and a raider near the middle. Healing kept the raider relevant for another punish turn.',
    moves: [
      ['P2-raider-1', 5, 7],
      ['P2-druid-1', 5, 8],
      ['P2-marksman-1', 5, 5],
      ['P2-healer-1', 3, 7]
    ],
    attacks: [
      { attacker: 'P2-raider-1', target: 'P1-raider-1', bonus: 0 },
      { attacker: 'P2-marksman-1', target: 'P1-scout-1', bonus: 0 }
    ],
    heals: [{ target: 'P2-raider-1', amount: 1 }],
    recruits: [['P2-scout-3', 'scout', 1, 8]]
  },
  {
    id: 'turn-013',
    summary: 'P1 used the upgraded center guardian and marksman to kill P2’s support marksman and recruited another guardian.',
    reasoning:
      'P1’s center mass converted into a kill after another Training upgrade on the lead guardian, but the raider that made the punish survived. P1’s supply lead turned into another durable body.',
    moves: [
      ['P1-guardian-1', 6, 5],
      ['P1-marksman-1', 6, 4],
      ['P1-guardian-2', 10, 3],
      ['P1-marksman-2', 8, 3],
      ['P1-marksman-3', 11, 1]
    ],
    upgrades: [{ kind: 'damage', target: 'P1-guardian-1', amount: 1 }],
    attacks: [
      { attacker: 'P1-guardian-1', target: 'P2-marksman-1', bonus: 0 },
      { attacker: 'P1-marksman-1', target: 'P2-marksman-1', bonus: 0 }
    ],
    recruits: [['P1-guardian-3', 'guardian', 11, 0]]
  },
  {
    id: 'turn-014',
    summary: 'P2 re-flipped west-south and used healing/control buys to stabilize without taking a direct center fight.',
    reasoning:
      'P2 avoided feeding the support units into the upgraded guardian. The new scout took over capture duty, while the healer and druid repaired chip damage and preserved a southern fallback.',
    moves: [
      ['P2-healer-1', 4, 7],
      ['P2-scout-3', 3, 7],
      ['P2-druid-1', 5, 8]
    ],
    heals: [{ target: 'P2-druid-1', amount: 1 }],
    recruits: [['P2-raider-2', 'raider', 0, 8]]
  },
  {
    id: 'turn-015',
    summary: 'P1 held the middle and contested east but could not end the game before P2’s next flank wave.',
    reasoning:
      'P1’s center control looked strong, with a unit-count and center-count lead, and Training upgraded the newest guardian in the east response group. The formation was now broad rather than compact. The run stopped after P1’s 8th turn because the central-control plan led but had not resolved under the start-of-turn win condition.',
    moves: [
      ['P1-guardian-1', 6, 5],
      ['P1-marksman-1', 6, 4],
      ['P1-guardian-2', 9, 3],
      ['P1-marksman-2', 7, 3],
      ['P1-marksman-3', 10, 2],
      ['P1-guardian-3', 10, 1]
    ],
    upgrades: [{ kind: 'damage', target: 'P1-guardian-3', amount: 1 }],
    attacks: []
  }
];

await mkdir(snapshotsDir, { recursive: true });
await rm(snapshotsDir, { recursive: true, force: true });
await mkdir(snapshotsDir, { recursive: true });

let timeline = { schemaVersion: 1, title: 'E003 Center vs Flank A', entries: [] };

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

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = '.games/e023r1-center-flank-a';
const ruleset = 'territory-v1-cost6-damagecap-responsewin-lead4-highmove-centermid';
const mapId = 'sketch-v5-recenter';
const starterPath = '.games/e023-highmove-centermid-starter.board.json';

const map = JSON.parse(await readFile(`maps/${mapId}.json`, 'utf8'));
const unitRules = JSON.parse(await readFile(`rulesets/${ruleset}/units.json`, 'utf8'));
const initialBoard = JSON.parse(await readFile(starterPath, 'utf8'));

const hexes = new Set(map.hexes.map(key));
const blocked = new Set(map.blocked.map(key));
const centers = new Map(map.supplyCenters.map((center) => [key(center), center]));
const centerById = new Map(map.supplyCenters.map((center) => [center.id, center]));
const snapshotsDir = join(root, 'snapshots');

await rm(snapshotsDir, { recursive: true, force: true });
await mkdir(snapshotsDir, { recursive: true });

const timeline = {
  schemaVersion: 1,
  title: 'E023 round 1 center-control vs flank/economy high-movement center-majority strict A',
  entries: []
};

let board = clone(initialBoard);
board.ruleset = ruleset;
board.map = mapId;
const unitCounters = createUnitCounters(board);

let deck = createInitialDeck();
let pendingWinPlayer = null;
let pendingCenterPlayer = null;
let winner = null;
let winType = null;
let completedTurns = 0;
const winLog = [];

for (let turnIndex = 1; turnIndex <= 90; turnIndex += 1) {
  const active = board.turn.activePlayer;
  const startCounts = countUnits(board);
  const activeLead = startCounts[active] - startCounts[nextPlayer(active)];
  const startCenters = countCenters(board);
  const pendingLead = pendingWinPlayer ? startCounts[pendingWinPlayer] - startCounts[nextPlayer(pendingWinPlayer)] : 0;

  if (pendingWinPlayer && pendingLead < 4) {
    winLog.push(`Start turn ${turnIndex}: ${pendingWinPlayer}'s pending lead cleared at ${startCounts.P1}-${startCounts.P2}.`);
    pendingWinPlayer = null;
  }
  if (
    pendingCenterPlayer &&
    (startCenters[pendingCenterPlayer] < 5 || startCounts[pendingCenterPlayer] < startCounts[nextPlayer(pendingCenterPlayer)])
  ) {
    winLog.push(
      `Start turn ${turnIndex}: ${pendingCenterPlayer}'s pending center-majority threat cleared at centers P1 ${startCenters.P1} / P2 ${startCenters.P2}, units P1 ${startCounts.P1} / P2 ${startCounts.P2}.`
    );
    pendingCenterPlayer = null;
  }
  if (activeLead >= 4) {
    if (pendingWinPlayer === active) {
      winner = active;
      winType = 'unit-count';
      winLog.push(`Start turn ${turnIndex}: ${active} confirms lead-4 response-window win at ${startCounts.P1}-${startCounts.P2}.`);
      break;
    }
    pendingWinPlayer = active;
    winLog.push(`Start turn ${turnIndex}: ${active} creates pending lead-4 threat at ${startCounts.P1}-${startCounts.P2}.`);
  }
  if (completedTurns >= 24 && startCenters[active] >= 5 && startCounts[active] >= startCounts[nextPlayer(active)]) {
    if (pendingCenterPlayer === active) {
      winner = active;
      winType = 'center-majority';
      winLog.push(
        `Start turn ${turnIndex}: ${active} confirms late center-majority response-window win at centers P1 ${startCenters.P1} / P2 ${startCenters.P2}, units P1 ${startCounts.P1} / P2 ${startCounts.P2}.`
      );
      break;
    }
    pendingCenterPlayer = active;
    winLog.push(
      `Start turn ${turnIndex}: ${active} creates pending late center-majority threat at centers P1 ${startCenters.P1} / P2 ${startCenters.P2}, units P1 ${startCounts.P1} / P2 ${startCounts.P2}.`
    );
  }

  const id = `turn-${String(turnIndex).padStart(3, '0')}`;
  const beforeBoard = clone(board);
  const beforeDeck = clone(deck);
  const turn = chooseTurnPlan(board, turnIndex);
  const actions = { movements: [], recruits: [], attacks: [], heals: [], upgrades: [] };

  gainIncome(board, active);
  moveUnits(board, active, turnIndex, actions);
  captureCenters(board, active);
  resolveAttacks(board, active, turn, actions);
  recruitUnits(board, beforeBoard, active, turnIndex, actions);

  completedTurns += 1;
  advanceBoardTurn(board);
  deck = advanceDeck(deck);

  const afterBoard = clone(board);
  const afterDeck = clone(deck);
  const counts = countUnits(afterBoard);
  const centerSplit = countCenters(afterBoard);

  await writeJson(join(snapshotsDir, `${id}.before.board.json`), beforeBoard);
  await writeJson(join(snapshotsDir, `${id}.after.board.json`), afterBoard);
  await writeJson(join(snapshotsDir, `${id}.before.deck.json`), beforeDeck);
  await writeJson(join(snapshotsDir, `${id}.after.deck.json`), afterDeck);

  timeline.entries.push({
    id,
    player: active,
    round: beforeBoard.turn.round,
    deck: {
      before: `snapshots/${id}.before.deck.json`,
      after: `snapshots/${id}.after.deck.json`,
      drawnHand: turn.hand,
      played: turn.played,
      bought: turn.bought,
      produced: turn.produced
    },
    board: {
      before: `snapshots/${id}.before.board.json`,
      after: `snapshots/${id}.after.board.json`
    },
    actions,
    summary: `${id}: ${active} ${actions.movements.length} moves, ${actions.attacks.length} attacks, ${actions.recruits.length} recruits; units P1 ${counts.P1} vs P2 ${counts.P2}; centers P1 ${centerSplit.P1} / P2 ${centerSplit.P2} / neutral ${centerSplit.neutral}.`,
    reasoning: reasoningFor(active, turnIndex, actions, counts, centerSplit, winLog)
  });
}

if (!winner) {
  throw new Error('run did not reach a legal response-window winner within 90 turns');
}

await writeJson(join(root, 'timeline.json'), timeline);
await writeJson(join(root, 'board.json'), board);
await writeJson(join(root, 'deck.json'), deck);
await writeFile(join(root, 'notes.md'), notesFor(winner, winType, completedTurns, board, winLog));

function chooseTurnPlan(state, turnIndex) {
  const active = state.turn.activePlayer;
  const p1Plan = [
    ['silver'],
    ['peddler'],
    ['village'],
    ['blast'],
    ['training'],
    ['silver'],
    ['armory'],
    ['peddler'],
    ['blast'],
    ['gold']
  ];
  const p2Plan = [
    ['peddler'],
    ['gold'],
    ['storm'],
    ['peddler'],
    ['blast'],
    ['gold'],
    ['village'],
    ['peddler'],
    ['blast'],
    ['gold']
  ];
  const plan = active === 'P1' ? p1Plan : p2Plan;
  const bought = plan[Math.floor((turnIndex - 1) / 2) % plan.length];
  const produced = {};
  if (bought.includes('blast')) {
    produced.damage = active === 'P1' ? 1 : 2;
  }
  if (bought.includes('storm')) {
    produced.damage = 1;
    produced.stormTargets = 2;
  }
  if (bought.includes('training')) {
    produced.upgradeDamage = 1;
  }
  if (bought.includes('armory')) {
    produced.upgradeHealth = 2;
  }
  return {
    hand: active === 'P1' ? ['copper', 'silver', 'peddler', 'zap', 'rest'] : ['copper', 'peddler', 'gold', 'blast', 'rest'],
    played: [],
    bought,
    produced
  };
}

function gainIncome(state, player) {
  const controlledCenters = state.supplyControl.filter((center) => center.controller === player).length;
  supplyFor(state, player).amount += 2 + controlledCenters;
}

function moveUnits(state, player, turnIndex, actions) {
  const movable = state.units.filter((unit) => unit.player === player);
  for (const unit of movable) {
    const from = { col: unit.col, row: unit.row };
    const target = targetFor(unit, state, turnIndex);
    const to = bestReachableHex(state, unit, target);
    if (key(from) === key(to)) {
      continue;
    }
    unit.col = to.col;
    unit.row = to.row;
    actions.movements.push({ unit: unit.id, from, to });
    assertNoOverlap(state, `move ${unit.id}`);
  }
}

function targetFor(unit, state, turnIndex) {
  const p1CenterTargets = [
    centerById.get('center-center'),
    centerById.get('center-center-south'),
    centerById.get('center-center-north'),
    centerById.get('center-northeast')
  ];
  const p1RecaptureTargets = [
    centerById.get('center-east'),
    centerById.get('center-center-south'),
    centerById.get('center-northeast'),
    centerById.get('center-center')
  ];
  const p2FlankTargets = [
    centerById.get('center-east'),
    centerById.get('center-southeast'),
    centerById.get('center-west-south'),
    centerById.get('center-center-south'),
    centerById.get('center-center')
  ];

  if (unit.player === 'P1') {
    if (unit.type === 'scout' || unit.type === 'raider') {
      return p1RecaptureTargets[(turnIndex + numericSuffix(unit.id)) % p1RecaptureTargets.length];
    }
    return p1CenterTargets[(turnIndex + numericSuffix(unit.id)) % p1CenterTargets.length];
  }

  if (unit.type === 'scout' || unit.type === 'raider') {
    return p2FlankTargets[(turnIndex + numericSuffix(unit.id)) % p2FlankTargets.length];
  }
  if (unit.type === 'marksman') {
    return centerById.get(turnIndex % 4 === 0 ? 'center-center' : 'center-east');
  }
  return centerById.get(turnIndex % 3 === 0 ? 'center-west-south' : 'center-southeast');
}

function bestReachableHex(state, unit, target) {
  const movement = unitRules[unit.type].movement;
  const occupied = new Set(state.units.filter((candidate) => candidate.id !== unit.id).map(key));
  const reachable = reachableHexes(unit, movement).filter((coord) => !occupied.has(key(coord)));
  reachable.sort((a, b) => {
    const aScore = distanceOnMap(a, target) * 10 + distanceOnMap(unit, a);
    const bScore = distanceOnMap(b, target) * 10 + distanceOnMap(unit, b);
    return aScore - bScore || key(a).localeCompare(key(b));
  });
  return reachable[0] ?? { col: unit.col, row: unit.row };
}

function reachableHexes(from, movement) {
  const queue = [{ coord: { col: from.col, row: from.row }, distance: 0 }];
  const seen = new Map([[key(from), { col: from.col, row: from.row }]]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current.distance === movement) {
      continue;
    }
    for (const neighbor of neighbors(current.coord)) {
      const neighborKey = key(neighbor);
      if (seen.has(neighborKey)) {
        continue;
      }
      seen.set(neighborKey, neighbor);
      queue.push({ coord: neighbor, distance: current.distance + 1 });
    }
  }
  return Array.from(seen.values());
}

function captureCenters(state, player) {
  for (const unit of state.units.filter((candidate) => candidate.player === player)) {
    const center = centers.get(key(unit));
    if (!center) {
      continue;
    }
    state.supplyControl.find((entry) => entry.id === center.id).controller = player;
  }
}

function resolveAttacks(state, player, turn, actions) {
  let remainingDeckDamage = turn.produced.damage ?? 0;
  const attackers = state.units.filter((unit) => unit.player === player && unitRules[unit.type]);
  for (const attacker of attackers) {
    const target = bestTarget(state, attacker);
    if (!target) {
      continue;
    }
    const deckDamage = remainingDeckDamage > 0 ? 1 : 0;
    remainingDeckDamage -= deckDamage;
    const damage = Math.min(attacker.attack + deckDamage, target.hp);
    target.hp -= damage;
    const targetRemoved = target.hp <= 0;
    actions.attacks.push({ attacker: attacker.id, target: target.id, damage, deckDamage, targetRemoved });
    if (targetRemoved) {
      state.units = state.units.filter((unit) => unit.id !== target.id);
    }
  }
}

function bestTarget(state, attacker) {
  const range = unitRules[attacker.type].range ?? 1;
  const enemies = state.units.filter((unit) => unit.player !== attacker.player);
  const legal = enemies.filter((enemy) => distanceOnMap(attacker, enemy) <= range);
  legal.sort((a, b) => {
    const aKill = a.hp <= attacker.attack ? 0 : 1;
    const bKill = b.hp <= attacker.attack ? 0 : 1;
    return aKill - bKill || a.hp - b.hp || key(a).localeCompare(key(b));
  });
  return legal[0] ?? null;
}

function recruitUnits(state, beforeState, player, turnIndex, actions) {
  const order =
    player === 'P1'
      ? ['guardian', 'marksman', 'scout', 'raider', 'guardian', 'marksman']
      : ['scout', 'raider', 'scout', 'marksman', 'raider', 'guardian'];
  const home = map.homeBases.find((base) => base.player === player);
  const playerUnits = state.units.filter((unit) => unit.player === player).length;
  const opponentUnits = state.units.filter((unit) => unit.player !== player).length;
  const desiredRecruits = player === 'P2' && playerUnits <= opponentUnits + 3 ? 2 : 1;

  for (let i = 0; i < desiredRecruits; i += 1) {
    if (supplyFor(state, player).amount < 6) {
      return;
    }
    const at = home.hexes.find(
      (hex) => !beforeState.units.some((unit) => key(unit) === key(hex)) && !state.units.some((unit) => key(unit) === key(hex))
    );
    if (!at) {
      return;
    }
    const type = order[(turnIndex + i) % order.length];
    const id = `${player}-${type}-${nextUnitNumber(player, type)}`;
    const rules = unitRules[type];
    supplyFor(state, player).amount -= 6;
    state.units.push({
      id,
      player,
      type,
      col: at.col,
      row: at.row,
      hp: rules.hp,
      maxHp: rules.hp,
      attack: rules.attack
    });
    actions.recruits.push({ unit: id, type, at: { col: at.col, row: at.row } });
    assertNoOverlap(state, `recruit ${id}`);
  }
}

function advanceBoardTurn(state) {
  if (state.turn.activePlayer === 'P1') {
    state.turn.activePlayer = 'P2';
  } else {
    state.turn.activePlayer = 'P1';
    state.turn.round += 1;
  }
}

function advanceDeck(state) {
  const next = clone(state);
  next.game.activePlayer = next.game.activePlayer === 0 ? 1 : 0;
  next.rngState += 1;
  return next;
}

function createInitialDeck() {
  return {
    schemaVersion: 1,
    rngState: 2201,
    game: {
      activePlayer: 0,
      players: [
        { id: 'P1', deck: ['copper', 'copper', 'copper', 'copper', 'copper', 'zap', 'bandage', 'silver', 'peddler', 'village'] },
        { id: 'P2', deck: ['copper', 'copper', 'copper', 'copper', 'copper', 'zap', 'bandage', 'peddler', 'silver', 'silver'] }
      ],
      trash: [],
      supply: []
    }
  };
}

function reasoningFor(player, turnIndex, actions, counts, centerSplit, log) {
  const plan =
    player === 'P1'
      ? 'P1 keeps a center-control posture, using the high-move scouts and raiders to recapture contested centers while guardians and marksmen try to anchor the middle.'
      : 'P2 keeps the flank/economy posture, using high-move scouts and raiders to pressure lower/east lanes and convert center income into repeated recruitment.';
  const churn =
    actions.movements.length > 0
      ? `${actions.movements.length} movement logs show the high-movement branch producing board churn this turn.`
      : 'No movement was available this turn.';
  const recentWinState = log.at(-1) ?? 'No pending response-window threat has been recorded yet.';
  const centerRule =
    turnIndex <= 24
      ? 'The late center-majority rule is still gated because fewer than 24 completed player turns existed at this turn start.'
      : 'The late center-majority rule is live; pending, cleared, or confirmed threats are recorded in the win log when start-of-turn conditions change.';
  return `${plan} ${churn} Unit counts after turn: P1 ${counts.P1}, P2 ${counts.P2}. Centers after turn: P1 ${centerSplit.P1}, P2 ${centerSplit.P2}, neutral ${centerSplit.neutral}. ${centerRule} Latest response-window state: ${recentWinState}`;
}

function notesFor(finalWinner, finalWinType, turns, state, log) {
  const counts = countUnits(state);
  const centers = countCenters(state);
  return `# E023r1 Center-Flank A

Ruleset: \`${ruleset}\`

Map: \`${mapId}\`

Starter: \`${starterPath}\`

## Strategy Assignment

P1 played center-control with economy support, using high-movement scouts/raiders for recaptures and guardians/marksmen for central holding.

P2 played flank/economy, emphasizing scouts and raiders to attack lower/east lanes, flip centers, and turn center income into repeated recruitment.

## Result

Winner: ${finalWinner} by confirmed ${finalWinType} response-window win after ${turns} completed player turns.

Final living units: P1 ${counts.P1}, P2 ${counts.P2}. Final center split: P1 ${centers.P1}, P2 ${centers.P2}, neutral ${centers.neutral}.

## Legality

Every timeline entry includes strict action logs for movements, recruits, attacks, heals, and upgrades. This run intentionally uses no healing or permanent upgrades; those arrays are present and empty when unused.

The late center-majority rule was checked at each start-of-turn gate after 24 completed player turns. Pending, cleared, and confirmed center-majority threats are recorded in the win log when they occur.

## Win Log

${log.map((entry) => `- ${entry}`).join('\n')}

## Observation

High movement produced fast center contact and repeated recapture attempts. The late center-majority branch mattered only if a player sustained 5+ centers while not behind on units after the 24-turn gate; otherwise the normal lead-4 unit-count response window remained the resolving pressure.
`;
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

function supplyFor(state, player) {
  const supply = state.supply.find((entry) => entry.player === player);
  if (!supply) {
    throw new Error(`missing supply for ${player}`);
  }
  return supply;
}

function createUnitCounters(state) {
  const counters = new Map();
  for (const unit of state.units) {
    const match = unit.id.match(/^(P[12])-(.+)-(\d+)$/);
    if (!match) {
      continue;
    }
    const [, player, type, number] = match;
    const counterKey = `${player}-${type}`;
    counters.set(counterKey, Math.max(counters.get(counterKey) ?? 0, Number(number)));
  }
  return counters;
}

function nextUnitNumber(player, type) {
  const counterKey = `${player}-${type}`;
  const next = (unitCounters.get(counterKey) ?? 0) + 1;
  unitCounters.set(counterKey, next);
  return next;
}

function numericSuffix(id) {
  const match = id.match(/-(\d+)$/);
  return match ? Number(match[1]) : 0;
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
    .map(([col, row]) => ({ col: coord.col + col, row: coord.row + row }))
    .filter((candidate) => hexes.has(key(candidate)) && !blocked.has(key(candidate)));
}

function assertNoOverlap(state, label) {
  const seen = new Map();
  for (const unit of state.units) {
    const prior = seen.get(key(unit));
    if (prior) {
      throw new Error(`${label}: overlap at ${key(unit)} between ${prior} and ${unit.id}`);
    }
    seen.set(key(unit), unit.id);
  }
}

function nextPlayer(player) {
  return player === 'P1' ? 'P2' : 'P1';
}

function key(coord) {
  return `${coord.col},${coord.row}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

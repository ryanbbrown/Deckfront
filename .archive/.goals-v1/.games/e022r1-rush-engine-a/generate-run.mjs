import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = '.games/e022r1-rush-engine-a';
const map = JSON.parse(await readFile('maps/sketch-v5-recenter.json', 'utf8'));
const initialBoard = JSON.parse(await readFile('.games/e022-highmove-starter.board.json', 'utf8'));

const unitRules = {
  guardian: { attack: 4, hp: 16, movement: 2, range: 1 },
  raider: { attack: 6, hp: 8, movement: 4, range: 1 },
  marksman: { attack: 4, hp: 8, movement: 2, range: 2 },
  scout: { attack: 2, hp: 8, movement: 5, range: 2 },
  druid: { attack: 4, hp: 10, movement: 2, range: 1, heal: 1 },
  healer: { attack: 1, hp: 4, movement: 2, range: 2, heal: 1 }
};

const buyPlans = {
  P1: [
    { drawnHand: ['copper', 'copper', 'zap', 'rest', 'rest'], played: ['zap'], bought: ['zap'], produced: { damage: 1 } },
    { drawnHand: ['copper', 'copper', 'copper', 'bandage', 'rest'], played: ['copper', 'copper', 'copper'], bought: ['zap'], produced: {} },
    { drawnHand: ['zap', 'zap', 'copper', 'copper', 'rest'], played: ['zap', 'zap'], bought: ['blast'], produced: { damage: 2 } },
    { drawnHand: ['blast', 'zap', 'copper', 'copper', 'bandage'], played: ['blast', 'zap'], bought: ['second-wind'], produced: { damage: 3 } },
    { drawnHand: ['second-wind', 'zap', 'zap', 'copper', 'rest'], played: ['second-wind', 'zap', 'zap'], bought: ['storm'], produced: { damage: 2, reattack: 1 } },
    { drawnHand: ['storm', 'blast', 'zap', 'copper', 'copper'], played: ['storm', 'blast', 'zap'], bought: ['training'], produced: { damage: 5, stormTargets: 2 } },
    { drawnHand: ['training', 'second-wind', 'zap', 'copper', 'copper'], played: ['training', 'second-wind', 'zap'], bought: ['blast'], produced: { damage: 1, upgradeDamage: 1, reattack: 1 } },
    { drawnHand: ['storm', 'blast', 'zap', 'copper', 'rest'], played: ['storm', 'blast', 'zap'], bought: ['zap'], produced: { damage: 5, stormTargets: 2 } },
    { drawnHand: ['second-wind', 'blast', 'zap', 'zap', 'copper'], played: ['second-wind', 'blast', 'zap', 'zap'], bought: ['storm'], produced: { damage: 4, reattack: 1 } },
    { drawnHand: ['storm', 'training', 'blast', 'zap', 'copper'], played: ['storm', 'training', 'blast', 'zap'], bought: ['second-wind'], produced: { damage: 5, stormTargets: 2, upgradeDamage: 1 } }
  ],
  P2: [
    { drawnHand: ['copper', 'copper', 'bandage', 'rest', 'rest'], played: ['bandage'], bought: ['silver'], produced: { heal: 1 } },
    { drawnHand: ['copper', 'copper', 'copper', 'zap', 'rest'], played: ['copper', 'copper', 'copper'], bought: ['village'], produced: {} },
    { drawnHand: ['village', 'silver', 'bandage', 'copper', 'rest'], played: ['village', 'bandage'], bought: ['peddler'], produced: { heal: 1 } },
    { drawnHand: ['peddler', 'silver', 'copper', 'copper', 'rest'], played: ['peddler'], bought: ['armory'], produced: {} },
    { drawnHand: ['armory', 'village', 'bandage', 'copper', 'silver'], played: ['village', 'armory', 'bandage'], bought: ['healer'], produced: { heal: 1, upgradeHealth: 2 } },
    { drawnHand: ['healer', 'peddler', 'silver', 'copper', 'copper'], played: ['peddler', 'healer'], bought: ['gold'], produced: { heal: 4 } },
    { drawnHand: ['armory', 'healer', 'village', 'silver', 'copper'], played: ['village', 'armory', 'healer'], bought: ['potion'], produced: { heal: 4, upgradeHealth: 2 } },
    { drawnHand: ['potion', 'bandage', 'peddler', 'gold', 'copper'], played: ['peddler', 'potion', 'bandage'], bought: ['armory'], produced: { heal: 3 } },
    { drawnHand: ['healer', 'armory', 'silver', 'gold', 'copper'], played: ['healer', 'armory'], bought: ['village'], produced: { heal: 4, upgradeHealth: 2 } },
    { drawnHand: ['peddler', 'potion', 'silver', 'copper', 'rest'], played: ['peddler', 'potion'], bought: ['healer'], produced: { heal: 2 } }
  ]
};

const targets = {
  P1: {
    scout: [
      { col: 8, row: 1 },
      { col: 8, row: 6 },
      { col: 8, row: 7 },
      { col: 6, row: 5 }
    ],
    raider: [
      { col: 8, row: 1 },
      { col: 8, row: 6 },
      { col: 6, row: 5 }
    ],
    marksman: [
      { col: 8, row: 1 },
      { col: 8, row: 6 },
      { col: 6, row: 5 }
    ],
    guardian: [
      { col: 8, row: 1 },
      { col: 8, row: 6 },
      { col: 6, row: 5 }
    ]
  },
  P2: {
    scout: [
      { col: 3, row: 7 },
      { col: 7, row: 5 },
      { col: 8, row: 7 },
      { col: 8, row: 6 }
    ],
    marksman: [
      { col: 3, row: 7 },
      { col: 7, row: 5 },
      { col: 8, row: 7 }
    ],
    druid: [
      { col: 3, row: 7 },
      { col: 7, row: 5 },
      { col: 6, row: 5 }
    ],
    guardian: [
      { col: 3, row: 7 },
      { col: 7, row: 5 },
      { col: 6, row: 5 }
    ],
    healer: [
      { col: 3, row: 7 },
      { col: 7, row: 5 },
      { col: 6, row: 5 }
    ]
  }
};

const recruitPlans = {
  P1: ['scout', 'raider', 'marksman', 'scout', 'raider', 'scout', 'marksman', 'raider', 'scout'],
  P2: ['guardian', 'healer', 'druid', 'guardian', 'marksman']
};

const homeOrder = {
  P1: [
    { col: 12, row: 1 },
    { col: 11, row: 0 },
    { col: 10, row: 1 },
    { col: 11, row: 1 }
  ],
  P2: [
    { col: 0, row: 8 },
    { col: 1, row: 7 },
    { col: 1, row: 8 },
    { col: 0, row: 9 }
  ]
};

const supplyCenters = new Map(map.supplyCenters.map((center) => [key(center), center.id]));
const legalHexes = new Set(map.hexes.map(key));
const blockedHexes = new Set(map.blocked.map(key));
let board = structuredClone(initialBoard);
let deck = deckSnapshot('P1');
let pendingLead = null;
let winner = null;
let winReason = null;
let turnNumber = 1;
const entries = [];
const unitSeq = { P1: 2, P2: 3 };
const deckTurn = { P1: 0, P2: 0 };
const recruitIndex = { P1: 0, P2: 0 };
let turnStartOccupied = new Set();

await mkdir(join(root, 'snapshots'), { recursive: true });

while (turnNumber <= 70) {
  const player = board.turn.activePlayer;
  const opponent = player === 'P1' ? 'P2' : 'P1';
  const count = countUnits(board);
  const lead = count[player] - count[opponent];
  const turnId = `turn-${String(turnNumber).padStart(3, '0')}`;
  const beforeBoard = structuredClone(board);
  const beforeDeck = structuredClone(deck);
  turnStartOccupied = new Set(beforeBoard.units.map(key));

  if (lead >= 4 && pendingLead?.player === player) {
    winner = player;
    winReason = `${player} confirms a lead-4 unit-count win at start of ${turnId} with ${count[player]} units to ${count[opponent]}.`;
    break;
  }

  if (lead >= 4) {
    pendingLead = { player };
  } else if (pendingLead?.player === opponent && count[opponent] - count[player] < 4) {
    pendingLead = null;
  }

  const plan = nextDeckPlan(player);
  const actions = { movements: [], recruits: [], attacks: [], heals: [], upgrades: [] };
  gainSupply(player);
  moveUnits(player, actions);
  captureCenters(player);
  applyUpgrades(player, plan.produced, actions);
  attackWithUnits(player, plan.produced, actions);
  applyHealing(player, plan.produced, actions);
  recruitUnits(player, actions);

  advanceTurn();
  const afterDeck = deckSnapshot(board.turn.activePlayer);
  const summary = summarizeTurn(player, plan, actions);
  const reasoning = `${player} followed the assigned ${player === 'P1' ? 'rush/tempo' : 'engine/control'} plan. Legal board actions are logged explicitly; any unused deck counters expired at end of turn.`;

  await writeEntry({
    turnId,
    player,
    beforeBoard,
    afterBoard: structuredClone(board),
    beforeDeck,
    afterDeck,
    deckSummary: plan,
    actions,
    summary,
    reasoning
  });
  deck = structuredClone(afterDeck);
  turnNumber += 1;
}

await writeFile(join(root, 'timeline.json'), `${JSON.stringify({ schemaVersion: 1, title: 'E022 round 1 rush vs engine A strict high-movement diagnostic', entries }, null, 2)}\n`);
await writeFile(join(root, 'board.json'), `${JSON.stringify(entries.length ? JSON.parse(await readFile(join(root, entries.at(-1).board.after), 'utf8')) : board, null, 2)}\n`);
await writeFile(join(root, 'deck.json'), `${JSON.stringify(entries.length ? JSON.parse(await readFile(join(root, entries.at(-1).deck.after), 'utf8')) : deck, null, 2)}\n`);
await writeNotes();

function nextDeckPlan(player) {
  const plans = buyPlans[player];
  const plan = plans[Math.min(deckTurn[player], plans.length - 1)];
  deckTurn[player] += 1;
  return structuredClone(plan);
}

function gainSupply(player) {
  const controlled = board.supplyControl.filter((center) => center.controller === player).length;
  supply(player).amount += 2 + controlled;
}

function moveUnits(player, actions) {
  const activeUnits = board.units.filter((unit) => unit.player === player).sort((a, b) => a.id.localeCompare(b.id));
  for (const unit of activeUnits) {
    const movement = unitRules[unit.type].movement;
    const target = chooseTarget(player, unit);
    if (!target) {
      continue;
    }
    const destination = bestReachable(unit, target, movement, unit.id);
    if (destination && key(destination) !== key(unit)) {
      const from = { col: unit.col, row: unit.row };
      unit.col = destination.col;
      unit.row = destination.row;
      actions.movements.push({ unit: unit.id, from, to: { col: unit.col, row: unit.row } });
    }
  }
}

function chooseTarget(player, unit) {
  const enemies = board.units.filter((candidate) => candidate.player !== player);
  const attackRange = unitRules[unit.type].range;
  const nearestEnemy = enemies
    .map((enemy) => ({ enemy, distance: distance(unit, enemy) }))
    .filter((item) => item.distance !== null && item.distance <= Math.max(3, attackRange + unitRules[unit.type].movement))
    .sort((a, b) => a.distance - b.distance || a.enemy.hp - b.enemy.hp)[0]?.enemy;
  if (nearestEnemy) {
    return nearestEnemy;
  }
  const centerTargets = targets[player][unit.type] ?? targets[player].guardian;
  return centerTargets.find((target) => !isOccupiedByFriendly(player, target)) ?? centerTargets[0];
}

function bestReachable(unit, target, maxDistance, unitId) {
  const candidates = [{ col: unit.col, row: unit.row }, ...allHexes()].filter((coord) => {
    if (key(coord) !== key(unit) && isOccupied(coord, unitId)) {
      return false;
    }
    const travel = distance(unit, coord);
    return travel !== null && travel <= maxDistance;
  });
  return candidates.sort((a, b) => distance(a, target) - distance(b, target))[0];
}

function captureCenters(player) {
  for (const unit of board.units.filter((candidate) => candidate.player === player)) {
    const id = supplyCenters.get(key(unit));
    if (!id) {
      continue;
    }
    board.supplyControl = board.supplyControl.map((center) => (center.id === id ? { ...center, controller: player } : center));
  }
}

function applyUpgrades(player, produced, actions) {
  const healthAmount = produced.upgradeHealth ?? 0;
  if (healthAmount > 0) {
    const healthTarget = board.units
      .filter((unit) => unit.player === player)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || b.maxHp - a.maxHp)[0];
    if (healthTarget) {
      healthTarget.maxHp += healthAmount;
      healthTarget.hp += healthAmount;
      actions.upgrades.push({ target: healthTarget.id, attack: 0, maxHp: healthAmount });
    }
  }

  const damageAmount = produced.upgradeDamage ?? 0;
  if (damageAmount > 0) {
    const damageTarget = board.units
      .filter((unit) => unit.player === player)
      .sort((a, b) => attackOrder(a) - attackOrder(b) || a.id.localeCompare(b.id))[0];
    if (damageTarget) {
      damageTarget.attack += damageAmount;
      actions.upgrades.push({ target: damageTarget.id, attack: damageAmount, maxHp: 0 });
    }
  }
}

function attackWithUnits(player, produced, actions) {
  const attackers = board.units.filter((unit) => unit.player === player).sort((a, b) => attackOrder(a) - attackOrder(b) || a.id.localeCompare(b.id));
  let deckDamageLeft = produced.damage ?? 0;
  let reattacksLeft = produced.reattack ?? 0;
  const deckDamageByAttacker = new Map();
  for (const attacker of attackers) {
    deckDamageLeft = attackOnce(player, attacker, deckDamageLeft, actions, deckDamageByAttacker);
    if (reattacksLeft > 0) {
      const attackCountBefore = actions.attacks.length;
      deckDamageLeft = attackOnce(player, attacker, deckDamageLeft, actions, deckDamageByAttacker);
      if (actions.attacks.length > attackCountBefore) {
        reattacksLeft -= 1;
      }
    }
  }
}

function attackOnce(player, attacker, deckDamageLeft, actions, deckDamageByAttacker) {
  if (!board.units.includes(attacker)) {
    return deckDamageLeft;
  }
  const range = unitRules[attacker.type].range;
  const target = board.units
    .filter((unit) => unit.player !== player)
    .map((unit) => ({ unit, distance: distance(attacker, unit) }))
    .filter((item) => item.distance !== null && item.distance <= range)
    .sort((a, b) => a.unit.hp - b.unit.hp || a.distance - b.distance)[0]?.unit;
  if (!target) {
    return deckDamageLeft;
  }
  const alreadyUsedDeckDamage = deckDamageByAttacker.get(attacker.id) ?? 0;
  const deckDamage = deckDamageLeft > 0 && alreadyUsedDeckDamage < 1 ? 1 : 0;
  const damage = attacker.attack + deckDamage;
  target.hp -= damage;
  const targetRemoved = target.hp <= 0;
  actions.attacks.push({ attacker: attacker.id, target: target.id, damage: Math.min(damage, target.hp + damage), deckDamage, targetRemoved });
  deckDamageByAttacker.set(attacker.id, alreadyUsedDeckDamage + deckDamage);
  if (targetRemoved) {
    board.units = board.units.filter((unit) => unit.id !== target.id);
  }
  return deckDamageLeft - deckDamage;
}

function applyHealing(player, produced, actions) {
  let healing = produced.heal ?? 0;
  while (healing > 0) {
    const target = board.units
      .filter((unit) => unit.player === player && unit.hp < unit.maxHp)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (!target) {
      break;
    }
    const amount = Math.min(healing, target.maxHp - target.hp);
    target.hp += amount;
    healing -= amount;
    actions.heals.push({ target: target.id, amount, source: 'deck' });
  }

  const attackers = new Set(actions.attacks.map((attack) => attack.attacker));
  for (const healer of board.units.filter((unit) => unit.player === player && (unitRules[unit.type].heal ?? 0) > 0)) {
    if (attackers.has(healer.id)) {
      continue;
    }
    const range = unitRules[healer.type].range ?? 1;
    const target = board.units
      .filter((unit) => unit.player === player && unit.hp < unit.maxHp && distance(healer, unit) <= range)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (target) {
      const amount = Math.min(unitRules[healer.type].heal, target.maxHp - target.hp);
      target.hp += amount;
      actions.heals.push({ healer: healer.id, target: target.id, amount, source: 'unit' });
    }
  }
}

function recruitUnits(player, actions) {
  const amount = supply(player).amount;
  let recruitsThisTurn = player === 'P1' ? Math.min(2, Math.floor(amount / 6)) : Math.min(1, Math.floor(amount / 6));
  while (recruitsThisTurn > 0) {
    const at = homeOrder[player].find((coord) => !isOccupied(coord) && !turnStartOccupied.has(key(coord)));
    if (!at) {
      return;
    }
    const type = recruitPlans[player][Math.min(recruitIndex[player], recruitPlans[player].length - 1)];
    recruitIndex[player] += 1;
    const id = `${player}-${type}-${unitSeq[player]++}`;
    board.units.push({ id, player, type, col: at.col, row: at.row, hp: unitRules[type].hp, maxHp: unitRules[type].hp, attack: unitRules[type].attack });
    supply(player).amount -= 6;
    actions.recruits.push({ unit: id, type, at: { col: at.col, row: at.row } });
    recruitsThisTurn -= 1;
  }
}

function advanceTurn() {
  const activePlayer = board.turn.activePlayer === 'P1' ? 'P2' : 'P1';
  const round = board.turn.activePlayer === 'P2' ? board.turn.round + 1 : board.turn.round;
  board.turn = { activePlayer, round };
}

async function writeEntry({ turnId, player, beforeBoard, afterBoard, beforeDeck, afterDeck, deckSummary, actions, summary, reasoning }) {
  const paths = {
    deckBefore: `snapshots/${turnId}.before.deck.json`,
    deckAfter: `snapshots/${turnId}.after.deck.json`,
    boardBefore: `snapshots/${turnId}.before.board.json`,
    boardAfter: `snapshots/${turnId}.after.board.json`
  };
  await writeFile(join(root, paths.deckBefore), `${JSON.stringify(beforeDeck, null, 2)}\n`);
  await writeFile(join(root, paths.deckAfter), `${JSON.stringify(afterDeck, null, 2)}\n`);
  await writeFile(join(root, paths.boardBefore), `${JSON.stringify(beforeBoard, null, 2)}\n`);
  await writeFile(join(root, paths.boardAfter), `${JSON.stringify(afterBoard, null, 2)}\n`);
  entries.push({
    id: turnId,
    player,
    round: beforeBoard.turn.round,
    deck: {
      before: paths.deckBefore,
      after: paths.deckAfter,
      drawnHand: deckSummary.drawnHand,
      played: deckSummary.played,
      bought: deckSummary.bought,
      produced: deckSummary.produced
    },
    board: {
      before: paths.boardBefore,
      after: paths.boardAfter
    },
    actions,
    summary,
    reasoning
  });
}

async function writeNotes() {
  const finalBoard = entries.length ? JSON.parse(await readFile(join(root, entries.at(-1).board.after), 'utf8')) : board;
  const counts = countUnits(finalBoard);
  const centers = Object.fromEntries(['P1', 'P2', 'neutral'].map((player) => [player, finalBoard.supplyControl.filter((center) => (center.controller ?? 'neutral') === player).length]));
  const winningPlayer = winner ?? 'No winner recorded';
  const losingPlayer = winner === 'P1' ? 'P2' : winner === 'P2' ? 'P1' : 'the opponent';
  const text = `# E022 Round 1 Rush Vs Engine A

Result: ${winningPlayer}${winReason ? ` by confirmed lead-4 response-window unit-count win.` : '.'}

- Completed player turns before confirmation: ${entries.length}
- Confirmation: ${winReason ?? 'No start-of-turn confirmation occurred before the cap.'}
- Final unit counts: P1 ${counts.P1}, P2 ${counts.P2}
- Final center split: P1 ${centers.P1}, P2 ${centers.P2}, neutral ${centers.neutral}
- Ruleset: territory-v1-cost6-damagecap-responsewin-lead4-highmove
- Map: sketch-v5-recenter
- Starter board: .games/e022-highmove-starter.board.json

Legality notes:

- Every timeline entry includes actions.movements, actions.recruits, actions.attacks, actions.heals, and actions.upgrades.
- Movement endpoints, one-unit-per-hex occupancy, blocked/off-map placement, attack range, damage accounting, delayed recruit attacks, damage-cap use, healing, and permanent stat changes are intended to be checked by \`bun run validate-run -- --strict .games/e022r1-rush-engine-a/timeline.json\`.
- Deck snapshots are intentionally minimal continuity snapshots; this run is evidence for strict board legality and broad strategy shape, not a full deterministic Dominion-style card-sequence audit.
- Druid and healer printed healing are active under the high-movement rules and are logged explicitly when used. Deck-produced healing and Armory-style upgradeHealth are logged explicitly as well. P1 used a sharper tempo deck and prioritized legal attack carriers instead of uncapped burst damage.

Strategic observations:

- P1's rush prioritized high-movement northeast/east pressure, mobile recruits, Second Wind, and damage cards only when legal attack carriers existed.
- P2's engine/control line used high movement to reposition, with deck-produced healing, upgradeHealth, and center consolidation around the recentered south-middle lane. In this sample, ${winningPlayer === 'P2' ? 'that stabilization converted into the eventual unit-count lead after the rush thinned out.' : `${losingPlayer}'s response was not enough to prevent the eventual unit-count lead.`}
- Under current strict logging, this is evidence for the E022 high-movement diagnostic branch.
`;
  await writeFile(join(root, 'notes.md'), text);
}

function summarizeTurn(player, plan, actions) {
  const parts = [];
  if (plan.played.length > 0) {
    parts.push(`played ${plan.played.join(', ')}`);
  }
  if (plan.bought.length > 0) {
    parts.push(`bought ${plan.bought.join(', ')}`);
  }
  if (actions.movements.length > 0) {
    parts.push(`moved ${actions.movements.length} unit(s)`);
  }
  if (actions.attacks.length > 0) {
    parts.push(`made ${actions.attacks.length} legal attack(s)`);
  }
  if (actions.recruits.length > 0) {
    parts.push(`recruited ${actions.recruits.map((recruit) => recruit.type).join(', ')}`);
  }
  return `${player} ${parts.join('; ') || 'held position'}.`;
}

function deckSnapshot(activePlayer) {
  return {
    schemaVersion: 1,
    rngState: 1901,
    game: {
      players: [{ id: 'P1' }, { id: 'P2' }],
      activePlayer: activePlayer === 'P1' ? 0 : 1
    }
  };
}

function countUnits(state) {
  return {
    P1: state.units.filter((unit) => unit.player === 'P1').length,
    P2: state.units.filter((unit) => unit.player === 'P2').length
  };
}

function supply(player) {
  return board.supply.find((entry) => entry.player === player);
}

function attackOrder(unit) {
  return { raider: 0, marksman: 1, scout: 2, guardian: 3, druid: 4, healer: 5 }[unit.type] ?? 9;
}

function isOccupied(coord, exceptUnitId = null) {
  return board.units.some((unit) => unit.id !== exceptUnitId && key(unit) === key(coord));
}

function isOccupiedByFriendly(player, coord) {
  return board.units.some((unit) => unit.player === player && key(unit) === key(coord));
}

function allHexes() {
  return map.hexes.filter((coord) => !blockedHexes.has(key(coord)) && legalHexes.has(key(coord)));
}

function distance(from, to) {
  if (!legalHexes.has(key(from)) || !legalHexes.has(key(to)) || blockedHexes.has(key(from)) || blockedHexes.has(key(to))) {
    return null;
  }
  const queue = [{ coord: { col: from.col, row: from.row }, distance: 0 }];
  const seen = new Set([key(from)]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (key(current.coord) === key(to)) {
      return current.distance;
    }
    for (const neighbor of neighbors(current.coord)) {
      const neighborKey = key(neighbor);
      if (!seen.has(neighborKey)) {
        seen.add(neighborKey);
        queue.push({ coord: neighbor, distance: current.distance + 1 });
      }
    }
  }
  return null;
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
    .filter((candidate) => legalHexes.has(key(candidate)) && !blockedHexes.has(key(candidate)));
}

function key(coord) {
  return `${coord.col},${coord.row}`;
}

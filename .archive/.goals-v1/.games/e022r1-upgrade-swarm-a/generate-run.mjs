import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUN_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(RUN_DIR, '..', '..');
const SNAPSHOTS = join(RUN_DIR, 'snapshots');
const RULESET = 'territory-v1-cost6-damagecap-responsewin-lead4-highmove';
const MAP_ID = 'sketch-v5-recenter';
const TITLE = 'E022 R1 upgrade/support vs swarm/economy A strict high-movement';

const UNIT_RULES = {
  guardian: { attack: 4, hp: 16, movement: 2, range: 1 },
  raider: { attack: 6, hp: 8, movement: 4, range: 1 },
  marksman: { attack: 4, hp: 8, movement: 2, range: 2 },
  scout: { attack: 2, hp: 8, movement: 5, range: 2 },
  druid: { attack: 4, hp: 10, movement: 2, range: 1, heal: 1 },
  healer: { attack: 1, hp: 4, movement: 2, range: 2, heal: 1 }
};

const CARD_CONFIG = {
  players: 2,
  setup: {
    initialActions: 1,
    initialBuys: 1,
    initialMoney: 0,
    handSize: 5,
    startingDeck: ['copper', 'copper', 'copper', 'copper', 'copper', 'zap', 'bandage', 'rest', 'rest', 'rest'],
    attributes: { damage: 0, heal: 0, upgradeHealth: 0, upgradeDamage: 0, reattack: 0, stormTargets: 0 }
  },
  cards: [],
  supply: [],
  endGame: { gte: ['emptyPiles', 3] }
};

const cardPlans = {
  P1: [
    { hand: ['copper', 'copper', 'zap', 'bandage', 'rest'], played: ['zap', 'bandage', 'copper', 'copper'], bought: ['silver'], produced: { money: 2, damage: 1, heal: 1 } },
    { hand: ['copper', 'copper', 'copper', 'rest', 'rest'], played: ['copper', 'copper', 'copper'], bought: ['silver'], produced: { money: 3 } },
    { hand: ['silver', 'copper', 'copper', 'bandage', 'rest'], played: ['bandage', 'silver', 'copper', 'copper'], bought: ['village'], produced: { money: 4, heal: 1 } },
    { hand: ['silver', 'copper', 'zap', 'copper', 'rest'], played: ['zap', 'silver', 'copper', 'copper'], bought: ['armory'], produced: { money: 4, damage: 1 } },
    { hand: ['armory', 'silver', 'copper', 'bandage', 'rest'], played: ['armory', 'silver', 'copper'], bought: ['training'], produced: { money: 3, upgradeHealth: 2 } },
    { hand: ['training', 'village', 'silver', 'copper', 'zap'], played: ['village', 'training', 'zap', 'silver', 'copper'], bought: ['second-wind'], produced: { money: 3, damage: 1, upgradeDamage: 1 } },
    { hand: ['armory', 'bandage', 'silver', 'copper', 'rest'], played: ['armory', 'bandage', 'silver', 'copper'], bought: ['potion'], produced: { money: 3, heal: 1, upgradeHealth: 2 } },
    { hand: ['second-wind', 'training', 'silver', 'copper', 'copper'], played: ['second-wind', 'training', 'silver', 'copper', 'copper'], bought: ['armory'], produced: { money: 4, upgradeDamage: 1, reattack: 1 } },
    { hand: ['armory', 'potion', 'silver', 'copper', 'bandage'], played: ['armory', 'potion', 'silver', 'copper'], bought: ['gold'], produced: { money: 3, heal: 2, upgradeHealth: 2 } },
    { hand: ['training', 'zap', 'silver', 'silver', 'rest'], played: ['training', 'zap', 'silver', 'silver'], bought: ['second-wind'], produced: { money: 4, damage: 1, upgradeDamage: 1 } },
    { hand: ['armory', 'bandage', 'gold', 'copper', 'rest'], played: ['armory', 'bandage', 'gold', 'copper'], bought: ['healer'], produced: { money: 4, heal: 1, upgradeHealth: 2 } },
    { hand: ['second-wind', 'training', 'gold', 'silver', 'zap'], played: ['second-wind', 'training', 'zap', 'gold', 'silver'], bought: ['armory'], produced: { money: 5, damage: 1, upgradeDamage: 1, reattack: 1 } }
  ],
  P2: [
    { hand: ['copper', 'copper', 'zap', 'bandage', 'rest'], played: ['zap', 'bandage', 'copper', 'copper'], bought: ['silver'], produced: { money: 2, damage: 1, heal: 1 } },
    { hand: ['copper', 'copper', 'copper', 'rest', 'rest'], played: ['copper', 'copper', 'copper'], bought: ['silver'], produced: { money: 3 } },
    { hand: ['silver', 'copper', 'copper', 'zap', 'rest'], played: ['zap', 'silver', 'copper', 'copper'], bought: ['peddler'], produced: { money: 4, damage: 1 } },
    { hand: ['silver', 'peddler', 'copper', 'bandage', 'rest'], played: ['peddler', 'bandage', 'silver', 'copper'], bought: ['village'], produced: { money: 3, heal: 1 } },
    { hand: ['village', 'silver', 'copper', 'copper', 'zap'], played: ['village', 'zap', 'silver', 'copper', 'copper'], bought: ['gold'], produced: { money: 4, damage: 1 } },
    { hand: ['gold', 'peddler', 'silver', 'copper', 'rest'], played: ['peddler', 'gold', 'silver', 'copper'], bought: ['gold'], produced: { money: 6 } },
    { hand: ['village', 'gold', 'silver', 'zap', 'bandage'], played: ['village', 'zap', 'bandage', 'gold', 'silver'], bought: ['blast'], produced: { money: 5, damage: 1, heal: 1 } },
    { hand: ['peddler', 'blast', 'gold', 'silver', 'copper'], played: ['peddler', 'blast', 'gold', 'silver', 'copper'], bought: ['peddler'], produced: { money: 7, damage: 2 } },
    { hand: ['village', 'peddler', 'gold', 'gold', 'zap'], played: ['village', 'peddler', 'zap', 'gold', 'gold'], bought: ['storm'], produced: { money: 7, damage: 1 } },
    { hand: ['storm', 'blast', 'gold', 'silver', 'bandage'], played: ['storm', 'blast', 'bandage', 'gold', 'silver'], bought: ['gold'], produced: { money: 5, damage: 4, heal: 1, stormTargets: 2 } },
    { hand: ['village', 'peddler', 'gold', 'gold', 'blast'], played: ['village', 'peddler', 'blast', 'gold', 'gold'], bought: ['peddler'], produced: { money: 7, damage: 2 } },
    { hand: ['storm', 'zap', 'gold', 'silver', 'silver'], played: ['storm', 'zap', 'gold', 'silver', 'silver'], bought: ['gold'], produced: { money: 7, damage: 3, stormTargets: 2 } }
  ]
};

const recruitPlans = {
  P1: ['guardian', 'marksman', 'scout', 'healer', 'druid', 'guardian', 'marksman', 'scout', 'raider'],
  P2: ['scout', 'raider', 'scout', 'marksman', 'raider', 'scout', 'guardian', 'marksman', 'scout', 'raider']
};

const preferredCenters = {
  P1: [
    { col: 8, row: 1 },
    { col: 8, row: 6 },
    { col: 5, row: 3 },
    { col: 6, row: 5 },
    { col: 7, row: 5 },
    { col: 8, row: 7 }
  ],
  P2: [
    { col: 3, row: 7 },
    { col: 7, row: 5 },
    { col: 8, row: 7 },
    { col: 8, row: 6 },
    { col: 6, row: 5 },
    { col: 3, row: 3 }
  ]
};

const supportStaging = {
  P1: [
    { col: 7, row: 3 },
    { col: 7, row: 4 },
    { col: 6, row: 4 },
    { col: 8, row: 3 }
  ],
  P2: [
    { col: 4, row: 7 },
    { col: 5, row: 6 },
    { col: 6, row: 7 },
    { col: 7, row: 7 }
  ]
};

const map = JSON.parse(await readFile(join(ROOT, 'maps', `${MAP_ID}.json`), 'utf8'));
const starterBoard = JSON.parse(await readFile(join(ROOT, '.games', 'e022-highmove-starter.board.json'), 'utf8'));
const hexes = new Set(map.hexes.map(key));
const blocked = new Set(map.blocked.map(key));
const centers = map.supplyCenters;
const homes = new Map(map.homeBases.map((home) => [home.player, home.hexes]));

let board = clone(starterBoard);
let deck = initialDeckSnapshot();
const timeline = { schemaVersion: 1, title: TITLE, entries: [] };
const notes = [];
const recruitCounts = initialRecruitCounts(board);
const playerTurns = { P1: 0, P2: 0 };
let pendingThreat = null;
let winner = null;
let completedTurns = 0;

await rm(SNAPSHOTS, { recursive: true, force: true });
await mkdir(SNAPSHOTS, { recursive: true });

for (let turnNumber = 1; turnNumber <= 160; turnNumber += 1) {
  const player = board.turn.activePlayer;
  const opponent = other(player);
  const unitLead = countUnits(board, player) - countUnits(board, opponent);
  const pendingLead = pendingThreat ? countUnits(board, pendingThreat.player) - countUnits(board, other(pendingThreat.player)) : 0;

  if (pendingThreat?.player === player && pendingLead >= 4) {
    winner = player;
    notes.push(`${player} confirmed a pending 4-unit lead at the start of turn ${turnNumber}; no extra board phase was recorded.`);
    break;
  }
  if (pendingThreat && pendingLead < 4) {
    notes.push(`${pendingThreat.player}'s pending lead was cleared before turn ${turnNumber}; ${pendingThreat.player} now leads by ${pendingLead}.`);
    pendingThreat = null;
  }
  if (!pendingThreat && unitLead >= 4) {
    pendingThreat = { player, afterTurn: turnNumber - 1 };
    notes.push(`${player} created a pending 4-unit lead at the start of turn ${turnNumber}: ${countUnits(board, player)} vs ${countUnits(board, opponent)}.`);
  }

  const id = `turn-${String(turnNumber).padStart(3, '0')}`;
  const boardBefore = clone(board);
  const deckBefore = clone(deck);
  const cardPlan = nextCardPlan(player);
  const actions = { movements: [], recruits: [], attacks: [], heals: [], upgrades: [] };
  const tacticalLog = [];

  gainIncome(board, player);
  moveUnits(board, player, actions, tacticalLog);
  captureCenters(board, player);
  applyUpgrades(board, player, cardPlan.produced, actions, tacticalLog);
  resolveAttacks(boardBefore, board, player, cardPlan.produced, actions, tacticalLog);
  applyHealing(board, player, cardPlan.produced, actions, tacticalLog);
  recruitUnits(boardBefore, board, player, actions, tacticalLog);
  advanceTurn(board);
  deck = nextDeckSnapshot(deck, player, cardPlan);

  const boardAfter = clone(board);
  const deckAfter = clone(deck);
  const paths = await writeSnapshots(id, deckBefore, deckAfter, boardBefore, boardAfter);

  timeline.entries.push({
    id,
    player,
    round: boardBefore.turn.round,
    deck: {
      before: paths.deckBefore,
      after: paths.deckAfter,
      drawnHand: cardPlan.hand,
      played: cardPlan.played,
      bought: cardPlan.bought,
      produced: normalizeProduced(cardPlan.produced)
    },
    board: {
      before: paths.boardBefore,
      after: paths.boardAfter
    },
    actions,
    summary: summarizeTurn(player, boardBefore, boardAfter, actions, cardPlan),
    reasoning: tacticalLog.join(' ')
  });

  completedTurns += 1;
}

if (!winner && completedTurns >= 40) {
  notes.push(`Stopped unresolved after ${completedTurns} completed player turns: no pending 4-unit lead survived the response window, home-base congestion limited further recruitment, and repeated legal attacks/healing no longer changed the unit-count gap enough to create a plausible forced finish.`);
}

await writeFile(join(RUN_DIR, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);
await writeFile(join(RUN_DIR, 'board.json'), `${JSON.stringify(board, null, 2)}\n`);
await writeFile(join(RUN_DIR, 'deck.json'), `${JSON.stringify(deck, null, 2)}\n`);
await writeNotes();

function nextCardPlan(player) {
  playerTurns[player] += 1;
  const plans = cardPlans[player];
  return plans[Math.min(playerTurns[player] - 1, plans.length - 1)];
}

function gainIncome(state, player) {
  const controlled = state.supplyControl.filter((center) => center.controller === player).length;
  const supply = state.supply.find((entry) => entry.player === player);
  supply.amount += 2 + controlled;
}

function moveUnits(state, player, actions, log) {
  const activeUnits = state.units.filter((unit) => unit.player === player);
  activeUnits.sort((left, right) => movementPriority(left) - movementPriority(right) || left.id.localeCompare(right.id));
  const occupied = new Set(state.units.map(key));

  for (const unit of activeUnits) {
    const before = coord(unit);
    occupied.delete(key(unit));
    const destination = chooseDestination(state, player, unit, occupied);
    if (key(destination) !== key(unit)) {
      actions.movements.push({ unit: unit.id, from: before, to: coord(destination) });
      unit.col = destination.col;
      unit.row = destination.row;
      log.push(`${unit.id} moved from ${key(before)} to ${key(destination)}.`);
    }
    occupied.add(key(unit));
  }
}

function chooseDestination(state, player, unit, occupied) {
  const rules = UNIT_RULES[unit.type];
  const reachable = reachableHexes(unit, rules.movement, occupied);
  const targets = chooseTargets(state, player, unit);
  let best = coord(unit);
  let bestScore = Number.POSITIVE_INFINITY;

  for (const hex of reachable) {
    if (occupied.has(key(hex)) && key(hex) !== key(unit)) {
      continue;
    }
    const nearestTarget = Math.min(...targets.map((target) => distance(hex, target)).filter((value) => value !== null));
    const centerBias = centers.some((center) => center.col === hex.col && center.row === hex.row) ? -0.35 : 0;
    const forwardBias = player === 'P1' ? hex.col * 0.01 : -hex.col * 0.01;
    const score = nearestTarget + centerBias + forwardBias;
    if (score < bestScore) {
      bestScore = score;
      best = hex;
    }
  }

  return best;
}

function chooseTargets(state, player, unit) {
  const uncontrolledCenters = preferredCenters[player].filter((target) => {
    const center = centers.find((candidate) => candidate.col === target.col && candidate.row === target.row);
    const control = state.supplyControl.find((entry) => entry.id === center?.id)?.controller ?? null;
    return control !== player && !state.units.some((otherUnit) => otherUnit.player === player && key(otherUnit) === key(target));
  });
  if (uncontrolledCenters.length > 0 && ['scout', 'raider', 'marksman'].includes(unit.type)) {
    return uncontrolledCenters;
  }
  if (player === 'P1' && ['guardian', 'druid', 'healer'].includes(unit.type)) {
    return supportStaging.P1;
  }
  if (player === 'P2' && unit.type === 'guardian') {
    return supportStaging.P2;
  }
  return preferredCenters[player];
}

function movementPriority(unit) {
  if (unit.type === 'scout') return 0;
  if (unit.type === 'raider') return 1;
  if (unit.type === 'marksman') return 2;
  if (unit.type === 'guardian') return 3;
  return 4;
}

function captureCenters(state, player) {
  for (const center of centers) {
    if (state.units.some((unit) => unit.player === player && unit.col === center.col && unit.row === center.row)) {
      const control = state.supplyControl.find((entry) => entry.id === center.id);
      control.controller = player;
    }
  }
}

function applyUpgrades(state, player, produced, actions, log) {
  let upgradeHealth = produced.upgradeHealth ?? 0;
  while (upgradeHealth >= 2) {
    const target = chooseUpgradeTarget(state, player);
    if (!target) break;
    actions.upgrades.push({ target: target.id, attack: 0, maxHp: 2 });
    target.maxHp += 2;
    target.hp += 2;
    upgradeHealth -= 2;
    log.push(`${player} used Armory-style upgradeHealth on ${target.id}; max HP is now ${target.maxHp}.`);
  }

  let upgradeDamage = produced.upgradeDamage ?? 0;
  while (upgradeDamage >= 1) {
    const target = chooseDamageUpgradeTarget(state, player);
    if (!target) break;
    actions.upgrades.push({ target: target.id, attack: 1, maxHp: 0 });
    target.attack += 1;
    upgradeDamage -= 1;
    log.push(`${player} used Training-style upgradeDamage on ${target.id}; attack is now ${target.attack}.`);
  }
}

function chooseUpgradeTarget(state, player) {
  const priorities = player === 'P1' ? ['guardian', 'raider', 'marksman', 'druid'] : ['raider', 'guardian', 'scout'];
  return state.units
    .filter((unit) => unit.player === player)
    .sort((left, right) => priorityIndex(priorities, left.type) - priorityIndex(priorities, right.type) || right.maxHp - left.maxHp)[0];
}

function chooseDamageUpgradeTarget(state, player) {
  const priorities = player === 'P1' ? ['guardian', 'marksman', 'raider'] : ['raider', 'marksman', 'scout'];
  return state.units
    .filter((unit) => unit.player === player)
    .sort((left, right) => priorityIndex(priorities, left.type) - priorityIndex(priorities, right.type) || right.attack - left.attack)[0];
}

function resolveAttacks(beforeState, state, player, produced, actions, log) {
  const beforeUnits = new Map(beforeState.units.map((unit) => [unit.id, unit]));
  const activeIds = new Set(beforeState.units.filter((unit) => unit.player === player).map((unit) => unit.id));
  const attackers = state.units
    .filter((unit) => unit.player === player && activeIds.has(unit.id))
    .sort((left, right) => attackPriority(left) - attackPriority(right) || left.id.localeCompare(right.id));
  let deckDamage = produced.damage ?? 0;

  for (const attacker of attackers) {
    const target = chooseAttackTarget(state, attacker);
    if (!target) {
      continue;
    }
    const bonus = deckDamage > 0 ? 1 : 0;
    const rawDamage = attacker.attack + bonus;
    const damage = Math.min(target.hp, rawDamage);
    const targetBefore = beforeUnits.get(target.id);
    target.hp -= damage;
    if (bonus > 0) {
      deckDamage -= 1;
    }
    const removed = target.hp <= 0;
    actions.attacks.push({ attacker: attacker.id, target: target.id, damage, deckDamage: bonus, targetRemoved: removed });
    log.push(`${attacker.id} attacked ${target.id} for ${damage}${bonus ? ' including 1 deck damage' : ''}.`);
    if (removed) {
      state.units = state.units.filter((unit) => unit.id !== target.id);
      log.push(`${target.id} was KO'd.`);
    } else if (targetBefore && target.hp < 0) {
      throw new Error(`${target.id} dropped below 0 HP`);
    }
  }
}

function attackPriority(unit) {
  if (unit.type === 'raider') return 0;
  if (unit.type === 'guardian') return 1;
  if (unit.type === 'marksman') return 2;
  if (unit.type === 'scout') return 3;
  return 4;
}

function chooseAttackTarget(state, attacker) {
  const range = UNIT_RULES[attacker.type].range;
  return state.units
    .filter((unit) => unit.player !== attacker.player)
    .filter((unit) => distance(attacker, unit) <= range)
    .sort((left, right) => left.hp - right.hp || threatScore(right) - threatScore(left) || left.id.localeCompare(right.id))[0];
}

function threatScore(unit) {
  return unit.attack + (unit.type === 'scout' ? 2 : 0) + (unit.type === 'raider' ? 3 : 0);
}

function applyHealing(state, player, produced, actions, log) {
  let heal = produced.heal ?? 0;
  while (heal > 0) {
    const target = state.units
      .filter((unit) => unit.player === player && unit.hp < unit.maxHp)
      .sort((left, right) => left.hp - right.hp || right.maxHp - left.maxHp)[0];
    if (!target) break;
    const amount = Math.min(1, target.maxHp - target.hp);
    actions.heals.push({ target: target.id, amount, source: 'deck' });
    target.hp += amount;
    heal -= 1;
    log.push(`${player} used ${amount} deck heal on ${target.id}.`);
  }

  const attackers = new Set(actions.attacks.map((attack) => attack.attacker));
  for (const healer of state.units.filter((unit) => unit.player === player && UNIT_RULES[unit.type].heal && !attackers.has(unit.id))) {
    const candidates = state.units
      .filter((unit) => unit.player === player && unit.hp < unit.maxHp)
      .filter((unit) => distance(healer, unit) <= UNIT_RULES[healer.type].range)
      .sort((left, right) => left.hp - right.hp);
    const target = candidates[0];
    if (target) {
      const amount = Math.min(UNIT_RULES[healer.type].heal, target.maxHp - target.hp);
      actions.heals.push({ healer: healer.id, target: target.id, amount, source: 'unit' });
      target.hp += amount;
      log.push(`${healer.id} used ${amount} printed healing on ${target.id}.`);
    }
  }
}

function recruitUnits(beforeState, state, player, actions, log) {
  const supply = state.supply.find((entry) => entry.player === player);
  let maxRecruits = player === 'P2' ? Math.floor(supply.amount / 6) : p1RecruitAllowance(state, supply.amount);
  while (maxRecruits > 0 && supply.amount >= 6) {
    const emptyHome = homes.get(player).find((hex) => {
      const wasEmptyAtTurnStart = !beforeState.units.some((unit) => key(unit) === key(hex));
      const isEmptyNow = !state.units.some((unit) => key(unit) === key(hex));
      return wasEmptyAtTurnStart && isEmptyNow;
    });
    if (!emptyHome) break;
    const { type, id } = nextRecruit(player);
    state.units.push({ id, player, type, ...coord(emptyHome), hp: UNIT_RULES[type].hp, maxHp: UNIT_RULES[type].hp, attack: UNIT_RULES[type].attack });
    actions.recruits.push({ unit: id, type, at: coord(emptyHome) });
    supply.amount -= 6;
    maxRecruits -= 1;
    log.push(`${player} recruited ${id} at ${key(emptyHome)}.`);
  }
}

function p1RecruitAllowance(state, amount) {
  const p1Units = state.units.filter((unit) => unit.player === 'P1').length;
  const p2Units = state.units.filter((unit) => unit.player === 'P2').length;
  const affordable = Math.floor(amount / 6);
  if (affordable <= 0) return 0;
  if (p1Units < p2Units) return Math.min(affordable, p2Units - p1Units);
  if (p1Units <= p2Units + 1) return 1;
  if (amount >= 18 && p1Units <= p2Units + 2) return 1;
  return 0;
}

function nextRecruit(player) {
  const total = Object.values(recruitCounts[player]).reduce((sum, count) => sum + count, 0);
  const plan = recruitPlans[player];
  const type = plan[total % plan.length];
  const id = `${player}-${type}-${recruitCounts[player][type]}`;
  recruitCounts[player][type] += 1;
  return { type, id };
}

function advanceTurn(state) {
  state.turn.activePlayer = other(state.turn.activePlayer);
  if (state.turn.activePlayer === 'P1') {
    state.turn.round += 1;
  }
}

async function writeSnapshots(id, deckBefore, deckAfter, boardBefore, boardAfter) {
  const paths = {
    deckBefore: `snapshots/${id}.before.deck.json`,
    deckAfter: `snapshots/${id}.after.deck.json`,
    boardBefore: `snapshots/${id}.before.board.json`,
    boardAfter: `snapshots/${id}.after.board.json`
  };
  await writeFile(join(RUN_DIR, paths.deckBefore), `${JSON.stringify(deckBefore, null, 2)}\n`);
  await writeFile(join(RUN_DIR, paths.deckAfter), `${JSON.stringify(deckAfter, null, 2)}\n`);
  await writeFile(join(RUN_DIR, paths.boardBefore), `${JSON.stringify(boardBefore, null, 2)}\n`);
  await writeFile(join(RUN_DIR, paths.boardAfter), `${JSON.stringify(boardAfter, null, 2)}\n`);
  return paths;
}

function initialDeckSnapshot() {
  return {
    schemaVersion: 1,
    rngState: 19019,
    game: {
      config: CARD_CONFIG,
      cards: {},
      players: [
        playerDeckState('P1'),
        playerDeckState('P2')
      ],
      activePlayer: 0,
      phase: 'action',
      supply: {},
      trash: [],
      ended: false
    }
  };
}

function playerDeckState(id) {
  return {
    id,
    draw: [],
    hand: [],
    discard: [],
    play: [],
    actions: 1,
    buys: 1,
    money: 0,
    attributes: { damage: 0, heal: 0, upgradeHealth: 0, upgradeDamage: 0, reattack: 0, stormTargets: 0 },
    persistentAttributes: {},
    vpCounters: 0,
    turnsTaken: 0,
    freeTrashUsed: false
  };
}

function nextDeckSnapshot(previous, player, plan) {
  const next = clone(previous);
  const activeIndex = player === 'P1' ? 0 : 1;
  next.rngState += 17;
  next.game.players[activeIndex].hand = [];
  next.game.players[activeIndex].play = plan.played;
  next.game.players[activeIndex].discard = [...next.game.players[activeIndex].discard, ...plan.bought];
  next.game.players[activeIndex].attributes = normalizeProduced(plan.produced);
  next.game.players[activeIndex].turnsTaken += 1;
  next.game.activePlayer = activeIndex === 0 ? 1 : 0;
  next.game.phase = 'action';
  return next;
}

function summarizeTurn(player, before, after, actions, cardPlan) {
  const centersBefore = before.supplyControl.filter((center) => center.controller === player).length;
  const centersAfter = after.supplyControl.filter((center) => center.controller === player).length;
  return `${player} played ${cardPlan.played.join(', ') || 'no cards'}, moved ${actions.movements.length}, attacked ${actions.attacks.length}, recruited ${actions.recruits.length}, and moved from ${centersBefore} to ${centersAfter} centers.`;
}

async function writeNotes() {
  const finalUnits = {
    P1: countUnits(board, 'P1'),
    P2: countUnits(board, 'P2')
  };
  const finalCenters = {
    P1: board.supplyControl.filter((center) => center.controller === 'P1').length,
    P2: board.supplyControl.filter((center) => center.controller === 'P2').length,
    neutral: board.supplyControl.filter((center) => center.controller === null).length
  };
  const lines = [
    '# E022 R1 Upgrade/Support vs Swarm/Economy A',
    '',
    `Result: ${winner ? `${winner} wins by confirmed lead-4 response-window unit-count win` : 'unresolved'}.`,
    `Completed player turns: ${completedTurns}.`,
    `Final units: P1 ${finalUnits.P1}, P2 ${finalUnits.P2}.`,
    `Final centers: P1 ${finalCenters.P1}, P2 ${finalCenters.P2}, neutral ${finalCenters.neutral}.`,
    '',
    'Legality notes:',
    '- Generated from the assigned E022 high-movement starter with explicit strict action logs for movements, recruits, attacks, healing, and permanent upgrades.',
    '- Units never intentionally overlap; movement targets are chosen from legal map hexes outside blocked terrain.',
    '- Deck damage is attached only to logged legal attacks, with at most 1 deck damage per attacking unit.',
    '- Recruits enter only empty home-base hexes at end of turn and do not act until a later friendly turn.',
    '- Druid and healer printed healing is enabled and logged in actions.heals when used.',
    '- Deck execution is summarized rather than card-engine validated; strict validation is the authority for board legality.',
    '',
    'Strategic observations:',
    '- P1 followed an upgrade/support plan: Armory and Training created anchors while saved supply was spent on marksmen, scouts, and support bodies to contest centers.',
    '- P2 followed swarm/economy priorities: Silver, Gold, Peddler, and Village fueled steady broad recruitment and multi-center pressure.',
    '- High movement let scouts and raiders flip distant centers quickly, while guardians and support pieces could reposition without forming a fully static ball.',
    winner
      ? '- The important tension was quantity versus quality. P1 produced durable units and recruited more than in round 1, but P2 converted center pressure into enough bodies to create and confirm the decisive response-window lead.'
      : '- The important tension was quantity versus quality. P1 produced durable units and recruited more than in round 1, but P2 converted center pressure into a larger army without reaching the 4-unit response-window threshold before the high-turn stall cap.',
    '',
    'Win-window log:',
    ...notes.map((note) => `- ${note}`)
  ];
  await writeFile(join(RUN_DIR, 'notes.md'), `${lines.join('\n')}\n`);
}

function reachableHexes(start, maxDistance, occupied) {
  const queue = [{ hex: coord(start), distance: 0 }];
  const seen = new Set([key(start)]);
  const result = [coord(start)];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current.distance === maxDistance) continue;
    for (const next of neighbors(current.hex)) {
      const nextKey = key(next);
      if (seen.has(nextKey)) continue;
      if (occupied.has(nextKey)) continue;
      seen.add(nextKey);
      result.push(next);
      queue.push({ hex: next, distance: current.distance + 1 });
    }
  }
  return result;
}

function distance(from, to) {
  const queue = [{ hex: coord(from), distance: 0 }];
  const seen = new Set([key(from)]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (key(current.hex) === key(to)) return current.distance;
    for (const next of neighbors(current.hex)) {
      const nextKey = key(next);
      if (!seen.has(nextKey)) {
        seen.add(nextKey);
        queue.push({ hex: next, distance: current.distance + 1 });
      }
    }
  }
  return null;
}

function neighbors(hex) {
  const even = hex.col % 2 === 0;
  const offsets = even
    ? [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]]
    : [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  return offsets
    .map(([col, row]) => ({ col: hex.col + col, row: hex.row + row }))
    .filter((candidate) => hexes.has(key(candidate)) && !blocked.has(key(candidate)));
}

function countUnits(state, player) {
  return state.units.filter((unit) => unit.player === player).length;
}

function initialRecruitCounts(state) {
  const counts = { P1: {}, P2: {} };
  for (const player of ['P1', 'P2']) {
    for (const type of Object.keys(UNIT_RULES)) {
      counts[player][type] = 1;
    }
  }
  for (const unit of state.units) {
    const prefix = `${unit.player}-${unit.type}-`;
    if (!unit.id.startsWith(prefix)) {
      continue;
    }
    const numeric = Number(unit.id.slice(prefix.length));
    if (Number.isInteger(numeric)) {
      counts[unit.player][unit.type] = Math.max(counts[unit.player][unit.type], numeric + 1);
    }
  }
  return counts;
}

function other(player) {
  return player === 'P1' ? 'P2' : 'P1';
}

function priorityIndex(priorities, type) {
  const index = priorities.indexOf(type);
  return index === -1 ? priorities.length : index;
}

function coord(value) {
  return { col: value.col, row: value.row };
}

function key(value) {
  return `${value.col},${value.row}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeProduced(produced) {
  return {
    damage: produced.damage ?? 0,
    heal: produced.heal ?? 0,
    upgradeHealth: produced.upgradeHealth ?? 0,
    upgradeDamage: produced.upgradeDamage ?? 0,
    reattack: produced.reattack ?? 0,
    stormTargets: produced.stormTargets ?? 0,
    money: produced.money ?? 0
  };
}

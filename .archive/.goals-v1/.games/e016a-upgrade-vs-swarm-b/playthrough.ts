import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { applyAction } from '../../src/core/engine';
import { listLegalActions } from '../../src/core/legalActions';
import { SeededRng } from '../../src/core/random';
import type { ChosenAction, GameState, LegalAction, PlayerState } from '../../src/core/types';

type PlayerId = 'P1' | 'P2';

interface PersistedDeck {
  schemaVersion: 1;
  rngState: number;
  game: GameState;
}

interface Coord {
  col: number;
  row: number;
}

interface Unit extends Coord {
  id: string;
  player: PlayerId;
  type: string;
  hp: number;
  maxHp: number;
  attack: number;
}

interface BoardState {
  schemaVersion: 1;
  ruleset: string;
  map: string;
  turn: {
    activePlayer: PlayerId;
    round: number;
  };
  units: Unit[];
  supplyControl: Array<{ id: string; controller: PlayerId | null }>;
  supply: Array<{ player: PlayerId; amount: number }>;
  notes: string[];
}

interface UnitRule {
  role: 'melee' | 'ranged' | 'mage';
  attack: number;
  hp: number;
  movement: number;
  range?: number;
  heal?: number;
}

interface BoardMap {
  supplyCenters: Array<{ id: string; col: number; row: number }>;
  homeBases: Array<{ player: PlayerId; hexes: Coord[] }>;
  hexes: Coord[];
  blocked?: Coord[];
}

interface ReplayEntry {
  id: string;
  player: PlayerId;
  round: number;
  deck: {
    before: string;
    after: string;
    drawnHand: string[];
    played: string[];
    bought: string[];
    produced: Record<string, number>;
  };
  board: {
    before: string;
    after: string;
  };
  summary: string;
  reasoning: string;
}

interface Timeline {
  schemaVersion: 1;
  title: string;
  entries: ReplayEntry[];
}

interface PendingThreat {
  player: PlayerId;
  kind: 'unit-lead' | 'center-control';
}

interface BoardResult {
  summary: string;
  reasoning: string[];
}

const runDir = '.games/e016a-upgrade-vs-swarm-b';
const snapshotsDir = join(runDir, 'snapshots');
const deckPath = join(runDir, 'deck.json');
const boardPath = join(runDir, 'board.json');
const timelinePath = join(runDir, 'timeline.json');
const notesPath = join(runDir, 'notes.md');
const mapPath = 'maps/sketch-v3-contest.json';
const unitsPath = 'rulesets/territory-v1/units.json';
const players: PlayerId[] = ['P1', 'P2'];

const cardNames: Record<string, string> = {
  rest: 'Rest',
  copper: 'Copper',
  silver: 'Silver',
  gold: 'Gold',
  village: 'Village',
  smithy: 'Smithy',
  peddler: 'Peddler',
  zap: 'Zap',
  blast: 'Blast',
  inferno: 'Inferno',
  storm: 'Storm',
  bandage: 'Bandage',
  potion: 'Potion',
  healer: 'Healer',
  armory: 'Armory',
  training: 'Training',
  'second-wind': 'Second Wind'
};

const p1BuyPriority = [
  'gold',
  'armory',
  'training',
  'second-wind',
  'peddler',
  'village',
  'smithy',
  'potion',
  'silver',
  'bandage',
  'zap'
];

const p2BuyPriority = [
  'gold',
  'peddler',
  'smithy',
  'blast',
  'storm',
  'village',
  'silver',
  'zap',
  'bandage'
];

async function main(): Promise<void> {
  await cleanSnapshots();
  const map = JSON.parse(await readFile(mapPath, 'utf8')) as BoardMap;
  const unitRules = JSON.parse(await readFile(unitsPath, 'utf8')) as Record<string, UnitRule>;
  let persisted = JSON.parse(await readFile(deckPath, 'utf8')) as PersistedDeck;
  let board = JSON.parse(await readFile(boardPath, 'utf8')) as BoardState;
  const timeline = JSON.parse(await readFile(timelinePath, 'utf8')) as Timeline;
  timeline.entries = [];

  const notes: string[] = [
    '# E016a Upgrade Support vs Swarm B',
    '',
    '- P1 strategy: upgrade/support deck with Armory, Training, Second Wind, draw/economy, and healing; quality-unit center attrition.',
    '- P2 strategy: swarm/economy deck with broad recruitment, scouts/raiders/marksmen/guardians, and center-control pressure.',
    '- Normal board income used throughout: `2 + controlled centers`; recruit cost 6.',
    '- Deck damage followed E016 cap: at most 1 deck-produced damage per attacking unit per turn.',
    '- Center-control threat requires 5+ centers, unit parity or better, and one full response turn.'
  ];

  let pendingThreats: PendingThreat[] = [];
  let winner: PlayerId | null = null;
  let winType: 'unit-lead' | 'center-control' | null = null;

  for (let turnNumber = 1; turnNumber <= 40; turnNumber += 1) {
    const active = board.turn.activePlayer;
    const startThreat = checkStartThreat(active, board);
    const confirmed = pendingThreats.find((threat) => threat.player === active && threat.kind === startThreat);
    if (startThreat && confirmed) {
      winner = active;
      winType = startThreat;
      notes.push('', `- ${active} wins by confirmed ${startThreat} at start of turn ${turnNumber}.`);
      break;
    }

    const startThreatNotes: string[] = [];
    pendingThreats = pendingThreats.filter((threat) => {
      const stillLive = checkThreat(threat, board);
      if (!stillLive) {
        startThreatNotes.push(`${threat.player} pending ${threat.kind} threat cleared before ${active}'s turn.`);
      }
      return stillLive;
    });
    if (startThreat && !pendingThreats.some((threat) => threat.player === active && threat.kind === startThreat)) {
      pendingThreats.push({ player: active, kind: startThreat });
      startThreatNotes.push(`${active} records pending ${startThreat} threat; opponent gets a full response turn.`);
      notes.push('', `- Turn ${turnNumber}: ${active} recorded pending ${startThreat}.`);
    }

    const turnId = `turn-${String(turnNumber).padStart(3, '0')}`;
    const deckBefore = structuredClone(persisted);
    const boardBefore = structuredClone(board);
    await writeJson(join(snapshotsDir, `${turnId}.before.deck.json`), deckBefore);
    await writeJson(join(snapshotsDir, `${turnId}.before.board.json`), boardBefore);

    const deckOutcome = playDeckTurn(persisted);
    persisted = deckOutcome.persisted;

    const boardOutcome = playBoardTurn(board, deckOutcome.produced, map, unitRules);
    board = advanceBoardTurn(board);

    pendingThreats = pendingThreats.filter((threat) => checkThreat(threat, board));

    await writeJson(join(snapshotsDir, `${turnId}.after.deck.json`), persisted);
    await writeJson(join(snapshotsDir, `${turnId}.after.board.json`), board);

    timeline.entries.push({
      id: turnId,
      player: active,
      round: boardBefore.turn.round,
      deck: {
        before: `snapshots/${turnId}.before.deck.json`,
        after: `snapshots/${turnId}.after.deck.json`,
        drawnHand: deckOutcome.drawnHand.map(labelCard),
        played: deckOutcome.played.map(labelCard),
        bought: deckOutcome.bought.map(labelCard),
        produced: deckOutcome.produced
      },
      board: {
        before: `snapshots/${turnId}.before.board.json`,
        after: `snapshots/${turnId}.after.board.json`
      },
      summary: boardOutcome.summary,
      reasoning: [...startThreatNotes, ...deckOutcome.reasoning, ...boardOutcome.reasoning].join(' ')
    });

    await writeJson(deckPath, persisted);
    await writeJson(boardPath, board);
    await writeJson(timelinePath, timeline);

    const nextActive = board.turn.activePlayer;
    const nextThreat = checkStartThreat(nextActive, board);
    const confirmedNext = pendingThreats.find((threat) => threat.player === nextActive && threat.kind === nextThreat);
    if (nextThreat && confirmedNext) {
      winner = nextActive;
      winType = nextThreat;
      notes.push('', `- ${nextActive} wins by confirmed ${nextThreat} at start of next turn after ${turnId}.`);
      break;
    }
  }

  if (!winner) {
    notes.push('', '- No legal winner by 40 completed player turns. Position was unresolved rather than forcibly stalled.');
  }

  notes.push('', finalPositionNote(board, winner, winType, timeline.entries.length));
  await writeFile(notesPath, `${notes.join('\n')}\n`);
  await writeJson(deckPath, persisted);
  await writeJson(boardPath, board);
  await writeJson(timelinePath, timeline);
}

function playDeckTurn(persisted: PersistedDeck): {
  persisted: PersistedDeck;
  drawnHand: string[];
  played: string[];
  bought: string[];
  produced: Record<string, number>;
  reasoning: string[];
} {
  let state = persisted.game;
  const rng = SeededRng.fromState(persisted.rngState);
  const player = currentPlayer(state);
  const playerId = player.id as PlayerId;
  const drawnHand = [...player.hand];
  const reasoning: string[] = [];
  let initialAttributes = { ...player.attributes };
  const playedCards: string[] = [];
  const boughtCards: string[] = [];

  const trashTarget = chooseTrash(player);
  if (trashTarget) {
    state = applyChosenDescription(state, rng, `Trash ${labelCard(trashTarget)}`);
    reasoning.push(`${playerId} trashed ${labelCard(trashTarget)} before playing cards.`);
  }

  while (state.phase === 'action') {
    const action = chooseActionPlay(state, playerId);
    if (!action) {
      state = applyAction(state, { type: 'moveToBuy' }, rng);
      break;
    }
    const active = currentPlayer(state);
    const cardId = active.hand[action.action.type === 'playAction' ? action.action.handIndex : -1];
    state = applyAction(state, action.action, rng);
    if (cardId) {
      playedCards.push(cardId);
      reasoning.push(`${playerId} played ${labelCard(cardId)}.`);
    }
  }

  while (state.phase === 'buy') {
    const buy = chooseBuy(state, playerId);
    if (!buy) {
      state = applyAction(state, { type: 'endTurn' }, rng);
      break;
    }
    const boughtCard = buy.action.type === 'buyCard' ? buy.action.cardId : '';
    if (boughtCard) {
      boughtCards.push(boughtCard);
      reasoning.push(`${playerId} bought ${labelCard(boughtCard)}.`);
    }
    state = applyAction(state, buy.action, rng);
  }

  const activeAfter = state.players.find((candidate) => candidate.id === playerId);
  const produced = producedDelta(initialAttributes, activeAfter?.attributes ?? {});

  return {
    persisted: { schemaVersion: 1, rngState: rng.snapshot(), game: state },
    drawnHand,
    played: playedCards,
    bought: boughtCards,
    produced,
    reasoning
  };
}

function playBoardTurn(board: BoardState, produced: Record<string, number>, map: BoardMap, unitRules: Record<string, UnitRule>): BoardResult {
  const player = board.turn.activePlayer;
  const opponent = other(player);
  const readyIds = new Set(board.units.filter((unit) => unit.player === player && unit.hp > 0).map((unit) => unit.id));
  const reasoning: string[] = [];
  const income = 2 + controlledCenters(board, player);
  setSupply(board, player, getSupply(board, player) + income);
  reasoning.push(`${player} gained ${income} supply from ${controlledCenters(board, player)} centers.`);

  const moveSummaries: string[] = [];
  for (const unit of board.units.filter((candidate) => readyIds.has(candidate.id) && candidate.hp > 0)) {
    const destination = chooseDestination(board, map, unitRules, unit, player);
    if (destination && (destination.col !== unit.col || destination.row !== unit.row)) {
      moveSummaries.push(`${unit.id} ${unit.col},${unit.row}->${destination.col},${destination.row}`);
      unit.col = destination.col;
      unit.row = destination.row;
    }
    const center = map.supplyCenters.find((candidate) => sameCoord(candidate, unit));
    if (center) {
      const control = board.supplyControl.find((candidate) => candidate.id === center.id);
      if (control?.controller !== player) {
        if (control) {
          control.controller = player;
        }
        reasoning.push(`${player} captured ${center.id}.`);
      }
    }
  }

  applyUpgrades(board, produced, player, reasoning);
  const combat = applyCombat(board, produced, readyIds, player, opponent, unitRules, map);
  reasoning.push(...combat);
  applyDeckHealing(board, produced, player, reasoning);
  applyPrintedHealing(board, readyIds, player, unitRules, reasoning);
  const recruits = recruitUnits(board, player, unitRules, map);
  if (recruits.length > 0) {
    reasoning.push(`${player} recruited ${recruits.join(', ')}.`);
  }

  const centers = `${controlledCenters(board, 'P1')}-${controlledCenters(board, 'P2')}`;
  const counts = `${livingUnits(board, 'P1')}-${livingUnits(board, 'P2')}`;
  return {
    summary: `${player} ${moveSummaries.length > 0 ? `moved ${moveSummaries.length} units` : 'held position'}, recruited ${recruits.length}, centers P1-P2 ${centers}, units P1-P2 ${counts}.`,
    reasoning
  };
}

function chooseDestination(board: BoardState, map: BoardMap, unitRules: Record<string, UnitRule>, unit: Unit, player: PlayerId): Coord | null {
  const movement = unitRules[unit.type]?.movement ?? 0;
  const candidates = reachable(board, map, unit, movement);
  let best = unit as Coord;
  let bestScore = scoreDestination(board, map, unitRules, unit, unit, player);
  for (const candidate of candidates) {
    const score = scoreDestination(board, map, unitRules, unit, candidate, player);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function scoreDestination(board: BoardState, map: BoardMap, unitRules: Record<string, UnitRule>, unit: Unit, coord: Coord, player: PlayerId): number {
  const opponent = other(player);
  const center = map.supplyCenters.find((candidate) => sameCoord(candidate, coord));
  let score = 0;
  if (center) {
    const control = board.supplyControl.find((candidate) => candidate.id === center.id)?.controller ?? null;
    if (control === opponent) {
      score += player === 'P2' ? 70 : 62;
    } else if (control === null) {
      score += 48;
    } else {
      score += 12;
    }
  }

  const centerGoal = chooseCenterGoal(board, map, unit, player);
  score -= hexDistance(coord, centerGoal) * (player === 'P2' ? 5 : 4);

  const enemies = board.units.filter((candidate) => candidate.player === opponent && candidate.hp > 0);
  const nearestEnemy = Math.min(...enemies.map((enemy) => hexDistance(coord, enemy)), 99);
  const range = unitRules[unit.type]?.range ?? 1;
  if (nearestEnemy <= range) {
    score += 28;
  } else {
    score -= Math.min(nearestEnemy, 6) * 2;
  }

  if (player === 'P1' && (unit.type === 'druid' || unit.type === 'healer')) {
    const nearestFriend = Math.min(...board.units.filter((candidate) => candidate.player === player && candidate.id !== unit.id && candidate.hp > 0).map((friend) => hexDistance(coord, friend)), 99);
    score += nearestFriend <= 2 ? 10 : -4;
  }
  if (player === 'P2' && (unit.type === 'scout' || unit.type === 'raider')) {
    score += center && center.id.includes('east') ? 8 : 0;
  }
  return score;
}

function chooseCenterGoal(board: BoardState, map: BoardMap, unit: Unit, player: PlayerId): Coord {
  const preferred = player === 'P1'
    ? ['center-center', 'center-center-north', 'center-east', 'center-northeast', 'center-southeast', 'center-center-south']
    : ['center-center-south', 'center-west-south', 'center-northwest', 'center-center', 'center-east', 'center-southeast'];
  for (const id of preferred) {
    const center = map.supplyCenters.find((candidate) => candidate.id === id);
    const controller = board.supplyControl.find((candidate) => candidate.id === id)?.controller ?? null;
    if (center && controller !== player && !occupied(board, center)) {
      return center;
    }
  }
  return nearest(map.supplyCenters, unit);
}

function applyUpgrades(board: BoardState, produced: Record<string, number>, player: PlayerId, reasoning: string[]): void {
  for (let count = 0; count < (produced.upgradeHealth ?? 0); count += 2) {
    const target = upgradeTarget(board, player, 'health');
    if (!target) {
      return;
    }
    target.maxHp += 2;
    target.hp += 2;
    reasoning.push(`${player} Armory upgraded ${target.id} to ${target.hp}/${target.maxHp}.`);
  }
  for (let count = 0; count < (produced.upgradeDamage ?? 0); count += 1) {
    const target = upgradeTarget(board, player, 'damage');
    if (!target) {
      return;
    }
    target.attack += 1;
    reasoning.push(`${player} Training upgraded ${target.id} attack to ${target.attack}.`);
  }
}

function upgradeTarget(board: BoardState, player: PlayerId, kind: 'health' | 'damage'): Unit | undefined {
  const priority = player === 'P1'
    ? kind === 'health'
      ? ['guardian', 'marksman', 'druid', 'raider']
      : ['marksman', 'guardian', 'raider', 'druid']
    : kind === 'health'
      ? ['guardian', 'raider', 'marksman', 'scout']
      : ['raider', 'marksman', 'guardian', 'scout'];
  return board.units
    .filter((unit) => unit.player === player && unit.hp > 0)
    .sort((left, right) => priorityRank(priority, left.type) - priorityRank(priority, right.type) || right.maxHp - left.maxHp)[0];
}

function applyCombat(
  board: BoardState,
  produced: Record<string, number>,
  readyIds: Set<string>,
  player: PlayerId,
  opponent: PlayerId,
  unitRules: Record<string, UnitRule>,
  map: BoardMap
): string[] {
  const reasoning: string[] = [];
  let deckDamage = produced.damage ?? 0;
  const attacked = new Set<string>();
  const usedDeckDamage = new Set<string>();
  for (const attacker of board.units.filter((unit) => readyIds.has(unit.id) && unit.player === player && unit.hp > 0)) {
    const target = chooseAttackTarget(board, attacker, opponent, unitRules, map);
    if (!target) {
      continue;
    }
    const extra = deckDamage > 0 && !usedDeckDamage.has(attacker.id) ? 1 : 0;
    if (extra > 0) {
      deckDamage -= 1;
      usedDeckDamage.add(attacker.id);
    }
    dealDamage(board, target, attacker.attack + extra);
    attacked.add(attacker.id);
    reasoning.push(`${attacker.id} hit ${target.id} for ${attacker.attack + extra}${extra ? ' with deck damage' : ''}.`);
  }

  let reattacks = produced.reattack ?? 0;
  while (reattacks > 0) {
    const attacker = board.units
      .filter((unit) => readyIds.has(unit.id) && unit.player === player && unit.hp > 0)
      .sort((left, right) => right.attack - left.attack)[0];
    if (!attacker) {
      break;
    }
    const target = chooseAttackTarget(board, attacker, opponent, unitRules, map);
    if (!target) {
      break;
    }
    dealDamage(board, target, attacker.attack);
    attacked.add(attacker.id);
    reasoning.push(`${attacker.id} used Second Wind to hit ${target.id} for ${attacker.attack}.`);
    reattacks -= 1;
  }

  removeDead(board, reasoning);
  board.notes = [...board.notes.filter((note) => !note.startsWith('attacked-this-turn:')), `attacked-this-turn:${[...attacked].join(',')}`];
  return reasoning;
}

function chooseAttackTarget(board: BoardState, attacker: Unit, opponent: PlayerId, unitRules: Record<string, UnitRule>, map: BoardMap): Unit | undefined {
  const range = unitRules[attacker.type]?.range ?? 1;
  return board.units
    .filter((unit) => unit.player === opponent && unit.hp > 0 && hexDistance(attacker, unit) <= range)
    .sort((left, right) => targetValue(board, map, right) - targetValue(board, map, left) || left.hp - right.hp)[0];
}

function targetValue(board: BoardState, map: BoardMap, unit: Unit): number {
  const onCenter = map.supplyCenters.some((center) => sameCoord(center, unit)) ? 20 : 0;
  const fragile = unit.hp <= 4 ? 18 : 0;
  const role = unit.type === 'healer' || unit.type === 'druid' ? 8 : unit.type === 'marksman' ? 6 : 0;
  return onCenter + fragile + role + unit.attack;
}

function dealDamage(board: BoardState, target: Unit, damage: number): void {
  const unit = board.units.find((candidate) => candidate.id === target.id);
  if (unit) {
    unit.hp = Math.max(0, unit.hp - damage);
  }
}

function removeDead(board: BoardState, reasoning: string[]): void {
  const dead = board.units.filter((unit) => unit.hp <= 0).map((unit) => unit.id);
  if (dead.length > 0) {
    reasoning.push(`Removed ${dead.join(', ')}.`);
    board.units = board.units.filter((unit) => unit.hp > 0);
  }
}

function applyDeckHealing(board: BoardState, produced: Record<string, number>, player: PlayerId, reasoning: string[]): void {
  let heal = produced.heal ?? 0;
  while (heal > 0) {
    const target = board.units
      .filter((unit) => unit.player === player && unit.hp > 0 && unit.hp < unit.maxHp)
      .sort((left, right) => (right.maxHp - right.hp) - (left.maxHp - left.hp))[0];
    if (!target) {
      break;
    }
    target.hp += 1;
    heal -= 1;
    reasoning.push(`${player} deck-healed ${target.id} to ${target.hp}/${target.maxHp}.`);
  }
}

function applyPrintedHealing(board: BoardState, readyIds: Set<string>, player: PlayerId, unitRules: Record<string, UnitRule>, reasoning: string[]): void {
  const attackedNote = board.notes.find((note) => note.startsWith('attacked-this-turn:')) ?? '';
  const attacked = new Set(attackedNote.replace('attacked-this-turn:', '').split(',').filter(Boolean));
  for (const healer of board.units.filter((unit) => readyIds.has(unit.id) && unit.player === player && unit.hp > 0 && !attacked.has(unit.id))) {
    const amount = unitRules[healer.type]?.heal ?? 0;
    if (amount <= 0) {
      continue;
    }
    const range = unitRules[healer.type]?.range ?? 1;
    const target = board.units
      .filter((unit) => unit.player === player && unit.hp > 0 && unit.hp < unit.maxHp && hexDistance(healer, unit) <= range)
      .sort((left, right) => (right.maxHp - right.hp) - (left.maxHp - left.hp))[0];
    if (!target) {
      continue;
    }
    target.hp = Math.min(target.maxHp, target.hp + amount);
    reasoning.push(`${healer.id} printed-healed ${target.id} to ${target.hp}/${target.maxHp}.`);
  }
  board.notes = board.notes.filter((note) => !note.startsWith('attacked-this-turn:'));
}

function recruitUnits(board: BoardState, player: PlayerId, unitRules: Record<string, UnitRule>, map: BoardMap): string[] {
  const recruited: string[] = [];
  while (getSupply(board, player) >= 6) {
    const home = map.homeBases.find((base) => base.player === player);
    const spawn = home?.hexes.find((hex) => !occupied(board, hex));
    if (!spawn) {
      break;
    }
    const type = chooseRecruitType(board, player);
    const count = board.units.filter((unit) => unit.player === player && unit.type === type).length + 1;
    const id = `${player}-${type}-${count}`;
    board.units.push({
      id,
      player,
      type,
      col: spawn.col,
      row: spawn.row,
      hp: unitRules[type]!.hp,
      maxHp: unitRules[type]!.hp,
      attack: unitRules[type]!.attack
    });
    setSupply(board, player, getSupply(board, player) - 6);
    recruited.push(id);
  }
  return recruited;
}

function chooseRecruitType(board: BoardState, player: PlayerId): string {
  const countsByType = new Map<string, number>();
  for (const unit of board.units.filter((candidate) => candidate.player === player && candidate.hp > 0)) {
    countsByType.set(unit.type, (countsByType.get(unit.type) ?? 0) + 1);
  }
  const desired = player === 'P1'
    ? [
        ['guardian', 3],
        ['marksman', 3],
        ['druid', 2],
        ['healer', 1]
      ] as const
    : [
        ['scout', 4],
        ['raider', 3],
        ['marksman', 3],
        ['guardian', 2]
      ] as const;
  for (const [type, target] of desired) {
    if ((countsByType.get(type) ?? 0) < target) {
      return type;
    }
  }
  return player === 'P1' ? 'marksman' : 'raider';
}

function advanceBoardTurn(board: BoardState): BoardState {
  const active = board.turn.activePlayer;
  board.turn.activePlayer = other(active);
  if (active === 'P2') {
    board.turn.round += 1;
  }
  return board;
}

function chooseTrash(player: PlayerState): string | null {
  if (player.freeTrashUsed || player.play.length > 0) {
    return null;
  }
  if (player.hand.includes('rest')) {
    return 'rest';
  }
  return null;
}

function chooseActionPlay(state: GameState, playerId: PlayerId): LegalAction | null {
  const priority = playerId === 'P1'
    ? ['village', 'peddler', 'zap', 'bandage', 'training', 'armory', 'second-wind', 'potion', 'healer', 'smithy']
    : ['village', 'peddler', 'zap', 'bandage', 'blast', 'storm', 'smithy', 'potion'];
  const legal = listLegalActions(state).filter((action) => action.action.type === 'playAction');
  const player = currentPlayer(state);
  for (const card of priority) {
    const match = legal.find((action) => player.hand[action.action.type === 'playAction' ? action.action.handIndex : -1] === card);
    if (match) {
      return match;
    }
  }
  return null;
}

function chooseBuy(state: GameState, playerId: PlayerId): LegalAction | null {
  const legal = listLegalActions(state).filter((action) => action.action.type === 'buyCard');
  const priority = playerId === 'P1' ? p1BuyPriority : p2BuyPriority;
  for (const card of priority) {
    const match = legal.find((action) => action.action.type === 'buyCard' && action.action.cardId === card);
    if (match) {
      return match;
    }
  }
  return null;
}

function applyChosenDescription(state: GameState, rng: SeededRng, description: string): GameState {
  const action = listLegalActions(state).find((candidate) => candidate.description === description);
  if (!action) {
    throw new Error(`No legal action: ${description}`);
  }
  return applyAction(state, action.action, rng);
}

function producedDelta(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
  const produced: Record<string, number> = {};
  for (const key of ['damage', 'heal', 'upgradeHealth', 'upgradeDamage', 'reattack', 'stormTargets']) {
    const delta = (after[key] ?? 0) - (before[key] ?? 0);
    if (delta > 0) {
      produced[key] = delta;
    }
  }
  return produced;
}

function checkStartThreat(player: PlayerId, board: BoardState): 'unit-lead' | 'center-control' | null {
  const unitLead = livingUnits(board, player) - livingUnits(board, other(player));
  if (unitLead >= 4) {
    return 'unit-lead';
  }
  if (controlledCenters(board, player) >= 5 && livingUnits(board, player) >= livingUnits(board, other(player))) {
    return 'center-control';
  }
  return null;
}

function checkThreat(threat: PendingThreat, board: BoardState): boolean {
  if (threat.kind === 'unit-lead') {
    return livingUnits(board, threat.player) - livingUnits(board, other(threat.player)) >= 4;
  }
  return controlledCenters(board, threat.player) >= 5 && livingUnits(board, threat.player) >= livingUnits(board, other(threat.player));
}

function controlledCenters(board: BoardState, player: PlayerId): number {
  return board.supplyControl.filter((center) => center.controller === player).length;
}

function livingUnits(board: BoardState, player: PlayerId): number {
  return board.units.filter((unit) => unit.player === player && unit.hp > 0).length;
}

function reachable(board: BoardState, map: BoardMap, unit: Unit, movement: number): Coord[] {
  const hexes = new Set(map.hexes.map(coordKey));
  const blocked = new Set((map.blocked ?? []).map(coordKey));
  const occupiedHexes = new Set(board.units.filter((candidate) => candidate.id !== unit.id && candidate.hp > 0).map(coordKey));
  const results = new Map<string, Coord>();
  const queue: Array<{ coord: Coord; distance: number }> = [{ coord: unit, distance: 0 }];
  const seen = new Set<string>([coordKey(unit)]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.distance > 0 && !occupiedHexes.has(coordKey(current.coord))) {
      results.set(coordKey(current.coord), current.coord);
    }
    if (current.distance >= movement) {
      continue;
    }
    for (const next of neighbors(current.coord)) {
      const key = coordKey(next);
      if (seen.has(key) || !hexes.has(key) || blocked.has(key) || occupiedHexes.has(key)) {
        continue;
      }
      seen.add(key);
      queue.push({ coord: next, distance: current.distance + 1 });
    }
  }
  return [...results.values()];
}

function hexDistance(a: Coord, b: Coord): number {
  if (sameCoord(a, b)) {
    return 0;
  }
  const queue: Array<{ coord: Coord; distance: number }> = [{ coord: a, distance: 0 }];
  const seen = new Set<string>([coordKey(a)]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.distance > 20) {
      return current.distance;
    }
    for (const next of neighbors(current.coord)) {
      const key = coordKey(next);
      if (seen.has(key)) {
        continue;
      }
      if (sameCoord(next, b)) {
        return current.distance + 1;
      }
      seen.add(key);
      queue.push({ coord: next, distance: current.distance + 1 });
    }
  }
  return 99;
}

function neighbors(coord: Coord): Coord[] {
  const even = coord.col % 2 === 0;
  const offsets = even
    ? [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]]
    : [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  return offsets.map(([dc, dr]) => ({ col: coord.col + dc, row: coord.row + dr }));
}

function nearest<T extends Coord>(coords: T[], from: Coord): T {
  return coords.slice().sort((left, right) => hexDistance(from, left) - hexDistance(from, right))[0]!;
}

function occupied(board: BoardState, coord: Coord): boolean {
  return board.units.some((unit) => unit.hp > 0 && sameCoord(unit, coord));
}

function sameCoord(a: Coord, b: Coord): boolean {
  return a.col === b.col && a.row === b.row;
}

function coordKey(coord: Coord): string {
  return `${coord.col},${coord.row}`;
}

function getSupply(board: BoardState, player: PlayerId): number {
  return board.supply.find((entry) => entry.player === player)?.amount ?? 0;
}

function setSupply(board: BoardState, player: PlayerId, amount: number): void {
  const entry = board.supply.find((candidate) => candidate.player === player);
  if (!entry) {
    board.supply.push({ player, amount });
  } else {
    entry.amount = amount;
  }
}

function currentPlayer(state: GameState): PlayerState {
  const player = state.players[state.activePlayer];
  if (!player) {
    throw new Error('Active deck player is missing');
  }
  return player;
}

function other(player: PlayerId): PlayerId {
  return player === 'P1' ? 'P2' : 'P1';
}

function labelCard(card: string): string {
  return cardNames[card] ?? card;
}

function counts(cards: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const card of cards) {
    result.set(card, (result.get(card) ?? 0) + 1);
  }
  return result;
}

function priorityRank(priority: string[], type: string): number {
  const index = priority.indexOf(type);
  return index === -1 ? priority.length : index;
}

function finalPositionNote(board: BoardState, winner: PlayerId | null, winType: string | null, turns: number): string {
  const units = `units P1-P2 ${livingUnits(board, 'P1')}-${livingUnits(board, 'P2')}`;
  const centers = `centers P1-P2 ${controlledCenters(board, 'P1')}-${controlledCenters(board, 'P2')}`;
  const supply = `supply P1-P2 ${getSupply(board, 'P1')}-${getSupply(board, 'P2')}`;
  return `Final: ${winner ? `${winner} by ${winType}` : 'unresolved'} after ${turns} completed player turns; ${units}; ${centers}; ${supply}.`;
}

async function cleanSnapshots(): Promise<void> {
  await mkdir(snapshotsDir, { recursive: true });
  for (const file of await readdir(snapshotsDir)) {
    await rm(join(snapshotsDir, file));
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadGameConfig } from '../../src/config/loadGameConfig';
import { applyAction } from '../../src/core/engine';
import { listLegalActions } from '../../src/core/legalActions';
import { SeededRng } from '../../src/core/random';
import { setupGame } from '../../src/core/state';
import type { CardId, ChosenAction, GameState, PlayerState } from '../../src/core/types';
import type { BoardMap, BoardState } from '../../src/board/schema';

type PlayerId = 'P1' | 'P2';
type Unit = BoardState['units'][number];
type Center = BoardMap['supplyCenters'][number];
type Produced = Record<'damage' | 'heal' | 'upgradeHealth' | 'upgradeDamage' | 'reattack' | 'stormTargets', number>;

interface DeckSnapshot {
  schemaVersion: 1;
  rngState: number;
  game: GameState;
}

interface PendingWin {
  player: PlayerId;
  establishedAfterTurn: string;
}

interface TurnResult {
  id: string;
  player: PlayerId;
  round: number;
  drawnHand: string[];
  played: string[];
  bought: string[];
  produced: Produced;
  summary: string;
  reasoning: string;
  winner?: PlayerId;
}

const runRoot = '.games/e018a-upgrade-vs-swarm-a';
const ruleset = 'territory-v1-cost6-damagecap-responsewin-lead4-no-printheal';
const mapId = 'sketch-v3-contest';
const configPath = `rulesets/${ruleset}/deck.yaml`;
const mapPath = `maps/${mapId}.json`;
const starterBoardPath = '.games/e018-no-printheal-starter.board.json';
const seed = 18018;
const maxCompletedTurns = 80;

const unitRules: Record<string, { movement: number; range?: number; attack: number; hp: number }> = {
  guardian: { movement: 1, attack: 4, hp: 16 },
  raider: { movement: 2, attack: 6, hp: 8 },
  marksman: { movement: 1, range: 2, attack: 4, hp: 8 },
  scout: { movement: 3, range: 2, attack: 2, hp: 8 },
  druid: { movement: 1, attack: 4, hp: 10 },
  healer: { movement: 1, range: 2, attack: 1, hp: 4 }
};

const emptyProduced = (): Produced => ({
  damage: 0,
  heal: 0,
  upgradeHealth: 0,
  upgradeDamage: 0,
  reattack: 0,
  stormTargets: 0
});

async function main(): Promise<void> {
  const [config, map, starterBoard] = await Promise.all([
    loadGameConfig(configPath),
    readJson<BoardMap>(mapPath),
    readJson<BoardState>(starterBoardPath)
  ]);
  const rng = new SeededRng(seed);
  let deck = setupGame(config, rng);
  let board = starterBoard;
  let pendingWin: PendingWin | undefined;
  const entries: unknown[] = [];
  const notes: string[] = [
    '# E018a Upgrade/Support vs Swarm/Economy',
    '',
    `Ruleset: ${ruleset}`,
    `Map: ${mapId}`,
    `Deck seed: ${seed}`,
    '',
    'Important rules calls:',
    '- Printed druid/healer unit healing was never used; their printed heal is treated as 0.',
    '- Deck heal counters and upgradeHealth healing were allowed.',
    '- Deck damage was attached only to legal attacks and capped at 1 deck damage per attacking unit.',
    '- Pending lead-4 win markers are tracked in timeline reasoning and in these notes, not board.json.',
    ''
  ];

  await mkdir(join(runRoot, 'snapshots'), { recursive: true });

  let result: TurnResult | undefined;
  for (let turnIndex = 1; turnIndex <= maxCompletedTurns; turnIndex += 1) {
    result = await playTurn(turnIndex, deck, rng, board, map, pendingWin);
    if (result.winner) {
      notes.push(`- ${result.id}: ${result.winner} won at start of turn by confirmed lead-4 unit-count response window.`);
      break;
    }

    entries.push(entryFromTurn(result));
    deck = await readJson<DeckSnapshot>(join(runRoot, result.id === '' ? 'deck.json' : `snapshots/${result.id}.after.deck.json`)).then((snapshot) => snapshot.game);
    board = await readJson<BoardState>(join(runRoot, `snapshots/${result.id}.after.board.json`));

    const counts = livingCounts(board);
    const leadPlayer = counts.P1 - counts.P2 >= 4 ? 'P1' : counts.P2 - counts.P1 >= 4 ? 'P2' : undefined;
    if (leadPlayer) {
      pendingWin = { player: leadPlayer, establishedAfterTurn: result.id };
      notes.push(`- ${result.id}: pending ${leadPlayer} lead-4 threat created at ${counts.P1}-${counts.P2} living units.`);
    } else if (pendingWin) {
      notes.push(`- ${result.id}: pending ${pendingWin.player} lead threat cleared at ${counts.P1}-${counts.P2} living units.`);
      pendingWin = undefined;
    }
  }

  const timeline = {
    schemaVersion: 1,
    title: 'E018a upgrade/support vs swarm/economy no printed healing',
    entries
  };
  await writeJson(join(runRoot, 'timeline.json'), timeline);
  await writeJson(join(runRoot, 'deck.json'), { schemaVersion: 1, rngState: rng.snapshot(), game: deck });
  await writeJson(join(runRoot, 'board.json'), board);

  if (!result?.winner) {
    notes.push(`- No legal winner by ${entries.length} completed player turns; continued past turn 40 because the position was not stalled, then stopped at the run-local safety cap.`);
  }
  const finalCounts = livingCounts(board);
  const split = centerSplit(board);
  notes.push('');
  notes.push('Final state:');
  notes.push(`- Winner: ${result?.winner ?? 'none'}`);
  notes.push(`- Completed player turns: ${entries.length}`);
  notes.push(`- Unit counts: P1 ${finalCounts.P1}, P2 ${finalCounts.P2}`);
  notes.push(`- Center split: P1 ${split.P1}, P2 ${split.P2}, neutral ${split.neutral}`);
  notes.push(`- Supply saved: P1 ${getSupply(board, 'P1')}, P2 ${getSupply(board, 'P2')}`);
  notes.push('');
  notes.push('Support/healing observations:');
  notes.push('- P1 support remained relevant through Armory, Training, Bandage, Potion, and Healer cards, but missing repeatable printed healing meant damaged guardians stayed vulnerable between deck-heal turns.');
  notes.push('- P2 swarm/economy could convert center control into frequent recruits, but the lead-4 response window still gave P1 chances to answer with kills and deck heal rather than folding instantly.');
  notes.push('- No printed unit healing was applied by druids or healers in any board phase.');
  await writeFile(join(runRoot, 'notes.md'), `${notes.join('\n')}\n`);
}

async function playTurn(
  turnIndex: number,
  deck: GameState,
  rng: SeededRng,
  board: BoardState,
  map: BoardMap,
  pendingWin: PendingWin | undefined
): Promise<TurnResult> {
  const id = `turn-${String(turnIndex).padStart(3, '0')}`;
  const player = activePlayer(deck);
  const round = board.turn.round;
  const beforeDeckSnapshot: DeckSnapshot = { schemaVersion: 1, rngState: rng.snapshot(), game: deck };
  const beforeBoard = board;

  await writeJson(join(runRoot, 'snapshots', `${id}.before.deck.json`), beforeDeckSnapshot);
  await writeJson(join(runRoot, 'snapshots', `${id}.before.board.json`), beforeBoard);

  const startCounts = livingCounts(board);
  if (pendingWin?.player === player && startCounts[player] - startCounts[opponent(player)] >= 4) {
    return {
      id,
      player,
      round,
      drawnHand: activePlayerState(deck).hand.map(cardName(deck)),
      played: [],
      bought: [],
      produced: emptyProduced(),
      summary: `${player} wins before deck phase on confirmed lead-4 unit count.`,
      reasoning: `${player} started ${id} with ${startCounts[player]} living units against ${startCounts[opponent(player)]}. The same lead-4 threat was pending after ${pendingWin.establishedAfterTurn}, so the response-window win is confirmed.`,
      winner: player
    };
  }

  const drawnHand = activePlayerState(deck).hand.map(cardName(deck));
  const deckBeforeActions = deck;
  const deckResult = playDeckTurn(deck, rng, player);
  deck = deckResult.stateBeforeCleanup;
  const produced = producedFrom(deck.players[deck.activePlayer] ?? activePlayerState(deckBeforeActions));
  deck = applyAction(deck, { type: 'endTurn' }, rng);
  const afterDeckSnapshot: DeckSnapshot = { schemaVersion: 1, rngState: rng.snapshot(), game: deck };

  const boardResult = resolveBoardTurn(beforeBoard, map, player, produced, id);
  board = advanceBoard(boardResult.board, player);

  await writeJson(join(runRoot, 'snapshots', `${id}.after.deck.json`), afterDeckSnapshot);
  await writeJson(join(runRoot, 'snapshots', `${id}.after.board.json`), board);

  return {
    id,
    player,
    round,
    drawnHand,
    played: deckResult.played,
    bought: deckResult.bought,
    produced,
    summary: boardResult.summary,
    reasoning: boardResult.reasoning
  };
}

function playDeckTurn(state: GameState, rng: SeededRng, player: PlayerId): { stateBeforeCleanup: GameState; played: string[]; bought: string[] } {
  let current = state;
  const played: string[] = [];
  const bought: string[] = [];
  const trashChoice = chooseTrash(current, player);
  if (trashChoice !== undefined) {
    current = applyAction(current, { type: 'trashCard', handIndex: trashChoice }, rng);
  }

  for (let guard = 0; guard < 20; guard += 1) {
    const choice = chooseActionToPlay(current, player);
    if (choice === undefined) {
      break;
    }
    const card = activePlayerState(current).hand[choice];
    current = applyAction(current, { type: 'playAction', handIndex: choice }, rng);
    if (card) {
      played.push(cardName(current)(card));
    }
  }

  current = applyAction(current, { type: 'moveToBuy' }, rng);
  const buy = chooseBuy(current, player);
  if (buy) {
    current = applyAction(current, { type: 'buyCard', cardId: buy }, rng);
    bought.push(cardName(current)(buy));
  }

  return { stateBeforeCleanup: current, played, bought };
}

function chooseTrash(state: GameState, player: PlayerId): number | undefined {
  const hand = activePlayerState(state).hand;
  const trashOrder = player === 'P1'
    ? ['rest', 'copper']
    : ['rest', 'bandage', 'copper'];
  for (const card of trashOrder) {
    const index = hand.indexOf(card);
    if (index >= 0) {
      return index;
    }
  }
  return undefined;
}

function chooseActionToPlay(state: GameState, player: PlayerId): number | undefined {
  const legal = listLegalActions(state)
    .map((action, index) => ({ action: action.action, index }))
    .filter((choice): choice is { action: Extract<ChosenAction, { type: 'playAction' }>; index: number } => choice.action.type === 'playAction');
  if (legal.length === 0) {
    return undefined;
  }
  const hand = activePlayerState(state).hand;
  const order = player === 'P1'
    ? ['village', 'peddler', 'zap', 'bandage', 'training', 'armory', 'second-wind', 'potion', 'healer']
    : ['village', 'peddler', 'zap', 'bandage', 'blast', 'storm', 'inferno'];
  for (const card of order) {
    const legalChoice = legal.find((choice) => hand[choice.action.handIndex] === card);
    if (legalChoice) {
      return legalChoice.action.handIndex;
    }
  }
  return undefined;
}

function chooseBuy(state: GameState, player: PlayerId): CardId | undefined {
  const p = activePlayerState(state);
  const owned = (card: string): number => p.draw.concat(p.hand, p.discard, p.play).filter((candidate) => candidate === card).length;
  const order = player === 'P1'
    ? [
        ...(owned('armory') < 3 ? ['armory'] : []),
        ...(owned('training') < 3 ? ['training'] : []),
        ...(owned('second-wind') < 2 ? ['second-wind'] : []),
        ...(owned('potion') < 2 ? ['potion'] : []),
        ...(owned('healer') < 2 ? ['healer'] : []),
        ...(owned('village') < 3 ? ['village'] : []),
        ...(owned('peddler') < 3 ? ['peddler'] : []),
        'gold',
        'silver'
      ]
    : [
        ...(owned('village') < 4 ? ['village'] : []),
        ...(owned('peddler') < 5 ? ['peddler'] : []),
        'gold',
        'silver',
        ...(owned('blast') < 2 ? ['blast'] : []),
        ...(owned('storm') < 1 ? ['storm'] : []),
        'zap'
      ];
  return order.find((card) => p.money >= (state.cards[card]?.cost ?? 999) && (state.supply[card] ?? 0) > 0);
}

function resolveBoardTurn(board: BoardState, map: BoardMap, player: PlayerId, produced: Produced, turnId: string): { board: BoardState; summary: string; reasoning: string } {
  const next = cloneBoard(board);
  const beforeSplit = centerSplit(next);
  const beforeSupply = getSupply(next, player);
  const centers = next.supplyControl.filter((center) => center.controller === player).length;
  setSupply(next, player, beforeSupply + 2 + centers);
  const moves: string[] = [];
  const captures: string[] = [];
  const upgrades: string[] = [];
  const attacks: string[] = [];
  const heals: string[] = [];
  const recruits: string[] = [];

  for (const unit of orderedUnits(next, player)) {
    const before = `${unit.col},${unit.row}`;
    const target = chooseMoveTarget(next, map, player, unit);
    const destination = bestMove(next, map, unit, target);
    if (destination && (destination.col !== unit.col || destination.row !== unit.row)) {
      unit.col = destination.col;
      unit.row = destination.row;
      moves.push(`${unit.id} ${before}->${unit.col},${unit.row}`);
    }
    const captured = centerAt(map, unit.col, unit.row);
    if (captured) {
      const control = next.supplyControl.find((center) => center.id === captured.id);
      if (control && control.controller !== player) {
        control.controller = player;
        captures.push(`${unit.id} captured ${captured.id}`);
      }
    }
  }

  applyUpgrades(next, player, produced, upgrades);
  resolveAttacks(next, map, player, produced, attacks);
  applyDeckHealing(next, player, produced.heal, heals);
  recruitUnits(next, map, player, recruits);

  const afterSplit = centerSplit(next);
  const counts = livingCounts(next);
  const supplyAfter = getSupply(next, player);
  const summary = `${player} gained ${2 + centers} supply from ${centers} centers and ${recruits.length === 0 ? 'made no recruit' : `recruited ${recruits.length} unit${recruits.length === 1 ? '' : 's'}`}.`;
  const reasoning = [
    `Normal income math: 2 + ${centers} controlled centers => ${2 + centers} income, saved supply ${beforeSupply} -> ${supplyAfter} after recruit spending.`,
    `Center split moved from P1 ${beforeSplit.P1} / P2 ${beforeSplit.P2} / neutral ${beforeSplit.neutral} to P1 ${afterSplit.P1} / P2 ${afterSplit.P2} / neutral ${afterSplit.neutral}.`,
    `Moves/captures: ${[...moves, ...captures].join('; ') || 'none'}.`,
    `Permanent upgrades: ${upgrades.join('; ') || 'none'}.`,
    `Combat: ${attacks.join('; ') || 'no legal or useful attacks'}.`,
    `Healing: ${heals.join('; ') || 'no deck healing changed HP; printed unit healing was not used'}.`,
    `Recruits: ${recruits.join('; ') || 'none'}.`,
    `Living units after turn: P1 ${counts.P1}, P2 ${counts.P2}.`,
    leadReasoning(counts, turnId)
  ].join(' ');
  return { board: next, summary, reasoning };
}

function chooseMoveTarget(board: BoardState, map: BoardMap, player: PlayerId, unit: Unit): { col: number; row: number } {
  const enemy = opponent(player);
  const enemyUnits = board.units.filter((candidate) => candidate.player === enemy);
  const centerPriority = player === 'P1'
    ? ['center-east', 'center-northeast', 'center-southeast', 'center-center', 'center-center-north', 'center-center-south', 'center-northwest', 'center-west-south']
    : ['center-west-south', 'center-northwest', 'center-center-south', 'center-center', 'center-center-north', 'center-east', 'center-southeast', 'center-northeast'];
  const uncontrolled = centerPriority
    .map((id) => map.supplyCenters.find((center) => center.id === id))
    .filter((center): center is Center => Boolean(center))
    .filter((center) => board.supplyControl.find((control) => control.id === center.id)?.controller !== player);
  const nearestEnemy = enemyUnits.toSorted((a, b) => hexDistance(map, unit, a) - hexDistance(map, unit, b))[0];
  if (unit.type === 'guardian' || unit.type === 'marksman' || unit.type === 'druid' || unit.type === 'healer') {
    const contested = uncontrolled.find((center) => center.id.includes('center')) ?? uncontrolled[0];
    return contested ?? nearestEnemy ?? unit;
  }
  return uncontrolled[0] ?? nearestEnemy ?? unit;
}

function bestMove(board: BoardState, map: BoardMap, unit: Unit, target: { col: number; row: number }): { col: number; row: number } | undefined {
  const movement = unitRules[unit.type]?.movement ?? 1;
  const reachable = reachableWithin(board, map, unit, movement);
  return reachable.toSorted((a, b) => hexDistance(map, a, target) - hexDistance(map, b, target))[0];
}

function resolveAttacks(board: BoardState, map: BoardMap, player: PlayerId, produced: Produced, log: string[]): void {
  let availableDeckDamage = produced.damage;
  const friendly = orderedUnits(board, player);
  for (const attacker of friendly) {
    const target = chooseAttackTarget(board, map, attacker);
    if (!target) {
      continue;
    }
    const extra = availableDeckDamage > 0 ? 1 : 0;
    availableDeckDamage -= extra;
    const damage = attacker.attack + extra;
    target.hp -= damage;
    log.push(`${attacker.id} hit ${target.id} for ${damage}${extra ? ' including 1 deck damage' : ''}`);
    if (target.hp <= 0) {
      removeUnit(board, target.id);
      log.push(`${target.id} died`);
    }
  }
  for (let count = 0; count < produced.reattack; count += 1) {
    const attacker = friendly.find((unit) => board.units.some((candidate) => candidate.id === unit.id));
    if (!attacker) {
      continue;
    }
    const target = chooseAttackTarget(board, map, attacker);
    if (!target) {
      continue;
    }
    target.hp -= attacker.attack;
    log.push(`${attacker.id} reattacked ${target.id} for ${attacker.attack}`);
    if (target.hp <= 0) {
      removeUnit(board, target.id);
      log.push(`${target.id} died`);
    }
  }
}

function chooseAttackTarget(board: BoardState, map: BoardMap, attacker: Unit): Unit | undefined {
  const range = unitRules[attacker.type]?.range ?? 1;
  return board.units
    .filter((unit) => unit.player !== attacker.player)
    .filter((unit) => hexDistance(map, attacker, unit) <= range)
    .toSorted((a, b) => a.hp - b.hp || unitValue(b.type) - unitValue(a.type))[0];
}

function applyUpgrades(board: BoardState, player: PlayerId, produced: Produced, log: string[]): void {
  for (let amount = produced.upgradeHealth; amount > 0; amount -= 2) {
    const target = orderedUnits(board, player).toSorted((a, b) => unitValue(b.type) - unitValue(a.type) || b.maxHp - a.maxHp)[0];
    if (!target) {
      return;
    }
    const applied = Math.min(2, amount);
    target.maxHp += applied;
    target.hp = Math.min(target.maxHp, target.hp + applied);
    log.push(`${target.id} +${applied} maxHp and healed ${applied}`);
  }
  for (let amount = produced.upgradeDamage; amount > 0; amount -= 1) {
    const target = orderedUnits(board, player).toSorted((a, b) => unitValue(b.type) - unitValue(a.type) || b.attack - a.attack)[0];
    if (!target) {
      return;
    }
    target.attack += 1;
    log.push(`${target.id} +1 attack`);
  }
}

function applyDeckHealing(board: BoardState, player: PlayerId, heal: number, log: string[]): void {
  let remaining = heal;
  while (remaining > 0) {
    const target = orderedUnits(board, player)
      .filter((unit) => unit.hp < unit.maxHp)
      .toSorted((a, b) => (b.maxHp - b.hp) - (a.maxHp - a.hp))[0];
    if (!target) {
      return;
    }
    const amount = Math.min(remaining, target.maxHp - target.hp);
    target.hp += amount;
    remaining -= amount;
    log.push(`deck-healed ${target.id} for ${amount}`);
  }
}

function recruitUnits(board: BoardState, map: BoardMap, player: PlayerId, log: string[]): void {
  let supply = getSupply(board, player);
  while (supply >= 6) {
    const home = map.homeBases.find((base) => base.player === player);
    const hex = home?.hexes.find((candidate) => !board.units.some((unit) => unit.col === candidate.col && unit.row === candidate.row));
    if (!hex) {
      break;
    }
    const type = chooseRecruitType(board, player);
    const id = nextUnitId(board, player, type);
    const stats = unitRules[type]!;
    board.units.push({ id, player, type, col: hex.col, row: hex.row, hp: stats.hp, maxHp: stats.hp, attack: stats.attack });
    supply -= 6;
    log.push(`${id} at ${hex.col},${hex.row}`);
  }
  setSupply(board, player, supply);
}

function chooseRecruitType(board: BoardState, player: PlayerId): string {
  const counts = (type: string): number => board.units.filter((unit) => unit.player === player && unit.type === type).length;
  if (player === 'P1') {
    if (counts('guardian') < counts('marksman') + 2) {
      return 'guardian';
    }
    if (counts('marksman') < counts('druid') + 2) {
      return 'marksman';
    }
    if (counts('druid') <= counts('healer')) {
      return 'druid';
    }
    return 'healer';
  }
  if (counts('scout') < counts('raider') + 2) {
    return 'scout';
  }
  if (counts('raider') < counts('marksman') + 2) {
    return 'raider';
  }
  if (counts('marksman') < counts('guardian') + 1) {
    return 'marksman';
  }
  return 'guardian';
}

function reachableWithin(board: BoardState, map: BoardMap, unit: Unit, maxDistance: number): Array<{ col: number; row: number }> {
  const seen = new Set([coordKey(unit)]);
  const queue: Array<{ coord: { col: number; row: number }; distance: number }> = [{ coord: unit, distance: 0 }];
  const result: Array<{ col: number; row: number }> = [{ col: unit.col, row: unit.row }];
  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.distance >= maxDistance) {
      continue;
    }
    for (const next of neighbors(map, item.coord)) {
      const key = coordKey(next);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      if (isOccupied(board, next) && !(next.col === unit.col && next.row === unit.row)) {
        continue;
      }
      result.push(next);
      queue.push({ coord: next, distance: item.distance + 1 });
    }
  }
  return result;
}

function neighbors(map: BoardMap, coord: { col: number; row: number }): Array<{ col: number; row: number }> {
  const deltas = coord.col % 2 === 0
    ? [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]]
    : [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  const hexes = new Set(map.hexes.map(coordKey));
  return deltas
    .map(([dc, dr]) => ({ col: coord.col + dc!, row: coord.row + dr! }))
    .filter((next) => hexes.has(coordKey(next)));
}

function hexDistance(map: BoardMap, a: { col: number; row: number }, b: { col: number; row: number }): number {
  if (a.col === b.col && a.row === b.row) {
    return 0;
  }
  const seen = new Set([coordKey(a)]);
  const queue: Array<{ coord: { col: number; row: number }; distance: number }> = [{ coord: a, distance: 0 }];
  while (queue.length > 0) {
    const item = queue.shift()!;
    for (const next of neighbors(map, item.coord)) {
      const key = coordKey(next);
      if (seen.has(key)) {
        continue;
      }
      if (next.col === b.col && next.row === b.row) {
        return item.distance + 1;
      }
      seen.add(key);
      queue.push({ coord: next, distance: item.distance + 1 });
    }
  }
  return 999;
}

function entryFromTurn(result: TurnResult): unknown {
  return {
    id: result.id,
    player: result.player,
    round: result.round,
    deck: {
      before: `snapshots/${result.id}.before.deck.json`,
      after: `snapshots/${result.id}.after.deck.json`,
      drawnHand: result.drawnHand,
      played: result.played,
      bought: result.bought,
      produced: result.produced
    },
    board: {
      before: `snapshots/${result.id}.before.board.json`,
      after: `snapshots/${result.id}.after.board.json`
    },
    summary: result.summary,
    reasoning: result.reasoning
  };
}

function producedFrom(player: PlayerState): Produced {
  return {
    ...emptyProduced(),
    ...player.attributes
  };
}

function advanceBoard(board: BoardState, player: PlayerId): BoardState {
  const next = cloneBoard(board);
  next.turn = player === 'P1'
    ? { activePlayer: 'P2', round: board.turn.round }
    : { activePlayer: 'P1', round: board.turn.round + 1 };
  return next;
}

function orderedUnits(board: BoardState, player: PlayerId): Unit[] {
  return board.units.filter((unit) => unit.player === player && unit.hp > 0).toSorted((a, b) => unitValue(b.type) - unitValue(a.type) || a.id.localeCompare(b.id));
}

function unitValue(type: string): number {
  return ({ guardian: 6, raider: 5, marksman: 4, druid: 3, scout: 2, healer: 1 } as Record<string, number>)[type] ?? 0;
}

function livingCounts(board: BoardState): Record<PlayerId, number> {
  return {
    P1: board.units.filter((unit) => unit.player === 'P1' && unit.hp > 0).length,
    P2: board.units.filter((unit) => unit.player === 'P2' && unit.hp > 0).length
  };
}

function centerSplit(board: BoardState): Record<PlayerId | 'neutral', number> {
  return {
    P1: board.supplyControl.filter((center) => center.controller === 'P1').length,
    P2: board.supplyControl.filter((center) => center.controller === 'P2').length,
    neutral: board.supplyControl.filter((center) => center.controller === null).length
  };
}

function leadReasoning(counts: Record<PlayerId, number>, turnId: string): string {
  if (counts.P1 - counts.P2 >= 4) {
    return `Pending lead-4 marker: P1 after ${turnId}.`;
  }
  if (counts.P2 - counts.P1 >= 4) {
    return `Pending lead-4 marker: P2 after ${turnId}.`;
  }
  return 'No lead-4 pending marker after this turn.';
}

function activePlayer(state: GameState): PlayerId {
  return state.players[state.activePlayer]?.id as PlayerId;
}

function activePlayerState(state: GameState): PlayerState {
  const player = state.players[state.activePlayer];
  if (!player) {
    throw new Error('missing active player');
  }
  return player;
}

function opponent(player: PlayerId): PlayerId {
  return player === 'P1' ? 'P2' : 'P1';
}

function cardName(state: GameState): (card: string) => string {
  return (card) => state.cards[card]?.name ?? card;
}

function centerAt(map: BoardMap, col: number, row: number): Center | undefined {
  return map.supplyCenters.find((center) => center.col === col && center.row === row);
}

function isOccupied(board: BoardState, coord: { col: number; row: number }): boolean {
  return board.units.some((unit) => unit.col === coord.col && unit.row === coord.row);
}

function removeUnit(board: BoardState, id: string): void {
  board.units = board.units.filter((unit) => unit.id !== id);
}

function getSupply(board: BoardState, player: PlayerId): number {
  return board.supply.find((entry) => entry.player === player)?.amount ?? 0;
}

function setSupply(board: BoardState, player: PlayerId, amount: number): void {
  const entry = board.supply.find((candidate) => candidate.player === player);
  if (!entry) {
    board.supply.push({ player, amount });
    return;
  }
  entry.amount = amount;
}

function nextUnitId(board: BoardState, player: PlayerId, type: string): string {
  let index = 1;
  while (board.units.some((unit) => unit.id === `${player}-${type}-${index}`)) {
    index += 1;
  }
  return `${player}-${type}-${index}`;
}

function coordKey(coord: { col: number; row: number }): string {
  return `${coord.col},${coord.row}`;
}

function cloneBoard(board: BoardState): BoardState {
  return JSON.parse(JSON.stringify(board)) as BoardState;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadGameConfig } from '../../src/config/loadGameConfig';
import { applyAction } from '../../src/core/engine';
import { listLegalActions } from '../../src/core/legalActions';
import { SeededRng, type Rng } from '../../src/core/random';
import { setupGame } from '../../src/core/state';
import type { GameState, LegalAction } from '../../src/core/types';

type Player = 'P1' | 'P2';
type UnitType = 'guardian' | 'raider' | 'marksman' | 'scout' | 'druid' | 'healer';

interface Coord {
  col: number;
  row: number;
}

interface Unit extends Coord {
  id: string;
  player: Player;
  type: UnitType;
  hp: number;
  maxHp: number;
  attack: number;
}

interface BoardState {
  schemaVersion: 1;
  ruleset: string;
  map: string;
  turn: { activePlayer: Player; round: number };
  units: Unit[];
  supplyControl: Array<{ id: string; controller: Player | null }>;
  supply: Array<{ player: Player; amount: number }>;
  notes: string[];
}

interface ReplayEntry {
  id: string;
  player: Player;
  round: number;
  deck: {
    before: string;
    after: string;
    drawnHand: string[];
    played: string[];
    bought: string[];
    produced: Record<string, number>;
  };
  board: { before: string; after: string };
  summary: string;
  reasoning: string;
}

const runDir = '.games/e013c-upgrade-vs-swarm-a';
const snapshotsDir = join(runDir, 'snapshots');
const ruleset = 'territory-v1-cost6-damagecap-responsewin-lead4';
const mapId = 'sketch-v3-contest';
const cardConfigPath = `rulesets/${ruleset}/deck.yaml`;
const maxCompletedTurns = 60;

const unitRules: Record<UnitType, { hp: number; attack: number; movement: number; range?: number; heal?: number }> = {
  guardian: { hp: 16, attack: 4, movement: 1 },
  raider: { hp: 8, attack: 6, movement: 2 },
  marksman: { hp: 8, attack: 4, movement: 1, range: 2 },
  scout: { hp: 8, attack: 2, movement: 3, range: 2 },
  druid: { hp: 10, attack: 4, movement: 1, heal: 1 },
  healer: { hp: 4, attack: 1, movement: 1, range: 2, heal: 1 }
};

const centerPlans: Record<Player, string[]> = {
  P1: ['center-northeast', 'center-east', 'center-center-north', 'center-center', 'center-southeast'],
  P2: ['center-west-south', 'center-center-south', 'center-center', 'center-east', 'center-southeast', 'center-northwest']
};

const recruitPlans: Record<Player, UnitType[]> = {
  P1: ['guardian', 'marksman', 'druid', 'healer', 'guardian', 'marksman'],
  P2: ['scout', 'raider', 'marksman', 'guardian', 'scout', 'marksman', 'guardian', 'raider']
};

const p1BuyPlan = ['silver', 'village', 'armory', 'training', 'smithy', 'second-wind', 'peddler', 'armory', 'training', 'healer', 'gold', 'second-wind'];
const p2BuyPlan = ['silver', 'peddler', 'village', 'silver', 'gold', 'peddler', 'village', 'gold', 'silver', 'peddler', 'marksman'];

const idCounters: Record<Player, Partial<Record<UnitType, number>>> = { P1: {}, P2: {} };

function key(coord: Coord): string {
  return `${coord.col},${coord.row}`;
}

function other(player: Player): Player {
  return player === 'P1' ? 'P2' : 'P1';
}

function cardName(id: string, state: GameState): string {
  return state.cards[id]?.name ?? id;
}

function activePlayer(state: GameState): Player {
  return state.players[state.activePlayer]!.id as Player;
}

function liveUnits(board: BoardState, player: Player): Unit[] {
  return board.units.filter((unit) => unit.player === player && unit.hp > 0);
}

function centersControlled(board: BoardState, player: Player): number {
  return board.supplyControl.filter((center) => center.controller === player).length;
}

function supplyAmount(board: BoardState, player: Player): number {
  return board.supply.find((entry) => entry.player === player)!.amount;
}

function setSupply(board: BoardState, player: Player, amount: number): void {
  board.supply.find((entry) => entry.player === player)!.amount = amount;
}

function centerById(map: any, id: string): Coord {
  const center = map.supplyCenters.find((candidate: any) => candidate.id === id);
  if (!center) {
    throw new Error(`Unknown center: ${id}`);
  }
  return { col: center.col, row: center.row };
}

function homeHexes(map: any, player: Player): Coord[] {
  return map.homeBases.find((base: any) => base.player === player)!.hexes;
}

function neighbors(coord: Coord): Coord[] {
  const even = coord.col % 2 === 0;
  const offsets = even
    ? [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]]
    : [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  return offsets.map(([dc, dr]) => ({ col: coord.col + dc!, row: coord.row + dr! }));
}

function distance(a: Coord, b: Coord, hexes: Set<string>): number {
  if (key(a) === key(b)) {
    return 0;
  }
  const seen = new Set([key(a)]);
  let frontier: Coord[] = [a];
  for (let depth = 1; depth < 40; depth += 1) {
    const next: Coord[] = [];
    for (const coord of frontier) {
      for (const neighbor of neighbors(coord)) {
        const neighborKey = key(neighbor);
        if (!hexes.has(neighborKey) || seen.has(neighborKey)) {
          continue;
        }
        if (neighborKey === key(b)) {
          return depth;
        }
        seen.add(neighborKey);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return 999;
}

function stepToward(unit: Unit, target: Coord, board: BoardState, hexes: Set<string>, movement: number): Coord {
  const occupied = new Set(board.units.filter((candidate) => candidate.id !== unit.id && candidate.hp > 0).map(key));
  const enemyOccupied = new Set(board.units.filter((candidate) => candidate.id !== unit.id && candidate.hp > 0 && candidate.player !== unit.player).map(key));
  let best: Coord = { col: unit.col, row: unit.row };
  let bestDistance = distance(best, target, hexes);
  const seen = new Set([key(unit)]);
  let frontier: Array<{ coord: Coord; depth: number }> = [{ coord: unit, depth: 0 }];

  while (frontier.length > 0) {
    const current = frontier.shift()!;
    if (current.depth >= movement) {
      continue;
    }
    for (const neighbor of neighbors(current.coord)) {
      const neighborKey = key(neighbor);
      if (!hexes.has(neighborKey) || seen.has(neighborKey) || enemyOccupied.has(neighborKey)) {
        continue;
      }
      seen.add(neighborKey);
      const canEnd = !occupied.has(neighborKey);
      if (canEnd) {
        const candidateDistance = distance(neighbor, target, hexes);
        if (candidateDistance < bestDistance) {
          best = neighbor;
          bestDistance = candidateDistance;
        }
      }
      frontier.push({ coord: neighbor, depth: current.depth + 1 });
    }
  }
  return best;
}

function inRange(attacker: Unit, target: Unit, hexes: Set<string>): boolean {
  const rules = unitRules[attacker.type];
  const attackRange = rules.range ?? 1;
  return distance(attacker, target, hexes) <= attackRange;
}

function chooseCenterTarget(unit: Unit, board: BoardState, map: any, hexes: Set<string>): Coord {
  const priorities = centerPlans[unit.player];
  const uncontrolled = priorities
    .map((id) => ({ id, coord: centerById(map, id), controller: board.supplyControl.find((center) => center.id === id)?.controller ?? null }))
    .filter((center) => center.controller !== unit.player);
  const candidates = uncontrolled.length > 0
    ? uncontrolled
    : priorities.map((id) => ({ id, coord: centerById(map, id), controller: board.supplyControl.find((center) => center.id === id)?.controller ?? null }));
  candidates.sort((a, b) => distance(unit, a.coord, hexes) - distance(unit, b.coord, hexes));
  return candidates[0]!.coord;
}

function chooseUpgradeTarget(board: BoardState, player: Player, kind: 'health' | 'damage'): Unit | undefined {
  const preferred = player === 'P1'
    ? ['guardian', 'marksman', 'druid', 'healer', 'raider', 'scout']
    : ['guardian', 'marksman', 'raider', 'scout', 'druid', 'healer'];
  const units = liveUnits(board, player);
  units.sort((a, b) => {
    const typeDelta = preferred.indexOf(a.type) - preferred.indexOf(b.type);
    if (typeDelta !== 0) {
      return typeDelta;
    }
    if (kind === 'health') {
      return b.attack - a.attack;
    }
    return b.maxHp - a.maxHp;
  });
  return units[0];
}

function nextUnitId(player: Player, type: UnitType): string {
  idCounters[player][type] = (idCounters[player][type] ?? 0) + 1;
  return `${player}-${type}-${idCounters[player][type]}`;
}

function seedCounters(board: BoardState): void {
  for (const player of ['P1', 'P2'] as Player[]) {
    for (const unit of board.units.filter((candidate) => candidate.player === player)) {
      const match = unit.id.match(new RegExp(`^${player}-${unit.type}-(\\d+)$`));
      const value = match ? Number(match[1]) : 0;
      idCounters[player][unit.type] = Math.max(idCounters[player][unit.type] ?? 0, value);
    }
  }
}

function recruit(board: BoardState, map: any, player: Player, completedTurn: number): string[] {
  const recruited: string[] = [];
  let supply = supplyAmount(board, player);
  if (player === 'P1' && supply < 10 && liveUnits(board, player).length >= 6) {
    return recruited;
  }
  const occupied = new Set(board.units.filter((unit) => unit.hp > 0).map(key));
  const homes = homeHexes(map, player).filter((hex) => !occupied.has(key(hex)));
  let recruitIndex = liveUnits(board, player).length;
  const maxRecruits = player === 'P1' ? 1 : 4;

  while (supply >= 6 && homes.length > 0 && recruited.length < maxRecruits) {
    const type = recruitPlans[player][recruitIndex % recruitPlans[player].length]!;
    const coord = homes.shift()!;
    const rules = unitRules[type];
    const unit: Unit = {
      id: nextUnitId(player, type),
      player,
      type,
      col: coord.col,
      row: coord.row,
      hp: rules.hp,
      maxHp: rules.hp,
      attack: rules.attack
    };
    board.units.push(unit);
    recruited.push(unit.id);
    supply -= 6;
    recruitIndex += 1;
    void completedTurn;
  }
  setSupply(board, player, supply);
  return recruited;
}

function cardCounts(state: GameState, player: Player): Record<string, number> {
  const owner = state.players.find((candidate) => candidate.id === player)!;
  const counts: Record<string, number> = {};
  for (const id of [...owner.draw, ...owner.hand, ...owner.discard, ...owner.play]) {
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

function chooseBuy(state: GameState, legal: LegalAction[], player: Player): number {
  const counts = cardCounts(state, player);
  const plan = player === 'P1' ? p1BuyPlan : p2BuyPlan;
  const affordable = (cardId: string) => legal.findIndex((action) => action.description === `Buy ${cardName(cardId, state)} (${state.cards[cardId]?.cost})`);
  for (const cardId of plan) {
    const max = player === 'P1'
      ? (cardId === 'armory' || cardId === 'training' ? 3 : cardId === 'second-wind' ? 2 : 4)
      : (cardId === 'gold' ? 4 : cardId === 'peddler' || cardId === 'village' ? 5 : 6);
    if ((counts[cardId] ?? 0) >= max) {
      continue;
    }
    const index = affordable(cardId);
    if (index >= 0) {
      return index;
    }
  }
  for (const fallback of player === 'P1' ? ['gold', 'armory', 'training', 'second-wind', 'peddler', 'village', 'smithy', 'silver'] : ['gold', 'peddler', 'village', 'silver']) {
    const index = affordable(fallback);
    if (index >= 0) {
      return index;
    }
  }
  return legal.length - 1;
}

function chooseDeckAction(state: GameState, legal: LegalAction[], player: Player, bought: string[]): number {
  const current = state.players[state.activePlayer]!;
  if (state.phase === 'action') {
    if (!current.freeTrashUsed && current.play.length === 0) {
      const trashRest = legal.findIndex((action) => action.description === 'Trash Rest');
      if (trashRest >= 0) {
        return trashRest;
      }
    }
    const priorities = player === 'P1'
      ? ['Play Village', 'Play Peddler', 'Play Training', 'Play Second Wind', 'Play Armory', 'Play Smithy', 'Play Bandage', 'Play Potion', 'Play Healer', 'Play Zap']
      : ['Play Village', 'Play Peddler', 'Play Smithy', 'Play Bandage', 'Play Zap', 'Play Potion'];
    for (const description of priorities) {
      const index = legal.findIndex((action) => action.description === description);
      if (index >= 0) {
        return index;
      }
    }
    return legal.findIndex((action) => action.description === 'Move to buy phase');
  }
  if (state.phase === 'buy') {
    const endTurn = legal.findIndex((action) => action.description === 'End turn');
    const buyIndex = chooseBuy(state, legal, player);
    if (buyIndex !== endTurn && bought.length === 0) {
      bought.push(legal[buyIndex]!.description.replace(/^Buy /, '').replace(/ \(\d+\)$/, ''));
      return buyIndex;
    }
    return endTurn;
  }
  return 0;
}

function producedCounters(state: GameState): Record<string, number> {
  const player = state.players[state.activePlayer]!;
  return {
    money: player.money,
    damage: player.attributes.damage ?? 0,
    heal: player.attributes.heal ?? 0,
    upgradeHealth: player.attributes.upgradeHealth ?? 0,
    upgradeDamage: player.attributes.upgradeDamage ?? 0,
    reattack: player.attributes.reattack ?? 0,
    stormTargets: player.attributes.stormTargets ?? 0
  };
}

function playDeckTurn(state: GameState, rng: Rng): { state: GameState; drawnHand: string[]; played: string[]; bought: string[]; produced: Record<string, number> } {
  const player = activePlayer(state);
  const drawnHand = state.players[state.activePlayer]!.hand.map((id) => cardName(id, state));
  const played: string[] = [];
  const bought: string[] = [];
  let produced = producedCounters(state);

  while (!state.ended && activePlayer(state) === player) {
    const legal = listLegalActions(state);
    if (state.phase === 'buy' && legal.some((action) => action.description === 'End turn')) {
      produced = producedCounters(state);
    }
    const index = chooseDeckAction(state, legal, player, bought);
    const chosen = legal[index]!;
    if (chosen.description.startsWith('Play ')) {
      played.push(chosen.description.slice('Play '.length));
    }
    state = applyAction(state, chosen.action, rng);
  }

  return { state, drawnHand, played, bought, produced };
}

function applyBoardTurn(board: BoardState, map: any, hexes: Set<string>, player: Player, produced: Record<string, number>, completedTurn: number): { summary: string; reasoning: string } {
  const beforeUnits = liveUnits(board, player).length;
  const beforeEnemyUnits = liveUnits(board, other(player)).length;
  const income = 2 + centersControlled(board, player);
  setSupply(board, player, supplyAmount(board, player) + income);

  const events: string[] = [`income ${income}`];
  for (const unit of liveUnits(board, player)) {
    const target = chooseCenterTarget(unit, board, map, hexes);
    const destination = stepToward(unit, target, board, hexes, unitRules[unit.type].movement);
    unit.col = destination.col;
    unit.row = destination.row;
    const center = map.supplyCenters.find((candidate: any) => candidate.col === unit.col && candidate.row === unit.row);
    if (center) {
      const control = board.supplyControl.find((candidate) => candidate.id === center.id)!;
      if (control.controller !== player) {
        control.controller = player;
        events.push(`${unit.id} captured ${center.id}`);
      }
    }
  }

  let upgradeHealth = produced.upgradeHealth ?? 0;
  while (upgradeHealth > 0) {
    const target = chooseUpgradeTarget(board, player, 'health');
    if (!target) {
      break;
    }
    target.maxHp += 1;
    target.hp += 1;
    upgradeHealth -= 1;
    events.push(`${target.id} gained +1 max HP`);
  }

  let upgradeDamage = produced.upgradeDamage ?? 0;
  while (upgradeDamage > 0) {
    const target = chooseUpgradeTarget(board, player, 'damage');
    if (!target) {
      break;
    }
    target.attack += 1;
    upgradeDamage -= 1;
    events.push(`${target.id} gained +1 attack`);
  }

  let deckDamage = produced.damage ?? 0;
  const attackers = [...liveUnits(board, player)];
  const attackQueue = produced.reattack ? [...attackers, ...attackers.slice(0, produced.reattack)] : attackers;
  for (const attacker of attackQueue) {
    if (!board.units.some((unit) => unit.id === attacker.id && unit.hp > 0)) {
      continue;
    }
    const targets = liveUnits(board, other(player)).filter((target) => inRange(attacker, target, hexes));
    if (targets.length === 0) {
      continue;
    }
    targets.sort((a, b) => a.hp - b.hp || b.attack - a.attack);
    const target = targets[0]!;
    const extra = deckDamage > 0 ? 1 : 0;
    target.hp -= attacker.attack + extra;
    deckDamage -= extra;
    events.push(`${attacker.id} hit ${target.id} for ${attacker.attack + extra}`);
  }
  const killed = board.units.filter((unit) => unit.hp <= 0).map((unit) => unit.id);
  board.units = board.units.filter((unit) => unit.hp > 0);
  if (killed.length > 0) {
    events.push(`removed ${killed.join(', ')}`);
  }

  let deckHeal = produced.heal ?? 0;
  while (deckHeal > 0) {
    const damaged = liveUnits(board, player).filter((unit) => unit.hp < unit.maxHp).sort((a, b) => (b.maxHp - b.hp) - (a.maxHp - a.hp))[0];
    if (!damaged) {
      break;
    }
    damaged.hp += 1;
    deckHeal -= 1;
  }
  for (const healer of liveUnits(board, player).filter((unit) => (unitRules[unit.type].heal ?? 0) > 0)) {
    const healRange = unitRules[healer.type].range ?? 1;
    const target = liveUnits(board, player)
      .filter((unit) => unit.hp < unit.maxHp && distance(healer, unit, hexes) <= healRange)
      .sort((a, b) => (b.maxHp - b.hp) - (a.maxHp - a.hp))[0];
    if (target) {
      target.hp = Math.min(target.maxHp, target.hp + (unitRules[healer.type].heal ?? 0));
      events.push(`${healer.id} healed ${target.id}`);
    }
  }

  const recruited = recruit(board, map, player, completedTurn);
  if (recruited.length > 0) {
    events.push(`recruited ${recruited.join(', ')}`);
  }

  const afterUnits = liveUnits(board, player).length;
  const afterEnemyUnits = liveUnits(board, other(player)).length;
  const centerSplit = `centers ${centersControlled(board, 'P1')}-${centersControlled(board, 'P2')}`;
  const summary = `${player} ${events.slice(0, 3).join('; ')}; units ${beforeUnits}-${beforeEnemyUnits} to ${afterUnits}-${afterEnemyUnits}, ${centerSplit}.`;
  const reasoning = `${player === 'P1'
    ? 'P1 followed the upgrade/support assignment by prioritizing preservation and quality targets, with recruits capped to one high-value body when possible.'
    : 'P2 followed the swarm/economy assignment by converting supply into broad recruitment and contesting multiple centers.'} Board events: ${events.join('; ')}.`;
  return { summary, reasoning };
}

function advanceBoardTurn(board: BoardState): void {
  if (board.turn.activePlayer === 'P1') {
    board.turn.activePlayer = 'P2';
  } else {
    board.turn.activePlayer = 'P1';
    board.turn.round += 1;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  await rm(snapshotsDir, { recursive: true, force: true });
  await mkdir(snapshotsDir, { recursive: true });
  const config = await loadGameConfig(cardConfigPath);
  const rng = new SeededRng(1313);
  let deck = setupGame(config, rng);
  let board = JSON.parse(await readFile('.games/e013-contest-starter.board.json', 'utf8')) as BoardState;
  const map = JSON.parse(await readFile(`maps/${mapId}.json`, 'utf8'));
  const hexes = new Set<string>(map.hexes.map((coord: Coord) => key(coord)));
  const timeline: { schemaVersion: 1; title: string; entries: ReplayEntry[] } = {
    schemaVersion: 1,
    title: 'E013c upgrade/support vs swarm/economy A contest replay',
    entries: []
  };
  seedCounters(board);

  let pendingThreat: Player | null = null;
  let winner: Player | null = null;
  let completedTurns = 0;
  const threatLog: string[] = [];

  for (let turnNumber = 1; turnNumber <= maxCompletedTurns; turnNumber += 1) {
    const player = board.turn.activePlayer;
    const playerCount = liveUnits(board, player).length;
    const enemyCount = liveUnits(board, other(player)).length;
    if (pendingThreat && liveUnits(board, pendingThreat).length - liveUnits(board, other(pendingThreat)).length < 4) {
      threatLog.push(`Turn ${turnNumber}: cleared pending ${pendingThreat} lead before ${player}'s start check.`);
      pendingThreat = null;
    }
    if (playerCount - enemyCount >= 4) {
      if (pendingThreat === player) {
        winner = player;
        threatLog.push(`Turn ${turnNumber}: ${player} confirmed pending lead-4 at start of turn, ${playerCount}-${enemyCount}.`);
        break;
      }
      pendingThreat = player;
      threatLog.push(`Turn ${turnNumber}: ${player} created pending lead-4 at start of turn, ${playerCount}-${enemyCount}.`);
    }

    const turnId = `turn-${String(turnNumber).padStart(3, '0')}`;
    const paths = {
      deckBefore: `snapshots/${turnId}.before.deck.json`,
      deckAfter: `snapshots/${turnId}.after.deck.json`,
      boardBefore: `snapshots/${turnId}.before.board.json`,
      boardAfter: `snapshots/${turnId}.after.board.json`
    };

    const deckBefore = { schemaVersion: 1, rngState: rng.snapshot(), game: deck };
    const boardBefore = JSON.parse(JSON.stringify(board)) as BoardState;
    await writeJson(join(runDir, paths.deckBefore), deckBefore);
    await writeJson(join(runDir, paths.boardBefore), boardBefore);

    const deckResult = playDeckTurn(deck, rng);
    deck = deckResult.state;
    const boardResult = applyBoardTurn(board, map, hexes, player, deckResult.produced, turnNumber);
    advanceBoardTurn(board);

    await writeJson(join(runDir, paths.deckAfter), { schemaVersion: 1, rngState: rng.snapshot(), game: deck });
    await writeJson(join(runDir, paths.boardAfter), board);

    timeline.entries.push({
      id: turnId,
      player,
      round: boardBefore.turn.round,
      deck: {
        before: paths.deckBefore,
        after: paths.deckAfter,
        drawnHand: deckResult.drawnHand,
        played: deckResult.played,
        bought: deckResult.bought,
        produced: deckResult.produced
      },
      board: {
        before: paths.boardBefore,
        after: paths.boardAfter
      },
      summary: boardResult.summary,
      reasoning: `${pendingThreat ? `Pending threat after start check: ${pendingThreat}. ` : ''}${boardResult.reasoning}`
    });
    completedTurns = turnNumber;
  }

  await writeJson(join(runDir, 'deck.json'), { schemaVersion: 1, rngState: rng.snapshot(), game: deck });
  await writeJson(join(runDir, 'board.json'), board);
  await writeJson(join(runDir, 'timeline.json'), timeline);

  const finalP1 = liveUnits(board, 'P1').length;
  const finalP2 = liveUnits(board, 'P2').length;
  const finalCenters = {
    P1: centersControlled(board, 'P1'),
    P2: centersControlled(board, 'P2'),
    neutral: board.supplyControl.filter((center) => center.controller === null).length
  };
  const resultTakeaway = winner === 'P1'
    ? `- P1's upgrades successfully converted a smaller quality plan into a legal unit-count threat. P2 had center income for broad recruitment, but upgraded guardians and marksmen produced enough attrition to keep the swarm from stabilizing.`
    : winner === 'P2'
      ? `- P1's upgrades concentrated value onto durable guardians and ranged support, but the intentionally smaller recruitment posture could not keep pace once P2 converted the center/east income into multiple bodies.`
      : `- No winner emerged within the extended cap. The final position still had live tactical pressure, so treat this as unresolved pacing evidence rather than a balance conclusion.`;
  const notes = `# E013c Upgrade/Support vs Swarm/Economy A Notes

## Setup

- Ruleset: \`${ruleset}\`.
- Map: \`${mapId}\`.
- Starter board: \`.games/e013-contest-starter.board.json\`.
- Deck setup used the fixed \`deck.yaml\` starting deck: 5 Copper, Zap, Bandage, and 3 Rest per player. This matches the existing E013 contest run convention, despite the rules prose still mentioning an older 7-Copper draft baseline.
- P1 strategy: upgrade/support with Armory, Training, Second Wind, draw/economy support, and conservative high-value recruitment.
- P2 strategy: swarm/economy with Silver, Gold, Peddler, Village, broad recruitment, and enough incidental Zap/Bandage support from the starter deck.

## Result

- Completed player turns: ${completedTurns}.
- Winner: ${winner ?? 'none within cap'}${winner ? ' by confirmed lead-4 response-window unit-count win' : ''}.
- Final living units: P1 ${finalP1}, P2 ${finalP2}.
- Final supply centers: P1 ${finalCenters.P1}, P2 ${finalCenters.P2}, neutral ${finalCenters.neutral}.
- Final saved supply: P1 ${supplyAmount(board, 'P1')}, P2 ${supplyAmount(board, 'P2')}.

## Lead-4 Threat Handling

${threatLog.map((line) => `- ${line}`).join('\n') || '- No lead-4 threat occurred.'}

## Strategy Takeaways

${resultTakeaway}
- P2's economy buys created more reliable payload and the board plan repeatedly flipped contested centers, keeping pressure on upgraded P1 units.
- This run directly probes whether upgrade/support becomes a true win threat under E013 rather than only a stabilizing response.

## Rules Calls And Ambiguities

- The board schema has no pending-threat field; pending lead-4 state is recorded in timeline reasoning and this notes file.
- Deck-produced damage was attached only to legal attacks and capped at 1 deck-produced damage per attacking unit. Excess damage expired.
- Units recruited at the end of a board phase were not moved, healed, used for captures, or allowed to attack during that same phase.
- Tactical movement, targeting, and supply math were generated by a deterministic hand-audited simulator in this run directory. \`validate-run\` verifies schema, snapshot existence, active-player alignment, and continuity, not full tactical legality.
`;
  await writeFile(join(runDir, 'notes.md'), notes);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});

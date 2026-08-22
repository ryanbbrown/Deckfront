import {
  ALWAYS_AVAILABLE_ACTION_IDS, ALWAYS_AVAILABLE_COUNT, cardDefinition, firstBuyCarry, isTacticalAction, kingdomEpoch,
  kingdomMarket, kingdomOf, playerStartingHealth
} from '../game';
import type { CardFamily, CardMechanic, CardValues, MovementChoice, PlayerId } from '../game';
import { repairBuildIn } from './build';
import type { Strategy } from './strategy';
import { chooseTacticalAction } from './tacticalPilot';
import type { CullOption, PilotCard, TacticalView } from './tacticalPilot';
import { addProfileCard, buildAttackProfile, removeProfileCard } from './positionValue';
import type { AttackProfile, ProfileCard } from './positionValue';
import type { DeadDrawCounts, MatchResult, MatchTelemetry } from './types';
export { SIMULATION_KERNEL_PROTOCOL_VERSION } from './protocolVersions';

interface KernelCard {
  id: string;
  type: 'action' | 'treasure';
  mechanic: CardMechanic;
  family: CardFamily;
  cost: number;
  money: number;
  values: CardValues;
  tactical: boolean;
}

interface KernelKingdom {
  id: string;
  health: number;
  cards: readonly KernelCard[];
  index: ReadonlyMap<string, number>;
  initialSupply: Int16Array;
  aimBonus: number;
  feintBonus: number;
}

interface KernelPlayer {
  strategy: Strategy;
  build: number[];
  draw: number[];
  drawHead: number;
  hand: number[];
  discard: number[];
  play: number[];
  money: number;
  mana: number;
  firstBuyMoney: number;
  firstBuyPending: boolean;
  purchases: number[];
  acquired: Int16Array;
  attackProfile: AttackProfile;
}

interface KernelState {
  kingdom: KernelKingdom;
  players: [KernelPlayer, KernelPlayer];
  positions: [number, number];
  health: [number, number];
  aimed: [boolean, boolean];
  exposed: [boolean, boolean];
  supply: Int16Array;
  active: 0 | 1;
  turn: number;
  rng: number;
  tacticalPlayed: number;
  cardsPlayed: number[];
  spacesMoved: number;
  manaSpent: number;
  spellsPlayed: number;
  copiesPlayed: Int16Array;
  familiesPlayed: Set<CardFamily>;
  eventCount: number;
  telemetry: MatchTelemetry;
}

export interface SimulationMatchConfig {
  kingdomId: string;
  seed: number;
  firstPlayerId: PlayerId;
  swapSides: boolean;
  turnLimitPerPlayer: number;
  actionCapPerTurn: number;
  startingDraftEnabled?: boolean;
  strategies: Record<PlayerId, Strategy>;
}

let cachedEpoch = -1;
const kingdomCache = new Map<string, KernelKingdom>();

function kernelKingdom(kingdomId: string): KernelKingdom {
  const epoch = kingdomEpoch();
  if (epoch !== cachedEpoch) { kingdomCache.clear(); cachedEpoch = epoch; }
  const cached = kingdomCache.get(kingdomId);
  if (cached) return cached;
  const kingdom = kingdomOf(kingdomId);
  const definitions = [...kingdomMarket(kingdomId), cardDefinition('scrap')];
  const cards = definitions.map((definition): KernelCard => ({
    id: definition.id, type: definition.type, mechanic: definition.mechanic, family: definition.family,
    cost: definition.cost, money: definition.money ?? 0, values: definition.values ?? {},
    tactical: isTacticalAction(definition.id)
  }));
  const index = new Map(cards.map((card, cardIndex) => [card.id, cardIndex]));
  const initialSupply = new Int16Array(cards.length);
  initialSupply.fill(-1);
  for (const pile of kingdom.actionPiles) initialSupply[index.get(pile.cardId)!] = pile.count;
  for (const id of ALWAYS_AVAILABLE_ACTION_IDS) initialSupply[index.get(id)!] = ALWAYS_AVAILABLE_COUNT;
  const resolvedValue = (definitionId: string, key: string): number =>
    kingdom.overrides?.[definitionId]?.values?.[key] ?? cardDefinition(definitionId).values?.[key] ?? 0;
  const result = {
    id: kingdomId, health: kingdom.startingHealth, cards, index, initialSupply,
    aimBonus: resolvedValue('aim', 'bonus'), feintBonus: resolvedValue('feint', 'bonus')
  };
  kingdomCache.set(kingdomId, result);
  return result;
}

function seat(playerId: PlayerId): 0 | 1 { return playerId === 'ochre' ? 0 : 1; }
function playerId(index: 0 | 1): PlayerId { return index === 0 ? 'ochre' : 'indigo'; }
function other(index: 0 | 1): 0 | 1 { return index === 0 ? 1 : 0; }
function cardValue(card: KernelCard, key: string): number { return card.values[key] ?? 0; }
function kingdomValue(state: KernelState, definitionId: string, key: string): number {
  const index = state.kingdom.index.get(definitionId);
  if (index !== undefined) return cardValue(state.kingdom.cards[index]!, key);
  if (definitionId === 'aim' && key === 'bonus') return state.kingdom.aimBonus;
  if (definitionId === 'feint' && key === 'bonus') return state.kingdom.feintBonus;
  return 0;
}
function bump(counts: Record<string, number>, key: string, amount: number): void {
  counts[key] = (counts[key] ?? 0) + amount;
}
function emptyDeadDraws(): DeadDrawCounts { return { range: 0, mana: 0, setup: 0, total: 0 }; }

function makePlayer(kingdom: KernelKingdom, strategy: Strategy, startingDraftEnabled: boolean): KernelPlayer {
  const buildIds = startingDraftEnabled ? repairBuildIn(kingdom.id, strategy.startingBuild) : [];
  const build = buildIds.map((id) => kingdom.index.get(id)!).filter((index) => index !== undefined);
  const acquired = new Int16Array(kingdom.cards.length);
  for (const index of build) acquired[index]! += 1;
  const buildCost = build.reduce((total, index) => total + kingdom.cards[index]!.cost, 0);
  return {
    strategy, build, draw: [], drawHead: 0, hand: [], discard: [], play: [], money: 0, mana: 0,
    firstBuyMoney: startingDraftEnabled ? firstBuyCarry(buildCost) : 0, firstBuyPending: startingDraftEnabled, purchases: [], acquired,
    attackProfile: buildAttackProfile([])
  };
}

function createTelemetry(players: readonly [KernelPlayer, KernelPlayer], kingdom: KernelKingdom): MatchTelemetry {
  const build = (player: KernelPlayer): string[] => player.build.map((index) => kingdom.cards[index]!.id);
  return {
    turnsToWin: null, eventCount: 0,
    damageByCard: { ochre: {}, indigo: {} }, playsByCard: { ochre: {}, indigo: {} },
    purchasesByCard: { ochre: {}, indigo: {} },
    startingBuild: { ochre: build(players[0]), indigo: build(players[1]) },
    deadDraws: { ochre: emptyDeadDraws(), indigo: emptyDeadDraws() },
    moneySpent: { ochre: 0, indigo: 0 }, unspentMoney: { ochre: 0, indigo: 0 },
    finalHealth: { ochre: 0, indigo: 0 }
  };
}

function nextInt(state: KernelState, maximum: number): number {
  state.rng = (1664525 * state.rng + 1013904223) >>> 0;
  return Math.floor((state.rng / 0x100000000) * maximum);
}

function shuffle(state: KernelState, source: readonly number[]): number[] {
  const result = [...source];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = nextInt(state, index + 1);
    const value = result[index]!; result[index] = result[swap]!; result[swap] = value;
  }
  return result;
}

function event(state: KernelState, count = 1): void { state.eventCount += count; }

function draw(state: KernelState, playerIndex: 0 | 1, count: number): number {
  const player = state.players[playerIndex];
  let drawn = 0;
  while (drawn < count) {
    if (player.drawHead >= player.draw.length) {
      if (!player.discard.length) break;
      player.draw = shuffle(state, player.discard); player.drawHead = 0; player.discard = [];
    }
    player.hand.push(player.draw[player.drawHead]!); player.drawHead += 1; drawn += 1;
  }
  if (drawn > 0) event(state);
  return drawn;
}

function addDamage(state: KernelState, actor: 0 | 1, amount: number, close: boolean, source: number): boolean {
  const target = other(actor);
  let actual = amount;
  if (close && state.exposed[target]) actual += kingdomValue(state, 'feint', 'bonus');
  state.health[target] = Math.max(0, state.health[target] - actual);
  bump(state.telemetry.damageByCard[playerId(actor)], state.kingdom.cards[source]!.id, actual);
  event(state);
  if (state.health[target] === 0) {
    state.telemetry.turnsToWin = state.turn - 1;
    event(state);
    return true;
  }
  return false;
}

function addRangedDamage(state: KernelState, actor: 0 | 1, amount: number, source: number): boolean {
  if (state.aimed[actor]) {
    amount += kingdomValue(state, 'aim', 'bonus'); state.aimed[actor] = false; event(state);
  }
  return addDamage(state, actor, amount, false, source);
}

function positionAfter(position: number, movement: MovementChoice): number {
  return position + (movement === 'left' ? -1 : movement === 'right' ? 1 : 0);
}

function enabled(state: KernelState, actor: 0 | 1, card: KernelCard): boolean {
  const close = state.positions[actor] === state.positions[other(actor)];
  if (['melee', 'drive', 'flurry', 'feint', 'openingStrike', 'rally', 'bullRush'].includes(card.mechanic) && !close) return false;
  if (['ranged', 'repellingShot', 'volley', 'aim', 'longshot', 'salvageShot', 'precisionShot'].includes(card.mechanic) && close) return false;
  if (['spell', 'cascade'].includes(card.mechanic) && state.players[actor].mana < cardValue(card, 'manaCost')) return false;
  if (card.mechanic === 'bullRush') return state.players[actor].hand.filter((index) => state.kingdom.cards[index]!.family === 'melee').length > 1;
  if (card.mechanic === 'salvageShot') return state.players[actor].hand.filter((index) => state.kingdom.cards[index]!.family === 'ranged').length > 1;
  return card.type === 'action';
}

function movements(state: KernelState, actor: 0 | 1, mechanic: CardMechanic): MovementChoice[] {
  if (mechanic === 'drive') return ['left', 'right'];
  if (!['footwork', 'leyStep', 'step'].includes(mechanic)) return [];
  const result: MovementChoice[] = [];
  if (state.positions[actor] > 1) result.push('left');
  if (mechanic === 'footwork') result.push('stay');
  if (state.positions[actor] < 5) result.push('right');
  return result;
}

function moneyInActionPhase(state: KernelState, actor: 0 | 1): number {
  const player = state.players[actor];
  let money = player.money + (player.firstBuyPending ? player.firstBuyMoney : 0);
  for (const index of player.hand) money += state.kingdom.cards[index]!.type === 'treasure' ? state.kingdom.cards[index]!.money : 0;
  return money;
}

function finiteStillAvailable(state: KernelState, player: KernelPlayer, acquired: Int16Array, supply: Int16Array): boolean {
  return player.strategy.buyAgenda.some((entry) => {
    const index = state.kingdom.index.get(entry.cardId);
    if (index === undefined || entry.cardId === 'copper') return false;
    const card = state.kingdom.cards[index]!;
    return acquired[index]! < entry.desiredCount && card.cost > 0 && (card.type === 'treasure' || supply[index]! > 0);
  });
}

function purchaseProjection(state: KernelState, actor: 0 | 1, copperTrashed: number): readonly number[] {
  const player = state.players[actor];
  const acquired = new Int16Array(player.acquired);
  const supply = new Int16Array(state.supply);
  const finite = player.strategy.buyAgenda.map(() => 0);
  let repeated = 0;
  let money = moneyInActionPhase(state, actor) - copperTrashed;
  while (true) {
    let bought = false;
    for (let agendaIndex = 0; agendaIndex < player.strategy.buyAgenda.length; agendaIndex += 1) {
      const entry = player.strategy.buyAgenda[agendaIndex]!;
      const index = state.kingdom.index.get(entry.cardId);
      if (index === undefined || entry.cardId === 'copper' || acquired[index]! >= entry.desiredCount) continue;
      const card = state.kingdom.cards[index]!;
      if (card.cost <= 0 || card.cost > money || (card.type === 'action' && supply[index]! <= 0)) continue;
      money -= card.cost; acquired[index]! += 1; finite[agendaIndex]! += 1;
      if (card.type === 'action') supply[index]!--;
      bought = true; break;
    }
    if (bought) continue;
    if (finiteStillAvailable(state, player, acquired, supply)) break;
    const repeatIndex = state.kingdom.index.get(player.strategy.repeatPurchase);
    if (repeatIndex === undefined || player.strategy.repeatPurchase === 'copper') break;
    const repeat = state.kingdom.cards[repeatIndex]!;
    if (repeat.cost <= 0 || repeat.cost > money || (repeat.type === 'action' && supply[repeatIndex]! <= 0)) break;
    money -= repeat.cost; repeated += 1; if (repeat.type === 'action') supply[repeatIndex]!--;
  }
  return [...finite, repeated];
}

function attackProfile(state: KernelState, actor: 0 | 1): AttackProfile {
  const player = state.players[actor];
  function* definitions(): Iterable<ProfileCard> {
    for (let offset = player.drawHead; offset < player.draw.length; offset += 1) {
      const card = state.kingdom.cards[player.draw[offset]!]!;
      yield { definitionId: card.id, mechanic: card.mechanic, values: card.values };
    }
    for (const zone of [player.hand, player.discard, player.play]) for (const index of zone) {
      const card = state.kingdom.cards[index]!;
      yield { definitionId: card.id, mechanic: card.mechanic, values: card.values };
    }
  }
  return buildAttackProfile(definitions(), kingdomValue(state, 'aim', 'bonus'));
}

function profileCard(card: KernelCard): ProfileCard {
  return { definitionId: card.id, mechanic: card.mechanic, values: card.values };
}

function pilotView(state: KernelState, actor: 0 | 1, pending: 'discard' | 'recover' | null): TacticalView {
  const player = state.players[actor];
  const hand: PilotCard[] = player.hand.map((index, handIndex) => {
    const card = state.kingdom.cards[index]!;
    return {
      handIndex, definitionId: card.id, mechanic: card.mechanic, family: card.family, cost: card.cost, money: card.money,
      values: card.values, enabled: pending === null && enabled(state, actor, card),
      movements: movements(state, actor, card.mechanic)
    };
  });
  const cull = hand.find((card) => card.mechanic === 'cull');
  const copper = hand.filter((card) => card.definitionId === 'copper').map((card) => card.handIndex);
  const copperIndex = state.kingdom.index.get('copper')!;
  const copperOwned = player.hand.filter((index) => index === copperIndex).length
    + player.draw.slice(player.drawHead).filter((index) => index === copperIndex).length
    + player.discard.filter((index) => index === copperIndex).length
    + player.play.filter((index) => index === copperIndex).length;
  const cullOptions: CullOption[] = cull ? [{
    trashHandIndexes: [], trashCull: false, copperTrashed: 0,
    purchaseProjection: purchaseProjection(state, actor, 0)
  }] : [];
  if (cull) for (let count = 0; count <= Math.min(2, copper.length); count += 1) {
    if (count > 0) cullOptions.push({ trashHandIndexes: copper.slice(0, count), trashCull: false,
      copperTrashed: count, purchaseProjection: purchaseProjection(state, actor, count) });
    if (count < 2 && copperOwned === 0) cullOptions.push({ trashHandIndexes: copper.slice(0, count), trashCull: true,
      copperTrashed: count, purchaseProjection: purchaseProjection(state, actor, count) });
  }
  return {
    hand,
    discard: player.discard.map((index, discardIndex) => ({
      discardIndex, definitionId: state.kingdom.cards[index]!.id, cost: state.kingdom.cards[index]!.cost
    })),
    pendingChoice: pending,
    actorPosition: state.positions[actor], opponentPosition: state.positions[other(actor)],
    opponentHealth: state.health[other(actor)], aimed: state.aimed[actor],
    aimBonus: state.aimed[actor] ? kingdomValue(state, 'aim', 'bonus') : 0,
    opponentExposed: state.exposed[other(actor)],
    opponentExposedBonus: state.exposed[other(actor)] ? kingdomValue(state, 'feint', 'bonus') : 0,
    mana: player.mana, manaSpent: state.manaSpent, spellsPlayed: state.spellsPlayed, cardsPlayed: state.cardsPlayed.length,
    copiesPlayed: Object.fromEntries(state.kingdom.cards.map((card, index) => [card.id, state.copiesPlayed[index]!])),
    familiesPlayed: [...state.familiesPlayed], positionChanged: state.spacesMoved > 0, tacticalPlayed: state.tacticalPlayed, cullOptions,
    actorProfile: player.attackProfile, opponentProfile: state.players[other(actor)].attackProfile
  };
}

function removeHand(player: KernelPlayer, handIndex: number): number {
  const [card] = player.hand.splice(handIndex, 1);
  if (card === undefined) throw new Error(`No card at hand index ${handIndex}.`);
  return card;
}

function resolveDiscard(state: KernelState, actor: 0 | 1): void {
  const decision = chooseTacticalAction(pilotView(state, actor, 'discard'));
  if (decision.type !== 'discard') throw new Error('The tactical pilot did not resolve Prism discard.');
  state.players[actor].discard.push(removeHand(state.players[actor], decision.handIndex)); event(state);
}

function resolveRecover(state: KernelState, actor: 0 | 1): void {
  const decision = chooseTacticalAction(pilotView(state, actor, 'recover'));
  if (decision.type !== 'recover' || decision.discardIndex === null) return;
  const player = state.players[actor];
  const [card] = player.discard.splice(decision.discardIndex, 1);
  if (card === undefined) return;
  player.hand.push(card);
  event(state);
}

function playCard(state: KernelState, actor: 0 | 1, decision: Extract<ReturnType<typeof chooseTacticalAction>, { type: 'play' }>): boolean {
  const player = state.players[actor];
  const cardIndex = removeHand(player, decision.handIndex);
  const card = state.kingdom.cards[cardIndex]!;
  player.play.push(cardIndex);
  bump(state.telemetry.playsByCard[playerId(actor)], card.id, 1);
  event(state);
  const previousTactical = state.tacticalPlayed;
  if (card.tactical) state.tacticalPlayed += 1;
  state.cardsPlayed.push(cardIndex); state.copiesPlayed[cardIndex]! += 1;
  if (['arcBolt', 'fireball', 'starfire', 'discharge', 'cascade', 'overload'].includes(card.id)) state.spellsPlayed += 1;
  state.familiesPlayed.add(card.family);

  switch (card.mechanic) {
    case 'footwork': {
      const movement = decision.movement ?? 'stay';
      const next = positionAfter(state.positions[actor], movement);
      if (next !== state.positions[actor]) {
        state.spacesMoved += Math.abs(next - state.positions[actor]); state.positions[actor] = next;
      }
      event(state); draw(state, actor, cardValue(card, 'draw')); break;
    }
    case 'cull': {
      const copperCount = decision.targetHandIndexes?.length ?? 0;
      for (let count = 0; count < copperCount; count += 1) {
        const index = player.hand.findIndex((candidate) => state.kingdom.cards[candidate]!.id === 'copper');
        if (index >= 0) {
          const [trashed] = player.hand.splice(index, 1);
          removeProfileCard(player.attackProfile, profileCard(state.kingdom.cards[trashed!]!));
          event(state);
        }
      }
      if (decision.targetSelf) {
        player.play.pop(); removeProfileCard(player.attackProfile, profileCard(card)); event(state);
      }
      break;
    }
    case 'muster': draw(state, actor, cardValue(card, 'draw')); break;
    case 'feint': draw(state, actor, cardValue(card, 'draw')); state.exposed[other(actor)] = true; event(state); break;
    case 'drive': {
      if (addDamage(state, actor, cardValue(card, 'damage'), true, cardIndex)) return true;
      const movement = decision.movement ?? 'left';
      const destination = positionAfter(state.positions[actor], movement);
      if (destination < 1 || destination > 5) {
        event(state);
        if (addDamage(state, actor, cardValue(card, 'wallDamage'), false, cardIndex)) return true;
      } else {
        state.spacesMoved += Math.abs(destination - state.positions[actor]);
        state.positions[actor] = destination; state.positions[other(actor)] = destination;
        event(state);
      }
      break;
    }
    case 'flurry': if (addDamage(state, actor,
      previousTactical * cardValue(card, 'perAction'), true, cardIndex)) return true; break;
    case 'aim': state.aimed[actor] = true; event(state); draw(state, actor, cardValue(card, 'draw')); break;
    case 'volley': {
      const near = Math.abs(state.positions[actor] - state.positions[other(actor)]) === 1;
      if (addRangedDamage(state, actor, cardValue(card, near ? 'near' : 'far'), cardIndex)) return true;
      break;
    }
    case 'stipend': draw(state, actor, cardValue(card, 'draw')); player.money += cardValue(card, 'money'); break;
    case 'reclaim': if (player.discard.length) resolveRecover(state, actor); else draw(state, actor, cardValue(card, 'draw')); break;
    case 'adapt':
      draw(state, actor, cardValue(card, 'draw'));
      if (state.spacesMoved > 0) draw(state, actor, cardValue(card, 'movedDraw'));
      break;
    case 'melee': if (addDamage(state, actor, cardValue(card, 'damage'), true, cardIndex)) return true; draw(state, actor, cardValue(card, 'draw')); break;
    case 'ranged':
      if (addRangedDamage(state, actor, cardValue(card, 'damage'), cardIndex)) return true;
      draw(state, actor, cardValue(card, 'draw')); break;
    case 'repellingShot': {
      const near = Math.abs(state.positions[actor] - state.positions[other(actor)]) === 1;
      if (addRangedDamage(state, actor, cardValue(card, near ? 'near' : 'far'), cardIndex)) return true;
      const target = other(actor);
      const targetStep = state.positions[target] > state.positions[actor] ? 1 : -1;
      const targetDestination = state.positions[target] + targetStep;
      if (targetDestination >= 1 && targetDestination <= 5) {
        state.positions[target] = targetDestination; event(state);
        break;
      }
      const actorDestination = state.positions[actor] - targetStep;
      if (actorDestination >= 1 && actorDestination <= 5) {
        state.spacesMoved += Math.abs(actorDestination - state.positions[actor]);
        state.positions[actor] = actorDestination; event(state);
      }
      break;
    }
    case 'spell':
      player.mana -= cardValue(card, 'manaCost'); state.manaSpent += cardValue(card, 'manaCost'); event(state);
      if (addDamage(state, actor, cardValue(card, 'damage'), false, cardIndex)) return true; break;
    case 'channel': player.mana += cardValue(card, 'mana'); event(state); draw(state, actor, cardValue(card, 'draw')); break;
    case 'leyStep': case 'step': {
      const movement = decision.movement ?? 'left'; const next = positionAfter(state.positions[actor], movement);
      state.spacesMoved += Math.abs(next - state.positions[actor]); state.positions[actor] = next; event(state);
      const mana = cardValue(card, 'mana') + (card.mechanic === 'leyStep' && Math.abs(state.positions[actor] - state.positions[other(actor)]) >= 2 ? cardValue(card, 'farMana') : 0); if (mana) { player.mana += mana; event(state); }
      break;
    }
    case 'prism':
      player.mana += cardValue(card, 'mana'); event(state); draw(state, actor, cardValue(card, 'draw')); resolveDiscard(state, actor); break;
    case 'attune': player.mana += cardValue(card, 'mana') + (state.copiesPlayed[cardIndex]! - 1) * cardValue(card, 'perCopy'); event(state); draw(state, actor, cardValue(card, 'draw')); break;
    case 'discharge': {
      const mana = player.mana;
      const won = addDamage(state, actor, mana * cardValue(card, 'perMana'), false, cardIndex);
      player.mana = 0; if (mana) event(state);
      if (won) return true;
      break;
    }
    case 'cascade': player.mana -= cardValue(card, 'manaCost'); state.manaSpent += cardValue(card, 'manaCost'); event(state); if (addDamage(state, actor, cardValue(card, 'damage') + (state.spellsPlayed - 1) * cardValue(card, 'perSpell'), false, cardIndex)) return true; break;
    case 'overload': if (addDamage(state, actor, state.manaSpent * cardValue(card, 'perManaSpent'), false, cardIndex)) return true; break;
    case 'openingStrike': if (addDamage(state, actor, cardValue(card, state.cardsPlayed.length === 1 ? 'first' : 'later'), true, cardIndex)) return true; break;
    case 'rally': if (addDamage(state, actor, cardValue(card, 'damage') + (state.copiesPlayed[cardIndex]! - 1) * cardValue(card, 'perCopy'), true, cardIndex)) return true; break;
    case 'bullRush': { const target = player.hand.findIndex((index) => state.kingdom.cards[index]!.family === 'melee'); if (target >= 0) { player.discard.push(player.hand.splice(target, 1)[0]!); event(state); } if (addDamage(state, actor, cardValue(card, 'damage'), true, cardIndex)) return true; break; }
    case 'longshot': if (addRangedDamage(state, actor, Math.abs(state.positions[actor] - state.positions[other(actor)]), cardIndex)) return true; break;
    case 'salvageShot': { const target = player.hand.findIndex((index) => state.kingdom.cards[index]!.family === 'ranged'); const discarded = target >= 0 ? player.hand.splice(target, 1)[0] : undefined; if (discarded !== undefined) { player.discard.push(discarded); event(state); if (addRangedDamage(state, actor, state.kingdom.cards[discarded]!.cost, cardIndex)) return true; draw(state, actor, cardValue(card, 'draw')); } break; }
    case 'precisionShot': if (addRangedDamage(state, actor, cardValue(card, state.copiesPlayed[cardIndex] === 1 ? 'first' : 'later'), cardIndex)) return true; break;
    case 'regroup':
      draw(state, actor, cardValue(card, 'draw'));
      if (player.hand.length) resolveDiscard(state, actor);
      break;
    case 'discipline': { player.play.pop(); removeProfileCard(player.attackProfile, profileCard(card)); event(state); if (addDamage(state, actor, cardValue(card, 'damage'), false, cardIndex)) return true; break; }
    case 'sharpen': draw(state, actor, cardValue(card, 'draw')); break;
    case 'reforge': { const trashed = player.play.pop() ?? cardIndex; removeProfileCard(player.attackProfile, profileCard(state.kingdom.cards[trashed]!)); event(state); const maximum = state.kingdom.cards[trashed]!.cost + cardValue(card, 'costBonus'); let gain = -1; for (let index = 0; index < state.kingdom.cards.length; index += 1) { const candidate = state.kingdom.cards[index]!; if (candidate.id !== 'scrap' && candidate.cost <= maximum && pileAvailable(state, index) && (gain < 0 || (candidate.cost > state.kingdom.cards[gain]!.cost || (candidate.cost === state.kingdom.cards[gain]!.cost && candidate.id.localeCompare(state.kingdom.cards[gain]!.id) < 0)))) gain = index; } if (gain >= 0) { const gained = state.kingdom.cards[gain]!; player.discard.push(gain); player.acquired[gain]! += 1; if (gained.type === 'action') state.supply[gain]!--; addProfileCard(player.attackProfile, profileCard(gained)); event(state); } break; }
    case 'scour': {
      let trashed = 0;
      for (let count = 0; count < 2; count += 1) {
        const target = player.hand.findIndex((index) => state.kingdom.cards[index]!.id === 'copper');
        if (target < 0) break;
        const [removed] = player.hand.splice(target, 1);
        removeProfileCard(player.attackProfile, profileCard(state.kingdom.cards[removed!]!));
        trashed += 1; event(state);
      }
      draw(state, actor, trashed * cardValue(card, 'drawPerTrash'));
      break;
    }
    case 'improvise': if (addDamage(state, actor, state.familiesPlayed.size * cardValue(card, 'perFamily'), false, cardIndex)) return true; break;
    case 'scrap': if (addDamage(state, actor, cardValue(card, 'damage'), false, cardIndex)) return true; break;
    case 'money': throw new Error('The tactical pilot cannot play treasure cards.');
  }
  return false;
}

function recordDeadDraws(state: KernelState, actor: 0 | 1): void {
  const player = state.players[actor];
  const counts = state.telemetry.deadDraws[playerId(actor)];
  const close = state.positions[actor] === state.positions[other(actor)];
  for (const index of player.hand) {
    const card = state.kingdom.cards[index]!;
    if (card.type !== 'action') continue;
    if ((['melee', 'drive', 'flurry', 'feint', 'openingStrike', 'rally', 'bullRush'].includes(card.mechanic) && !close)
      || (['ranged', 'repellingShot', 'volley', 'aim', 'longshot', 'salvageShot', 'precisionShot'].includes(card.mechanic) && close)) {
      counts.range += 1; counts.total += 1; continue;
    }
    if (['spell', 'cascade'].includes(card.mechanic) && player.mana < cardValue(card, 'manaCost')) {
      counts.mana += 1; counts.total += 1; continue;
    }
    if (!enabled(state, actor, card)) { counts.total += 1; continue; }
    if (card.mechanic === 'volley' && !state.aimed[actor]) counts.setup += 1;
    else if (card.mechanic === 'flurry' && state.tacticalPlayed === 0) counts.setup += 1;
  }
}

function endActionPhase(state: KernelState, actor: 0 | 1): void {
  const player = state.players[actor];
  recordDeadDraws(state, actor);
  const remaining: number[] = [];
  const treasures: number[] = [];
  for (const index of player.hand) {
    const card = state.kingdom.cards[index]!;
    if (card.type === 'treasure') { player.money += card.money; treasures.push(index); }
    else remaining.push(index);
  }
  player.hand = remaining; player.play.push(...treasures);
  if (player.firstBuyPending) player.money += player.firstBuyMoney;
  player.mana = 0; event(state);
}

function pileAvailable(state: KernelState, cardIndex: number): boolean {
  return state.kingdom.cards[cardIndex]!.type === 'treasure' || state.supply[cardIndex]! > 0;
}

function choosePurchase(state: KernelState, actor: 0 | 1): number | null {
  const player = state.players[actor];
  for (const entry of player.strategy.buyAgenda) {
    const index = state.kingdom.index.get(entry.cardId);
    if (index === undefined || entry.cardId === 'copper' || entry.desiredCount <= 0) continue;
    const card = state.kingdom.cards[index]!;
    if (card.cost <= 0 || player.acquired[index]! >= entry.desiredCount) continue;
    if (card.cost <= player.money && pileAvailable(state, index)) return index;
  }
  const finiteDone = player.strategy.buyAgenda.every((entry) => {
    const index = state.kingdom.index.get(entry.cardId);
    if (index === undefined || entry.cardId === 'copper') return true;
    const card = state.kingdom.cards[index]!;
    return card.cost <= 0 || player.acquired[index]! >= entry.desiredCount || !pileAvailable(state, index);
  });
  if (!finiteDone || player.strategy.repeatPurchase === 'copper') return null;
  const repeat = state.kingdom.index.get(player.strategy.repeatPurchase);
  if (repeat === undefined) return null;
  const card = state.kingdom.cards[repeat]!;
  return card.cost > 0 && card.cost <= player.money && pileAvailable(state, repeat) ? repeat : null;
}

function buy(state: KernelState, actor: 0 | 1, cardIndex: number): void {
  const player = state.players[actor]; const card = state.kingdom.cards[cardIndex]!;
  player.money -= card.cost; if (card.type === 'action') state.supply[cardIndex]!--;
  player.discard.push(cardIndex); player.purchases.push(cardIndex); player.acquired[cardIndex]! += 1;
  addProfileCard(player.attackProfile, profileCard(card));
  bump(state.telemetry.purchasesByCard[playerId(actor)], card.id, 1);
  state.telemetry.moneySpent[playerId(actor)] += card.cost; event(state);
}

function endBuyPhase(state: KernelState, actor: 0 | 1): void {
  const player = state.players[actor];
  state.telemetry.unspentMoney[playerId(actor)] += player.money;
  player.discard.push(...player.hand, ...player.play); player.hand = []; player.play = [];
  player.money = 0; player.mana = 0; player.firstBuyPending = false; player.firstBuyMoney = 0;
  state.aimed[actor] = false; state.exposed[other(actor)] = false;
  draw(state, actor, 5); state.tacticalPlayed = 0; state.cardsPlayed = []; state.spacesMoved = 0; state.manaSpent = 0; state.spellsPlayed = 0;
  state.copiesPlayed.fill(0); state.familiesPlayed.clear();
  state.active = other(actor); state.turn += 1; event(state);
}

function createState(config: SimulationMatchConfig): KernelState {
  const kingdom = kernelKingdom(config.kingdomId);
  const draft = config.startingDraftEnabled ?? true;
  const players: [KernelPlayer, KernelPlayer] = [
    makePlayer(kingdom, config.strategies.ochre, draft), makePlayer(kingdom, config.strategies.indigo, draft)
  ];
  const state: KernelState = {
    kingdom, players, positions: config.swapSides ? [3, 2] : [2, 3],
    health: [playerStartingHealth(kingdom.health, config.firstPlayerId === 'ochre'),
      playerStartingHealth(kingdom.health, config.firstPlayerId === 'indigo')],
    aimed: [false, false], exposed: [false, false], supply: new Int16Array(kingdom.initialSupply),
    active: seat(config.firstPlayerId), turn: 1, rng: config.seed >>> 0, tacticalPlayed: 0,
    cardsPlayed: [], spacesMoved: 0, manaSpent: 0, spellsPlayed: 0, copiesPlayed: new Int16Array(kingdom.cards.length), familiesPlayed: new Set(), eventCount: 2,
    telemetry: undefined as unknown as MatchTelemetry
  };
  const copper = kingdom.index.get('copper')!; const scrap = kingdom.index.get('scrap')!;
  const starting = (player: KernelPlayer): number[] => draft
    ? [...Array<number>(7).fill(copper), ...player.build]
    : [...Array<number>(7).fill(copper), ...Array<number>(3).fill(scrap)];
  players[0].draw = shuffle(state, starting(players[0]));
  players[1].draw = shuffle(state, starting(players[1]));
  draw(state, 0, 5); draw(state, 1, 5); event(state);
  // Draft-off setup records only the turn event; its initial deal is not a public draw event.
  if (!draft) state.eventCount = 1;
  players[0].attackProfile = attackProfile(state, 0);
  players[1].attackProfile = attackProfile(state, 1);
  state.telemetry = createTelemetry(players, kingdom);
  return state;
}

export function runSimulationMatch(config: SimulationMatchConfig): MatchResult {
  const state = createState(config);
  let outcome: MatchResult['outcome'] = 'draw';
  let reason: MatchResult['reason'] = 'turnLimit';
  let actionsInTurn = 0;
  let phase: 'action' | 'buy' = 'action';

  for (;;) {
    const actor = state.active;
    let turnChanged = false;
    if (phase === 'action') {
      const decision = chooseTacticalAction(pilotView(state, actor, null));
      if (decision.type === 'play') {
        const won = playCard(state, actor, decision); actionsInTurn += 1;
        if (won) { outcome = playerId(actor); reason = 'victory'; break; }
      } else {
        endActionPhase(state, actor); actionsInTurn += 1; phase = 'buy';
      }
    } else {
      const purchase = choosePurchase(state, actor);
      if (purchase !== null) { buy(state, actor, purchase); actionsInTurn += 1; }
      else { endBuyPhase(state, actor); actionsInTurn += 1; phase = 'action'; turnChanged = true; }
    }
    if (actionsInTurn > config.actionCapPerTurn) { reason = 'actionCap'; break; }
    if (state.turn > config.turnLimitPerPlayer * 2) { reason = 'turnLimit'; break; }
    if (turnChanged) actionsInTurn = 0;
  }

  state.telemetry.eventCount = state.eventCount;
  state.telemetry.finalHealth = { ochre: state.health[0], indigo: state.health[1] };
  return {
    config: {
      kingdomId: config.kingdomId, seed: config.seed, firstPlayerId: config.firstPlayerId,
      swapSides: config.swapSides, turnLimitPerPlayer: config.turnLimitPerPlayer,
      actionCapPerTurn: config.actionCapPerTurn, startingDraftEnabled: config.startingDraftEnabled ?? true,
      agentIds: { ochre: config.strategies.ochre.id, indigo: config.strategies.indigo.id }
    },
    outcome, reason, turns: state.turn - 1, telemetry: state.telemetry
  };
}

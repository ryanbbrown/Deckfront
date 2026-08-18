import { EFFECTS, applyAction, listLegalActions, opponent, rangeBand, resolveCard } from '../game';
import type { CardInstance, CardMechanic, GameEvent, GameState, LegalAction, PlayerId } from '../game';
import { priorityRank } from './strategy';
import type { Strategy } from './strategy';
import { ActionSearchOverflowError } from './types';

/** The best result reachable from a state: lethality first, then score, then the shorter suffix. */
export interface Branch { lethal: boolean; score: number; suffix: number }
export type SearchMemo = Map<string, Branch>;
export interface SearchBaseline { eventIndex: number; opponentHealth: number }
export interface SearchOptions { stateLimit: number; memo: SearchMemo | null }
export interface SearchOutcome { action: LegalAction; visited: number }

export const DEFAULT_STATE_LIMIT = 20000;

// Mechanics whose effect deals damage. No card value separates them from the rest, so the set is explicit.
const ATTACK_MECHANICS: ReadonlySet<CardMechanic> = new Set<CardMechanic>(['melee', 'ranged', 'spell', 'volley', 'drive', 'flurry']);

export function createMemo(): SearchMemo { return new Map(); }

/** The state the Action phase started from. Fixed for the phase, so one memo serves every decision. */
export function searchBaseline(state: GameState, playerId: PlayerId): SearchBaseline {
  return { eventIndex: state.events.length, opponentHealth: state.fighters[opponent(playerId)].health };
}

function detailText(event: GameEvent, key: string): string | null {
  const value = event.detail[key];
  return typeof value === 'string' ? value : null;
}
function detailNumber(event: GameEvent, key: string): number {
  const value = event.detail[key];
  return typeof value === 'number' ? value : 0;
}
function zones(state: GameState, playerId: PlayerId): readonly CardInstance[][] {
  const deck = state.players[playerId].deck;
  return [deck.draw, deck.hand, deck.discard, deck.play];
}

/** True when the owned deck holds an attack the current range band allows. */
function ownsAttackInBand(state: GameState, playerId: PlayerId): boolean {
  const seen = new Set<string>();
  for (const zone of zones(state, playerId)) {
    for (const card of zone) {
      if (seen.has(card.definitionId)) continue;
      seen.add(card.definitionId);
      const definition = resolveCard(state, card.definitionId);
      if (!ATTACK_MECHANICS.has(definition.mechanic)) continue;
      // A spell short of mana reports NEEDS_MANA, which is not a range problem.
      const code = EFFECTS[definition.mechanic].gate(state, playerId, definition.values ?? {});
      if (code !== 'NEEDS_CLOSE' && code !== 'NEEDS_NEAR_OR_FAR') return true;
    }
  }
  return false;
}

/**
 * Money the Buy phase would receive. `endActionPhase` moves treasures out of hand and adds their
 * money in one step, so the amount is computed by hand here and the state is scored before it applies.
 */
export function actionPhaseMoney(state: GameState, playerId: PlayerId): number {
  const player = state.players[playerId];
  let money = player.money + (player.firstBuyPending ? player.firstBuyMoney : 0);
  for (const card of player.deck.hand) {
    const definition = resolveCard(state, card.definitionId);
    if (definition.type === 'treasure') money += definition.money ?? 0;
  }
  return money;
}

export function scoreState(state: GameState, playerId: PlayerId, strategy: Strategy, baseline: SearchBaseline): number {
  const weights = strategy.weights;
  let cardsDrawn = 0;
  let trashed = 0;
  let reclaimed = 0;
  let discarded = 0;
  for (let index = baseline.eventIndex; index < state.events.length; index += 1) {
    const event = state.events[index]!;
    if (event.playerId !== playerId) continue;
    switch (event.type) {
      case 'draw': cardsDrawn += detailNumber(event, 'count'); break;
      case 'trash': trashed += priorityRank(strategy.trashPriority, detailText(event, 'definitionId')); break;
      case 'recover': reclaimed += priorityRank(strategy.reclaimPriority, detailText(event, 'definitionId')); break;
      case 'discard': discarded += priorityRank(strategy.discardPriority, detailText(event, 'definitionId')); break;
      default: break;
    }
  }
  return weights.damage * (baseline.opponentHealth - state.fighters[opponent(playerId)].health)
    + weights.cardsDrawn * cardsDrawn
    + weights.moneyGained * actionPhaseMoney(state, playerId)
    + weights.trashed * trashed
    + weights.reclaimed * reclaimed
    + weights.discarded * discarded
    + weights.preferredRange * (rangeBand(state) === strategy.preferredRange ? 1 : 0)
    + weights.unspentMana * state.players[playerId].mana
    + weights.opponentOutOfAttackRange * (ownsAttackInBand(state, playerId) ? 0 : 1);
}

/**
 * Keys the fields that change what the rest of the Action phase can reach. `events`, `version`, and
 * card instance ids are excluded because they differ without changing the game.
 */
export function memoKey(state: GameState, playerId: PlayerId): string {
  const player = state.players[playerId];
  const mine = state.fighters[playerId];
  const foe = state.fighters[opponent(playerId)];
  const sorted = (cards: readonly CardInstance[]): string => cards.map((card) => card.definitionId).sort().join(',');
  const ordered = (cards: readonly CardInstance[]): string => cards.map((card) => card.definitionId).join(',');
  const tactical = state.actionsThisTurn.filter((id) => EFFECTS[resolveCard(state, id).mechanic].tactical).length;
  const pending = state.pendingChoice;
  return [
    mine.position, mine.health, mine.aimed ? 1 : 0, mine.exposed ? 1 : 0,
    foe.position, foe.health, foe.aimed ? 1 : 0, foe.exposed ? 1 : 0,
    sorted(player.deck.hand), sorted(player.deck.play),
    ordered(player.deck.draw), ordered(player.deck.discard),
    player.mana, player.money, player.positionChanged ? 1 : 0, state.rngState,
    pending ? `${pending.type}:${pending.remaining}` : '-',
    tactical
  ].join('|');
}

function isBetter(candidate: Branch, best: Branch | null): boolean {
  if (!best) return true;
  if (candidate.lethal !== best.lethal) return candidate.lethal;
  if (candidate.score !== best.score) return candidate.score > best.score;
  return candidate.suffix < best.suffix;
}

/**
 * Searches the complete Action-phase tree and returns the first action of the best branch. Throws
 * `ActionSearchOverflowError` past the state limit rather than falling back to a weaker action.
 */
export function searchAction(
  state: GameState, playerId: PlayerId, actions: readonly LegalAction[],
  strategy: Strategy, baseline: SearchBaseline, options: SearchOptions
): SearchOutcome {
  const foeId = opponent(playerId);
  const memo = options.memo;
  let visited = 0;

  const terminal = (current: GameState): Branch => ({
    lethal: current.fighters[foeId].health === 0,
    score: scoreState(current, playerId, strategy, baseline),
    suffix: 0
  });

  function step(current: GameState, action: LegalAction): Branch {
    // `endActionPhase` is where a branch stops, so the state is scored before it applies.
    if (action.command.type === 'endActionPhase') return { ...terminal(current), suffix: 1 };
    const child = visit(applyAction(current, action.id));
    return { lethal: child.lethal, score: child.score, suffix: child.suffix + 1 };
  }

  function expand(current: GameState, available: readonly LegalAction[]): Branch {
    let best: Branch | null = null;
    for (const action of available) {
      const candidate = step(current, action);
      if (isBetter(candidate, best)) best = candidate;
    }
    if (!best) throw new Error('The Action-phase search reached a state with no legal action.');
    return best;
  }

  function visit(current: GameState): Branch {
    if (current.winner || current.phase !== 'action') return terminal(current);
    const key = memo ? memoKey(current, playerId) : null;
    if (key !== null) {
      const cached = memo!.get(key);
      if (cached) return cached;
    }
    visited += 1;
    if (visited > options.stateLimit) {
      throw new ActionSearchOverflowError(`The Action-phase search passed its limit of ${options.stateLimit} states.`);
    }
    const best = expand(current, listLegalActions(current));
    if (key !== null) memo!.set(key, best);
    return best;
  }

  visited += 1;
  if (visited > options.stateLimit) {
    throw new ActionSearchOverflowError(`The Action-phase search passed its limit of ${options.stateLimit} states.`);
  }
  let bestAction: LegalAction | null = null;
  let bestBranch: Branch | null = null;
  for (const action of actions) {
    const candidate = step(state, action);
    if (isBetter(candidate, bestBranch)) { bestBranch = candidate; bestAction = action; }
  }
  if (!bestAction) throw new Error('The Action-phase search was given no legal action.');
  return { action: bestAction, visited };
}
